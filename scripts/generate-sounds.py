#!/usr/bin/env python3
"""Generate FunPro's built-in notification sounds (public/sounds/*.wav).

All sounds are original and synthesised from scratch with additive synthesis (sine partials,
envelopes and a seeded noise burst) -- no third-party audio. The output is deterministic, so the
committed WAV files can be reproduced exactly:

    python3 scripts/generate-sounds.py

Format: 22.05 kHz, mono, 16-bit PCM. Each file is well under 100 KB.
"""
from __future__ import annotations

import math
import random
import struct
import wave
from pathlib import Path

RATE = 22050
OUT_DIR = Path(__file__).resolve().parent.parent / "public" / "sounds"


def silence(seconds: float) -> list[float]:
    return [0.0] * int(RATE * seconds)


def tone(freq: float, seconds: float, *, partials: tuple[tuple[float, float], ...] = ((1.0, 1.0),),
         attack: float = 0.004, decay: float = 4.0) -> list[float]:
    """A note made of (frequency ratio, amplitude) partials with a fast attack and exponential decay."""
    n = int(RATE * seconds)
    out = []
    for i in range(n):
        t = i / RATE
        env = min(1.0, t / attack) * math.exp(-decay * t)
        s = sum(a * math.sin(2 * math.pi * freq * r * t) for r, a in partials)
        out.append(env * s)
    return out


def sweep(f0: float, f1: float, seconds: float, *, decay: float = 18.0) -> list[float]:
    """Exponential pitch glide (used for the 'pop')."""
    n = int(RATE * seconds)
    out, phase = [], 0.0
    for i in range(n):
        t = i / RATE
        f = f0 * (f1 / f0) ** (i / max(1, n - 1))
        phase += 2 * math.pi * f / RATE
        env = min(1.0, t / 0.002) * math.exp(-decay * t)
        out.append(env * math.sin(phase))
    return out


def noise_burst(seconds: float, *, seed: int, decay: float = 60.0) -> list[float]:
    rng = random.Random(seed)
    n = int(RATE * seconds)
    out, prev = [], 0.0
    for i in range(n):
        t = i / RATE
        # One-pole high-pass on white noise gives a short, bright "tick".
        x = rng.uniform(-1.0, 1.0)
        y = x - prev
        prev = x
        out.append(0.5 * y * math.exp(-decay * t))
    return out


def mix(*tracks: tuple[float, list[float]]) -> list[float]:
    """Mix (start_seconds, samples) tracks into one buffer."""
    length = max(int(start * RATE) + len(s) for start, s in tracks)
    buf = [0.0] * length
    for start, samples in tracks:
        offset = int(start * RATE)
        for i, v in enumerate(samples):
            buf[offset + i] += v
    return buf


def finish(samples: list[float], *, peak_db: float = -3.0, fade_ms: float = 15.0) -> list[float]:
    fade = int(RATE * fade_ms / 1000)
    n = len(samples)
    for i in range(min(fade, n)):
        samples[n - 1 - i] *= i / fade
    peak = max(1e-9, max(abs(v) for v in samples))
    gain = (10 ** (peak_db / 20)) / peak
    return [v * gain for v in samples]


def write_wav(name: str, samples: list[float]) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"{name}.wav"
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1.0, min(1.0, v)) * 32767)) for v in samples))
    print(f"wrote {path.relative_to(OUT_DIR.parent.parent)} ({path.stat().st_size} bytes)")


BELLISH = ((1.0, 1.0), (2.0, 0.35), (3.01, 0.12))
INHARMONIC_BELL = ((1.0, 1.0), (2.76, 0.45), (5.40, 0.22), (8.93, 0.08))


def main() -> None:
    # chime (new message): two soft bell notes, a falling fifth.
    write_wav("chime", finish(mix(
        (0.00, tone(1318.5, 0.45, partials=BELLISH, decay=7.0)),
        (0.12, tone(987.8, 0.55, partials=BELLISH, decay=6.0)),
    )))
    # register (new order): bright tick followed by a quick rising major arpeggio.
    write_wav("register", finish(mix(
        (0.00, noise_burst(0.05, seed=7)),
        (0.03, tone(1046.5, 0.30, partials=BELLISH, decay=9.0)),
        (0.10, tone(1318.5, 0.30, partials=BELLISH, decay=9.0)),
        (0.17, tone(1568.0, 0.45, partials=BELLISH, decay=6.5)),
    )))
    # bell (new review): a single struck bell with inharmonic partials.
    write_wav("bell", finish(tone(880.0, 0.9, partials=INHARMONIC_BELL, decay=4.5)))
    # pop: short downward glide.
    write_wav("pop", finish(sweep(900.0, 220.0, 0.14)))
    # alert (failures, low stock): two short mid-range beeps, the second lower.
    beep = ((1.0, 1.0), (3.0, 0.18), (5.0, 0.06))
    write_wav("alert", finish(mix(
        (0.00, tone(880.0, 0.16, partials=beep, attack=0.006, decay=10.0)),
        (0.20, tone(659.3, 0.22, partials=beep, attack=0.006, decay=8.0)),
    )))
    # soft: a gentle low note for quiet setups.
    write_wav("soft", finish(mix(
        (0.00, tone(392.0, 0.5, partials=((1.0, 1.0), (2.0, 0.2)), attack=0.03, decay=5.5)),
        (0.00, silence(0.55)),
    ), peak_db=-6.0))


if __name__ == "__main__":
    main()
