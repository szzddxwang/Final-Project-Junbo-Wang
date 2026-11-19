"""Adaptive next-measurement selection using empirical information gain."""

from functools import lru_cache
import math

import numpy as np
import pandas as pd

from .config import ROOT, load_config
from .measurement_guidance import DISABLED_LEARNER_CHECKS, check_is_executable, learner_question
from .guidance_catalog import structured_guidance
from .system_registry import get_system

MIN_REFERENCE_ROWS = 60
MIN_OBSERVED_ROWS = 35
SKIP_QUESTIONS = {"EXPECTED_SUPPLY_VOLTAGE", "EXPECTED_OUTPUT_VOLTAGE",
                  "EXPECTED_CURRENT", "EXPECTED_LOGIC_LEVEL",
                  "EXPECTED_ADC_READING", "EXPECTED_DUTY_CYCLE", "ADC_REFERENCE"}


@lru_cache(maxsize=4)
def reference_cases(model_version: str | None = None) -> pd.DataFrame:
    if model_version is not None:
        from .model_identity import selected_model_config
        config=selected_model_config()
        reference=config.get('measurement_reference')
        if reference and model_version==config.get('model_version'):
            import hashlib
            path=(ROOT/reference['path']).resolve()
            if not path.is_relative_to((ROOT/'models').resolve()):raise ValueError('Invalid versioned measurement-reference path')
            if hashlib.sha256(path.read_bytes()).hexdigest()!=reference['sha256']:raise ValueError('Measurement-reference hash mismatch')
            return pd.read_csv(path,low_memory=False)
    return pd.read_csv(ROOT / "data" / "processed" / "train_cases.csv", low_memory=False)


def entropy(probabilities) -> float:
    values = np.asarray(probabilities, dtype=float)
    values = values[values > 0]
    return float(-(values * np.log2(values)).sum())


def _boolean_value(value):
    text = str(value).lower()
    if text in {"true", "1", "1.0"}:
        return "true"
    if text in {"false", "0", "0.0"}:
        return "false"
    return None


def _filtered_reference(system_type: str, symptom_type: str, known: dict, model_version: str | None = None) -> tuple[pd.DataFrame, str]:
    reference = reference_cases(model_version) if model_version is not None else reference_cases()
    matching = reference[
        (reference["system_type"] == system_type) & (reference["symptom_type"] == symptom_type)
    ]
    detailed = matching
    definitions = load_config("measurements")
    for code, value in known.items():
        if code not in detailed or code in SKIP_QUESTIONS:
            continue
        series = detailed[code]
        kind = definitions[code]["input_type"]
        if kind == "numeric":
            numeric = pd.to_numeric(series, errors="coerce")
            spread = float(numeric.std(skipna=True))
            span = max(spread if math.isfinite(spread) else 0.0, abs(float(value)) * 0.18, 0.05)
            detailed = detailed[(numeric - float(value)).abs() <= span]
        elif kind == "boolean":
            detailed = detailed[series.map(_boolean_value) == str(value).lower()]
        else:
            detailed = detailed[series.astype(str) == str(value)]
        if len(detailed) < MIN_REFERENCE_ROWS:
            break
    if len(detailed) >= MIN_REFERENCE_ROWS:
        return detailed, "system_symptom_evidence"
    if len(matching) >= MIN_REFERENCE_ROWS:
        return matching, "system_symptom"
    system_only = reference[reference["system_type"] == system_type]
    if len(system_only) >= MIN_REFERENCE_ROWS:
        return system_only, "system"
    return reference, "global"


def _buckets(series: pd.Series, kind: str) -> pd.Series:
    if kind == "numeric":
        numeric = pd.to_numeric(series, errors="coerce")
        observed = numeric.dropna()
        if observed.nunique() < 2:
            return pd.Series(index=series.index, dtype="object")
        edges = np.unique(np.quantile(observed, [0, 0.25, 0.5, 0.75, 1]))
        if len(edges) < 2:
            return pd.Series(index=series.index, dtype="object")
        return pd.cut(numeric, bins=edges, include_lowest=True, labels=False, duplicates="drop").map(
            lambda value: f"bin_{int(value)}" if pd.notna(value) else None
        )
    if kind == "boolean":
        return series.map(_boolean_value)
    return series.astype("string").replace("<NA>", pd.NA).astype("object")


class MeasurementScorer:
    """Reuse likelihoods only within one request and one evidence selection.

    No learner measurements or responses enter a process-wide cache. A fresh
    scorer is built after reference filtering, so another request, posterior or
    evidence update cannot reuse stale likelihoods. Reference frames are read-only.
    """

    def __init__(self, reference: pd.DataFrame, posterior: dict[str, float]):
        self.reference = reference
        self.faults = list(posterior)
        self.prior = np.asarray([posterior[fault] for fault in self.faults], dtype=float)
        self.prior /= self.prior.sum()
        self._prior_entropy = entropy(self.prior)
        # Both depend only on this request's already selected reference rows.
        self._fault_codes = pd.Categorical(reference['fault_type'], categories=self.faults).codes
        self._likelihoods = {}

    def likelihood(self, code: str, input_type: str | None = None):
        kind = input_type or load_config("measurements")[code]["input_type"]
        key = (code, kind)
        if key in self._likelihoods:
            return self._likelihoods[key]
        result = None
        if code in self.reference:
            bucket = _buckets(self.reference[code], kind)
            observed = bucket.notna().to_numpy()
            categories = sorted(bucket.iloc[np.flatnonzero(observed)].unique())
            if int(observed.sum()) >= MIN_OBSERVED_ROWS and len(categories) >= 2:
                # One contingency table replaces one DataFrame scan per fault.
                # Keep the original bucket ordering, absent-fault smoothing and
                # observation threshold (including rows outside the posterior).
                fault_codes = self._fault_codes
                bucket_codes = pd.Categorical(bucket, categories=categories).codes
                eligible = observed & (fault_codes >= 0)
                indices = (fault_codes[eligible].astype(np.int64) * len(categories)
                           + bucket_codes[eligible])
                counts = np.bincount(indices, minlength=len(self.faults) * len(categories))
                counts = counts.reshape(len(self.faults), len(categories)).astype(float)
                result = (counts + 1.0) / (counts.sum(axis=1, keepdims=True) + len(categories))
                result.setflags(write=False)
        self._likelihoods[key] = result
        return result

    def information_gain(self, code: str, input_type: str | None = None) -> float:
        likelihood = self.likelihood(code, input_type)
        if likelihood is None:
            return 0.0
        expected_entropy = 0.0
        for column in range(likelihood.shape[1]):
            joint = self.prior * likelihood[:, column]
            bucket_probability = joint.sum()
            if bucket_probability > 0:
                expected_entropy += bucket_probability * entropy(joint / bucket_probability)
        return max(0.0, self._prior_entropy - expected_entropy)

    def expected_error_reduction(self, code: str) -> float:
        likelihood = self.likelihood(code)
        if likelihood is None:
            return 0.0
        current_error = 1 - float(self.prior.max())
        after_error = 0.0
        for column in range(likelihood.shape[1]):
            joint = self.prior * likelihood[:, column]
            mass = joint.sum()
            if mass:
                after_error += mass * (1 - float((joint / mass).max()))
        return max(0.0, current_error - after_error)


def information_gain(reference: pd.DataFrame, measurement_code: str,
                     posterior: dict[str, float], input_type: str | None = None) -> float:
    return MeasurementScorer(reference, posterior).information_gain(measurement_code, input_type)


def select_next_measurement(system_type: str, symptom_type: str, known: dict,
                            asked_measurements: list[str], posterior: dict[str, float],
                            available_tools: list[str] | None = None,model_version: str | None = None) -> dict | None:
    system = get_system(system_type)
    reference, scope = _filtered_reference(system_type, symptom_type, known,model_version) if model_version is not None else _filtered_reference(system_type,symptom_type,known)
    scorer = MeasurementScorer(reference, posterior)
    definitions = load_config("measurements")
    excluded = set(known) | set(asked_measurements) | SKIP_QUESTIONS | DISABLED_LEARNER_CHECKS
    i2c_no_reply = system_type == "I2C_SENSOR" and (
        known.get("ACK_RECEIVED") is False
        or ("ACK_RECEIVED" not in known and symptom_type == "DEVICE_NOT_DETECTED")
    )
    prerequisite_order = {"ADDRESS_CORRECT": 3, "CONTINUITY": 2, "PULLUP_PRESENT": 1} if i2c_no_reply else {}
    candidates = []
    for code in system["available_measurements"]:
        if code in excluded or not check_is_executable(code, available_tools, system_type=system_type):
            continue
        score = scorer.information_gain(code)
        if model_version and any(version in model_version for version in ('reliability-v5', 'reliability-v7', 'reliability-v8', 'reliability-v9', 'reliability-v10')):
            # Relative effort units, stated explicitly; not claimed wall-clock time.
            effort=2. if code=='CONTINUITY' else 2.5 if code in {'DUTY_CYCLE','ACTUAL_BAUD','LOGIC_LEVEL','TX_SIGNAL_PRESENT','RX_SIGNAL_PRESENT'} else 1.5 if definitions[code]['input_type']=='numeric' else 1.
            score=(score+.5*scorer.expected_error_reduction(code))/effort
        if score > 1e-6:
            candidates.append((prerequisite_order.get(code, 0), score, code))
    if not candidates:
        return None
    _, _, code = max(candidates)
    definition = definitions[code]
    return {
        "id": code,
        "question": learner_question(system_type, code),
        "type": definition["input_type"],
        "unit": definition["unit"],
        "information_gain": round(float(scorer.information_gain(code)), 6),
        "guidance": structured_guidance(system_type, code, available_tools),
    }
