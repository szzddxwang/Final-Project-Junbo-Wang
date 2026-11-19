"""Evidence eligibility, bounded decisions and explicit acquisition costs."""
import numpy as np

READBACKS={'mode_readback','bias_readback','gain_readback','address_difference','baud_ratio','framing_config_mismatch','frequency_ratio','duty_error','driver_duty'}
def eligibility(detail,fault):
    p=detail['packet'];q=detail['observations'];quality=detail['quality'];reasons=list(quality['critical_missing']);signals=[]
    if q.get('supply_ratio',1)<.72:signals.append('PowerSupplyFault')
    if q.get('wire_resistance',0)>150 or p.measurements.get('CONTINUITY') is False:signals.append('WiringFault')
    if q.get('terminal_ratio',0)<-.05 or p.measurements.get('POLARITY_OK') is False:signals.append('PolarityFault')
    if q.get('noise_fraction',0)>.10:signals.append('SignalIntegrityFault')
    mismatch=(q.get('mode_readback',1)<.5 or q.get('bias_readback',1)<.5 or abs(q.get('gain_readback',1)-1)>.08 or abs(q.get('address_difference',0))>.5 or abs(q.get('baud_ratio',1)-1)>.04 or q.get('framing_config_mismatch',0)>.5 or abs(q.get('duty_error',0))>.08)
    if mismatch:signals.append('ConfigurationFault')
    if len(set(signals))>1:reasons.append('independent_fault_indications_conflict_with_single_root')
    if fault=='Normal' and signals:reasons.append('normal_claim_conflicts_with_observed_abnormality')
    has_config=bool(set(q)&READBACKS) or 'CONFIGURATION_OK'in p.measurements
    has_wire='wire_resistance'in q or 'CONTINUITY'in p.measurements or 'effective_series_resistance_ohm'in detail['physical_estimates']
    has_current='current_ratio'in q or 'current_probe'in q
    has_response=bool(set(q)&{'response_ratio','ack_fraction','frame_error','adc_code_fraction'}) or 'terminal_ratio'in q
    def require(condition,name):
        if not condition:reasons.append(name)
    if fault in ('Normal','ComponentFailure','CommunicationFault'):
        require(has_wire,'signal_path_check_missing');require(has_config,'configuration_readback_missing');require(has_current,'current_measurement_missing');require(has_response,'response_measurement_missing')
    if fault=='ConfigurationFault':require(has_config,'configuration_readback_missing')
    if fault=='WiringFault':require(has_wire,'signal_path_check_missing')
    if fault=='VoltageLevelFault':require('terminal_ratio'in q or 'logic_high_ratio'in q,'receiver_voltage_missing')
    if fault=='SignalIntegrityFault':require('noise_fraction'in q or 'waveform_rms_fraction'in q,'noise_measurement_missing')
    if fault=='PolarityFault':require('terminal_ratio'in q or 'POLARITY_OK'in p.measurements,'polarity_observation_missing')
    if p.system=='PWM_MOTOR_SERVO' and fault in ('Normal','ComponentFailure','ConfigurationFault'):
        require(quality['trace_available'],'motor_response_trace_missing_or_too_short')
        require('motor_current_ratio'in q or 'current'in [k for c in p.captures for k in c.traces],'motor_current_capture_missing')
        if p.load_type in ('unspecified','dc_motor') and fault=='Normal':require(quality['fit_available'],'normal_motor_dynamics_not_identified')
    if p.system=='I2C_SENSOR' and fault in ('Normal','ComponentFailure','CommunicationFault'):
        require('rise_30_70'in q or 'rc_time_us'in q,'bus_edge_timing_missing')
    for cap in p.captures:
        if any('clipped'in flags for flags in cap.flags.values()):reasons.append('clipped_measurement')
    if 'supply_outside_characterized_range'in quality['warnings']:reasons.append('out_of_characterized_range')
    return dict(eligible=not reasons,reasons=sorted(set(reasons)),independent_indications=sorted(set(signals)))

RISK_CHANNELS=('supply_ratio','terminal_ratio','current_ratio','noise_fraction','waveform_rms_fraction','response_ratio','wire_resistance','mode_readback','bias_readback','gain_readback','address_difference','baud_ratio','frame_error','ack_fraction','frequency_ratio','duty_error','motor_current_ratio','position_error','rise_margin','bus_busy_fraction','clock_stretch_ratio')
def risk_features(x,probabilities,feature_names):
    x=np.asarray(x);p=np.asarray(probabilities);keys=[]
    for k in RISK_CHANNELS:
        keys.extend([feature_names.index(k+':last'),feature_names.index(k+':uncertainty')])
    keys.extend([feature_names.index(k) for k in ('fit:valid','fit:rmse','captures','last_time','sample_count','load:dc_motor','load:servo','load:stepper','load:unspecified')])
    z=x[:,keys];order=np.sort(p,axis=1)
    return np.c_[p,order[:,-1]-order[:,-2],-(p*np.log(np.maximum(p,1e-30))).sum(1),np.isnan(x).mean(1),np.nan_to_num(z,nan=-999.,posinf=999.,neginf=-999.),np.isnan(z).astype(float)]

def decision(detail,ranking,risk=None,threshold=.03,min_probability=.90):
    result=eligibility(detail,ranking[0]['fault']);reasons=result['reasons']
    if ranking[0]['probability']<min_probability:reasons.append('calibrated_score_below_supported_threshold')
    if risk is not None and risk>threshold:reasons.append('estimated_error_risk_requires_review')
    supported=not reasons
    return dict(status='SUPPORTED_SIMULATION_HYPOTHESIS' if supported else 'REVIEW_ALTERNATIVES',supported=supported,
                reasons=sorted(set(reasons)),independent_indications=result['independent_indications'],estimated_error_risk=risk,
                probability_threshold=min_probability,risk_threshold=threshold)

def next_acquisition(packet,result=None):
    """Plan from acquired observations only; never access simulation parameters."""
    n=len(packet.captures);tools=packet.available_tools
    if n>=3:return None
    capable=tools is None or 'SIMULATION'in tools or bool(set(tools)&{'OSCILLOSCOPE','LOGIC_ANALYZER','MULTIMETER','CURRENT_PROBE','RPM_ENCODER'})
    if not capable:return None
    end=float(np.clip(7*packet.declared.get('nominal_tau_s',.25),.3,12)) if packet.system=='PWM_MOTOR_SERVO' else .2
    if n==0:action,cmd,t='low',.2,max(end*.08,.005)
    elif n==1:action,cmd,t='high',.85,end
    else:
        if result and result['status']=='SUPPORTED_SIMULATION_HYPOTHESIS':return None
        action,cmd,t=('transient' if packet.system=='PWM_MOTOR_SERVO' else 'repeat'),.6,min(20,end*1.25)
    reason='Establish a low-stimulus baseline.' if n==0 else 'Change the stimulus to distinguish a constant offset from response gain.' if n==1 else 'Check whether the response repeats at a third operating point; unavailable channels remain unavailable.'
    return dict(number=n+1,action=action,stimulus_fraction=cmd,time_s=t,samples=64,instruction=reason,
                cost=dict(requested_acquisitions=1,base_signal_samples=64,additional_probes='counted after acquisition',virtual_duration_s=t),
                tools_required=['SIMULATION'] if tools is None or 'SIMULATION'in tools else tools,uses_only_acquired_evidence=True)

def single_eligibility(system,measurements,ranking):
    observed={k:v for k,v in measurements.items() if not k.startswith('EXPECTED_') and v not in (None,'Unknown')};fault=ranking[0]['fault'];reasons=[]
    if 'SUPPLY_VOLTAGE'not in observed:reasons.append('supply_voltage_missing')
    if len(observed)<3:reasons.append('too_few_independent_observations')
    if fault in ('Normal','ComponentFailure'):
        for k in ('CONTINUITY','CONFIGURATION_OK','CURRENT'):
            if k not in observed:reasons.append(k.lower()+'_missing')
    if system=='PWM_MOTOR_SERVO' and fault in ('Normal','ComponentFailure'):reasons.append('motor_load_response_capture_required')
    if fault=='WiringFault' and 'CONTINUITY'not in observed:reasons.append('signal_path_check_missing')
    if fault=='ConfigurationFault' and not any(k in observed for k in ('CONFIGURATION_OK','BAUD_RATE_CORRECT','ADDRESS_CORRECT')):reasons.append('configuration_check_missing')
    if ranking[0]['probability']<.93:reasons.append('calibrated_score_below_supported_threshold')
    return dict(status='REVIEW_ALTERNATIVES' if reasons else 'SUPPORTED_OBSERVATION_HYPOTHESIS',supported=not reasons,reasons=reasons,
                source='USER_SUPPLIED_OBSERVATIONS',hardware_validated=False)
