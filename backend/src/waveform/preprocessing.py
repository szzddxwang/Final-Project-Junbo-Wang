"""Fixed physical scaling and shape normalization for waveform inference."""

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class PreprocessingConfig:
    version: str = "waveform-fixed-scale-v1"
    output_length: int = 256
    adc_voltage_scale: float = 3.3


def prepare(samples: np.ndarray, system_type: str,
            config: PreprocessingConfig = PreprocessingConfig()) -> np.ndarray:
    x = np.asarray(samples, dtype=np.float32)
    if x.ndim != 2 or not 1 <= x.shape[0] <= 8 or x.shape[1] < 16:
        raise ValueError("Waveform must have 1..8 channels and at least 16 samples")
    if not np.isfinite(x).all():
        raise ValueError("Waveform contains NaN or infinity")
    if not 32 <= config.output_length <= 4096:
        raise ValueError("Invalid output length")
    if x.shape[1] != config.output_length:
        source = np.linspace(0, 1, x.shape[1])
        target = np.linspace(0, 1, config.output_length)
        x = np.stack([np.interp(target, source, channel) for channel in x]).astype(np.float32)
    if system_type == "ANALOG_ADC":
        x = x / config.adc_voltage_scale
    elif system_type != "I2C_SENSOR":
        raise ValueError(f"Unknown waveform system: {system_type}")
    return x
