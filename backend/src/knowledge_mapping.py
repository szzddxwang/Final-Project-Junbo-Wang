"""Suggest foundational concepts; the native app must resolve eligible readings.

These stable codes are not resources, publication claims or diagnostic findings.
Ranking uses only the current request and immutable configuration, never user data
cached across requests. The optional context preserves the two-field API contract.
"""

from collections.abc import Mapping
from math import isfinite

from .config import load_config


MAX_RECOMMENDATIONS = 5
MAX_MODEL_FAULTS = 3
MIN_FAULT_PROBABILITY = 0.10
MIN_RELATIVE_PROBABILITY = 0.25

# Tailor concepts to the electronics without introducing a separate engine or
# inventing topic codes. A UART failure must not send a learner to I2C addressing.
SYSTEM_FAULT_CONCEPTS = {
    "ANALOG_ADC": {
        "ConfigurationFault": ("ADC_CONFIGURATION", "GPIO_CONFIGURATION"),
        "VoltageLevelFault": ("ADC_CONFIGURATION", "SAFE_INPUT_VOLTAGE", "GROUND_REFERENCE", "VOLTAGE_DIVIDER"),
        "SignalIntegrityFault": ("NOISE", "GROUND_REFERENCE", "SIGNAL_INTEGRITY"),
    },
    "DIGITAL_INPUT": {
        "ConfigurationFault": ("GPIO_CONFIGURATION", "PULLUP_RESISTORS"),
        "WiringFault": ("CIRCUIT_CONTINUITY", "PULLUP_RESISTORS", "BASIC_WIRING", "GROUND_REFERENCE"),
        "SignalIntegrityFault": ("PULLUP_RESISTORS", "LOGIC_LEVELS", "NOISE", "GROUNDING"),
    },
    "LED_GPIO": {
        "ConfigurationFault": ("GPIO_CONFIGURATION",),
        "VoltageLevelFault": ("SAFE_INPUT_VOLTAGE", "CURRENT_REQUIREMENTS", "VOLTAGE_DIVIDER"),
    },
    "I2C_SENSOR": {
        "ConfigurationFault": ("COMMUNICATION_CONFIGURATION", "ADDRESSING", "I2C_BASICS"),
        "CommunicationFault": ("I2C_BASICS", "PULLUP_RESISTORS", "ADDRESSING"),
        "SignalIntegrityFault": ("PULLUP_RESISTORS", "SIGNAL_INTEGRITY", "GROUNDING"),
    },
    "UART_DEVICE": {
        "ConfigurationFault": ("COMMUNICATION_CONFIGURATION", "BAUD_RATE", "UART_BASICS"),
        "CommunicationFault": ("UART_BASICS", "BAUD_RATE", "COMMUNICATION_CONFIGURATION"),
        "SignalIntegrityFault": ("SIGNAL_INTEGRITY", "GROUNDING", "NOISE"),
    },
    "PWM_MOTOR_SERVO": {
        "ConfigurationFault": ("GPIO_CONFIGURATION",),
    },
}

MEASUREMENT_CONCEPTS = {
    "SUPPLY_VOLTAGE": ("POWER_SUPPLY_BASICS", "VOLTAGE_REGULATION"),
    "EXPECTED_SUPPLY_VOLTAGE": ("POWER_SUPPLY_BASICS",),
    "CURRENT": ("CURRENT_REQUIREMENTS",),
    "EXPECTED_CURRENT": ("CURRENT_REQUIREMENTS",),
    "CONTINUITY": ("CIRCUIT_CONTINUITY", "BASIC_WIRING"),
    "POLARITY_OK": ("POLARITY", "DIODE_DIRECTION"),
    "LOGIC_LEVEL": ("LOGIC_LEVELS", "SAFE_INPUT_VOLTAGE"),
    "EXPECTED_LOGIC_LEVEL": ("LOGIC_LEVELS",),
    "PULLUP_PRESENT": ("PULLUP_RESISTORS",),
    "ADC_READING": ("ADC_CONFIGURATION", "GROUND_REFERENCE"),
    "EXPECTED_ADC_READING": ("ADC_CONFIGURATION",),
    "ADC_REFERENCE": ("ADC_CONFIGURATION", "GROUND_REFERENCE"),
    "ADC_INPUT_VOLTAGE": ("SAFE_INPUT_VOLTAGE", "GROUND_REFERENCE", "ADC_CONFIGURATION"),
    "ADC_REFERENCE_TARGET": ("ADC_CONFIGURATION", "GROUND_REFERENCE"),
    "ADC_RESOLUTION_BITS": ("ADC_CONFIGURATION",),
    "ADC_INTENDED_BITS": ("ADC_CONFIGURATION",),
    "ADC_NOISE_RMS_MV": ("NOISE", "SIGNAL_INTEGRITY"),
    "SDA_STATE": ("PULLUP_RESISTORS", "I2C_BASICS"),
    "SCL_STATE": ("PULLUP_RESISTORS", "I2C_BASICS"),
    "ACK_RECEIVED": ("I2C_BASICS", "ADDRESSING"),
    "ADDRESS_CORRECT": ("ADDRESSING", "I2C_BASICS"),
    "TX_SIGNAL_PRESENT": ("SIGNAL_PATH", "UART_BASICS"),
    "RX_SIGNAL_PRESENT": ("SIGNAL_PATH", "UART_BASICS"),
    "BAUD_RATE_CORRECT": ("BAUD_RATE", "COMMUNICATION_CONFIGURATION"),
    "ACTUAL_BAUD": ("BAUD_RATE",),
    "EXPECTED_BAUD": ("BAUD_RATE",),
    "PWM_PRESENT": ("GPIO_CONFIGURATION", "SIGNAL_PATH"),
    "DUTY_CYCLE": ("GPIO_CONFIGURATION",),
    "EXPECTED_DUTY_CYCLE": ("GPIO_CONFIGURATION",),
    "NOISE_LEVEL": ("NOISE", "SIGNAL_INTEGRITY"),
}


def _probability(item: dict) -> float:
    value = item.get("probability")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0.0
    return float(value) if isfinite(value) and 0.0 <= value <= 1.0 else 0.0


def recommend_knowledge(
    ranked_faults: list[dict], rule_findings: list[dict], limit: int = 5, *,
    system_type: str | None = None,
    next_measurement: str | Mapping[str, object] | None = None,
) -> list[dict]:
    """Rank a bounded, duplicate-free list of existing foundation topic codes.

    Critical engineering findings take precedence. Otherwise a supported next
    check supplies learning context before up to three plausible model causes.
    The probability cutoffs are explicit relevance heuristics, not calibration
    or a diagnosis-confidence gate. Missing/unknown contexts never invent a topic.
    """
    if limit <= 0:
        return []
    limit = min(limit, MAX_RECOMMENDATIONS)
    knowledge = load_config("knowledge_map")
    system = load_config("systems").get(system_type) if system_type is not None else None
    if system_type is not None and system is None:
        return []
    allowed = set(system["applicable_faults"]) if system else set(knowledge)
    catalogue = {item["knowledge_code"]: item for items in knowledge.values() for item in items}
    specific = SYSTEM_FAULT_CONCEPTS.get(system_type, {})

    def concepts(fault: str) -> tuple[str, ...]:
        if fault not in allowed or fault == "Normal":
            return ()
        return specific.get(fault, tuple(item["knowledge_code"] for item in knowledge.get(fault, ())))

    priority = []
    for finding in rule_findings:
        if finding.get("severity") == "critical":
            priority.extend(concepts(finding.get("fault", "")))

    if isinstance(next_measurement, str):
        next_code = next_measurement
    elif isinstance(next_measurement, Mapping):
        next_code = next_measurement.get("id")
    else:
        next_code = getattr(next_measurement, "id", None)
    available = set(system["available_measurements"]) if system else set()
    if system_type == "ANALOG_ADC":
        # The observable-only ADC mode has documented additional measurements.
        from .adc_evidence import RAW_CODES
        available.update(RAW_CODES)
    if isinstance(next_code, str) and next_code in available:
        if next_code == "CONFIGURATION_OK":
            priority.extend(concepts("ConfigurationFault"))
        elif next_code == "COMMUNICATION_SUCCESS":
            priority.extend(concepts("CommunicationFault"))
        elif next_code in {"OUTPUT_VOLTAGE", "EXPECTED_OUTPUT_VOLTAGE"}:
            priority.extend(concepts("VoltageLevelFault"))
        elif next_code == "SIGNAL_PRESENT":
            priority.extend(("SIGNAL_PATH",))
        else:
            priority.extend(MEASUREMENT_CONCEPTS.get(next_code, ()))

    plausible = sorted(
        ((item.get("fault", ""), _probability(item)) for item in ranked_faults),
        key=lambda item: item[1], reverse=True,
    )
    leading = max((probability for _, probability in plausible), default=0.0)
    threshold = max(MIN_FAULT_PROBABILITY, MIN_RELATIVE_PROBABILITY * leading)
    fault_count = 0
    seen_faults = set()
    for fault, probability in plausible:
        if fault in seen_faults or fault not in allowed or fault == "Normal" or probability < threshold:
            continue
        seen_faults.add(fault)
        priority.extend(concepts(fault))
        fault_count += 1
        if fault_count >= MAX_MODEL_FAULTS:
            break

    output = []
    seen = set()
    for code in priority:
        if code in catalogue and code not in seen:
            output.append({"knowledge_code": code, "name": catalogue[code]["name"]})
            seen.add(code)
            if len(output) >= limit:
                break
    return output
