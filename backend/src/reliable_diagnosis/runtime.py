"""Measured-only v5 inference. Physics generators are intentionally not imported."""
import hashlib,json
import numpy as np
from .features import encode,NAMES
from .model import evidence_probabilities
from .policy import decision,risk_features,next_acquisition

def infer(packet,artifact):
    head=artifact['reliability_model'];x,detail=encode(packet);p=detail['packet'];scores=evidence_probabilities(head,x[None,:],[p.system])[0]
    ranking=sorted([dict(fault=c,probability=float(v)) for c,v in zip(head['classes'],scores) if c in head['allowed'][p.system]],key=lambda r:-r['probability'])
    policy=head.get('policies',{}).get(p.system,dict(threshold=.03,min_probability=.90));risk=None
    if 'risk_models'in head:
        m=head['risk_models'][p.system];features=risk_features(x[None,:],scores[None,:],head['feature_names']);pr=m.predict_proba(features)[0]
        risk=float(pr[list(m.classes_).index(1)]) if 1 in m.classes_ else 0.
    judged=decision(detail,ranking,risk,policy['threshold'],policy['min_probability'])
    raw=p.model_dump();result=dict(diagnosis=ranking,confidence=ranking[0]['probability'],**judged,quality=detail['quality'],
        source=p.source,feature_count=len(NAMES),captures_used=len(p.captures),samples_acquired=sum(c.samples for c in p.captures),
        acquired_virtual_duration_s=sum(c.time_s for c in p.captures),physical_estimates=detail['physical_estimates'],fit=detail['fit'],
        evidence_sha256=hashlib.sha256(json.dumps(raw,sort_keys=True,separators=(',',':')).encode()).hexdigest(),
        capture_dropout=any(not c.channels for c in p.captures),unknown_or_mixed_fault_not_excluded=True,hardware_validated=False,
        calibration_scope='held-out controlled simulation; likelihood score is not hardware accuracy',legacy_observations=p.legacy_observations)
    result['next_acquisition']=next_acquisition(p,result)
    return result
