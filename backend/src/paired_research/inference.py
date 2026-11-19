"""Versioned research inference, explicit presence masks and invocation journal."""
import hashlib,json,time,uuid
from datetime import datetime,timezone
from functools import lru_cache
import joblib,numpy as np
from ..config import ROOT
from .features import physical_features,waveform_features
from .models import combine,aligned_probability
from ..reliability.mechanistic_ood import mechanism_features,distance
ART=ROOT/'models/experimental/generalization_v3';TRACE=ROOT/'results/ood_fusion_expert_ux_round/runtime_invocations.jsonl'

@lru_cache(maxsize=16)
def package(name):
    path=ART/name
    return joblib.load(path),hashlib.sha256(path.read_bytes()).hexdigest()

def record(result,name,sha,inputs,start):
    result.update(execution_state='EXECUTED',invocation_id=uuid.uuid4().hex,executed_at=datetime.now(timezone.utc).isoformat(),model_version=name+'-'+sha[:12],artifact_sha256=sha,latency_ms=(time.perf_counter()-start)*1000,experimental=True)
    entry={k:v for k,v in result.items() if k not in ('probabilities','features')};entry['input_sha256']=hashlib.sha256(json.dumps(inputs,sort_keys=True,allow_nan=False).encode()).hexdigest()
    with TRACE.open('a') as f:f.write(json.dumps(entry,allow_nan=False)+'\n')
    return result

def expert(system,measurements,structured):
    if not measurements:return {'execution_state':'NOT_RUN_MISSING_INPUT','reason':'Measurements required'}
    start=time.perf_counter();pack,sha=package(f'expert_{system.lower()}.joblib');classes=pack['classes'];p=aligned_probability(pack['model'],physical_features(system,measurements)[None],classes)[0]
    return record({'probabilities':dict(zip(classes,map(float,p))),'predicted_root_fault':classes[int(p.argmax())],'validation_gate_pass':pack['validation_gate_pass'],'production_weight':0.,'validation_blend_weight':pack['blend_weight'],'scope':'Structured research candidate; production stable result remains authoritative.'},'revised-expert',sha,measurements,start)

def paired(system,measurements,structured,samples=None,configured=None):
    start=time.perf_counter();pack,sha=package(f'paired_{system.lower()}.joblib');classes=pack['classes']
    present=[bool(structured),bool(measurements),samples is not None]
    if not any(present):return {'execution_state':'NOT_RUN_MISSING_INPUT','reason':'No observed modalities'}
    ps=np.asarray([structured.get(k,0.) for k in classes]);ps=ps/ps.sum() if ps.sum() else ps
    pp=aligned_probability(pack['physics'],physical_features(system,measurements)[None],classes)[0] if present[1] else np.zeros(len(classes))
    wp=aligned_probability(pack['waveform'],waveform_features(system,samples,configured)[None],classes)[0] if present[2] else np.zeros(len(classes))
    quality=[min(len(measurements)/12,1) if present[0] else 0,min(len(measurements)/12,1) if present[1] else 0,1. if present[2] else 0]
    p,w=combine(np.stack((ps,pp,wp))[None],np.asarray(quality)[None],np.asarray(present)[None],pack['gate_weights']);p=p[0]
    return record({'probabilities':dict(zip(classes,map(float,p))),'predicted_root_fault':classes[int(p.argmax())],'modality_mask':present,'gate_weights':w[0].tolist(),'waveform_executed':present[2],'waveform_probabilities':dict(zip(classes,map(float,wp))) if present[2] else {},'scope':'Same-event synthetic research; external hardware unvalidated.','validation_gate_pass':pack['validation_gate_pass'],'evidence_note':'Executed with waveform evidence.' if present[2] else 'Executed without waveform evidence.'},'paired-reliability-gate',sha,{'measurements':measurements,'samples':samples,'configured':configured},start)

def unknown(samples):
    if samples is None:return {'execution_state':'NOT_RUN_MISSING_INPUT','reason':'Waveform required'}
    if np.ptp(samples[0])<.01:return {'execution_state':'NOT_RUN_MISSING_INPUT','reason':'A changing reference is required; DC novelty is inconclusive','reliable':False}
    start=time.perf_counter();pack,sha=package('ood_mechanistic.joblib');score=float(distance(pack,mechanism_features(samples))[0]);flag=score>pack['threshold']
    return record({'assessment':'Unknown-pattern warning' if flag else 'Within tested known-pattern range','score':score,'threshold':pack['threshold'],'unknown_flag':bool(flag),'reliable':bool(pack['gate_passed']),'production_blocking':False,'scope':'Dynamic ADC simulation gate passed; hardware and DC detection remain unvalidated.'},'class-conditional-physics-ood',sha,samples,start)
