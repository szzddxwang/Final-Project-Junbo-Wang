"""Selective v6 inference: frozen root probabilities, new acceptance assessment."""
import hashlib,json
import numpy as np
import xgboost as xgb
from src.reliable_diagnosis.features import encode,NAMES
from src.reliable_diagnosis.model import evidence_probabilities
from src.reliable_diagnosis.policy import decision,risk_features,next_acquisition
from src.reliable_diagnosis.contract import adapt_legacy
from .features import supplement,make_features,VERSION

def score(model,kind,calibration,x):
    if kind=='xgb':p=model.predict(xgb.DMatrix(x))
    else:p=model.predict_proba(np.nan_to_num(x,nan=-999.,posinf=999.,neginf=-999.))[:,list(model.classes_).index(1)]
    z=np.log(np.clip(p,1e-6,1-1e-6)/np.clip(1-p,1e-6,1))
    return calibration.predict_proba(z[:,None])[:,1]

def infer(packet,artifact):
    packet=adapt_legacy(packet)
    if packet.legacy_observations:
        from src.reliable_diagnosis.runtime import infer as legacy_infer
        return legacy_infer(packet,artifact)
    head=artifact['reliability_model'];selection=artifact['selective_model'];x,detail=encode(packet);p=detail['packet'];probs=evidence_probabilities(head,x[None,:],[p.system])[0]
    ranking=sorted([dict(fault=c,probability=float(v))for c,v in zip(head['classes'],probs)if c in head['allowed'][p.system]],key=lambda r:-r['probability'])
    chosen=selection['models'].get(p.system)
    if chosen:
        features=make_features(x[None,:],probs[None,:],supplement(detail)[None,:]);risk=float(score(chosen['model'],chosen['kind'],chosen['calibration'],features)[0]);policy=chosen
        if 'retain_threshold'in chosen:
            old=head['risk_models'][p.system];z=risk_features(x[None,:],probs[None,:],head['feature_names']);oldrisk=float(old.predict_proba(z)[0,list(old.classes_).index(1)]);oldpolicy=head['policies'][p.system]
            trusted=decision(detail,ranking,oldrisk,oldpolicy['threshold'],oldpolicy['min_probability'])['supported']
            policy={**chosen,'threshold':chosen['retain_threshold']if trusted else chosen['expand_threshold']}
    else:
        model=head['risk_models'][p.system];z=risk_features(x[None,:],probs[None,:],head['feature_names']);risk=float(model.predict_proba(z)[0,list(model.classes_).index(1)]);policy=head['policies'][p.system]
    judged=decision(detail,ranking,risk,policy['threshold'],policy['min_probability']);raw=p.model_dump()
    result=dict(diagnosis=ranking,confidence=ranking[0]['probability'],**judged,quality=detail['quality'],source=p.source,feature_count=len(NAMES),captures_used=len(p.captures),samples_acquired=sum(c.samples for c in p.captures),acquired_virtual_duration_s=sum(c.time_s for c in p.captures),physical_estimates=detail['physical_estimates'],fit=detail['fit'],evidence_sha256=hashlib.sha256(json.dumps(raw,sort_keys=True,separators=(',',':')).encode()).hexdigest(),capture_dropout=any(not c.channels for c in p.captures),unknown_or_mixed_fault_not_excluded=True,hardware_validated=False,calibration_scope='held-out controlled simulation; likelihood score is not hardware accuracy',legacy_observations=p.legacy_observations,acceptance_feature_version=VERSION,acceptance_features=selection['input_features'],root_classifiers_unchanged_from_v5=True)
    result['next_acquisition']=next_acquisition(p,result)
    return result
