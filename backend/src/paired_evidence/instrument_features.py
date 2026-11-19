"""Observable-only feature contract. No simulation or training imports."""
import math,hashlib,json
import numpy as np
from ..config import load_config
SYSTEMS=load_config("systems")
from scipy.optimize import least_squares
TIMES=np.r_[0.,np.geomspace(.005,2.4,63)]
VERSION='shared-identifiable-measurements-v4-20261109'
UNITS={'drive_probe': 'V', 'node_probe': 'V', 'current_probe': 'A', 'nominal_load': 'ohm', 'pullup_probe': 'ohm', 'rise_30_70': 's', 'driver_duty': 'ratio'}
KEYS=['drive_probe', 'node_probe', 'current_probe', 'nominal_load', 'pullup_probe', 'rise_30_70', 'driver_duty']

def validate(x):
    expected={'version','system','channels','units','lineage','transient',
              'acquisition_index','scheduled_samples','virtual_only','executed'}
    if set(x)!=expected or x['version']!=VERSION or x['system']not in SYSTEMS:
        raise ValueError('Unknown/private acquisition field or version')
    if x['executed']is not True or x['virtual_only']is not True or x['acquisition_index']!=2 or x['scheduled_samples']!=64:
        raise ValueError('Actual bounded second virtual acquisition required')
    if set(x['channels'])!=set(x['units']) or set(x['channels'])!=set(x['lineage']):
        raise ValueError('Channel lineage or units missing')
    for k,v in x['channels'].items():
        if k not in UNITS or isinstance(v,bool)or not isinstance(v,(float,int))or not math.isfinite(v)or x['units'][k]!=UNITS[k]:
            raise ValueError('Invalid instrument channel')
        if not x['lineage'][k].startswith(('meter:','waveform:','declared:')):raise ValueError('Unobserved channel')
    t=x['transient']
    if t is not None:
        if set(t)!={'time_s','response_ratio','provenance'}or len(t['time_s'])!=len(t['response_ratio'])or not 4<=len(t['time_s'])<=64:
            raise ValueError('Invalid acquired transient')
        if not np.isfinite([*t['time_s'],*t['response_ratio']]).all()or np.any(np.diff(t['time_s'])<=0):raise ValueError('Invalid transient times/values')
    return x

def pwm_fit(t,y,duty):
    t=np.asarray(t);y=np.asarray(y)
    if len(t)<12 or not np.isfinite(duty)or duty<.05 or np.ptp(y)<.015:
        return dict(available=False,reason='insufficient_excitation',parameters=None)
    def prediction(v):
        g,delay,tau=v
        return duty*g*(-np.expm1(-np.maximum(t-delay,0)/tau))
    result=least_squares(lambda v:prediction(v)-y,[1.,.15,.25],
                         bounds=([0.,0.,.02],[3.,.65,1.3]),
                         loss='soft_l1',f_scale=.02,max_nfev=70)
    singular=np.linalg.svd(result.jac,compute_uv=False)
    condition=float(singular[0]/max(singular[-1],1e-12))
    residual=float(np.sqrt(np.mean((prediction(result.x)-y)**2)))
    ok=bool(result.success and singular[-1]>1e-6 and condition<1e5)
    return dict(available=ok,reason='identified'if ok else 'rank_or_solver_limit',
                parameters=result.x.tolist()if ok else None,
                rmse=residual,condition=condition)

def infer(acquisition):
    validate(acquisition);q=acquisition['channels'];s=acquisition['system']
    values=[np.nan]*9
    if s=='DIGITAL_INPUT':
        v=q.get('node_probe',np.nan);a=q.get('drive_probe',np.nan);i=q.get('current_probe',np.nan)
        if np.isfinite(v+a+i) and i>2e-6:
            values[0]=(a-v)/i;values[1]=v/i
            nominal=q.get('nominal_load',np.nan)
            values[2]=values[1]/nominal if nominal>0 else np.nan
    if s=='I2C_SENSOR':
        r=q.get('pullup_probe',np.nan);edge=q.get('rise_30_70',np.nan)
        if r>0 and edge>0:values[3]=r/1000;values[4]=edge/(math.log(7/3)*r)*1e12
    fit=dict(available=False,reason='not_applicable',parameters=None)
    if s=='PWM_MOTOR_SERVO' and acquisition['transient']:
        w=acquisition['transient'];fit=pwm_fit(w['time_s'],w['response_ratio'],q.get('driver_duty',np.nan))
        if fit['available']:values[5:8]=fit['parameters']
        values[8]=fit.get('rmse',np.nan)
    return values,fit

def raw_instruments(acquisitions):
    out=[]
    for a in acquisitions:
        validate(a);q=a['channels'];v=[q.get(k,np.nan)for k in KEYS]
        # Explicit timestamp interpolation positions are fixed by the protocol;
        # missing measured samples remain missing, not imputed future readings.
        observed=np.full(64,np.nan)
        if a['transient']:
            for t,y in zip(a['transient']['time_s'],a['transient']['response_ratio']):
                k=int(np.argmin(abs(TIMES-t)))
                if abs(TIMES[k]-t)>1e-9:raise ValueError('Unexpected sample schedule')
                observed[k]=y
        out.append([*v,*np.isfinite(v).astype(float),*observed,*np.isfinite(observed).astype(float)])
    return np.asarray(out,np.float32)

def physics_features(estimates):
    a=np.asarray(estimates,np.float32)
    return np.c_[np.sign(a)*np.log1p(abs(a)),np.isfinite(a).astype(float)]
