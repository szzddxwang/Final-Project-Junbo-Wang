"""Controlled plant operations. Never imported by inference or feature code."""
import copy,math
import numpy as np
from scipy.optimize import brentq
from scipy.integrate import solve_ivp
from src.selective_diagnosis.scenarios import observe as original_observe
from src.reliable_diagnosis.physics import readout,create_parameters

ACTIONS={
 'restore_supply':('source',), 'repair_wire':('wire_r',),
 'correct_polarity':('polarity',), 'restore_logic_level':('level',),
 'reduce_interference':('noise','jitter'),
 'restore_configuration':('mode','bias','gain','configured_address','baud','tx_parity','rx_parity','stop_bits','rx_stop_bits','drive_gain','hz'),
 'repair_communication':('protocol_error','busy'),
 'replace_component':('vf','leak','input_leak','damage_gain','inl','device_response','kt','b','load'),
 'unchanged_repeat':(),
}
ACTION_CAUSES={'restore_supply':'PowerSupplyFault','repair_wire':'WiringFault','correct_polarity':'PolarityFault','restore_logic_level':'VoltageLevelFault','reduce_interference':'SignalIntegrityFault','restore_configuration':'ConfigurationFault','repair_communication':'CommunicationFault','replace_component':'ComponentFailure'}

def correct(parameters,nominal,action):
    """Apply the chosen physical operation regardless of the actual injected cause."""
    if action not in ACTIONS:raise ValueError('Unknown corrective operation')
    result=copy.deepcopy(parameters)
    for key in ACTIONS[action]:result[key]=nominal[key]
    return result

def observe(p,s,d,command,ending,rng,independent=False):
    q=copy.deepcopy(p);mechanism=q.get('extended_mechanism')
    a=q.get('extended_amplitude',.3)
    if mechanism=='delayed_contact':q['wire_r']+=a*8000*float(ending>.27)
    elif mechanism=='supply_recovery':q['source']*=1-a*math.exp(-ending/.18)
    elif mechanism=='supply_ringing':q['source']*=1-a*math.exp(-ending/.7)*math.sin(22*ending)
    elif mechanism=='contact_window':q['wire_r']+=a*8000*float(.14<ending<.33)
    elif mechanism=='connection_recovery':q['wire_r']+=a*5000*math.exp(-ending/.15)
    elif mechanism=='command_supply_sag':q['source']*=1-a*command**2*(1-math.exp(-ending/.4))
    elif mechanism=='warming_parameter':
        warm=1-math.exp(-ending/.35)
        if s=='LED_GPIO':q['vf']-=a*.15*warm
        elif s=='ANALOG_ADC':q['offset']+=a*.015*warm;q['vref']*=1-a*.03*warm
        elif s=='DIGITAL_INPUT':q['input_leak']/=1+a*50*warm
        elif s=='I2C_SENSOR':q['cap']*=1+a*2*warm
        elif s=='UART_DEVICE':q['baud']*=1+a*.05*warm
        else:q['load']*=1+a*3*warm
    elif mechanism=='thermal_hysteresis':
        warm=1-math.exp(-ending/.35)
        if s=='LED_GPIO':q['vf']-=a*.6*warm
        elif s=='PWM_MOTOR_SERVO':q['R']*=1+a*warm
        elif s=='ANALOG_ADC':q['vref']*=1+a*.2*warm
        else:q['level']*=1-a*.25*warm
    z=original_observe(q,s,d,command,ending,rng)
    if not independent:return z
    if s=='LED_GPIO'and not q.get('expanded_mechanism')and not q.get('contact_ohm'):
        source=q['rail']*q['source'];drive=source*command*q['level']*q['polarity']*q['mode'];res=q['rs']+q['wire_r']+q['resistor']
        isat=.005/math.expm1(q['vf']/q['nvt'])
        def kcl(v):return (drive-v)/res-isat*math.expm1(float(np.clip(v/q['nvt'],-40,80)))-v/q['leak']
        node=brentq(kcl,min(0.,drive),max(0.,drive),xtol=1e-13)if drive else 0.;amp=(drive-node)/res;sup=source-abs(amp)*q['rs']
        z.update(supply=sup,current=amp,node=node);z['channels'].update(response_ratio=amp/max(d['nominal_current_a'],.0001),supply_ratio=sup/d['rail_v'],supply_probe=sup,current_ratio=amp/max(d['nominal_current_a'],1e-5),terminal_ratio=node/d['rail_v'],logic_high_ratio=max(0,node)/d['rail_v'])
    elif s=='PWM_MOTOR_SERVO'and q['motor_type']=='dc_motor'and not q.get('expanded_mechanism'):
        times=np.array(z['traces']['response']['time_s']);duty=float(np.clip(command*q['drive_gain'],0,1));voltage=max(0,q['rail']*q['source']*q['level']*duty-q['voltage_drop']);res=q['R']+q['rs']+q['wire_r']
        # Event-based standstill avoids a discontinuous Jacobian at omega=0.
        # The breakaway time is found numerically, not borrowed from motor_trace.
        tt=np.maximum(0,times-q['delay']);duration=float(tt[-1]);current=np.zeros_like(times);w=np.zeros_like(times)
        if duration>0:
            def event(t,state):return q['kt']*state[0]-q['load']
            event.terminal=True;event.direction=1
            locked=solve_ivp(lambda t,y:[(voltage-res*y[0])/q['L']],(0,duration),[0.],method='Radau',events=event,dense_output=True,rtol=2e-7,atol=1e-10,max_step=max(ending/100,1e-5))
            if not locked.success:raise RuntimeError(locked.message)
            turn=float(locked.t[-1]);current=locked.sol(np.minimum(tt,turn))[0]
            if len(locked.t_events[0]):
                def moving(t,state):
                    i,omega=state
                    return [(voltage-res*i-q['ke']*omega)/q['L'],(q['kt']*i-q['b']*omega-q['load'])/q['J']]
                sol=solve_ivp(moving,(turn,duration),[float(locked.y[0,-1]),0.],method='Radau',dense_output=True,rtol=2e-7,atol=1e-10,max_step=max(ending/100,1e-5))
                if not sol.success:raise RuntimeError(sol.message)
                after=tt>=turn;states=sol.sol(tt[after]);current[after]=states[0];w[after]=states[1]
        omega=q['polarity']*np.maximum(0,w);response=omega/d['nominal_speed_rad_s']
        if q['ring']:response+=q['ring']*np.sin(2*math.pi*9*times)*np.exp(-times/.8)
        if q['load_ripple']:response*=1-q['load_ripple']*.3*np.sin(times*12)
        sup=max(0,q['rail']*q['source']-abs(current[-1])*q['rs']);node=sup*duty*q['level']*q['polarity'];amp=float(current[-1])
        z.update(supply=sup,current=amp,node=node);z['traces']['response']['values']=response.tolist();z['traces']['current']['values']=current.tolist()
        z['channels'].update(response_ratio=float(response[-1]),position_error=float(response[-1]-command),speed_probe=float(omega[-1]),motor_current_ratio=amp/max(d['nominal_current_a'],.001),current_ratio=amp/max(d['nominal_current_a'],1e-5),supply_ratio=sup/d['rail_v'],supply_probe=sup,terminal_ratio=node/d['rail_v'],logic_high_ratio=max(0,node)/d['rail_v'])
    return z
