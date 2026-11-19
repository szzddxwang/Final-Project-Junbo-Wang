"""Native Mendix v2 view payloads alongside all retained production contracts."""
import json,hashlib
from typing import Annotated,Literal
import numpy as np
from fastapi import APIRouter,HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import Field
from ..config import ROOT,load_config
from ..schemas import DiagnosisRequest
from ..diagnosis_engine import diagnose
from ..model_identity import stable_model_version,stable_artifact_path
from ..adc_evidence import raw_model_version
from ..virtual_lab.schemas import (SensorRequest,ADCModelRequest,WaveformAnalyzeRequest,GeneratedWaveformRequest,
                                  I2CRequest,PWMRequest,GPIORequest,MultimodalRequest)
from ..virtual_lab.sensor import simulate_sensor,sensor_features
from ..virtual_lab.adc_model import simulate_adc
from ..virtual_lab.mcu import simulate_i2c,simulate_pwm,simulate_gpio
from ..midterm.api import PlotTrace,active_comparison
from ..midterm.fusion import infer_gate,consistency
from ..closure.experts import expert_probabilities,EXPERT_REGISTRY
from ..waveform.protocol_followup import ProtocolCase,i2c_protocol_features
from .inference import infer_sensor,infer_isolation,infer_waveform,infer_uncertainty,infer_expert_fusion,infer_paired_adc,engineering_record,record,ART
from .presentation import *
from .learning import sensor_learning,sensor_pair,signal_view,trace
from .sensor import sensor_input
from ..virtual_lab.schemas import CounterfactualRequest

router=APIRouter(prefix='/ai/reliability',tags=['Reliability v2 native presentation'])
def safe(call,*args,**kwargs):
    try:return call(*args,**kwargs)
    except (FileNotFoundError,OSError) as exc:return {'available':False,'execution_state':'MODEL_UNAVAILABLE','reason':'Experimental model is unavailable. Stable diagnosis remains available.','detail':str(exc)}
    except (RuntimeError,ValueError) as exc:return {'available':False,'execution_state':'INFERENCE_FAILED','reason':'Experimental inference could not complete. Review signal quality or retry.','detail':str(exc)}

def sensor_view(samples,fs,method=None,source='PYTHON_SIMULATION'):
    ideal=np.asarray(samples[0],float);observed=np.asarray(samples[1],float);f=sensor_features(ideal,observed,fs)
    view=Presentation(summary=Summary(title='Sensor analysis',verdict='Simulation ready',message='Compare the reference and captured response. Optional model analysis is under Advanced Analysis.',next_action='Change one condition, then choose Run & Compare.'))
    view.simulation_summary=[metric('Samples',len(ideal),digits=0),metric('Sampling rate',fs,'Hz'),metric('Capture duration',len(ideal)/fs,'s'),metric('Expected final value',ideal[-1],'°C'),metric('Measured mean',float(np.nanmean(observed)),'°C',description='Mean over the whole capture, including the transient.'),metric('Measured final window',float(np.nanmean(observed[-max(8,len(ideal)//10):])),'°C',description='Mean of the final 10% of samples.'),metric('Residual RMS',f['residual_rms'],'°C'),metric('Missing samples',100*f['dropout_fraction'],'%')]
    view.limitations=['Simulated signal; models were trained on simulated data. Hardware performance has not been validated.','Normal dynamics and calibration tolerances follow the declared sensor experiment. A constant reference cannot identify every stuck or slow-response fault.']
    sensor_learning(view,ideal,observed,fs,f,source)
    if method is None:return view
    analysis={};selected=None
    prepared=None
    if method=='compare':
        try:prepared=sensor_input(samples,fs)
        except ValueError:pass  # Preserve each model's existing safe failure record.
    if method in ('isolation','compare'):
        analysis['isolation']=safe(infer_isolation,samples,fs,source);view.model_executions.append(execution('Isolation Forest baseline',analysis['isolation'],'Anomaly detector; its score is not a probability. Known-shift false alarms are high.'))
    if method in ('temporal','compare'):
        analysis['temporal']=safe(infer_sensor,samples,fs,'temporal',source,prepared=prepared);view.model_executions.append(execution('Temporal CNN v2',analysis['temporal'],'Actual inference with fitted sensor dynamics; experimental.'))
        selected=analysis['temporal']
    if method=='compare':
        analysis['random_forest']=safe(infer_sensor,samples,fs,'random_forest',source,prepared=prepared);view.model_executions.append(execution('Physical-feature Random Forest',analysis['random_forest'],'Validation-selected reference candidate; no production promotion.'))
        selection=json.loads((ART/'sensor_selection.json').read_text());selected=analysis['random_forest'] if selection['selected']=='new_physical_rf' else analysis['temporal']
    rule=analysis.get('isolation',{}).get('engineering_pattern')
    if analysis.get('isolation',{}).get('pattern_limitation'):
        view.limitations.append(analysis['isolation']['pattern_limitation'])
    if rule:
        rules=engineering_record('sensor_rules',{'predicted_pattern':rule},analysis['isolation']['features'],'src/virtual_lab/sensor.py',source)
        view.model_executions.append(execution('Engineering rules',rules,'Deterministic thresholds; not learned probabilities.'))
    if selected and selected.get('probabilities'):
        prediction=selected['predicted_pattern'];view.candidates=candidates(selected['probabilities']);view.summary.verdict=human(prediction);view.summary.status='NORMAL' if prediction=='NORMAL' else 'REVIEW';view.summary.message='The selected experimental model found '+human(prediction).lower()+'. Confirm the finding against the expected response and operating limits.'
        actions={'NORMAL':'Change the setpoint and repeat to verify response across operating conditions.','NOISE':'Reduce injected noise, repeat the capture and compare residual RMS.','DRIFT':'Set drift to zero, rerun the capture and compare the residual trend.','OFFSET':'Check calibration against a reference value, then repeat.','DROPOUT':'Inspect missing samples and repeat with a stable acquisition path.','STUCK':'Apply a changing setpoint to check whether the measured signal responds.','SLOW_RESPONSE':'Compare the response time against the expected sensor dynamics.'}
        view.summary.next_action=actions[prediction]
    elif selected:view.summary.status='UNAVAILABLE';view.summary.verdict='Analysis unavailable';view.summary.message=selected.get('reason','Review the input and retry.')
    else:
        iso=analysis.get('isolation',{});view.summary.verdict=human(iso.get('anomaly_status','Unavailable'));view.summary.message='Isolation Forest reports an anomaly score. Compare temporal and physical-feature methods before interpreting an alarm.'
    labels=[a.get('predicted_pattern') for a in analysis.values() if a.get('predicted_pattern')]
    view.summary.agreement='CNN and Random Forest agree.' if len(labels)==2 and len(set(labels))==1 else 'Models disagree; inspect their evidence.' if len(labels)==2 else 'Compare optional models under Advanced Analysis to assess agreement.'
    view.sensor_analysis=analysis;view.provenance={'source':source,'selection':'Validation only; all models remain experimental','research_directory':'results/ai_reliability_ux_round'}
    # A constant stimulus and constant response cannot identify a stuck path.
    # Keep actual model executions in Research Details, but abstain in the main UI.
    finite=observed[np.isfinite(observed)]
    if float(np.ptp(ideal))<=.01 and len(finite)>0 and float(np.ptp(finite))<=.01:
        view.summary.status='INCONCLUSIVE';view.summary.verdict='Not enough information yet'
        view.summary.message='The reference and reading stayed nearly constant. This cannot distinguish a steady healthy sensor from a stuck sensor.'
        view.summary.next_action='Change the known input and check whether the reading follows it.'
        view.summary.agreement='Agreement between models does not resolve the missing change in input.'
        view.candidates=[]
        view.provenance['identifiability_guard']='constant_reference_and_response_v1'
    return view

@router.post('/sensor/simulate',response_model=Presentation)
def sensor_simulate(request:SensorRequest):
    s=simulate_sensor(request);view=sensor_view([s['ideal'],s['measured']],s['sample_rate_hz'])
    view.provenance['simulation_parameters']=request.model_dump()
    view.limitations.append('Injected errors are known simulation settings. This exercise does not diagnose an unknown hardware fault.')
    return view

@router.post('/sensor/next-experiment',response_model=Presentation)
def sensor_next(request:SensorRequest):
    before_request=SensorRequest(**{**request.model_dump(),'step_change':0,'fault_type':'NORMAL','drift_per_second':0})
    after_request=SensorRequest(**{**before_request.model_dump(),'drift_per_second':0.12})
    before,after=simulate_sensor(before_request),simulate_sensor(after_request)
    view=sensor_view([after['ideal'],after['measured']],after['sample_rate_hz'])
    return sensor_pair(view,before_request,after_request,before,after)

@router.post('/sensor/analyze-capture',response_model=Presentation)
def sensor_capture(request:Annotated[list[PlotTrace],Field(min_length=2,max_length=2)],method:Literal['isolation','temporal','compare']='compare'):
    if request[0].x!=request[1].x or any(v is None for v in request[0].y):raise HTTPException(422,'Provide aligned expected and measured traces')
    steps=np.diff(request[0].x)
    if len(steps)==0 or not np.isfinite(steps).all() or (steps<=0).any():raise HTTPException(422,'Provide increasing, finite sample times')
    if not np.allclose(steps,np.median(steps),rtol=1e-4,atol=1e-9):raise HTTPException(422,'Provide uniformly sampled traces; resample irregular captures before analysis')
    rate=1/float(np.median(steps))
    if not 0<rate<=500:raise HTTPException(422,'Invalid effective sample rate')
    return sensor_view([request[0].y,request[1].y],rate,method)

def advanced_view(req, *, return_diagnosis=False):
    """Optionally return this request's diagnosis for internal route composition."""
    import time
    started=time.perf_counter();stable=diagnose(req.diagnosis) if req.diagnosis else None
    system=req.diagnosis.system_type if req.diagnosis else req.waveform.system_type if req.waveform else 'ANALOG_ADC'
    diagnosis_source = {'USER_PROVIDED':'User-provided readings; not independently verified', 'SIMULATION':'Simulator-produced diagnosis evidence', 'UNSPECIFIED':'Provided diagnosis evidence; source not specified'}[req.diagnosis_source]
    view=Presentation(summary=Summary(title='Evidence and AI analysis',verdict='Review current evidence',source=diagnosis_source if req.diagnosis else 'Simulation evidence' if req.waveform and req.waveform.data_source=='PYTHON_SIMULATION' else 'Current session evidence'))
    if req.diagnosis:
        view.provenance['diagnosis_source'] = req.diagnosis_source
    structured={v.fault:v.probability for v in stable.diagnosis} if stable else {}
    if stable:
        version=req.diagnosis.model_version or (raw_model_version() if req.diagnosis.diagnostic_mode=='adc_raw_v1' else stable_model_version())
        artifact=(ROOT/('models/next_round/adc_raw_candidate.joblib' if version==raw_model_version() else 'models/current_round/adc_raw_candidate.joblib')) if req.diagnosis.diagnostic_mode=='adc_raw_v1' else stable_artifact_path(version)
        root=record({'model_version':version,'artifact_sha256':hashlib.sha256(artifact.read_bytes()).hexdigest(),'probabilities':structured,'predicted_root_fault':stable.diagnosis[0].fault,'scope':'Preserved stable diagnosis','experimental':req.diagnosis.diagnostic_mode=='adc_raw_v1'},'structured_diagnosis',req.diagnosis.model_dump(),started,'SESSION_EVIDENCE')
        root['experimental']=req.diagnosis.diagnostic_mode=='adc_raw_v1';view.model_executions.append(execution('Structured diagnosis',root));view.candidates=candidates(structured,'root','Root fault probability')
        view.summary.verdict=human(stable.diagnosis[0].fault);view.summary.status='INCONCLUSIVE' if not stable.diagnosis_complete else 'REVIEW';view.summary.message='Current leading hypothesis from the supplied measurements. Additional evidence may change this ranking.'
        view.next_check=stable.next_measurement.model_dump() if stable.next_measurement else None
        view.policy_comparison=policies(active_comparison(req.diagnosis,stable));view.summary.next_action=stable.next_measurement.question if stable.next_measurement else 'Review measurement history and perform a controlled retest.'
        if not req.diagnosis.measurements:
            view.summary.verdict='Not enough information yet';view.summary.status='INCONCLUSIVE'
            view.summary.message='No readings have been supplied. Take the next safe check before interpreting a possible cause.'
        view.findings += [Finding(title=human(v.get('code',v.get('fault','Engineering finding'))),description=v.get('message',v.get('explanation',str(v))),severity=v.get('severity','info')) for v in stable.model_dump()['rule_findings']]
    wave=None
    if req.waveform:
        kind={'ANALOG_ADC':'adc','I2C_SENSOR':'i2c','SENSOR':'sensor'}[req.waveform.system_type];wave=safe(infer_waveform,req.waveform.samples,kind,req.waveform.sampling_rate_hz,req.waveform.data_source)
        view.waveform_analysis=wave;view.model_executions.append(execution('Waveform pattern model',wave,'Waveform pattern, not a root fault. '+wave.get('limitation','')))
        if wave.get('probabilities'):view.candidates+=candidates(wave['probabilities'],'pattern')
        view.simulation_summary=[metric('Captured samples',len(req.waveform.samples[0]),digits=0),metric('Sampling rate',req.waveform.sampling_rate_hz,'Hz'),metric('Capture duration',len(req.waveform.samples[0])/req.waveform.sampling_rate_hz,'s')]
    else:view.model_executions.append(Execution(name='Waveform pattern model',state='NOT_RUN_MISSING_INPUT',result='No waveform supplied',scope='Only models supported by actual input are executed.'))
    if req.diagnosis:
        view.simulation_summary += measurement_metrics(req.diagnosis, diagnosis_source)
    measurements=req.diagnosis.measurements if req.diagnosis else {};obs=req.adc_observations or (measurements if req.diagnosis and req.diagnosis.diagnostic_mode=='adc_raw_v1' else {})
    if system=='ANALOG_ADC':
        # The retained paired gate uses its original frozen encoder and compatible
        # six-root ontology. Repaired waveform presentation is a separate head.
        from ..diagnosis_engine import predict_probabilities
        common={k:v for k,v in obs.items() if k in ('ADC_READING','ADC_REFERENCE')}
        if 'ADC_INPUT_VOLTAGE' in obs:common['OUTPUT_VOLTAGE']=obs['ADC_INPUT_VOLTAGE']
        if 'OUTPUT_VOLTAGE' in obs:common['EXPECTED_OUTPUT_VOLTAGE']=obs['OUTPUT_VOLTAGE']
        pp=structured if req.diagnosis and req.diagnosis.diagnostic_mode=='stable' and measurements else {v['fault']:v['probability'] for v in predict_probabilities(system,'OTHER',common)} if common else {}
        cons=consistency(pp,obs,req.waveform.samples if req.waveform else None);view.provenance['physics']=cons
        view.findings += [Finding(title=v['finding'],description=f"Observed residual: {v['residual']:.3f}",evidence=v['evidence']) for v in cons['findings']]
        view.summary.agreement='Physical checks and model evidence conflict.' if cons['agreement']=='CONFLICT' else 'No conflict identified in the available physical checks.'
        fusion=({'available':False,'execution_state':'NOT_RUN_MISSING_INPUT','reason':'No observed measurements or waveform'}
                if not measurements and not obs and req.waveform is None else safe(infer_paired_adc,pp,obs,req.waveform.samples if req.waveform else None,req.waveform.sampling_rate_hz if req.waveform else None,req.waveform.data_source if req.waveform else 'USER_PROVIDED'))
        view.fusion_analysis=fusion;view.model_executions.append(execution('ADC paired root fusion',fusion,'Validated experimental scope: six single-cause ADC roots; excludes polarity, generic voltage-level and compound faults.'))
        view.candidates+=candidates(fusion.get('probabilities',{}),'fusion','Experimental fused root probability')
        expert_measurements=measurements if req.diagnosis and req.diagnosis.diagnostic_mode=='stable' else common
        expert=safe(infer_expert_fusion,system,expert_measurements,pp,req.waveform.data_source if req.waveform else 'SESSION_EVIDENCE')
        view.model_executions.append(execution('ADC system evidence combination',expert,'Experimental shared-observation and derived-physics expert; correlated evidence. Separate from paired waveform fusion.'))
        view.provenance['adc_system_expert']=expert
        if req.waveform:
            uncertainty=safe(infer_uncertainty,req.waveform.samples,req.waveform.sampling_rate_hz,req.waveform.data_source);view.uncertainty_analysis=uncertainty
            view.model_executions.append(execution('Unknown-pattern assessment',uncertainty));view.limitations.append(uncertainty.get('assessment',uncertainty.get('reason','Assessment unavailable')))
        else:view.model_executions.append(Execution(name='Unknown-pattern assessment',state='NOT_RUN_MISSING_INPUT',result='No ADC waveform supplied'))
    else:
        if system in EXPERT_REGISTRY:
            _,findings=expert_probabilities(system,measurements,load_config('systems')[system]['applicable_faults'])
            view.findings += [Finding(title=v['reason'],description='Supported by the supplied '+human(v['evidence']).lower()+' measurement.',evidence=v['evidence']) for v in findings]
            fused=safe(infer_expert_fusion,system,measurements,structured,req.waveform.data_source if req.waveform else 'SESSION_EVIDENCE');view.fusion_analysis=fused;view.model_executions.append(execution('System evidence combination',fused))
            view.candidates+=candidates(fused.get('probabilities',{}),'fusion','Experimental fused root probability')
        view.model_executions.append(Execution(name='Learned waveform fusion',state='NOT_SUPPORTED_FOR_SYSTEM',result='Learned fusion not yet validated for this system',scope='Structured and engineering evidence can still be compared; no ADC waveform gate is applied.'))
        view.summary.agreement='Review shared-model and system-specific evidence; correlated inputs are not independent confirmation.'
    view.limitations+=['Experimental models were trained on simulated data. Stable diagnosis and Information Gain remain available.']
    view.provenance.update(system_type=system,production_model_version=stable_model_version(),algorithm_round='reliability_v2')
    return (view, stable) if return_diagnosis else view

@router.post('/troubleshooting/advanced',response_model=Presentation)
def troubleshooting(request:MultimodalRequest):return advanced_view(request)

@router.post('/device/adc/advanced',response_model=Presentation)
def adc(request:ADCModelRequest):
    s=simulate_adc(request)
    if request.sample_count<64:raise HTTPException(422,'AI analysis requires at least 64 samples')
    w=WaveformAnalyzeRequest(system_type='ANALOG_ADC',samples=[s['chart'][k] for k in ('commanded_v','pin_v','adc_reconstructed_v')],sampling_rate_hz=request.sample_rate_hz,data_source='PYTHON_SIMULATION')
    d=DiagnosisRequest(system_type='ANALOG_ADC',symptom_type='OTHER',diagnostic_mode='adc_raw_v1',measurements=s['diagnosis_evidence']['measurements'],available_tools=['SIMULATION','MULTIMETER','VISUAL_SETTINGS'])
    view=advanced_view(MultimodalRequest(diagnosis=d,waveform=w,adc_observations=d.measurements));view.summary.title='ADC analysis';view.simulation_summary += [metric('Expected count',s['expected_count'],'counts',0),metric('Measured count',s['simulated_count'],'counts',0),metric('Count residual',s['count_residual'],'counts',0),metric('Quantization step',s['quantization_step_v']*1000,'mV/count',3),metric('Reference difference',s['reference_difference_v'],'V',3)]
    view.signal_series=signal_view([trace(s['chart']['time_s'],s['chart'][key],label) for key,label in [('commanded_v','Commanded input'),('pin_v','ADC pin'),('adc_reconstructed_v','Reconstructed voltage')]],'ADC signal and reconstruction','Voltage (V)')
    view.calculations=[Calculation(title='Quantization step',formula='Vref / 2^bits',substitution=f'{request.reference_voltage} / 2^{request.resolution_bits}',result=f'{s["quantization_step_v"]:.9f} V/count'),Calculation(title='First sampled code',formula='clip(floor(pin voltage / Vref × 2^bits), 0, 2^bits - 1)',substitution=f'pin={s["chart"]["pin_v"][0]:.6f} V; Vref={request.reference_voltage} V; bits={request.resolution_bits}',result=f'{s["simulated_count"]} counts',assumptions='Floor convention. The plotted reconstruction uses the declared target reference and target resolution.')]
    view.learning_cards=[LearningCard(title='What happened?',text=f'The first sample is {s["simulated_count"]} counts. Its residual from the intended converter is {s["count_residual"]} counts.'),LearningCard(title='Why?',text=f'Each code step represents {s["quantization_step_v"]*1000:.6f} mV. Values beyond the converter range clip.'),LearningCard(title='What changed?',text=f'Reference difference: {s["reference_difference_v"]:.3f} V. Resolution difference: {s["resolution_difference_bits"]} bits.'),LearningCard(title='What to try next?',text='Keep the input fixed and compare two resolutions. Compare the reconstruction and code step, not only the raw count.')]
    view.limitations.append('Gain, offset and converter settings are known simulation inputs. AI scores are not independent discovery of the injected error.')
    return view

@router.post('/device/adc/next-experiment',response_model=Presentation)
def adc_next(request:ADCModelRequest):
    observed=simulate_adc(request)['diagnosis_evidence']['measurements'];evidence={k:v for k,v in observed.items() if k not in ('ADC_REFERENCE','ADC_RESOLUTION_BITS')}
    req=DiagnosisRequest(system_type='ANALOG_ADC',symptom_type='OTHER',diagnostic_mode='adc_raw_v1',measurements=evidence,available_tools=['MULTIMETER','VISUAL_SETTINGS']);a=active_comparison(req)
    view=Presentation(summary=Summary(title='Next ADC experiment',verdict='Verify converter configuration',message='This controlled exercise retains the captured pin voltage and count while treating reference and resolution as unverified.',next_action='Measure the reference voltage or inspect the resolution setting, then run the corrected simulation.'))
    view.policy_comparison=policies(a);view.limitations=[a['cost_basis'],a['promotion']];view.provenance={'evidence':evidence,'selection':a};return view

@router.post('/device/adc/compare-runs',response_model=Presentation)
def adc_compare_runs(request:CounterfactualRequest):
    before,after=request.before,request.after
    allowed={'reference_voltage','resolution_bits'}
    changes={k for k,v in before.model_dump().items() if after.model_dump()[k]!=v}
    if changes-allowed:
        raise HTTPException(422,'Keep stimulus, gain, offset, noise, sampling and seed identical. Compare only reference voltage or resolution.')
    if not changes:
        raise HTTPException(422,'Change reference voltage or resolution to create a comparison.')
    a,b=simulate_adc(before),simulate_adc(after)
    decoded_a=np.asarray(a['chart']['adc_counts'])*before.reference_voltage/(2**before.resolution_bits)
    decoded_b=np.asarray(b['chart']['adc_counts'])*after.reference_voltage/(2**after.resolution_bits)
    error_a=float(np.sqrt(np.mean((decoded_a-a['chart']['pin_v'])**2)))
    error_b=float(np.sqrt(np.mean((decoded_b-b['chart']['pin_v'])**2)))
    delta=[f'{human(k)}: {getattr(before,k)} → {getattr(after,k)}' for k in sorted(changes)]
    conclusion=(f'Code step changes from {a["quantization_step_v"]*1000:.6f} to {b["quantization_step_v"]*1000:.6f} mV/count. '
                f'Reconstruction RMS error against the identical pin samples changes from {error_a*1000:.6f} to {error_b*1000:.6f} mV. '
                'Each trace is decoded using its own converter settings; counts alone are not comparable across resolutions.')
    view=Presentation(summary=Summary(title='ADC controlled comparison',verdict='Two simulated runs completed',message=conclusion,
        next_action='Keep Vref fixed and change only resolution to isolate quantization. Inspect clipping before interpreting reconstruction error.'))
    view.signal_series=signal_view([trace(a['chart']['time_s'],a['chart']['pin_v'],'Identical pin input'),
        trace(a['chart']['time_s'],decoded_a,'Run A reconstruction'),trace(b['chart']['time_s'],decoded_b,'Run B reconstruction')],
        'ADC before and after','Voltage (V)')
    view.simulation_summary=[metric('Run A first count',a['simulated_count'],'counts',0),metric('Run B first count',b['simulated_count'],'counts',0),
        metric('Run A code step',a['quantization_step_v']*1000,'mV/count',6),metric('Run B code step',b['quantization_step_v']*1000,'mV/count',6),
        metric('Run A reconstruction RMS',error_a*1000,'mV',6),metric('Run B reconstruction RMS',error_b*1000,'mV',6)]
    view.comparison=RunComparison(status='AVAILABLE',before_parameters=before.model_dump(),after_parameters=after.model_dump(),changes=delta,metrics=view.simulation_summary,conclusion='; '.join(delta)+'. '+conclusion)
    view.learning_cards=[LearningCard(title='What happened?',text=conclusion),LearningCard(title='Why?',text='A finite-resolution converter divides its voltage range into discrete codes. A larger code step produces coarser quantization.'),
        LearningCard(title='What changed?',text='; '.join(delta)+'. Input samples, noise realization and all other settings are identical.'),LearningCard(title='What to try next?',text=view.summary.next_action)]
    view.calculations=[Calculation(title='Code step in each run',formula='Vref / 2^bits',substitution=f'A: {before.reference_voltage}/2^{before.resolution_bits}; B: {after.reference_voltage}/2^{after.resolution_bits}',result=f'A: {a["quantization_step_v"]:.9f}; B: {b["quantization_step_v"]:.9f} V/count'),
        Calculation(title='Reconstruction error',formula='sqrt(mean((code × Vref / 2^bits - pin)^2))',substitution=f'{before.sample_count} matched pin samples',result=f'A: {error_a:.9f}; B: {error_b:.9f} V',assumptions='Includes clipping where the pin exceeds converter range. Floor quantization; no learned model was run.')]
    view.limitations=['Two deterministic simulations with a shared noise seed. Known converter settings are not independently diagnosed hardware faults.',
        f'Clipping detected: run A={a["saturation"]}, run B={b["saturation"]}.']
    view.provenance={'source':'PYTHON_SIMULATION','comparison_parameters':request.model_dump()}
    return view

class ReferenceWaveformRequest(WaveformAnalyzeRequest):
    expected_reference_available:bool=True
@router.post('/waveform/analyze',response_model=Presentation)
def waveform(request:ReferenceWaveformRequest):
    kind={'ANALOG_ADC':'adc','I2C_SENSOR':'i2c','SENSOR':'sensor'}[request.system_type]
    wave=safe(infer_waveform,request.samples,kind,request.sampling_rate_hz,request.data_source,request.expected_reference_available)
    view=Presentation(summary=Summary(title='Waveform analysis',verdict=human(wave.get('predicted_pattern','Unavailable')),message='Compare the measured waveform with its supplied reference.',next_action='Repeat with a changed stimulus to test the predicted pattern.'))
    if not request.expected_reference_available:
        view.summary.status='MISSING_INPUT';view.summary.message='An expected reference is needed to interpret this pattern.';view.summary.next_action='Supply the expected signal or circuit reference, then analyze again.'
    view.waveform_analysis=wave;view.model_executions=[execution('Waveform pattern model',wave)];view.candidates=candidates(wave.get('probabilities',{}));view.simulation_summary=[metric('Captured samples',len(request.samples[0]),digits=0),metric('Sampling rate',request.sampling_rate_hz,'Hz'),metric('Capture duration',len(request.samples[0])/request.sampling_rate_hz,'s')]
    view.findings=[Finding(title='Signal family',description=human(wave.get('family','sensor response'))),Finding(title='Expected reference',description='Provided' if request.expected_reference_available else 'Missing; normal and attenuation cannot be inferred.')]
    view.limitations=['Pattern probabilities are not root-fault probabilities. Trained on simulated data.',wave.get('limitation','Review the signal condition before applying the result.')]
    labels={'ANALOG_ADC':['Expected input','Measured pin','ADC reconstruction'],'SENSOR':['Expected response','Measured response'],'I2C_SENSOR':['Expected SDA','Expected SCL','Measured SDA','Measured SCL']}[request.system_type]
    times=(np.arange(len(request.samples[0]))/request.sampling_rate_hz).tolist()
    unit='Temperature (°C)' if request.system_type=='SENSOR' else 'Logic level (normalized)' if request.system_type=='I2C_SENSOR' else 'Voltage (V)'
    view.signal_series=signal_view([trace(times,row,label) for row,label in zip(request.samples,labels)],'Captured waveform',unit)
    view.summary.source='Simulated signal' if request.data_source=='PYTHON_SIMULATION' else 'User-provided signal'
    view.calculations=[Calculation(title='Sample interval',formula='1 / sampling rate',substitution=f'1 / {request.sampling_rate_hz} Hz',result=f'{1/request.sampling_rate_hz:.9g} s'),Calculation(title='Capture coverage',formula='sample count / sampling rate',substitution=f'{len(times)} / {request.sampling_rate_hz}',result=f'{len(times)/request.sampling_rate_hz:.9g} s',assumptions=f'The last sample occurs at {times[-1]:.9g} s; coverage includes one final sample interval.')]
    view.learning_cards=[LearningCard(title='What happened?',text=f'{len(times)} aligned samples per channel were analyzed at {request.sampling_rate_hz:g} Hz.'),LearningCard(title='Why?',text='The model compares signal patterns. A constant trace needs an independent expected reference to distinguish normal DC from attenuation.'),LearningCard(title='What changed?',text='This is one capture. A before-and-after change has not been established.'),LearningCard(title='What to try next?',text=view.summary.next_action)]
    return view

class GeneratedReferenceRequest(GeneratedWaveformRequest):
    adc_signal_type:Literal['CONSTANT','SINE']='SINE'
    dc_level:FiniteFloat=Field(default=1.65,ge=0,le=3.3)
    reference_available:bool=True

def generated_samples(request:GeneratedReferenceRequest):
    if request.source=='ANALOG_ADC':
        s=simulate_adc(ADCModelRequest(signal_type=request.adc_signal_type,input_voltage=request.dc_level));samples=[s['chart'][k] for k in ('commanded_v','pin_v','adc_reconstructed_v')];fs=1024.
    elif request.source=='SENSOR':
        s=simulate_sensor(SensorRequest());samples=[s['ideal'],s['measured']];fs=s['sample_rate_hz']
    else:
        s=simulate_i2c(I2CRequest());samples=[s[k] for k in ('ideal_sda','ideal_scl','sda','scl')];fs=s['metadata']['sampling_rate']
    return samples,fs

@router.post('/waveform/generate-analyze',response_model=Presentation)
def generated(request:GeneratedReferenceRequest):
    samples,fs=generated_samples(request)
    return waveform(ReferenceWaveformRequest(system_type=request.source,samples=samples,sampling_rate_hz=fs,data_source='PYTHON_SIMULATION',expected_reference_available=request.reference_available))

@router.post('/waveform/generate-chart')
def generated_chart(request:GeneratedReferenceRequest):
    samples,fs=generated_samples(request)
    labels={'ANALOG_ADC':['Expected input','Measured pin','ADC reconstruction'],'SENSOR':['Expected response','Measured response'],'I2C_SENSOR':['Expected SDA','Expected SCL','Measured SDA','Measured SCL']}[request.source]
    traces=[{'x':(np.arange(len(row))/fs).tolist(),'y':np.asarray(row).tolist(),'type':'scatter','mode':'lines','name':label} for row,label in zip(samples,labels)]
    return PlainTextResponse(json.dumps(traces))

@router.post('/waveform/next-experiment', response_model=Presentation)
def waveform_next(request:GeneratedReferenceRequest):
    """Generate two aligned captures with exactly one controlled setting changed."""
    samples_a, fs = generated_samples(request)
    before = request.model_dump()
    if request.source == 'ANALOG_ADC':
        after_request = request.model_copy(update={'adc_signal_type': 'CONSTANT' if request.adc_signal_type == 'SINE' else 'SINE'})
        samples_b, fs_b = generated_samples(after_request)
        after = after_request.model_dump()
        change = f'ADC stimulus: {request.adc_signal_type} to {after_request.adc_signal_type}'
        lesson = 'The stimulus changed between a constant voltage and a time-varying signal. This is a known input change, not an independently discovered fault.'
    elif request.source == 'SENSOR':
        a = SensorRequest()
        b = a.model_copy(update={'drift_per_second': .12})
        s = simulate_sensor(b)
        samples_b, fs_b = [s['ideal'], s['measured']], s['sample_rate_hz']
        before, after = a.model_dump(), b.model_dump()
        change = 'Sensor drift: 0 to 0.12 degrees Celsius per second'
        lesson = 'The same stimulus and noise seed are retained. Only the known sensor drift changes.'
    else:
        a = I2CRequest()
        b = a.model_copy(update={'fault_type': 'MISSING_ACK'})
        # Reuse the same packet and clock. The generic fault generator also
        # changes timing and noise, so it is not a one-variable comparison.
        samples_b, fs_b = np.asarray(samples_a).copy(), fs
        samples_per_bit = 16
        preamble = samples_per_bit + samples_per_bit // 2
        for bit_index in (8, 17):
            start = preamble + bit_index * samples_per_bit
            samples_b[2, start:start + samples_per_bit] = 1.0
        samples_b = samples_b.tolist()
        before, after = a.model_dump(), b.model_dump()
        change = 'I2C simulator condition: NORMAL to MISSING_ACK'
        lesson = 'The missing acknowledgement is a known simulator setting. Inspect the ACK interval; model labels do not independently establish a hardware fault.'
    if fs != fs_b or len(samples_a[0]) != len(samples_b[0]):
        raise HTTPException(422, 'Comparison requires aligned sample grids.')
    a_view = waveform(ReferenceWaveformRequest(system_type=request.source, samples=samples_a, sampling_rate_hz=fs, data_source='PYTHON_SIMULATION', expected_reference_available=request.reference_available))
    b_view = waveform(ReferenceWaveformRequest(system_type=request.source, samples=samples_b, sampling_rate_hz=fs, data_source='PYTHON_SIMULATION', expected_reference_available=request.reference_available))
    for label, view in [('A', a_view), ('B', b_view)]:
        for item in view.model_executions:
            item.name = f'Run {label}: {item.name}'
    b_view.model_executions = a_view.model_executions + b_view.model_executions
    traces = []
    for label, view in [('A', a_view), ('B', b_view)]:
        for item in view.signal_series['traces']:
            traces.append({**item, 'name': f'Run {label}: {item["name"]}'})
    b_view.signal_series['traces'] = traces
    b_view.signal_series['label'] = 'Two controlled waveform captures'
    measured_channel = {'ANALOG_ADC':1, 'SENSOR':1, 'I2C_SENSOR':2}[request.source]
    delta = np.asarray(samples_b[measured_channel]) - np.asarray(samples_a[measured_channel])
    unit = 'degrees Celsius' if request.source == 'SENSOR' else 'normalized level' if request.source == 'I2C_SENSOR' else 'V'
    rms = float(np.sqrt(np.mean(delta**2)))
    b_view.simulation_summary += [metric('Measured-channel change RMS',rms,unit,6)]
    conclusion = f'{change}. Measured-channel change RMS: {rms:.6g} {unit}. {lesson}'
    b_view.comparison = RunComparison(status='AVAILABLE', before_parameters=before, after_parameters=after, changes=[change], metrics=b_view.simulation_summary, conclusion=conclusion)
    b_view.summary.title = 'Controlled waveform comparison'
    b_view.summary.message = conclusion
    b_view.summary.next_action = 'Compare the two measured traces with their expected reference. Return to Run to analyze the original settings.'
    b_view.learning_cards = [LearningCard(title='What happened?',text=f'Run A: {a_view.summary.verdict}. Run B: {b_view.summary.verdict}. Measured-channel change RMS: {rms:.6g} {unit}.'), LearningCard(title='Why?',text=lesson), LearningCard(title='What changed?',text=change+'. Other simulator settings and sample grid are retained.'), LearningCard(title='What to try next?',text=b_view.summary.next_action)]
    b_view.calculations.append(Calculation(title='Measured-channel change',formula='sqrt(mean((B - A)^2))',substitution=f'{len(delta)} matched samples',result=f'{rms:.9g} {unit}',assumptions='This quantifies a controlled change. It is not an accuracy metric.'))
    b_view.provenance.update({'source':'PYTHON_SIMULATION','comparison_parameters':{'before':before,'after':after}})
    return b_view

@router.post('/mcu/i2c/simulate',response_model=Presentation)
def i2c(request:I2CRequest):
    s=simulate_i2c(request);samples=[s[k] for k in ('ideal_sda','ideal_scl','sda','scl')];fs=s['metadata']['sampling_rate'];v=waveform(ReferenceWaveformRequest(system_type='I2C_SENSOR',samples=samples,sampling_rate_hz=fs,data_source='PYTHON_SIMULATION'));v.summary.title='I²C protocol analysis'
    f=i2c_protocol_features(ProtocolCase(np.asarray(samples),{'samples_per_bit':max(4,round(len(samples[0])/21))},{}));v.provenance['protocol_features']=f
    v.simulation_summary += [metric(human(k),float(value),digits=3) for k,value in f.items()]
    pattern=(v.waveform_analysis or {}).get('predicted_pattern');v.summary.next_action='Inspect ACK bits and the addressed device settings.' if pattern=='MISSING_ACK' else 'Check pull-up resistance and bus capacitance; repeat and compare rise time.' if pattern=='SLOW_RISE' else 'Inspect SDA/SCL transitions and repeat with a controlled fault injection.'
    v.limitations.append('Learned fusion not yet validated for this system. The ADC root-fusion model is not applied.');return v

@router.post('/mcu/pwm/simulate',response_model=Presentation)
def pwm(request:PWMRequest):
    s=simulate_pwm(request);v=Presentation(summary=Summary(title='PWM engineering result',verdict='PWM waveform generated',message='These results are deterministic timing calculations.',next_action='Vary the duty cycle and compare pulse width and average voltage.'))
    v.simulation_summary=[metric('Frequency',request.frequency_hz,'Hz'),metric('Duty cycle',100*request.duty_cycle,'%'),metric('Period',s['period_s']*1000,'ms',3),metric('High time',s['high_time_s']*1000,'ms',3),metric('Low time',s['low_time_s']*1000,'ms',3),metric('Average voltage',s['average_voltage_v'],'V',3)]
    calculation=engineering_record('pwm_timing',{'reason':'Engineering calculation','calculation':{k:s[k] for k in ('period_s','high_time_s','low_time_s','average_voltage_v')}},request.model_dump(),'src/virtual_lab/mcu.py')
    detail=execution('PWM timing calculation',calculation,'Deterministic; no learned PWM model executed.')
    detail.result=v.summary.verdict
    detail.score='Average voltage '+v.simulation_summary[-1].display
    v.model_executions=[detail]
    v.signal_series=signal_view([trace(s['time_s'],s['voltage_v'],'PWM output')],'PWM output','Voltage (V)')
    v.calculations=[Calculation(title='PWM period',formula='T = 1 / f',substitution=f'1 / {request.frequency_hz} Hz',result=f'{s["period_s"]:.9g} s'),Calculation(title='Average voltage',formula='Vavg = duty × high voltage',substitution=f'{request.duty_cycle} × {request.voltage} V',result=f'{s["average_voltage_v"]:.6g} V',assumptions='Ideal low level is 0 V. This is an average voltage, not motor speed or power.')]
    v.learning_cards=[LearningCard(title='What happened?',text=f'The output is high for {s["high_time_s"]:.6g} s in each {s["period_s"]:.6g} s period.'),LearningCard(title='Why?',text=f'Duty cycle {100*request.duty_cycle:g}% sets the high fraction. The ideal average is {s["average_voltage_v"]:.4g} V.'),LearningCard(title='What changed?',text='This is one simulation. No earlier run is retained in this result.'),LearningCard(title='What to try next?',text='Keep frequency fixed and change duty cycle. Compare high time and average voltage.')]
    return v

@router.post('/mcu/pwm/next-experiment', response_model=Presentation)
def pwm_next(request:PWMRequest):
    after = request.model_copy(update={'duty_cycle':request.duty_cycle + .25 if request.duty_cycle <= .75 else request.duty_cycle - .25})
    a, b = simulate_pwm(request), simulate_pwm(after)
    view = pwm(after)
    change = f'Duty cycle: {100*request.duty_cycle:g}% to {100*after.duty_cycle:g}%'
    conclusion = f'High time changes from {a["high_time_s"]*1000:.6g} to {b["high_time_s"]*1000:.6g} ms. Average voltage changes from {a["average_voltage_v"]:.6g} to {b["average_voltage_v"]:.6g} V.'
    view.signal_series = signal_view([trace(a['time_s'],a['voltage_v'],'Run A: original duty'),trace(b['time_s'],b['voltage_v'],'Run B: changed duty')], 'PWM duty comparison', 'Voltage (V)')
    view.summary.title = 'PWM duty comparison'
    view.summary.message = change+'. '+conclusion
    view.summary.source = 'Two controlled simulations'
    view.simulation_summary = [metric('Before duty',100*request.duty_cycle,'%'),metric('After duty',100*after.duty_cycle,'%'),metric('Before average voltage',a['average_voltage_v'],'V',6),metric('After average voltage',b['average_voltage_v'],'V',6),metric('Average voltage change',b['average_voltage_v']-a['average_voltage_v'],'V',6)]
    view.comparison = RunComparison(status='AVAILABLE',before_parameters=request.model_dump(),after_parameters=after.model_dump(),changes=[change],metrics=view.simulation_summary,conclusion=conclusion)
    view.learning_cards = [LearningCard(title='What happened?',text=conclusion),LearningCard(title='Why?',text='Duty cycle changes how long the pin is high. Frequency and high voltage are held fixed.'),LearningCard(title='What changed?',text=change+'. The sample grid and all other settings are identical.'),LearningCard(title='What to try next?',text='Change the original duty setting and repeat. These ideal voltage calculations do not predict motor speed.')]
    view.calculations = [Calculation(title='Average voltage change',formula='(duty B - duty A) × high voltage',substitution=f'({after.duty_cycle:g} - {request.duty_cycle:g}) × {request.voltage:g}',result=f'{b["average_voltage_v"]-a["average_voltage_v"]:.9g} V',assumptions='Ideal low level is 0 V. Analytic period average; finite plotted sampling can approximate edges.')]
    view.provenance = {'source':'PYTHON_SIMULATION','comparison_parameters':{'before':request.model_dump(),'after':after.model_dump()}}
    return view

@router.post('/mcu/gpio/simulate',response_model=Presentation)
def gpio(request:GPIORequest):
    s=simulate_gpio(request);v=Presentation(summary=Summary(title='GPIO engineering result',verdict=human(s['simulated_state']),message='The pin state follows the configured driver, external signal and pull resistor.',next_action='Change the external level or pull setting and compare the observed logic state.'))
    v.simulation_summary=[Metric(label='Pin state',display=human(s['simulated_state']),description='Computed ideal logic state. Unknown is not a measured Low value.'),Metric(label='External input',display=human(request.external_level)),Metric(label='Pull setting',display=human(request.pull)),Metric(label='Expected state',display=human(request.expected_level)),Metric(label='Matches expected',display='Unknown' if s['matches_expected'] is None else 'Yes' if s['matches_expected'] else 'No',description='A floating input without a pull cannot establish agreement with the expected state.')]
    v.findings=[Finding(title='Expected state',description=human(s['expected_state'])),Finding(title='State source',description=human(s['state_source'])),Finding(title='Matches expected',description='Unknown' if s['matches_expected'] is None else 'Yes' if s['matches_expected'] else 'No')]
    calculation=engineering_record('gpio_logic',{'reason':'Engineering calculation','calculation':s},request.model_dump(),'src/virtual_lab/mcu.py')
    detail=execution('GPIO state calculation',calculation,'Deterministic; no learned GPIO model executed.')
    detail.result=v.summary.verdict
    detail.score='Comparison unavailable' if s['matches_expected'] is None else 'Matches expected' if s['matches_expected'] else 'Differs from expected'
    v.model_executions=[detail]
    v.calculations=[Calculation(title='GPIO state rule',formula='Output driver, else external input, else pull resistor, else unknown',substitution=f'Mode={request.mode}; external={request.external_level}; pull={request.pull}; output={request.output_level}',result=s['simulated_state'],assumptions='Ideal logic-state model. A floating input with no pull has no confirmed high or low value.')]
    v.learning_cards=[LearningCard(title='What happened?',text=f'The computed pin state is {s["simulated_state"]}.'),LearningCard(title='Why?',text=f'The active source is {human(s["state_source"])}.'),LearningCard(title='What changed?',text='One configured state was calculated. No transition timing or waveform was measured.'),LearningCard(title='What to try next?',text='Change the external level or pull resistor and run again. A floating input should remain unknown without a pull.')]
    return v
