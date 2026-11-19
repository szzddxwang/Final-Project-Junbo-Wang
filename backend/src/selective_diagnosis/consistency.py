"""Uncertainty-aware independent indications for the characterized PWM model.

Only observed voltage, current, drive, frequency, noise and resistance enter.
Bounds describe the validated simulation envelope, not arbitrary motor hardware.
"""
import numpy as np
from .composition import INDEX

CAUSES=('PowerSupplyFault','VoltageLevelFault','WiringFault','PolarityFault','ConfigurationFault','SignalIntegrityFault')

def pwm_indications(x):
    x=np.asarray(x,dtype=float);n=len(x);flags=np.zeros((n,len(CAUSES)),bool)
    def q(k,when='last'):return x[:,INDEX[k+':'+when]]
    def u(k):return q(k,'uncertainty')
    def valid(*v):return np.logical_and.reduce([np.isfinite(a)for a in v])
    v1=q('supply_ratio','first');v2=q('supply_ratio');i1=q('current_ratio','first');i2=q('current_ratio');sv=u('supply_ratio');si=u('current_ratio');di=i2-i1
    complete=lambda key:q(key,'count')==x[:,INDEX['captures']]
    good=valid(v1,v2,i1,i2,sv,si)&complete('supply_ratio')&complete('current_ratio')&(np.abs(di)>6*np.sqrt(2)*si)
    den=np.where(good,di,np.nan)
    intercept=(v1*i2-v2*i1)/den
    uncertainty=np.sqrt((i2/den*sv)**2+(i1/den*sv)**2+(((v1-v2)*i2/den**2)*si)**2+(((v2-v1)*i1/den**2)*si)**2)
    flags[:,0]=good&(intercept+4*uncertainty<.98)
    term=q('terminal_ratio');duty=q('driver_duty');du=u('driver_duty')
    absent=~np.isfinite(duty)|~complete('driver_duty');duty=np.where(absent,q('duty_actual'),duty);du=np.where(absent,u('duty_actual'),du)
    aligned=complete('supply_ratio')&complete('terminal_ratio')&np.where(absent,complete('duty_actual'),complete('driver_duty'))
    good=valid(term,v2,duty,u('terminal_ratio'),sv,du)&aligned&(v2>4*sv)&(duty>4*du)&(duty>.05)
    den=np.where(good,v2*duty,np.nan);level=np.abs(term)/den
    levu=np.sqrt((u('terminal_ratio')/den)**2+(level*sv/v2)**2+(level*du/duty)**2)
    flags[:,1]=good&(np.abs(level-1)>.015+4*levu)
    flags[:,2]=valid(q('wire_resistance'),u('wire_resistance'))&(q('wire_resistance')>3+4*u('wire_resistance'))
    flags[:,3]=valid(term,u('terminal_ratio'))&(term < -4*u('terminal_ratio'))
    freq=q('frequency_ratio');fu=u('frequency_ratio');cmd=x[:,INDEX['last_command']]
    flags[:,4]=(valid(freq,fu)&(np.abs(freq-1)>.005+4*fu))|(valid(duty,du,cmd)&np.where(absent,complete('duty_actual'),complete('driver_duty'))&(np.abs(duty-cmd)>.01+4*du))
    noise=q('noise_fraction');nu=u('noise_fraction')
    flags[:,5]=valid(noise,nu)&(noise>.012+4*np.sqrt(nu**2+(.012/np.sqrt(126))**2))
    return flags

def pwm_conflict(x,probabilities,classes):
    flags=pwm_indications(x);pred=np.asarray(probabilities).argmax(1)
    # A strong independent indication outside the proposed single root requires
    # review. This can also reject a wrong single-root prediction, not just mixes.
    proposed=np.asarray(classes)[pred]
    conflict=(flags.sum(1)>1)|np.any(flags&(np.asarray(CAUSES)[None,:]!=proposed[:,None]),axis=1)
    return conflict,flags
