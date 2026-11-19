"""Bounded, unit-aware acquired evidence. No simulator truth fields are accepted."""
import math
from typing import Literal
from pydantic import BaseModel,ConfigDict,Field,model_validator
from ..config import load_config

VERSION='acquired-evidence-v2'
SYSTEMS=tuple(load_config('systems'))
OBSERVATIONS=('ADC_VREF_MEASURED','ADC_BITS_READBACK','ADC_GAIN_READBACK','ADC_PIN_VOLTAGE',
 'INPUT_BIAS_READBACK','INPUT_PIN_VOLTAGE','GPIO_MODE_READBACK','LOAD_PIN_VOLTAGE',
 'I2C_CONFIGURED_ADDRESS','I2C_OBSERVED_ADDRESS','I2C_ACK_FRACTION','UART_ENDPOINT_CONTINUITY',
 'UART_FRAME_ERROR_RATE','UART_BAUD_READBACK','PWM_DRIVER_DUTY','PWM_DRIVER_HZ','PWM_LOAD_RESPONSE')
UNITS={**{k:'ratio' for k in ('supply_ratio','current_ratio','terminal_ratio','response_ratio',
 'noise_fraction','waveform_rms_fraction','adc_residual','reference_ratio','gain_readback','bits_ratio',
 'bias_readback','mode_readback','ack_fraction','baud_ratio','frame_error','frequency_ratio','duty_error',
 'logic_high_ratio','logic_low_ratio','settling_ratio','bounce_fraction','rise_margin','bus_busy_fraction',
 'clock_stretch_ratio','adc_code_fraction','duty_actual','motor_current_ratio','position_error','framing_config_mismatch')},
 'address_difference':'address','pullup_readback_kohm':'kohm','rc_time_us':'us','wire_resistance':'ohm',
 'drive_probe':'V','node_probe':'V','current_probe':'A','nominal_load':'ohm','pullup_probe':'ohm',
 'rise_30_70':'s','driver_duty':'ratio','speed_probe':'rad/s','supply_probe':'V'}
DECLARED=('rail_v','reference_nominal_v','adc_bits','target_gain','baud','pwm_hz','nominal_load_ohm',
 'nominal_current_a','nominal_speed_rad_s','nominal_tau_s','bus_hz','address','gpio_mode',
 'logic_high_threshold_ratio','logic_low_threshold_ratio')
TOOLS=('VISUAL_SETTINGS','MULTIMETER','LOGIC_ANALYZER','OSCILLOSCOPE','SIMULATION','CURRENT_PROBE','RPM_ENCODER')

def finite(value):
    return isinstance(value,(float,int)) and not isinstance(value,bool) and math.isfinite(value) and abs(value)<=1e12

class Trace(BaseModel):
    model_config=ConfigDict(extra='forbid',strict=True)
    time_s:list[float]=Field(min_length=4,max_length=512)
    values:list[float]=Field(min_length=4,max_length=512)
    unit:Literal['ratio','V','A','rad/s']
    @model_validator(mode='after')
    def check(self):
        if len(self.time_s)!=len(self.values) or not all(finite(v) for v in self.time_s+self.values):raise ValueError('Trace contains invalid samples')
        if self.time_s[0]<0 or self.time_s[-1]>30 or any(b<=a for a,b in zip(self.time_s,self.time_s[1:])):raise ValueError('Trace timestamps must increase within 30 seconds')
        return self

class Acquisition(BaseModel):
    model_config=ConfigDict(extra='forbid',strict=True)
    capture_index:int=Field(ge=1,le=4)
    action:Literal['low','high','repeat','continuity','edge_check','transient']
    command_fraction:float=Field(ge=0,le=1)
    time_s:float=Field(ge=0,le=30)
    channels:dict[str,float]=Field(default_factory=dict)
    units:dict[str,str]=Field(default_factory=dict)
    lineage:dict[str,str]=Field(default_factory=dict)
    uncertainty:dict[str,float]=Field(default_factory=dict)
    flags:dict[str,list[Literal['clipped','unstable','estimated_nominal','low_bandwidth']]]=Field(default_factory=dict)
    traces:dict[str,Trace]=Field(default_factory=dict)
    samples:int=Field(default=64,ge=1,le=20000)
    virtual_only:Literal[True]=True
    executed:Literal[True]=True
    @model_validator(mode='after')
    def check(self):
        keys=set(self.channels)
        if keys-set(UNITS) or keys!=set(self.units) or keys!=set(self.lineage):raise ValueError('Unknown channel or missing units/provenance')
        if set(self.uncertainty)-keys or set(self.flags)-keys:raise ValueError('Quality metadata requires an observed channel')
        for k,v in self.channels.items():
            if not finite(v) or self.units[k]!=UNITS[k]:raise ValueError('Invalid measured channel or unit')
            if len(self.lineage[k])>200 or not self.lineage[k].startswith(('meter:','waveform:','derived:','readback:','declared:')):raise ValueError('Channel provenance must describe an observation')
        if not all(finite(v) and v>=0 for v in self.uncertainty.values()):raise ValueError('Invalid measurement uncertainty')
        if set(self.traces)-{'response','current','voltage','logic'}:raise ValueError('Unknown trace')
        if any(t.time_s[-1]>self.time_s+1e-9 for t in self.traces.values()):raise ValueError('Trace ends after its acquisition')
        return self

class EvidenceV2(BaseModel):
    model_config=ConfigDict(extra='forbid',strict=True)
    schema_version:Literal['acquired-evidence-v2']=VERSION
    source:Literal['CONTROLLED_SIMULATION']='CONTROLLED_SIMULATION'
    system:str
    measurements:dict=Field(default_factory=dict)
    observations:dict=Field(default_factory=dict)
    declared:dict[str,float]=Field(default_factory=dict)
    load_type:Literal['unspecified','dc_motor','servo','stepper']='unspecified'
    available_tools:list[str]|None=None
    captures:list[Acquisition]=Field(default_factory=list,max_length=4)
    legacy_observations:bool=False
    @model_validator(mode='after')
    def check(self):
        if self.system not in SYSTEMS:raise ValueError('Unsupported diagnostic system')
        if set(self.measurements)-set(load_config('systems')[self.system]['available_measurements']):raise ValueError('Measurement belongs to another system')
        if set(self.observations)-set(OBSERVATIONS) or set(self.declared)-set(DECLARED):raise ValueError('Unknown or private evidence field')
        from ..system_registry import validate_measurements
        validate_measurements(self.system,self.measurements)
        if any(not (finite(v) or isinstance(v,bool)) for v in self.observations.values()):raise ValueError('Unknown numeric observations must be omitted, not encoded as text')
        for values in (self.measurements,self.observations):
            for v in values.values():
                if not (isinstance(v,bool) or finite(v) or v in ('Low','High','Toggling','Unknown')):raise ValueError('Invalid observed value')
        if not all(finite(v) for v in self.declared.values()):raise ValueError('Invalid declared configuration')
        if any(self.declared[k]<=0 for k in self.declared if k not in ('address','gpio_mode')):raise ValueError('Declared scale must be positive')
        if self.available_tools is not None and (set(self.available_tools)-set(TOOLS) or len(self.available_tools)!=len(set(self.available_tools))):raise ValueError('Unknown or duplicate tool')
        if [c.capture_index for c in self.captures]!=list(range(1,len(self.captures)+1)):raise ValueError('Capture order must be consecutive')
        if len({(c.action,c.command_fraction,c.time_s) for c in self.captures})!=len(self.captures):raise ValueError('Duplicate acquisition cannot count as new evidence')
        return self

def adapt_legacy(packet):
    """Map only supplied v1 observations. No future readings or simulator calls."""
    p=packet.model_dump() if hasattr(packet,'model_dump') else packet
    if p.get('schema_version')==VERSION:return EvidenceV2.model_validate(p)
    from ..paired_evidence.runtime import EvidencePacket
    old=EvidencePacket.model_validate(p).model_dump();m=old['measurements'];d={}
    for src,dst in [('EXPECTED_SUPPLY_VOLTAGE','rail_v'),('EXPECTED_CURRENT','nominal_current_a'),('EXPECTED_BAUD','baud')]:
        if src in m and finite(m[src]) and m[src]>0:d[dst]=m[src]
    captures=[]
    for c in old['captures']:
        q=dict(c['channels']);q={k:v for k,v in q.items() if k in UNITS};traces={}
        if c['capture_index']==2:
            ins=old['instruments']
            for k,v in ins['channels'].items():
                if k in UNITS:q[k]=v
            if ins['transient']:
                t=ins['transient'];traces['response']=dict(time_s=t['time_s'],values=t['response_ratio'],unit='ratio')
        ending=max([c['time_s']]+[t['time_s'][-1] for t in traces.values()])
        lineage={k:c['lineage'].get(k,old['instruments']['lineage'].get(k,'meter:legacy_observation')) for k in q}
        captures.append(dict(capture_index=c['capture_index'],action='low' if c['capture_index']==1 else 'high',command_fraction=c['command_fraction'],time_s=ending,channels=q,units={k:UNITS[k] for k in q},lineage=lineage,traces=traces,samples=c['samples']))
    return EvidenceV2(system=old['system'],measurements=m,observations=old['observations'],declared=d,captures=captures,legacy_observations=True)
