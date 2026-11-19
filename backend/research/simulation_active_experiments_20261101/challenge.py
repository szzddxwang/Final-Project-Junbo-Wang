"""Optional independent fifth capture to challenge an already fitted model.

The four-capture recovery benchmark is untouched. A challenge tests extrapolation,
not parameter precision, and is never represented as an already measured result.
"""
import math
import numpy as np
from .circuits import predict,noise_sigma
from .engine import information,jacobian,validate_history

def propose(spec,history,assessment):
    validate_history(spec,history);z=np.asarray(assessment['normalized_estimate']);known={r.action_code for r in history}
    acquired=[a for a in spec.actions if a.code in known];candidates=[a for a in spec.actions if a.code not in known and not a.repeat_of]
    if not candidates:return None
    dimensional=max(len(a.controls) for a in spec.actions)
    control=np.array([list(a.controls)+[0]*(dimensional-len(a.controls)) for a in spec.actions],float)
    span=np.maximum(np.ptp(control,axis=0),1e-9);selected=[]
    for action in candidates:
        # Only compare controls of the same physical capture type. An I2C
        # resistor readback is not a time coordinate on an SDA trace.
        comparable=[a for a in acquired if len(a.controls)==len(action.controls)]
        if not comparable or not action.controls:continue
        distance=min(float(np.linalg.norm((np.asarray(action.controls)-a.controls)/span[:len(action.controls)])) for a in comparable)
        p=predict(spec,action,z);snr=min(float(np.linalg.norm(p/noise_sigma(spec,action,p))),20)
        selected.append((distance*snr/action.cost,action.code,action))
    if not selected:return None
    _,_,action=max(selected,key=lambda r:(r[0],r[1]))
    return dict(action=action,state='PROPOSED_NOT_RUN',observed_values=None,additional_capture_cost=action.cost,
                reason='Test the fitted model at a different operating condition before trusting its extrapolation.',
                stage='OPTIONAL_FIFTH_CAPTURE',future_readings_generated=False)

def assess(spec,history,estimate,proposal,observation):
    validate_history(spec,history+[observation])
    action=proposal['action']
    if observation.action_code!=action.code:raise ValueError('Unexpected challenge observation')
    z=np.asarray(estimate);predicted=predict(spec,action,z);j=jacobian(spec,action,z);info,rank,_=information(spec,history,z)
    if rank<len(z):return dict(status='INSUFFICIENT_IDENTIFIABILITY',root_fault=None)
    covariance=np.linalg.pinv(info,rcond=1e-10)
    sigma=np.sqrt(noise_sigma(spec,action,predicted)**2+np.maximum(np.diag(j@covariance@j.T),0))
    error=(np.array(observation.values)-predicted)/sigma
    mismatch=float(np.max(abs(error)))>4
    return dict(status='MODEL_INCONSISTENT' if mismatch else 'CONSISTENT_AT_TESTED_CONDITION',root_fault=None,
                standardized_error_max=float(np.max(abs(error))),predicted=predicted.tolist(),observed=list(observation.values),
                additional_actual_captures=1,classification_probability_changed=False,
                scope='Conditional virtual-model prediction check, not a guarantee over untested controls.')
