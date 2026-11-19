"""Observable-only ADC contract and independent unipolar consistency checks."""

import math

MODE = "adc_raw_v1"
FEATURE_VERSION = "adc-observable-floor-v1"
RAW_CODES = ("OUTPUT_VOLTAGE", "ADC_INPUT_VOLTAGE", "ADC_REFERENCE",
             "ADC_REFERENCE_TARGET", "ADC_RESOLUTION_BITS", "ADC_INTENDED_BITS",
             "ADC_READING", "ADC_NOISE_RMS_MV")
RAW_FEATURES = list(RAW_CODES)
RESIDUAL_FEATURES = ["count_actual_residual", "count_intended_residual",
                     "path_voltage_difference", "resolution_difference",
                     "reference_difference"]
NEXT_FEATURE_VERSION = "adc-observable-floor-v2"
NEXT_PHYSICAL_FEATURES = ["normalized_count_error", "input_ratio",
                          "reference_ratio", "near_saturation", "noise_to_signal_ratio"]
DEFINITIONS = {
    "ADC_INPUT_VOLTAGE": ("Measure the voltage at the ADC input pin.", "V", ["MULTIMETER", "SIMULATION"]),
    "ADC_REFERENCE_TARGET": ("Enter the reference voltage specified by this exercise.", "V", ["VISUAL_SETTINGS", "SIMULATION"]),
    "ADC_RESOLUTION_BITS": ("Read the actual configured ADC resolution in bits.", "bits", ["VISUAL_SETTINGS", "SIMULATION"]),
    "ADC_INTENDED_BITS": ("Enter the ADC resolution specified by this exercise.", "bits", ["VISUAL_SETTINGS", "SIMULATION"]),
    "ADC_NOISE_RMS_MV": ("Measure ADC input AC RMS noise over the stable sample window.", "mV RMS", ["OSCILLOSCOPE", "SIMULATION"]),
}
TOOLS = {**{code: item[2] for code, item in DEFINITIONS.items()},
         "OUTPUT_VOLTAGE": ["MULTIMETER", "SIMULATION"],
         "ADC_REFERENCE": ["MULTIMETER", "SIMULATION"],
         "ADC_READING": ["VISUAL_SETTINGS", "SIMULATION"]}


def definition(code):
    question, unit, tools = DEFINITIONS[code]
    return {"question": question, "input_type": "numeric", "unit": unit,
            "choices": [], "required_tools": tools}


def raw_model_version():
    import json
    from .config import ROOT
    return json.loads((ROOT / "models/next_round/adc_raw_selection.json").read_text(encoding="utf-8"))["model_version"]


def supported_raw_versions():
    import json
    from .config import ROOT
    previous = json.loads((ROOT / "models/current_round/adc_raw_selection.json").read_text(encoding="utf-8"))["model_version"]
    return {raw_model_version(), previous}


def raw_question(code):
    from .system_registry import get_measurement
    return get_measurement(code)["question"]


def expected_count(voltage, reference, bits):
    if not all(math.isfinite(float(x)) for x in (voltage, reference, bits)):
        raise ValueError("ADC inputs must be finite")
    if reference <= 0 or bits != int(bits) or not 1 <= bits <= 16:
        raise ValueError("ADC reference must be positive and resolution must be 1..16 integer bits")
    return min(max(math.floor(voltage / reference * 2 ** int(bits)), 0), 2 ** int(bits) - 1)


def validate_raw(values):
    if set(values) - set(RAW_CODES):
        raise ValueError("Raw ADC accepts observable evidence only; conclusion-style checks are not allowed")
    for code, value in values.items():
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError(f"{code} must be a finite number")
        if code in {"ADC_REFERENCE", "ADC_REFERENCE_TARGET"} and value <= 0:
            raise ValueError(f"{code} must be positive")
        if code in {"ADC_RESOLUTION_BITS", "ADC_INTENDED_BITS"} and (value != int(value) or not 1 <= value <= 16):
            raise ValueError(f"{code} must be an integer from 1 to 16")
        if code == "ADC_READING" and (value != int(value) or not 0 <= value <= 65535):
            raise ValueError("ADC_READING must be an integer count from 0 to 65535")
        if code == "ADC_NOISE_RMS_MV" and value < 0:
            raise ValueError("ADC_NOISE_RMS_MV must be nonnegative")


def feature_values(values, residuals=True):
    result = {code: float(values[code]) if code in values else math.nan for code in RAW_CODES}
    if not residuals:
        return result
    result.update({key: math.nan for key in RESIDUAL_FEATURES})
    for key, bit_code, ref_code in (
        ("count_actual_residual", "ADC_RESOLUTION_BITS", "ADC_REFERENCE"),
        ("count_intended_residual", "ADC_INTENDED_BITS", "ADC_REFERENCE_TARGET"),
    ):
        if {"ADC_INPUT_VOLTAGE", "ADC_READING", bit_code, ref_code} <= set(values):
            expected = expected_count(values["ADC_INPUT_VOLTAGE"], values[ref_code], values[bit_code])
            result[key] = (values["ADC_READING"] - expected) / (2 ** int(values[bit_code]))
    for key, a, b in (("path_voltage_difference", "OUTPUT_VOLTAGE", "ADC_INPUT_VOLTAGE"),
                      ("resolution_difference", "ADC_RESOLUTION_BITS", "ADC_INTENDED_BITS"),
                      ("reference_difference", "ADC_REFERENCE", "ADC_REFERENCE_TARGET")):
        if {a, b} <= set(values):
            result[key] = values[a] - values[b]
    # All ratios use observed values and documented settings. No unknown Vref
    # is replaced with a nominal constant, and the floor/2^N convention above
    # matches the retained Simulink quantizer block.
    result.update({key: math.nan for key in NEXT_PHYSICAL_FEATURES})
    if {"ADC_INPUT_VOLTAGE", "ADC_REFERENCE"} <= set(values) and values["ADC_REFERENCE"] > 0:
        result["input_ratio"] = values["ADC_INPUT_VOLTAGE"] / values["ADC_REFERENCE"]
    if {"ADC_REFERENCE", "ADC_REFERENCE_TARGET"} <= set(values) and values["ADC_REFERENCE_TARGET"] > 0:
        result["reference_ratio"] = values["ADC_REFERENCE"] / values["ADC_REFERENCE_TARGET"]
    if {"ADC_INPUT_VOLTAGE", "ADC_READING", "ADC_REFERENCE", "ADC_RESOLUTION_BITS"} <= set(values):
        expected = expected_count(values["ADC_INPUT_VOLTAGE"], values["ADC_REFERENCE"], values["ADC_RESOLUTION_BITS"])
        count_range = 2 ** int(values["ADC_RESOLUTION_BITS"])
        result["normalized_count_error"] = abs(values["ADC_READING"] - expected) / count_range
        result["near_saturation"] = values["ADC_READING"] / (count_range - 1)
    if {"ADC_NOISE_RMS_MV", "ADC_INPUT_VOLTAGE"} <= set(values):
        result["noise_to_signal_ratio"] = (values["ADC_NOISE_RMS_MV"] / 1000) / max(abs(values["ADC_INPUT_VOLTAGE"]), 0.05)
    return result


def engineering_findings(values):
    findings = []
    if {"ADC_RESOLUTION_BITS", "ADC_INTENDED_BITS"} <= set(values):
        actual, intended = values["ADC_RESOLUTION_BITS"], values["ADC_INTENDED_BITS"]
        if actual != intended:
            findings.append({"rule_id": "ADC_RESOLUTION_MISMATCH", "fault": "ConfigurationFault",
                             "severity": "critical", "message": f"Configured resolution {actual:g} bits differs from the documented {intended:g} bits. This is a calculated specification mismatch, not an independent ML discovery.",
                             "evidence": {"actual_bits": actual, "intended_bits": intended}})
    if {"ADC_REFERENCE", "ADC_REFERENCE_TARGET"} <= set(values):
        if abs(values["ADC_REFERENCE"] - values["ADC_REFERENCE_TARGET"]) > 0.02:
            findings.append({"rule_id": "ADC_REFERENCE_MISMATCH", "fault": "VoltageLevelFault",
                             "severity": "warning", "message": "The measured reference differs from the exercise specification by more than 20 mV.",
                             "evidence": {code: values[code] for code in ("ADC_REFERENCE", "ADC_REFERENCE_TARGET")}})
    return findings


def verify_repair(values):
    """Simulation-only acceptance, fixed before testing; never uses ML or labels."""
    required = set(RAW_CODES) - {"ADC_NOISE_RMS_MV"}
    missing = sorted(required - set(values))
    if missing:
        return {"status": "Inconclusive", "missing": missing, "source": "SIMULATION"}
    validate_raw(values)
    expected = expected_count(values["ADC_INPUT_VOLTAGE"], values["ADC_REFERENCE_TARGET"], values["ADC_INTENDED_BITS"])
    count_error = abs(values["ADC_READING"] - expected)
    metrics = {"count_error": count_error, "count_tolerance": 2,
               "resolution_matches": values["ADC_RESOLUTION_BITS"] == values["ADC_INTENDED_BITS"],
               "reference_error_v": abs(values["ADC_REFERENCE"] - values["ADC_REFERENCE_TARGET"]),
               "path_error_v": abs(values["OUTPUT_VOLTAGE"] - values["ADC_INPUT_VOLTAGE"])}
    passes = (count_error <= 2 and metrics["resolution_matches"]
              and metrics["reference_error_v"] <= 0.02 and metrics["path_error_v"] <= 0.02)
    return {"status": "Verified" if passes else "Still faulty", "source": "SIMULATION", **metrics}
