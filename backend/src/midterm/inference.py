"""Cached real temporal inference and bounded trace evidence, no HTTP training."""
from functools import lru_cache
import hashlib,json,time,uuid
from datetime import datetime,timezone
import numpy as np
import torch
import joblib
from ..config import ROOT
from .data import temporal_input,PREPROCESS
from .models import TemporalNet
ART=ROOT/'models/experimental/midterm_v1'
TRACE=ROOT/'results/midterm_ai_deployment_round/runtime_invocations.jsonl'

def trace(algorithm,version,source,input_hash,elapsed_ms):
    record={'invocation_id':uuid.uuid4().hex,'utc':datetime.now(timezone.utc).isoformat(),'algorithm':algorithm,'model_version':version,'data_source':source,'input_sha256':input_hash,'elapsed_ms':round(elapsed_ms,3),'actual_model_forward':True}
    TRACE.parent.mkdir(parents=True,exist_ok=True)
    with TRACE.open('a',encoding='utf-8') as f:f.write(json.dumps(record)+'\n')
    return record['invocation_id']

@lru_cache(maxsize=4)
def load_temporal(kind):
    path=ART/f'{kind}_temporal.pt'
    if not path.is_file(): raise FileNotFoundError(f'{kind} temporal artifact unavailable')
    torch.set_num_threads(2);p=torch.load(path,map_location='cpu',weights_only=True)
    m=TemporalNet(p['channels'],p['features'],len(p['classes']));m.load_state_dict(p['state_dict']);m.eval()
    return m,p,f'midterm-{kind}-temporal-'+hashlib.sha256(path.read_bytes()).hexdigest()[:12]

def infer_temporal(samples,kind,fs,source='USER_PROVIDED',record=True,embedding=False):
    started=time.perf_counter();m,p,version=load_temporal(kind);x,f=temporal_input(samples,kind,fs)
    nf=np.clip((f-np.asarray(p['mean']))/np.asarray(p['scale']),-30,30).astype(np.float32)
    with torch.no_grad(): z,h=m(torch.from_numpy(x[None]),torch.from_numpy(nf[None]),True);prob=torch.softmax(z/p['temperature'],dim=1).numpy()[0]
    result={'predicted_pattern':p['classes'][int(prob.argmax())],'probabilities':dict(zip(p['classes'],map(float,prob))),'model_version':version,'model_type':'multiscale_temporal_cnn_with_observable_features','experimental':True,'model_training_source':'PYTHON_SIMULATION','data_source':source,'preprocessing':PREPROCESS,'calibration_scope':'validation-group temperature; see held-shift report; no universal calibration claim','sample_count':len(samples[0]),'sampling_rate_hz':fs,'inference_ms':(time.perf_counter()-started)*1000}
    if kind=='sensor': result['anomaly_probability']=float(1-prob[0])
    if record: result['invocation_id']=trace(kind,version,source,hashlib.sha256(x.tobytes()+f.tobytes()).hexdigest(),result['inference_ms'])
    if embedding: return result,h.numpy()[0]
    return result

def status():
    result={}
    for kind in ['adc','i2c','sensor']:
        try:
            _,p,v=load_temporal(kind);result[kind]={'available':True,'version':v,'experimental':True,'classes':p['classes'],'artifact':str(ART/f'{kind}_temporal.pt')}
        except (FileNotFoundError,RuntimeError,ValueError) as e: result[kind]={'available':False,'reason':str(e)}
    result['fusion']={'available':(ART/'reliability_gate.pt').is_file(),'experimental':True,'scope':'paired ADC, six single-cause root labels'}
    return result

@lru_cache(maxsize=1)
def load_ood():
    path=ART/'adc_ood_temporal.pt';p=torch.load(path,map_location='cpu',weights_only=True)
    m=TemporalNet(p['channels'],p['features'],len(p['classes']));m.load_state_dict(p['state_dict']);m.eval()
    detector_path=ART/'adc_ood_detectors.joblib'
    version='midterm-adc-ood-'+hashlib.sha256(path.read_bytes()+detector_path.read_bytes()).hexdigest()[:12]
    return m,p,joblib.load(detector_path),version

def infer_ood(samples,fs):
    from scipy.special import softmax,logsumexp
    started=time.perf_counter()
    m,p,d,version=load_ood();x,f=temporal_input(samples,'adc',fs);nf=np.clip((f-np.array(p['mean']))/np.array(p['scale']),-30,30).astype(np.float32)
    with torch.no_grad():z,h=m(torch.from_numpy(x[None]),torch.from_numpy(nf[None]),True)
    z=z.numpy();h=h.numpy();delta=h[:,None,:]-d['means'][None,:,:]
    scores={'MSP':float(1-softmax(z,axis=1).max()),'energy':float(-logsumexp(z,axis=1)[0]),'Mahalanobis':float(np.einsum('ncd,df,ncf->nc',delta,d['precision'],delta).min()),'embedding_kNN':float(d['knn'].kneighbors(h)[0].mean())}
    return {'scores':scores,'thresholds':d['thresholds'],'warnings':{k:v>d['thresholds'][k] for k,v in scores.items()},'scope':'ADC waveform novelty only; warning-only; no root-fault probability','calibration':'Thresholds selected on known validation groups; shift can cause false unknown','held_out_pattern':'SIGNAL_ATTENUATION','model_version':version,'invocation_id':trace('adc_ood',version,'SUPPLIED_ADC_CAPTURE',hashlib.sha256(x.tobytes()+f.tobytes()).hexdigest(),(time.perf_counter()-started)*1000)}
