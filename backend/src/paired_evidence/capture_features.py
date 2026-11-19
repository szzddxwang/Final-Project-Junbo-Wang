"""Observable-only feature contract. No simulation or training imports."""
import math,hashlib,json
import numpy as np
from ..config import load_config
SYSTEMS=load_config("systems")
VERSION='shared-measured-channels-v3-20261106'
ACTIONS={'repeat': 1.0, 'sweep': 1.15, 'endpoint': 1.3}
UNITS={'supply_ratio': 'ratio', 'terminal_ratio': 'ratio', 'response_ratio': 'ratio', 'current_ratio': 'ratio', 'adc_residual': 'ratio', 'reference_ratio': 'ratio', 'gain_readback': 'ratio', 'bits_ratio': 'ratio', 'bias_readback': 'ratio', 'mode_readback': 'ratio', 'address_difference': 'ratio', 'ack_fraction': 'ratio', 'frame_error': 'ratio', 'baud_ratio': 'ratio', 'frequency_ratio': 'ratio', 'duty_error': 'ratio', 'load_gain': 'ratio', 'wire_resistance': 'ohm', 'polarity_voltage': 'ratio', 'noise_fraction': 'ratio', 'rc_time_us': 'us', 'pullup_readback_kohm': 'kohm', 'waveform_rms_fraction': 'ratio', 'logic_high_ratio': 'ratio'}
PRIVATE={'truth', 'severity', 'cause', 'parameters', 'device', 'seed', 'case_id', 'regime', 'condition', 'group', 'fault'}
INITIAL_KEYS=['ACK_RECEIVED', 'ACTUAL_BAUD', 'ADC_READING', 'ADC_REFERENCE', 'COMMUNICATION_SUCCESS', 'CONTINUITY', 'CURRENT', 'DUTY_CYCLE', 'EXPECTED_ADC_READING', 'EXPECTED_BAUD', 'EXPECTED_CURRENT', 'EXPECTED_DUTY_CYCLE', 'EXPECTED_LOGIC_LEVEL', 'EXPECTED_OUTPUT_VOLTAGE', 'EXPECTED_SUPPLY_VOLTAGE', 'LOGIC_LEVEL', 'NOISE_LEVEL', 'OUTPUT_VOLTAGE', 'POLARITY_OK', 'PULLUP_PRESENT', 'PWM_PRESENT', 'RX_SIGNAL_PRESENT', 'SCL_STATE', 'SDA_STATE', 'SIGNAL_PRESENT', 'SUPPLY_VOLTAGE', 'TX_SIGNAL_PRESENT']
EXTRA_KEYS=['ADC_BITS_READBACK', 'ADC_GAIN_READBACK', 'ADC_PIN_VOLTAGE', 'ADC_VREF_MEASURED', 'GPIO_MODE_READBACK', 'I2C_ACK_FRACTION', 'I2C_ADDRESS_READBACK', 'I2C_CONFIGURED_ADDRESS', 'I2C_OBSERVED_ADDRESS', 'INPUT_BIAS_READBACK', 'INPUT_PIN_VOLTAGE', 'LOAD_PIN_VOLTAGE', 'PWM_DRIVER_DUTY', 'PWM_DRIVER_HZ', 'PWM_LOAD_RESPONSE', 'UART_BAUD_READBACK', 'UART_ENDPOINT_CONTINUITY', 'UART_FRAME_ERROR_RATE']
CHANNELS=['supply_ratio', 'terminal_ratio', 'response_ratio', 'current_ratio', 'adc_residual', 'reference_ratio', 'gain_readback', 'bits_ratio', 'bias_readback', 'mode_readback', 'address_difference', 'ack_fraction', 'frame_error', 'baud_ratio', 'frequency_ratio', 'duty_error', 'load_gain', 'wire_resistance', 'polarity_voltage', 'noise_fraction', 'rc_time_us', 'pullup_readback_kohm', 'waveform_rms_fraction', 'logic_high_ratio']

def digest(obj):return hashlib.sha256(json.dumps(obj,sort_keys=True,allow_nan=False).encode()).hexdigest()

def validate_capture(c):
    required={'action','capture_index','command_fraction','channels','lineage','units','samples','virtual_only','executed','time_s'}
    if not isinstance(c,dict)or set(c)!=required:raise ValueError('Incomplete capture or unexpected member')
    if set(c)-{'action','capture_index','command_fraction','channels','lineage','units','samples','virtual_only','executed','time_s'}:raise ValueError('Unrecognized or private capture member')
    if c['action']not in ACTIONS or c['executed']is not True or c['virtual_only']is not True:raise ValueError('Executed virtual capture required')
    if c['samples']!=64 or c['capture_index']not in [1,2]:raise ValueError('Wrong capture budget')
    if not all(isinstance(c[k],(int,float))and math.isfinite(c[k])for k in ['command_fraction','time_s'])or not 0<=c['command_fraction']<=1 or c['time_s']<0:raise ValueError('Invalid experiment condition/time')
    if set(c['channels'])!=set(c['lineage'])or set(c['channels'])!=set(c['units']):raise ValueError('Measurement lineage/units incomplete')
    for k,x in c['channels'].items():
        if k not in UNITS or isinstance(x,bool)or not isinstance(x,(int,float))or not math.isfinite(x):raise ValueError('Unknown/nonfinite channel')
        if c['units'][k]!=UNITS[k]or not c['lineage'][k].startswith(('meter:','readback:','waveform:','derived:')):raise ValueError('Channel is not measured')
        if k=='adc_residual'and c['lineage'][k]!='derived:actual_adc_code,measured_pin,measured_vref,registers':raise ValueError('ADC oracle residual forbidden')
    return c

def numeric(value):
    if isinstance(value,(int,float,bool))and math.isfinite(float(value)):
        value=float(value);return float(np.sign(value)*np.log1p(abs(value)))
    if value in ['Low','High','Toggling','Floating']:return float(['Low','High','Toggling','Floating'].index(value))
    if value is None:return np.nan
    raise ValueError('Unsupported measurement value')

def _initial(row):
    if row['system']not in SYSTEMS:raise ValueError('Unknown system')
    m=row['measurements'];o=row['observations']
    if set(m)-set(INITIAL_KEYS)or set(o)-set(EXTRA_KEYS):raise ValueError('Unknown/private measurement')
    values=[float(row['system']==s)for s in SYSTEMS]
    for dictionary,keys in [(m,INITIAL_KEYS),(o,EXTRA_KEYS)]:
        for key in keys:values.extend([numeric(dictionary.get(key)),float(key in dictionary)])
    return values

def initial(rows):return np.asarray([_initial(r)for r in rows],np.float32)

def raw(rows,caps):
    if len(rows)!=len(caps):raise ValueError('Mismatched observations')
    for pair in caps:
        if len(pair)!=2:raise ValueError('No imputed second reading')
        for c in pair:validate_capture(c)
        if [c['capture_index']for c in pair]!=[1,2]:raise ValueError('Duplicate or out-of-order captures')
    output=[]
    for row,pair in zip(rows,caps):
        values=_initial(row)
        for key in CHANNELS:
            a,z=[c['channels'].get(key,np.nan)for c in pair]
            values.extend([a,z,float(np.isfinite(a)),float(np.isfinite(z)),z-a if np.isfinite(a)and np.isfinite(z)else np.nan])
        values.extend([float(pair[0]['action']==a)for a in ACTIONS])
        values.extend([pair[0]['command_fraction'],pair[1]['command_fraction'],pair[0]['time_s'],pair[1]['time_s']])
        output.append(values)
    return np.asarray(output,np.float32)
