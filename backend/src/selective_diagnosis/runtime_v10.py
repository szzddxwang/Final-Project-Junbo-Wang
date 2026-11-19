"""Measured-only composition assessment layered over the embedded v9 policy."""
import numpy as np
from src.reliable_diagnosis.contract import adapt_legacy
from src.reliable_diagnosis.features import encode
from src.reliable_diagnosis.policy import decision,next_acquisition
from .features import make_features,supplement
from .composition import enrich,VERSION,INDEX
from .consistency import pwm_conflict,CAUSES
from .runtime_v8 import infer as incumbent_infer,score

def infer(packet,artifact):
    p=adapt_legacy(packet)
    result=incumbent_infer(p,artifact)
    head=artifact.get('composition_model',{});model=head.get('models',{}).get(p.system)
    if p.legacy_observations or model is None:
        return result
    model=model.get('load_policies',{}).get(p.load_type,model)
    trusted=result['supported'];x,detail=encode(p)
    probabilities={r['fault']:r['probability']for r in result['diagnosis']}
    probs=np.asarray([[probabilities.get(c,0.)for c in artifact['reliability_model']['classes']]])
    features=enrich(make_features(x[None,:],probs,supplement(detail)[None,:]))
    risk=result['estimated_error_risk']if model['kind']=='incumbent'else float(score(model['model'],model['kind'],model['calibration'],features)[0])
    mixed=float(score(**model['mixed'],x=features)[0])
    threshold=model['retain_threshold']if trusted else model['expand_threshold']
    judged=decision(detail,result['diagnosis'],risk,threshold,model['min_probability'])
    if mixed>model['mixed_threshold']:
        judged['reasons'].append('coexisting_fault_pattern_requires_review')
    if not trusted and result['estimated_error_risk']>model.get('rescue_risk_ceiling',1.):
        judged['reasons'].append('incumbent_uncertainty_requires_review')
    if (not trusted and model.get('require_address_readback_for_promotion')
            and features[0,INDEX['address_difference:count']]<=0):
        judged['reasons'].append('missing_address_readback_requires_review')
    if (not trusted and any(features[0,INDEX[k+':count']]<=0
                            for k in model.get('promotion_required_channels',()))):
        judged['reasons'].append('missing_configuration_evidence_requires_review')
    if model.get('promotion_error_model'):
        error=float(score(**model['promotion_error_model'],x=features)[0])
        if not trusted and error>model['promotion_error_threshold']:
            judged['reasons'].append('classification_uncertainty_requires_review')
    if result['diagnosis'][0]['fault']=='Normal'and not trusted:
        judged['reasons'].append('normal_result_requires_additional_confirmation')
    if model.get('pwm_consistency_guard'):
        conflict,flags=pwm_conflict(features,probs,artifact['reliability_model']['classes'])
        judged['independent_indications']=sorted(set(judged['independent_indications'])|{c for c,f in zip(CAUSES,flags[0])if f})
        if conflict[0]:judged['reasons'].append('independent_fault_indications_conflict_with_single_root')
    judged['reasons']=sorted(set(judged['reasons']))
    judged['supported']=not judged['reasons']
    judged['status']='SUPPORTED_SIMULATION_HYPOTHESIS'if judged['supported']else 'REVIEW_ALTERNATIVES'
    result.update(judged,composition_feature_version=VERSION,composition_feature_count=head['input_features'],
                  estimated_mixed_fault_risk=mixed,mixed_review_threshold=model['mixed_threshold'],
                  single_cause_confirmed=False,incumbent_supported=trusted)
    result['next_acquisition']=next_acquisition(p,result)
    return result
