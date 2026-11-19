"""Owner-bound two-acquisition workflow, independent of historical research sessions."""
import copy,hashlib,secrets,time,threading
from typing import Literal
import numpy as np
from fastapi import APIRouter,HTTPException,Header
from pydantic import BaseModel,ConfigDict,Field
from ..config import load_config
from ..diagnosis_engine import selected_artifact,predict_probabilities
from .runtime import EvidencePacket,infer
from . import provider
from ..reliable_diagnosis.contract import EvidenceV2,TOOLS

router=APIRouter(prefix='/ai/evidence',tags=['Two-acquisition diagnosis'])
SESSIONS={};LOCK=threading.RLock()
NAMES={'LED_GPIO':'LED and GPIO','DIGITAL_INPUT':'Digital input','ANALOG_ADC':'ADC','I2C_SENSOR':'I²C','UART_DEVICE':'UART','PWM_MOTOR_SERVO':'PWM and motor'}
class Start(BaseModel):
    model_config=ConfigDict(extra='forbid')
    system:str
    scenario:str='Normal'
    seed:int=Field(default=20261115,ge=0,le=2**31-1)
    noise_seed:int|None=Field(default=None,ge=0,le=2**31-1)
    observation_profile:Literal['clean','noisy','missing_channels','no_instruments','no_readbacks','biased','limited_samples','quantized','low_bandwidth']='clean'
    available_tools:list[str]|None=None
    load_type:Literal['dc_motor','servo','stepper']|None=None
    unknown_mechanism:str|None=Field(default=None,max_length=60)
class Capture(BaseModel):
    model_config=ConfigDict(extra='forbid')
    session_id:str=Field(min_length=16,max_length=80)
    revision:int=Field(ge=0,le=4)
    token:str=Field(min_length=32,max_length=80)
class Intervention(Capture):
    action:Literal['restore_supply','repair_wire','correct_polarity','restore_logic_level','reduce_interference','restore_configuration','repair_communication','replace_component','unchanged_repeat']
def actor(value):
    if not 16<=len(value)<=128:raise HTTPException(403,'Native sign-in required')
    return hashlib.sha256(value.encode()).hexdigest()
def model():
    a=selected_artifact()
    if 'paired_model'not in a and 'reliability_model'not in a:raise HTTPException(503,'Acquired-evidence release is not active')
    return a
@router.get('/catalog')
def catalog(x_native_session:str=Header(default='')):
    actor(x_native_session);a=model()
    modern='reliability_model'in a
    upgrade='diagnostic_upgrade'in a
    from ..diagnostic_upgrade.simulation import ACTION_CAUSES
    return dict(model_version=a['_loaded_identity']['model_version'],source='CONTROLLED_SIMULATION',systems={s:dict(name=NAMES[s],scenarios=v['applicable_faults']+(['Mixed','Unknown'] if modern else []),operations=['unchanged_repeat']+[act for act,cause in ACTION_CAUSES.items()if cause in v['applicable_faults']]if upgrade else [])for s,v in load_config('systems').items()},capture_budget=4 if upgrade else 3 if modern else 2,samples_per_capture=64,
                evidence_version='acquired-evidence-v2' if modern else 'two-acquisition-v1',observation_profiles=(['clean','noisy','missing_channels','no_instruments','no_readbacks','biased','limited_samples']+(['quantized','low_bandwidth']if upgrade else [])) if modern else ['clean'],
                available_tools=list(TOOLS) if modern else ['SIMULATION'],
                corrective_retest=upgrade,max_corrective_operations=2 if upgrade else 0,
                unknown_mechanisms=['source_oscillation','contact_switching','thermal_drift','delayed_contact','supply_recovery','thermal_hysteresis']if upgrade else [],
                task_registry=[dict(task='Fault ranking',algorithm='Six-system observed-evidence classifiers',inputs='Observed readings; up to four acquisitions and optional corrective retest'if upgrade else 'Observed readings and requested acquisitions'),dict(task='Student learning recommendations',algorithm='Assessment and topic mastery ranking',inputs='Answers, level and saved progress'),dict(task='Circuit voltages and timing',algorithm='Deterministic circuit and protocol models',inputs='Wiring, component values and firmware'),dict(task='Sensor and waveform specialists',algorithm='Task-specific signal models',inputs='Validated signal captures')])
def response(st):
    if 'reliability_model'in st['artifact']:return response_v2(st)
    n=len(st['captures']);result=None;packet=None
    if n==2:
        packet=EvidencePacket(system=st['system'],measurements=st['measurements'],observations=st['observations'],captures=st['captures'],instruments=st['instruments'])
        result=infer(packet,st['artifact'])
    proposal=None if n==2 else dict(number=n+1,action='sweep'if n==0 else'endpoint',stimulus_fraction=.15 if n==0 else .85,time_s=.12 if n==0 else 2.,samples=64,
            instruction='Acquire the signal at 15% stimulus after 120 ms.'if n==0 else'Acquire the 85% endpoint after 2 s, including the available instrument readbacks.')
    return dict(session_id=st['id'],revision=n,token=st['token'],system=st['system'],model_version=st['artifact']['_loaded_identity']['model_version'],source='CONTROLLED_SIMULATION',
                initial_ranking=st['initial'],measurements=st['measurements'],observations=st['observations'],captures=st['captures'],instruments=st['instruments'],proposal=proposal,result=result,
                evidence=packet.model_dump()if packet else None,expires_in_seconds=max(0,int(st['created']+900-time.time())),configured_scenario=st['scenario'],
                scenario_used_by_classifier=False,reproducibility={'seed':st['seed'],'noise_seed':st['noise_seed']})
@router.post('/start')
def start(req:Start,x_native_session:str=Header(default='')):
    who=actor(x_native_session);art=model();systems=load_config('systems')
    modern='reliability_model'in art
    upgrade='diagnostic_upgrade'in art
    if (req.unknown_mechanism or req.observation_profile in ('quantized','low_bandwidth'))and not upgrade:raise HTTPException(422,'This model version does not support the requested experiment')
    mechanisms=('source_oscillation','contact_switching','thermal_drift','delayed_contact','supply_recovery','thermal_hysteresis')
    if req.unknown_mechanism and(req.unknown_mechanism not in mechanisms or req.scenario!='Unknown'):raise HTTPException(422,'Choose an available unknown mechanism for an Unknown scenario')
    if req.system not in systems or req.scenario not in systems[req.system]['applicable_faults']+(['Mixed','Unknown'] if modern else []):raise HTTPException(422,'Unsupported system or controlled scenario')
    if req.available_tools is not None and (not req.available_tools or set(req.available_tools)-set(TOOLS) or len(set(req.available_tools))!=len(req.available_tools)):raise HTTPException(422,'Choose supported acquisition tools')
    with LOCK:
        expired=[k for k,v in SESSIONS.items()if v['created']+900<time.time()]
        for k in expired:SESSIONS.pop(k)
        # One current experiment per native owner; no growing stale sessions.
        for k in [k for k,v in SESSIONS.items()if v['actor']==who]:SESSIONS.pop(k)
        if len(SESSIONS)>=128:raise HTTPException(429,'Experiment capacity reached')
        rng=np.random.default_rng(req.seed)
        if modern:
            from ..reliable_diagnosis.physics import create_parameters
            choices=[c for c in systems[req.system]['applicable_faults'] if c!='Normal'];secondary=None;root=req.scenario
            if root=='Mixed':root,secondary=rng.choice(choices,2,replace=False).tolist()
            nominal,_,_=create_parameters(req.system,'Normal',copy.deepcopy(rng))
            if upgrade and root=='Unknown':
                from ..selective_diagnosis.scenarios import create
                mechanism=req.unknown_mechanism or 'source_oscillation'
                p,d,truth=create(req.system,root,rng,0,None,None,mechanism)
                if mechanism in ('delayed_contact','supply_recovery','thermal_hysteresis'):
                    p.pop('expanded_mechanism',None);p['extended_mechanism']=mechanism;p['extended_amplitude']=float(rng.uniform(.08,.65))
            else:p,d,truth=create_parameters(req.system,root,rng,secondary=secondary,mechanism='load_oscillation' if req.system=='PWM_MOTOR_SERVO' else 'supply_ripple')
            if req.load_type and req.system=='PWM_MOTOR_SERVO':p['motor_type']=req.load_type
            st=dict(id=secrets.token_hex(16),token=secrets.token_hex(24),actor=who,created=time.time(),system=req.system,scenario=req.scenario,seed=req.seed,noise_seed=req.noise_seed if req.noise_seed is not None else req.seed,parameters=p,declared=d,
                    measurements={},observations={},captures=[],instruments=None,artifact=art,initial=[],profile=req.observation_profile,tools=req.available_tools or ['SIMULATION'],nominal=nominal,phase=0,history=[],raw_history=[])
            SESSIONS[st['id']]=st;return response(st)
        p=provider.parameters(req.system,req.scenario,rng,'gaussian')
        declared=dict(rail=p['rail'],command=p['command'],bits=p['bits'],baud=p['baud'],hz=p['hz'],nominal_load=p['rload'])
        initial_rng=rng if req.noise_seed is None or req.noise_seed==req.seed else np.random.default_rng(req.noise_seed)
        m,o=provider.initial(p,req.system,declared,initial_rng,'complete')
        st=dict(id=secrets.token_hex(16),token=secrets.token_hex(24),actor=who,created=time.time(),system=req.system,scenario=req.scenario,seed=req.seed,noise_seed=req.noise_seed if req.noise_seed is not None else req.seed,parameters=p,declared=declared,measurements=m,observations=o,captures=[],instruments=None,artifact=art)
        st['initial']=predict_probabilities(req.system,'OTHER',m,art['_loaded_identity']['model_version'])
        SESSIONS[st['id']]=st
        return response(st)
@router.post('/capture')
def capture(req:Capture,x_native_session:str=Header(default='')):
    who=actor(x_native_session)
    with LOCK:
        st=SESSIONS.get(req.session_id)
        if not st or st['actor']!=who or st['created']+900<time.time():raise HTTPException(403,'Experiment expired or belongs to another session')
        n=len(st['captures'])
        upgrade='diagnostic_upgrade'in st['artifact'];budget=4 if upgrade else 3 if 'reliability_model'in st['artifact']else 2
        if req.revision!=n or not secrets.compare_digest(req.token,st['token'])or n>=budget:raise HTTPException(409,'This acquisition was already used; start a fresh experiment')
        if 'reliability_model'in st['artifact']:
            from ..reliable_diagnosis.physics import readout
            from ..reliable_diagnosis.provider import measure_capture,initial_observations
            proposal=response_v2(st)['proposal']
            if proposal is None:raise HTTPException(409,'No further acquisition is proposed for this experiment')
            step=dict(action=proposal['action'],command_fraction=proposal['stimulus_fraction'],time_s=proposal['time_s'])
            if upgrade:
                from ..diagnostic_upgrade.simulation import observe
                from ..selective_diagnosis.scenarios import packet as make_packet
                seed=st['noise_seed']+st['phase']*100003
                raw=observe(st['parameters'],st['system'],st['declared'],step['command_fraction'],step['time_s'],np.random.default_rng(seed+7919*(n+1)))
                st['raw_history'].append((step,raw));measured=make_packet(st['system'],st['declared'],st['parameters']['motor_type'],st['raw_history'],st['profile'],seed+300,count=n+1,tools=st['tools'])
                st['captures']=measured['captures'];c=st['captures'][-1]
            else:
                raw=readout(st['parameters'],st['system'],st['declared'],step['command_fraction'],step['time_s'],np.random.default_rng(st['noise_seed']+7919*(n+1)))
                c=measure_capture((step,raw),n,st['profile'],np.random.default_rng(st['noise_seed']+300+n),st['tools']);st['captures'].append(c)
            if n==0:
                st['measurements'],st['observations']=initial_observations(st['system'],st['declared'],c)
                st['initial']=predict_probabilities(st['system'],'OTHER',st['measurements'],st['artifact']['_loaded_identity']['model_version'])
            st['token']=secrets.token_hex(24);return response(st)
        c=provider.capture(st['parameters'],st['system'],st['declared'],'sweep'if n==0 else'endpoint',n,st['noise_seed']+8713*(n+1)+3571*n,'complete')
        instrument=provider.acquire(st['parameters'],st['system'],st['declared'],'complete',st['noise_seed']+431)if n==1 else None
        st['captures'].append(c);st['instruments']=instrument;st['token']=secrets.token_hex(24)
        return response(st)
@router.post('/intervene')
def intervene(req:Intervention,x_native_session:str=Header(default='')):
    who=actor(x_native_session)
    with LOCK:
        st=SESSIONS.get(req.session_id)
        if not st or st['actor']!=who or st['created']+900<time.time():raise HTTPException(403,'Experiment expired or belongs to another session')
        if 'diagnostic_upgrade'not in st['artifact']:raise HTTPException(422,'This model does not support corrective retesting')
        if req.revision!=len(st['captures'])or not secrets.compare_digest(req.token,st['token']):raise HTTPException(409,'This experiment has changed; use the current action token')
        if len(st['captures'])<2 or st['phase']>=2:raise HTTPException(409,'Acquire the baseline first; at most two corrective operations are allowed')
        from ..diagnostic_upgrade.simulation import correct,ACTION_CAUSES
        if req.action!='unchanged_repeat'and ACTION_CAUSES[req.action]not in load_config('systems')[st['system']]['applicable_faults']:raise HTTPException(422,'Choose an operation applicable to this electronic system')
        before=response_v2(st);st['history'].append(dict(phase=st['phase'],action=req.action,evidence=before['evidence'],result=before['result']))
        st['parameters']=correct(st['parameters'],st['nominal'],req.action);st['phase']+=1;st['captures']=[];st['raw_history']=[];st['measurements']={};st['observations']={};st['initial']=[];st['token']=secrets.token_hex(24)
        return response_v2(st)
@router.post('/analyze')
def analyze(packet:EvidenceV2|EvidencePacket,x_native_session:str=Header(default='')):
    actor(x_native_session);art=model()
    return dict(model_version=art['_loaded_identity']['model_version'],source='USER_SUPPLIED_CONTROLLED_SIMULATION',result=infer(packet,art),evidence=packet.model_dump(),
                acquisition_origin_verified=False,warning='Imported simulated readings are user supplied; they are not verified hardware measurements.')

def response_v2(st):
    from ..reliable_diagnosis.policy import next_acquisition
    packet=EvidenceV2(system=st['system'],measurements=st['measurements'],observations=st['observations'],declared=st['declared'],load_type=st['parameters']['motor_type'],available_tools=st['tools'],captures=st['captures'])
    n=len(st['captures']);result=infer(packet,st['artifact']) if n>=2 else None
    upgrade='diagnostic_upgrade'in st['artifact']
    if upgrade:
        from ..diagnostic_upgrade.observations import plan
        from ..diagnostic_upgrade.runtime import compare
        proposal=plan(packet,result)
    else:proposal=next_acquisition(packet,result)
    history=st.get('history',[])if upgrade else []
    retest=compare(history[-1]['result'],result,history[-1]['action'])if history else None
    if retest:
        from ..diagnostic_upgrade.runtime import measurement_changes
        retest['observed_changes']=measurement_changes(history[-1]['evidence'],packet.model_dump())
    return dict(session_id=st['id'],revision=n,token=st['token'],system=st['system'],model_version=st['artifact']['_loaded_identity']['model_version'],source='CONTROLLED_SIMULATION',
                initial_ranking=st['initial'],measurements=st['measurements'],observations=st['observations'],captures=st['captures'],instruments=None,proposal=proposal,result=result,
                evidence=packet.model_dump() if n else None,expires_in_seconds=max(0,int(st['created']+900-time.time())),configured_scenario=st['scenario'],
                scenario_used_by_classifier=False,capture_budget=4 if upgrade else 3,observation_profile=st['profile'],acquired_samples=sum(c['samples'] for c in st['captures']),
                reproducibility={'seed':st['seed'],'noise_seed':st['noise_seed']},
                acquired_virtual_duration_s=sum(c['time_s'] for c in st['captures']),corrective_retest=upgrade,phase=st.get('phase',0),retest=retest,intervention_history=history,
                intervention_available=upgrade and n>=2 and st.get('phase',0)<2,
                total_acquisitions=n+sum(len(h['evidence']['captures'])for h in history))
