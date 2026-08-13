// ============================================================================
//  TRACKING  (edit the keyframes here)
//
//  A small set of control points ride along the horse's mane crest, from the
//  forehead down to the lower neck. Each keyframe gives their NORMALIZED
//  (0..1) position in the VIDEO frame at a moment in time. We interpolate them
//  by video.currentTime, fit a smooth spline through them for the mane root
//  curve, and derive animated collision primitives from the same points.
//
//  HOW TO CALIBRATE
//  ----------------
//  1. Open ?calibrate (or press "c"). Physics and glyphs switch off; only the
//     video plus the overlay is left, so nothing else can mislead you.
//  2. Pause with SPACE, step ±0.25s with ←/→, step exactly one frame with , / .
//  3. Click anywhere on the horse — the console logs { frame, time, screen,
//     normalizedVideo }. `normalizedVideo` is what goes into the keyframes.
//  4. Adjust the numbers in TRACKING.keyframes below for that time.
//  Keep the LAST keyframe identical to the FIRST so the loop is seamless.
// ============================================================================

import { CONFIG } from "./config.js";
import { smoothstep } from "../../shared/js/utils.js";

// Order of the control points along the crest, front (forehead) → back (neck).
export const TRACK_ORDER = ["forehead", "skull", "upperNeck", "midNeck", "lowerNeck"];

export const TRACKING = {
  // Single source of truth: the real clip length (121 frames / 24 fps).
  duration: CONFIG.video.duration,
  // times must be ascending; first time 0 and last time === duration, with
  // identical points, so currentTime wrapping back to 0 doesn't jump.
  keyframes: [
    {
      time: 0.0,
      points: {
        forehead: [0.57, 0.20],
        skull: [0.51, 0.23],
        upperNeck: [0.46, 0.31],
        midNeck: [0.40, 0.45],
        lowerNeck: [0.35, 0.62],
      },
    },
    {
      time: 1.25,
      points: {
        forehead: [0.57, 0.16],
        skull: [0.51, 0.20],
        upperNeck: [0.45, 0.29],
        midNeck: [0.39, 0.44],
        lowerNeck: [0.34, 0.62],
      },
    },
    {
      time: 2.5,
      points: {
        forehead: [0.52, 0.15],
        skull: [0.47, 0.22],
        upperNeck: [0.43, 0.33],
        midNeck: [0.40, 0.49],
        lowerNeck: [0.36, 0.66],
      },
    },
    {
      time: 3.75,
      points: {
        forehead: [0.50, 0.15],
        skull: [0.45, 0.21],
        upperNeck: [0.42, 0.31],
        midNeck: [0.38, 0.45],
        lowerNeck: [0.34, 0.63],
      },
    },
    {
      time: CONFIG.video.duration, // === time 0 (seamless loop)
      points: {
        forehead: [0.57, 0.20],
        skull: [0.51, 0.23],
        upperNeck: [0.46, 0.31],
        midNeck: [0.40, 0.45],
        lowerNeck: [0.35, 0.62],
      },
    },
  ],
};

// Interpolate the control points at time t (seconds), looping over duration.
// Returns { forehead:[x,y], skull:[x,y], ... } in normalized video coords.
export function sampleTracking(t) {
  const kf = TRACKING.keyframes;
  const dur = TRACKING.duration;
  t = ((t % dur) + dur) % dur;

  let i = 0;
  while (i < kf.length - 1 && kf[i + 1].time <= t) i++;
  const a = kf[i];
  const b = kf[Math.min(i + 1, kf.length - 1)];
  const span = b.time - a.time || 1;
  const f = smoothstep(0, 1, (t - a.time) / span); // eased blend

  const out = {};
  for (const key of TRACK_ORDER) {
    const pa = a.points[key];
    const pb = b.points[key];
    out[key] = [pa[0] + (pb[0] - pa[0]) * f, pa[1] + (pb[1] - pa[1]) * f];
  }
  return out;
}

// ---- root spline ----------------------------------------------------------
// Catmull-Rom through an ordered array of [x, y] control points; u in [0,1]
// over the whole curve. The curve is OPEN: the first and last points are
// duplicated as their own tangent neighbours, so it starts and ends exactly on
// them instead of looping around. Used for both the 5-point tracking curve and
// the 14-point editable curve.
export function catmullRomAt(P, u) {
  const n = P.length;
  if (n === 0) return [0, 0];
  if (n === 1) return [P[0][0], P[0][1]];
  const s = Math.max(0, Math.min(0.999999, u)) * (n - 1);
  const i = Math.floor(s);
  const t = s - i;
  const p0 = P[Math.max(0, i - 1)];
  const p1 = P[i];
  const p2 = P[Math.min(n - 1, i + 1)];
  const p3 = P[Math.min(n - 1, i + 2)];
  const t2 = t * t;
  const t3 = t2 * t;
  const cr = (a, b, c, d) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return [cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])];
}

// Same curve, addressed by the named tracking points.
export function splinePoint(points, u) {
  return catmullRomAt(
    TRACK_ORDER.map((k) => points[k]),
    u
  );
}

// Cumulative arc-length table over a curve. `at(u)` must return [x, y] — and it
// matters WHICH space those are in: sampling a normalized curve measures length in
// an anisotropic space (x spans drawW, y spans drawH), so "even spacing" there is
// not even spacing on screen. Callers that care pass a screen-space `at`.
function arcTable(at, samples) {
  const dense = [];
  for (let i = 0; i <= samples; i++) dense.push(at(i / samples));
  const cum = [0];
  for (let i = 1; i < dense.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  }
  return { dense, cum, total: cum[cum.length - 1] };
}

// Resample a curve into `count` points spaced evenly by ARC LENGTH (not by
// parameter u, which bunches points up where the curve bends). `at(u)` must
// return [x, y]. Used to seed the 14 editable points from the 5-point curve.
export function resampleByArcLength(at, count, samples) {
  const { dense, cum, total } = arcTable(at, samples);
  if (total <= 0) return dense.slice(0, count).map((p) => [p[0], p[1]]);

  const out = [];
  let seek = 1;
  for (let k = 0; k < count; k++) {
    const target = (k / (count - 1)) * total;
    while (seek < cum.length - 1 && cum[seek] < target) seek++;
    const span = cum[seek] - cum[seek - 1] || 1;
    const f = (target - cum[seek - 1]) / span;
    const a = dense[seek - 1];
    const b = dense[seek];
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  return out;
}

// The same walk, returning the u PARAMETERS whose points are evenly spaced by arc
// length instead of the points themselves. The strand roots need the parameter and
// not the position: `u` is what updateRoots() re-samples every frame as the crest
// moves, and what the length profile is read with. Handing back points would pin
// the roots to one frame's pose.
//
// Even spacing by u is NOT even spacing along the crest: the 14 tracked points are
// placed by hand, so the parameter runs fast where they are far apart. Measured on
// this track at 84 roots, u-uniform spacing ranges 3.4..16.1 screen px — a 4.7x
// spread, which is visible as holes in the mane and clumps elsewhere.
export function arcLengthUs(at, count, samples) {
  const { cum, total } = arcTable(at, samples);
  if (count <= 1) return [0];
  if (total <= 0) return Array.from({ length: count }, (_, k) => k / (count - 1));

  const out = [];
  let seek = 1;
  for (let k = 0; k < count; k++) {
    const target = (k / (count - 1)) * total;
    while (seek < cum.length - 1 && cum[seek] < target) seek++;
    const span = cum[seek] - cum[seek - 1] || 1;
    const f = (target - cum[seek - 1]) / span;
    out.push((seek - 1 + f) / samples);
  }
  return out;
}

// ---- animated collision primitives ----------------------------------------
// Derived from the tracked points, pushed a little into the body so their
// near-side surface sits under the crest and the mane rests against them.
// Positions here are NORMALIZED video coords; the collider maps them to screen.
export function buildPrimitives(points, cfg) {
  const off = cfg.bodyOffset;
  // shove a crest point "into" the body: down and slightly toward the muzzle
  const intoBody = (p, k = 1) => [p[0] + off * 0.35 * k, p[1] + off * k];

  const skullMid = [
    (points.forehead[0] + points.skull[0]) / 2,
    (points.forehead[1] + points.skull[1]) / 2,
  ];

  return [
    { type: "circle", c: intoBody(skullMid, 1.1), r: cfg.skullRadius },
    { type: "capsule", a: intoBody(points.skull), b: intoBody(points.upperNeck), r: cfg.neckRadius },
    { type: "capsule", a: intoBody(points.upperNeck), b: intoBody(points.midNeck), r: cfg.neckRadius },
    { type: "capsule", a: intoBody(points.midNeck), b: intoBody(points.lowerNeck), r: cfg.neckRadius * 1.1 },
  ];
}

// ---- collision primitives from the 14-point curve -------------------------
// The named-point version above only knows `forehead`/`skull`/…, which the
// editor's curve doesn't have. This walks the curve instead: sample it, lay a
// capsule between consecutive samples, and push each sample along the curve's
// INWARD normal so the capsule SURFACE lands on the birth line instead of
// swallowing it.
//
// Everything here happens in SCREEN PX, which matters: normalized video space is
// anisotropic (x spans drawW, y spans drawH), so a "distance" of 0.045 there is
// 0.045*drawW horizontally but 0.045*drawH vertically. Offsetting a normal in
// that space against an isotropic px radius does not close, and the surface ends
// up in the wrong place wherever the curve is steep. `toScreen([nx, ny])` must
// return screen [x, y]; radiusPx and offsetPx are plain pixels.
//
// Normal orientation: of the two perpendiculars, take the one pointing DOWN
// (positive y). Along the top of the skull that points into the head; down the
// neck it points into the neck. Same rule the root band uses, inverted.
export function buildPrimitivesFromCurve(
  points,
  toScreen,
  { segments, radiusPx, offsetPx, smoothPasses = 0 }
) {
  let samples = [];
  for (let i = 0; i <= segments; i++) samples.push(toScreen(catmullRomAt(points, i / segments)));

  // Hand-authored control points carry high-frequency wiggle: measured local
  // radius of curvature dips to ~7px on this track, far under the offset. Where
  // curvature radius < offset, the offset curve folds through its own centre of
  // curvature and the result is meaningless. A couple of smoothing passes (ends
  // pinned) removes that noise without moving the overall neck shape. It does
  // NOT fully close the geometry — see CONFIG.curvePrimitives.radiusFactor.
  for (let p = 0; p < smoothPasses; p++) {
    const out = samples.map((q) => [q[0], q[1]]);
    for (let i = 1; i < samples.length - 1; i++) {
      out[i] = [
        (samples[i - 1][0] + 2 * samples[i][0] + samples[i + 1][0]) / 4,
        (samples[i - 1][1] + 2 * samples[i][1] + samples[i + 1][1]) / 4,
      ];
    }
    samples = out;
  }

  const inward = (i) => {
    const a = samples[Math.max(0, i - 1)];
    const b = samples[Math.min(samples.length - 1, i + 1)];
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    let nx = -ty;
    let ny = tx;
    if (ny < 0) {
      nx = -nx;
      ny = -ny;
    } // orient into the body (positive y)
    return [nx, ny];
  };

  const pushed = samples.map((p, i) => {
    const [nx, ny] = inward(i);
    return [p[0] + nx * offsetPx, p[1] + ny * offsetPx];
  });

  const prims = [];
  for (let i = 0; i < pushed.length - 1; i++) {
    prims.push({ type: "capsule", a: pushed[i], b: pushed[i + 1], r: radiusPx });
  }
  return prims;
}

// Collider working in SCREEN space. Call setPrimitives() each frame with the
// current primitives already mapped to screen coords + radii in px.
export class PrimitiveCollider {
  constructor() {
    this.prims = [];
    this.cell = 8; // used by the physics push step
  }

  setPrimitives(prims) {
    this.prims = prims;
  }

  // Returns { nx, ny } outward push direction if (x,y) is inside a primitive.
  resolve(x, y) {
    let best = null;
    let bestDepth = 0;
    for (const p of this.prims) {
      let cx;
      let cy;
      let r;
      if (p.type === "circle") {
        cx = p.c[0];
        cy = p.c[1];
        r = p.r;
      } else {
        // closest point on the capsule segment a→b
        const ax = p.a[0];
        const ay = p.a[1];
        const bx = p.b[0];
        const by = p.b[1];
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy || 1;
        let tt = ((x - ax) * dx + (y - ay) * dy) / len2;
        tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
        cx = ax + dx * tt;
        cy = ay + dy * tt;
        r = p.r;
      }
      const ddx = x - cx;
      const ddy = y - cy;
      const dist = Math.hypot(ddx, ddy);
      const depth = r - dist;
      if (depth > 0 && depth > bestDepth) {
        bestDepth = depth;
        const inv = dist > 1e-4 ? 1 / dist : 0;
        best = inv ? { nx: ddx * inv, ny: ddy * inv } : { nx: 0, ny: -1 };
      }
    }
    return best;
  }
}
