"""Virtual temperature sensor, fault injection, and trained anomaly detector."""

from functools import lru_cache
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import IsolationForest

from .schemas import SensorAnalyzeRequest, SensorRequest


def simulate_sensor(request: SensorRequest) -> dict:
    r = request
    count = round(r.sample_rate_hz * r.duration_seconds)
    time = np.arange(count) / r.sample_rate_hz
    step_at = count // 3
    ideal = np.full(count, r.true_value, dtype=float)
    ideal[step_at:] += r.step_change
    tau = max(r.response_seconds, 1 / r.sample_rate_hz)
    if r.fault_type == "SLOW_RESPONSE":
        tau = max(tau, r.duration_seconds / 3)
    alpha = 1 - np.exp(-1 / (r.sample_rate_hz * tau))
    measured = np.empty(count, dtype=float)
    measured[0] = ideal[0]
    for i in range(1, count):
        measured[i] = measured[i - 1] + alpha * (ideal[i] - measured[i - 1])
    rng = np.random.default_rng(r.seed)
    noise_rms = r.noise_rms * (8 if r.fault_type == "NOISE" else 1)
    measured += rng.normal(0, noise_rms, count)
    offset = r.offset if r.offset else (3.0 if r.fault_type == "OFFSET" else 0.0)
    drift = r.drift_per_second if r.drift_per_second else (0.12 if r.fault_type == "DRIFT" else 0.0)
    measured += offset + drift * time
    if r.fault_type == "STUCK":
        measured[:] = r.true_value + offset
    dropout = np.zeros(count, dtype=bool)
    if r.fault_type == "DROPOUT":
        dropout = rng.random(count) < 0.18
        measured[dropout] = np.nan
    return {
        "data_source": "PYTHON_SIMULATION", "signal_name": "temperature",
        "unit": "degC", "fault_injection": r.fault_type,
        "sample_rate_hz": r.sample_rate_hz, "seed": r.seed,
        "time_s": time.tolist(), "ideal": ideal.tolist(),
        "measured": [None if missing else float(value)
                     for missing, value in zip(dropout, measured)],
        "dropout_fraction": float(np.mean(dropout)),
    }


def sensor_features(ideal, measured, sample_rate_hz: float) -> dict[str, float]:
    reference = np.asarray(ideal, dtype=float)
    values = np.asarray([np.nan if v is None else v for v in measured], dtype=float)
    if len(values) != len(reference) or len(values) < 32 or not np.isfinite(reference).all():
        raise ValueError("Invalid sensor waveform")
    valid = np.isfinite(values)
    if not valid.any():
        raise ValueError("No observed sensor samples")
    residual = values[valid] - reference[valid]
    t = np.arange(len(values))[valid] / sample_rate_hz
    slope = float(np.polyfit(t, residual, 1)[0]) if len(t) > 2 else 0.0
    noise = float(np.std(np.diff(residual))) if len(residual) > 2 else 0.0
    step = len(values) // 3
    lag_window = slice(step, min(len(values), step + max(4, int(2 * sample_rate_hz))))
    lag_samples = np.abs(values[lag_window] - reference[lag_window])
    lag = float(np.nanmean(lag_samples)) if np.isfinite(lag_samples).any() else float(np.ptp(reference))
    measured_range = float(np.ptp(values[valid]))
    ideal_range = float(np.ptp(reference))
    return {
        "mean": float(np.mean(values[valid])),
        "std": float(np.std(values[valid])),
        "rms": float(np.sqrt(np.mean(values[valid] ** 2))),
        "range": measured_range,
        "residual_mean": float(np.mean(residual)),
        "residual_rms": float(np.sqrt(np.mean(residual ** 2))),
        "residual_slope_per_second": slope,
        "noise_estimate": noise,
        "dropout_fraction": float(1 - np.mean(valid)),
        "step_lag_error": lag,
        "range_ratio": measured_range / max(ideal_range, 0.01),
    }


MODEL_FEATURES = (
    "residual_mean", "residual_rms", "residual_slope_per_second",
    "noise_estimate", "dropout_fraction", "step_lag_error", "range_ratio",
)


def _vector(features: dict) -> np.ndarray:
    return np.asarray([features[name] for name in MODEL_FEATURES], dtype=float)


def train_sensor_detector(path: Path, seed: int = 47, cases: int = 320) -> dict:
    rows = []
    for i in range(cases):
        rng = np.random.default_rng(seed + i)
        request = SensorRequest(
            true_value=float(rng.uniform(15, 35)),
            step_change=float(rng.uniform(1, 5)),
            noise_rms=float(rng.uniform(0.01, 0.08)),
            response_seconds=float(rng.uniform(0.2, 0.8)),
            seed=seed + i,
        )
        data = simulate_sensor(request)
        rows.append(_vector(sensor_features(data["ideal"], data["measured"], data["sample_rate_hz"])))
    model = IsolationForest(n_estimators=120, contamination=0.05, random_state=seed,
                            n_jobs=2).fit(np.asarray(rows))
    path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "features": MODEL_FEATURES,
                 "data_source": "PYTHON_SIMULATION", "seed": seed,
                 "training_cases": cases}, path)
    return {"artifact": str(path), "seed": seed, "training_cases": cases,
            "model": "IsolationForest", "data_source": "PYTHON_SIMULATION"}


@lru_cache(maxsize=2)
def _load(path: str):
    return joblib.load(path)


def analyze_sensor(request: SensorAnalyzeRequest, model_path: Path) -> dict:
    if not model_path.is_file():
        raise FileNotFoundError("Experimental sensor detector has not been trained")
    features = sensor_features(request.ideal, request.measured, request.sample_rate_hz)
    model = _load(str(model_path.resolve()))["model"]
    score = float(-model.decision_function(_vector(features).reshape(1, -1))[0])
    # IsolationForest.predict repeats decision_function. Its strict negative
    # decision boundary is equivalent to a positive negated score (zero is normal).
    abnormal = score > 0
    pattern_limitation = ""
    if features["dropout_fraction"] > 0.03:
        pattern = "DROPOUT"
    elif features["range_ratio"] < 0.15:
        if float(np.ptp(request.ideal)) > 0.01:
            pattern = "STUCK"
        else:
            pattern = "INSUFFICIENT_EXCITATION"
            pattern_limitation = ("A nearly constant reference and reading cannot distinguish "
                                  "a healthy steady sensor from a stuck sensor. Change the "
                                  "known simulated input and compare its response.")
    elif abs(features["residual_slope_per_second"]) > 0.05:
        pattern = "DRIFT"
    elif abs(features["residual_mean"]) > 0.5:
        pattern = "OFFSET"
    elif features["noise_estimate"] > 0.3:
        pattern = "NOISE"
    elif features["step_lag_error"] > 0.8:
        pattern = "SLOW_RESPONSE"
    else:
        pattern = "NORMAL"
    return {
        "data_source": request.data_source, "model_training_source": "PYTHON_SIMULATION",
        "ai_model": "experimental_isolation_forest",
        "anomaly_score": score, "anomaly_status": "ABNORMAL" if abnormal else "NORMAL",
        "engineering_pattern": pattern, "pattern_source": "DETERMINISTIC_ENGINEERING",
        "pattern_limitation": pattern_limitation,
        "features": features,
    }
