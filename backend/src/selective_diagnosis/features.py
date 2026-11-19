"""Acceptance features from measured packets only, with no physics/truth imports."""
import numpy as np
from src.reliable_diagnosis.features import NAMES as BASE_NAMES

COMPARE=('wire_resistance','reference_ratio','supply_ratio','noise_fraction','baud_ratio','frame_error','ack_fraction','clock_stretch_ratio','bus_busy_fraction','gain_readback','frequency_ratio','duty_error','mode_readback','bias_readback','framing_config_mismatch')
EXTRA_NAMES=tuple(f'consistency:{c}:{stat}'for c in COMPARE for stat in ('range','normalized_range','last_difference','count'))+('response_current_correlation','current_tail_variation','response_tail_variation','response_current_observed','motor_plateau_fraction','response_reversal_fraction')
VERSION='observed-acceptance-v6-1'
def supplement(detail):
    p=detail['packet'];out=[]
    for key in COMPARE:
        z=[(c.channels[key],c.uncertainty.get(key,0.))for c in p.captures if key in c.channels]
        if len(z)<2:out.extend([np.nan,np.nan,np.nan,len(z)]);continue
        v=np.array([a for a,b in z]);u=np.array([b for a,b in z]);spread=float(np.ptp(v));den=max(float(np.sqrt((u*u).sum())),abs(float(v.mean()))*.002,1e-8)
        out.extend([spread,spread/den,float(v[-1]-v[-2]),len(z)])
    traces=next((c.traces for c in reversed(p.captures)if 'response'in c.traces),{})
    if 'response'in traces:
        r=traces['response'];y=np.asarray(r.values);n=max(4,len(y)//6);scale=max(float(np.ptp(y)),.02);tail=float(np.std(y[-n:])/scale)
        turn=float(np.mean(np.diff(y)<-scale*.01));plateau=float(np.mean(np.abs(np.diff(y[-n:]))<scale*.01))
        if 'current'in traces:
            c=traces['current'];i=np.interp(r.time_s,c.time_s,c.values);ic=float(np.std(i[-n:])/max(float(np.ptp(i)),.002));corr=float(np.corrcoef(y,i)[0,1])if y.std()>1e-8 and i.std()>1e-8 else 0.;out.extend([corr,ic,tail,1,plateau,turn])
        else:out.extend([np.nan,np.nan,tail,0,plateau,turn])
    else:out.extend([np.nan,np.nan,np.nan,0,np.nan,np.nan])
    return np.asarray(out,dtype=np.float32)

def make_features(x,probabilities,extra):
    x=np.asarray(x);p=np.asarray(probabilities);order=np.sort(p,axis=1)
    return np.c_[x,p,order[:,-1]-order[:,-2],-(p*np.log(np.maximum(p,1e-30))).sum(1),np.isnan(x).mean(1),np.asarray(extra)].astype(np.float32)
