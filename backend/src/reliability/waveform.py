"""Reference-aware analog waveform family and identifiable DC pattern contract."""
import numpy as np
from ..waveform.features import signal_features
DC_CLASSES=('NORMAL','HIGH_NOISE','LEVEL_MISMATCH','CONVERSION_MISMATCH','SATURATION')
DC_FEATURES=('pin_error_v','pin_error_relative','conversion_error_v','conversion_error_relative',
             'pin_noise_rms_v','conversion_noise_rms_v','pin_range_v','reconstruction_range_v',
             'pin_difference_rms_v','pin_mean_v','reference_mean_v','reconstruction_mean_v',
             'pin_spectral_concentration','reconstruction_unique_fraction')

def family_analysis(samples,fs,reference_available=True):
    a=np.asarray(samples,float)
    if a.ndim!=2 or a.shape[0]!=3 or not 32<=a.shape[1]<=4096 or not np.isfinite(a).all() or not fs>0:
        raise ValueError('Expected three finite, aligned analog channels')
    expected,pin,rec=a;power=np.abs(np.fft.rfft(pin-pin.mean()))**2;f=signal_features(pin,fs,'ADC',_spectral_power=power)
    concentration=float(power[1:].max()/max(power[1:].sum(),1e-12))
    expected_span=float(np.ptp(expected)) if reference_available else None
    steady=expected_span is not None and expected_span<=max(.002,abs(float(expected.mean()))*.002)
    family='STEADY_DC' if steady else ('PERIODIC_ANALOG' if concentration>.35 else 'TIME_VARYING_ANALOG')
    if not reference_available:family='STEADY_OR_UNEXCITED' if f['std']<.02 else family
    return {'family':family,'reference_available':reference_available,'reference_span_v':expected_span,'measured':f,
        'derivative_rms_v_per_s':float(np.sqrt(np.mean(np.diff(pin)**2))*fs),'spectral_concentration':concentration,
        'limitation':'A constant trace cannot exclude a stuck path without changing the stimulus.' if steady or not reference_available else 'Signal patterns do not uniquely determine root causes.'}

def dc_features(samples,fs):
    expected,pin,rec=np.asarray(samples,float);target=float(expected.mean());scale=max(abs(target),.1)
    power=np.abs(np.fft.rfft(pin-pin.mean()))**2;concentration=float(power[1:].max()/max(power[1:].sum(),1e-12))
    return np.asarray([pin.mean()-target,(pin.mean()-target)/scale,(rec-pin).mean(),(rec-pin).mean()/scale,
        np.std(pin),np.std(rec-pin),np.ptp(pin),np.ptp(rec),np.sqrt(np.mean(np.diff(pin)**2)),pin.mean(),target,rec.mean(),concentration,len(np.unique(rec))/len(rec)],np.float32)

def dc_case(pattern,group,profile='development',seed=2026101303):
    r=np.random.default_rng(seed+group*1009);e=np.random.default_rng(seed+group*1009+DC_CLASSES.index(pattern)*37)
    shift=profile=='independent_shift';ref=float(r.uniform(4.5,5.5) if shift else r.uniform(2.5,4.4));level=ref*r.uniform(.06,.86)
    n=int(r.choice([96,160,320,768] if shift else [64,128,256,512]));fs=float(r.choice([500,1600,3200] if shift else [512,1024,2048]))
    bits=int(r.choice([10,12,14]));expected=np.full(n,level);noise=float(r.uniform(.001,.012));pin=expected.copy();actualref=ref;actualbits=bits
    if pattern=='LEVEL_MISMATCH':pin+=r.choice([-1,1])*r.uniform(.12,.45)*max(level,.5)
    if pattern=='HIGH_NOISE':noise=float(r.uniform(.04,.2))
    if pattern=='CONVERSION_MISMATCH':
        if r.random()<.5:actualref*=r.choice([.7,1.3,1.5])
        else:actualbits=max(8,bits-2)
    if pattern=='SATURATION':pin[:]=ref*r.uniform(1.06,1.3)
    pin+=e.normal(0,noise,n) if not shift else e.standard_t(7,n)*noise*np.sqrt(5/7)
    codes=np.clip(np.floor(pin/actualref*2**actualbits),0,2**actualbits-1);rec=codes*ref/2**bits
    return np.stack((expected,pin,rec)),fs,{'group':group,'profile':profile,'pattern':pattern,'reference_voltage':ref,'expected_voltage':level,'bits':bits,'fs':fs,'n':n,'seed':seed}
