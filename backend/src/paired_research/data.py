"""Causal paired simulators. Each event owns all its raw observations.

Labels/interventions are evaluation-only. Supply, continuity and polarity are
explicit instrument observations. Hidden ADC reference/bits are not returned.
"""
import numpy as np
from ..config import load_config
from ..waveform.generators import i2c_case
from ..waveform.protocol_followup import i2c_alternative_case,uart_case
from .features import waveform_features,uart_decode
SYSTEMS=tuple(load_config('systems'));SEED=2026101402

def paired_event(system,fault,group,condition='id'):
    classes=load_config('systems')[system]['applicable_faults']
    if fault not in classes:raise ValueError('Unsupported root fault')
    rng=np.random.default_rng(SEED+group*7919+SYSTEMS.index(system)*101);noise=np.random.default_rng(SEED+group*8191+classes.index(fault)*37)
    shift=condition=='shift';severity=float(rng.uniform(.3,.9) if shift else rng.uniform(.5,1.0))
    nominal=float(rng.uniform(3.0,5.2) if shift else rng.uniform(3.15,3.45))
    supply=nominal*(1-.65*severity if fault=='PowerSupplyFault' else rng.uniform(.97,1.03))
    resistance=float(rng.uniform(.02,.8)) if fault!='WiringFault' else float(rng.uniform(500,10000))
    orientation=-1 if fault=='PolarityFault' else 1;gain=1-.62*severity if fault=='VoltageLevelFault' else 1.
    m={'SUPPLY_VOLTAGE':float(supply+noise.normal(0,.006*nominal)),'EXPECTED_SUPPLY_VOLTAGE':nominal,'CONTINUITY':bool(resistance+noise.normal(0,.05)<5),'POLARITY_OK':bool(orientation>0)}
    config={'vdd':nominal,'source':'PYTHON_SIMULATION'};connected=resistance<5 and orientation>0
    if system=='I2C_SENSOR':
        pattern={'ConfigurationFault':'MISSING_ACK','CommunicationFault':'MISSING_ACK','ComponentFailure':'SDA_STUCK_LOW','SignalIntegrityFault':('SLOW_RISE' if group%2 else 'HIGH_NOISE'),'WiringFault':'SCL_STUCK_LOW'}.get(fault,'NORMAL')
        spp=int(rng.choice([12,16,20,24]));c=i2c_alternative_case(pattern,group,seed=SEED,samples_per_bit=spp) if shift else i2c_case(pattern,group,seed=SEED,samples_per_bit=spp)
        observed=c.samples[2:].copy()*supply*gain
        if orientation<0:observed[:]=0
        if shift:observed+=noise.normal(0,.025*nominal,observed.shape)
        config.update(samples_per_bit=spp,sample_rate_hz=float((c.configured['clock_hz'] if shift else c.metadata['sampling_rate']/spp)*spp))
        x=waveform_features(system,observed,config);actual_address=0x42 if fault!='ConfigurationFault' else 0x43
        m.update(CURRENT=float(.008*supply/nominal*(1 if connected else .15)),EXPECTED_CURRENT=.008,LOGIC_LEVEL=float(np.quantile(observed,.95)),EXPECTED_LOGIC_LEVEL=nominal,PULLUP_PRESENT=bool(resistance<5),SDA_STATE='Toggling' if x[4]>2 else ('Low' if observed[0].mean()<.5*nominal else 'High'),SCL_STATE='Toggling' if x[5]>2 else ('Low' if observed[1].mean()<.5*nominal else 'High'),ACK_RECEIVED=bool(x[0]<.3 and x[1]<.3),ADDRESS_CORRECT=bool(actual_address==0x42),CONFIGURATION_OK=bool(actual_address==0x42),COMMUNICATION_SUCCESS=bool(x[0]<.3 and x[1]<.3 and x[5]>=30),NOISE_LEVEL=float(min(x[-1],1)))
    elif system=='UART_DEVICE':
        pattern={'ConfigurationFault':'BAUD_MISMATCH','CommunicationFault':'FRAMING_ERROR','ComponentFailure':'IDLE_LOW','SignalIntegrityFault':('TIMING_JITTER' if group%2 else 'HIGH_NOISE'),'WiringFault':'RX_DISCONNECTED'}.get(fault,'NORMAL')
        spp=int(rng.choice([12,16,20,24]));c=uart_case(pattern,group,seed=SEED,samples_per_bit=spp,shifted=shift)
        observed=c.samples.copy()/c.configured['vdd']*nominal;observed[1:]*=supply/nominal*gain
        if orientation<0:observed[1:]=0
        config.update(baud=c.configured['baud'],sample_rate_hz=c.configured['baud']*spp,parity='NONE')
        f=uart_decode(observed,config);baud=config['baud']/max(1+f['baud_residual'],.2)
        m.update(CURRENT=float(.014*supply/nominal*(1 if connected else .15)),EXPECTED_CURRENT=.014,LOGIC_LEVEL=float(np.quantile(observed[2],.95)),EXPECTED_LOGIC_LEVEL=nominal,TX_SIGNAL_PRESENT=bool(f['tx_swing']>.4),RX_SIGNAL_PRESENT=bool(f['rx_swing']>.4),ACTUAL_BAUD=float(baud),EXPECTED_BAUD=float(config['baud']),BAUD_RATE_CORRECT=bool(abs(baud/config['baud']-1)<.08),CONFIGURATION_OK=bool(abs(baud/config['baud']-1)<.08),COMMUNICATION_SUCCESS=bool(f['valid_frame'] and not f['framing_error'] and f['command_rx_mismatch']<.1),NOISE_LEVEL=float(min(f['noise_ratio'],1)))
    else:
        n=384 if shift else 256;fs=1024.;t=np.arange(n)/fs;duty=float(rng.uniform(.2,.8));freq=float(rng.uniform(24,55));command=((t*freq)%1<duty).astype(float)*nominal;config.update(sample_rate_hz=fs)
        drive=command*supply/nominal*gain*(1 if connected else 0)
        if fault=='ConfigurationFault':drive=(((t*freq)%1)<min(duty+.25,.95)).astype(float)*supply
        if fault=='SignalIntegrityFault':drive+=noise.normal(0,.22*nominal*severity,n)
        if system=='PWM_MOTOR_SERVO':
            speed=float(rng.uniform(80,160));tau=float(rng.uniform(.02,.065));nominal_current=float(rng.uniform(.15,.35));config.update(nominal_speed=speed,nominal_tau=tau,nominal_current=nominal_current)
            response=np.zeros(n);current=np.zeros(n);jam=.12 if fault=='ComponentFailure' else 1;actual_tau=tau*(1.4 if shift else 1);alpha=1-np.exp(-1/fs/actual_tau)
            for j in range(1,n):
                target=speed*np.clip(drive[j]/nominal,0,1)*jam;response[j]=response[j-1]+alpha*(target-response[j-1])
                load=nominal_current*(max(drive[j],0)/nominal+.4*abs(target-response[j])/speed)*(4 if jam<1 else 1);current[j]=current[j-1]+.3*(load-current[j-1])
            response+=noise.normal(0,.005*speed,n);current+=noise.normal(0,.006*nominal_current,n);observed=np.stack((command,drive,current,response))
            m.update(CURRENT=float(np.mean(current[n//2:])),EXPECTED_CURRENT=float(nominal_current*duty),PWM_PRESENT=bool(np.ptp(drive)>.4*nominal),DUTY_CYCLE=float(np.mean(drive>nominal*.5)),EXPECTED_DUTY_CYCLE=duty)
        elif system=='LED_GPIO':
            resistor=float(rng.choice([100,220,470,1000,2200]));vf=float(rng.uniform(1.7,2.2));actual_r=resistor*(2.5 if fault=='ConfigurationFault' else rng.uniform(.95,1.05));actual_vf=vf+(.8*severity if fault=='ComponentFailure' else 0)
            current=np.maximum(drive-actual_vf,0)/actual_r;forward=np.minimum(np.maximum(drive,0),actual_vf);current+=noise.normal(0,.00002,n);forward+=noise.normal(0,.004,n)
            observed=np.stack((command,drive,current,forward));config.update(series_resistance_ohm=resistor,nominal_forward_voltage=vf);on=command>nominal*.5
            m.update(CURRENT=float(max(np.mean(current[on]),0)),EXPECTED_CURRENT=float(max((nominal-vf)/resistor,.0001)))
        elif system=='DIGITAL_INPUT':
            if fault=='ComponentFailure':drive[:]=float(rng.choice([0,nominal]))
            if fault=='ConfigurationFault':drive=.5*nominal+noise.normal(0,.16*nominal,n)
            if fault=='SignalIntegrityFault':
                for edge in np.flatnonzero(np.diff(command)):
                    for j in range(edge,min(edge+8,n)):drive[j]=nominal*(j%2)
            observed=np.stack((command,drive));on=command>nominal*.5
            m.update(LOGIC_LEVEL=float(np.mean(drive[on])),EXPECTED_LOGIC_LEVEL=nominal,PULLUP_PRESENT=bool(np.std(drive-command)<.35*nominal),SIGNAL_PRESENT=bool(np.ptp(drive)>.4*nominal))
        else:
            ref=nominal;center=nominal*float(rng.uniform(.3,.6));amp=nominal*float(rng.uniform(.1,.22));command=center+amp*np.sin(2*np.pi*float(rng.uniform(5,80))*t)
            pin=command*supply/nominal*gain*(1 if connected else 0);sigma=.08*nominal*severity if fault=='SignalIntegrityFault' else .003*nominal;pin+=noise.normal(0,sigma,n);actual_ref=ref*(1+.35*severity if fault=='ConfigurationFault' else 1)
            if fault=='ComponentFailure':pin=np.full(n,float(np.mean(pin)))+noise.normal(0,.001*nominal,n)
            counts=np.clip(np.floor(pin/actual_ref*4096),0,4095);rec=counts*ref/4096;observed=np.stack((command,pin,rec));drive=pin;config.update(declared_reference=ref,declared_bits=12)
            m.update(CURRENT=float(.012*supply/nominal),EXPECTED_CURRENT=.012,ADC_READING=float(np.mean(counts)),EXPECTED_ADC_READING=float(np.mean(command)/ref*4096),ADC_REFERENCE=ref,SIGNAL_PRESENT=bool(np.ptp(pin)>.1*nominal))
        high=command>np.median(command)
        m.update(OUTPUT_VOLTAGE=float(np.mean(drive[high]) if high.any() else np.mean(drive)),EXPECTED_OUTPUT_VOLTAGE=float(np.mean(command[high]) if high.any() else np.mean(command)),CONFIGURATION_OK=bool(np.mean(abs(drive-command))<.18*nominal),NOISE_LEVEL=float(min(np.std(drive-command)/nominal,1)))
    allowed=load_config('systems')[system]['available_measurements'];m={k:v for k,v in m.items() if k in allowed}
    return {'case_id':f'paired-{system}-{group}-{classes.index(fault)}','group_id':f'{system}-{group}','system_type':system,'symptom_type':'OTHER','fault_type':fault,'measurements':m,'samples':observed.astype(np.float32).tolist(),'configured':config,'condition':condition,'severity':severity,'source':'PYTHON_SIMULATION','generator':('independent_rc_i2c' if shift and system=='I2C_SENSOR' else 'physical_event_v3'),'pairing':'one physical event; all observations derived before serialization'}
