"""Measured-only rich inference. Provider parameters cannot enter this module."""
import math
from typing import Literal
import numpy as np
import xgboost as xgb
from scipy.special import softmax
from pydantic import BaseModel, ConfigDict, Field, model_validator
from ..config import load_config
from . import capture_features as cf, instrument_features as inf

class EvidencePacket(BaseModel):
    model_config=ConfigDict(extra='forbid')
    schema_version:Literal['two-acquisition-v1']='two-acquisition-v1'
    source:Literal['CONTROLLED_SIMULATION']='CONTROLLED_SIMULATION'
    system:str
    measurements:dict=Field(default_factory=dict)
    observations:dict=Field(default_factory=dict)
    captures:list[dict]=Field(min_length=2,max_length=2)
    instruments:dict

    @model_validator(mode='after')
    def validate_packet(self):
        try:
            return self._validate_values()
        except (KeyError,TypeError,AttributeError,IndexError,OverflowError) as exc:
            raise ValueError('Malformed or incomplete acquisition evidence') from exc

    def _validate_values(self):
        systems=load_config('systems')
        if self.system not in systems:raise ValueError('Unsupported evidence system')
        if set(self.measurements)-set(systems[self.system]['available_measurements']):raise ValueError('Measurement belongs to a different system')
        for values in [self.measurements,self.observations]:
            for v in values.values():
                if isinstance(v,(int,float))and(not math.isfinite(v)or abs(v)>1e12):raise ValueError('Evidence must be finite and bounded')
        for capture in self.captures:cf.validate_capture(capture)
        inf.validate(self.instruments)
        if any(abs(v)>1e12 for v in self.instruments['channels'].values()):raise ValueError('Instrument outside numerical bounds')
        transient=self.instruments['transient']
        if transient and any(abs(v)>1e12 for v in transient['response_ratio']):raise ValueError('Transient outside numerical bounds')
        if self.instruments['system']!=self.system:raise ValueError('Cross-system instruments')
        if [c['action']for c in self.captures]!=['sweep','endpoint']:raise ValueError('First acquire a sweep; then an endpoint capture')
        if [c['command_fraction']for c in self.captures]!=[.15,.85]:raise ValueError('Unsupported stimulus schedule')
        if [c['time_s']for c in self.captures]!=[.12,2.]:raise ValueError('Unsupported capture schedule')
        for c in self.captures:
            if any(abs(v)>1e12 for v in c['channels'].values()):raise ValueError('Capture outside numerical bounds')
        cf.raw([self.row()],[self.captures])
        inf.raw_instruments([self.instruments])
        return self

    def row(self):return dict(system=self.system,measurements=self.measurements,observations=self.observations)

def features(packet):
    p=packet if isinstance(packet,EvidencePacket)else EvidencePacket.model_validate(packet)
    values,fit=inf.infer(p.instruments)
    x=np.c_[cf.raw([p.row()],[p.captures]),inf.raw_instruments([p.instruments]),inf.physics_features([values])]
    if x.shape!=(1,383):raise ValueError('Incompatible measured feature version')
    return p,x,values,fit

def infer(packet, artifact):
    if 'diagnostic_upgrade' in artifact:
        from ..diagnostic_upgrade.runtime import infer as upgraded_infer
        return upgraded_infer(packet,artifact)
    if 'composition_model' in artifact:
        from ..selective_diagnosis.runtime_v10 import infer as composition_infer
        return composition_infer(packet,artifact)
    if 'selective_model' in artifact:
        if artifact['selective_model'].get('preserve_reviewed_normal'):
            from ..selective_diagnosis.runtime_v8 import infer as guarded_infer
            return guarded_infer(packet, artifact)
        from ..selective_diagnosis.runtime import infer as selective_infer
        return selective_infer(packet, artifact)
    if 'reliability_model'in artifact:
        from ..reliable_diagnosis.runtime import infer as reliable_infer
        return reliable_infer(packet,artifact)
    p,x,values,fit=features(packet)
    head=artifact.get('paired_model')
    if head is None:raise ValueError('This historical model does not support two-acquisition evidence')
    model=head['models'][p.system]
    scores=softmax(model.predict(xgb.DMatrix(x),output_margin=True),axis=1)[0]
    allowed=load_config('systems')[p.system]['applicable_faults']
    scores=np.array([v if c in allowed else 0. for c,v in zip(head['classes'],scores)],dtype=np.float64)
    scores=np.where(scores>0,np.maximum(scores,1e-30)**(1/head['temperatures'][p.system]),0)
    scores/=scores.sum()
    ranking=sorted([dict(fault=c,probability=float(v))for c,v in zip(head['classes'],scores)if c in allowed],key=lambda r:-r['probability'])
    # A model score is not proof of a unique physical root cause.
    missing_capture=any(not c['channels']for c in p.captures)
    review=missing_capture or ranking[0]['probability']<.9 or ranking[0]['probability']-ranking[1]['probability']<.2
    return dict(diagnosis=ranking,confidence=ranking[0]['probability'],status='REVIEW_ALTERNATIVES'if review else 'SUPPORTED_SIMULATION_HYPOTHESIS',
                source=p.source,feature_count=383,captures_used=2,scheduled_samples_per_capture=64,
                physical_estimates=[float(v)if np.isfinite(v)else None for v in values],fit=fit,
                evidence_sha256=cf.digest(p.model_dump()),capture_dropout=missing_capture,
                unknown_or_mixed_fault_not_excluded=True,hardware_validated=False)
