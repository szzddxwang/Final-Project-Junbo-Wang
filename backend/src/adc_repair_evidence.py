"""Read only allowlisted, previously executed ADC simulation retest evidence."""

import csv
from datetime import datetime, timezone
from enum import Enum
import hashlib

from .adc_evidence import RAW_CODES, raw_model_version, verify_repair
from .config import ROOT


class RepairPhase(str, Enum):
    CORRECT_RESOLUTION = "CORRECT_RESOLUTION"
    INEFFECTIVE_NOISE_CHANGE = "INEFFECTIVE_NOISE_CHANGE"
    MISSING_EVIDENCE = "MISSING_EVIDENCE"


PHASES = {
    RepairPhase.CORRECT_RESOLUTION: "correct_repair",
    RepairPhase.INEFFECTIVE_NOISE_CHANGE: "ineffective_repair",
    RepairPhase.MISSING_EVIDENCE: "missing_evidence",
}
SOURCE = ROOT / "matlab model/current_round/adc_repair_evidence.csv"


def repair_evidence(phase: RepairPhase):
    phase = RepairPhase(phase)
    payload = SOURCE.read_bytes()
    with SOURCE.open(encoding="utf-8", newline="") as stream:
        rows = list(csv.DictReader(stream))
    selected = {}
    for row in rows:
        if row["case_id"] != "ADC_REPAIR_001" or row["data_source"] != "SIMULATION" or row["simulation_success"] != "1":
            raise ValueError("Simulation evidence is not from the approved successful case")
        if row["phase"] in selected:
            raise ValueError("Duplicate simulation phase")
        selected[row["phase"]] = {code: float(row[code]) for code in RAW_CODES}
    if set(selected) != {"pre_repair", "ineffective_repair", "correct_repair"}:
        raise ValueError("Simulation evidence phases are incomplete")
    before = selected["pre_repair"]
    if verify_repair(before)["status"] != "Still faulty":
        raise ValueError("The pre-repair case is not the approved faulty case")
    selected_phase = PHASES[phase]
    after = selected.get(selected_phase, {})
    result = verify_repair(after)
    change = {
        RepairPhase.CORRECT_RESOLUTION: "ADC resolution changed from 10 to 12 bits; the previously adjusted noise is retained.",
        RepairPhase.INEFFECTIVE_NOISE_CHANGE: "Sensor noise changed from 0 to 0.001 V amplitude; ADC resolution remains 10 bits.",
        RepairPhase.MISSING_EVIDENCE: "No post-repair measurements supplied; repair cannot be verified.",
    }[phase]
    return {
        "case_id": "ADC_REPAIR_001",
        "scenario_version": "adc-simulation-repair-v1",
        "model_version": raw_model_version(),
        "phase_code": phase.value,
        "phase": selected_phase,
        "source": "SIMULATION",
        "execution": "OFFLINE_SIMULINK_IMPORT",
        "seed": 20260928,
        "evidence_sha256": hashlib.sha256(payload).hexdigest(),
        "simulation_artifact_modified_utc": datetime.fromtimestamp(SOURCE.stat().st_mtime, timezone.utc).isoformat(),
        "proposed_change": "Compare documented 12-bit resolution with actual settings, then correct the simulation parameter and rerun.",
        "prerequisites": "Use the same ADC_REPAIR_001 low-voltage simulation and a stable 20 ms/50 kHz sample window.",
        "actual_change": change,
        "pre_repair": before,
        "post_repair": after,
        "verification": result,
        "criteria": {"count_tolerance": 2, "reference_tolerance_v": 0.02, "path_tolerance_v": 0.02, "resolution_must_match": True},
    }
