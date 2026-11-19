"""Root-target reliability gating; explicit missingness and evidence consistency."""
import hashlib,time
from functools import lru_cache
import numpy as np
import torch
from ..diagnosis_engine import predict_probabilities
from ..physics_features import adc_physics
from ..config import load_config
from .models import ReliabilityGate
from .inference import ART,trace,infer_temporal

PHYSICS=('count_actual_residual','count_intended_residual','path_voltage_difference','resolution_difference','reference_difference','quantization_step_v','saturation_indicator','intended_saturation_indicator')
SCALES=np.array([4096,4096,5,12,5,1,1,1],dtype=float)
STRUCT_CLASSES=tuple(load_config('systems')['ANALOG_ADC']['applicable_faults'])
def physics_vector(observations):
    values=adc_physics(observations) if observations else {}
    present=np.array([values.get(k) is not None for k in PHYSICS],dtype=np.float32)
    # Numeric payload for unavailable dimensions is ignored via explicit feature masks.
    vector=np.array([float(values[k])/s if values.get(k) is not None else 0. for k,s in zip(PHYSICS,SCALES)],dtype=np.float32)
    return np.r_[vector,present],values

def consistency(structured,observations,wave=None):
    _,physics=physics_vector(observations);findings=[]
    for key,tol,title in [('reference_difference',.02,'Measured reference differs from target'),('resolution_difference',.5,'Configured resolution differs from intended'),('path_voltage_difference',.05,'Pin voltage differs from command'),('count_actual_residual',3,'Count inconsistent with measured pin/reference/configuration')]:
        value=physics.get(key)
        if value is not None and abs(value)>tol: findings.append({'finding':title,'residual':value,'evidence':key,'type':'DETERMINISTIC_OBSERVABLE'})
    top=max(structured,key=structured.get) if structured else None
    conflict=top=='Normal' and bool(findings)
    missing=[k for k in ('ADC_INPUT_VOLTAGE','ADC_REFERENCE','ADC_REFERENCE_TARGET','ADC_RESOLUTION_BITS','ADC_INTENDED_BITS','ADC_READING') if k not in observations]
    return {'physics':physics,'findings':findings,'structured_hypothesis':top,'agreement':'CONFLICT' if conflict else ('NO_DETECTED_CONFLICT' if findings or structured else 'INSUFFICIENT_EVIDENCE'),'missing_evidence':missing,'waveform_provided':wave is not None,'suggested_discriminating_measurement':missing[0] if missing else ('ADC_REFERENCE' if conflict else None),'note':'Derived residuals are correlated evidence; no independent likelihood multiplication or rule override.'}

@lru_cache(maxsize=1)
def load_gate():
    path=ART/'reliability_gate.pt'
    if not path.is_file(): raise FileNotFoundError('Trained reliability gate unavailable')
    p=torch.load(path,map_location='cpu',weights_only=True);m=ReliabilityGate(p['dims'],len(p['classes']));m.load_state_dict(p['state_dict']);m.eval()
    return m,p,'midterm-reliability-gate-'+hashlib.sha256(path.read_bytes()).hexdigest()[:12]

def gate_input(structured_probability,observations,wave_embedding=None,wave_quality=1.):
    s=np.array([structured_probability.get(k,0.) for k in STRUCT_CLASSES],dtype=np.float32)
    p,_=physics_vector(observations);w=np.asarray(wave_embedding,dtype=np.float32) if wave_embedding is not None else np.zeros(48,dtype=np.float32)
    mask=np.array([bool(structured_probability),bool(np.any(p[8:])),wave_embedding is not None],dtype=np.float32)
    quality=np.array([1. if mask[0] else 0.,float(np.mean(p[8:])),wave_quality if mask[2] else 0.],dtype=np.float32)
    return np.r_[s,p,w],mask,quality

def infer_gate(structured_probability,observations,wave_samples=None,fs=None,source='USER_PROVIDED'):
    started=time.perf_counter();m,p,version=load_gate();h=None;wave=None
    if wave_samples is not None:
        wave,h=infer_temporal(wave_samples,'adc',fs,source,embedding=True)
    density=min(1.,len(wave_samples[0])/256.) if wave_samples is not None else 0.
    v,mask,q=gate_input(structured_probability,observations,h,wave_quality=density)
    if not mask.any(): return {'available':False,'reason':'No supported ADC evidence supplied'}
    nv=(v-np.asarray(p['mean']))/np.asarray(p['scale']);start=0
    for present,d in zip(mask,p['dims']):
        if not present:nv[start:start+d]=0
        start+=d
    with torch.no_grad():prob,weights=m(torch.tensor(nv[None],dtype=torch.float32),torch.tensor(mask[None]),torch.tensor(q[None]));prob=prob.numpy()[0];weights=weights.numpy()[0]
    prob=np.clip(prob.astype(float),0,1);prob/=prob.sum()
    return {'available':True,'model_version':version,'predicted_root_fault':p['classes'][int(prob.argmax())],'probabilities':dict(zip(p['classes'],map(float,prob))),'modality_weights':dict(zip(('structured','physics','waveform'),map(float,weights))),'modality_presence':dict(zip(('structured','physics','waveform'),map(bool,mask))),'quality_indicators':q.tolist(),'experimental':True,'scope':'Six single-cause ADC root faults in paired Python simulation; excludes polarity, generic voltage-level and multiple concurrent faults','waveform':wave,'consistency':consistency(structured_probability,observations,wave_samples),'invocation_id':trace('reliability_gate',version,source,hashlib.sha256(v.tobytes()+mask.tobytes()).hexdigest(),(time.perf_counter()-started)*1000)}
