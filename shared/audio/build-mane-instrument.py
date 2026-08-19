#!/usr/bin/env python3
# =============================================================================
#  BUILD-MANE-INSTRUMENT — turns the five whimsical*.wav clips at the project
#  root into ONE sample sheet, shared/audio/mane.wav.
#
#  Why this script exists instead of loading the five clips directly: measured,
#  the clips are the same instrument in the same key (A flat major: the chroma
#  of all five together is C, Db, Eb, F, G, Ab, and Ab reads as the tonic at
#  1.00 in three of them) but they are NOT interchangeable as sounds —
#
#      clip          RMS      centroid   attack to 50%   peak at
#      whimsical    -15.4 dB   934 Hz        156 ms      1688 ms
#      whimsical1   -31.8 dB   431 Hz        304 ms       489 ms
#      whimsical2   -32.1 dB   860 Hz        335 ms       530 ms
#      whimsical3   -27.4 dB  1052 Hz        191 ms       385 ms
#      whimsical4   -30.4 dB  2090 Hz        190 ms       388 ms
#
#  17 dB of level spread, 2.3 octaves of register spread, and not one of them
#  reaches half its level inside 150 ms. Chained at random that reads as five
#  different instruments arriving late. None of those three faults can be fixed
#  at runtime, so they get fixed here, once:
#
#    LEVEL     every region normalised to the same K-weighted loudness, so the
#              runtime never has to compensate for which slot it picked.
#    REGISTER  every grain slot resampled by an OCTAVE (an exact power of two,
#              the only transposition that cannot alter a chord's quality) so
#              its Ab partial lands on the same reference, Ab5. After this a
#              playbackRate means the same interval whatever slot is playing —
#              which is what makes six slices behave as one sampled instrument.
#    ATTACK    each grain is cut AT an onset and windowed to decay to exactly
#              zero, so the runtime gets a 4 ms attack and needs no release
#              envelope to avoid a click.
#
#  Nothing here is generative — same inputs, same output. Re-run after changing
#  a source clip:  python3 shared/audio/build-mane-instrument.py
# =============================================================================

import numpy as np, wave, os
from scipy.signal import resample_poly, butter, sosfilt, sosfiltfilt

SR = 44100
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mane.wav")

# ---- layout, in seconds. Mirrored by SHEET in shared/js/interactionSound.js;
# ---- change one and you must change the other.
GRAIN_DUR, N_GRAINS = 0.300, 6
ACCENT_DUR = 1.500
BED_DUR, BED_XFADE = 2.600, 0.400

# ---- the six grains. (source, onset seconds, octave shift to reach Ab5).
# Onsets are measured transient positions, not guesses. `oct` is how many
# octaves DOWN the slice must go: whimsical4's cluster is F6/G6/Ab6, an octave
# above whimsical2's F5/G5/Ab5 — literally the same chord, which is why two
# clips can act as one instrument's registers.
GRAINS = [
    ("whimsical4.wav", 0.110, 1),  # Ab6 cluster -> Ab5
    ("whimsical4.wav", 0.239, 1),
    ("whimsical4.wav", 0.379, 1),
    ("whimsical2.wav", 0.324, 0),  # already Ab5 — the body of the set
    ("whimsical2.wav", 0.519, 0),
    ("whimsical3.wav", 0.070, 0),  # Eb colour, for variety not for pitch
]
# The accent lives an octave below the grains on purpose: a sustained garnish
# belongs under the detail layer, not beside it.
ACCENT = ("whimsical.wav", 0.470, 2)  # -> Ab4
BED_SRC = ("whimsical.wav", 0.600, 3)  # -> Ab3, then smeared and filtered

# K-weighted loudness targets. The bed sits lowest because it is CONTINUOUS:
# equal numbers on a sustained layer and a transient one put the sustained one
# far in front.
TARGET_GRAIN, TARGET_ACCENT, TARGET_BED = -20.0, -23.0, -26.0
PEAK_CEIL = 0.90


def read24(path):
    w = wave.open(path)
    ch, sw = w.getnchannels(), w.getsampwidth()
    raw = w.readframes(w.getnframes())
    if sw == 3:
        a = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3).astype(np.int32)
        x = a[:, 0] | (a[:, 1] << 8) | (a[:, 2] << 16)
        x = np.where(x & 0x800000, x - 0x1000000, x).astype(np.float64) / 2**23
    else:
        x = np.frombuffer(raw, dtype=np.int16).astype(np.float64) / 32768
    assert w.getframerate() == SR, f"{path} is not {SR} Hz"
    return x.reshape(-1, ch).mean(axis=1)


def kweight(x):
    """BS.1770's pre-filter, approximated: drop everything below 60 Hz, tilt
    +4 dB above 1.5 kHz. Loudness, not RMS — equal RMS across two octaves does
    not sound equal, and these slices span two octaves."""
    hp = sosfiltfilt(butter(2, 60 / (SR / 2), "highpass", output="sos"), x)
    hi = sosfiltfilt(butter(2, 1500 / (SR / 2), "highpass", output="sos"), hp)
    return hp + (10 ** (4 / 20) - 1) * hi


def loudness(x):
    y = kweight(x)
    return 20 * np.log10(np.sqrt(np.mean(y**2)) + 1e-12)


def normalise(x, target):
    g = 10 ** ((target - loudness(x)) / 20)
    y = x * g
    pk = np.abs(y).max()
    if pk > PEAK_CEIL:  # peak guard, reported so it is never silent
        y *= PEAK_CEIL / pk
        print(f"      peak-limited by {20*np.log10(PEAK_CEIL/pk):.1f} dB")
    return y


def octave_down(x, n):
    """Resample so the material plays n octaves lower at the same rate. up=2**n
    stretches time and drops pitch by exactly that factor — a power of two, so
    every interval inside the chord survives untouched."""
    return x if n == 0 else resample_poly(x, 2**n, 1)


def cut(x, start_s, dur_s, fade_in=0.002, decay_from=0.55):
    """A grain: cut at the onset, 2 ms raised-cosine in (kills the edge click,
    keeps the transient), then a cosine-squared decay to EXACTLY zero over the
    tail. Ending at zero is what lets the runtime fire a grain with no release
    envelope and never click."""
    i = int(start_s * SR)
    n = int(dur_s * SR)
    y = np.zeros(n)
    seg = x[i : i + n]
    y[: len(seg)] = seg
    fi = int(fade_in * SR)
    y[:fi] *= 0.5 * (1 - np.cos(np.linspace(0, np.pi, fi)))
    d0 = int(decay_from * n)
    t = np.linspace(0, np.pi / 2, n - d0)
    y[d0:] *= np.cos(t) ** 2
    return y


def build_bed():
    src, start, oct_ = BED_SRC
    x = octave_down(read24(os.path.join(ROOT, src)), oct_)
    n, xf = int(BED_DUR * SR), int(BED_XFADE * SR)
    i = int(start * SR * 2**oct_)
    mat = x[i : i + n + xf]
    assert len(mat) >= n + xf, "bed source too short"

    # PAD-IFY. Four octaves down already smears the material, but the clip's
    # own ~80 ms tremolo survives as a pulse, and a pulse makes the loop point
    # audible as a tick. Summing the window with a half-length-shifted copy of
    # itself doubles the event density and halves the periodicity.
    mat = 0.62 * mat + 0.45 * np.roll(mat, n // 2)
    # Then take the body only: a bed is the part of a sound that has no edge.
    mat = sosfilt(butter(4, 1000 / (SR / 2), "lowpass", output="sos"), mat)
    mat -= mat.mean()  # DC, or the loop point clicks no matter how it is faded

    loop = mat[:n].copy()
    # Seamless loop: blend the head with the material that WOULD have followed
    # the tail, equal-power so the level does not dip across the seam.
    t = np.linspace(0, 1, xf)
    loop[:xf] = loop[:xf] * np.sqrt(t) + mat[n : n + xf] * np.sqrt(1 - t)
    return loop


print("building shared/audio/mane.wav")
regions, parts = {}, []
cursor = 0.0

print("  grains")
for k, (src, onset, oct_) in enumerate(GRAINS):
    x = octave_down(read24(os.path.join(ROOT, src)), oct_)
    g = cut(x, onset * 2**oct_, GRAIN_DUR)
    print(f"    slot {k}  {src} @{onset:.3f}s  -{oct_} oct  in {loudness(g):6.1f} dB", end="")
    g = normalise(g, TARGET_GRAIN)
    print(f"  -> {loudness(g):6.1f} dB  peak {np.abs(g).max():.2f}")
    parts.append(g)
regions["grains"] = (cursor, GRAIN_DUR, N_GRAINS)
cursor += GRAIN_DUR * N_GRAINS

print("  accent")
src, onset, oct_ = ACCENT
a = cut(octave_down(read24(os.path.join(ROOT, src)), oct_), onset * 2**oct_, ACCENT_DUR, decay_from=0.35)
a = normalise(a, TARGET_ACCENT)
print(f"    {src} @{onset:.3f}s  -{oct_} oct  -> {loudness(a):6.1f} dB  peak {np.abs(a).max():.2f}")
parts.append(a)
regions["accent"] = (cursor, ACCENT_DUR, 1)
cursor += ACCENT_DUR

print("  bed")
b = normalise(build_bed(), TARGET_BED)
print(f"    loop {BED_DUR}s, {BED_XFADE}s equal-power seam  -> {loudness(b):6.1f} dB  peak {np.abs(b).max():.2f}")
parts.append(b)
regions["bed"] = (cursor, BED_DUR, 1)
cursor += BED_DUR

sheet = np.concatenate(parts)
pcm = np.clip(sheet, -1, 1)
pcm = (pcm * 32767).astype("<i2")
w = wave.open(OUT, "wb")
w.setnchannels(1)
w.setsampwidth(2)
w.setframerate(SR)
w.writeframes(pcm.tobytes())
w.close()

print(f"\n  {len(sheet)/SR:.3f}s mono {SR} Hz 16-bit  =  {os.path.getsize(OUT)/1024:.0f} KB")
print("\n  SHEET table for shared/js/interactionSound.js:")
for k, (off, dur, n) in regions.items():
    print(f"    {k:8s} offset {off:.3f}  dur {dur:.3f}  slots {n}")
