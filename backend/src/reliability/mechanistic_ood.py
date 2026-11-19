"""Known-class conditional ADC novelty; no injection metadata at inference.

Joint gain/intercept coordinates retain the distinction between an attenuated
AC excursion about an offset and a simple gain error. Each known mechanism has
its own covariance, so noise in another mechanism cannot widen every boundary.
Constant references cannot identify this mechanism and must abstain.
"""
import numpy as np
from sklearn.covariance import LedoitWolf

FEATURE_NAMES = ('pin_gain', 'pin_intercept_over_reference_mean',
                 'pin_log_relative_residual', 'conversion_gain',
                 'conversion_intercept_over_pin_mean', 'conversion_log_residual')


def mechanism_features(samples):
    a = np.asarray(samples, dtype=float)
    if a.ndim != 2 or a.shape[0] != 3 or a.shape[1] < 32 or not np.isfinite(a).all():
        raise ValueError('Three finite observed/reference channels are required')
    result = []
    for x, y in ((a[0], a[1]), (a[1], a[2])):
        gain, intercept = np.linalg.lstsq(np.c_[x, np.ones(len(x))], y, rcond=None)[0]
        residual = np.sqrt(np.mean((y - gain*x - intercept)**2))
        result.extend([gain, intercept / max(abs(x.mean()), .1),
                       np.log10(max(residual / max(np.std(x), .05), 1e-5))])
    return np.asarray(result, dtype=np.float64)


def fit_known_classes(features, labels):
    features = np.asarray(features)
    location = np.median(features, axis=0)
    scale = np.maximum(np.quantile(features, .9, axis=0)-np.quantile(features, .1, axis=0), .05)
    standardized = (features-location)/scale
    models = {str(label): LedoitWolf().fit(standardized[np.asarray(labels)==label])
              for label in sorted(set(labels))}
    return {'location':location, 'scale':scale, 'classes':models,
            'features':FEATURE_NAMES, 'requires_dynamic_reference':True}


def distance(pack, features):
    x = (np.atleast_2d(features)-pack['location'])/pack['scale']
    distances = np.stack([model.mahalanobis(x) for model in pack['classes'].values()], axis=1)
    return distances.min(axis=1)
