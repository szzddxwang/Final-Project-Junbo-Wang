"""Bounded, finite FastAPI contracts for the virtual electronics lab."""

import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, model_validator
from ..schemas import DiagnosisRequest


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ADCModelRequest(StrictModel):
    input_voltage: FiniteFloat = Field(default=1.65, ge=-5, le=10)
    reference_voltage: FiniteFloat = Field(default=3.3, gt=0, le=10)
    target_reference_voltage: FiniteFloat = Field(default=3.3, gt=0, le=10)
    resolution_bits: int = Field(default=12, ge=1, le=16)
    target_resolution_bits: int = Field(default=12, ge=1, le=16)
    gain: FiniteFloat = Field(default=1.0, ge=0, le=3)
    offset_voltage: FiniteFloat = Field(default=0.0, ge=-5, le=5)
    noise_rms_voltage: FiniteFloat = Field(default=0.003, ge=0, le=1)
    signal_type: Literal["CONSTANT", "SINE"] = "SINE"
    amplitude_voltage: FiniteFloat = Field(default=0.5, ge=0, le=5)
    frequency_hz: FiniteFloat = Field(default=12, ge=0, le=100_000)
    sample_rate_hz: FiniteFloat = Field(default=1024, gt=0, le=1_000_000)
    sample_count: int = Field(default=256, ge=16, le=2048)
    seed: int = Field(default=47, ge=0, le=2**31 - 1)

    @model_validator(mode="after")
    def valid_sampling(self):
        if not math.isfinite(self.sample_count / self.sample_rate_hz):
            raise ValueError("ADC capture duration must remain finite at the selected sampling rate")
        if self.signal_type == "SINE" and self.frequency_hz >= self.sample_rate_hz / 2:
            raise ValueError("Frequency must be below Nyquist")
        return self


class ADCEstimateRequest(StrictModel):
    input_voltage: FiniteFloat = Field(gt=0, le=10)
    observed_count: int = Field(ge=0, le=65535)
    resolution_bits: int = Field(ge=1, le=16)

    @model_validator(mode="after")
    def count_within_bits(self):
        if self.observed_count >= 2 ** self.resolution_bits:
            raise ValueError("Observed count exceeds configured resolution")
        return self


class SensorRequest(StrictModel):
    true_value: FiniteFloat = Field(default=25, ge=-1000, le=1000)
    step_change: FiniteFloat = Field(default=2, ge=-100, le=100)
    sample_rate_hz: FiniteFloat = Field(default=10, gt=0, le=500)
    duration_seconds: FiniteFloat = Field(default=20, gt=0, le=120)
    noise_rms: FiniteFloat = Field(default=0.05, ge=0, le=100)
    offset: FiniteFloat = Field(default=0, ge=-100, le=100)
    drift_per_second: FiniteFloat = Field(default=0, ge=-10, le=10)
    response_seconds: FiniteFloat = Field(default=0.5, ge=0, le=120)
    fault_type: Literal["NORMAL", "NOISE", "DRIFT", "OFFSET", "STUCK",
                        "DROPOUT", "SLOW_RESPONSE"] = "NORMAL"
    seed: int = Field(default=47, ge=0, le=2**31 - 1)

    @model_validator(mode="after")
    def bounded_samples(self):
        count = round(self.sample_rate_hz * self.duration_seconds)
        if not 32 <= count <= 4096:
            raise ValueError("Sensor simulation requires 32..4096 samples")
        return self


class SensorAnalyzeRequest(StrictModel):
    ideal: list[FiniteFloat] = Field(min_length=32, max_length=4096)
    measured: list[FiniteFloat | None] = Field(min_length=32, max_length=4096)
    sample_rate_hz: FiniteFloat = Field(gt=0, le=500)
    data_source: Literal["PYTHON_SIMULATION", "MATLAB_SIMULINK", "USER_PROVIDED"] = "USER_PROVIDED"

    @model_validator(mode="after")
    def same_length(self):
        if len(self.ideal) != len(self.measured):
            raise ValueError("Ideal and measured lengths differ")
        return self


class WaveformAnalyzeRequest(StrictModel):
    system_type: Literal["ANALOG_ADC", "I2C_SENSOR", "SENSOR"]
    samples: list[list[FiniteFloat]] = Field(min_length=2, max_length=4)
    sampling_rate_hz: FiniteFloat = Field(gt=0, le=100_000_000)
    data_source: Literal["PYTHON_SIMULATION", "MATLAB_SIMULINK", "USER_PROVIDED"] = "USER_PROVIDED"

    @model_validator(mode="after")
    def shape(self):
        lengths = {len(channel) for channel in self.samples}
        expected = {"ANALOG_ADC": 3, "I2C_SENSOR": 4, "SENSOR": 2}[self.system_type]
        if len(self.samples) != expected or len(lengths) != 1 or not 64 <= next(iter(lengths)) <= 4096:
            raise ValueError(f"Expected {expected} equal-length channels of 64..4096 samples")
        return self


class GeneratedWaveformRequest(StrictModel):
    source: Literal["ANALOG_ADC", "SENSOR", "I2C_SENSOR"] = "ANALOG_ADC"


class PWMRequest(StrictModel):
    frequency_hz: FiniteFloat = Field(default=1000, gt=0, le=1_000_000)
    duty_cycle: FiniteFloat = Field(default=0.5, ge=0, le=1)
    voltage: FiniteFloat = Field(default=3.3, ge=0, le=24)
    sample_count: int = Field(default=256, ge=32, le=2048)
    periods: int = Field(default=4, ge=1, le=16)

    @model_validator(mode="after")
    def finite_duration(self):
        if not math.isfinite(self.periods / self.frequency_hz):
            raise ValueError("PWM capture duration must remain finite at the selected frequency")
        return self


class GPIORequest(StrictModel):
    mode: Literal["INPUT", "OUTPUT"] = "INPUT"
    external_level: Literal["LOW", "HIGH", "FLOATING"] = "FLOATING"
    output_level: Literal["LOW", "HIGH"] = "LOW"
    pull: Literal["NONE", "UP", "DOWN"] = "UP"
    expected_level: Literal["LOW", "HIGH"] = "HIGH"


class I2CRequest(StrictModel):
    fault_type: Literal["NORMAL", "MISSING_ACK", "SDA_STUCK_LOW", "SCL_STUCK_LOW",
                        "SLOW_RISE", "HIGH_NOISE", "CLOCK_ABNORMALITY"] = "NORMAL"
    group_id: int = Field(default=0, ge=0, le=1_000_000)
    seed: int = Field(default=47, ge=0, le=2**31 - 1)


class CounterfactualRequest(StrictModel):
    before: ADCModelRequest
    after: ADCModelRequest


class MultimodalRequest(StrictModel):
    diagnosis: DiagnosisRequest | None = None
    diagnosis_source: Literal['USER_PROVIDED', 'SIMULATION', 'UNSPECIFIED'] = 'UNSPECIFIED'
    waveform: WaveformAnalyzeRequest | None = None
    adc_observations: dict[str, FiniteFloat] | None = Field(default=None, max_length=32)

    @model_validator(mode="after")
    def at_least_one_modality(self):
        if self.diagnosis and self.waveform and self.diagnosis.system_type != self.waveform.system_type:
            raise ValueError("Structured and waveform evidence must describe the same system")
        if self.diagnosis is None and self.waveform is None and self.adc_observations is None:
            raise ValueError("Provide at least one evidence modality")
        if self.adc_observations is not None and self.diagnosis is not None and self.diagnosis.system_type != "ANALOG_ADC":
            raise ValueError("ADC physics evidence requires ANALOG_ADC")
        if self.adc_observations is not None and any(len(name) > 64 for name in self.adc_observations):
            raise ValueError("ADC observation names must be at most 64 characters")
        return self
