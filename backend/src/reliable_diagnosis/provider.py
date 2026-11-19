"""Acquisition adapter: produces measured packets from physical observations."""
import copy,math
import numpy as np
from ..config import load_config
from .contract import EvidenceV2,UNITS
from .physics import readout

PROFILES=('clean','noisy','missing_channels','no_instruments','no_readbacks','biased','limited_samples','repeat')
READBACK={'gain_readback','bits_ratio','bias_readback','mode_readback','address_difference','framing_config_mismatch'}
EXTRA={'drive_probe','node_probe','current_probe','nominal_load','pullup_probe','rise_30_70','driver_duty','speed_probe','motor_current_ratio'}

def schedule(system,d):
    end=float(np.clip(7*d.get('nominal_tau_s',.25),.3,12)) if system=='PWM_MOTOR_SERVO' else .2
    return [dict(action='low',command_fraction=.2,time_s=max(end*.08,.005)),
            dict(action='high',command_fraction=.85,time_s=end),
            dict(action='transient' if system=='PWM_MOTOR_SERVO' else 'repeat',command_fraction=.6,time_s=min(20,end*1.25))]

def raw_acquisitions(p,s,d,seed):
    return [(step,readout(p,s,d,step['command_fraction'],step['time_s'],np.random.default_rng(seed+7919*(i+1)))) for i,step in enumerate(schedule(s,d))]

def measure_capture(raw,index,profile,rng,tools=None):
    step,z=raw;q=copy.deepcopy(z['channels']);traces=copy.deepcopy(z['traces']);unc={};flags={};lineage={}
    sigma=.002 if profile!='noisy' else .015
    for k,v in list(q.items()):
        if k in READBACK:
            lineage[k]='readback:observed_register_compared_with_declared_setting';unc[k]=.0
        else:
            scale=max(abs(v),1.) if UNITS[k] not in ('A','s','us') else max(abs(v),{'A':.002,'s':1e-7,'us':.1}[UNITS[k]])
            error=sigma*scale;unc[k]=error
            q[k]=float(v+rng.normal(0,error))
            if k in ('wire_resistance','pullup_probe','rise_30_70','rc_time_us','noise_fraction','waveform_rms_fraction','current_ratio','motor_current_ratio'):q[k]=max(0.,q[k])
            if profile=='biased':q[k]+=float(.018*scale);unc[k]=max(error,.018*scale)
            lineage[k]=('meter:deenergized_resistance_after_waveform' if k in ('wire_resistance','pullup_probe','pullup_readback_kohm') else 'waveform:sampled_electrical_or_protocol_observation')
        if profile=='biased':flags[k]=['estimated_nominal']
    if index==0:
        for k in EXTRA|{'wire_resistance','pullup_readback_kohm'}:q.pop(k,None)
        traces={}
    for name,t in traces.items():
        values=np.asarray(t['values']);scale=max(float(np.ptp(values)),.05)
        values=values+rng.normal(0,sigma*scale,len(values))
        if profile=='biased':
            # Finite instrument bandwidth: first-order measurement response.
            for j in range(1,len(values)):values[j]=.55*values[j-1]+.45*values[j]
        if profile=='limited_samples':
            take=np.unique(np.linspace(0,len(values)-1,8).astype(int));values=values[take];t['time_s']=np.asarray(t['time_s'])[take].tolist()
        t['values']=values.tolist()
    if profile=='missing_channels':
        for k in list(q):
            if rng.random()<.3:q.pop(k)
    if profile=='no_instruments':
        for k in EXTRA:q.pop(k,None)
        traces={}
    if profile=='no_readbacks':
        for k in READBACK|{'wire_resistance'}:q.pop(k,None)
    if tools is not None and 'SIMULATION' not in tools:
        is_motor='motor_current_ratio'in z['channels']
        meter={'supply_ratio','supply_probe','terminal_ratio','logic_high_ratio','current_ratio','wire_resistance','pullup_probe','pullup_readback_kohm','node_probe','drive_probe','current_probe','nominal_load','reference_ratio'}
        scope={'response_ratio','waveform_rms_fraction','noise_fraction','rise_30_70','rise_margin','rc_time_us','duty_actual','driver_duty','duty_error','frequency_ratio','settling_ratio','logic_low_ratio','bounce_fraction'}
        logic={'ack_fraction','baud_ratio','frame_error','bus_busy_fraction','clock_stretch_ratio','adc_code_fraction','adc_residual'}
        allowed=set()
        if 'MULTIMETER' in tools:allowed|=meter
        if 'OSCILLOSCOPE' in tools:allowed|=scope
        if 'LOGIC_ANALYZER' in tools:allowed|=logic|{'baud_ratio','frequency_ratio','duty_error','duty_actual'}
        if 'VISUAL_SETTINGS' in tools:allowed|=READBACK
        if 'CURRENT_PROBE' in tools:allowed|={'current_probe','motor_current_ratio'}
        if 'RPM_ENCODER' in tools:allowed|={'speed_probe','response_ratio'}
        if is_motor and 'RPM_ENCODER'not in tools:allowed.discard('response_ratio')
        q={k:v for k,v in q.items() if k in allowed}
        traces={k:v for k,v in traces.items() if (k in ('voltage','logic') and 'OSCILLOSCOPE'in tools) or (k=='logic' and 'LOGIC_ANALYZER'in tools) or (k=='response' and 'RPM_ENCODER'in tools) or (k=='current' and 'CURRENT_PROBE'in tools)}
    return dict(capture_index=index+1,**step,channels=q,units={k:UNITS[k] for k in q},lineage={k:lineage[k] for k in q},
        uncertainty={k:unc[k] for k in q},flags={k:v for k,v in flags.items() if k in q},traces=traces,
        samples=int(z['samples'])+sum(len(t['values']) for t in traces.values())+int('wire_resistance'in q),virtual_only=True,executed=True)

def initial_observations(s,d,cap):
    q=cap['channels'];rail=d['rail_v'];cmd=cap['command_fraction'];m={};o={}
    m.update(EXPECTED_SUPPLY_VOLTAGE=rail,EXPECTED_LOGIC_LEVEL=rail,EXPECTED_OUTPUT_VOLTAGE=rail*(1 if s in ('I2C_SENSOR','UART_DEVICE') else cmd),
             EXPECTED_CURRENT=d['nominal_current_a'],EXPECTED_DUTY_CYCLE=cmd*100,EXPECTED_BAUD=d['baud'],EXPECTED_ADC_READING=cmd*(2**int(d['adc_bits'])-1))
    maps={'supply_ratio':('SUPPLY_VOLTAGE',rail),'terminal_ratio':('OUTPUT_VOLTAGE',rail),'logic_high_ratio':('LOGIC_LEVEL',rail),
          'current_ratio':('CURRENT',d['nominal_current_a']),'adc_code_fraction':('ADC_READING',2**int(d['adc_bits'])-1),
          'reference_ratio':('ADC_REFERENCE',d['reference_nominal_v']),'baud_ratio':('ACTUAL_BAUD',d['baud']),
          'duty_actual':('DUTY_CYCLE',100),'waveform_rms_fraction':('NOISE_LEVEL',1)}
    for k,(code,scale) in maps.items():
        if k in q:m[code]=max(0.,q[k]*scale)
    if 'wire_resistance'in q:m['CONTINUITY']=q['wire_resistance']<100
    if 'ack_fraction'in q:m.update(ACK_RECEIVED=q['ack_fraction']>.8,COMMUNICATION_SUCCESS=q['ack_fraction']>.8)
    if 'frame_error'in q:m['COMMUNICATION_SUCCESS']=q['frame_error']<.05
    if 'logic_high_ratio'in q:m.update(TX_SIGNAL_PRESENT=q['logic_high_ratio']>.5,RX_SIGNAL_PRESENT=q['logic_high_ratio']>.5,SIGNAL_PRESENT=q['logic_high_ratio']>.1)
    if 'bias_readback'in q:m['PULLUP_PRESENT']=q['bias_readback']>.5
    if 'duty_actual'in q:m['PWM_PRESENT']=q['duty_actual']>.01
    if 'terminal_ratio'in q and abs(q['terminal_ratio'])>3*cap.get('uncertainty',{}).get('terminal_ratio',.01):m['POLARITY_OK']=q['terminal_ratio']>=0
    if 'mode_readback'in q:m['CONFIGURATION_OK']=q['mode_readback']==d['gpio_mode']
    elif 'bias_readback'in q:m['CONFIGURATION_OK']=q['bias_readback']>.5
    elif 'gain_readback'in q:m['CONFIGURATION_OK']=abs(q['gain_readback']/d['target_gain']-1)<.025
    elif 'address_difference'in q:m.update(CONFIGURATION_OK=q['address_difference']==0,ADDRESS_CORRECT=q['address_difference']==0)
    elif 'baud_ratio'in q and 'framing_config_mismatch'in q:
        m['BAUD_RATE_CORRECT']=abs(q['baud_ratio']-1)<.02;m['CONFIGURATION_OK']=m['BAUD_RATE_CORRECT'] and q['framing_config_mismatch']==0
    if s=='LED_GPIO' and 'mode_readback'in q:o['GPIO_MODE_READBACK']=q['mode_readback']
    if s=='DIGITAL_INPUT' and 'bias_readback'in q:o['INPUT_BIAS_READBACK']=q['bias_readback']
    if s=='ANALOG_ADC':
        for k,code,scale in [('reference_ratio','ADC_VREF_MEASURED',d['reference_nominal_v']),('gain_readback','ADC_GAIN_READBACK',1),('bits_ratio','ADC_BITS_READBACK',d['adc_bits']),('terminal_ratio','ADC_PIN_VOLTAGE',rail)]:
            if k in q:o[code]=q[k]*scale
    if s=='I2C_SENSOR':
        if 'address_difference'in q:o['I2C_CONFIGURED_ADDRESS']=d['address']+q['address_difference']
        if 'ack_fraction'in q:o['I2C_ACK_FRACTION']=q['ack_fraction']
    if s=='UART_DEVICE':
        if 'frame_error'in q:o['UART_FRAME_ERROR_RATE']=q['frame_error']
        if 'baud_ratio'in q:o['UART_BAUD_READBACK']=q['baud_ratio']*d['baud']
    if s=='PWM_MOTOR_SERVO':
        for k,code,scale in [('duty_actual','PWM_DRIVER_DUTY',100),('frequency_ratio','PWM_DRIVER_HZ',d['pwm_hz']),('response_ratio','PWM_LOAD_RESPONSE',1)]:
            if k in q:o[code]=q[k]*scale
    allowed=load_config('systems')[s]['available_measurements'];return {k:v for k,v in m.items() if k in allowed},o

def packet_from_raw(s,d,load_type,raw,profile,seed,tools=None,count=2):
    rng=np.random.default_rng(seed);captures=[measure_capture(x,i,profile,rng,tools) for i,x in enumerate(raw[:count])]
    # Initial readings are an explicitly measured low-excitation acquisition;
    # no private setting or truth-derived Boolean is added.
    m,o=initial_observations(s,d,captures[0])
    if profile=='missing_channels':
        m={k:v for k,v in m.items() if k.startswith('EXPECTED_') or rng.random()>.3}
    return EvidenceV2(system=s,measurements=m,observations=o,declared=d,load_type=load_type,available_tools=tools,captures=captures).model_dump()
