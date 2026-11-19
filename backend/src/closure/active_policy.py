"""Cost-aware next checks and expected decision-value research policies."""

import numpy as np

from ..config import load_config
from ..measurement_guidance import (DISABLED_LEARNER_CHECKS, PROTOCOLS,
                                    check_is_executable)
from ..system_registry import get_system
from ..troubleshooting import SKIP_QUESTIONS, _filtered_reference, MeasurementScorer

TOOL_COST = {"VISUAL_SETTINGS": .5, "MULTIMETER": 1.0,
             "LOGIC_ANALYZER": 2.5, "OSCILLOSCOPE": 3.0, "SIMULATION": .5}


def measurement_cost(code: str, available_tools: list[str] | None = None) -> float:
    # The measurement catalog has no required_tools entries. The learner-facing
    # protocols are the actual source for instrument alternatives. An unknown
    # protocol keeps the historical neutral cost instead of inventing a tool.
    load_config("measurements")[code]  # reject unknown measurement codes
    protocol = PROTOCOLS.get(code)
    if protocol is None:
        return 1.0
    required = protocol["tools"]
    choices = required if available_tools is None else [tool for tool in required if tool in available_tools]
    return min((TOOL_COST.get(tool, 1.0) for tool in choices), default=float("inf"))


def expected_error_reduction(reference, code: str, posterior: dict[str, float]) -> float:
    if code not in reference:
        return 0.0
    return MeasurementScorer(reference, posterior).expected_error_reduction(code)


def choose_check(system_type: str, symptom_type: str, known: dict, asked: list[str],
                 posterior: dict[str, float], policy: str,
                 available_tools: list[str] | None = None, *,
                 scorer: MeasurementScorer | None = None) -> str | None:
    if policy not in {"cost_aware_ig", "decision_value"}:
        raise ValueError("Unsupported active policy")
    if scorer is None:
        reference, _ = _filtered_reference(system_type, symptom_type, known)
        scorer = MeasurementScorer(reference, posterior)
    excluded = set(known) | set(asked) | SKIP_QUESTIONS | DISABLED_LEARNER_CHECKS
    candidates = []
    for code in get_system(system_type)["available_measurements"]:
        if code in excluded or not check_is_executable(code, available_tools):
            continue
        cost = measurement_cost(code, available_tools)
        if not np.isfinite(cost):
            continue
        benefit = (scorer.information_gain(code)
                   if policy == "cost_aware_ig" else scorer.expected_error_reduction(code))
        if benefit > 1e-9:
            candidates.append((benefit / cost, -cost, code))
    return max(candidates)[2] if candidates else None
