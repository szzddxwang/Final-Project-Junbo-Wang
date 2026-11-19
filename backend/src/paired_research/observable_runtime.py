"""Explicit opt-in inference for the validation-selected observable RF revision."""
import hashlib
import io
import json
import time
from functools import lru_cache

import joblib
import numpy as np

from ..config import ROOT, load_config
from .inference import record
from .models import aligned_probability, combine
from .observable_round2 import FEATURE_VERSION, physical_v4, waveform_v4

ART = ROOT / 'models/experimental/observable_v4_20261026'
MANIFEST_SHA256 = '1ce923335b27207ac78ca63270725cd0e38478b35b013213c2114c36e0c5b807'


@lru_cache(maxsize=6)
def _decode(blob):
    # Only locally generated, hash-pinned bytes reach the pickle loader.
    return joblib.load(io.BytesIO(blob))


def package(system, expected_feature=None, expected_artifact=None):
    manifest_bytes = (ART / 'manifest.json').read_bytes()
    if hashlib.sha256(manifest_bytes).hexdigest() != MANIFEST_SHA256:
        raise ValueError('Research manifest integrity mismatch')
    manifest = json.loads(manifest_bytes)
    if system not in manifest:
        raise ValueError('Unsupported research system')
    entry = manifest[system]
    if not entry['validation_selected'] or entry['feature_version'] != FEATURE_VERSION:
        raise ValueError('Research candidate is not selected or compatible')
    if expected_feature is not None and expected_feature != FEATURE_VERSION:
        raise ValueError('Requested research feature version does not match')
    if expected_artifact is not None and expected_artifact != entry['sha256']:
        raise ValueError('Requested research artifact does not match')
    path = ART / ('observable_' + system.lower() + '.joblib')
    blob = path.read_bytes()
    digest = hashlib.sha256(blob).hexdigest()
    if digest != entry['sha256']:
        raise ValueError('Research artifact integrity mismatch')
    pack = _decode(blob)
    if (pack['system_type'] != system or pack['feature_version'] != FEATURE_VERSION
            or pack['classes'] != load_config('systems')[system]['applicable_faults']
            or not pack['validation_selected'] or pack['production_default']):
        raise ValueError('Research artifact contract mismatch')
    weights = np.asarray(pack['gate_weights'])
    if weights.shape != (3, 5) or not np.isfinite(weights).all():
        raise ValueError('Invalid research gate')
    return pack, digest


def _probability(values, count):
    p = np.asarray(values, float)
    if p.shape != (count,) or not np.isfinite(p).all() or (p < 0).any() or p.sum() <= 0:
        raise ValueError('Invalid branch probability vector')
    return p / p.sum()


def observable_paired(system, measurements, structured, samples=None, configured=None):
    start = time.perf_counter()
    pack, digest = package(system)
    classes = pack['classes']
    # An unconditioned production prior is not evidence. Match the evaluated mask.
    present = [bool(measurements) and bool(structured), bool(measurements), samples is not None]
    if not any(present):
        return {'execution_state': 'NOT_RUN_MISSING_INPUT', 'reason': 'No observed modalities',
                'research_revision': 'observable_v4', 'feature_version': FEATURE_VERSION}
    n = len(classes)
    ps = _probability([structured.get(k, 0.) for k in classes], n) if present[0] else np.zeros(n)
    pp = _probability(aligned_probability(pack['physics'], physical_v4(system, measurements)[None], classes)[0], n) if present[1] else np.zeros(n)
    wp = _probability(aligned_probability(pack['waveform'], waveform_v4(system, samples, configured or {})[None], classes)[0], n) if present[2] else np.zeros(n)
    quality = [min(len(measurements) / 12, 1) if x else 0. for x in present[:2]] + [float(present[2])]
    probabilities, weights = combine(np.stack((ps, pp, wp))[None], np.asarray(quality)[None],
                                     np.asarray(present)[None], pack['gate_weights'])
    p = _probability(probabilities[0], n)
    return record({
        'probabilities': dict(zip(classes, map(float, p))),
        'predicted_root_fault': classes[int(p.argmax())], 'modality_mask': present,
        'gate_weights': weights[0].tolist(), 'waveform_executed': present[2],
        'waveform_probabilities': dict(zip(classes, map(float, wp))) if present[2] else {},
        'scope': 'Opt-in synthetic research; hardware unvalidated. PWM sparse-evidence regression remains.',
        'validation_gate_pass': True, 'research_revision': 'observable_v4',
        'feature_version': FEATURE_VERSION, 'production_default': False,
        'evidence_note': 'Executed with captured waveform evidence.' if present[2] else 'Executed without waveform evidence.'
    }, 'observable-paired-v4', digest, {'measurements': measurements, 'samples': samples,
                                     'configured': configured}, start)
