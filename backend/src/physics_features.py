"""Observable ADC physics features shared by experimental analysis.

Missing observations remain None. Count convention is floor(Vin/Vref * 2**N)
clipped to the N-bit range, matching the retained ADC evidence contract.
"""

from .adc_evidence import expected_count, validate_raw


def adc_physics(values: dict) -> dict:
    validate_raw(values)
    result = {
        "expected_count_actual": None,
        "expected_count_intended": None,
        "count_actual_residual": None,
        "count_intended_residual": None,
        "path_voltage_difference": None,
        "resolution_difference": None,
        "reference_difference": None,
        "quantization_step_v": None,
        "saturation_indicator": None,
        "intended_saturation_indicator": None,
    }
    keys = set(values)
    for suffix, bits, ref in (("actual", "ADC_RESOLUTION_BITS", "ADC_REFERENCE"),
                              ("intended", "ADC_INTENDED_BITS", "ADC_REFERENCE_TARGET")):
        if {"ADC_INPUT_VOLTAGE", bits, ref} <= keys:
            expected = expected_count(values["ADC_INPUT_VOLTAGE"], values[ref], values[bits])
            result[f"expected_count_{suffix}"] = expected
            if "ADC_READING" in keys:
                result[f"count_{suffix}_residual"] = values["ADC_READING"] - expected
    if {"OUTPUT_VOLTAGE", "ADC_INPUT_VOLTAGE"} <= keys:
        result["path_voltage_difference"] = values["OUTPUT_VOLTAGE"] - values["ADC_INPUT_VOLTAGE"]
    if {"ADC_RESOLUTION_BITS", "ADC_INTENDED_BITS"} <= keys:
        result["resolution_difference"] = values["ADC_RESOLUTION_BITS"] - values["ADC_INTENDED_BITS"]
    if {"ADC_REFERENCE", "ADC_REFERENCE_TARGET"} <= keys:
        result["reference_difference"] = values["ADC_REFERENCE"] - values["ADC_REFERENCE_TARGET"]
    if {"ADC_REFERENCE", "ADC_RESOLUTION_BITS"} <= keys:
        result["quantization_step_v"] = values["ADC_REFERENCE"] / (1 << int(values["ADC_RESOLUTION_BITS"]))
    if {"ADC_READING", "ADC_RESOLUTION_BITS"} <= keys:
        maximum = (1 << int(values["ADC_RESOLUTION_BITS"])) - 1
        result["saturation_indicator"] = values["ADC_READING"] in (0, maximum)
    if {"ADC_READING", "ADC_INTENDED_BITS"} <= keys:
        maximum = (1 << int(values["ADC_INTENDED_BITS"])) - 1
        result["intended_saturation_indicator"] = values["ADC_READING"] in (0, maximum)
    return result
