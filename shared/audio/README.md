# shared/audio

## `mane.wav` — 508 KB, mono, 44.1 kHz, 16-bit

The curtain's instrument. **One** sample sheet holding three regions, loaded once
by `shared/js/interactionSound.js` and played by the cursor:

```
grains   6 slots x 0.300 s   offset 0.000     one per stretch of curtain crossed
accent   1 slot  x 1.500 s   offset 1.800     the rare big-gesture resonance
bed      1 loop  x 2.600 s   offset 3.300     the continuous glue layer
```

Built from the five `whimsical*.wav` at the project root by
`build-mane-instrument.py`. It is **generated, not authored** — do not edit it by
hand, re-run the script:

```
python3 shared/audio/build-mane-instrument.py
```

The script's header explains why it exists at all. Short version: measured, the
five source clips are the same instrument in the same key (A flat major) but they
sit 17 dB apart in level, spread over 2.3 octaves of register, and not one of
them reaches half its level inside 150 ms. None of those three faults can be
fixed at runtime, so they are fixed here — every region normalised to the same
K-weighted loudness, every grain slot resampled by whole octaves so its A flat
partial lands on A flat 5, every grain windowed to decay to exactly zero.

The layout above is mirrored by `SHEET` in `interactionSound.js`. **Change one and
you must change the other**, or grains will play across each other's slots.

## `mane-preview.wav` — 1.4 MB, stereo

Not a dependency. **Nothing loads this** — it is a rendering of the instrument
being played, there so the sound can be judged without hovering a piece, and safe
to delete.

Eight seconds, five acts, produced by `interactionSound.js`'s own
`renderPreview()` through the real node graph:

| act | 0–1.5 s | 1.5–3 s | 3–4 s | 4–5.5 s | 5.5–8 s |
|---|---|---|---|---|---|
| gesture | slow brush, low | brisk sweep across | hand parked, **still** | fast flick back | released |
| speed | 0.18 | 0.55 | **0.00** | 1.00 | — |
| rms | −28.8 dB | −19.5 dB | −24.4 dB | −15.9 dB | decays to −51 dB |

The parked act is not a state of its own — it is the previous sweep's release
running out. **No movement means no sound**: brushing hair makes noise while the
hand travels, and a hand at rest in hair is silent however much hair it is
resting in. Measured in a real browser, stopping the cursor dead on the mane
decays monotonically to inaudible (−60 dB) in 1.8 s, the perceptible part being
the first 0.8 s. If that release wants to be shorter the two knobs are
`SOUND.smooth.release` and `SOUND.space.feedback`.

To re-render it after changing the instrument, see `renderPreview()` in
`shared/js/interactionSound.js`.

## `ambient.wav` — 1.38 MB, stereo, 24 kHz, 16-bit

The bed that runs under the whole exhibition, loaded by `shared/js/ambient.js`
from the **shell** (root `index.html`) and not by any piece — each piece is an
iframe with its own `AudioContext`, so a bed started inside one would be a
different bed per piece, at its own point in the recording, and every scene
change would jump the tape.

**Exactly 15.125000 s = 363000 samples = 3 × the horse clip.** `horse/js/config.js`
declares the clip as 121 frames at 24 fps (5.0416667 s) and makes the wind field
periodic over exactly that so the mane does not jump when the video wraps; the
bed is three of those for the same reason applied to sound. A period that is an
exact multiple of the picture's holds a fixed relationship to it; any other length
slides, and a bed that slides against a 5 s loop is one you eventually hear as a
separate thing. (Not phase-*locked* — a `<video loop>` resets `currentTime` every
5.04 s, so there is no way to know which of the three turns to align to, and
waiting for one would mean up to five seconds of silence after the first click.
Commensurate periods are the part that matters.)

Built from `snownight.wav` (132 s, 48 kHz 24-bit, **not in the repo** — 38 MB)
by `build-ambient.py`, which takes the source path as an optional argument and
defaults to `~/Desktop/snownight.wav`:

```
python3 shared/audio/build-ambient.py [ruta/al/origen.wav]
```

What the script found and what it does about it is in its docstring. The short
version, because one of the three is the whole story:

| | measured | done about it |
|---|---|---|
| level | −43.9 dB rms, peak 0.102 | normalised to −33.0 dB rms, peak 0.60 |
| **infrasound** | **side channel 90.3% below 20 Hz, mid another 39.8%** | **high-pass at 45 Hz: peak 0.275 → 0.098, 8.9 dB of headroom returned, nothing audible touched** |
| band content | 99.6% below 2 kHz, 0.4% above 6 kHz | 24 kHz sample rate — 1.38 MB instead of 5.8 |

The apparent very-wide stereo (L/R correlation −0.756, side +8.3 dB over mid) was
that infrasound being out of phase, not audible width: after the high-pass, side
sits −2.3 dB *under* mid. Without the high-pass, normalising to any sensible level
drove the peak limiter 8.2 dB and the file came out 8 dB below its own target —
the gain was being spent on content nobody can hear.

**The first 0.6 s is a gust**, −29 dB against the −47/−51 dB bed that follows. It
is the part of the take that works, so the loop starts there and the gust returns
once every 15.125 s — once every three turns of the horse. To make it a one-off
intro instead of a recurring swell, set `START = 0.75` in the script; the length
stays locked to three loops either way.

The seam needs no crossfade: a 6 ms fade in and a 30 ms fade out to true zero
give a measured wrap discontinuity of exactly **0.00000** against a largest
internal sample step of 0.638. A long crossfade would have been wrong here anyway
— it would smear the gust, and a transient onset is *allowed* to be
discontinuous.

Note that a browser decoding this into a 44.1 kHz context resamples it to
15.124989 s — half a sample short, 0.011 ms, because 15.125 s is not a whole
number of samples at 44100. Irrelevant, and stated so nobody re-derives it.

Live knobs while it plays: `window.ambient.AMBIENT.level`,
`window.ambient.setAmbientEnabled(false)`, `window.ambient.ambientLevel()` for a
metered readout of what is actually coming out.
