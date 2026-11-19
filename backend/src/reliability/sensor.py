"""Observable sensor dynamics: fit response before attributing residual drift.

Only expected/measured channels and sampling frequency enter model features.
"""
import numpy as np
from scipy.signal import lfilter
from ..midterm.data import resample,SENSOR_FAULTS

PREPROCESS='sensor-first-order-nuisance-fit-v2'
FEATURES=('fitted_tau_s','fitted_gain','fitted_offset_degC','fitted_drift_degC_s',
          'fit_residual_rms','fit_residual_mad','fit_difference_noise','missing_fraction',
          'reference_range','measured_range','range_ratio','residual_mean',
          'residual_rms','raw_residual_slope','tail_residual','initial_state_offset',
          'duration_s','sample_rate_hz','reference_slope','reference_difference_rms')

def response(reference,fs,tau,initial=None):
    decay=np.exp(-1/fs/max(tau,.001));base=float(reference[0])
    filtered=lfilter([1-decay],[1,-decay],np.asarray(reference)-base)+base
    if initial is not None:filtered+=(initial-base)*decay**np.arange(1,len(reference)+1)
    return filtered

def sensor_input(samples,fs):
    a=np.asarray(samples,dtype=float)
    if a.ndim!=2 or a.shape[0]!=2 or not 32<=a.shape[1]<=4096 or not 0<fs<=500 or not np.isfinite(a[0]).all():
        raise ValueError('Sensor requires bounded expected/measured channels and 0..500 Hz')
    ideal,y=a;n=len(y);t=np.arange(n)/fs;valid=np.isfinite(y)
    if valid.sum()<8:raise ValueError('Insufficient observed sensor samples')
    filled=np.interp(np.arange(n),np.flatnonzero(valid),y[valid]);base=float(ideal[0]);best=None
    for tau in np.geomspace(.04,25,36):
        filtered=response(ideal,fs,tau)
        design=np.column_stack((filtered-base,np.ones(n),t,np.exp(-t/tau)))
        coef=np.linalg.lstsq(design[valid],y[valid]-base,rcond=None)[0]
        fitted=base+design@coef;err=y[valid]-fitted[valid];loss=float(np.mean(err**2))
        if best is None or loss<best[0]:best=(loss,tau,coef,fitted)
    _,tau,coef,fitted=best;err=filled-fitted;delta=np.diff(err)[valid[:-1]&valid[1:]]
    residual=filled-ideal;rr=float(np.ptp(ideal));mr=float(np.ptp(filled))
    slope=lambda v:float(np.polyfit(t[valid],v[valid],1)[0])
    rms=lambda v:float(np.sqrt(np.mean(np.asarray(v)**2)))
    features=np.asarray([tau,coef[0],coef[1],coef[2],rms(err[valid]),float(np.median(np.abs(err[valid]-np.median(err[valid]))))*1.4826,
        rms(delta)/np.sqrt(2) if len(delta) else 0,1-valid.mean(),rr,mr,mr/max(rr,.01),float(residual[valid].mean()),rms(residual[valid]),slope(residual),
        float(np.median(residual[-max(8,n//10):])),coef[3],n/fs,fs,slope(ideal),rms(np.diff(ideal))],dtype=np.float32)
    scale=max(rr,1.)
    series=np.stack(((ideal-base)/scale,(filled-base)/scale,residual/3,err/1,(fitted-base)/scale,valid.astype(float)))
    return resample(series),np.clip(features,-1e4,1e4)

def diverse_sensor(fault,group,profile='development',seed=2026101302):
    """Paired operating groups with a separately parameterized test profile.

    Normal envelope is a declared simulation assumption, not hardware validation:
    calibration +/-0.15 C, gain +/-2%, drift <=0.005 C/s, noise <=0.12 C,
    response <=1.3 s. Labels and generator IDs never enter inference features.
    """
    r=np.random.default_rng(seed+group*10007)
    e=np.random.default_rng(seed+group*10007+SENSOR_FAULTS.index(fault)*101)
    shifted=profile=='independent_shift'
    fs=float(r.choice([6,12,24,30] if shifted else [5,10,20,25]))
    duration=float(r.uniform(17,42) if shifted else r.uniform(12,40));n=round(fs*duration);t=np.arange(n)/fs
    base=float(r.uniform(-25,80) if shifted else r.uniform(-15,65))
    ideal=np.full(n,base);count=int(r.integers(2,5) if shifted else r.integers(1,4))
    for fraction in sorted(r.uniform(.15,.8,count)):ideal[int(n*fraction):]+=r.choice([-1,1])*r.uniform(.7,7)
    phase=r.uniform(0,6.28);ideal+=r.uniform(.03,.3)*np.sin(2*np.pi*t/duration+phase)
    if shifted:ideal+=r.uniform(-.008,.008)*t+.04*np.cos(6*np.pi*t/duration+phase)
    tau=float(r.uniform(.15,1.1) if shifted else r.uniform(.12,1.3))
    noise=float(r.uniform(.02,.12));offset=float(r.uniform(-.15,.15));gain=float(r.uniform(.98,1.02));drift=float(r.uniform(-.005,.005))
    initial=base+r.uniform(-1.5,1.5);quant=float(r.choice([0,.005,.01,.02]))
    if fault=='SLOW_RESPONSE':tau=max(duration*r.uniform(.15,.3),3.)
    if fault=='NOISE':noise=float(r.uniform(.2,.85))
    if fault=='OFFSET':offset+=r.choice([-1,1])*r.uniform(.7,3.5)
    if fault=='DRIFT':drift+=r.choice([-1,1])*r.uniform(.05,.22)
    measured=base+gain*(response(ideal,fs,tau,initial)-base)+offset+drift*t
    innovations=e.standard_t(7,n)*np.sqrt(5/7) if shifted else e.normal(size=n)
    measured+=innovations*noise
    if fault=='STUCK':measured[:]=base+offset+e.normal(0,.002,n)
    if quant:measured=np.round(measured/quant)*quant
    if fault=='DROPOUT':measured[e.random(n)<r.uniform(.08,.3)]=np.nan
    return np.stack((ideal,measured)),fs,{'group':group,'profile':profile,'pattern':fault,'seed':seed,'fs':fs,'n':n,'duration':duration,
        'base':base,'tau':tau,'noise':noise,'offset':offset,'gain':gain,'drift':drift,'initial':initial,'quantization':quant,'setpoint_changes':count}
