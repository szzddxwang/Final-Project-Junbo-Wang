"""Research-only observable residuals for the existing paired RF experts.

Inputs are measurements, captured channels and declared configuration. This
module never accepts a case label, injected severity or generator metadata.
"""
from __future__ import annotations

import numpy as np
from scipy.ndimage import median_filter

from .features import physical_features, waveform_features

FEATURE_VERSION = "paired-observable-v4-residuals-20261026"


def _finite(value):
    return isinstance(value, (int, float, np.number)) and not isinstance(value, bool) and np.isfinite(value)


def physical_v4(system, measurements):
    """Preserve the original feature vector and append bounded dimensionless checks."""
    pairs = (("SUPPLY_VOLTAGE", "EXPECTED_SUPPLY_VOLTAGE"),
             ("OUTPUT_VOLTAGE", "EXPECTED_OUTPUT_VOLTAGE"),
             ("CURRENT", "EXPECTED_CURRENT"),
             ("ACTUAL_BAUD", "EXPECTED_BAUD"),
             ("DUTY_CYCLE", "EXPECTED_DUTY_CYCLE"))
    values, masks = [], []
    for measured, expected in pairs:
        a, b = measurements.get(measured), measurements.get(expected)
        valid = _finite(a) and _finite(b) and abs(b) > 1e-8
        values.append(float(np.clip(a / b - 1, -10, 10)) if valid else 0.)
        masks.append(float(valid))
    # Distinguish a low current explained by a low supply/output from a load anomaly.
    for a, b in ((2, 0), (2, 1), (1, 0)):
        values.append(values[a] - values[b] if masks[a] and masks[b] else 0.)
    return np.r_[physical_features(system, measurements), values, masks].astype(np.float32)


def _digital(line, vdd, window=3):
    smoothed = median_filter(np.asarray(line, float), size=window, mode="nearest")
    low, high = .3 * vdd, .7 * vdd
    result = np.empty(len(smoothed), bool)
    state = bool(smoothed[0] > .5 * vdd)
    for i, value in enumerate(smoothed):
        if value > high:
            state = True
        elif value < low:
            state = False
        result[i] = state
    return result, smoothed


def _plateau_noise(line, bits, scale, margin):
    edges = np.flatnonzero(np.diff(bits.astype(int))) + 1
    use = np.ones(len(line), bool)
    for edge in edges:
        use[max(0, edge-margin):min(len(line), edge+margin+1)] = False
    residual = []
    for level in (False, True):
        vals = np.asarray(line)[use & (bits == level)]
        if len(vals):
            residual.extend((vals - np.median(vals)).tolist())
    return float(np.sqrt(np.mean(np.square(residual))) / scale) if residual else 0.


def waveform_residuals(system, samples, configured):
    a = np.asarray(samples, float)
    if a.ndim != 2 or not 64 <= a.shape[1] <= 4096 or not np.isfinite(a).all():
        raise ValueError("Bounded finite observed channels required")
    vdd = float(configured.get("vdd", 3.3))
    if not np.isfinite(vdd) or vdd <= .1:
        raise ValueError("Positive configured voltage required")
    out = {}
    if system == "LED_GPIO":
        command, drive, current, forward = a
        on = command > .5*vdd
        if not on.any():
            raise ValueError("Commanded ON samples required")
        r = float(configured["series_resistance_ohm"])
        vf = float(configured["nominal_forward_voltage"])
        if r <= 0 or not np.isfinite(r+vf):
            raise ValueError("Valid LED reference required")
        active = on & (current > .00005) & (drive > forward+.05)
        effective_r = (drive[active]-forward[active])/current[active]
        predicted = np.maximum(drive-vf, 0)/r
        scale = max((vdd-vf)/r, .0001)
        out = {"forward_excess_v": float(np.median(forward[on])-vf),
               "resistance_ratio": float(np.median(effective_r)/r) if len(effective_r) else 0.,
               "resistance_valid": float(len(effective_r)>3),
               "current_vs_observed_drive": float(np.median((current-predicted)[on])/scale),
               "drive_tracking_error": float(np.mean(np.abs(drive-command))/vdd),
               "on_voltage_deficit": float(1-np.median(drive[on])/vdd)}
    elif system == "PWM_MOTOR_SERVO":
        command, drive, current, response = a
        speed = float(configured["nominal_speed"])
        nominal_i = float(configured["nominal_current"])
        if speed <= 0 or nominal_i <= 0:
            raise ValueError("Positive motor references required")
        y = response / speed
        u = np.clip(drive/vdd, 0, 1)
        # Identify response gain from measured motion and drive, allowing time constant variation.
        fit, *_ = np.linalg.lstsq(np.c_[y[:-1], u[1:], np.ones(len(y)-1)], y[1:], rcond=None)
        prediction = np.c_[y[:-1], u[1:], np.ones(len(y)-1)] @ fit
        gain = fit[1] / max(1-fit[0], .005)
        residual = drive/vdd - command/vdd
        out = {"identified_response_gain": float(np.clip(gain,-5,5)),
               "response_fit_error": float(np.sqrt(np.mean((prediction-y[1:])**2))),
               "drive_error_mean": float(np.mean(residual)),
               "drive_error_std": float(np.std(residual)),
               "current_per_drive": float(np.mean(current)/nominal_i/max(np.mean(u),.05)),
               "command_drive_agreement": float(np.mean((drive>.5*vdd)==(command>.5*vdd)))}
    elif system == "UART_DEVICE":
        command, tx, rx = a
        spp = float(configured["sample_rate_hz"])/float(configured["baud"])
        cb, _ = _digital(command, vdd)
        tb, _ = _digital(tx, vdd)
        rb, _ = _digital(rx, vdd)
        ce = np.flatnonzero(np.diff(cb.astype(int)))+1
        te = np.flatnonzero(np.diff(tb.astype(int)))+1
        valid = len(ce)==len(te) and len(ce)>=3
        slope, jitter = 1., 1.
        if valid:
            fit = np.polyfit(ce/spp, te/spp, 1)
            slope = float(fit[0])
            jitter = float(np.sqrt(np.mean((te/spp-np.polyval(fit,ce/spp))**2)))
        out = {"observed_timing_scale": slope, "timing_fit_valid":float(valid),
               "nonlinear_timing_jitter":jitter,
               "tx_plateau_noise":_plateau_noise(tx,tb,vdd,max(1,int(spp/6))),
               "rx_plateau_noise":_plateau_noise(rx,rb,vdd,max(1,int(spp/6))),
               "filtered_tx_rx_disagreement":float(np.mean(tb!=rb)),
               "rx_idle_end":float(np.median(rx[-max(3,int(spp*.6)):])/vdd)}
    elif system == "I2C_SENSOR":
        sda, scl = a
        spp = int(configured["samples_per_bit"])
        db, ds = _digital(sda, vdd)
        cb, cs = _digital(scl, vdd)
        rising = np.flatnonzero(~cb[:-1] & cb[1:])+1
        periods = np.diff(rising)/spp
        rises=[]
        for line in (ds,cs):
            for edge in np.flatnonzero((line[:-1]<.2*vdd)&(line[1:]>=.2*vdd)):
                later=np.flatnonzero(line[edge+1:min(len(line),edge+spp)]>=.8*vdd)
                if len(later): rises.append((later[0]+1)/spp)
        out = {"sda_plateau_noise":_plateau_noise(sda,db,vdd,max(1,spp//5)),
               "scl_plateau_noise":_plateau_noise(scl,cb,vdd,max(1,spp//5)),
               "filtered_rise_fraction":float(np.median(rises)) if rises else 0.,
               "filtered_clock_period":float(np.median(periods)) if len(periods) else 0.,
               "clock_period_jitter":float(np.std(periods)) if len(periods) else 0.,
               "clock_edge_count":float(len(rising)),
               "bus_high_level":float(np.quantile(a,.95)/vdd)}
    # Strong ADC and digital experts keep their existing descriptors; refitting
    # them still receives exactly the same declared observations as the baseline.
    return out


def waveform_v4(system, samples, configured):
    old = waveform_features(system, samples, configured)
    extra = np.asarray(list(waveform_residuals(system,samples,configured).values()),float)
    if not np.isfinite(extra).all():
        raise ValueError("Non-finite observable residual")
    return np.r_[old,np.clip(extra,-100,100)].astype(np.float32)
