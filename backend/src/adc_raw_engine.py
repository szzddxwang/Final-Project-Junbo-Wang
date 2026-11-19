"""Experimental ADC-only inference from observations and training-only selection."""

from functools import lru_cache

import joblib
import pandas as pd

from .adc_evidence import RAW_CODES, TOOLS, engineering_findings, feature_values
from .config import ROOT
from .knowledge_mapping import recommend_knowledge
from .guidance_catalog import structured_guidance
from .preprocessing import model_frame
from .schemas import DiagnosisResponse
from .troubleshooting import information_gain


@lru_cache(maxsize=2)
def raw_artifact(model_version=None):
    from .adc_evidence import raw_model_version
    path = (ROOT / "models/next_round/adc_raw_candidate.joblib"
            if model_version is None or model_version == raw_model_version()
            else ROOT / "models/current_round/adc_raw_candidate.joblib")
    return joblib.load(path)


@lru_cache(maxsize=2)
def raw_reference(model_version=None):
    from .adc_evidence import raw_model_version
    path = (ROOT / "results/next_round/adc_selector_train_reference.csv"
            if model_version is None or model_version == raw_model_version()
            else ROOT / "results/current_round/adc_selector_train_reference.csv")
    return pd.read_csv(path)


def next_check(request, posterior):
    from .system_registry import get_measurement
    excluded = set(request.measurements) | set(request.asked_measurements) | {item.code for item in request.unavailable_checks}
    tools = None if request.available_tools is None else set(request.available_tools)
    candidates = []
    for code in RAW_CODES:
        if code in excluded or (tools is not None and not tools.intersection(TOOLS[code])):
            continue
        gain = information_gain(raw_reference(request.model_version), code, posterior, input_type="numeric")
        candidates.append((gain, code))
    if not candidates:
        return None
    # Constant specification fields have no empirical gain but are prerequisites
    # for a valid physical comparison; do not silently fill them with defaults.
    score, code = max(candidates)
    if score <= 1e-6:
        prerequisites = {"ADC_REFERENCE_TARGET", "ADC_INTENDED_BITS", "ADC_INPUT_VOLTAGE", "ADC_REFERENCE", "ADC_RESOLUTION_BITS", "ADC_READING"}
        required = [item for item in candidates if item[1] in prerequisites]
        if not required:
            return None
        score, code = required[0]
    item = get_measurement(code)
    return {"id": code, "question": item["question"], "type": "numeric",
            "unit": item["unit"], "information_gain": round(float(score), 6),
            "guidance": structured_guidance(request.system_type, code, request.available_tools)}


def diagnose_raw(request):
    artifact = raw_artifact(request.model_version)
    features = feature_values(request.measurements)
    probabilities = artifact["pipeline"].predict_proba(model_frame(pd.DataFrame([features]), artifact["feature_columns"]))[0]
    classes = artifact["encoder"].inverse_transform(range(len(probabilities)))
    ranked = sorted([{"fault": str(label), "probability": float(p)} for label, p in zip(classes, probabilities)],
                    key=lambda item: item["probability"], reverse=True)
    findings = engineering_findings(request.measurements)
    stop = None
    if request.user_stop:
        stop = "USER_STOP"
    elif any(item["severity"] == "critical" for item in findings):
        stop = "DETERMINISTIC_FINDING"
    elif len(request.measurements) >= 7 and ranked[0]["probability"] >= 0.93:
        stop = "HIGH_CONFIDENCE"
    elif request.step_number >= 10:
        stop = "MAX_STEPS"
    question = None
    if stop is None:
        question = next_check(request, {item["fault"]: item["probability"] for item in ranked})
        if question is None:
            stop = "NO_MORE_MEASUREMENTS"
    return DiagnosisResponse(system_type=request.system_type, rule_findings=findings, diagnosis=ranked,
                             confidence=ranked[0]["probability"],
                             diagnosis_complete=stop in {"DETERMINISTIC_FINDING", "HIGH_CONFIDENCE", "USER_STOP"},
                             stop_reason=stop, next_measurement=question,
                             recommended_knowledge=recommend_knowledge(
                                 ranked, findings, system_type=request.system_type,
                                 next_measurement=question))
