"""Experimental, observable-evidence engineering experts for six systems.

These are calibrated against the shared model on validation only. They do not
replace the production /diagnose route unless a separate promotion gate passes.
"""

from __future__ import annotations

import math

import numpy as np

from ..config import load_config
from .feature_policy import validate_observable_inputs

EXPERT_REGISTRY = {
    "ANALOG_ADC": {"basis": "ADC count and voltage residuals", "codes": ("ADC_READING", "EXPECTED_ADC_READING", "ADC_REFERENCE", "OUTPUT_VOLTAGE", "EXPECTED_OUTPUT_VOLTAGE")},
    "I2C_SENSOR": {"basis": "ACK, bus state, address and pull-up protocol", "codes": ("ACK_RECEIVED", "ADDRESS_CORRECT", "PULLUP_PRESENT", "SDA_STATE", "SCL_STATE")},
    "UART_DEVICE": {"basis": "baud residual and TX/RX path", "codes": ("ACTUAL_BAUD", "EXPECTED_BAUD", "TX_SIGNAL_PRESENT", "RX_SIGNAL_PRESENT", "COMMUNICATION_SUCCESS")},
    "PWM_MOTOR_SERVO": {"basis": "duty, supply, output and current residuals", "codes": ("DUTY_CYCLE", "EXPECTED_DUTY_CYCLE", "PWM_PRESENT", "CURRENT", "EXPECTED_CURRENT")},
    "DIGITAL_INPUT": {"basis": "VIH/VIL threshold, pull-up and noisy state", "codes": ("LOGIC_LEVEL", "EXPECTED_LOGIC_LEVEL", "PULLUP_PRESENT", "NOISE_LEVEL")},
    "LED_GPIO": {"basis": "GPIO supply/output/current, polarity and continuity", "codes": ("SUPPLY_VOLTAGE", "OUTPUT_VOLTAGE", "CURRENT", "EXPECTED_CURRENT", "POLARITY_OK", "CONTINUITY")},
}


def _ratio(values: dict, actual: str, expected: str) -> float | None:
    if actual not in values or expected not in values:
        return None
    denominator = float(values[expected])
    return float(values[actual]) / denominator if denominator > 0 else None


def expert_probabilities(system_type: str, measurements: dict,
                         classes: list[str]) -> tuple[np.ndarray, list[dict]]:
    validate_observable_inputs(system_type, measurements)
    allowed = load_config("systems")[system_type]["applicable_faults"]
    score = {fault: 1.0 for fault in allowed}
    findings: list[dict] = []

    def add(fault: str, weight: float, code: str, reason: str):
        if fault in score:
            score[fault] += weight
            findings.append({"fault": fault, "evidence": code, "reason": reason,
                             "weight": weight})

    supply = _ratio(measurements, "SUPPLY_VOLTAGE", "EXPECTED_SUPPLY_VOLTAGE")
    if supply is not None and supply < .82:
        add("PowerSupplyFault", 4, "SUPPLY_VOLTAGE", "Supply below configured target")
    if measurements.get("CONTINUITY") is False:
        add("WiringFault", 4, "CONTINUITY", "Open path measured")
    if measurements.get("POLARITY_OK") is False:
        add("PolarityFault", 5, "POLARITY_OK", "Polarity check failed")
    if measurements.get("CONFIGURATION_OK") is False:
        add("ConfigurationFault", 2, "CONFIGURATION_OK", "Configuration check failed")
    noise = measurements.get("NOISE_LEVEL")
    if noise is not None and float(noise) > .35:
        add("SignalIntegrityFault", 3, "NOISE_LEVEL", "Noise exceeds normal operating band")

    if system_type == "ANALOG_ADC":
        count = _ratio(measurements, "ADC_READING", "EXPECTED_ADC_READING")
        output = _ratio(measurements, "OUTPUT_VOLTAGE", "EXPECTED_OUTPUT_VOLTAGE")
        if count is not None and abs(count - 1) > .12:
            add("VoltageLevelFault", 2.5, "ADC_READING", "ADC count differs from configured expectation")
            if output is not None and abs(output - 1) < .10:
                add("ComponentFailure", 1.5, "OUTPUT_VOLTAGE", "Analog output is normal but conversion differs")
        if output is not None and abs(output - 1) > .2:
            add("VoltageLevelFault", 2, "OUTPUT_VOLTAGE", "Analog path voltage differs from expected")
    elif system_type == "I2C_SENSOR":
        if measurements.get("ADDRESS_CORRECT") is False:
            add("ConfigurationFault", 5, "ADDRESS_CORRECT", "Address/configuration mismatch")
        if measurements.get("PULLUP_PRESENT") is False:
            add("WiringFault", 4, "PULLUP_PRESENT", "Bus pull-up unavailable")
        if measurements.get("ACK_RECEIVED") is False:
            add("CommunicationFault", 2.5, "ACK_RECEIVED", "NACK observed")
        for line in ("SDA_STATE", "SCL_STATE"):
            if measurements.get(line) in {"Low", "High"}:
                add("SignalIntegrityFault", 1.5, line, "Bus line not toggling")
        if measurements.get("COMMUNICATION_SUCCESS") is False and measurements.get("ACK_RECEIVED") is True:
            add("ComponentFailure", 1.5, "COMMUNICATION_SUCCESS", "ACK present but application response fails")
    elif system_type == "UART_DEVICE":
        baud = _ratio(measurements, "ACTUAL_BAUD", "EXPECTED_BAUD")
        if baud is not None and abs(baud - 1) > .05:
            add("ConfigurationFault", 5, "ACTUAL_BAUD", "Baud differs from configured value")
        if measurements.get("BAUD_RATE_CORRECT") is False:
            add("ConfigurationFault", 2, "BAUD_RATE_CORRECT", "Baud configuration check failed")
        if measurements.get("TX_SIGNAL_PRESENT") is False or measurements.get("RX_SIGNAL_PRESENT") is False:
            add("WiringFault", 2, "TX_RX", "One UART direction has no observed signal")
        if measurements.get("COMMUNICATION_SUCCESS") is False and measurements.get("TX_SIGNAL_PRESENT") is True and measurements.get("RX_SIGNAL_PRESENT") is True:
            add("CommunicationFault", 3, "COMMUNICATION_SUCCESS", "Both directions active but no valid exchange")
    elif system_type == "PWM_MOTOR_SERVO":
        duty = _ratio(measurements, "DUTY_CYCLE", "EXPECTED_DUTY_CYCLE")
        if duty is not None and abs(duty - 1) > .12:
            add("ConfigurationFault", 3, "DUTY_CYCLE", "PWM duty differs from command")
        if measurements.get("PWM_PRESENT") is False:
            add("WiringFault", 2, "PWM_PRESENT", "PWM edges not observed")
        current = _ratio(measurements, "CURRENT", "EXPECTED_CURRENT")
        if current is not None and (current < .55 or current > 1.5):
            add("ComponentFailure", 2.5, "CURRENT", "Load current differs from expected response")
        output = _ratio(measurements, "OUTPUT_VOLTAGE", "EXPECTED_OUTPUT_VOLTAGE")
        if output is not None and output < .55:
            add("VoltageLevelFault", 2, "OUTPUT_VOLTAGE", "Motor/servo drive voltage is low")
    elif system_type == "DIGITAL_INPUT":
        if "LOGIC_LEVEL" in measurements:
            vdd = float(measurements.get("EXPECTED_LOGIC_LEVEL", measurements.get("EXPECTED_SUPPLY_VOLTAGE", 3.3)))
            vin = float(measurements["LOGIC_LEVEL"])
            if .3 * vdd <= vin <= .7 * vdd:
                add("SignalIntegrityFault", 2.5, "LOGIC_LEVEL", "Input is between VIL and VIH")
            elif vin < .3 * vdd and measurements.get("PULLUP_PRESENT") is True:
                add("VoltageLevelFault", 1.5, "LOGIC_LEVEL", "Low level despite configured pull-up")
        if measurements.get("PULLUP_PRESENT") is False:
            add("ConfigurationFault", 3, "PULLUP_PRESENT", "Input bias resistor absent")
        if measurements.get("SIGNAL_PRESENT") is False:
            add("WiringFault", 1, "SIGNAL_PRESENT", "Input transition absent")
    elif system_type == "LED_GPIO":
        current = _ratio(measurements, "CURRENT", "EXPECTED_CURRENT")
        if current is not None and current < .45 and (supply is None or supply > .85):
            add("ComponentFailure", 2.5, "CURRENT", "Low LED current with adequate supply")
        if current is not None and current > 1.55:
            add("ComponentFailure", 2.5, "CURRENT", "LED current above configured expectation")
        output = _ratio(measurements, "OUTPUT_VOLTAGE", "EXPECTED_OUTPUT_VOLTAGE")
        if output is not None and output < .5 and (supply is None or supply > .85):
            add("VoltageLevelFault", 2, "OUTPUT_VOLTAGE", "GPIO output low with adequate supply")
    if not findings and len(measurements) >= 3:
        add("Normal", 2, "OBSERVED_CHECKS", "No rule violation among available checks")
    vector = np.asarray([score.get(name, 0.0) for name in classes], dtype=float)
    total = vector.sum()
    return (vector / total if total else vector), findings


def blend(shared: np.ndarray, expert: np.ndarray, expert_weight: float) -> np.ndarray:
    if not 0 <= expert_weight <= 1 or not math.isfinite(expert_weight):
        raise ValueError("Expert weight must be finite in [0, 1]")
    combined = (1 - expert_weight) * shared + expert_weight * expert
    return combined / combined.sum()
