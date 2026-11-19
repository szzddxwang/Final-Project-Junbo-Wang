"""Independent XGBoost production inference; contains no incumbent estimator."""
import numpy as np
import xgboost as xgb
from scipy.special import softmax

class IndependentDiagnosticPipeline:
    def __init__(self, preprocessor, booster, classes, allowed):
        self.preprocessor=preprocessor
        self.booster=booster
        self.class_names=tuple(classes)
        self.classes_=np.arange(len(classes))
        self.allowed=allowed

    def predict_proba(self, frame):
        x=self.preprocessor.transform(frame)
        p=softmax(self.booster.predict(xgb.DMatrix(x),output_margin=True),axis=1)
        for s in set(frame['system_type']):
            if s not in self.allowed:raise ValueError('Unsupported diagnostic system')
            ix=np.flatnonzero(frame['system_type'].to_numpy()==s)
            bad=[i for i,c in enumerate(self.class_names)if c not in self.allowed[s]]
            p[np.ix_(ix,bad)]=0
        return p/p.sum(axis=1,keepdims=True)

    def predict(self, frame):
        return self.predict_proba(frame).argmax(axis=1)
