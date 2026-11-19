"""Six virtual physical adapters. No diagnostic labels in forward predictions.

The common engine operates only on Spec and explicit observations; VirtualDevice
is the experiment provider. Parameter truth is returned only by the bench audit.
"""
from dataclasses import dataclass,replace
import math
import numpy as np

@dataclass(frozen=True)
class Action:
    code: str
    controls: tuple
    cost: float=1.
    repeat_of: str|None=None

@dataclass(frozen=True)
class Spec:
    system: str
    parameters: tuple
    lower: tuple
    upper: tuple
    actions: tuple
    fixed: tuple
    quantity: str

    def physical(self,z):return np.asarray(self.lower)+(np.asarray(self.upper)-self.lower)*np.asarray(z)
    def normalized(self,theta):return (np.asarray(theta)-self.lower)/(np.asarray(self.upper)-self.lower)

def edges(byte):
    bits=[1,0,*[(byte>>i)&1 for i in range(8)],1]
    return np.asarray([i-1 for i in range(1,len(bits)) if bits[i]!=bits[i-1]],float)

def predict(spec,action,z):
    p=spec.physical(z);u=action.controls;s=spec.system
    if s=='ANALOG_ADC':return np.array([np.clip(p[0]*u[0]+p[1],0,4095/4096)])
    if s=='DIGITAL_INPUT':return np.array([1/(1+np.exp(np.clip(-(u[0]-p[0])/p[1],-60,60)))])
    if s=='LED_GPIO':return np.array([max(u[0]-p[0],0)/p[1]*1000])
    if s=='I2C_SENSOR':
        return np.array([p[0]]) if (action.repeat_of or action.code)=='pullup_readback' else np.array([1-np.exp(-u[0]/(p[0]*p[1]*.001))])
    if s=='UART_DEVICE':return p[1]+edges(int(u[1]))*1e6/(u[0]*(1+p[0]))
    if s=='PWM_MOTOR_SERVO':return np.array([p[0]*u[0]*(1-np.exp(-max(u[1]-p[2],0)/p[1]))])
    raise ValueError('Unsupported system')

def noise_sigma(spec,action,predicted):
    s=spec.system
    if s=='DIGITAL_INPUT':return np.sqrt(np.maximum(predicted*(1-predicted),.02)/64)
    value=.0015 if s=='ANALOG_ADC' else .07 if s=='LED_GPIO' else .05 if s=='I2C_SENSOR' and (action.repeat_of or action.code)=='pullup_readback' else .006 if s=='I2C_SENSOR' else .3 if s=='UART_DEVICE' else .012
    return np.full(len(predicted),value)

def catalog():
    adc=tuple(Action(f'input_{i}',(v,)) for i,v in enumerate([.05,.15,.3,.45,.6,.75,.9,.95]))
    digital=tuple(Action(f'stimulus_{i}',(v,)) for i,v in enumerate([.1,.2,.3,.4,.5,.6,.7,.8,.9]))
    led=tuple(Action(f'supply_{i}',(v,)) for i,v in enumerate([1.3,1.8,2.1,2.4,2.7,3.,3.3]))
    i2c=(Action('pullup_readback',()),)+tuple(Action(f'edge_at_{i}',(v,)) for i,v in enumerate([.1,.25,.5,1,2,4,8]))
    uart=tuple(Action(f'frame_{i}',(baud,byte),1+10/baud/.02) for i,(baud,byte) in enumerate([(9600,0x55),(19200,0x55),(115200,0x55),(9600,0),(115200,0),(38400,0xaa),(57600,0x0f),(19200,0xff)]))
    pwm=tuple(Action(f'step_{i}_{j}',(d,t),1+t/20) for i,d in enumerate([.3,.7]) for j,t in enumerate([.05,.2,.5,1,2,4]))
    return {
      'ANALOG_ADC':Spec('ANALOG_ADC',('transfer_gain','offset_fraction'),(.7,-.08),(1.3,.08),adc,(0,2,5,7),'full_scale_fraction'),
      'DIGITAL_INPUT':Spec('DIGITAL_INPUT',('threshold_fraction','transition_width'),(.3,.015),(.7,.10),digital,(0,3,5,8),'high_count/64'),
      'LED_GPIO':Spec('LED_GPIO',('forward_voltage_V','series_resistance_ohm'),(1.5,150),(2.4,470),led,(1,2,4,6),'mA'),
      'I2C_SENSOR':Spec('I2C_SENSOR',('pullup_kohm','bus_capacitance_pF'),(3,50),(10,450),i2c,(0,2,4,6),'edge_voltage_fraction or kOhm readback'),
      'UART_DEVICE':Spec('UART_DEVICE',('clock_fraction','capture_offset_us'),(-.06,-20),(.06,20),uart,(3,1,6,2),'edge_timestamp_us'),
      'PWM_MOTOR_SERVO':Spec('PWM_MOTOR_SERVO',('response_gain','time_constant_s','transport_delay_s'),(.6,.12,.02),(1.3,1.2,.25),pwm,(7,8,9,11),'load_response_fraction')}

SPECS=catalog()
SPECS={s:replace(spec,actions=spec.actions+tuple(Action(a.code+'__repeat',a.controls,a.cost,a.code) for a in spec.actions)) for s,spec in SPECS.items()}

def describe_action(spec,action):
    u=action.controls;s=spec.system
    if s=='ANALOG_ADC':return dict(input_voltage_V=3.3*u[0],reference_voltage_V=3.3,observe='raw ADC count and normalized transfer')
    if s=='DIGITAL_INPUT':return dict(input_voltage_V=3.3*u[0],trials=64,observe='count of HIGH readings')
    if s=='LED_GPIO':return dict(virtual_supply_V=u[0],observe='series LED current in mA',circuit='current-limited virtual series-resistor circuit')
    if s=='I2C_SENSOR':return dict(observe='independent virtual pull-up resistance readback in kOhm') if not u else dict(time_after_release_us=u[0],observe='SDA voltage / VDD')
    if s=='UART_DEVICE':return dict(baud=u[0],test_byte=f'0x{int(u[1]):02X}',frame='8N1',observe='TX edge timestamps in microseconds')
    return dict(step_duty_percent=100*u[0],capture_after_s=u[1],initial_state='reset virtual load to rest',observe='normalized load response')

@dataclass(frozen=True)
class Observation:
    system: str
    device: str
    action_code: str
    values: tuple
    performed: bool
    source: str='CONTROLLED_SIMULATION'

class VirtualDevice:
    def __init__(self,system,seed,group,profile='nominal'):
        self.spec=SPECS[system];self.seed=seed+group*104729+list(SPECS).index(system)*1009
        r=np.random.default_rng(self.seed);self._z=r.uniform(.12,.88,len(self.spec.parameters));self.profile=profile
        self.device=f'{seed}:{system}:{group}';self.history=[]

    def run(self,action):
        if action not in self.spec.actions:raise ValueError('Action outside virtual rig capabilities')
        if action.code in [r.action_code for r in self.history]:raise ValueError('Already acquired; no hidden duplicate capture')
        if action.repeat_of and action.repeat_of not in [r.action_code for r in self.history]:raise ValueError('A repeat requires its original actual capture')
        index=self.spec.actions.index(action);r=np.random.default_rng(self.seed+index*7919+53)
        mean=predict(self.spec,action,self._z);sigma=noise_sigma(self.spec,action,mean)
        if self.spec.system=='DIGITAL_INPUT':values=r.binomial(64,mean)/64
        else:values=mean+r.normal(0,sigma*(1.5 if self.profile=='shifted_noise' else 1))
        if self.spec.system=='ANALOG_ADC':values=np.floor(np.clip(values,0,4095/4096)*4096)/4096
        observation=Observation(self.spec.system,self.device,action.code,tuple(map(float,values)),True)
        self.history.append(observation);return observation

    def audit_truth(self):
        return dict(device=self.device,parameters=dict(zip(self.spec.parameters,map(float,self.spec.physical(self._z)))),normalized_parameters=self._z.tolist(),source='EVALUATION_ONLY_SIMULATION_STATE')
