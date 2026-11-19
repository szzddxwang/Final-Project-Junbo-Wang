"""Peripheral behavior simulations; no MCU CPU or firmware emulation."""

import numpy as np

from ..waveform.generators import i2c_case
from .schemas import GPIORequest, I2CRequest, PWMRequest


def simulate_pwm(request: PWMRequest) -> dict:
    r = request
    period = 1 / r.frequency_hz
    time = np.linspace(0, period * r.periods, r.sample_count, endpoint=False)
    # The sample grid spans an integer number of periods. Integer phase avoids
    # frequency-dependent rounding at rising/falling edges in time % period.
    phase_numerator = (np.arange(r.sample_count) * r.periods) % r.sample_count
    waveform = np.where(phase_numerator < r.duty_cycle * r.sample_count, r.voltage, 0.0)
    return {"data_source": "PYTHON_SIMULATION", "peripheral": "PWM",
            "period_s": period, "high_time_s": r.duty_cycle * period,
            "low_time_s": (1 - r.duty_cycle) * period,
            "average_voltage_v": float(r.voltage * r.duty_cycle),
            "time_s": time.tolist(), "voltage_v": waveform.tolist()}


def simulate_gpio(request: GPIORequest) -> dict:
    r = request
    if r.mode == "OUTPUT":
        state, source = r.output_level, "OUTPUT_DRIVER"
    elif r.external_level != "FLOATING":
        state, source = r.external_level, "EXTERNAL_INPUT"
    elif r.pull != "NONE":
        state, source = ("HIGH" if r.pull == "UP" else "LOW"), "INTERNAL_PULL"
    else:
        state, source = "UNKNOWN", "FLOATING_INPUT"
    return {"data_source": "PYTHON_SIMULATION", "peripheral": "GPIO",
            "simulated_state": state, "state_source": source,
            "expected_state": r.expected_level,
            "matches_expected": state == r.expected_level if state != "UNKNOWN" else None}


def simulate_i2c(request: I2CRequest) -> dict:
    case = i2c_case(request.fault_type, request.group_id, request.seed)
    return {"data_source": "PYTHON_SIMULATION", "peripheral": "I2C",
            "metadata": case.metadata,
            "sda": case.samples[2].tolist(), "scl": case.samples[3].tolist(),
            "ideal_sda": case.samples[0].tolist(), "ideal_scl": case.samples[1].tolist(),
            "engineering_status": request.fault_type}
