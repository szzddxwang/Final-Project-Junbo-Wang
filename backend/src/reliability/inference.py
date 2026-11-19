"""Actual versioned forwards with recorded outputs; never trains during requests."""
import hashlib,json,time,uuid
from datetime import datetime,timezone
from functools import lru_cache
import numpy as np,torch,joblib
from scipy.special import softmax
from ..config import ROOT
from ..midterm.models import TemporalNet,ReliabilityGate
from ..midterm.inference import infer_temporal,infer_ood
from ..virtual_lab.sensor import analyze_sensor
from ..virtual_lab.schemas import SensorAnalyzeRequest
from .sensor import sensor_input,FEATURES,PREPROCESS
from .waveform import family_analysis,dc_features
from .ood import novelty_features
from .fusion import expert_input
ART=ROOT/'models/experimental/reliability_v2';TRACE=ROOT/'results/ai_reliability_ux_round/runtime_invocations.jsonl'

def record(result,algorithm,samples,started,source='PYTHON_SIMULATION'):
    result.setdefault('experimental',True)
    result.setdefault('model_training_source','PYTHON_SIMULATION')
    result.update(execution_state='EXECUTED',data_source=source,
        invocation_id=uuid.uuid4().hex,executed_at=datetime.now(timezone.utc).isoformat(),inference_ms=round((time.perf_counter()-started)*1000,3))
    inp=json.dumps(samples,allow_nan=False,sort_keys=True,default=lambda x:x.tolist() if isinstance(x,np.ndarray) else str(x))
    item={'algorithm':algorithm,'input_sha256':hashlib.sha256(inp.encode()).hexdigest(),**result}
    TRACE.parent.mkdir(exist_ok=True,parents=True)
    with TRACE.open('a',encoding='utf-8') as f:f.write(json.dumps(item,allow_nan=False)+'\n')
    return result

def engineering_record(name,result,inputs,relative_code,source='PYTHON_SIMULATION'):
    started=time.perf_counter()
    return record({**result,**identity(ROOT/relative_code,'engineering-'),'experimental':False,'model_training_source':'NOT_LEARNED'},name,inputs,started,source)

@lru_cache(maxsize=64)
def identity(path,prefix):
    # Artifact/source identities are immutable for this service lifetime.
    # Adopt source or model changes only through the controlled service restart.
    # This also avoids a host-drive read on every deterministic MCU calculation.
    sha=hashlib.sha256(path.read_bytes()).hexdigest();return {'model_version':prefix+sha[:12],'artifact_sha256':sha}

@lru_cache(maxsize=12)
def package(name):
    path=ART/name
    if path.suffix=='.joblib':return joblib.load(path),identity(path,'reliability-'+path.stem+'-')
    p=torch.load(path,map_location='cpu',weights_only=True)
    if name=='sensor_temporal.pt':m=TemporalNet(p['channels'],p['features'],len(p['classes']))
    else:m=ReliabilityGate(p['dims'],len(p['classes']))
    m.load_state_dict(p['state_dict']);m.eval();torch.set_num_threads(2)
    return (m,p),identity(path,'reliability-'+path.stem+'-')

def infer_sensor(samples,fs,method='temporal',source='PYTHON_SIMULATION',*,prepared=None):
    # Compare Methods may share this request's immutable preprocessing output.
    # It is never cached across requests; model forwards and audit records remain separate.
    started=time.perf_counter();x,f=sensor_input(samples,fs) if prepared is None else prepared
    if method=='temporal':
        (m,p),ident=package('sensor_temporal.pt');nf=np.clip((f-p['mean'])/p['scale'],-30,30).astype(np.float32)
        with torch.no_grad():prob=torch.softmax(m(torch.tensor(x[None]),torch.tensor(nf[None]))/p['temperature'],dim=1).numpy()[0]
        classes=p['classes'];modeltype='multiscale_temporal_cnn_with_fitted_response'
    elif method=='random_forest':
        from ..midterm.data import SENSOR_FAULTS
        m,ident=package('sensor_physical_rf.joblib');prob=m.predict_proba(f[None])[0];classes=SENSOR_FAULTS;modeltype='random_forest_on_fitted_physical_features'
    else:raise ValueError('Unknown sensor method')
    result={**ident,'model_type':modeltype,'predicted_pattern':classes[int(prob.argmax())],
        'probabilities':dict(zip(classes,map(float,prob))),'anomaly_probability':float(1-prob[0]),
        'preprocessing':PREPROCESS,'features':dict(zip(FEATURES,map(float,f))),'sample_count':len(samples[0]),'sampling_rate_hz':fs,
        'preprocessing_reused':prepared is not None,
        'inference_timing_scope':'model forward; shared request preprocessing excluded' if prepared is not None else 'request preprocessing and model forward',
        'calibration_scope':'Grouped synthetic validation; not hardware calibrated','reference_available':True}
    # Missing samples remain null in audit input rather than invalid JSON NaN.
    clean=[[None if v is None or not np.isfinite(v) else float(v) for v in ch] for ch in samples]
    return record(result,'sensor_'+method,{'samples':clean,'fs':fs},started,source)

def infer_isolation(samples,fs,source='PYTHON_SIMULATION'):
    started=time.perf_counter();path=ROOT/'models/experimental/sensor_isolation.joblib'
    result=analyze_sensor(SensorAnalyzeRequest(ideal=samples[0],measured=samples[1],sample_rate_hz=fs,data_source=source),path)
    return record({**result,**identity(path,'isolation-forest-'),'model_type':'isolation_forest','scope':'Retained baseline; anomaly score is not a probability'},'sensor_isolation',{'samples':samples,'fs':fs},started,source)

def infer_waveform(samples,kind,fs,source='PYTHON_SIMULATION',reference_available=True):
    started=time.perf_counter()
    if not reference_available and kind in ('i2c','sensor'):
        return {'predicted_pattern':'INSUFFICIENT_REFERENCE','probabilities':{},
            'execution_state':'NOT_RUN_MISSING_INPUT','reference_available':False,
            'family':'DIGITAL_PROTOCOL' if kind=='i2c' else 'SENSOR_RESPONSE',
            'experimental':True,'limitation':'Supply the expected aligned reference channels before model analysis.'}
    if kind=='sensor':return infer_sensor(samples,fs,source=source)
    if kind=='i2c':
        result=infer_temporal(samples,'i2c',fs,source);result['family']='DIGITAL_PROTOCOL';result['execution_state']='EXECUTED';result['artifact_sha256']=hashlib.sha256((ROOT/'models/experimental/midterm_v1/i2c_temporal.pt').read_bytes()).hexdigest()
        result['base_invocation_id']=result['invocation_id']
        return record(result,'i2c_temporal',{'samples':samples,'fs':fs},started,source)
    family=family_analysis(samples,fs,reference_available)
    if not reference_available:
        return {'predicted_pattern':'INSUFFICIENT_REFERENCE','probabilities':{},'execution_state':'NOT_RUN_MISSING_INPUT','family':family['family'],'family_analysis':family,'reference_available':False,'experimental':True,'limitation':'Supply the expected signal or circuit reference; a flat trace alone cannot establish normal behavior.'}
    if family['family']=='STEADY_DC':
        p,ident=package('dc_reference_rf.joblib');features=dc_features(samples,fs)
        prob=softmax(np.log(np.clip(p['model'].predict_proba(features[None])[0],1e-9,1))/p['temperature'])
        result={**ident,'predicted_pattern':p['classes'][int(prob.argmax())],'probabilities':dict(zip(p['classes'],map(float,prob))),
            'model_type':'reference_aware_dc_random_forest','family':family['family'],'family_analysis':family,'reference_available':True,
            'sample_count':len(samples[0]),'sampling_rate_hz':fs,'calibration_scope':'DC grouped synthetic validation; not a unique root-cause classifier','limitation':family['limitation']}
        return record(result,'adc_dc',{'samples':samples,'fs':fs},started,source)
    result=infer_temporal(samples,'adc',fs,source);result.update(family=family['family'],family_analysis=family,reference_available=True,execution_state='EXECUTED',artifact_sha256=hashlib.sha256((ROOT/'models/experimental/midterm_v1/adc_temporal.pt').read_bytes()).hexdigest())
    result['base_invocation_id']=result['invocation_id']
    return record(result,'adc_ac_temporal',{'samples':samples,'fs':fs},started,source)

def infer_uncertainty(samples,fs,source='PYTHON_SIMULATION'):
    started=time.perf_counter();p,ident=package('ood_conditioned.joblib');old=infer_ood(samples,fs);family='DC' if np.ptp(samples[0])<.01 else 'AC';f=novelty_features(samples);nf=(f-p['mean'])/p['scale']
    values={**old['scores'],'normalized_physics_kNN':float(p['knns'][family].kneighbors(nf[None])[0].mean())};thresholds={k:v[family] for k,v in p['thresholds'].items()}
    reliable=bool(p['selected']) and family=='AC'
    result={**ident,'scores':values,'thresholds':thresholds,'research_warnings':{k:v>thresholds[k] for k,v in values.items()},
        'reliable':reliable,'warning_only':True,'production_blocks':False,'family':family,'selected_method':p['selected'],
        'assessment':'Unknown-pattern assessment is not reliable for this signal condition.' if not reliable else 'Experimental novelty warning; verify with additional evidence.',
        'base_invocation_id':old['invocation_id'],'base_model_version':old['model_version'],'scope':'Known-shift calibrated; near-unknown detection did not pass the validation gate.'}
    return record(result,'conditioned_ood',{'samples':samples,'fs':fs},started,source)

def infer_expert_fusion(system,measurements,structured,source='USER_PROVIDED'):
    if not measurements:return {'available':False,'execution_state':'NOT_RUN_MISSING_INPUT','reason':'Take at least one measurement before combining evidence.'}
    started=time.perf_counter();(model,p),ident=package(f'expert_gate_{system.lower()}.pt');v,mask,q=expert_input(system,measurements,structured,p['classes'])
    nv=np.clip((v-p['mean'])/p['scale'],-30,30);start=0
    for flag,d in zip(mask,p['dims']):
        if not flag:nv[start:start+d]=0
        start+=d
    with torch.no_grad():prob,w=model(torch.tensor(nv[None],dtype=torch.float32),torch.tensor(mask[None]),torch.tensor(q[None]));prob=prob.numpy()[0];w=w.numpy()[0]
    result={**ident,'available':True,'predicted_root_fault':p['classes'][int(prob.argmax())],'probabilities':dict(zip(p['classes'],map(float,prob))),
        'modality_weights':dict(zip(('structured','physics','waveform'),map(float,w))),'modality_presence':dict(zip(('structured','physics','waveform'),map(bool,mask))),
        'validation_gate_pass':p['validation_gate_pass'],'paired_waveform_validated':False,'scope':'Same-event structured plus derived physical/protocol evidence. Learned waveform fusion not yet validated for this system.'}
    return record(result,'expert_fusion_'+system,{'measurements':measurements,'structured':structured},started,source)

def infer_paired_adc(structured,observations,samples=None,fs=None,source='USER_PROVIDED'):
    from ..midterm.fusion import infer_gate
    started=time.perf_counter();result=infer_gate(structured,observations,samples,fs,source)
    if not result.get('available'):return result
    result['base_invocation_id']=result['invocation_id']
    result['artifact_sha256']=hashlib.sha256((ROOT/'models/experimental/midterm_v1/reliability_gate.pt').read_bytes()).hexdigest()
    return record(result,'adc_paired_fusion',{'structured':structured,'observations':observations,'samples':samples,'fs':fs},started,source)
