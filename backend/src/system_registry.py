"""Configuration-driven system, symptom, and measurement lookup."""

from .config import load_config


def get_system(system_type: str) -> dict:
    systems = load_config("systems")
    try:
        return systems[system_type]
    except KeyError as exc:
        raise ValueError(f"Unknown system: {system_type}") from exc


def get_measurement(code: str) -> dict:
    from .adc_evidence import DEFINITIONS, definition
    if code in DEFINITIONS:
        return definition(code)
    try:
        return load_config("measurements")[code]
    except KeyError as exc:
        raise ValueError(f"Unknown measurement: {code}") from exc


def validate_symptom(system_type: str, symptom_type: str) -> None:
    if symptom_type not in get_system(system_type)["supported_symptoms"]:
        raise ValueError(f"{symptom_type} is not supported by {system_type}")


def validate_measurements(system_type: str, values: dict) -> None:
    available = set(get_system(system_type)["available_measurements"])
    for code, value in values.items():
        if code not in available:
            raise ValueError(f"{code} is not available for {system_type}")
        definition = get_measurement(code)
        kind = definition["input_type"]
        if kind == "boolean" and not isinstance(value, bool):
            raise ValueError(f"{code} must be boolean")
        if kind == "numeric" and (isinstance(value, bool) or not isinstance(value, (int, float))):
            raise ValueError(f"{code} must be numeric")
        if kind == "choice" and value not in definition["choices"]:
            raise ValueError(f"{code} must be one of {definition['choices']}")
