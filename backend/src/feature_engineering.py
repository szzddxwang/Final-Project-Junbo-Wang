"""Convert raw measurements into cross-system engineering features."""

import math

from .system_registry import get_system

EPSILON = 1e-6
COMMON_FEATURES = [
    "supply_ratio",
    "current_ratio",
    "output_error",
    "logic_ratio",
    "adc_error",
    "duty_error",
    "signal_present",
    "continuity_status",
    "polarity_status",
    "configuration_status",
    "communication_status",
    "pullup_status",
    "noise_level",
]
IMPROVED_FEATURES = [
    "supply_signed_error",
    "output_signed_error",
    "current_signed_error",
    "adc_signed_error",
    "logic_margin",
    "baud_relative_error",
    "communication_response",
    "bus_state_health",
    "functional_response_present",
    "interface_health_score",
]
NEXT_ROUND_OBSERVABLE_FEATURES = [
    "output_supply_ratio", "ack_observed", "sda_activity", "scl_activity",
    "tx_observed", "rx_observed", "uart_path_complete", "pwm_observed",
    "i2c_bus_activity", "duty_signed_error",
]


def safe_ratio(measured: float | None, expected: float | None) -> float:
    if measured is None or expected is None:
        return math.nan
    return float(measured) / max(abs(float(expected)), EPSILON)


def relative_error(measured: float | None, expected: float | None) -> float:
    if measured is None or expected is None:
        return math.nan
    return abs(float(measured) - float(expected)) / max(abs(float(expected)), EPSILON)


def signed_error(measured: float | None, expected: float | None) -> float:
    if measured is None or expected is None:
        return math.nan
    return (float(measured) - float(expected)) / max(abs(float(expected)), EPSILON)


def _numeric(values: dict, code: str, fallback=None):
    value = values.get(code, fallback)
    if value is None or isinstance(value, bool):
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _bool(values: dict, code: str) -> float:
    value = values.get(code)
    return float(value) if isinstance(value, bool) else math.nan


def _combined_boolean(values: dict, codes: list[str]) -> float:
    known = [values[code] for code in codes if isinstance(values.get(code), bool)]
    if not known:
        return math.nan
    if False in known:
        return 0.0
    return 1.0 if len(known) == len(codes) else math.nan


def _choice_health(values: dict, codes: list[str]) -> float:
    known = [values.get(code) for code in codes if values.get(code) is not None]
    if not known:
        return math.nan
    if any(value in {"Low", "High"} for value in known):
        return 0.0
    return 1.0 if len(known) == len(codes) and all(value == "Toggling" for value in known) else math.nan


def _known_status_average(values: dict, codes: list[str]) -> float:
    known = [float(values[code]) for code in codes if isinstance(values.get(code), bool)]
    return sum(known) / len(known) if known else math.nan


def extract_features(system_type: str, measurements: dict) -> dict[str, float]:
    system = get_system(system_type)
    expected_supply = _numeric(measurements, "EXPECTED_SUPPLY_VOLTAGE", system["expected_supply"])
    expected_current = _numeric(measurements, "EXPECTED_CURRENT", system["expected_current"])
    expected_output = _numeric(measurements, "EXPECTED_OUTPUT_VOLTAGE", system["expected_output"])
    expected_logic = _numeric(measurements, "EXPECTED_LOGIC_LEVEL", system["expected_supply"])
    communication_codes = [
        code for code in ("ACK_RECEIVED", "TX_SIGNAL_PRESENT", "RX_SIGNAL_PRESENT")
        if code in system["available_measurements"]
    ]
    configuration_codes = [
        code for code in ("CONFIGURATION_OK", "ADDRESS_CORRECT", "BAUD_RATE_CORRECT")
        if code in system["available_measurements"]
    ]
    features = {
        "supply_ratio": safe_ratio(_numeric(measurements, "SUPPLY_VOLTAGE"), expected_supply),
        "current_ratio": safe_ratio(_numeric(measurements, "CURRENT"), expected_current),
        "output_error": relative_error(_numeric(measurements, "OUTPUT_VOLTAGE"), expected_output),
        "logic_ratio": safe_ratio(_numeric(measurements, "LOGIC_LEVEL"), expected_logic),
        "adc_error": relative_error(_numeric(measurements, "ADC_READING"), _numeric(measurements, "EXPECTED_ADC_READING")),
        "duty_error": relative_error(_numeric(measurements, "DUTY_CYCLE"), _numeric(measurements, "EXPECTED_DUTY_CYCLE")),
        "signal_present": _bool(measurements, "SIGNAL_PRESENT") if "SIGNAL_PRESENT" in system["available_measurements"] else _bool(measurements, "PWM_PRESENT"),
        "continuity_status": _bool(measurements, "CONTINUITY"),
        "polarity_status": _bool(measurements, "POLARITY_OK"),
        "configuration_status": _combined_boolean(measurements, configuration_codes),
        "communication_status": _combined_boolean(measurements, communication_codes),
        "pullup_status": _bool(measurements, "PULLUP_PRESENT"),
        "noise_level": _numeric(measurements, "NOISE_LEVEL"),
        "supply_signed_error": signed_error(_numeric(measurements, "SUPPLY_VOLTAGE"), expected_supply),
        "output_signed_error": signed_error(_numeric(measurements, "OUTPUT_VOLTAGE"), expected_output),
        "current_signed_error": signed_error(_numeric(measurements, "CURRENT"), expected_current),
        "adc_signed_error": signed_error(_numeric(measurements, "ADC_READING"), _numeric(measurements, "EXPECTED_ADC_READING")),
        "logic_margin": signed_error(_numeric(measurements, "LOGIC_LEVEL"), expected_logic),
        "baud_relative_error": relative_error(_numeric(measurements, "ACTUAL_BAUD"), _numeric(measurements, "EXPECTED_BAUD")),
        "communication_response": _bool(measurements, "COMMUNICATION_SUCCESS"),
        "bus_state_health": _choice_health(measurements, ["SDA_STATE", "SCL_STATE"]),
        "functional_response_present": _known_status_average(measurements, ["SIGNAL_PRESENT", "PWM_PRESENT", "COMMUNICATION_SUCCESS"]),
        "interface_health_score": _known_status_average(measurements, ["CONTINUITY", "POLARITY_OK", "PULLUP_PRESENT", "CONFIGURATION_OK", "COMMUNICATION_SUCCESS"]),
        # These are directly observable protocol or electrical readings. A missing
        # check stays NaN; it is never interpreted as a negative observation.
        "output_supply_ratio": safe_ratio(_numeric(measurements, "OUTPUT_VOLTAGE"), _numeric(measurements, "SUPPLY_VOLTAGE")),
        "ack_observed": _bool(measurements, "ACK_RECEIVED"),
        "sda_activity": _choice_health(measurements, ["SDA_STATE"]),
        "scl_activity": _choice_health(measurements, ["SCL_STATE"]),
        "tx_observed": _bool(measurements, "TX_SIGNAL_PRESENT"),
        "rx_observed": _bool(measurements, "RX_SIGNAL_PRESENT"),
        "uart_path_complete": _combined_boolean(measurements, ["TX_SIGNAL_PRESENT", "RX_SIGNAL_PRESENT"]),
        "pwm_observed": _bool(measurements, "PWM_PRESENT"),
        "i2c_bus_activity": _choice_health(measurements, ["SDA_STATE", "SCL_STATE"]),
        "duty_signed_error": signed_error(_numeric(measurements, "DUTY_CYCLE"), _numeric(measurements, "EXPECTED_DUTY_CYCLE")),
    }
    return {code: float(value) if value is not None else math.nan for code, value in features.items()}
