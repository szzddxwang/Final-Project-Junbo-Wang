"""Deterministic engineering checks kept separate from ML probabilities."""

from .system_registry import get_system


def check_rules(system_type: str, measurements: dict) -> list[dict]:
    system = get_system(system_type)
    findings = []

    def add(rule_id, fault, severity, message, evidence):
        findings.append({
            "rule_id": rule_id, "fault": fault, "severity": severity,
            "message": message, "evidence": evidence,
        })

    supply = measurements.get("SUPPLY_VOLTAGE")
    expected = measurements.get("EXPECTED_SUPPLY_VOLTAGE", system["expected_supply"])
    if isinstance(supply, (int, float)) and not isinstance(supply, bool) and isinstance(expected, (int, float)) and expected > 0:
        if supply > expected * 1.25:
            add("SUPPLY_OVERVOLTAGE", "VoltageLevelFault", "critical",
                "Supply voltage is substantially above the expected value; disconnect and verify ratings.",
                {"measured": supply, "expected": expected})
        elif supply < expected * 0.55:
            add("SEVERE_UNDERVOLTAGE", "PowerSupplyFault", "critical",
                "Supply voltage is severely below the expected value.",
                {"measured": supply, "expected": expected})
        elif supply < expected * 0.8:
            add("UNDERVOLTAGE", "PowerSupplyFault", "warning",
                "Supply voltage is below the expected range.",
                {"measured": supply, "expected": expected})
    if measurements.get("CONTINUITY") is False:
        add("OPEN_PATH", "WiringFault", "critical",
            "Continuity check indicates an open path.", {"CONTINUITY": False})
    if measurements.get("POLARITY_OK") is False:
        add("REVERSED_POLARITY", "PolarityFault", "critical",
            "Polarity check indicates a reversed connection.", {"POLARITY_OK": False})
    logic = measurements.get("LOGIC_LEVEL")
    expected_logic = measurements.get("EXPECTED_LOGIC_LEVEL", system["expected_supply"])
    if isinstance(logic, (int, float)) and isinstance(expected_logic, (int, float)) and expected_logic > 0 and logic > expected_logic * 1.25:
        add("LOGIC_LEVEL_MISMATCH", "VoltageLevelFault", "critical",
            "Measured logic high is above the expected interface level.",
            {"measured": logic, "expected": expected_logic})
    if system_type == "I2C_SENSOR" and measurements.get("PULLUP_PRESENT") is False:
        add("I2C_PULLUP_MISSING", "CommunicationFault", "warning",
            "The I2C bus requires a suitable pull-up.", {"PULLUP_PRESENT": False})
    if measurements.get("ACK_RECEIVED") is False:
        add("I2C_NO_ACK", "CommunicationFault", "warning",
            "The I2C device did not acknowledge the address.", {"ACK_RECEIVED": False})
    if measurements.get("BAUD_RATE_CORRECT") is False:
        add("UART_BAUD_MISMATCH", "ConfigurationFault", "warning",
            "UART baud rates appear inconsistent.", {"BAUD_RATE_CORRECT": False})
    if measurements.get("CONFIGURATION_OK") is False:
        add("CONFIGURATION_CHECK", "ConfigurationFault", "warning",
            "A required configuration setting is incorrect.", {"CONFIGURATION_OK": False})
    return findings
