"""Protocol-aware simulation follow-up; never used by production diagnosis.

Only configured command/reference traces and observable line voltages enter the
feature extractors. Fault labels, injected parameters and generator branches are
kept in metadata for evaluation, not exposed to a classifier.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


UART_FAULTS = (
    "NORMAL", "BAUD_MISMATCH", "TX_DISCONNECTED", "RX_DISCONNECTED",
    "FRAMING_ERROR", "IDLE_LOW", "LOW_VOLTAGE", "HIGH_NOISE",
    "TIMING_JITTER",
)
I2C_FAULTS = (
    "NORMAL", "MISSING_ACK", "SDA_STUCK_LOW", "SCL_STUCK_LOW",
    "SLOW_RISE", "HIGH_NOISE", "CLOCK_ABNORMALITY",
)


@dataclass(frozen=True)
class ProtocolCase:
    samples: np.ndarray
    configured: dict
    evaluation: dict


def _resample(bits: list[int], widths: list[int], total: int) -> np.ndarray:
    values = np.concatenate([np.full(max(1, width), bit, dtype=float)
                             for bit, width in zip(bits, widths)])
    if len(values) < total:
        values = np.pad(values, (0, total - len(values)), constant_values=1)
    return values[:total]


def uart_case(fault: str, group: int, *, seed: int = 20261008,
              samples_per_bit: int = 16, shifted: bool = False) -> ProtocolCase:
    """Simulate one 8N1 frame at a configured baud with TX-pin and RX-line probes."""
    if fault not in UART_FAULTS:
        raise ValueError("Unknown UART fault")
    if not 8 <= samples_per_bit <= 32:
        raise ValueError("samples_per_bit must be 8..32")
    base = np.random.default_rng(seed + 7919 * group)
    rng = np.random.default_rng(seed + 7919 * group + 43 * UART_FAULTS.index(fault))
    byte = int(base.integers(0, 256))
    bits = [1, 0, *[(byte >> i) & 1 for i in range(8)], 1, 1]
    count = len(bits) * samples_per_bit
    commanded = _resample(bits, [samples_per_bit] * len(bits), count)
    width = samples_per_bit
    if fault == "BAUD_MISMATCH":
        width = max(4, round(samples_per_bit * (.78 if not shifted else .87)))
    widths = [width] * len(bits)
    if fault == "TIMING_JITTER":
        scale = .23 if not shifted else .13
        widths = [max(4, round(width * (1 + rng.normal(0, scale)))) for _ in bits]
    tx = _resample(bits, widths, count)
    rx = tx.copy()
    if fault == "TX_DISCONNECTED":
        tx[:] = 1
        rx[:] = 1
    elif fault == "RX_DISCONNECTED":
        rx[:] = 1
    elif fault == "FRAMING_ERROR":
        stop = sum(widths[:10])
        rx[stop:min(count, stop + widths[10])] = 0
    elif fault == "IDLE_LOW":
        rx[:widths[0]] = 0
        rx[-widths[-1]:] = 0
    vdd = float(base.uniform(2.7, 3.6))
    rx *= vdd * (.43 if fault == "LOW_VOLTAGE" else 1)
    tx *= vdd
    sigma = .16 * vdd if fault == "HIGH_NOISE" else (.025 if shifted else .008) * vdd
    tx = np.clip(tx + rng.normal(0, sigma * .3, count), 0, vdd)
    rx = np.clip(rx + rng.normal(0, sigma, count), 0, vdd)
    return ProtocolCase(np.stack((commanded * vdd, tx, rx)).astype(np.float32),
                        {"baud": int(base.choice([9600, 19200, 38400, 57600, 115200])),
                         "samples_per_bit": samples_per_bit, "configured_byte": byte,
                         "vdd": vdd},
                        {"group": group, "fault": fault, "source": "PYTHON_SIMULATION",
                         "shifted": shifted})


def uart_features(case: ProtocolCase) -> dict[str, float]:
    """Features from known command and two probe captures; no evaluation metadata."""
    command, tx, rx = (np.asarray(channel, dtype=float) for channel in case.samples)
    vdd = float(case.configured["vdd"])
    spp = int(case.configured["samples_per_bit"])
    tx_bits = tx > .5 * vdd
    rx_bits = rx > .5 * vdd
    command_bits = command > .5 * vdd
    centers = np.arange(12) * spp + spp // 2
    high = np.quantile(rx, .95)
    low = np.quantile(rx, .05)
    steady = np.convolve(rx, np.ones(5) / 5, mode="same")
    command_edges = np.flatnonzero(np.diff(command_bits.astype(int)))
    tx_edges_at = np.flatnonzero(np.diff(tx_bits.astype(int)))
    if len(command_edges) == len(tx_edges_at) and len(command_edges) >= 2:
        displacement = (tx_edges_at - command_edges) / spp
        trend = np.polyfit(np.arange(len(displacement)), displacement, 1)
        edge_drift = abs(float(trend[0]))
        edge_jitter = float(np.std(displacement - np.polyval(trend, np.arange(len(displacement)))))
    else:
        edge_drift, edge_jitter = 1.0, 1.0
    return {
        "tx_command_mismatch": float(np.mean(tx_bits != command_bits)),
        "rx_command_mismatch": float(np.mean(rx_bits != command_bits)),
        "tx_rx_mismatch": float(np.mean(tx_bits != rx_bits)),
        "rx_swing_ratio": float((high - low) / vdd),
        "rx_idle_start": float(np.median(rx[:spp]) / vdd),
        "rx_idle_end": float(np.median(rx[-spp:]) / vdd),
        "rx_stop_bit": float(np.median(rx[10 * spp:11 * spp]) / vdd),
        "rx_frame_bit_errors": float(np.mean(rx_bits[centers] != command_bits[centers])),
        "tx_edges": float(np.count_nonzero(np.diff(tx_bits.astype(int)))),
        "rx_edges": float(np.count_nonzero(np.diff(rx_bits.astype(int)))),
        "rx_noise_ratio": float(np.sqrt(np.mean((rx[3:-3] - steady[3:-3]) ** 2)) / vdd),
        "edge_drift": edge_drift,
        "edge_jitter": edge_jitter,
    }


def _rc(values: np.ndarray, coefficient: float) -> np.ndarray:
    out = values.copy()
    for index in range(1, len(out)):
        alpha = coefficient if values[index] > out[index - 1] else 1.0
        out[index] = out[index - 1] + alpha * (values[index] - out[index - 1])
    return out


def i2c_alternative_case(fault: str, group: int, *, seed: int = 20261112,
                         samples_per_bit: int = 16) -> ProtocolCase:
    """A second bus implementation with randomized data, edges and analog noise.

    Expected traces are built once from the configured transaction and are
    never changed by a fault. The classifier uses observed SDA/SCL only.
    """
    if fault not in I2C_FAULTS:
        raise ValueError("Unknown I2C fault")
    if not 8 <= samples_per_bit <= 32 or samples_per_bit % 2:
        raise ValueError("samples_per_bit must be even and 8..32")
    base = np.random.default_rng(seed + 8191 * group)
    rng = np.random.default_rng(seed + 8191 * group + 47 * I2C_FAULTS.index(fault))
    address = int(base.integers(0x08, 0x78))
    data = int(base.integers(0, 256))
    bits = [int(x) for x in f"{address << 1:08b}"] + [0] + [int(x) for x in f"{data:08b}"] + [0]
    half = samples_per_bit // 2
    sda = np.r_[np.ones(samples_per_bit), np.zeros(half),
                np.repeat(bits, samples_per_bit), np.zeros(half), np.ones(samples_per_bit)]
    scl = np.r_[np.ones(samples_per_bit + half),
                np.tile(np.r_[np.zeros(half), np.ones(half)], len(bits)),
                np.ones(half + samples_per_bit)]
    observed_sda, observed_scl = sda.copy(), scl.copy()
    if fault == "MISSING_ACK":
        ack_index = int(base.choice([8, 17]))
        start = samples_per_bit + half + ack_index * samples_per_bit
        observed_sda[start:start + samples_per_bit] = 1
    elif fault == "SDA_STUCK_LOW":
        observed_sda[:] = 0
    elif fault == "SCL_STUCK_LOW":
        observed_scl[:] = 0
    elif fault == "CLOCK_ABNORMALITY":
        start = samples_per_bit + half + int(base.integers(2, 14)) * samples_per_bit
        observed_scl[start:start + 2 * samples_per_bit] = 0
    rise = float(base.uniform(.35, .8)) if fault != "SLOW_RISE" else float(base.uniform(.06, .14))
    observed_sda = _rc(observed_sda, rise)
    observed_scl = _rc(observed_scl, rise)
    sigma = .12 if fault == "HIGH_NOISE" else float(base.uniform(.004, .025))
    observed_sda = np.clip(observed_sda + rng.normal(0, sigma, len(sda)), 0, 1)
    observed_scl = np.clip(observed_scl + rng.normal(0, sigma, len(scl)), 0, 1)
    return ProtocolCase(np.stack((sda, scl, observed_sda, observed_scl)).astype(np.float32),
                        {"samples_per_bit": samples_per_bit, "address": address,
                         "data": data, "clock_hz": float(base.uniform(60_000, 150_000))},
                        {"group": group, "fault": fault, "source": "PYTHON_SIMULATION"})


def i2c_protocol_features(case: ProtocolCase) -> dict[str, float]:
    """Read observed bus lines only, using configured timing for ACK positions."""
    sda, scl = (np.asarray(channel, dtype=float) for channel in case.samples[2:])
    spp = int(case.configured["samples_per_bit"])
    half = spp // 2
    start = spp + half
    ack = [float(np.median(sda[start + i * spp + half:start + (i + 1) * spp]))
           for i in (8, 17)]
    sda_bits, scl_bits = sda > .5, scl > .5
    sda_smooth = np.convolve(sda, np.ones(5) / 5, mode="same")
    scl_smooth = np.convolve(scl, np.ones(5) / 5, mode="same")
    rise_time = []
    for line in (sda, scl):
        low_to_high = np.flatnonzero((line[:-1] < .2) & (line[1:] >= .2))
        for edge in low_to_high:
            later = np.flatnonzero(line[edge + 1:min(len(line), edge + 2 * spp)] >= .8)
            if len(later):
                rise_time.append(float(later[0] + 1) / spp)
    return {
        "ack_1": ack[0], "ack_2": ack[1],
        "sda_low_fraction": float(np.mean(~sda_bits)),
        "scl_low_fraction": float(np.mean(~scl_bits)),
        "sda_edges": float(np.count_nonzero(np.diff(sda_bits.astype(int)))),
        "scl_edges": float(np.count_nonzero(np.diff(scl_bits.astype(int)))),
        "max_scl_low_run": float(max((len(x) for x in np.split(~scl_bits, np.where(np.diff(~scl_bits))[0] + 1)
                                    if len(x) and x[0]), default=0) / spp),
        "rise_time_bits": float(np.median(rise_time)) if rise_time else 0,
        "noise_ratio": float(np.sqrt(np.mean((sda[3:-3] - sda_smooth[3:-3]) ** 2
                                               + (scl[3:-3] - scl_smooth[3:-3]) ** 2))),
    }
