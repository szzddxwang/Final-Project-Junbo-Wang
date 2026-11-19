"""Reliability-gated convex combination of independently fitted branches."""
import numpy as np
from scipy.special import softmax

def gate_inputs(probabilities,quality):
    p=np.clip(np.asarray(probabilities),1e-8,1);confidence=p.max(2)
    entropy=-np.sum(p*np.log(p),axis=2)/np.log(p.shape[2])
    agreement=np.sum(p*p.mean(1,keepdims=True),axis=2)
    return np.stack((np.ones_like(confidence),quality,confidence,1-entropy,agreement),axis=2)

def combine(probabilities,quality,mask,weights):
    p=np.asarray(probabilities);mask=np.asarray(mask,bool)
    if np.any(mask.sum(1)==0):raise ValueError('At least one observed modality is required')
    z=np.sum(gate_inputs(p,quality)*np.asarray(weights)[None,:,:],axis=2)
    z=np.where(mask,z,-1e6);w=softmax(z,axis=1)
    result=np.sum(w[:,:,None]*p,axis=1)
    return result/result.sum(1,keepdims=True),w


def aligned_probability(model,x,classes):
    raw=model.predict_proba(x);p=np.zeros((len(x),len(classes)))
    for j,k in enumerate(model.classes_):p[:,int(k)]=raw[:,j]
    return p
