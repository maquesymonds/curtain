#!/usr/bin/env python3
"""
BUILD-AMBIENT — turns a long field recording into shared/audio/ambient.wav, the
continuous bed that plays under the whole exhibition.

    python3 shared/audio/build-ambient.py [ruta/al/origen.wav]

WHY THE LENGTH IS WHAT IT IS
    horse/js/config.js declares the clip as `duration: 121 / 24` — 121 frames at
    24 fps, 5.0416667 s — and the wind field is made periodic over exactly that
    so the mane does not jump when the video wraps. The bed is built to THREE of
    those, 15.125 s, for the same reason applied to sound: a period that is an
    exact multiple of the picture's keeps the two in a fixed relationship for as
    long as the page is open. Any other length drifts, and a bed that drifts
    against a 5 s loop is a bed you eventually notice.

    15.125 s x 24000 Hz = 363000 samples exactly. No rounding anywhere.

WHAT WAS MEASURED IN THE SOURCE, AND WHAT THIS DOES ABOUT IT
    snownight.wav, 132.3 s, 48 kHz 24-bit stereo:

    - Level: -43.9 dB rms overall, peak 0.102. Far too quiet to sit under
      anything, so it is normalised here rather than by turning a runtime gain
      up to a number that has no headroom left above it.

    - The first 0.6 s is a GUST: -29 dB against the -47/-51 dB of the steady bed
      that follows, a 20 dB event. It is the part of the recording that works,
      so the bed starts there and the gust returns once every 15.125 s — every
      three turns of the horse. If it ever wants to be a one-off instead of a
      pulse, see INTRO below.

    - Band content: 99.6% of the energy is below 2 kHz and 0.4% above 6 kHz. This
      is a low rumble, so 48 kHz is four times more than it can use. Decimated to
      24 kHz (Nyquist 12 kHz, keeping 99.9%) the file is 1.4 MB instead of 5.8.

    - INFRASOUND, which turned out to be the whole story. L/R correlation is
      -0.756 and the side signal sits +8.3 dB above the mid, which reads like
      very wide stereo — it is not. Broken down by band, the side is 90.3% below
      20 Hz and the mid another 39.8%, so more than half of this recording's
      energy is at or under the bottom of hearing, and the out-of-phase part is
      almost entirely infrasonic rumble.

      It cannot be heard and it costs everything. High-passing at 45 Hz takes the
      peak from 0.2748 to 0.0985 — 8.9 dB of headroom returned — while leaving
      every audible band untouched. Without it, normalising to any sensible level
      drove the peak limiter 8.2 dB and the file came out 8 dB under its own
      target: the gain was being spent on content no one can hear.

      So: high-pass first, then normalise on the plain RMS of what is left.
      K-weighting is deliberately NOT used here, unlike in
      build-mane-instrument.py — it discounts the low end, which is exactly where
      this material lives, and measuring a rumble with a filter that ignores
      rumble is how the first attempt went wrong.
"""

import numpy as np, os, sys, wave
from scipy.signal import resample_poly, butter, sosfiltfilt

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/Desktop/snownight.wav")
OUT = os.path.join(HERE, "ambient.wav")

# Mirrors horse/js/config.js VIDEO. If the clip is ever recut, this is the one
# number to change here — and shared/js/ambient.js states it too.
HORSE_LOOP = 121 / 24  # 5.0416667 s
LOOPS = 3
OUT_SR = 24000

# Start of the take. 0.0 keeps the gust; see INTRO in the docstring.
START = 0.0
# INTRO: set to ~0.75 to begin after the gust instead, giving a steady bed with
# no recurring swell. The length stays locked to LOOPS either way.
HIGHPASS = 45.0  # Hz. The single most important number here — see INFRASOUND.
TARGET_RMS = -33.0  # dB, plain, stereo. With this material's 28.6 dB crest that
# lands the peak near 0.63: present, and nowhere near the ceiling.
PEAK_CEIL = 0.92
FADE_IN, FADE_OUT = 0.006, 0.030  # s — see the note by the seam check below


def read_wav(path):
    w = wave.open(path)
    sr, ch, sw = w.getframerate(), w.getnchannels(), w.getsampwidth()
    raw = w.readframes(w.getnframes())
    if sw == 3:
        a = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3).astype(np.int32)
        x = a[:, 0] | (a[:, 1] << 8) | (a[:, 2] << 16)
        x = np.where(x & 0x800000, x - 0x1000000, x).astype(np.float64) / 2**23
    elif sw == 2:
        x = np.frombuffer(raw, dtype="<i2").astype(np.float64) / 32768
    else:
        raise SystemExit(f"{path}: {sw*8}-bit no soportado")
    return x.reshape(-1, ch), sr


def db(x):
    return 20 * np.log10(np.sqrt(np.mean(x**2)) + 1e-12)


def highpass(st, sr, f0):
    sos = butter(2, f0 / (sr / 2), "highpass", output="sos")
    return np.stack([sosfiltfilt(sos, st[:, c]) for c in range(st.shape[1])], axis=1)


if not os.path.exists(SRC):
    raise SystemExit(f"no encuentro el origen: {SRC}\nuso: build-ambient.py [ruta/al/origen.wav]")

st, sr = read_wav(SRC)
print(f"origen  {os.path.basename(SRC)}  {len(st)/sr:.2f}s  {sr} Hz  {st.shape[1]}ch")

want = LOOPS * HORSE_LOOP
i0 = int(round(START * sr))
n_src = int(round(want * sr))
if len(st) < i0 + n_src:
    raise SystemExit(f"el origen dura {len(st)/sr:.2f}s y hacen falta {START+want:.3f}s")
seg = st[i0 : i0 + n_src]
print(f"corte    {START:.3f}s .. {START+want:.3f}s   ({LOOPS} x {HORSE_LOOP:.7f}s = {want:.3f}s)")

def report(st, sr, label):
    mid, side = st.mean(axis=1), (st[:, 0] - st[:, 1]) / 2
    print(f"{label:8s} estereo {db(st):6.1f} dB   mid {db(mid):6.1f}   side {db(side):6.1f}   "
          f"(side-mid {db(side)-db(mid):+5.1f})   pico {np.abs(st).max():.4f}")


report(seg, sr, "antes")
out = highpass(seg, sr, HIGHPASS)
report(out, sr, f"HP{HIGHPASS:.0f}")

out = out * 10 ** ((TARGET_RMS - db(out)) / 20)
pk = np.abs(out).max()
if pk > PEAK_CEIL:
    out *= PEAK_CEIL / pk
    print(f"         limitado por pico: {20*np.log10(PEAK_CEIL/pk):.1f} dB")

# Decimate LAST, so every measurement above was taken on the full-band material.
up, down = OUT_SR, sr
from math import gcd
k = gcd(up, down)
out = np.stack([resample_poly(out[:, c], up // k, down // k) for c in range(2)], axis=1)
n = int(round(want * OUT_SR))
out = out[:n] if len(out) >= n else np.pad(out, ((0, n - len(out)), (0, 0)))

# The seam. A long crossfade is wrong for THIS material: the head is a transient
# and blending the quiet tail into it would smear the one event the take is here
# for. A transient onset is allowed to be discontinuous — that is what an onset
# is — so all the seam needs is to not CLICK. Measured, the tail sits at -50.8 dB
# and the head at -30.8, so a 30 ms fade to true zero is 20 dB under the thing
# that follows it and cannot be heard.
fi, fo = int(FADE_IN * OUT_SR), int(FADE_OUT * OUT_SR)
out[:fi] *= (0.5 * (1 - np.cos(np.linspace(0, np.pi, fi))))[:, None]
out[-fo:] *= (0.5 * (1 + np.cos(np.linspace(0, np.pi, fo))))[:, None]

report(out, OUT_SR, "final")
wrap = np.abs(out[0] - out[-1]).max()
inner = np.abs(np.diff(out, axis=0)).max()
print(f"costura  salto {wrap:.5f}  vs mayor salto interno {inner:.5f}  ->  "
      f"{'inaudible' if wrap <= inner else 'REVISAR'}")

w = wave.open(OUT, "wb")
w.setnchannels(2); w.setsampwidth(2); w.setframerate(OUT_SR)
w.writeframes((np.clip(out, -1, 1) * 32767).astype("<i2").tobytes())
w.close()
print(f"\nescrito  shared/audio/ambient.wav  {n} muestras = {n/OUT_SR:.6f}s  "
      f"{OUT_SR} Hz 16-bit estereo  {os.path.getsize(OUT)/1024/1024:.2f} MB")
