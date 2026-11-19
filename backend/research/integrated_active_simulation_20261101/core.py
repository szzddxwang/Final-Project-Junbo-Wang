"""Shared acquisition/fit/interval/candidate-evidence flow, six physical adapters.

This research adapter never reads VirtualDevice truth or changes stable weights.
"""
from __future__ import annotations
import time,math
from itertools import product
import numpy as np
from scipy.optimize import least_squares
from scipy.stats import chi2
from research.simulation_active_experiments_20261101.circuits import SPECS,predict,noise_sigma,describe_action
from research.simulation_active_experiments_20261101.engine import (fit as original_fit,choose as original_choose,validate_history,information,jacobian)

VERSION='shared-active-fusion-v2'

def fit(spec,history):
    result=original_fit(spec,history)
    if not history or spec.system!='PWM_MOTOR_SERVO':return result
    # A flat pre-delay sample has a zero local derivative. Seed the nonlinear
    # search with profile gain solutions across tau/delay instead of three
    # diagonal initial points, which can all land on the same inactive plateau.
    actions={a.code:a for a in spec.actions}
    def residual(z):
        return np.concatenate([(np.asarray(r.values)-predict(spec,actions[r.action_code],z))/noise_sigma(spec,actions[r.action_code],predict(spec,actions[r.action_code],z)) for r in history])
    seeds=[]
    for tau,delay in product(np.linspace(.05,.95,7),repeat=2):
        z=np.array([.5,tau,delay]);physical=spec.physical(z)
        basis=np.array([actions[r.action_code].controls[0]*(1-np.exp(-max(actions[r.action_code].controls[1]-physical[2],0)/physical[1])) for r in history])
        obs=np.array([r.values[0] for r in history]);gain=np.clip(basis@obs/max(basis@basis,1e-12),spec.lower[0],spec.upper[0])
        z[0]=(gain-spec.lower[0])/(spec.upper[0]-spec.lower[0]);loss=float(residual(z)@residual(z));seeds.append((loss,z))
    starts=[np.asarray(result['normalized_estimate'])]+[v for _,v in sorted(seeds,key=lambda x:x[0])[:2]]
    solutions=[least_squares(residual,z,bounds=(0,1),max_nfev=100) for z in starts]
    sol=min(solutions,key=lambda x:x.fun@x.fun);z=sol.x
    _,rank,singular=information(spec,history,z);error=float(np.sqrt(np.mean(sol.fun**2)))
    result.update(normalized_estimate=z.tolist(),estimated_parameters=dict(zip(spec.parameters,map(float,spec.physical(z)))),data_rank=rank,singular_values=singular,normalized_residual_rms=error,
                  status='INSUFFICIENT_EXCITATION' if rank<len(z) else 'INSUFFICIENT_PRECISION' if singular[-1]<2 else 'MODEL_REVIEW' if error>4 else 'PARAMETERS_ESTIMATED')
    return result

def choose(spec,history,estimate=None):
    """Expected A-optimal normalized parameter error reduction per cost.

    Same generic algorithm for every Spec. Unknown directions use a bounded
    Cartesian ensemble, not an answer-conditioned point or hidden device truth.
    """
    start=time.perf_counter();validate_history(spec,history);d=len(spec.parameters)
    if spec.system in {'DIGITAL_INPUT','LED_GPIO','UART_DEVICE'}:
        # Development comparison did not justify changing these design losses.
        # Reuse the same original shared engine instead of accepting regression.
        return original_choose(spec,history,estimate)
    if spec.system=='PWM_MOTOR_SERVO' and not history:
        # Identify the gain at the longest, strongest permitted step before
        # attempting to separate tau from transport delay. This is a rig/design
        # precondition, never a fault-to-result rule.
        action=max((a for a in spec.actions if not a.repeat_of),key=lambda a:(a.controls[0],a.controls[1]))
        return dict(action=action,score=0.,state='PROPOSED_NOT_RUN',observed_values=None,controls=describe_action(spec,action),reason='First observe the largest permitted late response to anchor gain; then separate delay from time constant.',planner_ms=1000*(time.perf_counter()-start))
    z=np.asarray(estimate if estimate is not None else [.5]*d)
    if z.shape!=(d,) or not np.isfinite(z).all() or np.any((z<0)|(z>1)):raise ValueError('Invalid normalized estimate')
    ensemble=[np.array(v) for v in product([.15,.5,.85],repeat=d)]+[z]
    info,_,_=information(spec,history,z)
    vals,vecs=np.linalg.eigh(info+np.eye(d)*12);root=(vecs/np.sqrt(vals))@vecs.T
    ensemble.extend(np.clip(z+root@(np.eye(d)[i]*direction),0,1) for i in range(d) for direction in [-2,2])
    losses=[]
    for p in ensemble:
        errors=[]
        for r in history:
            a=next(a for a in spec.actions if a.code==r.action_code);pred=predict(spec,a,p)
            errors.extend((np.asarray(r.values)-pred)/noise_sigma(spec,a,pred))
        losses.append(float(np.dot(errors,errors)))
    w=np.exp(-.5*np.clip(np.asarray(losses)-min(losses),0,1400));w/=w.sum()
    prepared=[]
    for p,weight in zip(ensemble,w):
        if weight<1e-7:continue
        f,_,_=information(spec,history,p);cov=np.linalg.inv(f+np.eye(d)*12)
        prepared.append((p,weight,f+np.eye(d)*12,float(np.trace(cov))))
    known={r.action_code for r in history};candidates=[]
    for a in spec.actions:
        if a.code in known or (a.repeat_of and a.repeat_of not in known):continue
        if spec.system=='PWM_MOTOR_SERVO' and a.controls[1]<.2:continue
        utility=0.
        for p,weight,prior,old in prepared:
            j=jacobian(spec,a,p)/noise_sigma(spec,a,predict(spec,a,p))[:,None]
            utility+=weight*(old-float(np.trace(np.linalg.inv(prior+j.T@j))))
        candidates.append((utility/a.cost,a.code,a))
    if not candidates:return None
    score,_,action=max(candidates,key=lambda r:(r[0],r[1]))
    return dict(action=action,score=float(score),state='PROPOSED_NOT_RUN',observed_values=None,controls=describe_action(spec,action),
                reason='Compare the remaining parameter alternatives. This capture is expected to reduce normalized parameter uncertainty per experiment cost; no result has been assumed.',planner_ms=1000*(time.perf_counter()-start))

def interval_basis(spec,history,assessment):
    z=np.asarray(assessment['normalized_estimate']);info,rank,_=information(spec,history,z)
    if rank<len(z):return None
    se=np.sqrt(np.maximum(np.diag(np.linalg.pinv(info,rcond=1e-12)),0))
    # ADC floor bins and local approximation must not imply zero uncertainty.
    se=np.maximum(se,1e-4)
    return se

def intervals(spec,history,assessment,calibration):
    se=interval_basis(spec,history,assessment)
    if se is None:return dict(status='ABSTAIN_UNIDENTIFIABLE',intervals=None)
    if assessment.get('status')=='MODEL_REVIEW':return dict(status='ABSTAIN_MODEL_MISMATCH',intervals=None)
    z=np.asarray(assessment['normalized_estimate']);q=calibration[spec.system]['q'];lo=np.maximum(0,z-q*se);hi=np.minimum(1,z+q*se)
    widths=hi-lo
    if np.max(widths)>.65:return dict(status='ABSTAIN_TOO_WIDE',intervals=None,mean_normalized_width=float(np.mean(widths)))
    bounds={k:[float(a),float(b)] for k,a,b in zip(spec.parameters,spec.physical(lo),spec.physical(hi))}
    return dict(status='CALIBRATED_SIMULATION_INTERVAL',intervals=bounds,normalized_bounds=np.column_stack([lo,hi]).tolist(),mean_normalized_width=float(np.mean(widths)),target_coverage=.95,
                scope='Simultaneous parameters of one exchangeable virtual device, issued cases only; not fault posterior confidence')

def mismatch(spec,history):
    assessment=fit(spec,history);n=sum(len(r.values) for r in history);df=n-len(spec.parameters)
    if df<=0 or assessment['data_rank']<len(spec.parameters):return dict(status='INSUFFICIENT_IDENTIFIABILITY',p_value=None,detected=False)
    dev=assessment['normalized_residual_rms']**2*n
    p=float(chi2.sf(dev,df))
    return dict(status='MODEL_INCONSISTENT' if p<.005 else 'CONSISTENT_AT_TESTED_CONDITIONS',p_value=p,deviance=float(dev),degrees_of_freedom=df,detected=p<.005,root_fault=None)

def challenge(spec,history,assessment):
    # Upper-excitation holdout is the most useful probe for current limiting:
    # it tests curvature where a low-current fit otherwise extrapolates freely.
    # Select by predicted response/known noise, not a fault label or true limit.
    known={r.action_code for r in history};z=np.asarray(assessment['normalized_estimate'])
    candidates=[a for a in spec.actions if a.code not in known and (not a.repeat_of or a.repeat_of in known)]
    if not candidates:return None
    def score(a):
        p=predict(spec,a,z);return float(np.linalg.norm(p/noise_sigma(spec,a,p)))/a.cost
    a=max(candidates,key=score)
    return dict(action=a,state='PROPOSED_NOT_RUN',observed_values=None,reason='Challenge the fitted model near a high-response condition; nonlinear limiting may only become visible there.',additional_capture_cost=a.cost)

def features(spec,history,assessment,base_probabilities):
    z=np.asarray(assessment['normalized_estimate']);se=interval_basis(spec,history,assessment)
    # Shared representation, pad three physical slots and retain missing masks.
    out=[float(spec.system==s) for s in SPECS]+list(base_probabilities)
    out+=list(np.pad(z,(0,3-len(z)),constant_values=.5))
    out+=list(np.pad(np.minimum(se if se is not None else np.full(len(z),2.),2.),(0,3-len(z)),constant_values=2.))
    out += [assessment['data_rank']/len(z),min(assessment.get('normalized_residual_rms',0),20)/20,len(history)/5]
    out += [float(i<len(z)) for i in range(3)]
    return np.asarray(out,float)
