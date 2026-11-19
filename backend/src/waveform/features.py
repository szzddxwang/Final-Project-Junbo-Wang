"""Signal-specific interpretable waveform statistics."""

import numpy as np


def signal_features(samples, sampling_rate: float, signal_type: str, *, _spectral_power=None) -> dict[str, float]:
    x = np.asarray(samples, dtype=float)
    if x.ndim != 1 or len(x) < 16 or len(x) > 65536 or not np.isfinite(x).all():
        raise ValueError("Expected 16..65536 finite waveform samples")
    if not np.isfinite(sampling_rate) or sampling_rate <= 0:
        raise ValueError("sampling_rate must be positive")
    result = {
        "mean": float(np.mean(x)),
        "rms": float(np.sqrt(np.mean(x * x))),
        "peak_to_peak": float(np.ptp(x)),
        "std": float(np.std(x)),
    }
    if signal_type in {"ADC", "SENSOR"}:
        window = max(3, min(31, len(x) // 12))
        smooth = np.convolve(x, np.ones(window) / window, mode="same")
        result["noise_rms"] = float(np.sqrt(np.mean((x[window:-window] - smooth[window:-window]) ** 2)))
    if signal_type == "ADC":
        power = _spectral_power
        if power is None:
            power = np.abs(np.fft.rfft(x - x.mean())) ** 2
        if power.size > 1:
            peak = int(np.argmax(power[1:]) + 1)
            result["dominant_frequency_hz"] = float(peak * sampling_rate / len(x))
    elif signal_type == "I2C":
        low, high = float(np.quantile(x, 0.1)), float(np.quantile(x, 0.9))
        result["logic_high_fraction"] = float(np.mean(x > (low + high) / 2))
        rising = np.where((x[:-1] < 0.1) & (x[1:] >= 0.9))[0]
        result["direct_rising_edges"] = float(len(rising))
    elif signal_type != "SENSOR":
        raise ValueError("Unknown signal type")
    return result
