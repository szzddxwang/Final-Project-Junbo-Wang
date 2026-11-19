from pathlib import Path
from functools import lru_cache
import hashlib,hmac,secrets,threading,time,json,os
import numpy as np
import joblib
from fastapi import APIRouter,HTTPException,Header
from pydantic import BaseModel,ConfigDict,Field
from research.simulation_active_experiments_20261101.circuits import SPECS,VirtualDevice,describe_action
from research.integrated_active_simulation_20261101.core import VERSION,choose,fit,intervals,features,challenge,mismatch
from .adapters import baseline,canonical,LEDWorld
from src.diagnosis_engine import predict_probabilities
from research.simulation_active_experiments_20261101.engine import choose as retained_choose,fit as retained_fit
from research.targeted_active_repair_20261101 import core as repair

OUT=Path(__file__).resolve().parents[2]/'results/integrated_active_simulation_20261101'
REPAIR_OUT=OUT.parent/'targeted_active_repair_20261101'
@lru_cache(maxsize=1)
def repair_release():
    path=REPAIR_OUT/'RUNTIME_RELEASE.json'
    if os.environ.get('MICROEXPLORE_ACTIVE_TARGETED','1')=='0' or not path.exists():return None
    certificate=json.loads(path.read_text())
    for rel,digest in certificate['files'].items():
        if hashlib.sha256((OUT.parents[1]/rel).read_bytes()).hexdigest()!=digest:raise RuntimeError('Targeted research release hash mismatch')
    return certificate,json.loads((REPAIR_OUT/'CALIBRATION.json').read_text())['artifacts']

def runtime_spec(system):
    release=repair_release()
    return repair.rig(system,release[0]['PWM']['runtime_policy']) if release else SPECS[system]

def runtime_challenge(spec,history,assessment):
    release=repair_release()
    return repair.challenge(spec,history,assessment,release[0]['LED']['high_probe_released']) if release else challenge(spec,history,assessment)

def runtime_check(spec,history):
    release=repair_release()
    return repair.mismatch(spec,history,release[1]['LED_CHECK']['q']) if release and spec.system=='LED_GPIO' and release[0]['LED']['high_probe_released'] else mismatch(spec,history)
router=APIRouter(prefix='/ai/active-simulation',tags=['Active simulation research'])
SESSIONS={};LOCK=threading.RLock();SECRET=secrets.token_bytes(32)
class Start(BaseModel):
    model_config=ConfigDict(extra='forbid')
    system:str
    seed:int=Field(default=2026110791,ge=0,le=2**31-1)
    noise_seed:int|None=Field(default=None,ge=0,le=2**31-1)
    parameters:list[float]|None=None
    profile:str='nominal'
class Capture(BaseModel):
    model_config=ConfigDict(extra='forbid')
    session_id:str=Field(max_length=80)
    revision:int=Field(ge=0,le=5)
    token:str=Field(max_length=128)
    action_code:str=Field(max_length=80)

def runtime_fit(spec,history):
    release=repair_release()
    if release:return repair.fit(spec,history,release[0]['PWM']['runtime_policy'])
    return retained_fit(spec,history) if spec.system=='PWM_MOTOR_SERVO' else fit(spec,history)
def runtime_choose(spec,history,estimate):
    release=repair_release()
    if release:return repair.choose(spec,history,estimate,release[0]['PWM']['runtime_policy'])
    return retained_choose(spec,history,estimate) if spec.system=='PWM_MOTOR_SERVO' else choose(spec,history,estimate)

def enabled():
    if not (OUT/'FEATURE_ENABLED').is_file():raise HTTPException(503,'Active simulation research is disabled. Existing Labs and stable diagnosis remain available.')
def actor(value):
    if not 16<=len(value)<=128:raise HTTPException(403,'Native Lab session required')
    return hashlib.sha256(value.encode()).hexdigest()
def token(s):return hmac.new(SECRET,f"{s['id']}:{len(s['history'])}:{s['actor']}".encode(),hashlib.sha256).hexdigest()
@lru_cache(maxsize=1)
def artifacts():
    lock=json.loads((OUT/'ASSET_HASHES.json').read_text());path=OUT/'parameter_model.joblib'
    if hashlib.sha256(path.read_bytes()).hexdigest()!=lock['artifacts'][path.name]:raise RuntimeError('Research artifact hash mismatch')
    c=OUT/'PARAMETER_CALIBRATION.json'
    if hashlib.sha256(c.read_bytes()).hexdigest()!=lock['artifacts'][c.name]:raise RuntimeError('Calibration hash mismatch')
    return joblib.load(path),json.loads(c.read_text())['artifacts']

@router.get('/catalog')
def catalog():
    return dict(version=repair.VERSION if repair_release() else VERSION,production_replaced=False,simulation_only=True,systems={s:dict(parameters=list(spec.parameters),lower=list(spec.lower),upper=list(spec.upper),actions=[dict(code=a.code,controls=describe_action(spec,a)) for a in spec.actions]) for s in SPECS for spec in [runtime_spec(s)]},capture_budget=4,optional_model_check_captures=1)

def response(st):
    spec=runtime_spec(st['system']);history=st['history'];n=len(history);parameter_history=history[:4];a=runtime_fit(spec,parameter_history)
    proposal=(runtime_choose(spec,history,a['normalized_estimate']) if n<4 else runtime_challenge(spec,history,a) if n==4 else None)
    models,cal=artifacts();bands=intervals(spec,parameter_history,a,cal) if n>=4 else dict(status='WAITING_FOR_FOUR_CAPTURES',intervals=None)
    if n>=4:
        evidence=json.loads((OUT/'INTERVAL_GATES.json').read_text())['summary'][spec.system]
        bands['independent_benchmark']=dict(coverage=evidence['coverage'],issued=evidence['issued'],test_groups=evidence['n'],mean_normalized_width=evidence['mean_width'])
        if spec.system=='PWM_MOTOR_SERVO':
            bands.update(status='NOT_VALIDATED: original PWM planner retained; candidate interval calibration does not apply',intervals=None)
        elif evidence['coverage'] is None or evidence['coverage']<.95 or evidence['mean_width']>.35:
            bands.update(status=f'NOT_VALIDATED: independent coverage {evidence["coverage"]:.1%} missed95% target; no interval issued',intervals=None)
    release=repair_release()
    if n>=4 and release and spec.system in release[0]['intervals']:
        evidence=release[0]['intervals'][spec.system]
        if evidence['issue_allowed']:
            bands=repair.intervals(spec,parameter_history,release[1][spec.system]['q'])
            bands['independent_benchmark']={k:evidence[k] for k in ['coverage','issued','n','mean_width','abstentions']}
        else:bands=dict(status='NOT_VALIDATED: targeted independent interval gate failed; no interval issued',intervals=None,independent_benchmark=evidence)
    original=predict_probabilities(spec.system,'INCORRECT_OUTPUT',canonical(spec,parameter_history))
    fusion=dict(status='WAITING_FOR_FOUR_ACTUAL_CAPTURES',fault_ranking=[],candidate_set=models['labels'],root_fault=None)
    if n>=4 and spec.system!='PWM_MOTOR_SERVO':
        x=features(spec,parameter_history,a,baseline(spec,parameter_history));m=models['models']['parameter_fusion'];p=m['model'].predict_proba(x[None,:m['width']])[0]
        candidates=[c for c,v in zip(models['labels'],p) if v>=1-m['q']]
        if not candidates:candidates=list(models['labels'])
        supported=a['data_rank']==len(spec.parameters) and len(candidates)==1 and bands['intervals'] is not None and spec.system not in {'DIGITAL_INPUT','LED_GPIO'}
        if not supported and len(candidates)==1:candidates=list(models['labels'])
        fusion=dict(status='SUPPORTED_SIMULATION_CANDIDATE' if supported else 'INSUFFICIENT_EVIDENCE',fault_ranking=sorted([dict(fault=c,probability=float(v)) for c,v in zip(models['labels'],p)],key=lambda r:-r['probability']),candidate_set=candidates,root_fault=candidates[0] if supported else None,
                    scope='New four-mechanism simulated task; not a passed49-class production replacement',unknown_or_mixed_fault_not_excluded=True)
    elif n>=4:fusion.update(status='PWM_CANDIDATE_FUSION_NOT_RELEASED',root_fault=None)
    check=runtime_check(spec,history) if n>=5 else None
    if check and check['detected']:
        fusion.update(status='MODEL_MISMATCH_REVIEW',root_fault=None,candidate_set=models['labels'],fault_ranking=[],unvalidated_model_scores_withheld=True)
        bands.update(status='MODEL_MISMATCH: no supported parameter interval issued',intervals=None)
    prepared=None if proposal is None else dict(action_code=proposal['action'].code,controls=describe_action(spec,proposal['action']),reason=proposal['reason'],state='PROPOSED_NOT_RUN',observed_values=None,additional_capture=n>=4)
    comparison=[]
    if n>=4:
        truth=st['world'].audit_truth()['parameters']
        comparison=[dict(parameter=k,configured=truth[k],estimated=a['estimated_parameters'][k],interval=(bands['intervals'] or {}).get(k)) for k in spec.parameters]
    explanation=dict(task='Identify a virtual circuit from executed experiments.',observation=f'{n} actual virtual captures recorded; sensitivity rank {a["data_rank"]}/{len(spec.parameters)}.',why='Parameter evidence updates a shared research candidate model; an abnormal parameter does not uniquely identify a fault.',try_next=prepared['reason'] if prepared else 'Review parameter agreement and model consistency. Start a new virtual device to change conditions.')
    return dict(schema_version='active-simulation-native-v1',version=repair.VERSION if release else VERSION,simulation_only=True,production_replaced=False,runtime_planner_policy=release[0]['PWM']['runtime_policy'] if release and spec.system=='PWM_MOTOR_SERVO' else 'retained-v1-PWM' if spec.system=='PWM_MOTOR_SERVO' else 'development-selected-shared-v2',session_id=st['id'],revision=n,token=token(st),system=spec.system,
                assessment=a,uncertainty=bands,proposal=prepared,fusion=fusion,original_stable_ranking=original,model_check=check,comparison=comparison,
                comparison_truth_used_by_algorithm=False,history=[dict(action_code=r.action_code,values=list(r.values),source=r.source,performed=r.performed) for r in history],explanation=explanation,expires_in_seconds=max(0,int(st['created']+900-time.time())),reproducibility=st['reproducibility'])

@router.post('/start')
def start(req:Start,x_native_session:str=Header(default='')):
    enabled();who=actor(x_native_session)
    if req.system not in SPECS:raise HTTPException(422,'Unsupported system')
    if req.profile not in ['nominal','current_limit','soft_limit','load_leakage'] or (req.profile!='nominal' and req.system!='LED_GPIO'):raise HTTPException(422,'Unsupported virtual profile')
    spec=runtime_spec(req.system)
    if req.parameters is not None:
        p=np.asarray(req.parameters,float)
        if p.shape!=(len(spec.parameters),) or not np.isfinite(p).all() or np.any(p<spec.lower) or np.any(p>spec.upper):raise HTTPException(422,'Parameters outside declared virtual bounds')
    world=LEDWorld(req.seed,0,req.profile) if req.system=='LED_GPIO' else VirtualDevice(req.system,req.seed,0)
    world.spec=spec
    if req.parameters is not None:world._z=spec.normalized(p) # Provider configuration only, never passed to fit/choose/fusion.
    noise_seed=req.seed if req.noise_seed is None else req.noise_seed
    # The virtual circuit and LED limit are initialized. This seed is now used only by run().
    world.seed += noise_seed - req.seed
    with LOCK:
        for key in list(SESSIONS):
            if time.time()-SESSIONS[key]['created']>900:del SESSIONS[key]
        owner=hashlib.sha256(x_native_session.split(':',1)[0].encode()).hexdigest()
        for key in [k for k,v in SESSIONS.items() if v.get('owner',v['actor'])==owner]:del SESSIONS[key]
        if len(SESSIONS)>=128:raise HTTPException(429,'Virtual Lab capacity reached')
        sid=secrets.token_hex(24);st=dict(id=sid,system=req.system,actor=who,owner=owner,created=time.time(),world=world,history=[],reproducibility={'seed':req.seed,'noise_seed':noise_seed})
        result=response(st);SESSIONS[sid]=st;return result

@router.post('/capture')
def capture(req:Capture,x_native_session:str=Header(default='')):
    enabled();who=actor(x_native_session)
    with LOCK:
        st=SESSIONS.get(req.session_id)
        if st is not None and time.time()-st['created']>900:
            del SESSIONS[req.session_id];st=None
        if st is None or st['actor']!=who:raise HTTPException(409,'Expired or foreign virtual session; start a new virtual device. Old captures cannot be replayed.')
        if req.revision!=len(st['history']) or not hmac.compare_digest(req.token,token(st)):raise HTTPException(409,'Already used or stale capture state')
        if len(st['history'])>=5:raise HTTPException(409,'Four experiments plus one optional model check only')
        spec=runtime_spec(st['system']);a=next((a for a in spec.actions if a.code==req.action_code),None)
        if a is None:raise HTTPException(422,'Action outside virtual rig')
        if len(st['history'])<4:
            assessment=runtime_fit(spec,st['history']);selected=runtime_choose(spec,st['history'],assessment['normalized_estimate'])
            if selected is None or a.code!=selected['action'].code:raise HTTPException(422,'Execute the proposed action; changing acquisition policy invalidates this calibrated research protocol')
        # A fifth acquisition is a validation probe, not a free extra training observation.
        if len(st['history'])==4:
            selected=runtime_challenge(spec,st['history'],runtime_fit(spec,st['history']))
            if selected is None or a.code!=selected['action'].code:raise HTTPException(422,'Use the proposed model-check action')
        try:row=st['world'].run(a)
        except ValueError as exc:raise HTTPException(409,str(exc)) from exc
        st['history'].append(row);return response(st)
