"""Version identity and rollback paths for the shared diagnosis artifacts."""

from functools import lru_cache
import hashlib
import json

from .config import ROOT


@lru_cache(maxsize=1)
def selected_model_config() -> dict:
    return json.loads((ROOT / "models/selected_model.json").read_text(encoding="utf-8"))


def _artifact_path(relative: str):
    path = (ROOT / relative).resolve()
    if not path.is_relative_to((ROOT / "models").resolve()):
        raise ValueError("Model artifact must stay under models/")
    return path


@lru_cache(maxsize=1)
def stable_model_version() -> str:
    selection = selected_model_config()
    path = _artifact_path(selection.get("artifact", f"models/{selection['model']}.joblib"))
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    version = selection.get("model_version")
    if version is not None:
        if not version.endswith(digest.hexdigest()[:12]):
            raise ValueError("Selected model version does not match artifact SHA-256")
        return version
    return f"stable-{selection['model'].lower()}-{digest.hexdigest()[:12]}"


def supported_stable_versions() -> set[str]:
    return {stable_model_version()} | {item["model_version"] for item in selected_model_config().get("previous_models", [])}


def stable_artifact_path(version: str | None = None):
    selection = selected_model_config()
    if version is None or version == stable_model_version():
        return _artifact_path(selection.get("artifact", f"models/{selection['model']}.joblib"))
    for item in selection.get("previous_models", []):
        if item["model_version"] == version:
            path = _artifact_path(item["artifact"])
            if not version.endswith(hashlib.sha256(path.read_bytes()).hexdigest()[:12]):
                raise ValueError("Previous model version does not match artifact SHA-256")
            return path
    raise ValueError("The pinned diagnostic model version is not available")
