"""Numerical learning explanations for controlled, reproducible experiments."""
import numpy as np

from .presentation import Calculation, LearningCard, RunComparison, metric


def signal_view(traces, title, y_label):
    """Keep plotted samples and axis units together in the presentation contract."""
    return {
        'label': title,
        'traces': traces,
        'layout': {
            'xaxis': {'title': {'text': 'Time (s)', 'standoff': 10}, 'automargin': True},
            'yaxis': {'title': {'text': y_label}, 'automargin': True},
            'margin': {'t': 20, 'b': 165, 'l': 65, 'r': 20},
            'legend': {'orientation': 'h', 'x': 0, 'y': -.3, 'font': {'size': 10}},
            'height': 440,
        },
    }


def trace(time, values, name):
    return {'x': list(time), 'y': list(values), 'name': name,
            'type': 'scatter', 'mode': 'lines', 'connectgaps': False}


def sensor_learning(view, ideal, measured, fs, features, source):
    expected = np.asarray(ideal, float)
    observed = np.asarray(measured, float)
    valid = np.isfinite(observed)
    t = np.arange(len(expected)) / fs
    last = np.flatnonzero(valid)[-1]
    view.summary.source = 'Simulated signal' if source == 'PYTHON_SIMULATION' else 'User-provided signal'
    view.signal_series = signal_view([
        trace(t.tolist(), expected.tolist(), 'Reference temperature'),
        trace(t.tolist(), [float(x) if np.isfinite(x) else None for x in observed], 'Sensor reading'),
    ], 'Reference and sensor reading', 'Temperature (°C)')
    view.learning_cards = [
        LearningCard(title='What happened?', text=f'The last valid reading is {observed[last]:.3f} °C at {t[last]:.3f} s. The reference is {expected[last]:.3f} °C.'),
        LearningCard(title='Why?', text=f'The residual is reading minus reference. Its RMS is {features["residual_rms"]:.3f} °C. Response lag, offset, drift and noise can all contribute.'),
        LearningCard(title='What changed?', text=f'The reference changes by {expected[-1]-expected[0]:.3f} °C during this capture. The fitted residual trend is {features["residual_slope_per_second"]:.4f} °C/s; this is an observation, not proof of a fault cause.'),
        LearningCard(title='What to try next?', text='Change one known condition and choose Run & Compare. Try Suggested Experiment previews a change before you apply it. Reference drift experiments remain under Research Tools.'),
    ]
    view.calculations = [
        Calculation(title='Residual RMS', formula='sqrt(mean((reading - reference)^2))',
                    substitution=f'{int(valid.sum())} finite aligned sample pairs; missing samples are excluded.',
                    result=f'{features["residual_rms"]:.6f} °C', assumptions='This is an engineering statistic, not a learned probability.'),
        Calculation(title='Missing samples', formula='100 × missing / total',
                    substitution=f'100 × {int((~valid).sum())} / {len(expected)}',
                    result=f'{features["dropout_fraction"]*100:.3f} %'),
    ]
    return view


def sensor_pair(view, before_request, after_request, before, after):
    """Compare two actual simulations with one changed parameter and shared noise."""
    a = np.asarray(before['measured'], float)
    b = np.asarray(after['measured'], float)
    delta = b - a
    final = float(delta[-1])
    time = before['time_s']
    conclusion = (f'At {time[-1]:.3f} s, adding 0.12 °C/s drift changes the reading by {final:.3f} °C. '
                  f'True temperature stays at {before_request.true_value:.3f} °C. '
                  'The drift is a known simulator input, not an independently diagnosed hardware fault.')
    view.comparison = RunComparison(status='AVAILABLE',
        before_parameters=before_request.model_dump(), after_parameters=after_request.model_dump(),
        changes=['Drift: 0 → 0.12 °C/s. All other parameters and the random seed are identical.'],
        metrics=[metric('Final reading difference',final,'°C',3),
                 metric('Mean reading difference',float(delta.mean()),'°C',3)], conclusion=conclusion)
    view.signal_series = signal_view([
        trace(time, before['ideal'], 'True temperature'),
        trace(time, before['measured'], 'Run A: zero drift'),
        trace(time, after['measured'], 'Run B: 0.12 °C/s drift'),
    ], 'Two controlled sensor runs', 'Temperature (°C)')
    view.summary.title = 'Sensor drift experiment'
    view.summary.verdict = 'Two simulated runs completed'
    view.summary.message = conclusion
    view.summary.next_action = 'Change noise or capture duration, then repeat the matched drift experiment.'
    view.learning_cards[2] = LearningCard(title='What changed?', text=conclusion)
    view.learning_cards[3] = LearningCard(title='What to try next?', text=view.summary.next_action)
    view.calculations.append(Calculation(title='Known drift contribution',
        formula='reading difference = drift rate × elapsed time',
        substitution=f'0.12 °C/s × {time[-1]:.3f} s', result=f'{final:.3f} °C',
        assumptions='Both runs use the same noise samples, response, offset and constant reference.'))
    view.provenance['comparison'] = {'source':'PYTHON_SIMULATION','paired_seed':before_request.seed,
        'known_intervention':'drift_per_second','independent_hardware_diagnosis':False}
    return view
