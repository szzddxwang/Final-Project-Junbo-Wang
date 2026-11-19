"""Combine independent rule findings, ML ranking, and adaptive questioning."""

from functools import lru_cache
import hashlib
from io import BytesIO
import json

import joblib
import pandas as pd

from .config import ROOT
from .feature_engineering import extract_features
from .knowledge_mapping import recommend_knowledge
from .model_identity import stable_artifact_path, stable_model_version, selected_model_config
from .preprocessing import model_frame
from .rule_engine import check_rules
from .schemas import DiagnosisRequest, DiagnosisResponse
from .system_registry import get_system
from .troubleshooting import select_next_measurement

DEFAULT_CONFIDENCE_THRESHOLD = 0.93
DEFAULT_MAX_STEPS = 6


@lru_cache(maxsize=4)
def selected_artifact(model_version: str | None = None) -> dict:
    path = stable_artifact_path(model_version)
    # Hash exactly the bytes that are deserialized, once per supported version.
    # Configuration changes require a controlled restart, never a hot reload.
    data = path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    version = model_version or stable_model_version()
    if not version.endswith(digest[:12]):
        raise ValueError("Loaded diagnostic artifact does not match its version")
    artifact = joblib.load(BytesIO(data))
    artifact['_loaded_identity'] = {
        'model_version': version, 'artifact_sha256': digest,
        'artifact': path.relative_to(ROOT).as_posix(),
    }
    return artifact


def _inference_frame(features: dict, columns: list[str]) -> pd.DataFrame:
    """Construct one already numeric, extracted observation without coercion scans.

    Raw inputs still pass request validation and extract_features. Training and
    arbitrary tabular inputs retain the general missing-aware model_frame path.
    """
    return pd.DataFrame([[features.get(code, float('nan')) for code in columns]],
                        columns=columns)


@lru_cache(maxsize=1)
def loaded_model_status() -> dict:
    """Readiness means successful normalized inference for every supported system."""
    import math
    from .config import load_config
    artifact = selected_artifact()
    checked = []
    for system, config in load_config('systems').items():
        ranked = predict_probabilities(system, config['supported_symptoms'][0], {})
        values = [item['probability'] for item in ranked]
        if not values or not all(math.isfinite(v) and 0 <= v <= 1 for v in values) or not math.isclose(sum(values), 1, abs_tol=1e-6):
            raise RuntimeError('Diagnostic model smoke inference failed')
        checked.append(system)
    paired=artifact.get('paired_model')
    reliability=artifact.get('reliability_model')
    if paired is not None:
        if set(paired['models'])!=set(load_config('systems')) or any(m.num_features()!=383 for m in paired['models'].values()):
            raise RuntimeError('Incomplete or incompatible two-acquisition model')
    if reliability is not None:
        from .reliable_diagnosis.features import NAMES
        if set(reliability['models'])!=set(load_config('systems')) or list(reliability['feature_names'])!=list(NAMES):
            raise RuntimeError('Incompatible measured-evidence feature schema')
    selective = artifact.get('selective_model')
    if selective is not None:
        from .selective_diagnosis.features import VERSION
        if reliability is None or selective['input_features'] != 562 or not set(selective['models']).issubset(set(checked)):
            raise RuntimeError('Incompatible selective evidence feature schema')
        for policy in selective['models'].values():
            model = policy['model']
            count = model.num_features() if policy['kind'] == 'xgb' else model.n_features_in_
            if count != 562 or not 0 <= policy['expand_threshold'] <= policy['retain_threshold'] <= 1:
                raise RuntimeError('Invalid selective model or decision thresholds')
    composition = artifact.get('composition_model')
    if composition is not None:
        from .selective_diagnosis.composition import VERSION as COMPOSITION_VERSION, INDEX as COMPOSITION_INDEX
        if selective is None or composition['input_features'] != 602 or composition['feature_version'] != COMPOSITION_VERSION or not set(composition['models']).issubset(set(checked)):
            raise RuntimeError('Incompatible composition evidence feature schema')
        policies=[]
        for policy in composition['models'].values():
            if not set(policy.get('load_policies',{})).issubset({'dc_motor','servo','stepper'}):
                raise RuntimeError('Invalid composition load policy')
            policies.extend([policy,*policy.get('load_policies',{}).values()])
        for policy in policies:
            required=policy.get('promotion_required_channels',())
            if not isinstance(required,(list,tuple)) or any(not isinstance(k,str) or k+':count' not in COMPOSITION_INDEX for k in required):
                raise RuntimeError('Invalid required observed configuration channels')
            for head in (policy, policy['mixed']) + ((policy['promotion_error_model'],) if policy.get('promotion_error_model') else ()):
                if head['kind'] == 'incumbent':
                    continue
                count = head['model'].num_features() if head['kind'] == 'xgb' else head['model'].n_features_in_
                if count != 602:
                    raise RuntimeError('Invalid composition model features')
            if not (0 <= policy['expand_threshold'] <= policy['retain_threshold'] <= 1 and 0 <= policy['mixed_threshold'] <= 1 and 0 <= policy.get('rescue_risk_ceiling',1) <= 1 and 0 <= policy.get('promotion_error_threshold',1) <= 1):
                raise RuntimeError('Invalid composition decision thresholds')
    upgraded=artifact.get('diagnostic_upgrade')
    if upgraded is not None:
        if set(upgraded.get('systems',{}))!=set(checked) or upgraded.get('input_features')!=677:
            raise RuntimeError('Incomplete upgraded root model or observation schema')
        for system,head in upgraded['systems'].items():
            root=head['root'];model=root['model'];count=model.num_features()if root['kind']=='xgboost'else model.n_features_in_
            if count!=677 or root['system']!=system or root['classes']!=reliability['classes']:
                raise RuntimeError('Invalid upgraded root classifier')
            for name in ('risk','mixed'):
                m=head[name];count=m['model'].num_features()if m['kind']=='xgb'else m['model'].n_features_in_
                if count!=686:raise RuntimeError('Invalid upgraded uncertainty model')
            for m in head.get('causes',{}).values():
                if m['model'].num_features()!=677:raise RuntimeError('Invalid cause-presence model')
            if not(0<=head['expand_threshold']<=head['retain_threshold']<=1 and 0<=head['normal_risk_threshold']<=1 and 0<=head['mixed_threshold']<=1):raise RuntimeError('Invalid upgraded decision policy')
            if not math.isfinite(head.get('repeat_guard_z',0))or head.get('repeat_guard_z',0)<0:raise RuntimeError('Invalid repeat-consistency guard')
            if not 0<=head.get('normal_promotion_risk_max',1)<=1:raise RuntimeError('Invalid Normal promotion threshold')
            if not set(head.get('load_policies',{})).issubset({'dc_motor','servo','stepper'}):raise RuntimeError('Invalid upgraded load policy')
            for policy in [head,*head.get('load_policies',{}).values()]:
                if not(0<=policy['min_probability']<=1 and 0<=policy['mixed_threshold']<=1):raise RuntimeError('Invalid load-specific thresholds')
                for label,limits in policy.get('class_thresholds',{}).items():
                    if label not in reliability['classes']or not(0<=limits['retain']<=1 and 0<=limits['expand']<=1):raise RuntimeError('Invalid class-specific decision costs')
                    if any(not 0<=limits.get(key,policy['mixed_threshold'])<=1 for key in ('mixed_retain','mixed_expand')):raise RuntimeError('Invalid class-specific mixed-risk threshold')
    return {**artifact['_loaded_identity'],
            'feature_version': selected_model_config().get('feature_version'),
            'loaded': True, 'inference_smoke_systems': checked,
            'reload_policy': 'controlled_service_restart',
            'runtime_uses_previous_models': artifact.get('runtime_uses_old_models', True),
            'two_acquisition_supported_systems': sorted(reliability['models']) if reliability else sorted(paired['models']) if paired else [],
            'two_acquisition_feature_count': len(reliability['feature_names']) if reliability else 383 if paired else None,
            'acceptance_feature_version': VERSION if selective is not None else None,
            'acceptance_feature_count': selective['input_features'] if selective is not None else None,
            'upgraded_acceptance_systems': sorted(selective['models']) if selective is not None else [],
            'normal_confirmation_guard': bool(selective and selective.get('preserve_reviewed_normal')),
            'root_classifiers_unchanged_from_v5': selective is not None and upgraded is None,
            'upgraded_root_systems': sorted(upgraded['systems'])if upgraded else [],
            'corrective_retest_supported': upgraded is not None,
            'acceptance_reference_model': upgraded.get('acceptance_reference_model')if upgraded else None,
            'composition_feature_count': composition['input_features'] if composition is not None else None,
            'composition_upgraded_systems': sorted(composition['models']) if composition is not None else []}


def predict_probabilities(system_type: str, symptom_type: str, measurements: dict,
                          model_version: str | None = None) -> list[dict]:
    artifact = selected_artifact(model_version)
    features = extract_features(system_type, measurements)
    features["symptom_type"] = symptom_type
    features["system_type"] = system_type
    probability = artifact["pipeline"].predict_proba(
        _inference_frame(features, artifact["feature_columns"])
    )[0]
    classes = artifact["encoder"].inverse_transform(range(len(probability)))
    allowed = set(get_system(system_type)["applicable_faults"])
    ranked = [
        {"fault": str(fault), "probability": float(value)}
        for fault, value in zip(classes, probability) if fault in allowed
    ]
    total = sum(item["probability"] for item in ranked)
    if total <= 0:
        raise RuntimeError("No applicable fault probabilities were produced")
    for item in ranked:
        item["probability"] /= total
    return sorted(ranked, key=lambda item: item["probability"], reverse=True)


def diagnose(request: DiagnosisRequest | dict) -> DiagnosisResponse:
    if isinstance(request, dict):
        request = DiagnosisRequest.model_validate(request)
    if request.diagnostic_mode == "adc_raw_v1":
        from .adc_raw_engine import diagnose_raw
        return diagnose_raw(request)
    findings = check_rules(request.system_type, request.measurements)
    evidence_assessment=None
    if request.paired_evidence is not None:
        from .paired_evidence.runtime import infer
        evidence_assessment = infer(request.paired_evidence, selected_artifact(request.model_version))
        ranked = evidence_assessment['diagnosis']
    else:
        ranked = predict_probabilities(
            request.system_type, request.symptom_type, request.measurements, request.model_version
        )
        if 'reliability_model'in selected_artifact(request.model_version):
            from .reliable_diagnosis.policy import single_eligibility
            evidence_assessment=single_eligibility(request.system_type,request.measurements,ranked)
    needs_review=evidence_assessment is not None and evidence_assessment.get('status')=='REVIEW_ALTERNATIVES'
    if needs_review:
        findings.append(dict(rule_id='EVIDENCE_REQUIRES_REVIEW',fault=ranked[0]['fault'],severity='info',
            message='The leading model score is provisional. More or different observations are needed before accepting a single cause.',
            evidence={'reasons':evidence_assessment.get('reasons',['incomplete_or_ambiguous_acquisition'])}))
    confidence = ranked[0]["probability"]
    stop_reason = None
    if request.user_stop:
        stop_reason = "USER_STOP"
    elif any(item["severity"] == "critical" for item in findings):
        stop_reason = "DETERMINISTIC_FINDING"
    elif confidence >= DEFAULT_CONFIDENCE_THRESHOLD and not needs_review:
        stop_reason = "HIGH_CONFIDENCE"
    elif request.step_number >= DEFAULT_MAX_STEPS:
        stop_reason = "MAX_STEPS"
    next_measurement = None
    if stop_reason is None:
        next_measurement = select_next_measurement(
            request.system_type,
            request.symptom_type,
            request.measurements,
            request.asked_measurements + [item.code for item in request.unavailable_checks],
            {item["fault"]: item["probability"] for item in ranked},
            request.available_tools,
            model_version=request.model_version or stable_model_version(),
        )
        if next_measurement is None:
            stop_reason = "NO_MORE_MEASUREMENTS"
    knowledge = recommend_knowledge(ranked, findings, system_type=request.system_type,
                                    next_measurement=next_measurement)
    return DiagnosisResponse(
        system_type=request.system_type,
        rule_findings=findings,
        diagnosis=ranked,
        confidence=confidence,
        diagnosis_complete=(stop_reason is not None and not needs_review and not (
            stop_reason in {"NO_MORE_MEASUREMENTS", "MAX_STEPS"}
            and (request.unavailable_checks or request.available_tools is not None)
        )),
        stop_reason=stop_reason,
        next_measurement=next_measurement,
        recommended_knowledge=knowledge,
        evidence_assessment=evidence_assessment,
    )
