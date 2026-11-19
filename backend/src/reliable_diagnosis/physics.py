"""Controlled physical providers. Never import this module from feature/inference code.

Models are bounded teaching models: Shockley diode, RC input/ADC, sampled bus
transactions and electromechanical loads. Truth is separate from observations.
"""
import copy,math
import numpy as np
from .contract import SYSTEMS

def create_parameters(system,root,rng,family=0,severity=None,secondary=None,mechanism='standard'):
    f=1+0.035*family
    rail=float(rng.choice([2.8,3.3,5.]))
    typ=str(rng.choice(['dc_motor','servo','stepper'])) if system=='PWM_MOTOR_SERVO' else 'unspecified'
    rn=float(rng.choice([220,330,680,1000,2200]))*f
    pull=float(rng.choice([2200,4700,10000,22000]))*f
    baud=float(rng.choice([4800,9600,38400,115200]))
    hz=float(rng.choice([50,500,1000,4000]))
    bits=int(rng.choice([8,10,12]))
    R=float(rng.uniform(3,12))*f;L=float(rng.uniform(.001,.012));ke=float(rng.uniform(.015,.05))
    J=float(rng.uniform(1e-5,9e-5))*f;b=float(rng.uniform(2e-5,1.5e-4));load=float(rng.uniform(1e-4,6e-4))
    nominal_speed=max(5.,(rail-R*load/ke)/(ke+R*b/ke))
    tau=J/(b+ke*ke/R)
    declared=dict(rail_v=rail,reference_nominal_v=rail,adc_bits=bits,target_gain=1.,baud=baud,pwm_hz=hz,
        nominal_load_ohm=rn if system=='LED_GPIO' else pull,nominal_current_a=max(.0001,(rail-1.9)/rn) if system=='LED_GPIO' else .006,
        nominal_speed_rad_s=nominal_speed,nominal_tau_s=float(np.clip(tau,.02,2)),bus_hz=float(rng.choice([100000,400000])),
        address=float(rng.integers(8,119)),gpio_mode=1.,logic_high_threshold_ratio=.7,logic_low_threshold_ratio=.3)
    p=dict(rail=rail,source=1.,rs=float(rng.uniform(.05,.8)),wire_r=float(rng.uniform(.05,3)),
        resistor=rn*float(rng.uniform(.95,1.05)),pullup=pull*float(rng.uniform(.95,1.05)),cap=float(rng.uniform(25,350))*1e-12*f,
        vf=float(rng.uniform(1.75,2.05)),nvt=float(rng.uniform(.04,.065)),leak=1e8,polarity=1.,level=float(rng.uniform(.985,1.015)),
        noise=float(rng.uniform(.0005,.012)),gain=float(rng.uniform(.985,1.015)),offset=float(rng.normal(0,.001)),
        vref=rail*float(rng.uniform(.98,1.02)),bits=bits,inl=float(rng.uniform(0,2))/(2**bits),source_r=float(rng.uniform(100,15000)),
        sample_c=float(rng.uniform(5,30))*1e-12,sample_time=float(rng.uniform(2,8))*1e-6,
        bias=1.,mode=1.,input_leak=float(rng.uniform(1e7,1e9)),input_c=float(rng.uniform(20,200))*1e-12,
        bounce=float(rng.uniform(0,.004)),schmitt_low=float(rng.uniform(.27,.34)),schmitt_high=float(rng.uniform(.64,.72)),
        address=int(declared['address']),configured_address=int(declared['address']),baud=baud*float(rng.uniform(.998,.002+1)),
        tx_parity=0,rx_parity=0,stop_bits=1,rx_stop_bits=1,jitter=float(rng.uniform(0,.002)),protocol_error=0.,
        busy=0.,stretch_s=float(rng.uniform(0,.1))/declared['bus_hz'],device_response=1.,hz=hz*float(rng.uniform(.995,1.005)),
        drive_gain=1.,R=R*float(rng.uniform(.96,1.04)),L=L,J=J,ke=ke,kt=ke,b=b,load=load,
        voltage_drop=float(rng.uniform(.02,.15)),damage_gain=1.,delay=float(rng.uniform(0,.025)),
        motor_type=typ,servo_gain=float(rng.uniform(6,15)),servo_limit=4.,step_angle=2*math.pi/200,
        ring=0.,supply_ripple=0.,load_ripple=0.,mechanism=mechanism)
    if system=='PWM_MOTOR_SERVO':declared['nominal_current_a']=(load+b*nominal_speed)/ke
    if system=='I2C_SENSOR':
        # A nominal bus must meet its declared timing before fault injection.
        rise_limit=1e-6 if declared['bus_hz']<=100000 else 300e-9
        p['cap']=float(rng.uniform(.12,.95))*rise_limit/(math.log(7/3)*(p['pullup']+p['wire_r']))
    severity=float(rng.uniform(.04,1) if severity is None else severity)
    roots=[root] if root not in ('Normal','Unknown') else []
    if secondary:roots.append(secondary)
    for fault in roots:inject(p,system,fault,severity,rng)
    if root=='Unknown':
        # Mechanisms vary by cohort; an unknown cause may remain indistinguishable.
        if mechanism in ('ringing','standard'):p['ring']=float(rng.uniform(.12,.45))
        elif mechanism=='supply_ripple':p['supply_ripple']=float(rng.uniform(.12,.4))
        elif mechanism=='load_oscillation':p['load_ripple']=float(rng.uniform(.3,.8))
        elif mechanism=='intermittent_contact':p['contact_ohm']=float(rng.uniform(500,12000))
        elif mechanism=='contact_bounce':p['bounce']=float(rng.uniform(.025,.18))
        elif mechanism=='reference_drift':p['reference_drift_per_s']=float(rng.uniform(.3,1.1))
        elif mechanism=='clock_stretch':p['stretch_s']=float(rng.uniform(3,12))/declared['bus_hz']
        else:p['jitter']=float(rng.uniform(.06,.18));p['busy']=float(rng.uniform(.05,.3))
    return p,declared,dict(roots=roots or [root],severity=severity,family=family,mechanism=mechanism)

def inject(p,s,fault,a,rng):
    if fault=='PowerSupplyFault':p['source']=1-(.02+.72*a)
    elif fault=='WiringFault':p['wire_r']=float(2*math.exp(a*math.log(100000/2)))
    elif fault=='PolarityFault':p['polarity']=-1.
    elif fault=='VoltageLevelFault':p['level']=1+float(rng.choice([-1,1]))*(.02+.52*a)
    elif fault=='SignalIntegrityFault':p['noise']=.006+.19*a;p['jitter']+=.025*a
    elif fault=='CommunicationFault':p['protocol_error']=.015+.65*a;p['busy']=.05+.65*a
    elif fault=='ConfigurationFault':
        if s=='LED_GPIO':p['mode']=0.
        elif s=='DIGITAL_INPUT':p['bias']=0.
        elif s=='ANALOG_ADC':p['gain']=1+float(rng.choice([-1,1]))*(.04+.65*a)
        elif s=='I2C_SENSOR':p['configured_address']+=int(rng.choice([-3,-1,1,2]))
        elif s=='UART_DEVICE':
            if rng.random()<.7:p['baud']*=1+float(rng.choice([-1,1]))*(.01+.22*a)
            else:p['tx_parity']=1;p['rx_parity']=0
        else:p['drive_gain']=1+float(rng.choice([-1,1]))*(.04+.6*a);p['hz']*=1+.5*a
    elif fault=='ComponentFailure':
        if s=='LED_GPIO':
            if rng.random()<.5:p['leak']=float(1+200*(1-a))
            else:p['vf']+=.1+4*a
        elif s=='DIGITAL_INPUT':p['input_leak']=p['pullup']*(.1+5*(1-a))
        elif s=='ANALOG_ADC':p['damage_gain']=1-.04-.65*a;p['inl']+=.03*a
        elif s in ('UART_DEVICE','I2C_SENSOR'):p['device_response']=max(0,1-.1-.9*a)
        else:p['kt']*=1-.04-.65*a;p['b']*=1+5*a;p['load']*=1+3*a
    else:raise ValueError('Unsupported controlled fault')

def diode_node(voltage,resistance,vf,nvt,leak):
    """Shockley diode plus parallel leakage, solved using KCL."""
    saturation=.005/math.expm1(vf/nvt)
    lo,hi=min(0.,voltage),max(0.,voltage)
    for _ in range(44):
        v=(lo+hi)/2;current=saturation*math.expm1(float(np.clip(v/nvt,-40,80)))+v/leak
        if current>(voltage-v)/resistance:hi=v
        else:lo=v
    v=(lo+hi)/2;return v,(voltage-v)/resistance

def motor_trace(p,d,command,t):
    """Supply-coupled winding/back-EMF/inertia model; time begins at rest."""
    t=np.asarray(t,float);sign=p['polarity'];duty=float(np.clip(command*p['drive_gain'],0,1))
    voltage=max(0,p['rail']*p['source']*p['level']*duty-p['voltage_drop'])
    resistance=p['R']+p['rs']+p['wire_r'];tt=np.maximum(0,t-p['delay'])
    if p['motor_type']=='dc_motor':
        load=p['load'];stall=p['kt']*voltage/resistance
        if stall<=load or voltage==0:
            current=voltage/resistance*(-np.expm1(-tt*resistance/p['L']));omega=np.zeros_like(t)
        else:
            start=-p['L']/resistance*math.log1p(-load/stall)
            current=voltage/resistance*(-np.expm1(-tt*resistance/p['L']));omega=np.zeros_like(t)
            A=np.array([[-resistance/p['L'],-p['ke']/p['L']],[p['kt']/p['J'],-p['b']/p['J']]])
            B=np.array([voltage/p['L'],-load/p['J']]);steady=-np.linalg.solve(A,B)
            eig,V=np.linalg.eig(A);coef=np.linalg.solve(V,np.array([load/p['kt'],0.])-steady)
            ix=tt>=start;state=steady[:,None]+np.real(V@(coef[:,None]*np.exp(eig[:,None]*(tt[ix]-start))))
            current[ix]=state[0];omega[ix]=state[1]
        response=omega/d['nominal_speed_rad_s']
    elif p['motor_type']=='servo':
        # Averaged position controller and torque-limited electromechanical plant.
        count=max(400,int(max(t[-1],.01)/.002));grid=np.linspace(0,max(t[-1],.01),count+1);dt=grid[1]-grid[0]
        pos=0.;omega=0.;amp=0.;ys=[0.];amps=[0.];target=command*math.pi
        for now in grid[1:]:
            drive=float(np.clip(p['servo_gain']*(target-pos),-1,1))*voltage if now>=p['delay'] else 0.
            # Implicit winding update avoids instability when L/R << dt.
            amp=(amp+dt*(drive-p['ke']*omega)/p['L'])/(1+dt*resistance/p['L'])
            torque=p['kt']*amp-p['b']*omega-p['load']*np.sign(omega)
            omega=float(np.clip(omega+dt*torque/p['J'],-p['servo_limit'],p['servo_limit']))
            pos=float(np.clip(pos+dt*omega,0,math.pi));ys.append(pos/math.pi);amps.append(abs(amp))
        response=np.interp(t,grid,ys);current=np.interp(t,grid,amps);omega=np.gradient(response,t,edge_order=1)*math.pi
    else:
        # Averaged two-phase RL current with torque-dependent missed full steps.
        freq=max(1,min(p['hz']*duty,1200));on=.5/freq
        phase=voltage/resistance*(-math.expm1(-on*resistance/p['L']))
        demand=p['load']+p['b']*freq*p['step_angle']
        reserve=p['kt']*phase/max(demand,1e-8);fraction=float(np.clip(reserve,0,1))
        steps=np.floor(tt*freq*fraction);target=np.maximum(1,np.floor(tt*max(1,min(d['pwm_hz']*command,1200))))
        response=np.where(tt>0,command*steps/target,0);current=np.full_like(t,phase);omega=np.full_like(t,freq*fraction*p['step_angle'])
    response=sign*np.asarray(response)
    if p['ring']:response+=p['ring']*np.sin(2*math.pi*9*t)*np.exp(-t/.8)
    if p['load_ripple']:response*=1-p['load_ripple']*.3*np.sin(t*12)
    supply=p['rail']*p['source']-np.abs(current)*p['rs']
    return dict(response=response,current=current,omega=sign*omega,supply=np.maximum(0,supply),duty=duty)

def uart_trials(p,d,rng,logic_high):
    """Transmit actual bytes and sample start/data/parity/stop at receiver clocks."""
    frames=16;words=rng.integers(0,256,frames);errors=0;bit_errors=0;total=0
    for word in words:
        data=[(int(word)>>j)&1 for j in range(8)];bits=[0,*data]
        if p['tx_parity']:bits.append(sum(data)%2)
        bits += [1]*p['stop_bits']+[1,1]
        phases=(np.arange(10)+.5)/d['baud']
        phases+=rng.normal(0,p['jitter']/d['baud'],len(phases))
        ix=np.clip(np.floor(phases*p['baud']).astype(int),0,len(bits)-1)
        level=np.asarray(bits,dtype=float)[ix]*logic_high
        if p['polarity']<0:level=logic_high-level
        level+=rng.normal(0,p['noise']*d['rail_v'],len(ix))
        flip=rng.random(len(ix))<p['protocol_error'];level[flip]=logic_high-level[flip]
        sampled=(level>.5*d['rail_v']).astype(int);expected=np.array([0,*data,1])
        good=bool(np.array_equal(sampled,expected)) and rng.random()<p['device_response']
        errors+=not good;bit_errors+=int(np.sum(sampled!=expected));total+=len(ix)
    return errors/frames,bit_errors/total,total

def i2c_trials(p,d,rng,logic_high,rise):
    """Open-drain high-phase voltages, address bits, ACK and clock-stretch timeout."""
    freq=d['bus_hz'];high_time=.5/freq
    vhigh=logic_high*(-math.expm1(-high_time/max((p['pullup']+p['wire_r'])*p['cap'],1e-12)))
    byte=(int(p['configured_address'])<<1)&255;bits=np.array([(byte>>j)&1 for j in range(7,-1,-1)])
    decoded=[];acks=0
    for _ in range(16):
        volt=bits*vhigh+rng.normal(0,p['noise']*d['rail_v'],8)
        if p['polarity']<0:volt=vhigh-volt
        flip=rng.random(8)<p['protocol_error'];volt[flip]=vhigh-volt[flip]
        rx=(volt>.7*d['rail_v']).astype(int);address=sum(int(b)<<(7-j) for j,b in enumerate(rx))>>1
        decoded.append(address)
        acks+=address==p['address'] and rng.random()>p['busy'] and p['stretch_s']<5/freq and rng.random()<p['device_response']
    return acks/16,float(p['busy']),p['stretch_s']*freq,144

def readout(p,system,d,command,ending,rng):
    """Return observable voltages/protocol outcomes, not causes or hidden labels."""
    # Novel held-out mechanisms act on actual circuit quantities. Their names
    # and parameters never enter the observation packet or feature vector.
    if p.get('contact_ohm') or p.get('reference_drift_per_s'):
        p=copy.deepcopy(p)
        if p.get('contact_ohm'):p['wire_r']+=p['contact_ohm']*(.2+.8*abs(math.sin(ending*37)))
        if p.get('reference_drift_per_s'):p['vref']*=1+p['reference_drift_per_s']*ending
    supply0=p['rail']*p['source'];series=p['rs']+p['wire_r'];times=np.r_[0.,np.geomspace(max(ending/2000,1e-8),ending,63)]
    q={};traces={};samples=64
    if system=='PWM_MOTOR_SERVO':
        z=motor_trace(p,d,command,times);supply=float(z['supply'][-1]);current=float(z['current'][-1]);node=supply*z['duty']*p['level']*p['polarity']
        response=z['response'];q.update(response_ratio=float(response[-1]),duty_actual=z['duty'],driver_duty=z['duty'],
            duty_error=z['duty']-command,frequency_ratio=p['hz']/d['pwm_hz'],motor_current_ratio=current/max(d['nominal_current_a'],.001),
            speed_probe=float(z['omega'][-1]),position_error=float(response[-1]-command))
        traces['response']=dict(time_s=times.tolist(),values=response.tolist(),unit='ratio');traces['current']=dict(time_s=times.tolist(),values=z['current'].tolist(),unit='A')
    elif system=='LED_GPIO':
        drive=supply0*command*p['level']*p['polarity']*p['mode'];node,current=diode_node(drive,series+p['resistor'],p['vf'],p['nvt'],p['leak']);supply=supply0-abs(current)*p['rs']
        q.update(response_ratio=current/max(d['nominal_current_a'],.0001),mode_readback=p['mode'])
    elif system=='DIGITAL_INPUT':
        drive=supply0*command*p['level']*p['polarity'];pull=p['pullup'] if p['bias'] else 1e9
        node=drive*p['input_leak']/(series+pull+p['input_leak']);current=drive/(series+pull+p['input_leak']);supply=supply0-abs(current)*p['rs']
        tau=(series+pull)*p['input_leak']/(series+pull+p['input_leak'])*p['input_c']
        voltage=node*(-np.expm1(-times/max(tau,1e-12)))
        bounce_window=times<p['bounce'];voltage[bounce_window]*=.5+.5*np.sign(np.sin(times[bounce_window]*13000))
        voltage+=rng.normal(0,p['noise']*d['rail_v'],len(times));state=False;states=[]
        for v in voltage:
            if v>p['schmitt_high']*d['rail_v']:state=True
            elif v<p['schmitt_low']*d['rail_v']:state=False
            states.append(state)
        q.update(response_ratio=float(np.mean(states[-16:])),bias_readback=p['bias'],bounce_fraction=float(np.mean(np.diff(states)!=0)),
            settling_ratio=float(voltage[-1]/max(abs(node),.01)),drive_probe=drive,current_probe=current,node_probe=float(voltage[-1]),nominal_load=d['nominal_load_ohm'])
        traces['voltage']=dict(time_s=times.tolist(),values=voltage.tolist(),unit='V')
    else:
        load=10000. if system=='ANALOG_ADC' else d['rail_v']/max(.00001,(.002+.004*command)*p['device_response'])
        level_command=command if system=='ANALOG_ADC' else 1.
        node=supply0*level_command*p['level']*p['polarity']*load/(series+load);current=supply0*level_command/(series+load);supply=supply0-abs(current)*p['rs']
        if system=='ANALOG_ADC':
            settle=-math.expm1(-p['sample_time']/((p['source_r']+series)*p['sample_c']))
            vin=node*settle;ratio=vin/p['vref']*p['gain']*p['damage_gain']+p['offset'];ratio+=p['inl']*math.sin(6*math.pi*ratio)
            full=2**p['bits']-1;codes=np.clip(np.rint((ratio+rng.normal(0,p['noise'],64))*full),0,full);actual=float(codes.mean()/full)
            q.update(adc_code_fraction=actual,adc_residual=actual-np.clip(node/max(p['vref'],.05)*p['gain'],0,1),reference_ratio=p['vref']/d['reference_nominal_v'],gain_readback=p['gain'],bits_ratio=p['bits']/d['adc_bits'],settling_ratio=settle,response_ratio=actual)
        elif system=='I2C_SENSOR':
            rise=math.log(7/3)*(p['pullup']+p['wire_r'])*p['cap'];ack,busy,stretch,samples=i2c_trials(p,d,rng,max(0,node),rise)
            q.update(ack_fraction=ack,address_difference=p['configured_address']-d['address'],pullup_readback_kohm=p['pullup']/1000,
                rc_time_us=(p['pullup']+p['wire_r'])*p['cap']*1e6,pullup_probe=p['pullup'],rise_30_70=rise,rise_margin=rise/(1e-6 if d['bus_hz']<=100000 else 300e-9),bus_busy_fraction=busy,clock_stretch_ratio=stretch)
        else:
            framing,biterrors,samples=uart_trials(p,d,rng,max(0,node));q.update(baud_ratio=p['baud']/d['baud'],frame_error=framing,response_ratio=1-framing,framing_config_mismatch=float(p['tx_parity']!=p['rx_parity'] or p['stop_bits']!=p['rx_stop_bits']))
    # Estimate noise from a finite quiet-reference capture, never expose its
    # injected standard-deviation parameter directly to the estimator.
    quiet=rng.normal(0,p['noise']*d['rail_v'],64)
    quiet+=p['supply_ripple']*d['rail_v']*.5*np.sin(np.arange(64)*.37)
    quiet+=p['ring']*d['rail_v']*.25*np.sin(np.arange(64)*1.7)
    noise=float(np.std(quiet,ddof=1)/d['rail_v']);q.update(supply_ratio=supply/d['rail_v'],current_ratio=current/max(d['nominal_current_a'],1e-5),terminal_ratio=node/d['rail_v'],
        logic_high_ratio=max(0,node)/d['rail_v'],logic_low_ratio=noise,noise_fraction=noise,waveform_rms_fraction=noise,wire_resistance=p['wire_r'],supply_probe=supply)
    if p['supply_ripple']:q['supply_ratio']*=1-p['supply_ripple']*.5
    return dict(channels=q,traces=traces,samples=samples,supply=supply,current=current,node=node)
