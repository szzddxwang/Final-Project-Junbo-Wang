"""Controlled virtual provider. Never imported by diagnostic feature/inference modules."""
import math,copy
import numpy as np
from ..config import load_config
from .capture_features import ACTIONS,UNITS,validate_capture
from .instrument_features import VERSION,TIMES,UNITS as INSTRUMENT_UNITS,validate
SYSTEMS=load_config('systems')
def linear_node(vdrive,rs,rwire,rload):
    current=vdrive/(rs+rwire+rload)
    return current*rload,current

def led_node(vdrive,rs,rwire,vf,leak,limit):
    # Piecewise diode plus finite dynamic resistance; monotonically solved KCL.
    lo,hi=0.,max(0.,vdrive)
    for _ in range(42):
        node=(lo+hi)/2;diode=max(0.,(node-vf)/18);load=diode/(1+diode/max(limit,1e-9))+node/leak
        if load>(vdrive-node)/(rs+rwire):hi=node
        else:lo=node
    node=(lo+hi)/2;return node,(vdrive-node)/(rs+rwire)

def parameters(system,fault,rng,mechanism):
    p=dict(rail=float(rng.choice([2.8,3.3,5.])),source=1.,rs=float(rng.uniform(.2,2)),wire_r=float(rng.uniform(.1,2)),rload=float(rng.uniform(1500,6800)),level=float(rng.uniform(.985,1.015)),command=float(rng.choice([0.,.02,.15,.5,.85])),damage_gain=1.,polarity=1.,noise=float(rng.uniform(.001,.008)),gain=1.,bits=int(rng.choice([8,10,12])),vref=3.3,bias=1.,mode=1.,address=int(rng.integers(8,120)),address_delta=0.,baud=float(rng.choice([9600,38400,115200])),baud_ratio=1.,protocol_error=0.,hz=float(rng.choice([50,500,1000])),drive_gain=1.,tau=float(rng.uniform(.07,.55)),delay=float(rng.uniform(.01,.40)),rp=float(rng.uniform(2200,10000)),cap=float(rng.uniform(30e-12,350e-12)),vf=float(rng.uniform(1.65,2.2)),led_leak=1e8,current_limit=.2,device_load=1.,digital_leak=1e10,mechanism=mechanism)
    p['vref']=p['rail']*float(rng.uniform(.97,1.03))
    if system in ['I2C_SENSOR','UART_DEVICE']:p['command']=1.
    if fault=='PowerSupplyFault':p['source']=float(rng.uniform(.18,.76))
    elif fault=='WiringFault':p['wire_r']=float(np.exp(rng.uniform(np.log(8000),np.log(250000))))
    elif fault=='PolarityFault':p['polarity']=0.
    elif fault=='VoltageLevelFault':p['level']=float(rng.choice([rng.uniform(.4,.68),rng.uniform(1.28,1.55)]))
    elif fault=='SignalIntegrityFault':p['noise']=float(rng.uniform(.10,.28))
    elif fault=='CommunicationFault':p['protocol_error']=float(rng.uniform(.45,.95))
    elif fault=='ConfigurationFault':
        if system=='ANALOG_ADC':p['gain']=float(rng.uniform(.35,.65)if rng.random()<.5 else rng.uniform(1.6,2.2))
        elif system=='DIGITAL_INPUT':p['bias']=0.
        elif system=='LED_GPIO':p['mode']=0.
        elif system=='I2C_SENSOR':p['address_delta']=float(rng.choice([-7,-4,-1,1,2,5]))
        elif system=='UART_DEVICE':p['baud_ratio']=float(rng.choice([.5,1.18,1.4,2.]))
        else:p['drive_gain']=float(rng.choice([.45,1.4]));p['hz']*=1.7
    elif fault=='ComponentFailure':
        p['damage_gain']=float(rng.uniform(.05,.45)if rng.random()<.7 else rng.uniform(1.4,1.7))
        if system=='DIGITAL_INPUT':p['digital_leak']=float(rng.uniform(60,500))
        if system=='LED_GPIO':p['led_leak']=float(rng.choice([.5,1e10]));p['vf']=10. if p['led_leak']>1 else .05
        if system in ['I2C_SENSOR','UART_DEVICE']:p['device_load']=float(rng.uniform(.01,.12))
    return p

def physical_readout(p,system,command,time_s,rng):
    """All instruments observe this circuit response; no categorical cause input."""
    vs=p['rail']*p['source'];drive=vs*command*p['level']*p['polarity']
    rs=p['rs']+(250 if system in ['ANALOG_ADC','DIGITAL_INPUT']else 35)
    load=p['rload']
    if p['mechanism']=='smooth_load':load/=1+.15*command**2
    if system=='DIGITAL_INPUT':load=1/(1/load+1/p['digital_leak'])
    if system=='LED_GPIO':
        drive*=p['mode'];node,current=led_node(drive,rs+330,p['wire_r'],p['vf'],p['led_leak'],p['current_limit'])
    else:node,current=linear_node(drive,rs,p['wire_r'],load)
    if system=='DIGITAL_INPUT'and p['bias']==0:node=vs*(.45+.10*math.sin(time_s*53))
    supply=max(0.,vs-abs(current)*p['rs'])
    signal=node+rng.normal(0,p['noise']*max(supply,.1),64)
    if p['mechanism']=='burst'and rng.random()<.12:signal[rng.integers(0,64)]+=rng.choice([-1,1])*.3*vs
    output=float(np.mean(signal));rms=float(np.std(signal,ddof=1))/max(p['rail'],.05)
    ref=p['vref'];full=2**p['bits']-1;code=float(np.clip(np.rint(np.clip(output/ref*p['gain']*p['damage_gain'],0,1)*full),0,full))
    response=output/p['rail'];logic=output
    rc=p['rp']*p['cap'];rise=rc*math.log(7/3)
    # Explicitly abstract serial timing; no hidden 'healthy' truth bit.
    path=p['rload']/(p['rload']+p['wire_r']);margin=float(np.clip((supply/p['rail']-.4)/.4,0,1))*float(np.clip((p['level']-.3)/.4,0,1))*path*p['polarity']
    frame_error=float(np.clip(abs(p['baud_ratio']-1)*8+p['protocol_error']+p['noise']*2+(1-margin),0,1))
    ack_prob=float(np.clip(margin*(1-min(.95,rise/4e-6))*(1-p['protocol_error'])*(p['device_load']>.3)*(p['address_delta']==0),0,1))
    ack=float(rng.binomial(64,ack_prob)/64);framing=float(rng.binomial(64,frame_error)/64)
    if system in ['I2C_SENSOR','UART_DEVICE']:
        logic=supply*p['level']*path
        # Meter observes supply current during a declared load/poll cycle.
        current=(.002+.004*command)*p['device_load']*p['source']*path
    if system=='PWM_MOTOR_SERVO':
        duty=float(np.clip(command*p['drive_gain'],0,1));response=duty*path*p['damage_gain']*p['level']*p['polarity']*(1-math.exp(-max(0,time_s-p['delay'])/p['tau']))
    else:duty=command
    return dict(supply=supply,node=output,current=current,rms=rms,ref=ref,code=code,response=response,logic=logic,ack=ack,frame_error=framing,baud=p['baud']*p['baud_ratio'],frequency=p['hz'],duty=duty,rise=rise)

def meter(rng,x,scale,sigma,mechanism):
    error=rng.normal(0,sigma*scale)
    if mechanism=='burst'and rng.random()<.025:error+=rng.laplace(0,.15*scale)
    if mechanism=='drift':error+=.012*x
    return float(np.rint((x+error)/max(scale,1e-12)*65535)/65535*scale)

def capture(p,system,declared,action,index,seed,condition):
    rng=np.random.default_rng(seed);command=declared['command']
    if action=='sweep':command=[.15,.85][index]
    if action=='endpoint':command=[.70,.85][index]
    time_s=([.12,2.0]if action!='repeat'else[.20,.20])[index]
    obs=physical_readout(p,system,command,time_s,rng);noise=.004 if 'noisy'not in condition else .04
    q={};lineage={}
    def put(key,value,scale,source):
        q[key]=meter(rng,value,scale,noise/8,p['mechanism']);lineage[key]=source
    rail=declared['rail'];put('supply_ratio',obs['supply']/rail,1,'meter:supply_voltage / declared_rail')
    put('noise_fraction',noise,1,'readback:instrument_uncertainty_setting')
    # Digital current is NOT acquired by the standard panel. Endpoint explicitly
    # switches to a virtual meter/continuity procedure; never default to zero.
    if system!='DIGITAL_INPUT'or action=='endpoint':
        nominal=(rail*max(command,.05)/(p['rload']+250))if system not in ['I2C_SENSOR','UART_DEVICE']else(.002+.004*command)
        put('current_ratio',obs['current']/max(nominal,.0001),1,'meter:current / declared_nominal_current')
    if system not in ['I2C_SENSOR','UART_DEVICE']:
        put('terminal_ratio',obs['node']/rail,1,'meter:terminal_voltage / declared_rail')
        put('response_ratio',obs['response'],1,'waveform:observed_response / declared_scale')
    else:put('logic_high_ratio',obs['logic']/rail,1,'meter:communication_logic_high / declared_rail')
    put('waveform_rms_fraction',obs['rms'],1,'waveform:64 actual signal samples / declared_rail')
    if system=='ANALOG_ADC':
        pin=q.get('terminal_ratio',float('nan'));ref=meter(rng,obs['ref'],rail,noise/8,p['mechanism']);actual=obs['code']/(2**p['bits']-1)
        q.update(adc_residual=float(actual-np.clip(pin*rail/max(ref,.05)*p['gain'],0,1)),reference_ratio=ref/rail,gain_readback=p['gain'],bits_ratio=p['bits']/declared['bits'])
        lineage.update(adc_residual='derived:actual_adc_code,measured_pin,measured_vref,registers',reference_ratio='meter:reference_voltage / declared_rail',gain_readback='readback:adc_gain_register',bits_ratio='readback:adc_resolution_register / declared_resolution')
    elif system=='DIGITAL_INPUT':
        # The input buffer response is an acquired count, not the assigned cause.
        probability=float(np.clip((obs['node']/max(obs['supply'],.05)-.3)/.4,0,1));q['response_ratio']=float(rng.binomial(64,probability)/64);lineage['response_ratio']='waveform:64 digital threshold samples'
        q['bias_readback']=p['bias'];lineage['bias_readback']='readback:input_bias_register'
    elif system=='LED_GPIO':q['mode_readback']=p['mode'];lineage['mode_readback']='readback:gpio_mode_register'
    elif system=='I2C_SENSOR':
        q.update(address_difference=p['address_delta'],ack_fraction=obs['ack']);lineage.update(address_difference='readback:configured_address minus declared_device_address',ack_fraction='waveform:64 actual acknowledgement trials')
        if action=='endpoint':
            put('pullup_readback_kohm',p['rp']/1000,1,'meter:deenergized_pullup_resistance')
            put('rc_time_us',obs['rise']/math.log(7/3)*1e6,1,'waveform:measured_30_to_70_percent_rise_time')
    elif system=='UART_DEVICE':
        put('baud_ratio',obs['baud']/declared['baud'],1,'waveform:observed_baud / configured_baud');q['frame_error']=obs['frame_error'];lineage['frame_error']='waveform:64 actual framing trials'
    elif system=='PWM_MOTOR_SERVO':
        put('frequency_ratio',obs['frequency']/declared['hz'],1,'waveform:measured_driver_frequency / configured_frequency');put('duty_error',obs['duty']-command,1,'waveform:measured_duty minus commanded_duty')
    if action=='endpoint':put('wire_resistance',p['wire_r'],max(2,p['wire_r']), 'meter:deenergized_continuity_resistance')
    # One meter/signal dropout mechanism, with identical sampling by all labels.
    if 'missing'in condition:
        if p['mechanism']=='burst'and rng.random()<.06:q={};lineage={}
        else:
            for key in list(q):
                if rng.random()<.14:q.pop(key);lineage.pop(key)
    result=dict(action=action,capture_index=index+1,command_fraction=command,time_s=time_s,channels=q,lineage=lineage,units={k:UNITS[k]for k in q},samples=64,virtual_only=True,executed=True)
    return validate_capture(result)

def initial(p,system,declared,rng,condition):
    z=physical_readout(p,system,declared['command'],.20,rng);rail=declared['rail'];measure=lambda x,scale=1:meter(rng,x,scale,.005 if 'noisy'not in condition else .025,p['mechanism'])
    m=dict(EXPECTED_SUPPLY_VOLTAGE=rail,SUPPLY_VOLTAGE=measure(z['supply'],rail),EXPECTED_OUTPUT_VOLTAGE=rail*declared['command'],OUTPUT_VOLTAGE=measure(z['node'],rail),EXPECTED_CURRENT=max(.0001,rail*max(declared['command'],.05)/(p['rload']+250)),CURRENT=measure(z['current'],.006),LOGIC_LEVEL=measure(z['logic'],rail),EXPECTED_LOGIC_LEVEL=rail,CONTINUITY=bool(p['wire_r']<100),POLARITY_OK=bool(p['polarity']>0),PULLUP_PRESENT=bool(p['bias']),SIGNAL_PRESENT=bool(abs(z['node'])>.1),ADC_READING=z['code'],EXPECTED_ADC_READING=declared['command']*(2**p['bits']-1),ADC_REFERENCE=rail,ACTUAL_BAUD=z['baud'],EXPECTED_BAUD=declared['baud'],DUTY_CYCLE=z['duty']*100,EXPECTED_DUTY_CYCLE=declared['command']*100,ACK_RECEIVED=bool(z['ack']>.8),COMMUNICATION_SUCCESS=bool(z['ack']>.8 if system=='I2C_SENSOR'else z['frame_error']<.1),TX_SIGNAL_PRESENT=bool(z['logic']>.1),RX_SIGNAL_PRESENT=bool(z['logic']>.1),NOISE_LEVEL=z['rms'])
    m={k:v for k,v in m.items()if k in SYSTEMS[system]['available_measurements']}
    o={}
    if system=='ANALOG_ADC':o.update(ADC_VREF_MEASURED=measure(z['ref'],rail),ADC_BITS_READBACK=p['bits'],ADC_GAIN_READBACK=p['gain'],ADC_PIN_VOLTAGE=measure(z['node'],rail))
    elif system=='DIGITAL_INPUT':o.update(INPUT_BIAS_READBACK=p['bias'],INPUT_PIN_VOLTAGE=measure(z['node'],rail))
    elif system=='LED_GPIO':o.update(GPIO_MODE_READBACK=p['mode'],LOAD_PIN_VOLTAGE=measure(z['node'],rail))
    elif system=='I2C_SENSOR':o.update(I2C_CONFIGURED_ADDRESS=p['address']+p['address_delta'],I2C_OBSERVED_ADDRESS=p['address'],I2C_ACK_FRACTION=z['ack'])
    elif system=='UART_DEVICE':o.update(UART_ENDPOINT_CONTINUITY=bool(p['wire_r']<100),UART_FRAME_ERROR_RATE=z['frame_error'],UART_BAUD_READBACK=z['baud'])
    else:o.update(PWM_DRIVER_DUTY=z['duty']*100,PWM_DRIVER_HZ=z['frequency'],PWM_LOAD_RESPONSE=z['response'])
    if 'missing'in condition:m={k:v for k,v in m.items()if k.startswith('EXPECTED_')or rng.random()>.3};o={k:v for k,v in o.items()if rng.random()>.3}
    return m,o

def acquire(parameters,system,declared,condition,seed):
    """One explicitly costed endpoint procedure; no fault/label argument."""
    p=parameters;rng=np.random.default_rng(seed)
    sigma=.005 if 'noisy' in condition else .0005
    q={};source={};trace=None
    def put(k,value,scale,origin):
        q[k]=meter(rng,value,scale,sigma,p['mechanism'])
        source[k]=origin
    z=physical_readout(p,system,.85,2.,rng)
    if system=='DIGITAL_INPUT':
        # Two physical probe locations and an independent ammeter. Effective
        # load is inferred from V/I, never returned as the hidden leakage value.
        put('node_probe',z['node'],declared['rail'],'meter:input_pin_to_ground')
        put('current_probe',z['current'],.006,'meter:independent_series_current')
        put('drive_probe',z['node']+z['current']*p['wire_r'],declared['rail'],
            'meter:connector_drive_side_to_ground')
        q['nominal_load']=declared['nominal_load'];source['nominal_load']='declared:circuit_nominal_load'
    elif system=='I2C_SENSOR':
        put('pullup_probe',p['rp'],10000.,'meter:deenergized_pullup_resistance')
        put('rise_30_70',z['rise'],1e-5,'waveform:observed_30_to_70_edge_seconds')
    elif system=='PWM_MOTOR_SERVO':
        # This replaces the second64-sample scalar-time response acquisition,
        # rather than adding an uncounted third waveform/capture.
        put('driver_duty',z['duty'],1.,'waveform:observed_driver_high_fraction')
        response=np.array([physical_readout(p,system,.85,float(t),rng)['response'] for t in TIMES])
        response+=rng.normal(0,math.hypot(p['noise'],sigma),len(TIMES))
        if p['mechanism']=='burst' and rng.random()<.12:
            response[rng.integers(0,len(response))]+=rng.choice([-1,1])*.3
        trace=dict(time_s=TIMES.tolist(),response_ratio=response.tolist(),
                   provenance='waveform:64 actually executed virtual transient samples')
    if 'missing' in condition:
        for key in list(q):
            if key!='nominal_load' and rng.random()<.14:q.pop(key);source.pop(key)
        if trace:
            good=rng.random(64)>=.14
            trace['time_s']=TIMES[good].tolist()
            trace['response_ratio']=np.asarray(trace['response_ratio'])[good].tolist()
    result=dict(version=VERSION,system=system,channels=q,
                units={k:INSTRUMENT_UNITS[k] for k in q},lineage=source,
                transient=trace,acquisition_index=2,scheduled_samples=64,
                virtual_only=True,executed=True)
    return validate(result)
