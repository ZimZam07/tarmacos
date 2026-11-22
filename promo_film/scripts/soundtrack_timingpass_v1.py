"""soundtrack.py - original procedural score and sound effects for the TarmacOS film.

Usage:  python soundtrack.py OUT.wav

Everything is synthesised here with numpy/scipy (oscillators, filtered noise, envelopes, a noise-impulse reverb):
no samples, no third-party music. Scene times are read from scenes/film.js (BASE, PEAK_LOCAL, DURATION),
so the cues follow the picture if the timeline changes.

Score: D minor, 100 BPM (beat 0.6 s, grid from the title flash).
  intro pad -> title + soft pulse -> silence for the amber slams -> tension (Gm, rising pulse and riser)
  -> IMPACT at the deadlock peak -> dark drone -> resolve (F, C) for recovery/avoidance
  -> steady groove with arpeggio for the engineering scenes -> bright resolve on the end card.
"""
import json
import os
import re
import sys

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, fftconvolve, sosfilt

HERE = os.path.dirname(os.path.abspath(__file__))
FILM_JS = os.path.join(os.path.dirname(HERE), "scenes", "film.js")
SR = 48000
RNG = np.random.default_rng(7)          # fixed seed: the soundtrack is reproducible


def timeline():
    src = open(FILM_JS, encoding="utf-8").read()
    base = re.search(r"const BASE = (\{[^}]*\});", src).group(1)
    base = json.loads(re.sub(r"(\w+):", r'"\1":', base))
    peak = float(re.search(r"const PEAK_LOCAL = ([\d.]+);", src).group(1))
    dur = float(re.search(r"const DURATION = ([\d.]+);", src).group(1))
    return base, base["S6"] + peak, dur


BASE, PEAK, DUR = timeline()
N = int(DUR * SR)
MUSIC = np.zeros((2, N))
SFX = np.zeros((2, N))
SEND = np.zeros((2, N))                 # reverb send bus


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def tt(dur):
    return np.arange(int(dur * SR)) / SR


def lp(x, fc, order=2):
    return sosfilt(butter(order, min(fc, SR / 2 - 100), "low", fs=SR, output="sos"), x)


def hp(x, fc, order=2):
    return sosfilt(butter(order, fc, "high", fs=SR, output="sos"), x)


def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], "band", fs=SR, output="sos"), x)


def add(bus, t0, sig, gain=1.0, pan=0.0, send=0.0):
    """Mix a mono signal into a stereo bus at time t0 (constant-power pan, -1..1)."""
    i0 = int(t0 * SR)
    if i0 >= N or len(sig) == 0:
        return
    if i0 < 0:
        sig, i0 = sig[-i0:], 0
    sig = sig[: N - i0] * gain
    a = (pan + 1) * np.pi / 4
    l, r = np.cos(a) * sig, np.sin(a) * sig
    bus[0, i0:i0 + len(sig)] += l
    bus[1, i0:i0 + len(sig)] += r
    if send:
        SEND[0, i0:i0 + len(sig)] += l * send
        SEND[1, i0:i0 + len(sig)] += r * send


def env(n, attack, release, total=None):
    """Linear attack, sustained, raised-cosine release over n samples."""
    e = np.ones(n)
    a, r = int(attack * SR), int(release * SR)
    if a:
        e[:a] = np.linspace(0, 1, a)
    if r:
        e[-r:] *= 0.5 * (1 + np.cos(np.linspace(0, np.pi, r)))
    return e


def saw(f, t, detune=0.0):
    ph = (f * 2 ** (detune / 1200)) * t + RNG.random()
    return 2 * (ph % 1.0) - 1


# ------------------------------------------------------------------ instruments
def pad(t0, t1, notes, gain, dark=900, bright=None, attack=1.2, release=1.6):
    """Detuned saw pad; the filter opens from `dark` to `bright` Hz over the segment."""
    dur = t1 - t0 + release
    t = tt(dur)
    for k, m in enumerate(notes):
        f = hz(m)
        x = (saw(f, t, -8) + saw(f, t, 8) + 0.6 * saw(f, t, 0)) / 2.6
        lo = lp(x, dark)
        if bright:
            hi = lp(x, bright)
            k_ = np.clip(t / (t1 - t0), 0, 1)
            x = lo * (1 - k_) + hi * k_
        else:
            x = lo
        e = env(len(t), attack, release)
        add(MUSIC, t0, x * e, gain / len(notes) ** 0.5, pan=(-0.35 if k % 2 else 0.35), send=0.35)


def bass(t0, t1, root, gain, gate=None):
    t = tt(t1 - t0 + 0.3)
    f = hz(root)
    x = np.sin(2 * np.pi * f * t) + 0.35 * lp(saw(f, t), 300)
    e = env(len(t), 0.05, 0.3)
    if gate:                                            # 8th-note pumping
        ph = (t % gate) / gate
        e *= 0.35 + 0.65 * np.exp(-ph * 4)
    add(MUSIC, t0, x * e, gain)


def kick(t0, gain=0.6):
    t = tt(0.45)
    f = 48 + 75 * np.exp(-t / 0.035)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.22)
    x[:240] += RNG.normal(0, 0.25, 240) * np.linspace(1, 0, 240)
    add(MUSIC, t0, x, gain)


def hat(t0, gain=0.1, pan=0.2):
    t = tt(0.06)
    add(MUSIC, t0, hp(RNG.normal(0, 1, len(t)), 7000) * np.exp(-t / 0.018), gain, pan)


def pluck(t0, m, gain=0.16, pan=0.0):
    t = tt(0.7)
    f = hz(m)
    x = (np.sin(2 * np.pi * f * t) + 0.35 * np.sin(4 * np.pi * f * t) + 0.12 * saw(f, t)) * np.exp(-t / 0.2)
    add(MUSIC, t0, lp(x, 3200), gain, pan, send=0.4)


# ------------------------------------------------------------------ sound effects
def whoosh(t0, dur=0.7, gain=0.22, direction=1):
    t = tt(dur)
    n = RNG.normal(0, 1, len(t))
    k = t / dur
    low, high = bp(n, 250, 1200), bp(n, 1500, 7000)
    x = low * (1 - k) + high * k if direction > 0 else low * k + high * (1 - k)
    e = np.sin(np.pi * k) ** 2
    pan = np.linspace(-0.6, 0.6, len(t))
    i0 = int((t0 - dur / 2) * SR)
    for c, g in ((0, np.cos((pan + 1) * np.pi / 4)), (1, np.sin((pan + 1) * np.pi / 4))):
        seg = (x * e * g * gain)[: max(0, N - i0)]
        SFX[c, i0:i0 + len(seg)] += seg
        SEND[c, i0:i0 + len(seg)] += seg * 0.2


def hit(t0, gain=0.5, body=110, tail=0.5, noise=0.35):
    t = tt(tail + 0.4)
    f = body * (1 + 0.6 * np.exp(-t / 0.03))
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / (tail * 0.5))
    x += noise * lp(RNG.normal(0, 1, len(t)), 2500) * np.exp(-t / 0.05)
    add(SFX, t0, x, gain, send=0.3)


def slam(t0, gain=0.55):
    kick(t0, gain)
    t = tt(0.25)
    add(SFX, t0, bp(RNG.normal(0, 1, len(t)), 900, 5000) * np.exp(-t / 0.05), gain * 0.5, send=0.25)


def click(t0, gain=0.08, f=2400, pan=0.0):
    t = tt(0.03)
    add(SFX, t0, np.sin(2 * np.pi * f * t) * np.exp(-t / 0.006), gain, pan)


def blip(t0, f0, f1, gain=0.12, dur=0.12, pan=0.0):
    t = tt(dur)
    f = np.linspace(f0, f1, len(t))
    add(SFX, t0, np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / (dur / 3)), gain, pan, send=0.25)


def thunk(t0, gain=0.25):
    t = tt(0.3)
    x = np.sin(2 * np.pi * 140 * t) * np.exp(-t / 0.07) + 0.3 * lp(RNG.normal(0, 1, len(t)), 600) * np.exp(-t / 0.03)
    add(SFX, t0, x, gain)


def bell(t0, notes, gain=0.12, spacing=0.0, decay=1.1, pan=0.0):
    for i, m in enumerate(notes):
        t = tt(decay * 2.5)
        f = hz(m)
        x = (np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * 2.76 * f * t) * np.exp(-t / 0.15)) * np.exp(-t / decay)
        add(SFX, t0 + i * spacing, x, gain, pan, send=0.5)


def riser(t0, t1, gain=0.3):
    t = tt(t1 - t0)
    k = t / (t1 - t0)
    n = hp(RNG.normal(0, 1, len(t)), 2500) * k ** 3
    f = 180 * 2 ** (2.2 * k)
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * (0.15 + 0.85 * k ** 2) * 0.35
    add(SFX, t0, (n * 0.6 + tone) * gain, send=0.3)


def impact(t0, gain=0.9):
    t = tt(3.0)
    f = 32 + 34 * np.exp(-t / 0.18)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.9)
    crack = lp(RNG.normal(0, 1, len(t)), 900) * np.exp(-t / 0.25)
    mid = np.sin(2 * np.pi * 96 * t) * np.exp(-t / 0.45)
    add(SFX, t0, sub * 1.0 + crack * 0.55 + mid * 0.4, gain, send=0.45)


# ------------------------------------------------------------------ the score
BEAT = 0.6
GRID0 = BASE["S3"]                                      # the beat grid starts on the title flash


def beats(a, b, step=1.0, offset=0.0):
    k0 = int(np.ceil((a - GRID0 - offset * BEAT) / (BEAT * step) - 1e-9))
    out, k = [], k0
    while True:
        t = GRID0 + offset * BEAT + k * BEAT * step
        if t >= b:
            return out
        if t >= a:
            out.append(t)
        k += 1


Dm9 = [50, 53, 57, 60, 64]
Bbmaj7 = [46, 50, 53, 57, 62]
Fmaj9 = [53, 57, 60, 64, 67]
C69 = [48, 52, 55, 57, 62]
Gm9 = [43, 46, 50, 53, 57]


def score():
    S2, S3, S4, S5, S6 = BASE["S2"], BASE["S3"], BASE["S4"], BASE["S5"], BASE["S6"]
    S7, S8, S10 = BASE["S7"], BASE["S8"], BASE["S10"]
    rec = S6 + 9.8                                      # the real capture crossfades to RECOVERY
    # intro + title + product
    pad(0.0, S3, Dm9, 0.30, dark=600, bright=1100, attack=2.0)
    pad(S3, S4 + 1.9, Dm9, 0.30, dark=1100, bright=1500)
    pad(S4 + 1.9, S5 - 0.2, Bbmaj7, 0.30, dark=1300, bright=1800, release=0.6)
    bass(S3, S5 - 0.3, 38, 0.18)
    for b in beats(S3, S5 - 0.3):
        kick(b, 0.42)
    for b in beats(S4 + 1.9, S5 - 0.3, offset=0.5):
        hat(b, 0.06)
    # tension: the cycle builds
    pad(S6, PEAK, Gm9, 0.30, dark=400, bright=1600, attack=1.5, release=0.05)
    t = tt(PEAK - S6)
    shimmer = (np.sin(2 * np.pi * hz(81) * t) + np.sin(2 * np.pi * hz(82) * t)) * (t / t[-1]) ** 2 * 0.5
    add(MUSIC, S6, shimmer * env(len(t), 0.5, 0.02), 0.05, send=0.4)
    for b in beats(S6, PEAK - 2.0, step=0.5):
        kick(b, 0.18)
    for b in beats(PEAK - 2.0, PEAK - 0.05, step=0.25):
        kick(b, 0.2)
    bass(S6, PEAK, 31, 0.2, gate=BEAT / 2)
    riser(PEAK - 2.0, PEAK, 0.32)
    # aftermath: dark drone until recovery
    pad(PEAK, rec, [38, 45, 50], 0.28, dark=380, attack=0.05, release=1.2)
    for k_, b in enumerate([PEAK + 0.6, PEAK + 1.2]):
        kick(b, 0.3 - 0.1 * k_)
    # resolve: recovery and avoidance
    pad(rec, BASE["S7b"] + 0.3, Fmaj9, 0.30, dark=1300, bright=2200)
    pad(BASE["S7b"] + 0.3, S8, C69, 0.30, dark=1500, bright=2000)
    bass(rec, BASE["S7b"] + 0.3, 41, 0.15)
    bass(BASE["S7b"] + 0.3, S8 - 0.2, 36, 0.15)
    for b in beats(rec + 0.6, S8 - 0.3, step=2):
        kick(b, 0.32)
    # engineering groove
    seq = [(S8, Dm9, 38), (S8 + 3.6, Bbmaj7, 34), (S8 + 7.2, Fmaj9, 41), (S8 + 10.8, C69, 36)]
    for i, (a, ch, root) in enumerate(seq):
        b_ = seq[i + 1][0] if i + 1 < len(seq) else S10
        pad(a, b_, ch, 0.24, dark=1500, release=0.8)
        bass(a, b_, root, 0.2, gate=BEAT / 2)
        pattern = [0, 2, 1, 3, 2, 4, 3, 1]
        for j, bt in enumerate(beats(a, b_ - 0.01, step=0.25)):
            pluck(bt, ch[pattern[j % 8] % len(ch)] + 12, 0.11 + 0.04 * (j % 4 == 0), pan=0.4 * np.sin(j * 0.7))
    for b in beats(S8, S10 - 0.2):
        kick(b, 0.48)
    for b in beats(S8, S10 - 0.2, offset=0.5):
        hat(b, 0.09)
    # end card: bright resolve
    pad(S10, DUR, Fmaj9 + [72], 0.34, dark=2200, bright=3000, attack=0.1, release=3.5)
    bass(S10, DUR - 0.5, 41, 0.2)


def effects():
    S2, S3, S4, S5, S6 = BASE["S2"], BASE["S3"], BASE["S4"], BASE["S5"], BASE["S6"]
    for t0 in (S2 - 0.05, S2 + 5.85, S4 - 0.05, BASE["S7"] - 0.05, BASE["S8"] - 0.1, BASE["S9"] - 0.1, BASE["S9b"] - 0.1, BASE["S10"] - 0.1):
        whoosh(t0)
    whoosh(BASE["S7b"] + 0.25, 0.6, 0.26)                # the avoidance wipe
    whoosh(S4 + 7.3, 0.9, 0.3)                          # push into the blocked chip
    hit(2.3, 0.28, body=90)                             # OPERATING SYSTEM?
    for i in range(4):                                  # each S2 mapping lands
        click(S2 + 0.9 + i * 1.35, 0.07, 1800)
    hit(S3 + 0.1, 0.55, body=70, tail=1.0)              # title flash
    bell(S3 + 0.4, [74, 81], 0.05, spacing=0.12)
    for a in (0.25, 0.7, 1.2):                          # UNTIL / IT / DEADLOCKS.
        slam(S5 + a, 0.6)
    blip(S5 + 1.65, 900, 300, 0.12, 0.35)               # the full stop drops into the graph
    for a in (1.4, 1.95, 3.2, 3.75, 5.0, 5.55):         # edges draw
        click(S6 + a, 0.09, 2000 if a in (1.4, 3.2, 5.0) else 1500)
    for a in (2.35, 4.15):                              # A and B block
        thunk(S6 + a, 0.22)
    impact(PEAK, 0.95)                                  # THE DEADLOCK
    bell(S6 + 8.0, [76, 71], 0.09, spacing=0.14, decay=0.8)   # detected
    bell(S6 + 9.8, [65, 69, 72, 77], 0.08, spacing=0.07, decay=1.2)   # recovered
    bell(BASE["S7b"] + 0.5, [69, 74], 0.06, spacing=0.12)    # avoidance
    for k in range(8):                                  # metrics count up
        click(BASE["S8"] + 2.7 + k * 0.12, 0.05, 3000)
    blip(BASE["S9"] + 1.0, 400, 1200, 0.12, 0.4)        # fork()
    blip(BASE["S9"] + 2.55, 700, 1100, 0.1, 0.15, pan=-0.3)   # SCHED ->
    blip(BASE["S9"] + 3.45, 1100, 700, 0.1, 0.15, pan=0.3)    # <- ORDER
    for i in range(8):                                  # the route positions
        click(BASE["S9"] + 4.2 + i * 0.12, 0.05, 2600 - i * 120)
    click(BASE["S9b"] + 0.9, 0.08, 2200)
    click(BASE["S9b"] + 1.5, 0.08, 2200)
    hit(BASE["S10"] + 0.25, 0.5, body=65, tail=1.4)     # end title
    bell(BASE["S10"] + 1.7, [77, 81, 84], 0.05, spacing=0.09, decay=1.6)   # URL


def reverb(x, seconds=2.2):
    t = tt(seconds)
    out = np.zeros_like(x)
    for c in range(2):
        ir = RNG.normal(0, 1, len(t)) * np.exp(-t / (seconds / 4.5))
        ir = lp(ir, 5000)
        ir /= np.sqrt(np.sum(ir ** 2))
        out[c] = fftconvolve(x[c], ir)[: x.shape[1]]
    return out


def main(path):
    score()
    effects()
    mix = MUSIC * 0.9 + SFX + reverb(SEND) * 0.35
    mix = hp(mix, 28)
    t = np.arange(N) / SR
    mix *= np.clip(t / 0.3, 0, 1) * np.clip((DUR - t) / 1.2, 0, 1)   # fade in/out
    mix = np.tanh(1.3 * mix / (np.max(np.abs(mix)) + 1e-9)) / np.tanh(1.3)
    mix *= 10 ** (-1.0 / 20)
    wavfile.write(path, SR, (mix.T * 32767).astype(np.int16))
    print("wrote %s  %.2f s  peak scene times: PEAK=%.2f" % (path, DUR, PEAK))


if __name__ == "__main__":
    main(sys.argv[1])
