"""Native Mendix experimental inference bridges with bounded typed payloads."""
import hashlib,json
from typing import Literal,Annotated
import numpy as np
from fastapi import APIRouter,Request,HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel,ConfigDict,Field,FiniteFloat,model_validator
from ..config import ROOT,load_config
from ..closure.experts import expert_probabilities,EXPERT_REGISTRY
from ..schemas import DiagnosisRequest
from ..diagnosis_engine import diagnose,predict_probabilities
from ..model_identity import stable_model_version
from ..adc_evidence import RAW_CODES,TOOLS,raw_model_version
from ..adc_raw_engine import next_check,raw_reference
from ..troubleshooting import information_gain,_filtered_reference,MeasurementScorer
from ..closure.active_policy import choose_check,measurement_cost,expected_error_reduction
from ..measurement_guidance import PROTOCOLS
from ..virtual_lab.schemas import ADCModelRequest,SensorAnalyzeRequest,WaveformAnalyzeRequest,MultimodalRequest
from ..virtual_lab.adc_model import simulate_adc
from ..virtual_lab.sensor import analyze_sensor
from .inference import infer_temporal,infer_ood,status
from .fusion import infer_gate,consistency
router=APIRouter(prefix='/ai',tags=['Midterm AI — Experimental'])

def safe(call,*args,**kwargs):
    try:return call(*args,**kwargs)
    except (FileNotFoundError,RuntimeError,ValueError,OSError) as exc:return {'available':False,'reason':f'{type(exc).__name__}: {exc}','experimental':True}

def active_comparison(req,response=None):
    response=response or diagnose(req);posterior={v.fault:v.probability for v in response.diagnosis};out=[]
    stable=response.next_measurement
    out.append({'policy':'production_information_gain','check':stable.id if stable else None,'information_gain_bits':stable.information_gain if stable else None,'status':response.stop_reason or 'NEXT_CHECK'})
    excluded=req.asked_measurements+[v.code for v in req.unavailable_checks]
    if req.diagnostic_mode=='adc_raw_v1':
        reference=raw_reference(req.model_version);candidates=[]
        for code in RAW_CODES:
            if code in req.measurements or code in excluded:continue
            tools=[t for t in TOOLS[code] if req.available_tools is None or t in req.available_tools]
            if not tools:continue
            costs={'VISUAL_SETTINGS':.5,'SIMULATION':.5,'MULTIMETER':1.,'LOGIC_ANALYZER':2.5,'OSCILLOSCOPE':3.}
            cost=min(costs[t] for t in tools);gain=information_gain(reference,code,posterior,input_type='numeric');candidates.append((gain/cost,code,gain,cost,tools))
        best=max(candidates) if candidates else None
        out.append({'policy':'experimental_cost_aware_ig','check':best[1] if best else None,'information_gain_bits':float(best[2]) if best else None,'relative_cost':best[3] if best else None,'tools':best[4] if best else [],'status':'EXPERIMENTAL'})
    else:
        reference,_=_filtered_reference(req.system_type,req.symptom_type,req.measurements)
        scorer=MeasurementScorer(reference,posterior)
        for policy in ('cost_aware_ig','decision_value'):
            code=choose_check(req.system_type,req.symptom_type,req.measurements,excluded,posterior,policy,req.available_tools,scorer=scorer)
            benefit=(scorer.information_gain(code) if policy=='cost_aware_ig' else scorer.expected_error_reduction(code)) if code else None
            out.append({'policy':'experimental_'+policy,'check':code,'benefit':benefit,'benefit_unit':'bits' if policy=='cost_aware_ig' else 'expected_error_reduction','relative_cost':measurement_cost(code,req.available_tools) if code else None,'tools':PROTOCOLS.get(code,{}).get('tools',[]),'status':'EXPERIMENTAL'})
    return {'recommendations':out,'cost_basis':'Relative learner effort: visual/simulation 0.5, multimeter 1, logic analyzer 2.5, oscilloscope 3; not measured time','why':'Training-reference likelihoods, current hypotheses and feasible unasked checks; no final-test labels','promotion':'Information Gain remains production default; no optimality claim'}

def advanced(req:MultimodalRequest):
    stable=diagnose(req.diagnosis) if req.diagnosis else None
    obs=req.adc_observations or (req.diagnosis.measurements if req.diagnosis and req.diagnosis.diagnostic_mode=='adc_raw_v1' else {})
    system=req.diagnosis.system_type if req.diagnosis else (req.waveform.system_type if req.waveform else 'ANALOG_ADC')
    result={'experimental':True,'production_model_version':stable_model_version(),'structured_diagnosis':stable.model_dump() if stable else None,'waveform':'NOT_PROVIDED','fusion':{'available':False,'reason':'Supported ADC paired-root scope only'},'uncertainty':{'available':False,'reason':'No ADC waveform supplied'},'active':active_comparison(req.diagnosis,stable) if stable else None}
    result['diagnostic_mode']=req.diagnosis.diagnostic_mode if req.diagnosis else None
    result['structured_model_version']=(req.diagnosis.model_version or (raw_model_version() if req.diagnosis.diagnostic_mode=='adc_raw_v1' else stable_model_version())) if req.diagnosis else None
    if req.diagnosis and req.diagnosis.diagnostic_mode=='stable':
        classes=load_config('systems')[system]['applicable_faults']
        _,findings=expert_probabilities(system,req.diagnosis.measurements,classes)
        result['protocol_evidence']={'basis':EXPERT_REGISTRY[system]['basis'],'findings':findings,'status':'DETERMINISTIC_ENGINEERING','limitation':'Observable evidence rules; heuristic weights are not calibrated fault probabilities.'}
    if req.waveform:
        kind={'ANALOG_ADC':'adc','I2C_SENSOR':'i2c','SENSOR':'sensor'}[req.waveform.system_type]
        result['waveform']=safe(infer_temporal,req.waveform.samples,kind,req.waveform.sampling_rate_hz,req.waveform.data_source)
    if system=='ANALOG_ADC':
        if req.diagnosis and req.diagnosis.diagnostic_mode=='stable':
            pp={v.fault:v.probability for v in stable.diagnosis}
        else:
            # No fabricated measurements: use only shared-catalog fields actually supplied.
            common={k:v for k,v in obs.items() if k in ('ADC_READING','ADC_REFERENCE')}
            if 'ADC_INPUT_VOLTAGE' in obs:common['OUTPUT_VOLTAGE']=obs['ADC_INPUT_VOLTAGE']
            if 'OUTPUT_VOLTAGE' in obs:common['EXPECTED_OUTPUT_VOLTAGE']=obs['OUTPUT_VOLTAGE']
            pp={v['fault']:v['probability'] for v in predict_probabilities('ANALOG_ADC','OTHER',common)} if common else {}
        wave=req.waveform if req.waveform and req.waveform.system_type=='ANALOG_ADC' else None
        result['consistency']=consistency(pp,obs,wave.samples if wave else None)
        result['fusion']=safe(infer_gate,pp,obs,wave.samples if wave else None,wave.sampling_rate_hz if wave else None,wave.data_source if wave else 'USER_PROVIDED')
        if wave: result['uncertainty']=safe(infer_ood,wave.samples,wave.sampling_rate_hz)
    return result

def report(result):
    lines=['Advanced AI Analysis — Experimental','Stable diagnostic results are preserved.']
    structured=result.get('structured_diagnosis')
    if structured:
        lines += ['','STRUCTURED ROOT DIAGNOSIS',f"Model: {result['structured_model_version']}",f"Diagnostic mode: {result['diagnostic_mode']}",f"Preserved production model: {result['production_model_version']}"]
        lines += [f"{v['fault']}: {v['probability']:.1%}" for v in structured['diagnosis'][:4]]
    wave=result.get('waveform')
    lines += ['','WAVEFORM PATTERN AI']
    if isinstance(wave,dict) and 'predicted_pattern' in wave:
        lines += [f"Pattern: {wave['predicted_pattern']}",f"Pattern probability: {max(wave['probabilities'].values()):.1%}",f"Model: {wave['model_version']}",f"Source: {wave['data_source']}; {wave['sample_count']} samples",wave['calibration_scope'],f"Invocation: {wave.get('invocation_id','')}" ]
    else:lines.append('Waveform not provided.' if wave=='NOT_PROVIDED' else json.dumps(wave))
    cons=result.get('consistency',{})
    if cons:
        lines += ['','PHYSICS / EVIDENCE CONSISTENCY',cons['agreement'],'Frozen shared-model representation hypothesis: '+str(cons['structured_hypothesis']),'This representation is separate from the ADC raw classifier shown above.']
        lines += [f"{v['finding']}: {v['residual']:.6g}" for v in cons['findings']]
        lines += ['Missing evidence: '+(', '.join(cons['missing_evidence']) or 'none'),cons['note']]
    fusion=result.get('fusion',{})
    if result.get('protocol_evidence'):
        expert=result['protocol_evidence'];lines += ['','SYSTEM ENGINEERING EVIDENCE',expert['basis']]
        lines += [v['reason']+' — '+v['evidence'] for v in expert['findings']] or ['No rule finding supported by the supplied evidence.']
        lines.append(expert['limitation'])
    lines += ['','LEARNED ROOT FUSION']
    if fusion.get('available'):
        lines += [f"Model: {fusion['model_version']}",f"Experimental root: {fusion['predicted_root_fault']}"]
        lines += [f"{k}: {v:.1%}" for k,v in sorted(fusion['probabilities'].items(),key=lambda x:-x[1])[:3]]
        lines += ['Gate weights: '+', '.join(f'{k} {v:.1%}' for k,v in fusion['modality_weights'].items()),'Modalities: '+json.dumps(fusion['modality_presence']),fusion['scope'],f"Invocation: {fusion['invocation_id']}"]
    else:lines.append(fusion.get('reason','Unavailable'))
    lines += ['','UNCERTAINTY — WARNING ONLY']
    uncertainty=result.get('uncertainty',{})
    if 'scores' in uncertainty:
        lines += [f"Model: {uncertainty['model_version']}",f"Invocation: {uncertainty['invocation_id']}"]
        for key,value in uncertainty['scores'].items():
            lines.append(f"{key}: {value:.4g}; validation threshold {uncertainty['thresholds'][key]:.4g}; warning {uncertainty['warnings'][key]}")
        lines += [uncertainty['scope'],uncertainty['calibration'],'Held-out pattern: '+uncertainty['held_out_pattern'],'Independent shift false-unknown rates: Mahalanobis 76.9%, kNN 88.1%; warnings do not confirm an unknown fault.']
    else:lines.append(uncertainty.get('reason','Unavailable'))
    if result.get('active'):
        lines += ['','ACTIVE NEXT CHECK']
        for v in result['active']['recommendations']:
            lines.append(f"{v['policy']}: {v['check'] or 'no feasible unasked check'}; "+json.dumps({k:x for k,x in v.items() if k not in ('policy','check')}))
        lines += [result['active']['cost_basis'],result['active']['why'],result['active']['promotion']]
    return '\n'.join(lines)

@router.post('/troubleshooting/advanced')
def advanced_route(request:MultimodalRequest,http_request:Request):
    result=advanced(request)
    return PlainTextResponse(report(result)) if http_request.headers.get('accept','').startswith('text/plain') else result

@router.post('/device/adc/advanced')
def adc_advanced(request:ADCModelRequest,http_request:Request):
    if request.sample_count<64:raise HTTPException(422,'Temporal ADC analysis requires 64..2048 samples')
    s=simulate_adc(request);chart=s['chart'];w=WaveformAnalyzeRequest(system_type='ANALOG_ADC',samples=[chart[k] for k in ('commanded_v','pin_v','adc_reconstructed_v')],sampling_rate_hz=request.sample_rate_hz,data_source='PYTHON_SIMULATION')
    d=DiagnosisRequest(system_type='ANALOG_ADC',symptom_type='OTHER',diagnostic_mode='adc_raw_v1',measurements=s['diagnosis_evidence']['measurements'],available_tools=['SIMULATION','MULTIMETER','VISUAL_SETTINGS'])
    if http_request.headers.get('accept','').startswith('text/ai-capture'):return PlainTextResponse(w.model_dump_json())
    result=advanced(MultimodalRequest(diagnosis=d,waveform=w,adc_observations=d.measurements))
    return PlainTextResponse(report(result)) if http_request.headers.get('accept','').startswith('text/plain') else result

@router.post('/device/adc/next-experiment')
def adc_next_experiment(request:ADCModelRequest,http_request:Request):
    observations=simulate_adc(request)['diagnosis_evidence']['measurements']
    # A blind verification exercise: configured values are deliberately unverified,
    # not asserted to be absent from the simulator. No hidden fault label is used.
    evidence={k:v for k,v in observations.items() if k not in ('ADC_REFERENCE','ADC_RESOLUTION_BITS')}
    d=DiagnosisRequest(system_type='ANALOG_ADC',symptom_type='OTHER',diagnostic_mode='adc_raw_v1',measurements=evidence,available_tools=['MULTIMETER','VISUAL_SETTINGS'])
    result=active_comparison(d)
    result['exercise']='Blind configuration verification: current pin voltage/count retained; Vref and configured resolution withheld for a discriminating next experiment.'
    result['evidence']=evidence
    if not http_request.headers.get('accept','').startswith('text/plain'):return result
    lines=['Suggest Next Experiment — computed from current ADC evidence',result['exercise']]
    for item in result['recommendations']:
        lines += ['',item['policy'],f"Check: {item['check'] or 'No feasible check'}",f"Information gain: {item.get('information_gain_bits')} bits"]
        if item.get('check'):
            tools=TOOLS[item['check']];lines += ['Tool: '+', '.join(tools)]
        if item.get('relative_cost') is not None:lines.append(f"Relative cost: {item['relative_cost']}")
    lines += ['',result['cost_basis'],result['why'],result['promotion']]
    return PlainTextResponse('\n'.join(lines))

class PlotTrace(BaseModel):
    model_config=ConfigDict(extra='forbid')
    type:Literal['scatter'];mode:Literal['lines'];name:str=Field(max_length=80)
    x:list[FiniteFloat]=Field(min_length=32,max_length=4096)
    y:list[FiniteFloat|None]=Field(min_length=32,max_length=4096)
    line:dict[str,Literal['linear','hv']]=Field(max_length=1)
    @model_validator(mode='after')
    def aligned(self):
        if len(self.x)!=len(self.y) or np.any(np.diff(self.x)<=0):raise ValueError('Capture time and sample arrays must align')
        return self

@router.post('/sensor/analyze-capture')
def sensor_capture(request:Annotated[list[PlotTrace],Field(min_length=2,max_length=2)],http_request:Request,method:Literal['temporal','isolation','compare']='compare'):
    if len(request)!=2 or request[0].x!=request[1].x:raise HTTPException(422,'Provide aligned ideal/measured sensor capture')
    if any(v is None for v in request[0].y):raise HTTPException(422,'Reference channel missing')
    rate=1/float(np.median(np.diff(request[0].x)))
    if not 0<rate<=500:raise HTTPException(422,'Sensor capture sample rate must be within 0..500 Hz')
    sr=SensorAnalyzeRequest(ideal=request[0].y,measured=request[1].y,sample_rate_hz=rate,data_source='PYTHON_SIMULATION')
    out={'source':'Current native sensor capture','method':method,'experimental':True}
    if method in ('isolation','compare'):
        out['isolation_forest']=safe(analyze_sensor,sr,ROOT/'models/experimental/sensor_isolation.joblib')
        artifact=ROOT/'models/experimental/sensor_isolation.joblib'
        out['isolation_forest']['model_version']='isolation-forest-'+hashlib.sha256(artifact.read_bytes()).hexdigest()[:12] if artifact.is_file() else 'unavailable'
    if method in ('temporal','compare'):out['temporal']=safe(infer_temporal,[sr.ideal,sr.measured],'sensor',rate,'PYTHON_SIMULATION')
    if not http_request.headers.get('accept','').startswith('text/plain'):return out
    lines=['AI Analysis — Experimental','Input: current chart capture from the latest simulation (up to 512 retained samples)','Model training source: PYTHON_SIMULATION']
    if 'isolation_forest' in out:
        v=out['isolation_forest'];lines += ['','Isolation Forest',f"Model: {v['model_version']}",f"Anomaly: {v.get('anomaly_status','unavailable')}; score {v.get('anomaly_score','unavailable')} (not a probability)",f"Separate engineering rule pattern: {v.get('engineering_pattern','unavailable')}"]
    if 'temporal' in out:
        v=out['temporal'];lines += ['','New temporal CNN',f"Model: {v.get('model_version','unavailable')}",f"Learned pattern: {v.get('predicted_pattern','unavailable')}",f"Pattern probabilities: {json.dumps(v.get('probabilities',{}))}",f"Invocation: {v.get('invocation_id','')}",'Offline full-trace classification; no causal detection-delay claim.','Shift validation showed elevated false alarms (55% at argmax); validate against sensor dynamics before use.']
    return PlainTextResponse('\n'.join(lines))

@router.post('/sensor/temporal')
def sensor_temporal(request:SensorAnalyzeRequest):
    return safe(infer_temporal,[request.ideal,request.measured],'sensor',request.sample_rate_hz,request.data_source)
