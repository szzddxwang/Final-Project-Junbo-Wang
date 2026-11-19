"""Vectorized observed-evidence policy, shared by experiments and inference."""
import numpy as np
from src.reliable_diagnosis.model import probabilities,calibrate
from src.selective_diagnosis.composition import INDEX
from src.selective_diagnosis.runtime_v8 import score

PROMOTION_READBACKS={'LED_GPIO':('mode_readback',),'DIGITAL_INPUT':('bias_readback',),'ANALOG_ADC':('gain_readback','bits_ratio'),'I2C_SENSOR':('address_difference',),'UART_DEVICE':('baud_ratio','framing_config_mismatch')}

def promotion_allowed(x,incumbent_accept,system):
    allowed=np.ones(len(x),bool)
    for channel in PROMOTION_READBACKS.get(system,()):allowed&=incumbent_accept|(x[:,INDEX[channel+':count']]>0)
    return allowed

def root_probabilities(head,x):
    raw=x if head['kind']=='xgboost'else np.nan_to_num(x,nan=-999.)
    p=calibrate(probabilities(head['model'],raw,head['kind'],head['classes']),head['temperature'],head['allowed'])
    if head.get('normal_prior_floor',0)>0:
        from src.reliable_diagnosis.features import NAMES
        prior=x[:,len(NAMES):len(NAMES)+len(head['classes'])]
        keep=(prior.argmax(1)==head['classes'].index('Normal'))&(p.max(1)<head['normal_prior_floor'])
        p[keep]=prior[keep]
    return p/p.sum(1,keepdims=True)

def repeat_inconsistent(x,system,z_limit=16.):
    """A fixed-input repeat must respect declared measurement uncertainty.

    Motor response/current can legitimately evolve; only its wiring and drive
    readbacks are checked here. No physical parameters or fault names are read.
    """
    from .observations import CHANNELS
    keys=('wire_resistance','frequency_ratio','driver_duty')if system=='PWM_MOTOR_SERVO'else('supply_ratio','terminal_ratio','current_ratio','response_ratio','wire_resistance','reference_ratio','adc_code_fraction','baud_ratio','frame_error','ack_fraction')
    z=np.c_[tuple(np.where(x[:,602+CHANNELS.index(k)*5+2]>0,x[:,602+CHANNELS.index(k)*5+1],0.)for k in keys)]
    return (np.sum(z>z_limit,axis=1)>=2)|np.any(z>2*z_limit,axis=1)

def eligible(x,pred,classes):
    """Rich-packet eligibility from the same observed fields as the runtime."""
    x=np.asarray(x);fault=np.asarray(classes)[pred]
    q=lambda k:x[:,INDEX[k+':last']]
    has=lambda k:x[:,INDEX[k+':count']]>0
    config=np.logical_or.reduce([has(k)for k in ('mode_readback','bias_readback','gain_readback','address_difference','baud_ratio','framing_config_mismatch','frequency_ratio','duty_error','driver_duty')])|np.isfinite(x[:,INDEX['base:configuration_status']])
    wire=has('wire_resistance')|np.isfinite(x[:,INDEX['effective_series_r']])|np.isfinite(x[:,INDEX['base:continuity_status']])
    current=has('current_ratio')|has('current_probe')
    response=np.logical_or.reduce([has(k)for k in ('response_ratio','ack_fraction','frame_error','adc_code_fraction','terminal_ratio')])
    signals=np.c_[q('supply_ratio')<.72,(q('wire_resistance')>150)|(x[:,INDEX['base:continuity_status']]==0),(q('terminal_ratio')<-.05)|(x[:,INDEX['base:polarity_status']]==0),q('noise_fraction')>.10,
        (q('mode_readback')<.5)|(q('bias_readback')<.5)|(abs(q('gain_readback')-1)>.08)|(abs(q('address_difference'))>.5)|(abs(q('baud_ratio')-1)>.04)|(q('framing_config_mismatch')>.5)|(abs(q('duty_error'))>.08)]
    good=(x[:,INDEX['captures']]>=2)&has('supply_ratio')&(signals.sum(1)<=1)
    good&=~((fault=='Normal')&signals.any(1))
    broad=np.isin(fault,['Normal','ComponentFailure','CommunicationFault']);good&=~broad|(wire&config&current&response)
    for f,h in [('ConfigurationFault',config),('WiringFault',wire),('VoltageLevelFault',has('terminal_ratio')|has('logic_high_ratio')),('SignalIntegrityFault',has('noise_fraction')|has('waveform_rms_fraction')),('PolarityFault',has('terminal_ratio'))]:good&=(fault!=f)|h
    motor=(x[:,INDEX['load:dc_motor']]==1)|(x[:,INDEX['load:servo']]==1)|(x[:,INDEX['load:stepper']]==1)
    trace=x[:,INDEX['trace:response:count']]>=12
    good&=~(motor&np.isin(fault,['Normal','ComponentFailure','ConfigurationFault']))|(trace&(has('motor_current_ratio')|(x[:,INDEX['trace:current:count']]>0)))
    good&=~(motor&(x[:,INDEX['load:dc_motor']]==1)&(fault=='Normal'))|(x[:,INDEX['fit:valid']]>0)
    # I2C-specific edge guard is applied with the system identity by the caller.
    good&=~((q('supply_ratio')<0)|(q('supply_ratio')>1.8))
    return good

def policy_limits(head,x,pred,incumbent_accept):
    classes=head['root']['classes'];threshold=np.where(incumbent_accept,head['retain_threshold'],head['expand_threshold'])
    minp=np.full(len(x),head['min_probability']);mixed=np.full(len(x),head['mixed_threshold'])
    for policy,mask in [(head,np.ones(len(x),bool))]+[(h,x[:,INDEX['load:'+load]]==1)for load,h in head.get('load_policies',{}).items()]:
        minp[mask]=policy['min_probability'];mixed[mask]=policy['mixed_threshold']
        for label,limits in policy.get('class_thresholds',{}).items():
            use=mask&(pred==classes.index(label));threshold[use]=np.where(incumbent_accept[use],limits['retain'],limits['expand'])
            # Different proposed causes need different evidence against an
            # additional cause. Legacy heads keep their shared mixed limit.
            mixed[use]=np.where(incumbent_accept[use],limits.get('mixed_retain',policy['mixed_threshold']),limits.get('mixed_expand',policy['mixed_threshold']))
    return threshold,minp,mixed

def predict_system(head,x,incumbent_p,incumbent_accept,system):
    p=root_probabilities(head['root'],x);pred=p.argmax(1);classes=head['root']['classes']
    f=np.c_[x,p];risk=score(**head['risk'],x=f);mixed=score(**head['mixed'],x=f)
    valid=eligible(x,pred,classes)
    if head.get('repeat_guard_z'):valid&=~repeat_inconsistent(x,system,head['repeat_guard_z'])
    valid&=promotion_allowed(x,incumbent_accept,system)
    if system=='PWM_MOTOR_SERVO':
        from src.selective_diagnosis.consistency import pwm_conflict
        valid&=~pwm_conflict(x,p,classes)[0]
    if system=='I2C_SENSOR':valid&=~np.isin(np.asarray(classes)[pred],['Normal','ComponentFailure','CommunicationFault'])|((x[:,INDEX['rise_30_70:count']]>0)|(x[:,INDEX['rc_time_us:count']]>0))
    threshold,minp,mixed_limit=policy_limits(head,x,pred,incumbent_accept)
    accept=valid&(p.max(1)>=minp)&(risk<=threshold)&(mixed<=mixed_limit)
    # Unchanged supported evidence cannot become a Normal conclusion merely by
    # switching classifiers; reviewed normal outputs need dedicated evidence.
    normal=pred==classes.index('Normal')
    accept&=~normal|((risk<=head['normal_risk_threshold'])&(x[:,INDEX['captures']]>=2))
    if head.get('normal_requires_incumbent_support'):
        accept&=~normal|(incumbent_accept&(incumbent_p.argmax(1)==classes.index('Normal')))
    if 'normal_promotion_risk_max'in head:
        prior_normal=incumbent_accept&(incumbent_p.argmax(1)==classes.index('Normal'))
        accept&=~normal|prior_normal|(risk<=head['normal_promotion_risk_max'])
    return dict(p=p,accept=accept,risk=risk,mixed=mixed,eligible=valid)
