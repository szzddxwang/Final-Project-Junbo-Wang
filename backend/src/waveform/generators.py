"""Reproducible circuit-inspired ADC and I2C waveform generators."""

from dataclasses import dataclass
from typing import Any

import numpy as np

from . import GENERATION_VERSION

ADC_FAULTS = (
    "NORMAL", "HIGH_NOISE", "CLIPPING", "SATURATION", "GAIN_ERROR",
    "OFFSET_ERROR", "REFERENCE_MISMATCH", "RESOLUTION_MISMATCH",
    "SIGNAL_ATTENUATION",
)
I2C_FAULTS = (
    "NORMAL", "MISSING_ACK", "SDA_STUCK_LOW", "SCL_STUCK_LOW",
    "SLOW_RISE", "HIGH_NOISE", "CLOCK_ABNORMALITY",
)


@dataclass(frozen=True)
class WaveformCase:
    samples: np.ndarray  # channels x time; physical units are in metadata
    metadata: dict[str, Any]


def _identity(system: str, fault: str, group: int, seed: int, signal: str,
              sample_rate: float, length: int, severity: float) -> dict[str, Any]:
    return {
        "case_id": f"{system.lower()}-{group:05d}-{fault.lower()}",
        "group_id": f"{system.lower()}-{group:05d}",
        "system_type": system,
        "fault_type": fault,
        "signal_name": signal,
        "sampling_rate": sample_rate,
        "signal_length": length,
        "fault_severity": severity,
        "seed": seed,
        "data_source": "PYTHON_SIMULATION",
        "simulation_source": "src.waveform.generators",
        "generation_version": GENERATION_VERSION,
    }


def adc_case(fault: str, group_id: int, seed: int = 47,
             length: int = 256) -> WaveformCase:
    """Simulate commanded voltage, pin voltage and ADC reconstruction.

    The count convention is floor(Vin/Vref * 2**bits), clipped to 0..2**bits-1.
    All variants of a group share one operating point; splitting by group is mandatory.
    """
    if fault not in ADC_FAULTS:
        raise ValueError(f"Unknown ADC fault: {fault}")
    if not 64 <= length <= 4096:
        raise ValueError("ADC length must be 64..4096")
    base = np.random.default_rng(seed + group_id * 9973)
    rng = np.random.default_rng(seed + group_id * 9973 + ADC_FAULTS.index(fault) * 31)
    fs = 1024.0
    freq = float(base.uniform(8, 24))
    center = float(base.uniform(1.45, 1.8))
    amplitude = float(base.uniform(0.55, 0.85))
    phase = float(base.uniform(0, 2 * np.pi))
    commanded = center + amplitude * np.sin(2 * np.pi * freq * np.arange(length) / fs + phase)
    intended_ref, intended_bits = 3.3, 12
    actual_ref, actual_bits = intended_ref, intended_bits
    pin = commanded.copy()
    noise_rms = 0.003
    severity = 0.0 if fault == "NORMAL" else float(base.uniform(0.7, 1.0))
    if fault == "HIGH_NOISE":
        noise_rms = 0.11 * severity
    elif fault == "CLIPPING":
        pin = np.clip(pin, center - 0.35, center + 0.35)
    elif fault == "SATURATION":
        pin = pin + 2.0 * severity
    elif fault == "GAIN_ERROR":
        pin = pin * (1 - 0.34 * severity)
    elif fault == "OFFSET_ERROR":
        pin = pin + 0.45 * severity
    elif fault == "REFERENCE_MISMATCH":
        actual_ref = intended_ref - 0.65 * severity
    elif fault == "RESOLUTION_MISMATCH":
        actual_bits = 10
    elif fault == "SIGNAL_ATTENUATION":
        pin = center + (pin - center) * (1 - 0.62 * severity)
    pin = pin + rng.normal(0, noise_rms, length)
    maximum = (1 << actual_bits) - 1
    counts = np.clip(np.floor(pin / actual_ref * (1 << actual_bits)), 0, maximum)
    reconstructed = counts * intended_ref / (1 << intended_bits)
    samples = np.stack((commanded, pin, reconstructed)).astype(np.float32)
    meta = _identity("ANALOG_ADC", fault, group_id, seed, "ADC input and count",
                     fs, length, severity)
    meta.update({
        "channel_names": ["commanded_v", "pin_v", "adc_reconstructed_v"],
        "channel_units": ["V", "V", "V"],
        "operating_point": {"center_v": center, "amplitude_v": amplitude,
                            "frequency_hz": freq, "vref_target_v": intended_ref,
                            "resolution_target_bits": intended_bits},
        "vref_actual_v": actual_ref, "resolution_actual_bits": actual_bits,
        "noise_rms_v": noise_rms,
    })
    return WaveformCase(samples, meta)


def _rc_rise(values: np.ndarray, alpha: float) -> np.ndarray:
    result = values.copy()
    for i in range(1, len(values)):
        result[i] = result[i - 1] + (alpha if values[i] > result[i - 1] else 1.0) * (values[i] - result[i - 1])
    return result


def i2c_case(fault: str, group_id: int, seed: int = 47,
             samples_per_bit: int = 16) -> WaveformCase:
    """Model START, address, ACK, data, ACK and STOP with separate SDA/SCL."""
    if fault not in I2C_FAULTS:
        raise ValueError(f"Unknown I2C fault: {fault}")
    if not 8 <= samples_per_bit <= 64 or samples_per_bit % 2:
        raise ValueError("samples_per_bit must be an even integer 8..64")
    base = np.random.default_rng(seed + group_id * 9973)
    rng = np.random.default_rng(seed + group_id * 9973 + I2C_FAULTS.index(fault) * 31)
    address = int(base.integers(0x20, 0x70))
    data = int(base.integers(0, 256))
    bits = [int(x) for x in f"{address << 1:08b}"] + [0] + [int(x) for x in f"{data:08b}"] + [0]
    half = samples_per_bit // 2
    ideal_sda = [1.0] * samples_per_bit + [0.0] * half
    ideal_scl = [1.0] * samples_per_bit + [1.0] * half
    for i, bit in enumerate(bits):
        ideal_sda.extend([float(bit)] * samples_per_bit)
        ideal_scl.extend([0.0] * half + [1.0] * half)
    ideal_sda.extend([0.0] * half + [1.0] * samples_per_bit)
    ideal_scl.extend([1.0] * (half + samples_per_bit))
    sda, scl = np.asarray(ideal_sda), np.asarray(ideal_scl)
    observed_sda, observed_scl = sda.copy(), scl.copy()
    if fault == "MISSING_ACK":
        # The expected bus retains ACK-low; only the observed trace is NACK.
        # Changing both channels would put the fault label in the reference.
        preamble = samples_per_bit + half
        for bit_index in (8, 17):
            start = preamble + bit_index * samples_per_bit
            observed_sda[start:start + samples_per_bit] = 1.0
    severity = 0.0 if fault == "NORMAL" else float(base.uniform(0.7, 1.0))
    frequency = float(base.uniform(80_000, 120_000))
    if fault == "SDA_STUCK_LOW":
        observed_sda[:] = 0
    elif fault == "SCL_STUCK_LOW":
        observed_scl[:] = 0
    elif fault == "SLOW_RISE":
        observed_sda = _rc_rise(observed_sda, 0.11)
        observed_scl = _rc_rise(observed_scl, 0.11)
    elif fault == "CLOCK_ABNORMALITY":
        # A prolonged low clock interval is a bus timing fault, not random bits.
        start = samples_per_bit * 5
        observed_scl[start:start + 3 * samples_per_bit] = 0
    noise = 0.16 * severity if fault == "HIGH_NOISE" else 0.005
    observed_sda = np.clip(observed_sda + rng.normal(0, noise, len(sda)), 0, 1)
    observed_scl = np.clip(observed_scl + rng.normal(0, noise, len(scl)), 0, 1)
    samples = np.stack((sda, scl, observed_sda, observed_scl)).astype(np.float32)
    meta = _identity("I2C_SENSOR", fault, group_id, seed, "I2C SDA/SCL",
                     frequency * samples_per_bit, len(sda), severity)
    meta.update({
        "channel_names": ["ideal_sda", "ideal_scl", "observed_sda", "observed_scl"],
        "channel_units": ["logic", "logic", "logic", "logic"],
        "operating_point": {"address_7bit": address, "data_byte": data,
                            "clock_frequency_hz": frequency, "samples_per_bit": samples_per_bit},
        "ack_expected": True, "ack_observed": fault != "MISSING_ACK",
        "noise_rms_logic": noise,
    })
    return WaveformCase(samples, meta)
