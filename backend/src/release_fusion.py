"""Immutable, calibrated probability fusion for a validated six-system release.

The two fitted pipelines and their exact weights live in the versioned artifact.
No provider truth or synthetic measurements are generated during inference.
"""
import numpy as np

class ReleaseFusion:
    def __init__(self, incumbent, candidate, classes, allowed, temperatures, alpha):
        self.incumbent=incumbent
        self.candidate=candidate
        self.classes_=np.arange(len(classes))
        self.class_names=tuple(classes)
        self.allowed=allowed
        self.temperatures=dict(temperatures)
        self.alpha=dict(alpha) if isinstance(alpha,dict) else float(alpha)

    def predict_proba(self, frame):
        p=self.incumbent.predict_proba(frame)
        q=self.candidate.predict_proba(frame)
        for s in set(frame['system_type']):
            if s not in self.allowed: raise ValueError('Unsupported diagnostic system')
            ix=np.flatnonzero(frame['system_type'].to_numpy()==s)
            bad=[i for i,c in enumerate(self.class_names)if c not in self.allowed[s]]
            p[np.ix_(ix,bad)]=0;q[np.ix_(ix,bad)]=0
            p[ix]/=p[ix].sum(axis=1,keepdims=True)
            v=q[ix];v=np.where(v>0,np.exp(np.log(np.maximum(v,1e-30))/self.temperatures[s]),0)
            q[ix]=v/v.sum(axis=1,keepdims=True)
        weight=np.array([self.alpha[s] for s in frame['system_type']])[:,None] if isinstance(self.alpha,dict) else self.alpha
        return (1-weight)*p+weight*q

    def predict(self, frame):
        return self.predict_proba(frame).argmax(axis=1)
