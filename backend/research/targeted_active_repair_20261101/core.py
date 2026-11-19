"""Targeted physical adapters inside the unchanged shared inference framework.

Only performed observations enter estimators/planners. No virtual truth access.
"""
from dataclasses import replace
from functools import lru_cache
import time
import numpy as np
from scipy.optimize import least_squares, minimize
from scipy.special import expit, logsumexp
from scipy.stats import binom
from research.simulation_active_experiments_20261101.circuits import SPECS,Action,predict,noise_sigma,describe_action
from research.simulation_active_experiments_20261101.engine import fit as old_fit,choose as old_choose,validate_history,information
from research.integrated_active_simulation_20261101.core import fit as accepted_fit,choose as accepted_choose,challenge as accepted_challenge,mismatch as accepted_mismatch

VERSION='shared-active-targeted-v3'
PWM='PWM_MOTOR_SERVO'; LED='LED_GPIO'; DI='DIGITAL_INPUT'
_pwm=SPECS[PWM]
PWM_SPEC=replace(_pwm,actions=_pwm.actions+tuple(Action('fine_step_'+str(i),(.7,t),1+t/20) for i,t in enumerate([.08,.12,.16,.24,.28,.32,.36,.4,.45,.6,.7,.8,1.25,1.5,2.5,3.])))
LED_PROBE=Action('validation_supply_5V',(5.,),1.15)
LED_SPEC=replace(SPECS[LED],actions=SPECS[LED].actions+(LED_PROBE,))

def rig(system,pwm_policy='accepted_v1'):
    return PWM_SPEC if system==PWM and pwm_policy!='accepted_v1' else LED_SPEC if system==LED else SPECS[system]

def action_rows(spec,h):
    validate_history(spec,h);actions={a.code:a for a in spec.actions}
    return np.array([actions[r.action_code].controls for r in h]),np.array([r.values[0] for r in h])

def loss(spec,h,z):
    u,y=action_rows(spec,h);z=np.atleast_2d(z);p=spec.physical(z)
    if spec.system==DI:
        prob=np.clip(expit((u[:,0,None]-p[:,0])/p[:,1]),1e-12,1-1e-12)
        k=np.rint(64*y)[:,None]
        return -2*(k*np.log(prob)+(64-k)*np.log1p(-prob)).sum(axis=0)
    if spec.system==LED:pred=np.maximum(u[:,0,None]-p[:,0],0)/p[:,1]*1000;sigma=.07
    elif spec.system==PWM:pred=p[:,0]*u[:,0,None]*(1-np.exp(-np.maximum(u[:,1,None]-p[:,2],0)/p[:,1]));sigma=.012
    else:raise ValueError('Targeted likelihood not defined for system')
    return np.sum(((y[:,None]-pred)/sigma)**2,axis=0)

@lru_cache(maxsize=8)
def axes(n):
    a,b=np.meshgrid(np.linspace(0,1,n),np.linspace(0,1,n),indexing='ij')
    return np.c_[a.ravel(),b.ravel()]

def profile_pwm(spec,h,n=61):
    u,y=action_rows(spec,h);td=axes(n);tau=.12+1.08*td[:,0];delay=.02+.23*td[:,1]
    basis=u[:,0,None]*(1-np.exp(-np.maximum(u[:,1,None]-delay,0)/tau))
    denom=np.sum(basis*basis,axis=0);gain=np.clip(np.sum(basis*y[:,None],axis=0)/np.maximum(denom,1e-20),.6,1.3)
    value=np.sum(((y[:,None]-basis*gain)/.012)**2,axis=0)
    return np.c_[(gain-.6)/.7,td],value,basis,denom

def mle(spec,h):
    if spec.system==PWM:
        grid,v,_,_=profile_pwm(spec,h,41)
    else:grid=axes(51);v=loss(spec,h,grid)
    seeds=grid[np.argsort(v)[:3]]
    results=[minimize(lambda z:float(loss(spec,h,z)[0]),z,bounds=[(0,1)]*len(z),method='L-BFGS-B',options={'maxiter':100,'ftol':1e-12}) for z in seeds]
    r=min(results,key=lambda x:x.fun)
    return r.x,float(r.fun)

def fit(spec,h,pwm_policy='accepted_v1'):
    if not h:return old_fit(spec,h)
    if spec.system!=PWM or pwm_policy=='accepted_v1':return accepted_fit(spec,h) if spec.system!=PWM else old_fit(spec,h)
    z,v=mle(spec,h);_,rank,singular=information(spec,h,z);err=float(np.sqrt(v/len(h)))
    return dict(normalized_estimate=z.tolist(),estimated_parameters=dict(zip(spec.parameters,map(float,spec.physical(z)))),data_rank=rank,singular_values=singular,normalized_residual_rms=err,
                status='INSUFFICIENT_EXCITATION' if rank<len(z) else 'INSUFFICIENT_PRECISION' if singular[-1]<2 else 'MODEL_REVIEW' if err>4 else 'PARAMETERS_ESTIMATED',root_fault=None,
                tested_action_codes=[r.action_code for r in h],model_validated_outside_tested_controls=False,uncertainty_note='Nonlinear likelihood fit; confidence requires independent calibration.')

def posterior(spec,h):
    z,v,b,denom=profile_pwm(spec,h,51);se=.012/np.sqrt(np.maximum(denom,1e-10))/.7
    # Integrate the nuisance gain with deterministic Gaussian quadrature.
    nodes=[];weights=[]
    for delta,w in [(-1.732,.1666666667),(0,.6666666666),(1.732,.1666666667)]:
        node=z.copy();node[:,0]=np.clip(node[:,0]+delta*se,0,1)
        ll=-.5*loss(spec,h,node)+np.log(w)+np.log(np.minimum(se,2))
        nodes.append(node);weights.append(ll)
    nodes=np.vstack(nodes);lw=np.concatenate(weights);weight=np.exp(lw-logsumexp(lw))
    # Fixed posterior quadrature size; no stochastic planner or truth-conditioned choice.
    ix=np.searchsorted(np.cumsum(weight),(np.arange(384)+.5)/384)
    return nodes[np.minimum(ix,len(nodes)-1)]

def choose(spec,h,estimate=None,pwm_policy='accepted_v1'):
    if spec.system!=PWM:return accepted_choose(SPECS[spec.system],h,estimate)
    if pwm_policy in {'accepted_v1','fine_grid_d_optimal'}:return old_choose(spec,h,estimate)
    if len(h)<2:return old_choose(SPECS[PWM],h,estimate)
    t=time.perf_counter();particles=posterior(spec,h);physical=spec.physical(particles);known={r.action_code for r in h};choices=[]
    prior=float(np.sum(np.mean(particles,axis=0)**2))
    for a in spec.actions:
        if a.code in known or a.repeat_of and a.repeat_of not in known:continue
        mean=physical[:,0]*a.controls[0]*(1-np.exp(-np.maximum(a.controls[1]-physical[:,2],0)/physical[:,1]))
        yy=np.linspace(float(mean.min())-.048,float(mean.max())+.048,81)
        density=np.exp(-.5*((yy[:,None]-mean)/.012)**2)/(.012*np.sqrt(2*np.pi))
        mass=density.mean(axis=1);numer=density@particles/len(particles)
        utility=float(np.trapezoid(np.sum(numer*numer,axis=1)/np.maximum(mass,1e-200),yy)-prior)/a.cost
        choices.append((utility,a.code,a))
    score,_,a=max(choices,key=lambda x:(x[0],x[1]))
    return dict(action=a,score=score,reason='Compare delay and response-speed alternatives at a time where their predicted load readings differ. No result has been assumed.',planner_ms=1000*(time.perf_counter()-t))

def interval_score(spec,h,truth):
    z,minimum=mle(spec,h)
    return max(0.,float(loss(spec,h,truth)[0]-minimum))

def calibrated_quantile(scores):
    # Upper nonparametric tolerance bound: P(F(q)>=.95) >= .95.
    n=len(scores);k=int(binom.ppf(.95,n,.95))+1
    if k>n:raise ValueError('Not enough independent calibration devices')
    return float(sorted(scores)[k-1]),k

def intervals(spec,h,q):
    z,minimum=mle(spec,h);threshold=minimum+q
    if spec.system==PWM:
        grid,v,b,denom=profile_pwm(spec,h,201);ok=v<=threshold
        if not ok.any():return dict(status='ABSTAIN_NUMERICAL_SET',intervals=None)
        feasible=grid[ok];margin=np.sqrt(np.maximum(threshold-v[ok],0)*.012**2/np.maximum(denom[ok],1e-20))/.7
        low=np.r_[np.min(feasible[:,0]-margin),np.min(feasible[:,1:],axis=0)]
        high=np.r_[np.max(feasible[:,0]+margin),np.max(feasible[:,1:],axis=0)]
    else:
        grid=axes(201);v=loss(spec,h,grid);feasible=grid[v<=threshold]
        if not len(feasible):return dict(status='ABSTAIN_NUMERICAL_SET',intervals=None)
        low=feasible.min(axis=0);high=feasible.max(axis=0)
    # Conservative grid-cell enclosure, <=1% of parameter range total padding.
    low=np.maximum(0,np.minimum(low,z)-.005);high=np.minimum(1,np.maximum(high,z)+.005);width=high-low
    _,rank,_=information(spec,h,z)
    if rank<len(z) or width.max()>.65:return dict(status='ABSTAIN_WEAK_OR_WIDE',intervals=None,mean_normalized_width=float(width.mean()))
    bounds=np.c_[low,high]
    return dict(status='CALIBRATED_NONLINEAR_PARAMETER_SET',intervals={p:[float(spec.physical(low)[i]),float(spec.physical(high)[i])] for i,p in enumerate(spec.parameters)},normalized_bounds=bounds.tolist(),mean_normalized_width=float(width.mean()),likelihood_estimate=z.tolist(),scope='Independent nominal/boundary simulation groups; not arbitrary model mismatch or hardware',target=.95)

def challenge(spec,h,a,led_high=False):
    if spec.system==LED and led_high:
        return dict(action=LED_PROBE,reason='Run one virtual-only5V probe: weak limiting and additional load can remain invisible below3.3V. Compare the new current with the fitted linear circuit; a mismatch is not a unique component fault.',additional_capture_cost=1.15,maximum_nominal_current_mA=1000*(5-1.5)/150)
    return accepted_challenge(spec,h,a)

def mismatch(spec,h,threshold=None):
    if spec.system!=LED:return accepted_mismatch(spec,h)
    _,v=mle(spec,h)
    cut=float(threshold) if threshold is not None else 12.8381564666 # chi2(df3) .995
    detected=v>cut
    return dict(status='MODEL_INCONSISTENT' if detected else 'CONSISTENT_AT_TESTED_CONDITIONS',detected=bool(detected),statistic=v,threshold=cut,root_fault=None,additional_actual_captures=1,
                scope='Virtual linear-circuit residual test; off-range or electrically equivalent anomalies may remain undetectable.')
