"""ADC signal features used by the Lab and waveform inference."""


import numpy as np


def structured_features(samples: np.ndarray) -> np.ndarray:
    """Observable summary statistics from commanded, pin, and decoded signals."""
    x = np.asarray(samples, dtype=float)
    commanded, pin, decoded = x * 3.3
    delta = pin - commanded
    centered = pin - pin.mean()
    psd = abs(np.fft.rfft(centered)) ** 2
    return np.asarray([
        np.mean(commanded), np.std(commanded), np.ptp(commanded),
        np.mean(pin), np.std(pin), np.ptp(pin),
        np.mean(delta), np.std(delta), np.sqrt(np.mean(delta ** 2)),
        np.mean(decoded - pin), np.std(decoded - pin),
        np.mean(np.isclose(decoded, decoded.max(), atol=.002)),
        np.mean(pin >= 3.3), np.mean(pin <= 0),
        np.ptp(decoded) / max(np.ptp(commanded), .01),
        float(np.argmax(psd[1:]) + 1) if len(psd) > 1 else 0,
    ], dtype=float)


PHYSICS_NAMES = (
    "count_intended_residual", "path_voltage_difference",
    "intended_saturation_indicator",
)
