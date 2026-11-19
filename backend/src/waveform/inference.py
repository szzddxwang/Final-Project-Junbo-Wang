"""Cached experimental waveform CNN inference, with explicit unavailable state."""

from functools import lru_cache
from pathlib import Path
import json

import joblib
import numpy as np
from scipy.special import softmax

from .preprocessing import PreprocessingConfig, prepare
from .training import make_model


@lru_cache(maxsize=2)
def _load(path: str):
    import torch
    torch.set_num_threads(2)
    package = torch.load(path, map_location="cpu", weights_only=True)
    model = make_model(package["channels"], len(package["classes"]))
    model.load_state_dict(package["state_dict"])
    model.eval()
    return model, package


@lru_cache(maxsize=1)
def _ood_load(model_dir: str):
    import torch
    root = Path(model_dir)
    package = torch.load(root / "ood" / "ood_cnn.pt", map_location="cpu", weights_only=True)
    model = make_model(package["channels"], len(package["classes"]))
    model.load_state_dict(package["state_dict"])
    model.eval()
    detector = joblib.load(root / "ood" / "ood_detector.joblib")
    return model, detector


def predict(samples, system_type: str, model_path: Path, research_root: Path | None = None) -> dict:
    if not model_path.is_file():
        raise FileNotFoundError("Experimental waveform CNN has not been trained")
    import torch
    model, package = _load(str(model_path.resolve()))
    if package["system_type"] != system_type:
        raise ValueError("Waveform model system mismatch")
    x = prepare(np.asarray(samples), system_type, PreprocessingConfig())
    if x.shape[0] != package["channels"]:
        raise ValueError("Waveform channel count mismatch")
    with torch.no_grad():
        logits, embedding = model(torch.from_numpy(x[None]), return_embedding=True)
        probabilities = torch.softmax(logits, dim=1).numpy()[0]
    result = {
        "predicted_pattern": package["classes"][int(np.argmax(probabilities))],
        "probabilities": {name: float(p) for name, p in zip(package["classes"], probabilities)},
        "raw_probability": float(np.max(probabilities)),
        "model_type": "experimental_1d_cnn", "model_training_source": "PYTHON_SIMULATION",
    }
    if system_type == "ANALOG_ADC" and research_root is not None:
        calibration_path = Path(__file__).resolve().parents[2] / "config" / "waveform_temperature.json"
        ood_dir = model_path.parent / "ood"
        if calibration_path.is_file():
            temperature = json.loads(calibration_path.read_text(encoding="utf-8"))["temperature"]
            calibrated = softmax(logits.numpy()[0] / temperature)
            result["calibrated_probabilities"] = {
                name: float(value) for name, value in zip(package["classes"], calibrated)}
            result["calibrated_probability"] = float(np.max(calibrated))
            result["uncertainty_score"] = float(1 - np.max(calibrated))
            result["calibration_scope"] = "grouped_same_generator_simulation"
            result["calibration_validated_under_shift"] = False
        if (ood_dir / "ood_detector.joblib").is_file():
            ood_model, detector = _ood_load(str(model_path.parent.resolve()))
            with torch.no_grad():
                _, ood_embedding = ood_model(torch.from_numpy(x[None]), return_embedding=True)
            delta = ood_embedding.numpy()[0][None, :] - detector["means"]
            distances = np.einsum("cd,df,cf->c", delta, detector["precision"], delta)
            score = float(np.min(distances))
            result["ood_score"] = score
            result["ood_threshold"] = float(detector["threshold"])
            result["ood_status"] = "UNKNOWN / OUT_OF_DISTRIBUTION" if score > detector["threshold"] else "KNOWN"
    return result
