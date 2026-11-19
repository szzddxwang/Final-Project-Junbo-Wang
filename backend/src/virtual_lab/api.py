"""Experimental virtual lab API kept separate from stable /diagnose."""

import json
from functools import lru_cache
from pathlib import Path

import joblib
import numpy as np
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, PlainTextResponse

from ..config import ROOT
from ..config import load_config
from ..closure.experts import EXPERT_REGISTRY, expert_probabilities
from ..diagnosis_engine import diagnose
from ..schemas import DiagnosisRequest
from ..model_identity import stable_model_version
from ..physics_features import adc_physics
from ..waveform.features import signal_features
from ..waveform.inference import predict
from ..waveform.preprocessing import PreprocessingConfig, prepare
from ..waveform.research import PHYSICS_NAMES, structured_features
from .adc_model import compare_adc, estimate_reference, simulate_adc
from .mcu import simulate_gpio, simulate_i2c, simulate_pwm
from .schemas import (ADCModelRequest, ADCEstimateRequest, CounterfactualRequest,
                      GeneratedWaveformRequest,
                      GPIORequest, I2CRequest, MultimodalRequest, PWMRequest,
                      SensorAnalyzeRequest, SensorRequest, WaveformAnalyzeRequest)
from .sensor import analyze_sensor, simulate_sensor
from .runtime import STATUS as PRELOAD_STATUS

router = APIRouter(prefix="/ai", tags=["AI Electronics Lab — Experimental"])
EXPERIMENTAL = ROOT / "models" / "experimental"
WEB = Path(__file__).parent / "web"


def _plotly_traces(time_s, channels):
    """Bounded Plotly data from simulated samples, with no browser-side API call."""
    # Preserve the first and last sample while bounding the Mendix session
    # attribute and browser chart payload for long simulations.
    sample_count = len(time_s)
    stride = max(1, (sample_count - 1 + 510) // 511)
    indices = list(range(0, sample_count, stride))
    if indices[-1] != sample_count - 1:
        indices.append(sample_count - 1)
    return PlainTextResponse(json.dumps([
        {"type": "scatter", "mode": "lines", "name": name,
         "x": [time_s[i] for i in indices], "y": [values[i] for i in indices],
         "line": {"shape": "hv" if digital else "linear"}}
        for name, values, digital in channels
    ], allow_nan=False))


@lru_cache(maxsize=1)
def _fusion_artifact(path: str):
    return joblib.load(path)


@router.get("/lab", include_in_schema=False)
def lab_page():
    return FileResponse(WEB / "lab.html")


@router.get("/topics", include_in_schema=False)
def topics_page():
    return FileResponse(WEB / "topics.html")


@router.get("/topics/catalog")
def topics_catalog():
    return json.loads((WEB / "topics.json").read_text(encoding="utf-8"))


@router.get("/models/status")
def models_status():
    from ..midterm.inference import status as midterm_status
    return {"production_model_version": stable_model_version(),
            "midterm_models": midterm_status(),
            "waveform_adc": (EXPERIMENTAL / "waveform" / "adc" / "cnn.pt").is_file(),
            "waveform_i2c": (EXPERIMENTAL / "waveform" / "i2c" / "cnn.pt").is_file(),
            "sensor_anomaly": (EXPERIMENTAL / "sensor_isolation.joblib").is_file(),
            "data_source": "PYTHON_SIMULATION",
            "startup_preload": PRELOAD_STATUS}


@router.post("/troubleshooting/engineering")
def engineering_evidence(request: DiagnosisRequest):
    """Show six-system experimental rule evidence beside the stable diagnosis."""
    classes = load_config("systems")[request.system_type]["applicable_faults"]
    try:
        probabilities, findings = expert_probabilities(
            request.system_type, request.measurements, classes)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"stable_diagnosis": diagnose(request).model_dump(),
            "experimental_engineering": {
                "system_type": request.system_type,
                "basis": EXPERT_REGISTRY[request.system_type]["basis"],
                "findings": findings,
                "rule_scores": {fault: float(score) for fault, score in zip(classes, probabilities)},
                "promotion_status": "RESEARCH_ONLY_HARD_BENCHMARK_GATE_NOT_PASSED",
                "expert_design": "HAND_ENGINEERED_RULES",
                "evaluation_source": "PYTHON_SIMULATION"}}


@router.post("/device/adc/model")
def adc_model(request: ADCModelRequest, http_request: Request):
    result = simulate_adc(request)
    if http_request.headers.get("accept", "").split(",", 1)[0].strip() == "text/adc-pin-voltage":
        # Scalar projection of the same seeded sample used by the JSON response.
        # Native Mendix parses this as Decimal, never from a human-readable label.
        return PlainTextResponse(str(result["diagnosis_evidence"]["measurements"]["ADC_INPUT_VOLTAGE"]))
    if http_request.headers.get("accept", "").split(",", 1)[0].strip() == "text/plotly":
        chart = result["chart"]
        return _plotly_traces(chart["time_s"], [
            ("Analog input (V)", chart["pin_v"], False),
            ("ADC reconstructed (V)", chart["adc_reconstructed_v"], True),
        ])
    # Mendix can consume the same validated calculation as a bounded, readable
    # string while the normal JSON contract remains unchanged for other clients.
    if http_request.headers.get("accept", "").split(",", 1)[0].strip() == "text/plain":
        lines = [
            "Simulation only — deterministic ADC physics",
            f"Expected count: {result['expected_count']} count",
            f"Simulated count: {result['simulated_count']} count",
            f"Residual: {result['count_residual']} count",
            f"Quantization step: {result['quantization_step_v']:.6f} V/count",
            f"Saturation: {'yes' if result['saturation'] else 'no'}",
            f"Reference difference: {result['reference_difference_v']:+.4f} V",
            f"Engineering finding: {result['model_status'].replace('_', ' ').title()}",
        ]
        return PlainTextResponse("\n".join(lines))
    return result


@router.post("/device/adc/estimate")
def adc_estimate(request: ADCEstimateRequest, http_request: Request):
    result = estimate_reference(request)
    if http_request.headers.get("accept", "").split(",", 1)[0].strip() == "text/plain":
        lines = ["Reference voltage estimation — analytical quantization inverse",
                 "Source: simulated same-sample ADC pin voltage and count",
                 f"Status: {result['status']}"]
        if result["estimate_v"] is not None:
            estimate = result["estimate_v"]
            lower, upper = result["interval_v"]
            predicted = int(np.floor(request.input_voltage / estimate * (1 << request.resolution_bits)))
            lines.extend([f"Estimated reference: {estimate:.9g} V",
                          f"Valid interval: ({lower:.9g}, {upper:.9g}] V",
                          f"Residual: {request.observed_count - predicted} counts"])
        else:
            lines.append("Estimate and residual unavailable at a boundary count; no zero substituted.")
        lines.append("Assumptions: " + result["assumptions"])
        return PlainTextResponse("\n".join(lines))
    return result


@router.post("/device/adc/counterfactual")
def adc_counterfactual(request: CounterfactualRequest, http_request: Request):
    result = compare_adc(request.before, request.after)
    if http_request.headers.get("accept", "").split(",", 1)[0].strip() == "text/plain":
        return PlainTextResponse("\n".join([
            "Counterfactual — deterministic simulation only",
            f"Original reference: {request.before.reference_voltage:g} V; proposed reference: {request.after.reference_voltage:g} V",
            f"Original resolution: {request.before.resolution_bits} bits; proposed resolution: {request.after.resolution_bits} bits",
            f"Before: {result['before']['simulated_count']} counts; residual {result['before']['count_residual']} counts",
            f"After: {result['after']['simulated_count']} counts; residual {result['after']['count_residual']} counts",
            f"Absolute residual improvement: {result['absolute_residual_improvement']} counts",
            "A predicted improvement is not a verified repair. Run the corrected simulation to generate new retest evidence.",
        ]))
    return result


@router.post("/sensor/simulate")
def sensor_simulate(request: SensorRequest, http_request: Request):
    result = simulate_sensor(request)
    if http_request.headers.get("accept", "").split(",", 1)[0].strip() == "text/plotly":
        return _plotly_traces(result["time_s"], [
            ("Ideal (degC)", result["ideal"], False),
            ("Measured (degC)", result["measured"], False),
        ])
    if http_request.headers.get("accept", "").split(",", 1)[0].strip() == "text/plain":
        analysis = analyze_sensor(
            SensorAnalyzeRequest(ideal=result["ideal"], measured=result["measured"],
                                 sample_rate_hz=result["sample_rate_hz"],
                                 data_source="PYTHON_SIMULATION"),
            EXPERIMENTAL / "sensor_isolation.joblib")
        features = analysis["features"]
        return PlainTextResponse("\n".join([
            "Simulation Results — Simulation only — virtual temperature sensor",
            f"Samples: {len(result['ideal'])} at {result['sample_rate_hz']:g} Hz",
            f"Ideal final value: {result['ideal'][-1]:.3f} degC",
            f"Measured mean: {features['mean']:.3f} degC",
            f"Residual RMS: {features['residual_rms']:.3f} degC",
            f"Dropout fraction: {features['dropout_fraction']:.3f}",
            f"Rule-based pattern: {analysis['engineering_pattern']}",
            "AI baseline — actual trained Isolation Forest (use Compare Methods for temporal AI)",
            f"IsolationForest anomaly status: {analysis['anomaly_status']}",
            f"Anomaly score: {analysis['anomaly_score']:.4f} (not a probability)",
        ]))
    return result


@router.post("/sensor/analyze")
def sensor_analyze(request: SensorAnalyzeRequest):
    try:
        return analyze_sensor(request, EXPERIMENTAL / "sensor_isolation.joblib")
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/waveform/analyze")
def waveform_analyze(request: WaveformAnalyzeRequest):
    from ..midterm.inference import infer_temporal
    from ..midterm.api import safe
    temporal = safe(infer_temporal, request.samples,
                    {"SENSOR":"sensor", "ANALOG_ADC":"adc", "I2C_SENSOR":"i2c"}[request.system_type],
                    request.sampling_rate_hz, request.data_source)
    if request.system_type == "SENSOR":
        # The trained sensor anomaly detector consumes ideal and measured
        # channels.  Its score is not a calibrated fault probability.
        analysis = analyze_sensor(
            SensorAnalyzeRequest(ideal=request.samples[0],
                                 measured=request.samples[1],
                                 sample_rate_hz=request.sampling_rate_hz,
                                 data_source=request.data_source),
            EXPERIMENTAL / "sensor_isolation.joblib")
        return {"data_source": request.data_source, "new_temporal_model": temporal,
                "model_training_source": "PYTHON_SIMULATION",
                "system_type": "SENSOR",
                "signal_features": signal_features(
                    request.samples[1], request.sampling_rate_hz, "SENSOR"),
                "waveform_model": {
                    "model": "experimental_isolation_forest",
                    "predicted_pattern": analysis["engineering_pattern"],
                    "pattern_source": "DETERMINISTIC_ENGINEERING",
                    "anomaly_score": analysis["anomaly_score"],
                    "anomaly_status": analysis["anomaly_status"],
                    "probabilities": None,
                    "probability_note": "Anomaly score is not a calibrated root-cause probability"}}
    model_name = "adc" if request.system_type == "ANALOG_ADC" else "i2c"
    model_path = EXPERIMENTAL / "waveform" / model_name / "cnn.pt"
    signal = request.samples[1] if model_name == "adc" else request.samples[2]
    signal_type = "ADC" if model_name == "adc" else "I2C"
    try:
        ml = predict(request.samples, request.system_type, model_path,
                     ROOT / "results" / "next_week_ai_round")
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"data_source": request.data_source, "model_training_source": "PYTHON_SIMULATION", "new_temporal_model": temporal,
            "system_type": request.system_type,
            "signal_features": signal_features(signal, request.sampling_rate_hz, signal_type),
            "waveform_model": ml}


@router.post("/waveform/generate-analyze")
def waveform_generate_analyze(request: GeneratedWaveformRequest, http_request: Request):
    """Generate a verified virtual source, then run the existing analyzer."""
    if request.source == "ANALOG_ADC":
        generated = simulate_adc(ADCModelRequest())
        samples = [generated["chart"][key] for key in
                   ("commanded_v", "pin_v", "adc_reconstructed_v")]
        sample_rate = 1024.0
    elif request.source == "SENSOR":
        generated = simulate_sensor(SensorRequest())
        samples = [generated["ideal"], generated["measured"]]
        sample_rate = generated["sample_rate_hz"]
    else:
        generated = simulate_i2c(I2CRequest())
        samples = [generated[key] for key in ("ideal_sda", "ideal_scl", "sda", "scl")]
        sample_rate = generated["metadata"]["sampling_rate"]
    analysis = waveform_analyze(WaveformAnalyzeRequest(
        system_type=request.source, samples=samples,
        sampling_rate_hz=sample_rate, data_source="PYTHON_SIMULATION"))
    if http_request.headers.get("accept", "").split(",", 1)[0].strip() == "text/plotly":
        names = {"ANALOG_ADC": ("Commanded (V)", "Pin (V)", "Reconstructed (V)"),
                 "SENSOR": ("Ideal (degC)", "Measured (degC)"),
                 "I2C_SENSOR": ("Ideal SDA", "Ideal SCL", "SDA", "SCL")}[request.source]
        time_s = [index / sample_rate for index in range(len(samples[0]))]
        digital = request.source == "I2C_SENSOR"
        return _plotly_traces(time_s, [(name, signal, digital)
                                       for name, signal in zip(names, samples)])
    if http_request.headers.get("accept", "").split(",", 1)[0].strip() == "text/plain":
        features = analysis["signal_features"]
        model = analysis["new_temporal_model"] if "predicted_pattern" in analysis["new_temporal_model"] else analysis["waveform_model"]
        lines = [
            "Simulation only — generated waveform AI analysis",
            f"Source: {request.source}",
            f"Samples: {len(samples[0])} at {sample_rate:g} Hz",
            f"Mean: {features['mean']:.4f}",
            f"RMS: {features['rms']:.4f}",
            f"Peak-to-peak: {features['peak_to_peak']:.4f}",
            f"Predicted signal pattern: {model['predicted_pattern']}",
            f"Model version: {model.get('model_version', 'original experimental baseline')}",
            f"Pattern probability: {max(model.get('probabilities', {}).values(), default=0):.1%}",
            "Experimental — trained on simulation; waveform patterns are not root faults.",
            f"Invocation: {model.get('invocation_id', 'baseline')}",
            model.get('calibration_scope', 'Uncalibrated anomaly detector'),
        ]
        if "anomaly_score" in model:
            lines.append(f"Anomaly score: {model['anomaly_score']:.4f} (not a probability)")
        if "dominant_frequency_hz" in features:
            lines.append(f"Dominant frequency: {features['dominant_frequency_hz']:.2f} Hz")
        return PlainTextResponse("\n".join(lines))
    return {"source": request.source, "sampling_rate_hz": sample_rate,
            "samples": samples, "analysis": analysis,
            "data_source": "PYTHON_SIMULATION"}


@router.post("/troubleshooting/multimodal")
def multimodal(request: MultimodalRequest):
    """Keep stable diagnosis and experimental waveform labels visibly separate."""
    result = {
        "modality_presence": {"stable_structured": request.diagnosis is not None,
                              "waveform": request.waveform is not None,
                              "adc_physics": request.adc_observations is not None},
        "stable_diagnosis": None, "waveform_analysis": None,
        "physics_features": None, "experimental_simulation_fusion": None,
        "fusion_scope": "ADC simulation pattern labels only; production fault ontology is separate",
    }
    if request.diagnosis is not None:
        result["stable_diagnosis"] = diagnose(request.diagnosis).model_dump()
    physics = None
    if request.adc_observations is not None:
        try:
            physics = adc_physics(request.adc_observations)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        result["physics_features"] = physics
    if request.waveform is not None:
        analysis = waveform_analyze(request.waveform)
        result["waveform_analysis"] = analysis
        if request.waveform.system_type == "ANALOG_ADC":
            path = EXPERIMENTAL / "waveform" / "adc" / "fusion.joblib"
            if path.is_file():
                artifact = _fusion_artifact(str(path.resolve()))
                prepared = prepare(np.asarray(request.waveform.samples), "ANALOG_ADC", PreprocessingConfig())
                structured = artifact["structured"].predict_proba(
                    structured_features(prepared).reshape(1, -1))[0]
                waveform = np.asarray([analysis["waveform_model"]["probabilities"][name]
                                       for name in artifact["classes"]])
                features = np.r_[structured, waveform]
                model_name = "fusion_sw"
                if physics is not None and all(physics[name] is not None for name in PHYSICS_NAMES):
                    features = np.r_[features, [float(physics[name]) for name in PHYSICS_NAMES]]
                    model_name = "fusion_swp"
                probability = artifact[model_name].predict_proba(features.reshape(1, -1))[0]
                result["experimental_simulation_fusion"] = {
                    "model": model_name,
                    "predicted_pattern": artifact["classes"][int(np.argmax(probability))],
                    "probabilities": {name: float(p) for name, p in zip(artifact["classes"], probability)},
                    "input_data_source": request.waveform.data_source,
                    "model_training_source": "PYTHON_SIMULATION",
                }
    from ..midterm.api import advanced
    result["midterm_advanced"] = advanced(request)
    return result


@router.post("/mcu/pwm/simulate")
def mcu_pwm(request: PWMRequest, http_request: Request):
    result = simulate_pwm(request)
    if http_request.headers.get("accept", "").split(",", 1)[0].strip() == "text/plotly":
        return _plotly_traces(result["time_s"], [("PWM output (V)", result["voltage_v"], True)])
    if http_request.headers.get("accept", "").split(",", 1)[0].strip() == "text/plain":
        return PlainTextResponse("\n".join([
            "Simulation only — virtual MCU PWM",
            f"Period: {result['period_s']:.9g} s",
            f"High time: {result['high_time_s']:.9g} s",
            f"Low time: {result['low_time_s']:.9g} s",
            f"Average output: {result['average_voltage_v']:.4f} V",
            f"Generated samples: {len(result['voltage_v'])}",
        ]))
    return result


@router.post("/mcu/gpio/simulate")
def mcu_gpio(request: GPIORequest, http_request: Request):
    result = simulate_gpio(request)
    if http_request.headers.get("accept", "").split(",", 1)[0].strip() == "text/plain":
        match = result["matches_expected"]
        return PlainTextResponse("\n".join([
            "Simulation only — virtual MCU GPIO",
            f"Simulated state: {result['simulated_state']}",
            f"State source: {result['state_source']}",
            f"Expected state: {result['expected_state']}",
            f"Matches expected: {'unknown' if match is None else str(match).lower()}",
        ]))
    return result


@router.post("/mcu/i2c/simulate")
def mcu_i2c(request: I2CRequest, http_request: Request):
    result = simulate_i2c(request)
    if http_request.headers.get("accept", "").split(",", 1)[0].strip() == "text/plotly":
        time_s = [index / result["metadata"]["sampling_rate"] for index in range(len(result["sda"]))]
        return _plotly_traces(time_s, [("SDA", result["sda"], True),
                                       ("SCL", result["scl"], True)])
    if http_request.headers.get("accept", "").split(",", 1)[0].strip() == "text/plain":
        from ..midterm.inference import infer_temporal
        from ..midterm.api import safe
        samples = [result[k] for k in ('ideal_sda','ideal_scl','sda','scl')]
        learned = safe(infer_temporal, samples, 'i2c', result['metadata']['sampling_rate'], 'PYTHON_SIMULATION')
        return PlainTextResponse("\n".join([
            "Simulation Results — Simulation only — virtual MCU I2C",
            f"Engineering status: {result['engineering_status']}",
            f"SDA samples: {len(result['sda'])}",
            f"SCL samples: {len(result['scl'])}",
            "SDA/SCL traces were generated by the I2C simulator.",
            "", "AI Analysis — Experimental",
            f"Learned waveform pattern: {learned.get('predicted_pattern', 'unavailable')}",
            f"Pattern probability: {max(learned.get('probabilities', {}).values(), default=0):.1%}",
            f"Model version: {learned.get('model_version', 'unavailable')}",
            f"Invocation: {learned.get('invocation_id', '')}",
            "Observed SDA/SCL only; one aligned address/data transaction. Independent simulator evaluation is not hardware validation.",
        ]))
    return result
