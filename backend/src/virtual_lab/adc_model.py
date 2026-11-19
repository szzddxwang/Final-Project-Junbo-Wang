"""Virtual ADC forward and inverse models using one count convention."""

import math

import numpy as np

from ..adc_evidence import expected_count
from .schemas import ADCModelRequest, ADCEstimateRequest


def simulate_adc(request: ADCModelRequest) -> dict:
    r = request
    count = r.sample_count
    times = np.arange(count, dtype=float) / r.sample_rate_hz
    commanded = np.full(count, r.input_voltage, dtype=float)
    if r.signal_type == "SINE":
        commanded += r.amplitude_voltage * np.sin(2 * np.pi * r.frequency_hz * times)
    rng = np.random.default_rng(r.seed)
    pin = r.gain * commanded + r.offset_voltage + rng.normal(0, r.noise_rms_voltage, count)
    codes = np.clip(np.floor(pin / r.reference_voltage * (1 << r.resolution_bits)),
                    0, (1 << r.resolution_bits) - 1).astype(int)
    reconstruction = codes * r.target_reference_voltage / (1 << r.target_resolution_bits)
    expected = expected_count(r.input_voltage, r.target_reference_voltage,
                              r.target_resolution_bits)
    observed = int(codes[0])
    delta = observed - expected
    saturated = bool(np.any((pin >= r.reference_voltage) | (pin <= 0)))
    findings = []
    if abs(r.reference_voltage - r.target_reference_voltage) > 0.02:
        findings.append("REFERENCE_MISMATCH")
    if r.resolution_bits != r.target_resolution_bits:
        findings.append("RESOLUTION_MISMATCH")
    if r.noise_rms_voltage > 0.04:
        findings.append("HIGH_NOISE")
    if abs(r.gain - 1) > 0.03:
        findings.append("GAIN_ERROR")
    if abs(r.offset_voltage) > 0.03:
        findings.append("OFFSET_ERROR")
    if saturated:
        findings.append("SATURATION")
    status = findings[0] if findings else "NORMAL"
    evidence = {
        "OUTPUT_VOLTAGE": float(commanded[0]),
        "ADC_INPUT_VOLTAGE": float(pin[0]),
        "ADC_REFERENCE": float(r.reference_voltage),
        "ADC_REFERENCE_TARGET": float(r.target_reference_voltage),
        "ADC_RESOLUTION_BITS": r.resolution_bits,
        "ADC_INTENDED_BITS": r.target_resolution_bits,
        "ADC_READING": observed,
        "ADC_NOISE_RMS_MV": float(r.noise_rms_voltage * 1000),
    }
    return {
        "data_source": "PYTHON_SIMULATION", "analysis_source": "DETERMINISTIC_PHYSICS",
        "expected_count": expected, "simulated_count": observed,
        "count_residual": delta,
        "quantization_step_v": float(r.reference_voltage / (1 << r.resolution_bits)),
        "saturation": saturated,
        "reference_difference_v": float(r.reference_voltage - r.target_reference_voltage),
        "resolution_difference_bits": r.resolution_bits - r.target_resolution_bits,
        "model_status": status, "engineering_findings": findings,
        "chart": {"time_s": times.tolist(), "commanded_v": commanded.tolist(),
                  "pin_v": pin.tolist(), "adc_reconstructed_v": reconstruction.tolist(),
                  "adc_counts": codes.tolist()},
        "diagnosis_evidence": {"system_type": "ANALOG_ADC", "diagnostic_mode": "adc_raw_v1",
                               "evidence_source": "SIMULATION", "measurements": evidence},
    }


def estimate_reference(request: ADCEstimateRequest) -> dict:
    r = request
    maximum = (1 << r.resolution_bits) - 1
    if r.observed_count in (0, maximum):
        return {"status": "UNIDENTIFIABLE_AT_BOUNDARY", "estimate_v": None,
                "method": "quantization_interval", "data_source": "PYTHON_SIMULATION",
                "assumptions": "Use the voltage at the ADC pin for the same sample as the count; boundary counts do not bound Vref."}
    numerator = r.input_voltage * (1 << r.resolution_bits)
    lower = numerator / (r.observed_count + 1)
    upper = numerator / r.observed_count
    return {"status": "BOUNDED", "estimate_v": float((lower + upper) / 2),
            "interval_v": [float(lower), float(upper)],
            "method": "deterministic_quantization_inverse",
            "data_source": "PYTHON_SIMULATION",
            "assumptions": "Input voltage is the same-sample ADC pin voltage, not the commanded signal; count uses floor and no additional count error."}


def compare_adc(before: ADCModelRequest, after: ADCModelRequest) -> dict:
    first, second = simulate_adc(before), simulate_adc(after)
    return {"data_source": "PYTHON_SIMULATION", "model_type": "REFERENCE_VS_FAULT",
            "before": {k: first[k] for k in ("expected_count", "simulated_count", "count_residual", "model_status")},
            "after": {k: second[k] for k in ("expected_count", "simulated_count", "count_residual", "model_status")},
            "absolute_residual_improvement": abs(first["count_residual"]) - abs(second["count_residual"])}
