"""Versioned observed-evidence classifiers, with calibrated probabilities."""
import numpy as np
import xgboost as xgb
from scipy.special import softmax

def probabilities(model,x,kind,classes):
    if kind=='xgboost':return softmax(model.predict(xgb.DMatrix(x),output_margin=True),axis=1)
    p=model.predict_proba(x);full=np.zeros((len(x),len(classes)));full[:,model.classes_.astype(int)]=p;return full

def calibrate(p,temperature,allowed):
    p=np.asarray(p,float).copy();p[:,~np.asarray(allowed,dtype=bool)]=0
    p=np.where(p>0,np.maximum(p,1e-30)**(1/temperature),0)
    return p/np.maximum(p.sum(axis=1,keepdims=True),1e-30)

class DiagnosticPipeline:
    def __init__(self,preprocessor,model,kind,classes,allowed,temperatures):
        self.preprocessor=preprocessor;self.model=model;self.kind=kind;self.class_names=list(classes);self.allowed=allowed;self.temperatures=temperatures;self.classes_=np.arange(len(classes))
    def predict_proba(self,frame):
        x=self.preprocessor.transform(frame);p=probabilities(self.model,x,self.kind,self.class_names)
        for s in set(frame.system_type):
            ix=np.flatnonzero(frame.system_type.to_numpy()==s)
            p[ix]=calibrate(p[ix],self.temperatures[s],[c in self.allowed[s] for c in self.class_names])
        return p
    def predict(self,frame):return self.predict_proba(frame).argmax(axis=1)

def evidence_probabilities(head,x,systems):
    out=np.zeros((len(x),len(head['classes'])))
    for s in set(systems):
        ix=np.flatnonzero(np.asarray(systems)==s);m=head['models'][s]
        p=probabilities(m,x[ix],head['kinds'][s],head['classes'])
        out[ix]=calibrate(p,head['temperatures'][s],[c in head['allowed'][s] for c in head['classes']])
    return out
