"""Runtime adapters for the advanced parameter experiment."""
from dataclasses import replace
import numpy as np
from research.simulation_active_experiments_20261101.circuits import VirtualDevice,predict

class LEDWorld(VirtualDevice):
    def __init__(self,seed,g,profile):
        super().__init__('LED_GPIO',seed,g);self.profile=profile;self.limit=np.random.default_rng(self.seed+31).uniform(1.8,4.8)
    def run(self,a):
        obs=super().run(a);mean=predict(self.spec,a,self._z);delta=0.
        if self.profile=='current_limit':delta=np.minimum(mean,self.limit)-mean
        elif self.profile=='soft_limit':delta=self.limit*np.tanh(mean/self.limit)-mean
        elif self.profile=='load_leakage':delta=.8*max(a.controls[0]-1.3,0)**2
        new=replace(obs,values=tuple(np.asarray(obs.values)+delta));self.history[-1]=new;return new

def canonical(spec,history):
    m={'SUPPLY_VOLTAGE':3.3,'EXPECTED_SUPPLY_VOLTAGE':3.3}
    if not history:return m
    row=history[-1];a=next(a for a in spec.actions if a.code==row.action_code);u=a.controls;y=row.values
    if spec.system=='ANALOG_ADC':m.update(OUTPUT_VOLTAGE=3.3*u[0],EXPECTED_OUTPUT_VOLTAGE=3.3*u[0],ADC_READING=y[0]*4096,EXPECTED_ADC_READING=u[0]*4096,ADC_REFERENCE=3.3)
    elif spec.system=='DIGITAL_INPUT':m.update(OUTPUT_VOLTAGE=3.3*u[0],EXPECTED_OUTPUT_VOLTAGE=3.3*u[0],LOGIC_LEVEL=y[0]>=.5,EXPECTED_LOGIC_LEVEL=u[0]>=.5)
    elif spec.system=='LED_GPIO':m.update(SUPPLY_VOLTAGE=u[0],EXPECTED_SUPPLY_VOLTAGE=u[0],CURRENT=max(y[0],0)/1000,EXPECTED_CURRENT=max(u[0]-1.95,0)/310)
    # Transient SDA samples are not silently mapped to DC voltage/ACK. UART
    # timing is not a fabricated communication-success flag. Preserve missingness.
    return m

def baseline(spec,history):
    from src.diagnosis_engine import predict_probabilities
    ranked=predict_probabilities(spec.system,'INCORRECT_OUTPUT',canonical(spec,history));classes=['Normal','PowerSupplyFault','WiringFault','VoltageLevelFault','PolarityFault','ConfigurationFault','CommunicationFault','ComponentFailure','SignalIntegrityFault']
    probs={r['fault']:r['probability'] for r in ranked}
    return [probs.get(c,0.) for c in classes]
