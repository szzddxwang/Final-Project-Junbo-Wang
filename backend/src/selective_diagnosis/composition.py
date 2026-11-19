"""Dimensionless, observation-only interaction features for coexisting faults.

No simulation parameters, injected labels, seed, family or provenance strings
are used. Ratios propagate absent / unresolvable denominators as NaN.
"""
import numpy as np
from src.reliable_diagnosis.features import NAMES

VERSION = 'observed-composition-v10-2'
BASE_COUNT = 562
DERIVED = ('terminal_per_supply', 'terminal_per_supply_command',
           'terminal_per_supply_duty', 'absolute_terminal_per_supply_duty',
           'drive_per_supply_command', 'node_per_drive',
           'wire_per_declared_load', 'load_voltage_per_amp',
           'adc_per_terminal_gain_reference', 'adc_gain_corrected_error',
           'response_per_command', 'current_per_supply',
           'noise_per_supply', 'duty_per_command',
           'frequency_deviation', 'baud_deviation', 'gain_deviation',
           'supply_deficit', 'wire_log', 'noise_excess')
EXTRA_NAMES = tuple(f'composition:{key}:{when}' for when in ('first','last') for key in DERIVED)
INDEX = {name:i for i,name in enumerate(NAMES)}

def enrich(features):
    """Accept the immutable 562 observed acceptance features, append 40 ratios."""
    x=np.asarray(features,dtype=np.float32)
    if x.ndim!=2 or x.shape[1]!=BASE_COUNT:
        raise ValueError('Expected the 562-feature observed acceptance vector')
    def col(name):return x[:,INDEX[name]]
    def div(a,b):
        result=np.full(len(x),np.nan,dtype=np.float32)
        np.divide(a,b,out=result,where=np.isfinite(a)&np.isfinite(b)&(np.abs(b)>1e-6))
        return result
    result=[]
    for when in ('first','last'):
        # A channel's first/last available observation can belong to a different
        # capture when a channel is absent. Never divide unmatched observations.
        q=lambda key:np.where(col(key+':count')==col('captures'),col(key+':'+when),np.nan)
        sup=q('supply_ratio');term=q('terminal_ratio');cmd=col(when+'_command')
        actual=q('driver_duty');actual=np.where(np.isfinite(actual),actual,q('duty_actual'))
        rail=col('declared:rail_v');gain=q('gain_readback');ref=q('reference_ratio')
        adc=q('adc_code_fraction');effective=div(term*gain,ref)
        result.extend((div(term,sup),div(term,sup*cmd),div(term,sup*actual),
            div(np.abs(term),sup*actual),div(q('drive_probe'),rail*sup*cmd),
            div(q('node_probe'),q('drive_probe')),div(q('wire_resistance'),col('declared:nominal_load_ohm')),
            div(q('node_probe'),q('current_probe')),div(adc,effective),adc-effective,
            div(q('response_ratio'),cmd),div(q('current_ratio'),sup),div(q('noise_fraction'),sup),
            div(q('duty_actual'),cmd),np.abs(q('frequency_ratio')-1),np.abs(q('baud_ratio')-1),
            np.abs(gain-1),1-sup,np.log1p(np.maximum(0,q('wire_resistance'))),q('noise_fraction')-.012))
    z=np.column_stack((x,*result)).astype(np.float32);z[~np.isfinite(z)]=np.nan
    return z
