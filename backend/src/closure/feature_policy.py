"""Allow only learner-observable inputs and derivatives for diagnostic models."""

from ..config import load_config
from ..feature_engineering import (COMMON_FEATURES, IMPROVED_FEATURES,
                                   NEXT_ROUND_OBSERVABLE_FEATURES)

DERIVED_FEATURES = frozenset(COMMON_FEATURES + IMPROVED_FEATURES + NEXT_ROUND_OBSERVABLE_FEATURES)
MODEL_CONTEXT = frozenset({"system_type", "symptom_type"})
SUSPICIOUS_TOKENS = ("fault_type", "fault_mode", "scenario", "injection", "ground_truth",
                     "class_name", "label", "generator_branch", "fault_severity",
                     "case_id", "group_id", "simulated_pullup", "simulated_capacitance")


def allowed_measurements(system_type: str) -> frozenset[str]:
    return frozenset(load_config("systems")[system_type]["available_measurements"])


def validate_observable_inputs(system_type: str, measurements: dict) -> None:
    allowed = allowed_measurements(system_type)
    for name in measurements:
        lower = name.lower()
        if any(token in lower for token in SUSPICIOUS_TOKENS) or name not in allowed:
            raise ValueError(f"Non-observable diagnostic input: {name}")


def validate_model_features(columns) -> None:
    allowed = DERIVED_FEATURES | MODEL_CONTEXT
    for name in columns:
        lower = str(name).lower()
        if any(token in lower for token in SUSPICIOUS_TOKENS) or name not in allowed:
            raise ValueError(f"Non-observable model feature: {name}")
