"""Observable-only decoding and residuals; no labels or hidden parameters."""
import numpy as np
from ..feature_engineering import extract_features, COMMON_FEATURES, IMPROVED_FEATURES, NEXT_ROUND_OBSERVABLE_FEATURES
from ..waveform.protocol_followup import ProtocolCase, i2c_protocol_features
BASE_KEYS=tuple(COMMON_FEATURES+IMPROVED_FEATURES+NEXT_ROUND_OBSERVABLE_FEATURES)

def physical_features(system,measurements):
    f=extract_features(system,measurements);raw=np.asarray([f[k] for k in BASE_KEYS],float)
    valid=np.isfinite(raw);x=np.nan_to_num(raw);d=dict(zip(BASE_KEYS,x));v=dict(zip(BASE_KEYS,valid))
    pairs=[('supply_ratio','output_supply_ratio'),('current_ratio','supply_ratio'),('output_signed_error','duty_signed_error'),('tx_observed','rx_observed'),('ack_observed','communication_response'),('polarity_status','continuity_status')]
    residual=[d[a]-d[b] if v[a] and v[b] else 0 for a,b in pairs];masks=[float(v[a] and v[b]) for a,b in pairs]
    return np.r_[np.clip(x,-100,100),valid.astype(float),residual,masks].astype(np.float32)

def _edges(signal,threshold):return np.flatnonzero(np.diff((signal>threshold).astype(int)))+1

def uart_decode(samples,configured):
    """Decode RX at configured sample rate/baud using an observed start edge.

    Captured stop/parity bits, timing and levels are evidence. True injected
    baud, fault and generator metadata are never read by this function.
    """
    command,tx,rx=np.asarray(samples,float);vdd=float(configured['vdd'])
    spp=float(configured['sample_rate_hz'])/float(configured['baud'])
    if not 4<=spp<=256:raise ValueError('Unsupported UART sample density')
    n=len(rx);rb=rx>.5*vdd;tb=tx>.5*vdd;cb=command>.5*vdd
    falling=np.flatnonzero(rb[:-1]&~rb[1:])+1;start=int(falling[0]) if len(falling) else -1
    parity=configured.get('parity','NONE');stop_index=10 if parity!='NONE' else 9
    centers=np.round(start+(np.arange(stop_index+1)+.5)*spp).astype(int)
    valid=start>=0 and centers[-1]<n;bits=rb[centers] if valid else np.zeros(stop_index+1,bool)
    payload=int(sum(int(bits[j+1])<<j for j in range(8))) if valid else -1
    parity_error=0.
    if valid and parity!='NONE':parity_error=float(int(bits[9]) != ((sum(bits[1:9])%2) ^ (parity=='ODD')))
    ce=_edges(command,.5*vdd);te=_edges(tx,.5*vdd);edge_drift=edge_jitter=1.
    if len(ce)==len(te) and len(ce)>=3:
        z=(te-ce)/spp;p=np.polyfit(np.arange(len(z)),z,1);edge_drift=abs(p[0]);edge_jitter=float(np.std(z-np.polyval(p,np.arange(len(z)))))
    widths=np.diff(te);short=widths[widths>=spp*.4];estimated_period=float(np.quantile(short,.25)) if len(short) else spp*4
    smooth=np.convolve(rx,np.ones(3)/3,mode='same')
    return {'start_found':float(start>=0),'valid_frame':float(valid),'framing_error':float(not valid or bits[0] or not bits[-1]),'parity_error':float(parity_error),'decoded_byte_normalized':max(payload,0)/255,'baud_residual':estimated_period/spp-1,'edge_drift':edge_drift,'edge_jitter':edge_jitter,'tx_rx_mismatch':float(np.mean(tb!=rb)),'command_rx_mismatch':float(np.mean(cb!=rb)),'rx_swing':float(np.ptp(rx)/vdd),'tx_swing':float(np.ptp(tx)/vdd),'idle_level':float(np.median(rx[:max(2,int(spp))])/vdd),'noise_ratio':float(np.std((rx-smooth)[3:-3])/vdd)}

def waveform_features(system,samples,configured):
    a=np.asarray(samples,float)
    if a.ndim!=2 or not 64<=a.shape[1]<=4096 or not np.isfinite(a).all():raise ValueError('Bounded finite capture required')
    vdd=max(float(configured.get('vdd',3.3)),.1)
    if system=='I2C_SENSOR':
        if a.shape[0]!=2:raise ValueError('Observed SDA/SCL required')
        # This decoder reads only last two channels; no ideal ACK enters it.
        return np.asarray(list(i2c_protocol_features(ProtocolCase(np.vstack((np.zeros_like(a),a/vdd)),configured,{})).values()),np.float32)
    if system=='UART_DEVICE':return np.asarray(list(uart_decode(a,configured).values()),np.float32)
    if system=='ANALOG_ADC':
        from ..reliability.mechanistic_ood import mechanism_features
        return mechanism_features(a).astype(np.float32)
    if system=='PWM_MOTOR_SERVO':
        command,drive,current,response=a;nominal=float(configured['nominal_speed']);expected_current=max(float(configured['nominal_current']),.001);tail=slice(len(command)//2,None)
        expected=nominal*np.mean(command[tail]/vdd);target=command/vdd*nominal;pred=np.zeros_like(target);alpha=1-np.exp(-1/float(configured['sample_rate_hz'])/float(configured['nominal_tau']))
        for j in range(1,len(pred)):pred[j]=pred[j-1]+alpha*(target[j]-pred[j-1])
        return np.asarray([np.mean(drive>vdd*.5),np.mean(command>vdd*.5),np.ptp(drive)/vdd,np.mean(current[tail])/expected_current,np.std(current)/expected_current,np.mean(response[tail])/max(expected,.01),np.sqrt(np.mean((response-pred)**2))/nominal,np.max(current)/expected_current,np.std(np.diff(response))/nominal,len(_edges(drive,vdd*.5))/len(drive)],np.float32)
    if system=='LED_GPIO':
        command,drive,current,vf=a;r=float(configured['series_resistance_ohm']);expected=np.maximum(drive-vf,0)/r;on=command>vdd*.5;expected_high=max((vdd-float(configured['nominal_forward_voltage']))/r,.0001)
        if not on.any():raise ValueError('LED capture has no commanded ON samples')
        return np.asarray([np.mean(drive[on])/vdd,np.mean(current[on])/expected_high,np.sqrt(np.mean((current-expected)**2))/expected_high,np.mean(vf[on])/vdd,np.std(current[on])/expected_high,np.mean(np.abs(current[~on]))/expected_high if (~on).any() else 0,np.ptp(drive)/vdd,float(np.mean(on))],np.float32)
    if system=='DIGITAL_INPUT':
        command,line=a;actual=line/vdd;expected=command/vdd
        return np.asarray([np.mean((actual>.7)!=(expected>.7)),np.mean((actual>=.3)&(actual<=.7)),len(_edges(line,vdd*.5))/max(len(_edges(command,vdd*.5)),1),np.std(actual-expected),np.quantile(actual,.1),np.quantile(actual,.9)],np.float32)
    raise ValueError('Unsupported waveform system')
