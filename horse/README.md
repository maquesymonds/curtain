# Neon Mane — Typographic Horse

A fullscreen web experiment: the horse photo fills the screen, and a typographic
neon-pink mane of hanging "code" is simulated on top of it with Verlet physics,
idle wind, and body collision.

## Video vs static mode

Set `mode` in `js/config.js` (`"video"` or `"static"`), or override in the URL:
`?mode=video` / `?mode=static`.

- **video** — the `Caballo.mp4` clip plays fullscreen; the mane roots ride an
  animated spline built from tracking keyframes, collision uses animated
  primitives, and both wind and the loop are periodic over 5s.
- **static** — the original `Caballo1.png`; roots come from the white crest
  line and collision uses the PNG mask (kept as a fallback/preview).

### Editing the tracking (video mode)

All tracking lives in **`js/tracking.js`** → `TRACKING.keyframes`. Each keyframe
is a `time` (seconds) plus normalized `[x, y]` for five points along the crest:
`forehead, skull, upperNeck, midNeck, lowerNeck`. Keep the last keyframe (t=5)
identical to the first (t=0) so the loop is seamless.

**Calibration:** open `?mode=video&calibrate=1` (or press **C**). It shows the
control points, the root spline, the collision primitives and the video time.
- **space** play/pause · **← →** ±0.25s · **, .** ±1 frame
- **click the horse** → prints `t=… [x, y]` (normalized) to the browser console
  so you can copy values straight into the keyframes.

Collision primitive sizes and the loop-settle strength are in `js/config.js`
under `primitives` and `loopConverge`.

## How to run

There is **no build step and no npm** — it's plain HTML + ES modules. Modules
only load over HTTP, so open it through a tiny static server (not by
double-clicking the file):

```bash
cd /Users/maquesymonds/Desktop/curtain
python3 -m http.server 8000
```

Then open **http://localhost:8000/horse/** in your browser.

- Press **D** to toggle the debug overlay (green root dots + blue collision body).
- Or open **http://localhost:8000/horse/?debug=1** to start with it on.

## Files

```
horse/
  index.html            fullscreen <img> background + transparent <canvas>
  style.css             cover layout for the photo + overlay
  Caballo1.png          background photo
  mane-root-guide.png   green line: where mane roots are born
  horse-collision-mask.png  alpha silhouette of the solid body
  js/
    config.js           ALL tuning values (start here)
    main.js             bootstrap, resize, requestAnimationFrame loop
    cover.js            object-fit:cover transform + mask/guide alignment
    imageSampler.js     root sampling + collision grid
    strand.js           one strand = chain of particles + chars
    particle.js         Verlet particle
    hairSystem.js       physics step, glyph atlas, renderer, debug overlay
    wind.js             procedural idle wind field
    vec2.js / utils.js  small helpers
```

## Config values you'll tweak most (`js/config.js`)

| Value          | What it does                                        |
| -------------- | --------------------------------------------------- |
| `strandCount`  | number of strands (~45–60)                          |
| `lengthRange`  | `[shortest, longest]` strand length in px           |
| `gravity`      | downward pull (higher = heavier hang)               |
| `damping`      | drag (lower = calmer, more resistance)              |
| `windStrength` | amplitude of the idle breeze                        |
| `glowIntensity`| neon glow radius baked into each glyph              |
| `fontSize`     | glyph size in px                                    |
| `color`        | mane color (neon pink `#ff2fae`)                    |

Other useful knobs: `lengthProfile` (front→back length shape), `words` (text
pool), `drapeX` / `drapeLean` (which side the mane falls to), `cohesion`
(strand togetherness), and the `align` / `maskAlign` blocks.

## Alignment note

The root-guide and collision-mask are **1448×1086** while the photo is
**1672×941** (different aspect ratios). They're mapped as normalized overlays
onto the photo's cover rectangle, with `align` (roots) and `maskAlign`
(collision body) offsets to compensate. If you redraw the guides at the photo's
exact resolution later, you can reset those offsets to zero. Use the debug
overlay (**D**) to check and fine-tune alignment.
