"""Grouped physical simulations. Injection labels are never inference inputs."""
import numpy as np
from ..waveform.generators import ADC_FAULTS, I2C_FAULTS, i2c_case
from ..waveform.protocol_followup import ProtocolCase, i2c_alternative_case, i2c_protocol_features
from ..waveform.research import structured_features
from ..virtual_lab.sensor import sensor_features, MODEL_FEATURES
SENSOR_FAULTS=('NORMAL','NOISE','DRIFT','OFFSET','STUCK','DROPOUT','SLOW_RESPONSE')
ROOT_FAULTS=('Normal','ConfigurationFault','PowerSupplyFault','WiringFault','ComponentFailure','SignalIntegrityFault')
PREPROCESS='physical-scale-multiscale-observed-mask-v1'

def resample(x,length=256):
    x=np.asarray(x,dtype=np.float32)
    return np.stack([np.interp(np.linspace(0,1,length),np.linspace(0,1,x.shape[1]),v) for v in x]).astype(np.float32)

def temporal_input(samples,kind,fs):
    a=np.asarray(samples,dtype=float)
    if a.ndim!=2 or not 32<=a.shape[1]<=4096 or not np.isfinite(fs) or fs<=0: raise ValueError('Invalid bounded temporal input')
    if kind=='sensor':
        if a.shape[0]!=2 or not np.isfinite(a[0]).all(): raise ValueError('Sensor reference required')
        valid=np.isfinite(a[1]);n=np.arange(a.shape[1])
        if valid.sum()<8: raise ValueError('Insufficient observed samples')
        filled=np.interp(n,n[valid],a[1,valid])
        series=np.stack(((a[0]-a[0,0])/10,(filled-a[0,0])/10,(filled-a[0])/5,valid.astype(float)))
        f=sensor_features(a[0],a[1],fs);aux=[f[k] for k in MODEL_FEATURES]+[np.ptp(a[0]),a.shape[1]/fs]
    elif kind=='adc':
        if a.shape[0]!=3 or not np.isfinite(a).all(): raise ValueError('ADC requires three finite channels')
        series=np.vstack((a/10,(a[1]-a[0])/5,(a[2]-a[1])/5))
        aux=structured_features(resample(a)/3.3).tolist()+[np.log1p(fs),a.shape[1]/fs]
    elif kind=='i2c':
        if a.shape[0]!=4 or not np.isfinite(a).all(): raise ValueError('I2C requires four finite channels')
        series=a[2:] # Ideal ACK/SCL excluded from the new model.
        spp=max(4,round(a.shape[1]/21))
        f=i2c_protocol_features(ProtocolCase(a,{'samples_per_bit':spp},{}))
        aux=list(f.values())+[np.log1p(fs),a.shape[1]/fs]
    else: raise ValueError('Unknown temporal model')
    return resample(series),np.asarray(aux,dtype=np.float32)

def adc_wave(fault,group,seed=20261013,scenario='id'):
    r=np.random.default_rng(seed+group*7919);e=np.random.default_rng(seed+group*7919+31*ADC_FAULTS.index(fault))
    n=int(r.choice([128,192,256,384,512]));fs=float(r.choice([512,1024,2048,4096]));ref=float(r.uniform(2.8,3.6));center=float(r.uniform(.9,2.1));amp=float(r.uniform(.2,.65));freq=float(r.uniform(4,45));severity=float(r.uniform(.4,1))
    if scenario=='shift': ref=float(r.uniform(4.5,5.1));center=float(r.uniform(2,3.2));amp=float(r.uniform(.6,1));freq=float(r.uniform(50,90))
    if scenario=='mild': severity=float(r.uniform(.15,.4))
    if scenario=='reduced': n=64
    t=np.arange(n)/fs;command=center+amp*np.sin(2*np.pi*freq*t+r.uniform(0,6.28))
    if group%5==0: command=np.full(n,center)
    pin=command.copy();actual_ref=ref;bits=12;sigma=float(r.uniform(.001,.012))*(2 if scenario=='mild' else 1)
    if fault=='HIGH_NOISE': sigma+=.12*severity
    elif fault=='CLIPPING': pin=np.clip(pin,center-amp*(1-.6*severity),center+amp*(1-.6*severity))
    elif fault=='SATURATION': pin+=ref*(.7+.25*severity)
    elif fault=='GAIN_ERROR': pin*=1-.4*severity
    elif fault=='OFFSET_ERROR': pin+=.6*severity
    elif fault=='REFERENCE_MISMATCH': actual_ref=ref*(1+(.3 if group%2 else -.25)*severity)
    elif fault=='RESOLUTION_MISMATCH': bits=int(r.choice([9,10,11]))
    elif fault=='SIGNAL_ATTENUATION': pin=center+(pin-center)*(1-.7*severity)
    pin+=e.standard_t(5,n)*sigma if group%3==0 else e.normal(0,sigma,n)
    counts=np.clip(np.floor(pin/actual_ref*2**bits),0,2**bits-1)
    a=np.stack((command,pin,counts*ref/4096)).astype(np.float32)
    return a,fs,{'group_id':f'adc-{group}','seed':seed,'scenario':scenario,'target_reference':ref,'frequency':freq,'length':n,'source':'PYTHON_SIMULATION','pattern':fault}

def bus_wave(fault,group,seed=20261013,scenario='id'):
    r=np.random.default_rng(seed+group*7919);spp=int(r.choice([12,16,20,24,28]))
    if scenario=='shift':
        c=i2c_alternative_case(fault,group,seed=seed+701,samples_per_bit=spp);a=c.samples;fs=c.configured['clock_hz']*spp
    else:
        c=i2c_case(fault,group,seed=seed,samples_per_bit=spp);a=c.samples.copy();fs=c.metadata['sampling_rate']
        for j in [2,3]:
            alpha=float(r.uniform(.25,.95))
            for k in range(1,a.shape[1]):
                if a[j,k]>a[j,k-1]: a[j,k]=a[j,k-1]+alpha*(a[j,k]-a[j,k-1])
        if fault=='MISSING_ACK' and group%2:
            start=spp+spp//2+17*spp;a[2,start:start+spp]=0
        if scenario=='mild' and fault in ('HIGH_NOISE','SLOW_RISE'): a[2:]=a[:2]+.55*(a[2:]-a[:2])
        a[2:]=np.clip(a[2:]+r.normal(0,.008,a[2:].shape),0,1)
    if scenario=='reduced': a=resample(a,128)
    return a,fs,{'group_id':f'i2c-{group}','seed':seed,'scenario':scenario,'source':'PYTHON_SIMULATION','pattern':fault,'length':a.shape[1]}

def sensor_wave(fault,group,seed=20261013,scenario='id'):
    r=np.random.default_rng(seed+group*7919);e=np.random.default_rng(seed+group*7919+SENSOR_FAULTS.index(fault)*37)
    fs=float(r.choice([5,10,20]));duration=float(r.uniform(12,35));n=round(fs*duration);t=np.arange(n)/fs
    base=float(r.uniform(12,40));step=float(r.uniform(1,6))*r.choice([-1,1]);tau=float(r.uniform(.2,.8));sigma=float(r.uniform(.015,.08))
    if scenario=='shift': base=float(r.uniform(-10,60));step=float(r.uniform(.5,8))*r.choice([-1,1]);tau=float(r.uniform(.15,1.1));sigma=float(r.uniform(.03,.12))
    reference=base+float(r.uniform(.05,.3))*np.sin(2*np.pi*t/duration);reference[n//3:]+=step
    if scenario=='shift': reference[2*n//3:]-=step*.6
    severity=float(r.uniform(.5,1.5));fault_tau=duration/4 if fault=='SLOW_RESPONSE' else tau
    alpha=1-np.exp(-1/fs/fault_tau);measured=np.empty(n);measured[0]=reference[0]
    for i in range(1,n): measured[i]=measured[i-1]+alpha*(reference[i]-measured[i-1])
    measured+=e.normal(0,sigma*(8*severity if fault=='NOISE' else 1),n)
    if fault=='DRIFT': measured+=r.choice([-1,1])*.12*severity*t
    elif fault=='OFFSET': measured+=r.choice([-1,1])*2*severity
    elif fault=='STUCK': measured[:]=base+e.normal(0,sigma*.05,n)
    elif fault=='DROPOUT': measured[e.random(n)<.15*severity]=np.nan
    return np.stack((reference,measured)),fs,{'group_id':f'sensor-{group}','seed':seed,'scenario':scenario,'source':'PYTHON_SIMULATION','pattern':fault,'fault_onset_s':0,'length':n}

def root_case(root,group,seed=20261013,scenario='id',native_coverage=False):
    """Independent causal labels for supply, wiring, converter, configuration and noise faults."""
    r=np.random.default_rng(seed+group*6151);n=int(r.choice([128,256])) if native_coverage else 256;fs=1024.;ref=float(r.uniform(2.8,3.6))
    if scenario=='shift': ref=float(r.uniform(4.5,5.1))
    command=ref*(.45+.2*np.sin(2*np.pi*r.uniform(5,35)*np.arange(n)/fs+r.uniform(0,6.28)))
    if native_coverage and group%2==0:command[:]=ref*r.uniform(.2,.8)
    supply=ref;vref=ref;pin=command.copy();bits=12
    if root=='ConfigurationFault':
        if (r.random()<.5 if native_coverage else group%2): vref=ref*r.uniform(.7,1.4)
        else: bits=10
    elif root=='PowerSupplyFault': supply=ref*r.uniform(.25,.6);pin=np.clip(pin,0,supply*.9)
    elif root=='WiringFault': pin=np.full(n,r.uniform(0,.08))
    pin+=r.normal(0,.08 if root=='SignalIntegrityFault' else .003,n)
    codes=np.clip(np.floor(pin/vref*2**bits),0,2**bits-1)
    if root=='ComponentFailure': codes[:]=r.integers(100,3900)
    samples=np.stack((command,pin,codes*ref/4096)).astype(np.float32)
    observed={'OUTPUT_VOLTAGE':float(command[0]),'ADC_INPUT_VOLTAGE':float(pin[0]),'ADC_REFERENCE':vref,'ADC_REFERENCE_TARGET':ref,'ADC_RESOLUTION_BITS':bits,'ADC_INTENDED_BITS':12,'ADC_READING':int(codes[0]),'ADC_NOISE_RMS_MV':float(np.std(np.diff(pin-command))/np.sqrt(2)*1000)}
    structured={'SUPPLY_VOLTAGE':supply,'EXPECTED_SUPPLY_VOLTAGE':ref,'OUTPUT_VOLTAGE':float(pin[0]),'EXPECTED_OUTPUT_VOLTAGE':float(command[0]),'ADC_READING':int(codes[0]),'EXPECTED_ADC_READING':int(np.clip(np.floor(command[0]/ref*4096),0,4095)),'ADC_REFERENCE':vref}
    return samples,fs,observed,structured,{'group_id':f'paired-adc-{group}','root_fault':root,'seed':seed,'scenario':scenario,'source':'PYTHON_SIMULATION','operating_point':{'reference':ref,'sample_rate':fs},'mechanism_scope':'single-cause ADC; six root classes; no pattern-to-root mapping'}
