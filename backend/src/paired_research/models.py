"""Reliability-gated convex combination of independently fitted branches."""
import numpy as np
from scipy.special import softmax
from scipy.optimize import minimize

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

def fit_gate(probabilities,quality,labels):
    """Fit on disjoint gate-training groups and all nonempty modality masks."""
    n=len(labels);patterns=np.asarray([[1,1,1],[1,1,0],[1,0,1],[0,1,1],[1,0,0],[0,1,0],[0,0,1]],bool)
    p=np.tile(probabilities,(len(patterns),1,1));q=np.tile(quality,(len(patterns),1));y=np.tile(labels,len(patterns));m=np.repeat(patterns,n,axis=0)
    def loss(flat):
        pred,_=combine(p,q,m,flat.reshape(3,5))
        return -np.log(np.maximum(pred[np.arange(len(y)),y],1e-8)).mean()+.003*np.square(flat).sum()
    fitted=minimize(loss,np.zeros(15),method='L-BFGS-B',options={'maxiter':150})
    return fitted.x.reshape(3,5),{'loss':float(fitted.fun),'iterations':int(fitted.nit),'success':bool(fitted.success),'message':str(fitted.message)}

def aligned_probability(model,x,classes):
    raw=model.predict_proba(x);p=np.zeros((len(x),len(classes)))
    for j,k in enumerate(model.classes_):p[:,int(k)]=raw[:,j]
    return p
