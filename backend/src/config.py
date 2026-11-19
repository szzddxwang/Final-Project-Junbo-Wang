"""Load and validate the project's configuration documents."""

from functools import lru_cache
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG_DIR = ROOT / "config"


@lru_cache(maxsize=None)
def load_config(name: str) -> dict:
    path = CONFIG_DIR / f"{name}.json"
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def validate_config() -> None:
    faults = load_config("faults")
    systems = load_config("systems")
    symptoms = load_config("symptoms")
    measurements = load_config("measurements")
    knowledge = load_config("knowledge_map")
    assert systems and faults and measurements
    assert set(knowledge) == set(faults)
    for code, system in systems.items():
        assert system["system_name"] and system["description"], code
        assert set(system["applicable_faults"]) <= set(faults), code
        assert set(system["supported_symptoms"]) <= set(symptoms), code
        assert set(system["available_measurements"]) <= set(measurements), code
        assert "Normal" in system["applicable_faults"], code
    for code, measurement in measurements.items():
        assert measurement["measurement_code"] == code
        assert measurement["input_type"] in {"numeric", "boolean", "choice"}
        assert set(measurement["supported_systems"]) <= set(systems)
        for system in measurement["supported_systems"]:
            assert code in systems[system]["available_measurements"]
        if measurement["input_type"] == "choice":
            assert measurement.get("choices")
