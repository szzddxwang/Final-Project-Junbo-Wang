"""Operating-point invariant novelty features; warning-only experimental scope."""
import numpy as np

def novelty_features(samples):
    command,pin,rec=np.asarray(samples,float);n=len(command);scale=max(np.std(command),.05)
    def relationship(a,b):
        design=np.c_[a-a.mean(),np.ones(len(a))];coef=np.linalg.lstsq(design,b,rcond=None)[0];res=b-design@coef
        sd=max(float(np.std(res)),1e-7);centered=b-b.mean();power=np.abs(np.fft.rfft(centered))**2
        return [coef[0],(b.mean()-a.mean())/max(abs(a.mean()),.1),sd/scale,
                float(np.quantile(abs(res),.99)/sd),float(np.mean((res/sd)**4)),
                float(np.std(np.diff(res))/sd),float(power[1:].max()/max(power[1:].sum(),1e-9)),
                float(np.ptp(b)/max(np.ptp(a),.1))]
    return np.clip(np.asarray(relationship(command,pin)+relationship(pin,rec),np.float32),-1000,1000)

def far_wave(group,seed=2026101304):
    """Raw three-channel nonlinear burst/crosstalk stress, not normalized noise."""
    r=np.random.default_rng(seed+group*1301);n=int(r.choice([128,256,384]));fs=float(r.choice([512,1024,2048]));t=np.arange(n)/fs
    ref=float(r.uniform(2.8,5.2));command=ref*(.45+.2*np.sin(2*np.pi*r.uniform(5,60)*t))
    pulses=(r.random(n)<.04).astype(float)*r.uniform(.3,1.2)*ref
    pin=command*.4+abs(command-command.mean())*.9+pulses+r.normal(0,.02,n)
    counts=np.clip(np.floor(pin/ref*4096),0,4095);rec=counts*ref/4096
    # ADC data-line burst corruption is an unseen compound temporal mechanism.
    start=int(r.integers(0,n//2));rec[start:start+n//5]=np.roll(rec[start:start+n//5],3)+ref*.2
    return np.stack((command,pin,rec)),fs
