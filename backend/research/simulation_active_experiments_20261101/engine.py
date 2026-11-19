"""One common fit / identifiability / active design algorithm for six systems."""
from __future__ import annotations
import copy,math,time
from numbers import Real
import numpy as np
from scipy.optimize import least_squares
from .circuits import SPECS,predict,noise_sigma,Observation,describe_action

def validate_history(spec,history):
    seen=set();devices=set()
    for row in history:
        if not isinstance(row,Observation) or row.system!=spec.system or row.performed is not True or row.source!='CONTROLLED_SIMULATION':raise ValueError('Only performed same-system simulated observations are accepted')
        if not isinstance(row.device,str) or not row.device.strip() or len(row.device)>256:raise ValueError('Named virtual device required')
        if not isinstance(row.values,(tuple,list)) or any(isinstance(v,bool) or not isinstance(v,Real) or not math.isfinite(v) for v in row.values):raise ValueError('Finite numeric simulated readings required')
        if row.action_code in seen:raise ValueError('Duplicate observation')
        seen.add(row.action_code);devices.add(row.device)
        action=next((a for a in spec.actions if a.code==row.action_code),None)
        if action is None or len(row.values)!=len(predict(spec,action,np.full(len(spec.parameters),.5))) or not np.isfinite(row.values).all():raise ValueError('Invalid action or observable shape')
        if spec.system=='DIGITAL_INPUT' and any(not 0<=v<=1 or abs(v*64-round(v*64))>1e-8 for v in row.values):raise ValueError('Expected actual 64-trial high count fraction')
    if len(devices)>1:raise ValueError('Different virtual device histories cannot be mixed')

def jacobian(spec,action,z):
    columns=[];eps=1e-4
    for j in range(len(z)):
        lo=np.array(z,float);hi=lo.copy();lo[j]=max(0,lo[j]-eps);hi[j]=min(1,hi[j]+eps)
        columns.append((predict(spec,action,hi)-predict(spec,action,lo))/(hi[j]-lo[j]))
    return np.column_stack(columns)

def information(spec,history,z):
    rows=[]
    for obs in history:
        action=next(a for a in spec.actions if a.code==obs.action_code)
        rows.append(jacobian(spec,action,z)/noise_sigma(spec,action,predict(spec,action,z))[:,None])
    if not rows:return np.zeros((len(z),len(z))),0,[]
    design=np.vstack(rows);singular=np.linalg.svd(design,compute_uv=False)
    rank=int(sum(singular>max(1e-5,singular[0]*1e-6)))
    return design.T@design,rank,singular.tolist()

def fit(spec,history):
    validate_history(spec,history);d=len(spec.parameters)
    if not history:return dict(normalized_estimate=[.5]*d,data_rank=0,status='NO_OBSERVATIONS',root_fault=None)
    actions={a.code:a for a in spec.actions}
    def residual(z):
        values=[]
        for row in history:
            a=actions[row.action_code];prediction=predict(spec,a,z);observed=np.array(row.values)
            if spec.system=='DIGITAL_INPUT':
                # Variance-stabilized actual binomial counts, not hidden labels.
                measured=np.arcsin(np.sqrt((observed*64+.375)/64.75))
                expected=np.arcsin(np.sqrt(np.clip(prediction,1e-10,1-1e-10)))
                values.extend((measured-expected)*16)
            else:values.extend((observed-prediction)/noise_sigma(spec,a,prediction))
        return np.asarray(values)
    starts=[np.full(d,.5)]
    if spec.system in {'DIGITAL_INPUT','PWM_MOTOR_SERVO','LED_GPIO'}:starts.extend([np.full(d,.2),np.full(d,.8)])
    solutions=[least_squares(residual,start,bounds=(0,1),max_nfev=60,ftol=1e-7,xtol=1e-7,gtol=1e-7) for start in starts]
    solution=min(solutions,key=lambda a:float(a.fun@a.fun));z=solution.x
    _,rank,singular=information(spec,history,z);error=float(np.sqrt(np.mean(solution.fun**2)))
    state='INSUFFICIENT_EXCITATION' if rank<d else 'INSUFFICIENT_PRECISION' if singular[-1]<2 else 'MODEL_REVIEW' if error>4 else 'PARAMETERS_ESTIMATED'
    return dict(normalized_estimate=z.tolist(),estimated_parameters=dict(zip(spec.parameters,map(float,spec.physical(z)))),data_rank=rank,
                singular_values=singular,normalized_residual_rms=error,status=state,root_fault=None,
                tested_action_codes=[r.action_code for r in history],model_validated_outside_tested_controls=False,
                uncertainty_note='Local sensitivity rank/experiment utility, not calibrated fault confidence.')

def choose(spec,history,estimate=None):
    start=time.perf_counter();validate_history(spec,history);d=len(spec.parameters)
    performed={r.action_code for r in history};z=np.array(estimate if estimate is not None else [.5]*d)
    if z.shape!=(d,) or not np.isfinite(z).all() or np.any((z<0)|(z>1)):raise ValueError('Bounded parameter estimate required')
    # Preserve local null directions when early observations underdetermine
    # gain/offset or delay. Coarse unconditional anchors alone lost these coupled
    # alternatives and selected clipped ADC probes in the first experiment.
    info,_,_=information(spec,history,z)
    values,vectors=np.linalg.eigh(info+np.eye(d))
    root=(vectors/np.sqrt(values))@vectors.T
    ensemble=[z,np.full(d,.25),np.full(d,.75)]
    directions=[np.eye(d)[i]*v for i in range(d) for v in [-2,-1,1,2]]
    directions.extend([np.full(d,v) for v in [-1,1]])
    ensemble.extend(np.clip(z+root@v,0,1) for v in directions)
    losses=[]
    for point in ensemble:
        loss=0.
        for row in history:
            a=next(a for a in spec.actions if a.code==row.action_code);p=predict(spec,a,point)
            loss+=float(np.sum(((np.array(row.values)-p)/noise_sigma(spec,a,p))**2))
        losses.append(loss)
    weights=np.exp(-.5*np.clip(np.asarray(losses)-min(losses),0,1400));weights/=weights.sum()
    prepared=[]
    for point,weight in zip(ensemble,weights):
        if weight<1e-6:continue
        existing,_,_=information(spec,history,point);prior=existing+np.eye(d)
        prepared.append((point,weight,prior,float(np.linalg.slogdet(prior)[1])))
    candidates=[]
    for action in spec.actions:
        if action.code in performed:continue
        if action.repeat_of and action.repeat_of not in performed:continue
        utility=0.
        for point,weight,prior,logdet in prepared:
            j=jacobian(spec,action,point)/noise_sigma(spec,action,predict(spec,action,point))[:,None]
            utility+=weight*float(np.linalg.slogdet(prior+j.T@j)[1]-logdet)
        utility/=action.cost
        if utility>1e-8:candidates.append((utility,action.code,action))
    if not candidates:return None
    score,_,action=max(candidates,key=lambda p:(p[0],p[1]))
    return dict(action=action,score=score,state='PROPOSED_NOT_RUN',simulation_only=True,observed_values=None,
                controls=describe_action(spec,action),
                reason=(f'Acquire a new independent repeat of {action.repeat_of}; the earlier reading is retained. ' if action.repeat_of else f'Run {action.code}. ')
                       +'This adds information about '+', '.join(spec.parameters)+'. No result has been assumed.',
                planner_ms=(time.perf_counter()-start)*1000)

def attach_to_fusion(response,system,proposal,assessment):
    if system not in SPECS or response.get('system_type',system)!=system:raise ValueError('Fusion/system mismatch')
    if 'simulation_experiment' in response:raise ValueError('Do not overwrite prior experiment context')
    result=copy.deepcopy(response)
    p=None if proposal is None else {k:v for k,v in proposal.items() if k!='action'}
    if p is not None:p['action_code']=proposal['action'].code
    result['simulation_experiment']=dict(version='shared-active-simulation-v1',proposal=p,assessment=assessment,
                                         original_fault_ranking_changed=False,production_default=False)
    return result
