"""Measured-only roots, uncertainty and educational next steps."""
import numpy as np
from src.reliable_diagnosis.contract import adapt_legacy
from src.reliable_diagnosis.features import encode
from src.reliable_diagnosis.policy import eligibility
from src.selective_diagnosis.runtime_v10 import infer as incumbent_infer
from src.selective_diagnosis.features import make_features,supplement
from src.selective_diagnosis.composition import enrich
from src.selective_diagnosis.runtime_v8 import score
from .observations import features as repeat_features,plan
from .batch import predict_system,promotion_allowed,policy_limits,repeat_inconsistent

CHECKS={
 'repeat_inconsistent_with_fixed_conditions':('Repeat under stable conditions','The same input produced readings outside the stated uncertainty. Check drift, intermittent wiring and interference before accepting one cause.','OSCILLOSCOPE'),
 'signal_path_check_missing':('Check continuity','With the virtual supply disconnected, measure the intended wire path.','MULTIMETER'),
 'configuration_readback_missing':('Read the device settings','Compare the observed mode, address or serial settings with the intended configuration.','VISUAL_SETTINGS'),
 'current_measurement_missing':('Measure load current','Compare current with the response at the same input level.','CURRENT_PROBE'),
 'motor_current_capture_missing':('Capture motor current','Record current during startup and at the high-input endpoint.','CURRENT_PROBE'),
 'motor_response_trace_missing_or_too_short':('Capture motion over time','Use a speed or position trace long enough to include the settling response.','RPM_ENCODER'),
 'bus_edge_timing_missing':('Measure the I2C edge','Check rise time as well as acknowledgement; an ACK alone does not establish timing margin.','OSCILLOSCOPE'),
 'supply_voltage':('Measure the supply','Measure at the load while it is operating, using the same reference ground.','MULTIMETER'),
 'noise_measurement_missing':('Observe signal variation','Capture repeated samples instead of relying on one displayed value.','OSCILLOSCOPE'),
}

def guidance(packet,result):
    checks=[]
    for reason in result.get('reasons',[]):
        if reason in CHECKS:
            title,instruction,tool=CHECKS[reason];checks.append(dict(title=title,instruction=instruction,tool=tool,available=packet.available_tools is None or 'SIMULATION'in packet.available_tools or tool in packet.available_tools))
    if not checks:
        checks.append(dict(title='Compare a controlled repeat'if len(packet.captures)<4 else 'Correct one cause, then retest',instruction='Keep the input the same and compare the later reading.'if len(packet.captures)<4 else 'Change only one indicated condition. An unchanged repeat is also available; check whether abnormal readings remain afterward.',tool='SIMULATION',available=packet.available_tools is None or 'SIMULATION'in packet.available_tools))
    return checks

def infer(packet,artifact):
    p=adapt_legacy(packet);previous=incumbent_infer(p,artifact)
    head=artifact.get('diagnostic_upgrade',{}).get('systems',{}).get(p.system)
    if head is None or p.legacy_observations:return previous
    x,detail=encode(p);classes=artifact['reliability_model']['classes'];old={r['fault']:r['probability']for r in previous['diagnosis']};prior=np.array([[old.get(c,0.)for c in classes]])
    base=enrich(make_features(x[None,:],prior,supplement(detail)[None,:]));extended=np.c_[base,repeat_features(p)[None,:]]
    evaluated=predict_system(head,extended,prior,np.array([previous['supported']]),p.system);prob=evaluated['p'][0]
    ranking=sorted([dict(fault=c,probability=float(v))for c,v,allowed in zip(classes,prob,head['root']['allowed'])if allowed],key=lambda r:-r['probability'])
    gate=eligibility(detail,ranking[0]['fault']);reasons=list(gate['reasons'])
    if head.get('repeat_guard_z')and repeat_inconsistent(extended,p.system,head['repeat_guard_z'])[0]:reasons.append('repeat_inconsistent_with_fixed_conditions')
    if not promotion_allowed(extended,np.array([previous['supported']]),p.system)[0]:reasons.append('missing_address_readback_requires_review'if p.system=='I2C_SENSOR'else 'missing_configuration_evidence_requires_review')
    limits,minps,mixed_limits=policy_limits(head,extended,np.array([prob.argmax()]),np.array([previous['supported']]))
    threshold=float(limits[0]);minp=float(minps[0]);mixed_limit=float(mixed_limits[0])
    if prob.max()<minp:reasons.append('calibrated_score_below_supported_threshold')
    if evaluated['risk'][0]>threshold:reasons.append('estimated_error_risk_requires_review')
    if evaluated['mixed'][0]>mixed_limit:reasons.append('coexisting_fault_pattern_requires_review')
    if ranking[0]['fault']=='Normal'and evaluated['risk'][0]>head['normal_risk_threshold']:reasons.append('normal_result_requires_additional_confirmation')
    if head.get('normal_requires_incumbent_support')and ranking[0]['fault']=='Normal'and not(previous['supported']and previous['diagnosis'][0]['fault']=='Normal'):reasons.append('normal_result_requires_additional_confirmation')
    if 'normal_promotion_risk_max'in head and ranking[0]['fault']=='Normal'and not(previous['supported']and previous['diagnosis'][0]['fault']=='Normal')and evaluated['risk'][0]>head['normal_promotion_risk_max']:reasons.append('normal_result_requires_additional_confirmation')
    if p.system=='PWM_MOTOR_SERVO':
        from src.selective_diagnosis.consistency import pwm_conflict,CAUSES
        conflict,flags=pwm_conflict(extended,prob[None,:],classes)
        gate['independent_indications']=sorted(set(gate['independent_indications'])|{c for c,f in zip(CAUSES,flags[0])if f})
        if conflict[0]:reasons.append('independent_fault_indications_conflict_with_single_root')
    supported=bool(evaluated['accept'][0]and not reasons)
    candidates=sorted([dict(fault=c,score=float(score(**m,x=extended)[0]))for c,m in head.get('causes',{}).items()],key=lambda r:-r['score'])
    result={**previous,'diagnosis':ranking,'confidence':ranking[0]['probability'],'supported':supported,'status':'SUPPORTED_SIMULATION_HYPOTHESIS'if supported else 'REVIEW_ALTERNATIVES','reasons':sorted(set(reasons)),'independent_indications':gate['independent_indications'],'estimated_error_risk':float(evaluated['risk'][0]),'estimated_mixed_fault_risk':float(evaluated['mixed'][0]),'risk_threshold':threshold,'probability_threshold':head['min_probability'],'mixed_review_threshold':head['mixed_threshold'],'root_classifiers_unchanged_from_v5':False,'root_feature_count':677,'root_algorithm':head['root']['kind'],'root_update_version':'observed-roots-v11','cause_candidates':candidates,'multiple_causes_possible':sum(c['score']>=.5 for c in candidates)>1,'single_cause_confirmed':False,'incumbent_supported':previous['supported'],'calibration_scope':'separate controlled-simulation calibration groups; cause-presence scores need not sum to one'}
    result['next_acquisition']=plan(p,result);result['next_checks']=guidance(p,result)
    result['probability_threshold']=minp;result['mixed_review_threshold']=mixed_limit
    result['root_update_version']=artifact['diagnostic_upgrade'].get('version','observed-roots-v11')
    result['evidence_summary']=dict(observed_channels=detail['quality']['measured_channels'],captures=len(p.captures),matched_repeat_available=bool(np.any(repeat_features(p)[np.arange(15)*5+2]>0)),interpretation='A supported hypothesis describes these observations; it does not exclude hidden additional faults.')
    return result

def compare(before,after,action):
    """A retest conclusion from observations/results; never inspect hidden roots."""
    if after is None:return dict(status='AWAITING_RETEST',message='Acquire the post-change readings before judging the intervention.',action=action)
    if after.get('captures_used',0)<4:return dict(status='AWAITING_RETEST',message='Complete the operating-point measurements and the matched repeat before judging the change.',action=action,repair_verified=False)
    normal=after['diagnosis'][0]['fault']=='Normal'
    if after['supported']and normal:status='NO_RESIDUAL_OBSERVED';message='No residual abnormality was detected in these observations. This is not proof that every possible fault is absent.'
    elif after['supported']or after.get('independent_indications'):status='RESIDUAL_OBSERVED';message='Abnormal evidence remains. Review the remaining candidates before making another change.'
    else:status='INCONCLUSIVE';message='The retest does not yet distinguish the alternatives. Review missing evidence and measurement quality.'
    return dict(status=status,message=message,action=action,before_candidate=before['diagnosis'][0]['fault']if before else None,after_candidate=after['diagnosis'][0]['fault'],single_cause_confirmed=False,repair_verified=False)

def measurement_changes(before,after):
    """Match actual readings by command, elapsed time and channel, never by truth."""
    import math
    changes=[]
    for b in before.get('captures',[]):
        matched=next((a for a in after.get('captures',[])if a['command_fraction']==b['command_fraction']and a['time_s']==b['time_s']),None)
        if matched is None:continue
        for key in sorted(set(b['channels'])&set(matched['channels'])):
            if b['units'][key]!=matched['units'][key]:continue
            bv=b['channels'][key];av=matched['channels'][key];unc=math.hypot(b.get('uncertainty',{}).get(key,0),matched.get('uncertainty',{}).get(key,0))
            changes.append(dict(channel=key,unit=b['units'][key],command_fraction=b['command_fraction'],time_s=b['time_s'],before=bv,after=av,change=av-bv,combined_stated_uncertainty=unc,change_exceeds_stated_uncertainty=abs(av-bv)>3*unc+1e-9))
    return changes
