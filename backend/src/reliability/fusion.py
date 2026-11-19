"""System-specific shared/physics experts with explicit availability.

The structured and physical branches are correlated views of the same circuit
observations. This is not a claim of independent modalities or six-system paired
waveform validation. The retained ADC gate separately handles paired captures.
"""
import numpy as np
from ..config import load_config
from ..feature_engineering import extract_features
from ..closure.experts import expert_probabilities
SYSTEM_FEATURES={
 'ANALOG_ADC':('supply_ratio','output_signed_error','adc_signed_error','output_supply_ratio','continuity_status','configuration_status','noise_level'),
 'I2C_SENSOR':('supply_ratio','current_ratio','ack_observed','sda_activity','scl_activity','i2c_bus_activity','pullup_status','configuration_status','communication_response','noise_level','continuity_status'),
 'UART_DEVICE':('supply_ratio','current_ratio','baud_relative_error','tx_observed','rx_observed','uart_path_complete','configuration_status','communication_response','continuity_status','noise_level'),
 'PWM_MOTOR_SERVO':('supply_ratio','current_signed_error','output_signed_error','duty_signed_error','pwm_observed','continuity_status','configuration_status','noise_level'),
 'DIGITAL_INPUT':('supply_ratio','logic_ratio','logic_margin','pullup_status','signal_present','continuity_status','configuration_status','noise_level'),
 'LED_GPIO':('supply_ratio','current_signed_error','output_signed_error','output_supply_ratio','polarity_status','continuity_status','configuration_status','noise_level')}

def expert_input(system,measurements,structured,classes):
    f=extract_features(system,measurements);keys=SYSTEM_FEATURES[system];raw=np.asarray([f[k] for k in keys],np.float32);valid=np.isfinite(raw)
    rule,_=expert_probabilities(system,measurements,classes)
    physics=np.r_[np.nan_to_num(raw),valid.astype(np.float32),rule].astype(np.float32)
    shared=np.asarray([structured.get(k,0.) for k in classes],np.float32)
    # No synthetic waveform embedding is invented for these cases.
    present=np.asarray([bool(structured),bool(valid.any()),False],np.float32)
    quality=np.asarray([min(1.,len(measurements)/8) if present[0] else 0,float(valid.mean()),0],np.float32)
    return np.r_[shared,physics,np.zeros(48,np.float32)],present,quality
