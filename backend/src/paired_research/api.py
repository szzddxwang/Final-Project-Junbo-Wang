"""Native generalization endpoints; retained v2 and production contracts unchanged."""
import json
from typing import Literal
import numpy as np
from fastapi import APIRouter,HTTPException
from pydantic import BaseModel,ConfigDict,Field,model_validator
from ..config import load_config
from ..schemas import DiagnosisRequest
from ..virtual_lab.schemas import MultimodalRequest,ADCModelRequest,ADCEstimateRequest,I2CRequest
from ..virtual_lab.adc_model import estimate_reference,simulate_adc
from ..reliability.api import advanced_view,safe,adc as old_adc,i2c as old_i2c
from ..reliability.presentation import Presentation,Summary,Execution,Finding,Metric,metric,execution,candidates,human
from ..reliability.inference import engineering_record
from ..diagnosis_engine import diagnose
from .inference import paired,expert,unknown
from .data import paired_event,SYSTEMS
router=APIRouter(prefix='/ai/generalization',tags=['Generalization v3 native research'])

def compact(view):
    labels={'Structured diagnosis':'XGBoost Diagnosis','Waveform pattern model':'Waveform AI','Temporal CNN v2':'Waveform AI · CNN','Physical-feature Random Forest':'Physics Evidence · RF','System evidence combination':'Multimodal Fusion · v2','ADC paired fusion':'Multimodal Fusion · ADC','Uncertainty and OOD':'Unknown Pattern Check'}
    for e in view.model_executions:
        e.short_name=e.short_name or labels.get(e.name,e.name)
        if e.model_version.startswith('adc-raw-'):e.short_name='ADC Evidence Model'
        if e.name=='ADC paired root fusion':e.short_name='Multimodal Fusion · ADC'
        if e.name=='ADC system evidence combination':e.short_name='Multimodal Fusion · v2'
        if e.name=='Unknown-pattern assessment':e.short_name='Unknown Pattern Check · v2'
        e.method_kind=e.method_kind or ('Engineering calculation' if e.model_version.startswith('engineering-') or any(k in e.name.lower() for k in ('calculation','consistency','rules')) else 'Experimental ML' if e.experimental else 'Production ML')
        e.input_modality=e.input_modality or ('Captured waveform' if 'waveform' in e.name.lower() or 'cnn' in e.name.lower() else 'Available measurements')
    view.summary.message='Experimental models; validate before real-device use.' if any(e.experimental and e.state=='EXECUTED' for e in view.model_executions) else view.summary.message
    view.summary.agreement='Scores have different training scopes; compare evidence, not percentages.'
    return view

def add_new(view,system,measurements,structured,samples=None,configured=None,research_revision='retained_v3'):
    # A stable model can emit a prior with no readings. That distribution is
    # retained in the stable view, but is not an observed fusion modality.
    observed_structured = structured if measurements else {}
    if system in ('I2C_SENSOR','UART_DEVICE','PWM_MOTOR_SERVO','LED_GPIO'):
        result=safe(expert,system,measurements,structured);e=execution('Revised system expert',result);e.short_name='Physics Evidence · revised';e.method_kind='Experimental ML';e.input_modality='Structured measurements';view.model_executions.append(e);view.provenance['revised_expert']=result
    if system in SYSTEMS:
        infer=paired
        if research_revision=='observable_v4':
            from .observable_runtime import observable_paired
            infer=observable_paired
        result=({'execution_state':'NOT_RUN_MISSING_INPUT','reason':'No observed measurements or waveform'}
                if not measurements and samples is None else safe(infer,system,measurements,observed_structured,samples,configured))
        e=execution('Paired evidence fusion',result);e.short_name='Multimodal Fusion · observable v4' if research_revision=='observable_v4' else 'Multimodal Fusion · paired';e.input_modality=result.get('evidence_note','Available evidence');e.method_kind='Experimental ML';view.model_executions.append(e);view.provenance['paired_fusion']=result
    if system=='ANALOG_ADC':
        result=safe(unknown,samples);e=execution('Unknown Pattern Check',result);e.short_name='Unknown Pattern Check';e.input_modality='Dynamic reference and ADC capture';e.method_kind='Experimental ML';view.model_executions.append(e);view.provenance['mechanistic_ood']=result
    return compact(view)

@router.post('/troubleshooting/advanced',response_model=Presentation)
def advanced(req:MultimodalRequest):
    view,stable=advanced_view(req,return_diagnosis=True);system=req.diagnosis.system_type if req.diagnosis else req.waveform.system_type
    measurements=req.diagnosis.measurements if req.diagnosis else {};allowed=load_config('systems')[system]['available_measurements'];measurements={k:v for k,v in measurements.items() if k in allowed}
    structured={c.label: c.probability for c in []}
    if stable:structured={v.fault:v.probability for v in stable.diagnosis}
    # Existing ADC waveform has all required declared/observed channels. Other
    # systems require the typed paired contract; never manufacture captures.
    samples=req.waveform.samples if req.waveform and system=='ANALOG_ADC' else None
    return add_new(view,system,measurements,structured,samples,{} if samples else None)

@router.post('/device/adc/advanced',response_model=Presentation)
def adc(req:ADCModelRequest):
    view=old_adc(req);sim=simulate_adc(req);samples=[sim['chart'][k] for k in ('commanded_v','pin_v','adc_reconstructed_v')]
    # New research head sees declared target reference only, not hidden actual
    # converter configuration from the simulation's raw diagnosis evidence.
    m={'OUTPUT_VOLTAGE':float(np.mean(samples[1])),'EXPECTED_OUTPUT_VOLTAGE':float(np.mean(samples[0])),'ADC_READING':float(np.mean(sim['chart']['adc_counts'])),'EXPECTED_ADC_READING':float(np.mean(samples[0])/req.target_reference_voltage*(1<<req.target_resolution_bits)),'ADC_REFERENCE':req.target_reference_voltage}
    stable=diagnose(DiagnosisRequest(system_type='ANALOG_ADC',symptom_type='OTHER',measurements=m));structured={v.fault:v.probability for v in stable.diagnosis}
    view=add_new(view,'ANALOG_ADC',m,structured,samples,{})
    # The learner deliberately supplied these converter settings. Research
    # predictions remain available, but are not an unknown hardware diagnosis.
    view.summary.verdict='Known ADC settings compared'
    view.summary.message=(f"The simulated first count is {sim['simulated_count']}. "
        f"You selected {req.resolution_bits} bits and a {req.target_resolution_bits}-bit target. "
        'These are known simulation settings, not an independently diagnosed hardware fault.')
    view.summary.next_action='Keep the input fixed. Change one converter setting, then choose Run & Compare.'
    view.summary.source='Controlled Python simulation'
    return view

@router.post('/device/adc/estimate',response_model=Presentation)
def estimate(req:ADCEstimateRequest):
    result=estimate_reference(req);bounded=result['estimate_v'] is not None
    view=Presentation(summary=Summary(title='ADC physical estimate',verdict='Reference voltage estimated' if bounded else 'Reference cannot be bounded',message='Analytical simulation estimate.',next_action='Measure Vref independently and compare with the estimate.',source='Analytical simulation estimate'))
    view.simulation_summary=[Metric(label='Estimated Vref',value=result['estimate_v'],unit='V',display=f"{result['estimate_v']:.3f} V" if bounded else 'Not identifiable')]
    if bounded:
        lo,hi=result['interval_v'];view.simulation_summary.append(Metric(label='Quantization-consistent interval',display=f'({lo:.3f}, {hi:.3f}] V',unit='V',description='Quantization interval; not a statistical confidence interval.'))
        predicted=int(np.floor(req.input_voltage/result['estimate_v']*(1<<req.resolution_bits)));view.simulation_summary.append(metric('Reconstruction residual',req.observed_count-predicted,'counts',0))
    view.findings=[Finding(title='Method',description='Analytical inversion of the ADC quantization bin.'),Finding(title='Assumptions',description=result['assumptions']),Finding(title='Derivation',description='k = floor(Vpin × 2^bits / Vref); for interior codes, Vpin × 2^bits/(k+1) < Vref ≤ Vpin × 2^bits/k.')]
    calc=engineering_record('adc_quantization_inverse',result,req.model_dump(),'src/virtual_lab/adc_model.py');e=execution('Physics Evidence',calc);e.result='Bounded Vref estimate' if bounded else 'Boundary code; unidentifiable';e.method_kind='Engineering calculation';e.input_modality='Same-sample pin voltage and count';view.model_executions=[e];view.provenance={'full_precision':result,'input':req.model_dump()};view.limitations=['This is a quantization-consistent interval, not a confidence interval.']
    return view

class PairedRequest(BaseModel):
    model_config=ConfigDict(extra='forbid')
    diagnosis:DiagnosisRequest
    samples:list[list[float]]|None=None
    configured:dict=Field(default_factory=dict)
    research_revision:Literal['retained_v3','observable_v4']='retained_v3'
    research_feature_version:str|None=None
    research_artifact_sha256:str|None=None
    @model_validator(mode='after')
    def check(self):
        if self.research_revision=='retained_v3' and (self.research_feature_version is not None or self.research_artifact_sha256 is not None):
            raise ValueError('Research pins require an explicit observable_v4 revision')
        if self.research_revision=='observable_v4' and self.diagnosis.diagnostic_mode!='stable':
            raise ValueError('Observable revision requires the stable observable diagnosis contract')
        if self.samples is not None:
            a=np.asarray(self.samples,float)
            if a.ndim!=2 or not 2<=a.shape[0]<=4 or not 64<=a.shape[1]<=4096 or not np.isfinite(a).all():raise ValueError('Invalid bounded capture')
        allowed={'vdd','sample_rate_hz','samples_per_bit','baud','parity','nominal_speed','nominal_tau','nominal_current','series_resistance_ohm','nominal_forward_voltage','declared_reference','declared_bits','source'}
        if set(self.configured)-allowed:raise ValueError('Only configured references are allowed')
        for k,v in self.configured.items():
            if isinstance(v,(int,float)) and (not np.isfinite(v) or v<=0):raise ValueError('Configured quantities must be finite and positive')
        if self.samples is not None:
            system=self.diagnosis.system_type
            channels={'ANALOG_ADC':3,'UART_DEVICE':3,'I2C_SENSOR':2,'DIGITAL_INPUT':2,'LED_GPIO':4,'PWM_MOTOR_SERVO':4}
            required={'UART_DEVICE':('vdd','sample_rate_hz','baud'),'PWM_MOTOR_SERVO':('vdd','sample_rate_hz','nominal_speed','nominal_current','nominal_tau'),'LED_GPIO':('vdd','series_resistance_ohm','nominal_forward_voltage')}
            if self.research_revision=='observable_v4':required['I2C_SENSOR']=('vdd','samples_per_bit')
            if system not in channels or len(self.samples)!=channels[system]:raise ValueError('Capture channels do not match the electronic system')
            for key in required.get(system,()):
                value=self.configured.get(key)
                if isinstance(value,bool) or not isinstance(value,(int,float)) or not np.isfinite(value) or value<=0:raise ValueError('Missing or invalid configured reference: '+key)
            if system=='UART_DEVICE':
                if not 4<=self.configured['sample_rate_hz']/self.configured['baud']<=256:raise ValueError('Unsupported UART sample density')
                if self.configured.get('parity','NONE') not in ('NONE','EVEN','ODD'):raise ValueError('Unsupported parity')
        return self

@router.post('/paired/analyze',response_model=Presentation)
def analyze(req:PairedRequest):
    if req.research_revision=='observable_v4':
        from .observable_runtime import package
        try:package(req.diagnosis.system_type,req.research_feature_version,req.research_artifact_sha256)
        except ValueError as exc:raise HTTPException(status_code=422,detail=str(exc)) from exc
        except OSError as exc:raise HTTPException(status_code=503,detail='Requested research artifact is unavailable') from exc
    view,s=advanced_view(MultimodalRequest(diagnosis=req.diagnosis),return_diagnosis=True);structured={v.fault:v.probability for v in s.diagnosis}
    view=add_new(view,req.diagnosis.system_type,req.diagnosis.measurements,structured,req.samples,req.configured,req.research_revision)
    if req.samples:
        # Remove only legacy unavailable entries that describe a missing
        # waveform: the new paired invocation now actually used it.
        view.model_executions=[e for e in view.model_executions if e.name not in ('Waveform pattern model','Learned waveform fusion','Unknown-pattern assessment')]
        result=view.provenance['paired_fusion'];wp=result.get('waveform_probabilities',{})
        if wp:
            top=max(wp,key=wp.get);e=Execution(name='Waveform AI',short_name='Waveform AI',state='EXECUTED',result=human(top),score=f'{max(wp.values()):.1%} root score',scope='Waveform branch of the same paired artifact invocation.',model_version=result['model_version'],artifact_hash=result['artifact_sha256'],invocation_id=result['invocation_id'],executed_at=result['executed_at'],method_kind='Experimental ML',input_modality='Protocol / dynamics capture');view.model_executions.append(e)
        view.provenance['paired_capture']={'configured':req.configured,'channels':len(req.samples),'samples':len(req.samples[0])}
    return view

class DemoRequest(BaseModel):
    model_config=ConfigDict(extra='forbid')
    system_type:str='UART_DEVICE';fault_type:str='Normal';group:int=Field(default=14501,ge=14000,le=99999);condition:Literal['id','shift']='id'
    @model_validator(mode='after')
    def check(self):
        near=self.system_type=='ANALOG_ADC' and self.fault_type=='NearUnknownAttenuation'
        if self.system_type not in SYSTEMS or (not near and self.fault_type not in load_config('systems')[self.system_type]['applicable_faults']):raise ValueError('Unsupported system/fault')
        return self

@router.post('/paired/simulate',response_model=Presentation)
def demo(req:DemoRequest):
    if req.fault_type=='NearUnknownAttenuation':
        from ..midterm.data import adc_wave
        samples,fs,meta=adc_wave('SIGNAL_ATTENUATION',req.group,seed=2026101401,scenario=req.condition)
        reference=float(meta['target_reference'])
        m={'OUTPUT_VOLTAGE':float(np.mean(samples[1])),'EXPECTED_OUTPUT_VOLTAGE':float(np.mean(samples[0])),'ADC_READING':float(np.mean(samples[2])/reference*4096),'EXPECTED_ADC_READING':float(np.mean(samples[0])/reference*4096),'ADC_REFERENCE':reference}
        r={'measurements':m,'samples':samples.tolist(),'configured':{'declared_reference':reference,'declared_bits':12,'sample_rate_hz':fs},'case_id':f'near-adc-{req.group}','group_id':f'adc-{req.group}','condition':req.condition,'generator':'held_out_attenuation_simulator','source':'PYTHON_SIMULATION'}
    else:r=paired_event(req.system_type,req.fault_type,req.group,req.condition)
    view=analyze(PairedRequest(diagnosis=DiagnosisRequest(system_type=req.system_type,symptom_type='OTHER',measurements=r['measurements']),samples=r['samples'],configured=r['configured']))
    view.summary.title='Paired circuit experiment';view.summary.source='One-event physical simulation';view.summary.next_action='Change one injection or operating condition and repeat the same paired experiment.'
    view.provenance['simulation']={k:r[k] for k in ('case_id','group_id','condition','generator','source')};view.provenance['known_injection_for_evaluation_only']=req.fault_type
    view.simulation_summary=[metric('Observed channels',len(r['samples']),digits=0),metric('Captured samples',len(r['samples'][0]),digits=0)]
    return view
