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
