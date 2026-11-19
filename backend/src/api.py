"""MicroExplore backend for Mendix diagnosis, virtual experiments and compilation."""

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, PlainTextResponse

from .config import ROOT, load_config
from .diagnosis_engine import diagnose, loaded_model_status
from .schemas import DiagnosisRequest, DiagnosisResponse
from .model_identity import stable_model_version
from .adc_repair_evidence import RepairPhase, repair_evidence
from .virtual_lab.api import WEB, router as virtual_lab_router
from .virtual_lab.runtime import preload_models
from .midterm.api import router as midterm_router
from .reliability.api import router as reliability_router
from .paired_research.api import router as generalization_router
from .active_simulation.api import router as active_simulation_router
from .programmable_circuit.api import router as programmable_circuit_router
from .paired_evidence.api import router as evidence_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    loaded_model_status()
    preload_models()
    yield


app = FastAPI(title="MicroExplore Backend", version="0.1.0", lifespan=lifespan)
app.include_router(virtual_lab_router)
app.include_router(midterm_router)
app.include_router(reliability_router)
app.include_router(generalization_router)
app.include_router(active_simulation_router)
app.include_router(programmable_circuit_router)
app.include_router(evidence_router)
app.mount("/ai/assets", StaticFiles(directory=WEB), name="ai_assets")


@app.get("/health")
def health():
    try:
        ready = loaded_model_status()['loaded']
    except (OSError, ValueError, RuntimeError, KeyError):
        return JSONResponse(status_code=503, content={'status': 'degraded', 'model_ready': False})
    return {
        "status": "ok",
        "model_ready": ready,
    }


@app.get("/metadata/model")
def model():
    return {"diagnostic_mode": "stable", "model_version": loaded_model_status()['model_version']}


@app.get('/metadata/model/version', response_class=PlainTextResponse)
def model_version_for_native_session():
    """Native session initialization; existing sessions retain their pinned ID."""
    return loaded_model_status()['model_version']


@app.get('/metadata/model/runtime')
def model_runtime():
    return loaded_model_status()


@app.get("/metadata/systems")
def systems():
    return load_config("systems")


@app.get("/metadata/faults")
def faults():
    return load_config("faults")


@app.get("/metadata/measurements")
def measurements():
    return load_config("measurements")


@app.get("/metadata/tools")
def tools():
    from .measurement_guidance import TOOL_LABELS
    return TOOL_LABELS


@app.get("/metadata/symptoms")
def symptoms():
    return load_config("symptoms")


@app.get("/knowledge/{fault_code}")
def knowledge(fault_code: str):
    mapping = load_config("knowledge_map")
    if fault_code not in mapping:
        raise HTTPException(status_code=404, detail="Unknown fault code")
    return mapping[fault_code]


@app.post("/diagnose", response_model=DiagnosisResponse)
def diagnosis(request: DiagnosisRequest):
    try:
        return diagnose(request)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail="Model training has not completed") from exc


@app.get("/simulation/adc-repair-evidence/{phase_code}")
def adc_repair(phase_code: RepairPhase):
    try:
        return repair_evidence(phase_code)
    except (OSError, ValueError, KeyError) as exc:
        raise HTTPException(status_code=503, detail="Approved simulation evidence is unavailable") from exc
