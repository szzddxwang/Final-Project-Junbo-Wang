"""One request and response contract for every supported system."""

import math
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .system_registry import get_measurement, get_system, validate_measurements, validate_symptom
from .measurement_guidance import TOOL_LABELS
from .model_identity import stable_model_version, supported_stable_versions
from .paired_evidence.runtime import EvidencePacket
from .reliable_diagnosis.contract import EvidenceV2


ToolCode = Literal["VISUAL_SETTINGS", "MULTIMETER", "LOGIC_ANALYZER", "OSCILLOSCOPE", "SIMULATION"]


class AvailableToolInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: ToolCode


class UnavailableCheckInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str
    reason: Literal["UNKNOWN", "UNAVAILABLE", "SKIPPED"]


class DiagnosisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    system_type: str
    symptom_type: str
    measurements: dict[str, Any] | list["DiagnosisMeasurementInput"] = Field(default_factory=dict)
    step_number: int = Field(default=0, ge=0)
    asked_measurements: list[str] = Field(default_factory=list)
    user_stop: bool = False
    unavailable_checks: list[UnavailableCheckInput] = Field(default_factory=list)
    available_tools: list[ToolCode | AvailableToolInput] | None = None
    tools_configured: bool | None = None
    diagnostic_mode: Literal["stable", "adc_raw_v1"] = "stable"
    model_version: str | None = None
    paired_evidence: EvidenceV2 | EvidencePacket | None = None

    @model_validator(mode="after")
    def validate_engineering_input(self):
        system = get_system(self.system_type)
        if self.paired_evidence is not None:
            if self.diagnostic_mode != 'stable' or self.paired_evidence.system != self.system_type:
                raise ValueError('Two-acquisition evidence must match the stable diagnostic system')
        validate_symptom(self.system_type, self.symptom_type)
        if isinstance(self.measurements, list):
            values = {}
            for item in self.measurements:
                if item.code in values:
                    raise ValueError(f"Duplicate measurement: {item.code}")
                values[item.code] = item.value
            self.measurements = values
        if self.paired_evidence is not None and self.measurements != self.paired_evidence.measurements:
            raise ValueError('Initial readings must match the supplied acquisition evidence')
        available = set(system["available_measurements"])
        if self.diagnostic_mode == "adc_raw_v1":
            from .adc_evidence import RAW_CODES, validate_raw
            if self.system_type != "ANALOG_ADC":
                raise ValueError("The experimental raw-evidence mode supports ADC only")
            available = set(RAW_CODES)
            validate_raw(self.measurements)
        else:
            validate_measurements(self.system_type, self.measurements)
        for code, value in self.measurements.items():
            if isinstance(value, (int, float)) and not isinstance(value, bool) and not math.isfinite(value):
                raise ValueError(f"{code} must be finite")
        for code in self.asked_measurements:
            if code not in available:
                raise ValueError(f"Unknown asked measurement: {code}")
            get_measurement(code)
        excluded = set()
        for item in self.unavailable_checks:
            if item.code not in available:
                raise ValueError(f"Unknown unavailable check: {item.code}")
            if item.code in excluded or item.code in self.measurements:
                raise ValueError(f"Conflicting or duplicate unavailable check: {item.code}")
            excluded.add(item.code)
        if self.tools_configured is False:
            if self.available_tools:
                raise ValueError("Available tools require explicit tool configuration")
            self.available_tools = None
        elif self.tools_configured is True and self.available_tools is None:
            self.available_tools = []
        if self.available_tools is not None:
            self.available_tools = [item.code if isinstance(item, AvailableToolInput) else item
                                    for item in self.available_tools]
            if len(set(self.available_tools)) != len(self.available_tools):
                raise ValueError("Duplicate available tool")
            assert set(self.available_tools) <= set(TOOL_LABELS)
        if self.model_version is not None:
            if self.diagnostic_mode == "adc_raw_v1":
                from .adc_evidence import raw_model_version, supported_raw_versions
                try:
                    allowed_versions = supported_raw_versions()
                except FileNotFoundError as exc:
                    raise ValueError("The experimental ADC artifact is not ready") from exc
            else:
                allowed_versions = supported_stable_versions()
            if self.model_version not in allowed_versions:
                raise ValueError("The pinned diagnostic model version is not available")
        return self


class DiagnosisMeasurementInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    numeric_value: float | None = None
    boolean_value: bool | None = None
    choice_value: str | None = None
    has_numeric_value: bool | None = None
    has_boolean_value: bool | None = None
    has_choice_value: bool | None = None

    @model_validator(mode="after")
    def validate_one_value(self):
        flags = (self.has_numeric_value, self.has_boolean_value, self.has_choice_value)
        values = (self.numeric_value, self.boolean_value, self.choice_value)
        if any(flag is not None for flag in flags):
            if sum(flag is True for flag in flags) != 1:
                raise ValueError("Exactly one measurement presence flag is required")
            selected = flags.index(True)
            if values[selected] is None:
                raise ValueError("Selected measurement value is missing")
        elif sum(value is not None for value in values) != 1:
            raise ValueError("Exactly one measurement value is required")
        return self

    @property
    def value(self):
        flags = (self.has_numeric_value, self.has_boolean_value, self.has_choice_value)
        if any(flag is not None for flag in flags):
            return (self.numeric_value, self.boolean_value, self.choice_value)[flags.index(True)]
        for value in (self.numeric_value, self.boolean_value, self.choice_value):
            if value is not None:
                return value


class RuleFinding(BaseModel):
    rule_id: str
    fault: str
    severity: Literal["info", "warning", "critical"]
    message: str
    evidence: dict[str, Any]


class FaultProbability(BaseModel):
    fault: str
    probability: float = Field(ge=0, le=1)


class MeasurementGuidance(BaseModel):
    title: str | None = None
    summary: str | None = None
    quantity: str | None = None
    measurement_point: str | None = None
    reference_point: str | None = None
    recommended_tools: list[str] | None = None
    why: str | None = None
    steps: list[str] | None = None
    formula_latex: list[str] | None = None
    formula_plain: list[str] | None = None
    formula_caption: str | None = None
    formula_note: str | None = None
    safety_note: str | None = None
    input_prompt: str | None = None
    input_hint: str | None = None


class MeasurementQuestion(BaseModel):
    id: str
    question: str
    type: Literal["numeric", "boolean", "choice"]
    unit: str | None = None
    information_gain: float = Field(ge=0)
    guidance: MeasurementGuidance | None = None


class KnowledgeRecommendation(BaseModel):
    knowledge_code: str
    name: str


class DiagnosisResponse(BaseModel):
    system_type: str
    rule_findings: list[RuleFinding]
    diagnosis: list[FaultProbability]
    confidence: float = Field(ge=0, le=1)
    diagnosis_complete: bool
    stop_reason: Literal[
        "HIGH_CONFIDENCE", "DETERMINISTIC_FINDING", "NO_MORE_MEASUREMENTS",
        "MAX_STEPS", "USER_STOP",
    ] | None
    next_measurement: MeasurementQuestion | None
    recommended_knowledge: list[KnowledgeRecommendation]
    evidence_assessment: dict[str, Any] | None = None
