"""Observable-only encoding and identifiable estimates; no generator imports."""
import math
import numpy as np
from scipy.integrate import trapezoid
from scipy.optimize import least_squares
from ..feature_engineering import extract_features,COMMON_FEATURES,IMPROVED_FEATURES,NEXT_ROUND_OBSERVABLE_FEATURES
from .contract import EvidenceV2,UNITS,OBSERVATIONS,DECLARED,adapt_legacy

BASE=COMMON_FEATURES+IMPROVED_FEATURES+NEXT_ROUND_OBSERVABLE_FEATURES
CHANNELS=tuple(UNITS)
LOADS=('unspecified','dc_motor','servo','stepper')
TRACE_NAMES=('response','current','voltage','logic')
TRACE_STATS=('count','duration','first','last','minimum','maximum','mean','std','tail_std','area_mean','early_mean','late_mean','t10','t90','overshoot','reversals')
NAMES=tuple(['base:'+k for k in BASE]+['obs:'+k for k in OBSERVATIONS]+['declared:'+k for k in DECLARED]+
 [f'{k}:{stat}' for k in CHANNELS for stat in ('first','last','minimum','maximum','slope','uncertainty','count','flags')]+
 [f'trace:{k}:{stat}' for k in TRACE_NAMES for stat in TRACE_STATS]+
 ['fit:gain','fit:delay','fit:tau','fit:rmse','fit:condition','fit:valid','effective_series_r','effective_load_r','effective_cap_pf']+
 ['captures','first_command','last_command','first_time','last_time','sample_count']+['load:'+k for k in LOADS])
VERSION='observed-quality-features-v5-1'

def trace_stats(trace,command):
    t=np.asarray(trace.time_s,float);y=np.asarray(trace.values,float);span=float(np.ptp(y));duration=float(t[-1]-t[0]);tail=y[-max(4,len(y)//8):]
    target=y[-1]-y[0];direction=1 if target>=0 else -1;z=(y-y[0])*direction
    crossing=lambda f:float(t[np.flatnonzero(z>=abs(target)*f)[0]]) if abs(target)>.01 and np.any(z>=abs(target)*f) else np.nan
    dif=np.diff(y);threshold=max(span*.01,1e-8);signs=np.sign(dif[np.abs(dif)>threshold]);turns=int(np.sum(signs[1:]!=signs[:-1])) if len(signs)>1 else 0
    return [len(y),duration,y[0],y[-1],float(y.min()),float(y.max()),float(y.mean()),float(y.std()),float(tail.std()),
        float(trapezoid(y,t)/max(duration,1e-9)),float(y[:max(2,len(y)//4)].mean()),float(y[-max(2,len(y)//4):].mean()),crossing(.1),crossing(.9),
        max(0.,float(z.max()-abs(target)))/max(abs(target),.01),turns]

def response_fit(trace,duty,noise):
    t=np.asarray(trace.time_s,float);y=np.asarray(trace.values,float)
    result=dict(available=False,reason='insufficient_excitation',parameters=None,rmse=None,condition=None,intervals=None)
    if len(t)<12 or duty<.05 or np.ptp(y)<max(.02,6*noise):return result
    def pred(v):return duty*v[0]*(-np.expm1(-np.maximum(t-v[1],0)/v[2]))
    upper=max(.002,float(t[-1]));guess=[float(np.clip(y[-1]/duty,-8,8)),upper*.05,max(.001,upper/5)]
    fit=least_squares(lambda v:pred(v)-y,guess,bounds=([-10,0,.0001],[10,upper*.9,30]),loss='soft_l1',f_scale=max(.01,noise),max_nfev=55)
    singular=np.linalg.svd(fit.jac,compute_uv=False);condition=float(singular[0]/max(singular[-1],1e-15));residual=float(np.sqrt(np.mean((pred(fit.x)-y)**2)))
    limits=np.array([10,upper*.9,30]);near=bool(np.any(np.abs(fit.x)>limits*.995) or fit.x[2]<.00011)
    good=bool(fit.success and singular[-1]>1e-6 and condition<1e6 and not near and residual<=max(.025,3*noise,.04*np.ptp(y)))
    intervals=None
    if good:
        cov=np.linalg.pinv(fit.jac.T@fit.jac)*max(noise**2,residual**2)
        half=3*np.sqrt(np.maximum(0,np.diag(cov)));intervals=np.c_[fit.x-half,fit.x+half].tolist()
    result.update(available=good,reason='identified_first_order_summary' if good else 'residual_condition_or_boundary',parameters=fit.x.tolist() if good else None,
        rmse=residual,condition=condition,intervals=intervals,interval_assumption='local linearization with stated measurement noise; not hardware confidence')
    return result

def encode(packet,validate=True,fit_enabled=True):
    p=packet if isinstance(packet,EvidenceV2) else adapt_legacy(packet)
    base=extract_features(p.system,p.measurements)
    values=[base.get(k,np.nan) for k in BASE]+[float(p.observations[k]) if k in p.observations else np.nan for k in OBSERVATIONS]+[p.declared.get(k,np.nan) for k in DECLARED]
    observations={};quality=dict(critical_missing=[],warnings=[],measured_channels=0,capture_count=len(p.captures),fit_available=False,trace_available=False,source='CONTROLLED_SIMULATION')
    for key in CHANNELS:
        obs=[(c,c.channels[key]) for c in p.captures if key in c.channels]
        if not obs:values.extend([np.nan]*6+[0.,0.]);continue
        observations[key]=obs[-1][1];quality['measured_channels']+=1
        a,b=obs[0],obs[-1];den=b[0].command_fraction-a[0].command_fraction
        slope=(b[1]-a[1])/den if len(obs)>1 and abs(den)>.05 else np.nan
        uncertainty=max([c.uncertainty.get(key,0.) for c,v in obs]);flags=sum(len(c.flags.get(key,[])) for c,v in obs)
        values.extend([a[1],b[1],min(v for c,v in obs),max(v for c,v in obs),slope,uncertainty,len(obs),flags])
        if any('clipped'in c.flags.get(key,[]) for c,v in obs):quality['warnings'].append('clipped:'+key)
    traces={}
    for name in TRACE_NAMES:
        found=[(c,c.traces[name]) for c in p.captures if name in c.traces]
        if found:
            c,t=found[-1];traces[name]=(c,t);values.extend(trace_stats(t,c.command_fraction))
        else:values.extend([np.nan]*len(TRACE_STATS))
    fit=dict(available=False,reason='no_response_trace',parameters=None,rmse=None,condition=None,intervals=None)
    if 'response'in traces:
        c,t=traces['response'];quality['trace_available']=len(t.values)>=12
        if fit_enabled and p.load_type in ('unspecified','dc_motor'):
            noise=max(.002,c.uncertainty.get('response_ratio',0.),observations.get('noise_fraction',0.) if p.legacy_observations else .002)
            fit=response_fit(t,c.command_fraction,noise)
        elif p.load_type in ('servo','stepper'):fit['reason']='first_order_fit_not_applicable_to_declared_load'
    quality['fit_available']=fit['available']
    values.extend((fit['parameters'] if fit['available'] else [np.nan]*3)+[fit.get('rmse') if fit.get('rmse') is not None else np.nan,fit.get('condition') if fit.get('condition') is not None else np.nan,float(fit['available'])])
    estimates={};derived=[np.nan]*3
    q=observations
    if all(k in q for k in ('drive_probe','node_probe','current_probe')):
        c=next(c for c in reversed(p.captures) if 'current_probe'in c.channels);i=q['current_probe'];si=c.uncertainty.get('current_probe',abs(i)*.02)
        sv=math.hypot(c.uncertainty.get('drive_probe',.005),c.uncertainty.get('node_probe',.005))
        diff=q['drive_probe']-q['node_probe']
        if i>max(2e-6,3*si):
            if diff>3*sv:
                rs=diff/i;half=3*math.hypot(sv/i,rs*si/i);derived[0]=rs;estimates['effective_series_resistance_ohm']=dict(value=rs,interval=[max(0,rs-half),rs+half],assumption='same operating point; stated independent probe errors')
            if q['node_probe']>3*sv:
                r=q['node_probe']/i;half=3*math.hypot(sv/i,r*si/i);derived[1]=r;estimates['effective_load_ohm']=dict(value=r,interval=[max(0,r-half),r+half],assumption='effective V/I at this operating point')
    if q.get('pullup_probe',0)>0 and q.get('rise_30_70',0)>0:
        r=q['pullup_probe']+max(0,q.get('wire_resistance',0));cap=q['rise_30_70']/(math.log(7/3)*r)*1e12;derived[2]=cap
        estimates['effective_bus_capacitance_pf']=dict(value=cap,assumption='lumped RC; unknown series resistance can confound capacitance')
    values.extend(derived)
    first=p.captures[0] if p.captures else None;last=p.captures[-1] if p.captures else None
    values.extend([len(p.captures),first.command_fraction if first else np.nan,last.command_fraction if last else np.nan,first.time_s if first else np.nan,last.time_s if last else np.nan,sum(c.samples for c in p.captures)])
    values.extend([float(p.load_type==k) for k in LOADS])
    vector=np.asarray(values,dtype=np.float32);assert len(vector)==len(NAMES),(len(vector),len(NAMES))
    vector[~np.isfinite(vector)]=np.nan
    if len(p.captures)<2:quality['critical_missing'].append('second_independent_acquisition')
    if any(not c.channels for c in p.captures):quality['critical_missing'].append('executed_capture_without_readings')
    if 'supply_ratio'not in q and 'SUPPLY_VOLTAGE'not in p.measurements:quality['critical_missing'].append('supply_voltage')
    if p.system=='PWM_MOTOR_SERVO' and not quality['trace_available']:quality['warnings'].append('motor_response_trace_missing_or_too_short')
    if fit['reason']=='residual_condition_or_boundary':quality['warnings'].append('first_order_parameters_not_identifiable')
    if not quality['measured_channels']:quality['critical_missing'].append('no_observed_channels')
    if q.get('supply_ratio',1)<0 or q.get('supply_ratio',1)>1.8:quality['warnings'].append('supply_outside_characterized_range')
    if p.system=='I2C_SENSOR' and 'rise_30_70'not in q and 'rc_time_us'not in q:quality['warnings'].append('bus_edge_timing_unavailable')
    return vector,dict(quality=quality,fit=fit,physical_estimates=estimates,observations=q,packet=p)
