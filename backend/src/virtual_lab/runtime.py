"""Best-effort experimental model preload before accepting FastAPI requests."""

from __future__ import annotations

from time import perf_counter

from ..config import ROOT
from ..waveform.inference import _load as load_waveform, _ood_load
from .sensor import _load as load_sensor

STATUS: dict = {"state": "not_started", "loaded": {}, "errors": {},
                "warmup_ms": {}, "duration_s": None}


def preload_models() -> dict:
    start = perf_counter()
    loaded, errors, warmup_ms = {}, {}, {}
    experimental = ROOT / "models" / "experimental"
    paths = {
        "waveform_adc": (load_waveform, experimental / "waveform" / "adc" / "cnn.pt"),
        "waveform_i2c": (load_waveform, experimental / "waveform" / "i2c" / "cnn.pt"),
        "sensor_anomaly": (load_sensor, experimental / "sensor_isolation.joblib"),
        "adc_ood": (_ood_load, experimental / "waveform" / "adc"),
    }
    for name, (loader, path) in paths.items():
        try:
            if not path.exists():
                raise FileNotFoundError(str(path))
            model_or_artifact = loader(str(path.resolve()))
            if name.startswith("waveform_") or name == "adc_ood":
                import torch
                model = model_or_artifact[0]
                channels = 3 if name == "waveform_adc" else 4
                if name == "adc_ood":
                    channels = 3
                started = perf_counter()
                with torch.no_grad():
                    model(torch.zeros(1, channels, 256))
                warmup_ms[name] = round((perf_counter() - started) * 1000, 3)
            loaded[name] = True
        except Exception as exc:  # Stable /diagnose must remain available.
            loaded[name] = False
            errors[name] = f"{type(exc).__name__}: {exc}"
    STATUS.update(state="ready" if not errors else "degraded", loaded=loaded,
                  errors=errors, warmup_ms=warmup_ms,
                  duration_s=round(perf_counter() - start, 3))
    from ..midterm.inference import status as midterm_status
    try:
        STATUS['midterm'] = midterm_status()
    except Exception as exc:
        STATUS['midterm'] = {'available': False, 'reason': str(exc)}
    return dict(STATUS)
