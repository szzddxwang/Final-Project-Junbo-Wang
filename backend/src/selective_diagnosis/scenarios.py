"""Expanded controlled scenarios, never imported by inference.

Time-dependent sources, contacts and loads alter the plant before observation.
Unknown is an out-of-model mechanism, not a promise of observable separability.
"""
import copy,math
import numpy as np
from src.reliable_diagnosis.physics import create_parameters,readout
from src.reliable_diagnosis.provider import schedule,packet_from_raw
from src.reliable_diagnosis.contract import EvidenceV2

PROFILES=('clean','noisy','missing_channels','no_instruments','no_readbacks','biased','limited_samples','repeat','quantized','low_bandwidth')
OLD_UNKNOWN={'LED_GPIO':'intermittent_contact','DIGITAL_INPUT':'contact_bounce','ANALOG_ADC':'reference_drift','I2C_SENSOR':'clock_stretch','UART_DEVICE':'clock_jitter','PWM_MOTOR_SERVO':'load_oscillation'}

def create(system,root,rng,family,severity,secondary,mechanism):
    original=mechanism=='previously_characterized_unknown'
    p,d,truth=create_parameters(system,root if original or root!='Unknown' else 'Normal',rng,family,severity,secondary,OLD_UNKNOWN[system]if original else 'standard')
    if root=='Unknown'and not original:
        p['expanded_mechanism']=mechanism;p['expanded_amplitude']=float(rng.uniform(.12,.85));p['expanded_phase']=float(rng.uniform(0,2*math.pi));p['expanded_rate']=float(rng.uniform(2,14))
    truth.update(roots=[root]if root=='Unknown'else truth['roots'],expanded_mechanism=mechanism)
    return p,d,truth

def variable_motor(p,d,command,t):
    """Piecewise-constant exact linear winding/mechanical propagation.

Time-varying torque/voltage/resistance are updated at a bounded integration
grid. Static friction prevents unphysical negative motion at zero speed.
"""
    mechanism=p['expanded_mechanism'];amp=p['expanded_amplitude'];phase=p['expanded_phase'];rate=p['expanded_rate'];end=float(t[-1]);grid=np.unique(np.r_[np.linspace(0,end,max(240,int(end*120))),t]);cur=0.;w=0.;ys=[0.];amps=[0.]
    duty=float(np.clip(command*p['drive_gain'],0,1));basevol=max(0,p['rail']*p['source']*p['level']*duty-p['voltage_drop']);baseR=p['R']+p['rs']+p['wire_r']
    for a,b in zip(grid[:-1],grid[1:]):
        mid=(a+b)/2;dt=b-a;vol=basevol if mid>=p['delay']else 0.;load=p['load'];res=baseR;friction=p['b']
        if mechanism in ('load_step','load_chirp'):
            load*=1+amp*(4*(mid>end*.35) if mechanism=='load_step'else 3*(1+math.sin(phase+rate*mid*(1+mid))))
        elif mechanism=='thermal_winding':res+=p['R']*amp*(-math.expm1(-mid/max(end*.25,.01)))
        elif mechanism=='driver_dropouts':vol*=float(math.sin(phase+rate*mid)>.4*amp)
        elif mechanism=='nonlinear_drag':friction*=1+amp*max(w,0)/max(d['nominal_speed_rad_s']*.2,1)
        elif mechanism=='supply_oscillation':vol*=1-amp*.5*(1+math.sin(phase+rate*mid))
        A=np.array([[-res/p['L'],-p['ke']/p['L']],[p['kt']/p['J'],-friction/p['J']]])
        B=np.array([vol/p['L'],-load/p['J']]);steady=-np.linalg.solve(A,B);eig,V=np.linalg.eig(A)
        v=steady+np.real(V@(np.linalg.solve(V,np.array([cur,w])-steady)*np.exp(eig*dt)))
        cur=max(0.,float(v[0]));w=max(0.,float(v[1]));ys.append(w/d['nominal_speed_rad_s']);amps.append(cur)
    response=p['polarity']*np.interp(t,grid,ys);current=np.interp(t,grid,amps)
    return response,current

def observe(p,s,d,command,ending,rng):
    key=p.get('expanded_mechanism');q=copy.deepcopy(p)
    if not key:return readout(q,s,d,command,ending,rng)
    amp=q['expanded_amplitude'];phase=q['expanded_phase'];rate=q['expanded_rate'];wave=.5+.5*math.sin(phase+rate*ending)
    if key in ('contact_drift','contact_switching'):
        q['wire_r']+=amp*4000*(min(ending/.25,1)if key=='contact_drift'else float(wave>.5))
    elif key in ('supply_sag','source_oscillation'):
        q['source']*=1-amp*(min(ending/.3,1)if key=='supply_sag'else wave)
    elif key=='burst_interference':q['noise']+=amp*.16*float(wave>.35);q['protocol_error']+=amp*.2*float(wave>.6)
    elif key=='thermal_drift':
        warm=1-math.exp(-ending/.13)
        if s=='ANALOG_ADC':q['vref']*=1+amp*.55*warm
        elif s=='LED_GPIO':q['vf']-=amp*.4*warm
        elif s=='DIGITAL_INPUT':q['input_leak']/=1+amp*40*warm
        else:q['baud']*=1+amp*.08*warm;q['stretch_s']+=amp*warm*4/d['bus_hz']
    z=readout(q,s,d,command,ending,rng)
    if s=='PWM_MOTOR_SERVO'and key in ('load_step','load_chirp','thermal_winding','driver_dropouts','nonlinear_drag','supply_oscillation'):
        t=np.array(z['traces']['response']['time_s']);response,current=variable_motor(q,d,command,t)
        z['traces']['response']['values']=response.tolist();z['traces']['current']['values']=current.tolist()
        supply=max(0.,q['rail']*q['source']-abs(current[-1])*q['rs']);node=supply*z['channels']['duty_actual']*q['level']*q['polarity']
        z.update(current=float(current[-1]),supply=supply,node=node)
        z['channels'].update(response_ratio=float(response[-1]),position_error=float(response[-1]-command),speed_probe=float(response[-1]*d['nominal_speed_rad_s']),motor_current_ratio=float(current[-1]/max(d['nominal_current_a'],.001)),current_ratio=float(current[-1]/max(d['nominal_current_a'],1e-5)),supply_ratio=supply/d['rail_v'],supply_probe=supply,terminal_ratio=node/d['rail_v'],logic_high_ratio=max(0,node)/d['rail_v'])
    return z

def acquire(p,s,d,seed):
    return [(step,observe(p,s,d,step['command_fraction'],step['time_s'],np.random.default_rng(seed+7919*(i+1))))for i,step in enumerate(schedule(s,d))]

def packet(s,d,load,raw,profile,seed,count=2,tools=None):
    q=packet_from_raw(s,d,load,raw,profile if profile in PROFILES[:8]else 'clean',seed,count=count,tools=tools)
    if profile in ('quantized','low_bandwidth'):
        for c in q['captures']:
            for name,t in c['traces'].items():
                y=np.array(t['values']);scale=max(float(np.ptp(y)),.05)
                if profile=='quantized':
                    step=scale/64;y=np.round(y/step)*step
                else:
                    # Causal probe low-pass, whose bandwidth limitation is disclosed.
                    tau=max(c['time_s']*.03,1e-7);times=np.array(t['time_s'])
                    for i in range(1,len(y)):
                        alpha=-math.expm1(-(times[i]-times[i-1])/tau);y[i]=y[i-1]+alpha*(y[i]-y[i-1])
                t['values']=y.tolist()
            if profile=='quantized':
                for k,v in list(c['channels'].items()):
                    if c['lineage'][k].startswith('readback:'):continue
                    step=max(c['uncertainty'].get(k,0.)*2,abs(v)/1024,1e-10);c['channels'][k]=float(np.round(v/step)*step);c['uncertainty'][k]=max(c['uncertainty'].get(k,0.),step/math.sqrt(12))
            else:
                for k in ('response_ratio','motor_current_ratio','waveform_rms_fraction'):
                    if k in c['channels']:c['flags'].setdefault(k,[]).append('low_bandwidth')
    return EvidenceV2.model_validate(q).model_dump()
