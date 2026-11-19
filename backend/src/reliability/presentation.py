"""Typed native presentation contract. Research payload never becomes main UI text."""
import json,re,uuid
from datetime import datetime,timezone
from typing import Literal
from pydantic import BaseModel,Field,FiniteFloat

ExecutionState=Literal['EXECUTED','NOT_RUN_MISSING_INPUT','NOT_SUPPORTED_FOR_SYSTEM','MODEL_UNAVAILABLE','INFERENCE_FAILED']
class Summary(BaseModel):
    title:str;verdict:str='Ready';message:str='';status:str='READY';agreement:str='';next_action:str='';source:str='Simulated signal';stale:bool=False
class Metric(BaseModel):
    label:str;value:FiniteFloat|None=None;unit:str='';display:str;description:str=''
class Candidate(BaseModel):
    label:str;probability:FiniteFloat=Field(ge=0,le=1);display:str;score_type:str='Pattern probability';rank:int;group:str='pattern'
class Finding(BaseModel):
    title:str;description:str;severity:str='info';evidence:str=''
class Execution(BaseModel):
    name:str;state:ExecutionState;result:str='';score:str='';scope:str='';model_version:str='';artifact_hash:str='';invocation_id:str='';executed_at:str='';experimental:bool=True
    short_name:str='';method_kind:str='';input_modality:str=''
class Policy(BaseModel):
    name:str;check:str;benefit:FiniteFloat|None=None;benefit_unit:str='';benefit_display:str='';relative_cost:FiniteFloat|None=None;cost_display:str='';status:str='Experimental'
class LearningCard(BaseModel):
    title:str;text:str
class Calculation(BaseModel):
    title:str;formula:str;substitution:str;result:str;assumptions:str=''
class RunComparison(BaseModel):
    status:Literal['AVAILABLE','NOT_AVAILABLE']='NOT_AVAILABLE'
    before_parameters:dict=Field(default_factory=dict)
    after_parameters:dict=Field(default_factory=dict)
    changes:list[str]=Field(default_factory=list)
    metrics:list[Metric]=Field(default_factory=list)
    conclusion:str='Run two compatible experiments to compare their results.'
class Presentation(BaseModel):
    schema_version:str='native-ai-view-v2';operation_id:str=Field(default_factory=lambda:uuid.uuid4().hex)
    generated_at:str=Field(default_factory=lambda:datetime.now(timezone.utc).isoformat())
    summary:Summary;simulation_summary:list[Metric]=Field(default_factory=list);signal_series:dict=Field(default_factory=dict)
    candidates:list[Candidate]=Field(default_factory=list);findings:list[Finding]=Field(default_factory=list)
    model_executions:list[Execution]=Field(default_factory=list);policy_comparison:list[Policy]=Field(default_factory=list)
    recommendations:list[str]=Field(default_factory=list);limitations:list[str]=Field(default_factory=list)
    learning_cards:list[LearningCard]=Field(default_factory=list)
    calculations:list[Calculation]=Field(default_factory=list)
    comparison:RunComparison=Field(default_factory=RunComparison)
    sensor_analysis:dict|None=None;waveform_analysis:dict|None=None;fusion_analysis:dict|None=None;uncertainty_analysis:dict|None=None;next_check:dict|None=None
    provenance:dict=Field(default_factory=dict)

def human(value):
    if value is None:return 'Not available'
    return re.sub(r'(?<=[a-z])(?=[A-Z])',' ',str(value)).replace('_',' ').capitalize()
def number(value,digits=2):
    return 'Not available' if value is None else f'{value:,.{digits}f}'.rstrip('0').rstrip('.') if digits else f'{value:,.0f}'
def percent(value):return '<0.1%' if 0<value<.001 else f'{100*value:.1f}%'
def metric(label,value,unit='',digits=2,description=''):
    # Preserve sub-millisecond protocol timings instead of rounding them to zero.
    if unit=='s' and value is not None and 0<abs(value)<1:
        value,unit=(value*1e6,'µs') if abs(value)<.001 else (value*1000,'ms')
    return Metric(label=label,value=value,unit=unit,display=number(value,digits)+((' '+unit) if unit and value is not None else ''),description=description)

def measurement_metrics(request, source='Provided diagnosis evidence; source not specified'):
    """Keep Boolean, zero, choice and absence semantics in the native evidence table."""
    from ..system_registry import get_measurement
    rows = []
    for code, value in request.measurements.items():
        definition = get_measurement(code)
        unit = definition.get('unit') or ''
        kind = definition['input_type']
        numeric = None
        if value is None:
            display, state = 'Unknown', 'UNKNOWN'
        elif isinstance(value, bool):
            display, state = ('Yes' if value else 'No'), 'PRESENT_BOOLEAN'
        elif kind == 'numeric':
            numeric = float(value)
            display, state = str(value) + ((' ' + unit) if unit else ''), 'PRESENT_NUMERIC'
        else:
            display, state = str(value), 'PRESENT_CHOICE'
        rows.append(Metric(label=definition.get('display_name', human(code)), value=numeric,
                           unit=unit if numeric is not None else '', display=display,
                           description=f'{source}. '+{'UNKNOWN':'No confirmed value.', 'PRESENT_BOOLEAN':'Confirmed yes/no reading.', 'PRESENT_NUMERIC':'Confirmed numeric reading; zero is a valid value.', 'PRESENT_CHOICE':'Confirmed option.'}[state]+' See session history for the recorded time.'))
    for item in request.unavailable_checks:
        definition = get_measurement(item.code)
        rows.append(Metric(label=definition.get('display_name', human(item.code)), display=human(item.reason),
                           description='No value was measured. Excluded from next-check selection for this request.'))
    return rows
def candidates(probabilities,group='pattern',score_type='Pattern probability'):
    return [Candidate(label=human(k),probability=float(v),display=percent(v),score_type=score_type,rank=i+1,group=group) for i,(k,v) in enumerate(sorted(probabilities.items(),key=lambda x:-x[1]))]
def execution(name,result,scope=''):
    state=result.get('execution_state')
    if state is None:state='EXECUTED' if result.get('invocation_id') else ('MODEL_UNAVAILABLE' if result.get('available') is False else 'NOT_RUN_MISSING_INPUT')
    prob=result.get('probabilities') or {};label=result.get('predicted_pattern',result.get('predicted_root_fault',result.get('anomaly_status',result.get('assessment',result.get('reason','')))))
    score=percent(max(prob.values()))+' pattern probability' if prob and 'predicted_pattern' in result else percent(max(prob.values()))+' root score' if prob else f"{result['anomaly_score']:.3f} anomaly score" if 'anomaly_score' in result else ''
    return Execution(name=name,state=state,result=human(label),score=score,scope=scope or result.get('scope',''),model_version=result.get('model_version',''),artifact_hash=result.get('artifact_sha256',''),invocation_id=result.get('invocation_id',''),executed_at=result.get('executed_at',''),experimental=result.get('experimental',True))

def policies(active):
    out=[]
    labels={'production_information_gain':'Information Gain','experimental_cost_aware_ig':'Cost-aware Information Gain','experimental_decision_value':'Expected error reduction'}
    for item in (active or {}).get('recommendations',[]):
        benefit=item.get('information_gain_bits',item.get('benefit'));unit='bits' if 'information_gain_bits' in item or item.get('benefit_unit')=='bits' else 'expected error reduction';cost=item.get('relative_cost')
        out.append(Policy(name=labels.get(item['policy'],human(item['policy'])),check=human(item.get('check')) if item.get('check') else 'No feasible unasked check',benefit=benefit,benefit_unit=unit,benefit_display=number(benefit,3)+' '+unit if benefit is not None else 'Not available',relative_cost=cost,cost_display=number(cost,1) if cost is not None else 'Not available',status='Production' if item['policy']=='production_information_gain' else 'Experimental'))
    return out
