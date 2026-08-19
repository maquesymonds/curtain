// ============================================================================
//  MAIN — bootstrap, mode selection (video / static), the video-synced loop,
//  resize, and wiring for the two inspection tools.
//
//  MODES (set CONFIG.mode, or override with ?mode=static / ?mode=video):
//   - video : animated clip; roots ride the tracked crest spline, collision
//             uses animated primitives, wind is periodic over the clip length.
//   - static: original single photo; roots from the white line, PNG collision.
//
//  TOOLS (video mode only)
//   - ?calibrate    / "c" : read-only check that the 5-point tracking sticks to
//                           the horse. Curve, points, primitives, roots, HUD.
//   - ?trackEditor  / "e" : edit a 14-point birth curve by hand, frame by frame,
//                           with keyframes, interpolation and JSON export.
//
//  Either tool means INSPECTING, so the mane is not simulated and not drawn. It
//  is not merely switched off: when a tool is requested at boot the HairSystem is
//  never constructed, so there is nothing in existence that could render.
//
//  MEASUREMENT
//   - ?probe : does NOT change what is drawn, and is not a tool in the sense above.
//             It exposes the live system on window.__mane so the mane can be measured
//             from outside — root spacing, strand shapes, launch directions, and how
//             much of the real crest the letters actually cover. REGLA 3 needs a way in.
// ============================================================================

import { CONFIG, AUTHORED_SYSTEMS } from "./config.js";
import { computeCover, normToScreen, screenToNorm } from "../../shared/js/cover.js";
import { loadImage, getImageData, sampleRootsFromLine, CollisionField } from "./imageSampler.js";
import { HairSystem } from "../../shared/js/hairSystem.js";
import { hash, lerp, sampleProfile, smoothstep } from "../../shared/js/utils.js";
import {
  TRACK_ORDER,
  arcLengthUs,
  catmullRomAt,
  sampleTracking,
  splinePoint,
  buildPrimitives,
  buildPrimitivesFromCurve,
  PrimitiveCollider,
} from "./tracking.js";
import { TrackingEditor } from "./trackingEditor.js";
import { TrackingSource } from "./trackingSource.js";
import { Silhouette } from "./silhouette.js";
import { stageReady, onStage } from "../../shared/js/stage.js";
import { ensureGlyphFont } from "../../shared/js/fonts.js";
import { offerTuning } from "../../shared/js/tune.js";
import { TUNE_SPEC } from "./tune.js";
import { attachPointer, decayPointer } from "../../shared/js/pointer.js";
import { notifyContact, configureSound } from "../../shared/js/interactionSound.js";

// Measured with synthetic sweeps at three speeds, reading window.maneStats: a
// brisk 16 px/frame brush across the crest produces contact.weight p50 19.0,
// p90 32, peak 37, with 422 particles inside pointer.radius 114. 30 puts that
// brush at 0.63 of full, a slow one at 0.19, and burying the cursor in the
// densest part of the mane at 1.0.
configureSound({ weightFull: 30 });

const IDENTITY = { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 };
const TAU = Math.PI * 2;

const params = new URLSearchParams(location.search);
const MODE = params.get("mode") || CONFIG.mode; // "video" | "static"

const videoEl = document.getElementById("bg-video");
const imageEl = document.getElementById("bg-image");
const canvas = document.getElementById("mane");
const ctx = canvas.getContext("2d");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let dpr = Math.min(window.devicePixelRatio || 1, CONFIG.dprCap);
let hair = null; // stays null for the whole session while a tool is on
let collider = null; // the video-mode PrimitiveCollider, needed with or without hair
let cover = null;
let srcW = CONFIG.video.width;
let srcH = CONFIG.video.height;
let editor = null;
let track = null; // TrackingSource — the edited 14-point curve, when available
let silhouette = null; // per-frame read of where the horse actually is

let debug = params.has("debug"); // static PNG collision overlay
// Both tools are video-tracking tools: they have nothing to show in static mode,
// where they would just switch everything off and leave a bare photo.
const IS_VIDEO = MODE === "video";
let calibrate = params.has("calibrate") && IS_VIDEO;
let editing = params.has("trackEditor") && IS_VIDEO;
// The live parameter panel. Unlike the two tools above it does NOT suppress the mane —
// the whole point is dragging values while the piece runs.
const controlsWanted = params.has("controls") && IS_VIDEO;
let paused = document.hidden;
let lastPerf = 0;

// Set from the shell's "curtain:hide" / "curtain:show" (shared/js/stage.js).
let stageHidden = false;

// True when the mane should hold still: the tab is hidden, the video path has
// paused itself, or the shell parked this piece because another one is on screen.
// That last case is not covered by display:none — Chrome keeps firing rAF and
// requestVideoFrameCallback inside a hidden iframe (19 ticks/s measured
// 2026-08-12), so an unparked piece behind another one costs the visible piece
// real frames: 30.7 -> 18.6 fps with a single one left running.
const parked = () => paused || stageHidden;

// Diagnostics state. `diag` forces the overlay; otherwise it appears by itself
// when the mane has been asked to draw and has drawn nothing.
let diag = params.has("diag");
let glyphsDrawn = 0;
let framesRendered = 0;
let loopError = null;

// Bumped whenever you want to be certain the tab is running current code: if the
// console or the diagnostics panel doesn't show this value, the browser is
// serving a cached module and nothing you just changed is live.
const BUILD = "2026-08-12 · crest band + flow + neon mane";

// True while an inspection tool is open. The mane must neither simulate nor draw.
const inspecting = () => calibrate || editing;

// Whether the mane was suppressed at boot. If it was, `hair` is null for the
// rest of the session and toggling a tool off simply leaves an empty stage —
// reload without the flag to get the mane back. That is deliberate: it makes
// "no letters while inspecting" structural instead of a flag we could forget.
const HAIR_SUPPRESSED = inspecting();

// The tools own the subsystem toggles while open, and hand them back untouched.
function applySystems() {
  Object.assign(CONFIG.systems, inspecting() ? CONFIG.calibration.systems : AUTHORED_SYSTEMS);
}
applySystems();

function viewport() {
  return { w: window.innerWidth, h: window.innerHeight };
}

function sizeCanvas() {
  const { w, h } = viewport();
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function computeCurrentCover() {
  const { w, h } = viewport();
  cover = computeCover(srcW, srcH, w, h);
  return cover;
}

// ---------------------------------------------------------------------------
//  VIDEO TIME  —  everything derived from the real clip facts in CONFIG.video
// ---------------------------------------------------------------------------

// Frame actually being presented, from the media time the browser reports.
function frameIndexAt(mediaTime) {
  const { fps, frameCount } = CONFIG.video;
  return Math.min(frameCount - 1, Math.max(0, Math.round(mediaTime * fps)));
}

// Time to seek to in order to land ON a given frame. Offset a fraction of a
// frame past the boundary (CONFIG.calibration.frameSeekBias) so the browser
// decodes this frame and not the previous one, while still reading back as this
// frame through frameIndexAt — see the note on frameSeekBias in config.js.
function timeOfFrame(frame) {
  const { fps, frameCount } = CONFIG.video;
  const f = Math.min(frameCount - 1, Math.max(0, frame));
  return (f + CONFIG.calibration.frameSeekBias) / fps;
}

function seekToFrame(frame) {
  videoEl.pause();
  paused = true;
  videoEl.currentTime = timeOfFrame(frame);
}

function seekBySeconds(delta) {
  seekToFrame(frameIndexAt(videoEl.currentTime + delta));
}

const currentFrame = () => frameIndexAt(videoEl.currentTime);

// ---------------------------------------------------------------------------
//  VIDEO MODE
// ---------------------------------------------------------------------------

function strandCountForViewport() {
  const density = window.innerWidth <= CONFIG.mobileBreakpoint ? CONFIG.mobileDensityFactor : 1;
  return Math.max(6, Math.round(CONFIG.strandCount * density));
}

// THE one place that answers "where is the mane birth curve right now".
// Returns a function u -> [nx, ny] in normalized video coords, for a given media
// time. Prefers the edited 14-point tracking; falls back to the legacy 5-point
// spline. Roots, root markers and collision primitives all read from this, so
// they can never disagree about where the crest is.
function curveAt(mediaTime) {
  if (track) {
    // Resolve the pose once per call, then sample the curve through it.
    const pose = track.poseAtFrame(frameIndexAt(mediaTime));
    return (u) => catmullRomAt(pose, u);
  }
  const pts = sampleTracking(mediaTime);
  return (u) => splinePoint(pts, u);
}

// The neon depth ramp. The mane is a HANGING CURTAIN, the same thing the willow
// is, so it takes the willow's treatment and not the fish's: every strand starts
// near-white at its own first characters and settles into the pink further down.
// (The fish is lit as a structure of rays instead — see fish/js/fins.js — because
// that is what a fin does and what its reference shows.)
//
// REGLA 1: the only thing that varies a strand's brightness is a hash of WHICH
// STRAND it is. Never its ny, never a height band.
function withNeonDepth(roots) {
  const d = CONFIG.maneDepth;
  if (!d) return roots;
  return roots.map((r, i) => ({
    ...r,
    // Two independent draws per strand, so a strand that starts hot is not obliged to
    // stay near the front further down. The RANGES matter more than the numbers: a
    // narrow range makes every strand equally hot at the root, and 84 equally hot roots
    // overlapping along the crest stop reading as strands at all — they fuse into one
    // solid bar of light. Spread wide, some strands are clearly in front of others.
    z: lerp(d.zRoot[0], d.zRoot[1], hash(i * 4.31)),
    zTip: lerp(d.zTip[0], d.zTip[1], hash(i * 7.13)),
  }));
}


const normPairToScreen = ([nx, ny]) => {
  const s = normToScreen(nx, ny, cover, IDENTITY);
  return [s.x, s.y];
};

// ---------------------------------------------------------------------------
//  THE CREST BAND — where a hair is born, which is NOT where the curve runs
//
//  The tracked curve is anatomy: it follows the top of the neck from inside the
//  body. The real hair reaches outward from it, and measured on 13 frames of the
//  clip that band is 18..36 video px deep (median per u — the profile in
//  CONFIG.maneShape.crestOffsetPx is that measurement). Roots placed ON the curve
//  are therefore born UNDER a band of real horse hair, which is exactly the thing
//  this piece must not show: the letters have to be the silhouette, not a fringe
//  hanging below one.
//
//  So every root is pushed out along the curve's own LOCAL NORMAL. Not "up": the
//  crest turns nearly 90 degrees between the poll and the withers, so a constant
//  y offset would leave the front covered and the back exposed.
// ---------------------------------------------------------------------------

// One frame's crest band, precomputed in SCREEN px: the smoothed crest, its outward
// normal, and how deep the hair band is at each sample. Built once per frame and
// shared by every root — cheaper than per-root finite differences (128 curve
// evaluations a frame instead of 3 per strand) and, more importantly, the only way
// the normals can be smooth.
//
// SMOOTHING IS NOT COSMETIC HERE. The 14 tracked points are placed by hand, so the
// curve carries wiggle at their own scale, and offsetting a wiggly curve makes it
// FOLD through its own centre of curvature — the same trap documented for the
// collision primitives, whose radius of curvature dips to ~7px against a ~40px
// offset. Measured across all 121 frames at 84 roots, the raw offset line put two
// roots 0.14px apart while others sat 41px apart; 32 passes at this resolution take
// the spacing spread (p95/p05) from 4.3x down to 2.6x.
//
// Built in screen space on purpose: normalized video space is anisotropic (x spans
// drawW, y spans drawH), so a perpendicular computed there is not perpendicular on
// screen wherever the curve is steep, and the push would lean along the crest
// instead of leaving it.
function buildCrestTable(base) {
  const m = CONFIG.maneShape;
  const n = m.crestSamples;
  const xs = new Array(n + 1);
  const ys = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const [x, y] = normPairToScreen(base(i / n));
    xs[i] = x;
    ys[i] = y;
  }
  // 1-2-1 kernel, ends pinned. `px`/`py` hold the PRE-pass neighbour so the update
  // is simultaneous rather than a running average sliding along the curve.
  for (let p = 0; p < m.crestSmoothPasses; p++) {
    let px = xs[0];
    let py = ys[0];
    for (let i = 1; i < n; i++) {
      const cx = xs[i];
      const cy = ys[i];
      xs[i] = (px + 2 * cx + xs[i + 1]) / 4;
      ys[i] = (py + 2 * cy + ys[i + 1]) / 4;
      px = cx;
      py = cy;
    }
  }

  const nxs = new Array(n + 1);
  const nys = new Array(n + 1);
  const offs = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n, i + 1);
    let tx = xs[b] - xs[a];
    let ty = ys[b] - ys[a];
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    let nx = -ty;
    let ny = tx;
    // WHICH perpendicular is "outward", decided automatically: of the two, the one
    // with negative y. Over the poll that points up out of the skull; down the neck
    // it points up and away from the crest. One rule covers the whole curve because
    // the mane is always the body's upper edge. It is the exact inverse of the rule
    // buildPrimitivesFromCurve uses to point INTO the body.
    if (ny > 0) {
      nx = -nx;
      ny = -ny;
    }
    nxs[i] = nx;
    nys[i] = ny;
    // Band depth here, in screen px. The profile is authored in VIDEO px because
    // that is the space it was measured in, so it scales with the cover exactly like
    // the footage it was measured on.
    offs[i] = sampleProfile(m.crestOffsetPx, i / n) * m.crestOffsetScale * cover.scale;
  }
  return { n, xs, ys, nxs, nys, offs };
}

// A point on the band, in screen px. `k` is how much of the local band depth this
// hair takes: 1 = out on the silhouette, 0 = down on the anatomical crest.
function crestPoint(tbl, u, k) {
  const s = Math.max(0, Math.min(1, u)) * tbl.n;
  const i = Math.min(tbl.n - 1, Math.floor(s));
  const f = s - i;
  const x = tbl.xs[i] + (tbl.xs[i + 1] - tbl.xs[i]) * f;
  const y = tbl.ys[i] + (tbl.ys[i + 1] - tbl.ys[i]) * f;
  const nx = tbl.nxs[i] + (tbl.nxs[i + 1] - tbl.nxs[i]) * f;
  const ny = tbl.nys[i] + (tbl.nys[i + 1] - tbl.nys[i]) * f;
  const off = (tbl.offs[i] + (tbl.offs[i + 1] - tbl.offs[i]) * f) * k;
  return [x + nx * off, y + ny * off];
}

// The unit tangent of the band at `u`, front → back, in screen px. This is the
// direction the hair LEAVES the body in, which is what the crest flow is built on.
function crestTangent(tbl, u) {
  const s = Math.max(0, Math.min(1, u)) * tbl.n;
  const i = Math.max(1, Math.min(tbl.n - 1, Math.round(s)));
  let tx = tbl.xs[i + 1] - tbl.xs[i - 1];
  let ty = tbl.ys[i + 1] - tbl.ys[i - 1];
  const len = Math.hypot(tx, ty) || 1;
  return [tx / len, ty / len];
}

// The curve the ROOTS ride, as opposed to `curveAt`, which stays the anatomy.
// Signature is (u, strand) rather than (u) because the push is per strand: each root
// keeps its own depth into the band (`rootDef.crestK`), so the band is filled rather
// than drawn as one line. HairSystem.updateRoots passes the strand along.
function maneCurveFrom(tbl) {
  const clampToBody = CONFIG.silhouette.enabled && silhouette && silhouette.ok;
  return (u, strand) => {
    const k = strand?.rootDef?.crestK ?? 1;
    let [x, y] = crestPoint(tbl, u, k);
    // The measured band profile is a MEDIAN over the clip, so at some poses it pushes a
    // root past the edge it was meant to land on. When the frame can be read, walk the
    // push back toward the anatomy until the root is on the horse again — never past the
    // curve itself, which is inside the body by construction.
    if (clampToBody && !silhouette.inside(x, y, cover)) {
      for (let i = 1; i <= CONFIG.silhouette.clampSteps; i++) {
        const t = 1 - i / CONFIG.silhouette.clampSteps;
        const [cx, cy] = crestPoint(tbl, u, k * t);
        if (silhouette.inside(cx, cy, cover)) {
          x = cx;
          y = cy;
          break;
        }
        x = cx;
        y = cy;
      }
    }
    const s = screenToNorm(x, y, cover, IDENTITY);
    return [s.nx, s.ny];
  };
}

function maneCurveAt(mediaTime) {
  return maneCurveFrom(buildCrestTable(curveAt(mediaTime)));
}

// RE-AIM THE FORELOCK, every frame.
//
// The mane's sideways bias is a screen-space x force (CONFIG.drapeX plus drapeSpread), and
// for the mane that is right: it always falls to the near side. The forelock is different,
// because what "forward" means depends on where the head is pointing. Measured, this was
// the whole of the remaining problem: with the tracking corrected, the forelock's roots sit
// inside the head at every pose, and at frame 60 — head turned to camera — 69% of its
// characters still ended up over the sky, dragged there by a rightward force while its
// launch direction pointed down the face.
//
// So the pull is re-derived from the CURRENT crest tangent instead of from the pose the
// strands were built in. `strand.angle` cannot do this job: it is baked at build time from
// frame 0 and never revisited, which is exactly why a static aim fails on a moving subject.
// Aimed from the RAW curve, not from the smoothed table the offset uses. That smoothing
// (32 passes) exists to stop the outward push folding on a hand-authored curve, and it does
// its job — but it also erases the very feature this needs. Measured at frame 60, where the
// tracked front point sits 31px below its neighbour and the face-ward direction is within
// 3 degrees of straight down, the smoothed tangent still reported 49 degrees to the RIGHT,
// and the forelock kept being dragged off the head. The two uses want opposite things from
// the same curve, so they read it differently.
const AIM_EPS = 0.012;

function aimForelock(base) {
  if (!hair) return;
  const fl = CONFIG.maneShape.forelock;
  for (const s of hair.strands) {
    // Gated on MEMBERSHIP, not on force. `pull` at 0 still has to leave the drape fade below
    // running — otherwise dragging pull to zero silently switches off a second, unrelated
    // behaviour — while a strand behind the parting wants neither of the two.
    if (!fl.enabled || s.rootU >= fl.untilU) {
      s.pullX = 0;
      s.pullY = 0;
      s.drapeGain = 1;
      continue;
    }
    const u = s.rootU;
    const a = normPairToScreen(base(Math.max(0, u - AIM_EPS)));
    const b = normPairToScreen(base(Math.min(1, u + AIM_EPS)));
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    const len = Math.hypot(tx, ty) || 1;
    // Negated: `base` runs front -> back, and the forelock goes the other way.
    const crestX = -tx / len;
    const crestY = -ty / len;

    // IS "FORWARD ALONG THE CREST" STILL "DOWN THE FOREHEAD"?
    //
    // In profile it is, and that is the whole reason aiming along the crest works: the
    // tangent at the poll points down the face, so the two directions are the same one and
    // the tuft falls where a forelock falls. When the head turns to camera they come apart.
    // Measured, the aim's own vertical component over the clip (1 = straight down, 0 =
    // horizontal, negative = upward):
    //     frames   1- 56  profile, forelock reads correctly   dy 0.33 .. 0.84
    //     frames  58-101  head turned to camera               dy 0.24 -> 0.011 -> -0.135
    //     frames 102-120  turning back to profile             dy 0.32 .. 0.61
    // Through 68-81 the aim points slightly UPWARD and mostly sideways, and pulling along
    // it marches the tuft across the face and out past the ear: 18 of 84 strands more than
    // 65 degrees off vertical at frame 72.
    //
    // AND THE CLEARANCE GAIN BELOW WAS ANSWERING THE OPPOSITE QUESTION. Measured per frame,
    // it sat at 0.2-0.4 through the poses where the aim is good and 0.87-1.00 through the
    // window where it is wrong — because "is there horse ahead" is trivially yes when ahead
    // is the face. It handed the pull full strength exactly when the pull was worst aimed.
    //
    // So the aim itself gives way to STRAIGHT DOWN as its vertical component vanishes. Not
    // killed — redirected, which is what the strand wants anyway: with the crest no longer
    // pointing anywhere useful, a forelock simply falls over the forehead. Below the near
    // end of `aimDown` the pull is pure gravity's direction; above the far end it is the
    // crest tangent untouched; between, a blend. Per strand, not per frame: the 24 strands
    // in the zone disagree by 0.5 in dy at the same instant (f76: -0.334 .. 0.190).
    const [downFrom, downTo] = fl.aimDown;
    const keep = smoothstep(downFrom, downTo, crestY);
    let dx = crestX * keep;
    let dy = crestY * keep + (1 - keep);
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl;
    dy /= dl;

    // AND SCALED BY WHAT IS ACTUALLY THERE. Pulling hard in a direction with no horse in it
    // is what threw the tuft into the sky, so the pull is proportional to the room it has —
    // full strength with `pullClearPx` of horse ahead, nothing with none. Probed along the
    // BLENDED direction, not the raw tangent: the question is whether there is horse where
    // the strand is actually being pulled, which after the blend above is a different place.
    let gain = 1;
    if (CONFIG.silhouette.enabled && silhouette && silhouette.ok) {
      const room = silhouette.clearance(
        s.particles[0].pos.x,
        s.particles[0].pos.y,
        dx,
        dy,
        CONFIG.silhouette.pullClearPx,
        cover
      );
      gain = room / CONFIG.silhouette.pullClearPx;
    }
    s.pullX = dx * fl.pull * gain;
    s.pullY = dy * fl.pull * gain;

    // The same weight on the LATERAL DRAPE, which is the other half of what holds the tuft
    // forward. The forelock's drape is 1.6-2.4 against the mane's, aimed at the face by
    // sign, and unlike the pull it is not re-derived from anything — it is a screen-space
    // +x force that keeps pushing toward the face whichever way the head is pointing. So it
    // fades with `keep` too, floored at the mane's own share rather than at zero: a strand
    // with no lateral bias at all collapses to a vertical line of type.
    s.drapeGain = lerp(fl.aimDownDrapeFloor, 1, keep);
  }
}

// THIN THE FORELOCK WHEN ITS BAND FORESHORTENS.
//
// The roots of the forelock are spaced along the crest by its PARAMETER, u, and their count
// is fixed at build time. In profile that is right: `u < untilU` is a real stretch of crest
// with real width on screen. When the head turns to camera the same stretch projects onto a
// fraction of that width, and the strand count does not notice — so the same hair is drawn
// into a smaller and smaller area until it stops reading as a tuft and reads as a bright
// knot of overlapping type sitting on the poll, with its outer edge spilling past the ear
// into the sky.
//
// Measured, the projected arc length of the u < 0.16 band over the clip:
//     frames   4- 44  profile          99-112 px    21-24 roots per 100px    ~0-1% over sky
//     frame       67  turned to camera     46 px    51.6 roots per 100px         54% over sky
//     frames  71- 80                     59-63 px    38-41 roots per 100px      8-40% over sky
//     frames 100-120  back to profile    88-102 px   23-27 roots per 100px           0% over sky
// A 2.61x collapse at 2.4x the root density. That is the whole of the remaining defect, and
// it is why nothing about AIM fixed it. Measured and rejected on the way here, all on the
// same window, so nobody has to try them again:
//     re-aiming the pull toward straight down   worked, but on a different symptom (aimDown)
//     rotating the resting pose per frame       reoriented it 26.5 deg, changed the result by
//                                               nothing: 55.9% -> 58.0% over sky. Reverted.
//     whorl strength 0.62 -> 0.30               worse
//     whorl radius 0.17 -> 0.10                 worse
//     rootFlowStrength 0.72 -> 0.40             worse
//     flowMaxDeg 96 -> 60                       flat
//     wind off / drapeX 0                       flat
//     damping 0.83 -> 0.40                      46% -> 31% mean, and the profile poses cost
//                                               more than the frontal ones gained
// The last one is why inertia is not the answer either: frames 100-120 move the roots as fast
// as frame 62 does and sit at 0% over sky, because their band is 88-102px wide.
//
// So keep the density constant in SCREEN space instead of in u. `keep` is how much of the
// reference width the band still has; strands fade out in a fixed shuffled order as it
// shrinks, so the same hair always goes first and there is no shimmer from the set changing
// its mind. A fade, not a cut: `feather` is how wide the crossover is in units of keep.
function thinForelock(tbl) {
  if (!hair) return;
  const cfg = CONFIG.maneShape.forelockThin;
  if (!cfg.enabled) {
    for (const s of hair.strands) s.drawGain = 1;
    return;
  }
  const until = CONFIG.maneShape.forelock.untilU;

  // Projected width of the band THIS frame, walked along the smoothed table the roots
  // themselves sit on, so it is the same curve and the same offset they are placed by.
  const STEPS = 48;
  let arc = 0;
  let prev = crestPoint(tbl, 0, 1);
  for (let i = 1; i <= STEPS; i++) {
    const pt = crestPoint(tbl, (i / STEPS) * until, 1);
    arc += Math.hypot(pt[0] - prev[0], pt[1] - prev[1]);
    prev = pt;
  }

  // Shaped, not linear. `refArcPx` is where thinning STOPS, so a linear ratio would have to
  // be raised above the profile width to bite at all — and then it would thin the profile
  // poses too, which is the one thing this must not do. The exponent keeps 1.0 at the
  // reference and falls away fast below it: at 2, the profile poses (99-112px) stay at 24
  // strands while frame 72 (59px) drops to 8 and frame 67 (46px) to 5.
  const ratio = Math.min(1, arc / cfg.refArcPx);
  const keep = cfg.curve === 1 ? ratio : ratio ** cfg.curve;
  for (const s of hair.strands) {
    if (s.rootU >= until) {
      s.drawGain = 1;
      continue;
    }
    const rank = s.rootDef?.thinRank ?? 0;
    s.drawGain = Math.max(0, Math.min(1, 1 + (keep - rank) / cfg.feather));
  }
}

// The one call that puts the mane on the frame: roots on the band, forelock re-aimed.
function applyManeFrame(mediaTime) {
  // One read of the frame, before anything asks where the horse is.
  if (CONFIG.silhouette.enabled && silhouette) silhouette.sample(frameIndexAt(mediaTime));
  const base = curveAt(mediaTime);
  const tbl = buildCrestTable(base);
  if (hair) {
    hair.updateRoots(cover, maneCurveFrom(tbl));
    aimForelock(base);
    thinForelock(tbl);
  }
  return tbl;
}

// The `u` each root sits at: spaced evenly by ARC LENGTH along the offset line, not
// by curve parameter (u-uniform spacing measured 1.5..18.5px on this track, which
// reads as holes in one place and clumps in another).
//
// Taken as the MEDIAN over frames sampled across the whole clip instead of from
// frame 0. The tracked points move relative to each other, so a parameterization
// that is perfectly even on one frame is uneven on all the others: measured over the
// 121 frames, spacing derived from frame 0 runs 3.5..13.2px (p05..p95) while the
// median parameterization runs 4.0..10.3px for the same roots. Neither is perfect —
// what is left is the hand-authored tracking itself breathing, and no fixed set of
// `u` can answer that without sliding the roots along the neck as it plays.
// Arc length of the band between two parameters, in screen px.
function arcLenBetween(tbl, ua, ub, steps = 64) {
  let total = 0;
  let prev = crestPoint(tbl, ua, 1);
  for (let i = 1; i <= steps; i++) {
    const p = crestPoint(tbl, lerp(ua, ub, i / steps), 1);
    total += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    prev = p;
  }
  return total;
}

// How the `count` roots are split between the forelock and the mane, and where each one
// sits. Two zones rather than one, because even spacing along the whole crest gives the
// forelock only its share of the LENGTH — about 10 strands of 84 — and a forelock that
// thin leaves the forehead bare at the poses where the head turns toward the camera.
//
// `forelock.density` is a weight on that share, not a strand count: the total stays
// exactly `count`, so thickening the forelock genuinely takes hair from the mane instead
// of adding particles behind the piece's back. Spacing stays even by arc length WITHIN
// each zone, which is what makes the forelock read as denser rather than as scattered.
function rootZones(count) {
  const m = CONFIG.maneShape;
  const [u0, u1] = m.rootURange;
  const fl = m.forelock;
  if (!fl.enabled || fl.untilU <= u0 || fl.untilU >= u1 || fl.density === 1) {
    return [{ u0, u1, count }];
  }
  // Measured on frame 0's band; the split is authored once, not re-derived per frame.
  const tbl = buildCrestTable(curveAt(0));
  const lf = arcLenBetween(tbl, u0, fl.untilU) * fl.density;
  const lm = arcLenBetween(tbl, fl.untilU, u1);
  const nf = Math.max(1, Math.min(count - 1, Math.round((count * lf) / (lf + lm))));
  return [
    { u0, u1: fl.untilU, count: nf },
    { u0: fl.untilU, u1, count: count - nf, skipFirst: true },
  ];
}

function rootUs(count) {
  const m = CONFIG.maneShape;
  if (count <= 1) return [m.rootURange[0]];
  const { frameCount, fps } = CONFIG.video;
  const zones = rootZones(count);
  const per = [];
  for (let f = 0; f < frameCount; f += m.arcFrameStride) {
    const tbl = buildCrestTable(curveAt(f / fps));
    const row = [];
    for (const z of zones) {
      // The walk runs over the SUB-RANGE hair actually grows on, and the parameter comes
      // back mapped into it. Spacing is still even by arc length, just along a shorter
      // curve. `skipFirst` drops the point that would land exactly on the parting, where
      // the previous zone already put one.
      const n = z.count + (z.skipFirst ? 1 : 0);
      const sub = arcLengthUs((t) => crestPoint(tbl, lerp(z.u0, z.u1, t), 1), n, m.arcSamples);
      const mapped = sub.map((t) => lerp(z.u0, z.u1, t));
      row.push(...(z.skipFirst ? mapped.slice(1) : mapped));
    }
    per.push(row);
  }
  const out = [];
  for (let k = 0; k < count; k++) {
    const col = per.map((a) => a[k]).sort((a, b) => a - b);
    out.push(col[col.length >> 1]);
  }
  return out;
}

// ---------------------------------------------------------------------------
//  THE FLOW — why a mane is not 84 columns of text
//
//  Hair does not leave a body downward. It leaves ALONG the surface and gravity
//  takes it from there, and that first stretch is most of what tells the eye it is
//  looking at hair rather than at hanging type. Two things set the direction a
//  strand is born in, and both are expressed as one number per root — the `angle`
//  Strand already understands, which CONFIG.angleRelax then decays back to straight
//  down over the first fifth of the strand:
//
//    1. THE CREST FLOW. The launch direction leans toward the crest's own tangent,
//       so at the poll (where the crest runs almost level) the hair sets off sideways
//       and only then falls, while down the neck (where the crest is already steep)
//       it barely deviates. One rule, and it reads correctly at both ends because it
//       is the anatomy doing the talking.
//
//    2. THE WHORL. One GLOBAL swirl, not 84 local ones: a single centre near the
//       poll, and every root inside its radius blends a tangential direction around
//       that centre into its launch. Roots ahead of the centre sweep one way and
//       roots behind it the other, which is what a cowlick actually looks like.
// ---------------------------------------------------------------------------

// Strand.angle convention: 0 is straight down and the pose advances along
// (-sin, cos), so a direction (dx, dy) is atan2(-dx, dy). Degrees.
function dirToAngle(dx, dy) {
  return (Math.atan2(-dx, dy) * 180) / Math.PI;
}

// Blend two unit directions by weight w (0 = a, 1 = b) and renormalize. Blending the
// VECTORS rather than the angles is what keeps a 170-degree difference from taking
// the long way round through straight up.
function mixDir(ax, ay, bx, by, w) {
  const x = ax + (bx - ax) * w;
  const y = ay + (by - ay) * w;
  const len = Math.hypot(x, y) || 1;
  return [x / len, y / len];
}

// The direction the hair at `u` is born in, as an angle in degrees for Strand.
function rootAngle(tbl, u, rootXY) {
  const m = CONFIG.maneShape;

  // 1. crest flow: lean from straight down toward the crest tangent.
  //
  // WHICH WAY ALONG THE CREST depends on which side of the parting this root is. A mane
  // does not all travel one way: the hair behind the poll sweeps BACK down the neck, and
  // the hair in front of it — the forelock — falls FORWARD over the forehead. Same
  // tangent, opposite sign, and the sign flips at forelock.untilU. Without that flip
  // every strand on the piece leaned backwards and the horse had no forelock at all.
  const fl = m.forelock;
  const front = fl.enabled && u < fl.untilU;
  let [tx, ty] = crestTangent(tbl, u);
  if (front) {
    tx = -tx;
    ty = -ty;
  }
  // The forelock takes its own flow strength rather than rootFlowByU. That profile holds
  // the front of the curve almost flow-free, which was right when the tangent there
  // pointed across the brow — reversed, it is the direction the hair should actually
  // leave in, so it wants a strong lean rather than a suppressed one.
  const flow = front ? fl.flow : m.rootFlowStrength * sampleProfile(m.rootFlowByU, u);
  let [dx, dy] = mixDir(0, 1, tx, ty, flow);

  // 2. whorl: a tangential push around one centre, fading out with distance in u.
  const w = m.whorl;
  if (w.strength > 0) {
    const du = Math.abs(u - w.centerU);
    if (du < w.radiusU) {
      const fall = (1 - du / w.radiusU) ** w.curve;
      const c = crestPoint(tbl, w.centerU, w.centerK);
      const rx = rootXY[0] - c[0];
      const ry = rootXY[1] - c[1];
      const r = Math.hypot(rx, ry);
      if (r > 1e-3) {
        // Perpendicular to the radius: the direction you travel if you go AROUND the
        // centre. `spin` picks which way round.
        const px = (-ry / r) * w.spin;
        const py = (rx / r) * w.spin;
        [dx, dy] = mixDir(dx, dy, px, py, w.strength * fall);
      }
    }
  }

  // Never launch further from "down" than this. Without the clamp the poll end, where
  // the tracked curve turns down the forehead, can be handed a launch pointing up out
  // of the skull, and a strand that starts upward reads as a spike rather than hair.
  const a = dirToAngle(dx, dy);
  const cap = m.flowMaxDeg;
  return Math.max(-cap, Math.min(cap, a));
}

function buildVideoRoots(count) {
  const m = CONFIG.maneShape;
  const tbl = buildCrestTable(curveAt(0));
  const us = rootUs(count);
  const roots = [];
  // Index WITHIN the forelock band, for the drop order thinForelock() uses. Counted rather
  // than derived from i, because the band's share of the roots is set by forelock.density and
  // is not a fixed fraction of `count`.
  let foreIdx = 0;
  for (let i = 0; i < count; i++) {
    const u = us[i];
    // Where in the band this hair is rooted. 1 = out on the silhouette, less = set
    // back into it. Real hair leaves a crest across its whole width, and a single
    // line of roots leaves everything behind that line bare no matter how dense the
    // line is.
    // Squared, so the distribution is SKEWED toward the outer surface: most hairs
    // are rooted at or near the silhouette and a minority sit deep. Spreading them
    // evenly instead measurably reopened the edge — band coverage went 94.6% -> 92.5%
    // and the exposed crest from 1.4px back up to 2.5px, because half the roots had
    // left the surface they were there to cover.
    const crestK = 1 - hash(i * 11.7) ** 2 * m.rootBandSpread;
    const [x, y] = crestPoint(tbl, u, crestK);
    const s = screenToNorm(x, y, cover, IDENTITY);

    // Length variation by ZONE, on top of the anatomical profile — ragged where a
    // mane is ragged (the lower third) rather than evenly everywhere.
    const jz = sampleProfile(m.lengthJitterByU, u);
    const lenScale = 1 + (hash(i * 5.19) - 0.5) * 2 * jz;

    // Which way this hair falls, as a signed sideways bias. Three cases, and the first
    // is the forelock: in front of the parting the hair falls FORWARD, over the face, so
    // its drape is positive and stronger than the mane's — it has to beat the global
    // drapeX, which pulls the whole piece toward the near side.
    const crossing = hash(i * 2.77) > 1 - m.drapeCross;
    const isForelock = m.forelock.enabled && u < m.forelock.untilU;
    const drape =
      isForelock
        ? lerp(m.forelock.drape[0], m.forelock.drape[1], hash(i * 8.31))
        : crossing
          ? lerp(m.drapeCrossRange[0], m.drapeCrossRange[1], hash(i * 8.31))
          : lerp(m.drape[0], m.drape[1], hash(i * 8.31));

    roots.push({
      nx: s.nx,
      ny: s.ny,
      t: u,
      u,
      crestK,
      lenScale,
      drape,
      windGain: lerp(m.windGain[0], m.windGain[1], hash(i * 6.53)),
      // The resting pose leans across the strand toward the near side. The forelock's
      // near side is the FACE, so its lean is flipped — measured, this is the term that
      // decided the argument: the global lean was 31px of leftward pull against the 15px
      // of forward arc the drape could produce, so a forelock launched forward and then
      // came straight back over the neck.
      lean: isForelock ? m.forelock.lean : 1,
      // The direction this hair leaves the body in. Per strand, and jittered a
      // little: hair growing out of one crest does not leave in one exact direction,
      // and a few degrees of scatter here is the difference between a mane and a
      // combed sheet.
      angle: rootAngle(tbl, u, [x, y]) + (hash(i * 9.41) - 0.5) * 2 * m.flowJitterDeg,
      // WHICH HAIR GOES FIRST when the band foreshortens, in [0,1). The golden-ratio
      // sequence rather than a hash: with only ~24 strands in the band a hash clumps, and a
      // clumped drop order thins one side of the tuft and leaves the other at full density —
      // which reads as the forelock developing a parting rather than getting thinner. This
      // spreads every prefix of the order evenly across the band.
      thinRank: u < m.forelock.untilU ? (foreIdx++ * 0.6180339887498949) % 1 : 1,
    });
  }
  return withNeonDepth(roots);
}

// Where the strand roots land at a given time. Mirrors how build() distributes them,
// so calibration can show the root markers without a HairSystem existing — including
// the outward push, since that is now part of where a root IS. With no strands there
// is no per-root band depth, so these sit on the silhouette itself.
function rootScreenPositions(mediaTime) {
  const tbl = buildCrestTable(curveAt(mediaTime));
  const count = strandCountForViewport();
  const us = rootUs(count);
  return us.map((u) => {
    const [x, y] = crestPoint(tbl, u, 1);
    return { x, y };
  });
}

// The collision primitives for a media time, already in screen px.
function primitivesToScreen(mediaTime) {
  const scaleRef = Math.min(cover.drawW, cover.drawH);

  // Curve path: built directly in screen space (see buildPrimitivesFromCurve on
  // why normalized space is the wrong place to offset a normal).
  if (track) {
    const cfg = CONFIG.curvePrimitives;
    const offsetPx = cfg.offset * scaleRef;
    return buildPrimitivesFromCurve(track.poseAtFrame(frameIndexAt(mediaTime)), normPairToScreen, {
      segments: cfg.segments,
      smoothPasses: cfg.smoothPasses,
      offsetPx,
      radiusPx: offsetPx * cfg.radiusFactor,
    });
  }

  // Legacy path: normalized primitives from the 5 named points, mapped after.
  const prims = buildPrimitives(sampleTracking(mediaTime), CONFIG.primitives);
  return prims.map((p) => {
    if (p.type === "circle") {
      const s = normToScreen(p.c[0], p.c[1], cover, IDENTITY);
      return { type: "circle", c: [s.x, s.y], r: p.r * scaleRef };
    }
    const a = normToScreen(p.a[0], p.a[1], cover, IDENTITY);
    const b = normToScreen(p.b[0], p.b[1], cover, IDENTITY);
    return { type: "capsule", a: [a.x, a.y], b: [b.x, b.y], r: p.r * scaleRef };
  });
}

async function initVideo() {
  imageEl.hidden = true;
  videoEl.hidden = false;
  videoEl.muted = true;
  videoEl.src = CONFIG.video.src;

  await new Promise((res) => {
    if (videoEl.readyState >= 1) return res();
    videoEl.addEventListener("loadedmetadata", res, { once: true });
  });

  // CONFIG.video is authoritative for the cover transform, so the normalized
  // tracking coords mean the same thing before and after metadata arrives.
  // Shout if the file stops matching what CONFIG claims.
  if (videoEl.videoWidth && videoEl.videoHeight) {
    if (videoEl.videoWidth !== CONFIG.video.width || videoEl.videoHeight !== CONFIG.video.height) {
      console.warn(
        `CONFIG.video says ${CONFIG.video.width}x${CONFIG.video.height} but ` +
          `${CONFIG.video.src} is ${videoEl.videoWidth}x${videoEl.videoHeight}. ` +
          `Update CONFIG.video — the tracking coords depend on it.`
      );
    }
  }
  srcW = CONFIG.video.width;
  srcH = CONFIG.video.height;

  sizeCanvas();
  computeCurrentCover();

  // Load the edited tracking before anything reads the curve, so roots and
  // collision are built from the real thing rather than the 5-point fallback.
  if (CONFIG.trackingSource.enabled) {
    track = await TrackingSource.load();
    if (track) {
      const gapPx = Math.round(track.loopGap() * CONFIG.video.width);
      console.info(
        `Tracking: ${CONFIG.trackingSource.url} — ${track.keyframeCount} keyframes, ` +
          `${CONFIG.trackEditor.pointCount} points. Loop gap ${gapPx}px.`
      );
      if (gapPx > CONFIG.trackingSource.loopGapWarnPx) {
        console.warn(
          `Tracking loop is open: frame ${CONFIG.video.frameCount - 1} is ${gapPx}px away from ` +
            `frame 0, so the mane will jump on every loop. Open ?trackEditor and press "Close loop".`
        );
      }
    } else {
      console.warn("Tracking: falling back to the legacy 5-point keyframes in tracking.js.");
    }
  }

  silhouette = new Silhouette(videoEl);
  silhouette.sample(0);

  collider = new PrimitiveCollider();
  collider.rawNormal = true; // primitives push out radially, no ridge special-case
  collider.setPrimitives(primitivesToScreen(0));

  // THE STRUCTURAL PART: with a tool requested, the mane is never built. No
  // strands, no particles, no glyph atlas, nothing to draw or step.
  if (!HAIR_SUPPRESSED) {
    hair = new HairSystem({
      roots: buildVideoRoots(strandCountForViewport()),
      collision: collider,
      bgImage: null,
    });
    hair.build(cover, IDENTITY, dpr);
    applyManeFrame(0);
    // Settle before the first paint. Every strand is born as a straight ruled
    // line out of the crest, so without this the piece opens on a horse with
    // spikes that relax into a mane over the first second — visible on its own,
    // and unmissable inside the shell, where this frame IS the entrance.
    if (hair.simulating) {
      for (let i = 0; i < CONFIG.reduceMotionSettleSteps; i++) hair.update(1, 0);
    }
  }

  // MEASUREMENT HOOK (?probe). Read-only access to the live system so the mane
  // can be measured instead of described — root spacing, strand lengths, how much
  // of the real crest the letters actually cover. REGLA 3 needs a way in, and the
  // alternative is guessing from screenshots. Absent without the flag.
  if (params.has("probe")) {
    window.__mane = {
      build: BUILD,
      get hair() {
        return hair;
      },
      get cover() {
        return cover;
      },
      video: videoEl,
      config: CONFIG,
      frameIndexAt,
      seekToFrame,
      get frames() {
        return framesRendered;
      },
      get silhouette() {
        return silhouette;
      },
      get glyphs() {
        return glyphsDrawn;
      },
      // The ANATOMICAL crest, in screen px: n points along the tracked curve at
      // the frame on screen, before any outward offset. The baseline the letters
      // are supposed to cover.
      crestScreen(n = 120, mediaTime = videoEl.currentTime) {
        const at = curveAt(mediaTime);
        const out = [];
        for (let i = 0; i < n; i++) {
          const [nx, ny] = at(n === 1 ? 0 : i / (n - 1));
          const s = normToScreen(nx, ny, cover, IDENTITY);
          out.push([s.x, s.y]);
        }
        return out;
      },
      // Where the strand roots actually are, and the shape of every strand. `dirAt`
      // is what the launch direction has become by the Nth particle, in the same
      // degrees-from-straight-down the root was authored in — the only way to see
      // whether the crest flow survived the solver or gravity flattened it.
      strandStats() {
        if (!hair) return null;
        const dirAt = (s, k) => {
          const a = s.particles[0];
          const b = s.particles[Math.min(k, s.particles.length - 1)];
          return (Math.atan2(-(b.pos.x - a.pos.x), b.pos.y - a.pos.y) * 180) / Math.PI;
        };
        return hair.strands.map((s) => ({
          dir2: dirAt(s, 2),
          dir4: dirAt(s, 4),
          dirTip: dirAt(s, s.particles.length - 1),
          u: s.rootU,
          root: [s.particles[0].pos.x, s.particles[0].pos.y],
          n: s.particles.length,
          // Position at mid-strand, for measuring whether neighbours group into locks.
          mid: (() => {
            const p = s.particles[Math.min(8, s.particles.length - 1)];
            return [p.pos.x, p.pos.y];
          })(),
          angle: s.angle,
          z: s.z,
          zTip: s.zTip,
          drape: s.drape,
          // resting length: what the solver holds, not the momentary chord
          len: s.segments.reduce((a, seg) => a + seg.len, 0),
          span: Math.hypot(
            s.particles[s.particles.length - 1].pos.x - s.particles[0].pos.x,
            s.particles[s.particles.length - 1].pos.y - s.particles[0].pos.y
          ),
          glyphs: s.particles.filter((p) => p.char && p.char !== " ").length,
        }));
      },
    };
  }

  editor = new TrackingEditor({
    video: videoEl,
    canvas,
    getCover: () => cover,
    getFrame: currentFrame,
    seekToFrame,
    requestRedraw: () => drawFrameAt(videoEl.currentTime || 0),
  });
  if (editing) editor.activate();

  wireCommon(true);

  try {
    await videoEl.play();
  } catch (_) {
    /* autoplay may be blocked until interaction; the loop still renders */
  }

  if (reduceMotion) {
    videoEl.pause();
    renderVideo(0);
    stageReady();
    return;
  }

  // Paint one frame up front: if autoplay was blocked, requestVideoFrameCallback
  // has no presented frame to fire on, and the overlays would stay invisible
  // until the first keypress.
  drawFrameAt(videoEl.currentTime || 0);
  startVideoLoop();
  stageReady();

  // Last, and only behind the flag: the panel must never delay the first frame, and
  // for a visitor the 2.6MB studio bundle is not even a request.
  if (controlsWanted) startControls();

  // The visitor's dozen knobs (shared/js/tune.js): no dependency, no flag, drawn
  // by the shell. After stageReady() on purpose — announcing them is not worth a
  // millisecond of the first frame, and the shell keeps the panel closed anyway.
  //
  // Video mode only, like startControls above, and for the same reason: the apply
  // handler rebuilds the mane from the tracked crest (rebuildMane -> buildVideoRoots),
  // which is not where the static photo's roots come from.
  offerTuning({ CONFIG, spec: TUNE_SPEC, onApply: applyControlChange });
}

// ---------------------------------------------------------------------------
//  LIVE CONTROLS (?controls) — see shared/js/controls.js and ./controls.js
//
//  A parameter change costs one of three things here, and the panel says which:
//   live     nothing. The solver and the renderer read CONFIG every frame.
//   atlas    re-bake the glyph bitmaps. ~6ms, the strands are untouched.
//   rebuild  re-derive the roots and rebuild every strand. This is the expensive one
//            and it throws away the physics state, which is why it is not the default
//            for everything: dragging `gravity` should not restart the mane.
//
//  Rebuilds are COALESCED through a flag the loop consumes, so dragging a slider that
//  fires thirty changes a second still rebuilds once per frame. Except while the clip
//  is paused, where there is no loop to consume it — rVFC only fires on presented
//  frames — so there the work is done at once and a single frame is painted.
// ---------------------------------------------------------------------------
let needsRebuild = false;
let needsAtlas = false;

function rebuildMane() {
  if (!hair) return;
  hair.roots = buildVideoRoots(strandCountForViewport());
  hair.build(cover, IDENTITY, dpr);
  applyManeFrame(videoEl.currentTime || 0);
  // Every strand is born as a straight ruled line, so a rebuild with the clip paused
  // would leave spikes on screen until play resumes. A short settle is enough to read
  // the new shape; the full reduceMotionSettleSteps (120) would stall the drag.
  if (videoEl.paused && hair.simulating) {
    for (let i = 0; i < CONFIG.controlsSettleSteps; i++) hair.update(1, videoEl.currentTime || 0);
  }
}

function applyControlChange(kinds) {
  if (!hair) return;
  // A rebuild re-bakes the atlas on its way through, so it subsumes "atlas".
  if (kinds.has("rebuild")) needsRebuild = true;
  else if (kinds.has("atlas")) needsAtlas = true;

  if (videoEl.paused) {
    consumeControlWork();
    drawFrameAt(videoEl.currentTime || 0);
  }
}

function consumeControlWork() {
  if (needsRebuild) {
    needsRebuild = false;
    needsAtlas = false;
    rebuildMane();
  } else if (needsAtlas) {
    needsAtlas = false;
    hair?.rebakeAtlas(dpr);
  }
}

function startControls() {
  Promise.all([import("./controls.js"), import("../../shared/js/controls.js")])
    .then(([{ CONTROL_SPEC }, { initControls }]) =>
      initControls({
        CONFIG,
        name: "caballo",
        spec: CONTROL_SPEC,
        onApply: applyControlChange,
      })
    )
    .then((api) => {
      window.addEventListener("keydown", (e) => {
        if (isTypingTarget(e.target)) return;
        if (e.key.toLowerCase() === CONFIG.keys.controls) api.toggle();
      });
    })
    .catch((err) => console.error("controls: no arrancó, la pieza sigue corriendo.", err));
}

function startVideoLoop() {
  lastPerf = performance.now();

  // One throw inside the loop used to kill it permanently: the exception escaped
  // the requestVideoFrameCallback body before it could re-register itself, so the
  // chain stopped, the canvas froze empty, and the video kept playing underneath
  // via its autoplay attribute — a blank mane with no visible error. Report the
  // first failure loudly and keep the loop alive.
  let reportedError = false;
  const guard = (fn) => {
    try {
      fn();
    } catch (err) {
      if (!reportedError) {
        reportedError = true;
        loopError = `${err.name}: ${err.message}`;
        console.error(
          "Render loop threw. The mane will not draw correctly. If this followed a " +
            "code change, the browser is probably mixing cached and fresh modules — " +
            "hard-reload (Cmd+Shift+R).",
          err
        );
      }
    }
  };

  const step = (now, mediaTime) => {
    const dt = Math.min((now - lastPerf) / 16.6667, 2.2) || 1;
    lastPerf = now;

    // One rebuild per frame at most, however fast the panel is sending changes.
    consumeControlWork();

    if (collider) collider.setPrimitives(primitivesToScreen(mediaTime));
    if (hair) {
      // roots follow the tracked crest (tracking, not physics — always on)
      applyManeFrame(mediaTime);
      hair.update(dt, mediaTime); // no-op when every subsystem is off
      notifyContact(hair.contact);
      // After the forces have been applied, so a flick pushes once and then lets go.
      decayPointer(CONFIG.pointer.decay);
    }
    renderVideo(mediaTime);
  };

  if ("requestVideoFrameCallback" in HTMLVideoElement.prototype) {
    const cb = (now, meta) => {
      if (parked()) lastPerf = now;
      else guard(() => step(now, meta.mediaTime));
      videoEl.requestVideoFrameCallback(cb);
    };
    videoEl.requestVideoFrameCallback(cb);
  } else {
    const raf = (now) => {
      if (parked()) lastPerf = now;
      else guard(() => step(now, videoEl.currentTime));
      requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
  }
}

function renderVideo(mediaTime) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // `hair` is null whenever a tool was requested at boot, so this cannot run.
  if (hair && CONFIG.systems.renderHair) glyphsDrawn = hair.draw(ctx, dpr);
  if (calibrate) drawCalibration(mediaTime);
  if (editor) editor.draw(ctx, dpr, mediaTime);

  // A PAUSED CLIP LOOKS EXACTLY LIKE A BROKEN ONE. The solver runs on
  // requestVideoFrameCallback, so pausing the video stops the physics too and leaves a
  // fully drawn, completely motionless mane. Space is play/pause and it is easy to hit by
  // accident while working in the controls panel, so while that panel is open the piece
  // says which of the two it is. Same reasoning as the diagnostics overlay below.
  if (controlsWanted && videoEl.paused) drawPausedBadge();

  framesRendered++;
  // Self-report instead of failing silently: if the mane exists but has painted
  // nothing for a while, something is wrong in a way the user cannot see, and
  // "no letters" is indistinguishable from "letters are too faint".
  if (diag || (hair && CONFIG.systems.renderHair && glyphsDrawn === 0 && framesRendered > 30)) {
    drawDiagnostics(mediaTime);
  }
}

// Bottom centre, clear of the studio's own chrome and of the "copiar cambios" button.
function drawPausedBadge() {
  const { w, h } = viewport();
  const text = "PAUSADO · espacio para reanudar";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.font = '13px ui-monospace, "SF Mono", Menlo, monospace';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const tw = ctx.measureText(text).width;
  const bw = tw + 26;
  const x = w / 2 - bw / 2;
  const y = h - 46;
  ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
  ctx.fillRect(x, y, bw, 28);
  ctx.strokeStyle = "rgba(255, 200, 60, 0.9)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, bw, 28);
  ctx.fillStyle = "#ffc83c";
  ctx.fillText(text, w / 2, y + 14);
}

// ---------------------------------------------------------------------------
//  DIAGNOSTICS (?diag, or automatic when the mane paints nothing)
// ---------------------------------------------------------------------------
function drawDiagnostics(mediaTime) {
  const lines = [
    `NEON MANE DIAGNOSTICS   ${BUILD}`,
    ``,
    `mode            ${MODE}   calibrate=${calibrate} editor=${editing}`,
    `reduceMotion    ${reduceMotion}`,
    `dpr             ${dpr}   devicePixelRatio=${window.devicePixelRatio}`,
    `viewport        ${window.innerWidth}x${window.innerHeight}`,
    `canvas px       ${canvas.width}x${canvas.height}`,
    `cover           draw ${cover ? `${Math.round(cover.drawW)}x${Math.round(cover.drawH)}` : "—"}` +
      `  offset ${cover ? `${Math.round(cover.offsetX)},${Math.round(cover.offsetY)}` : "—"}`,
    `video           ${videoEl.videoWidth}x${videoEl.videoHeight} ready=${videoEl.readyState}` +
      ` paused=${videoEl.paused} t=${videoEl.currentTime.toFixed(2)}`,
    `tracking file   ${track ? `${track.keyframeCount} keyframes` : "NOT LOADED (5-point fallback)"}`,
    ``,
    `hair            ${hair ? "built" : "NULL (suppressed)"}`,
    `strands         ${hair ? hair.strands.length : "—"}`,
    `particles       ${hair ? hair.particles.length : "—"}`,
    `atlas glyphs    ${hair ? hair.atlas.size : "—"}   box=${hair ? hair.glyphBox : "—"}`,
    `GLYPHS DRAWN    ${glyphsDrawn}`,
    `font            ${CONFIG.fontWeight} ${CONFIG.fontSize}px  color ${CONFIG.color}`,
    `outline         ${CONFIG.glyphOutline.width}px ${CONFIG.glyphOutline.color}`,
    `alpha range     ${CONFIG.minAlpha}–${CONFIG.maxAlpha}  tipFade ${CONFIG.tipFade}`,
    ``,
    `systems         ${Object.entries(CONFIG.systems)
      .map(([k, v]) => `${k}=${v ? "on" : "off"}`)
      .join(" ")}`,
    ``,
    `loop error      ${loopError || "none"}`,
    ``,
    `press d to hide · add ?diag to force this panel`,
  ];

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  const pad = 12;
  const lh = 16;
  const w = 640;
  ctx.fillStyle = "rgba(0,0,0,0.86)";
  ctx.fillRect(10, 10, w, pad * 2 + lines.length * lh);
  ctx.font = '12px ui-monospace, "SF Mono", Menlo, monospace';
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  let y = 10 + pad + lh;
  for (const line of lines) {
    ctx.fillStyle = line.startsWith("GLYPHS DRAWN")
      ? glyphsDrawn > 0
        ? "#00ff66"
        : "#ff5588"
      : line === lines[0]
        ? "#00ff66"
        : "#cfe";
    ctx.fillText(line, 10 + pad, y);
    y += lh;
  }
}

// ---------------------------------------------------------------------------
//  STATIC MODE (original photo)
// ---------------------------------------------------------------------------
async function initStatic() {
  videoEl.hidden = true;
  imageEl.hidden = false;
  imageEl.src = CONFIG.static.image;

  const [horse, mask] = await Promise.all([
    loadImage(CONFIG.static.image),
    loadImage(CONFIG.static.mask),
  ]);
  srcW = horse.naturalWidth;
  srcH = horse.naturalHeight;

  const roots = withNeonDepth(
    sampleRootsFromLine(getImageData(horse), {
      strandCount: CONFIG.strandCount,
      xRange: CONFIG.rootXRange,
    })
  );
  hair = new HairSystem({
    roots,
    collision: new CollisionField(getImageData(mask)),
    bgImage: horse,
  });

  sizeCanvas();
  rebuildStatic();
  wireCommon(false);

  // Same reason as video mode: settle, then paint, then say you are ready.
  if (hair.simulating) {
    for (let i = 0; i < CONFIG.reduceMotionSettleSteps; i++) hair.update(1, 0);
  }
  renderStatic();

  if (reduceMotion) {
    stageReady();
    return;
  }
  lastPerf = performance.now();
  requestAnimationFrame(staticLoop);
  stageReady();
}

function rebuildStatic() {
  const { w, h } = viewport();
  computeCurrentCover();
  hair.collision.build(cover, CONFIG.maskAlign || CONFIG.align, w, h, CONFIG.collisionCell);
  hair.build(cover, CONFIG.align, dpr);
}

function staticLoop(now) {
  requestAnimationFrame(staticLoop);
  if (parked()) {
    lastPerf = now;
    return;
  }
  const dt = Math.min((now - lastPerf) / 16.6667, 2.2) || 1;
  lastPerf = now;
  hair.update(dt, now / 1000);
  notifyContact(hair.contact);
  decayPointer(CONFIG.pointer.decay);
  renderStatic();
}

function renderStatic() {
  const { w, h } = viewport();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (CONFIG.systems.renderHair) hair.draw(ctx, dpr);
  if (debug) hair.drawDebug(ctx, dpr, w, h);
}

// ---------------------------------------------------------------------------
//  CALIBRATION OVERLAY — read-only check of the 5-point tracking
// ---------------------------------------------------------------------------
function drawCalibration(mediaTime) {
  const cal = CONFIG.calibration;
  const col = cal.colors;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;

  const pts = sampleTracking(mediaTime);

  // 1. the full mane birth curve
  ctx.strokeStyle = col.spline;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= cal.splineSamples; i++) {
    const [nx, ny] = splinePoint(pts, i / cal.splineSamples);
    const s = normToScreen(nx, ny, cover, IDENTITY);
    i === 0 ? ctx.moveTo(s.x, s.y) : ctx.lineTo(s.x, s.y);
  }
  ctx.stroke();

  // 2. collision primitives — reference only, they push nothing while inspecting
  if (CONFIG.primitives.show) {
    ctx.strokeStyle = col.primitive;
    ctx.lineWidth = 1.5;
    for (const p of primitivesToScreen(mediaTime)) {
      if (p.type === "circle") {
        ctx.beginPath();
        ctx.arc(p.c[0], p.c[1], p.r, 0, TAU);
        ctx.stroke();
      } else {
        // capsule drawn simply: a circle at each end plus the connecting axis
        ctx.beginPath();
        ctx.arc(p.a[0], p.a[1], p.r, 0, TAU);
        ctx.moveTo(p.b[0] + p.r, p.b[1]);
        ctx.arc(p.b[0], p.b[1], p.r, 0, TAU);
        ctx.moveTo(p.a[0], p.a[1]);
        ctx.lineTo(p.b[0], p.b[1]);
        ctx.stroke();
      }
    }
  }

  // 3. where the strand roots would be distributed along the curve
  if (cal.showRootDots) {
    ctx.fillStyle = col.rootDot;
    for (const r of rootScreenPositions(mediaTime)) {
      ctx.beginPath();
      ctx.arc(r.x, r.y, cal.rootDotRadius, 0, TAU);
      ctx.fill();
    }
  }

  // 4. the five tracked control points, on top, each with its name
  ctx.font = cal.labelFont;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  for (const key of TRACK_ORDER) {
    const s = normToScreen(pts[key][0], pts[key][1], cover, IDENTITY);
    ctx.fillStyle = col.point;
    ctx.beginPath();
    ctx.arc(s.x, s.y, cal.pointRadius, 0, TAU);
    ctx.fill();
    ctx.fillStyle = col.label;
    ctx.fillText(key, s.x + cal.pointRadius + 4, s.y - cal.pointRadius - 3);
  }

  // The editor draws its own, richer HUD; don't stack two of them.
  if (!editing) drawCalibrationHud(mediaTime);
}

function drawCalibrationHud(mediaTime) {
  const cal = CONFIG.calibration;
  const { hud, colors } = cal;
  const v = CONFIG.video;

  const data = [
    `mediaTime  ${mediaTime.toFixed(4)} s`,
    `frame      ${frameIndexAt(mediaTime)} / ${v.frameCount - 1}`,
    `fps        ${v.fps}`,
    `duration   ${v.duration.toFixed(6)} s  (${v.frameCount} frames)`,
    `state      ${videoEl.paused ? "PAUSED" : "PLAYING"}`,
  ];
  const help = [
    `space play/pause   ← → ±${cal.seekCoarse}s   , . ±1 frame`,
    `c exit calibration   e track editor   click → console`,
  ];

  const lines = data.length + help.length + 1; // +1 blank separator
  ctx.fillStyle = colors.hudBg;
  ctx.fillRect(hud.x, hud.y, hud.width, hud.padding * 2 + lines * hud.lineHeight);

  ctx.font = hud.font;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  let y = hud.y + hud.padding + hud.lineHeight;
  ctx.fillStyle = colors.hudKey;
  for (const line of data) {
    ctx.fillText(line, hud.x + hud.padding, y);
    y += hud.lineHeight;
  }
  y += hud.lineHeight;
  ctx.fillStyle = colors.hudText;
  for (const line of help) {
    ctx.fillText(line, hud.x + hud.padding, y);
    y += hud.lineHeight;
  }
}

// ---------------------------------------------------------------------------
//  Shared wiring
// ---------------------------------------------------------------------------
const isTypingTarget = (el) =>
  !!el &&
  (el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable);

function wireCommon(isVideo) {
  const K = CONFIG.keys;

  // Brushing the cursor through the mane. Listened for on the window rather than the
  // canvas, which is pointer-events:none — see shared/js/pointer.js.
  //
  // ONE LIMITATION WORTH KNOWING: in video mode the solver is driven by
  // requestVideoFrameCallback, which only fires on a presented frame. With the clip
  // paused (space, or a frame step) the mane cannot answer the cursor at all. The
  // willow has no such gap because it runs on rAF.
  attachPointer();

  window.addEventListener("resize", onResize);
  document.addEventListener("visibilitychange", () => {
    paused = document.hidden;
    lastPerf = performance.now();
  });

  // Parked inside the shell. display:none already stops rVFC/rAF, but the clip
  // would keep playing behind a frozen canvas, so the mane would come back a
  // second of footage behind the neck it grows out of. `wasPlaying` is kept
  // because "d"/space may have paused the video on purpose before the switch.
  let wasPlaying = false;
  onStage({
    onShow: () => {
      stageHidden = false;
      lastPerf = performance.now();
      if (isVideo && wasPlaying && !reduceMotion) videoEl.play().catch(() => {});
      if (isVideo) drawFrameAt(videoEl.currentTime || 0);
      else renderStatic();
    },
    // Parking is what `stageHidden` is for; `paused` is left alone so that a
    // deliberate pause ("d"/space) survives a trip through the other pieces.
    // The image mode has no clip to stop, but its solver still has to.
    onHide: () => {
      stageHidden = true;
      if (!isVideo) return;
      wasPlaying = !videoEl.paused;
      videoEl.pause();
    },
  });

  window.addEventListener("keydown", (e) => {
    // Never steal keys from a text field.
    if (isTypingTarget(e.target)) return;

    // The editor gets first refusal: it owns "e" plus its own shortcuts.
    if (isVideo && editor && editor.handleKey(e)) {
      editing = editor.active;
      applySystems();
      if (videoEl.paused) drawFrameAt(videoEl.currentTime);
      return;
    }

    const k = e.key.toLowerCase();

    if (k === K.calibration && isVideo) {
      calibrate = !calibrate;
      applySystems();
      if (videoEl.paused) drawFrameAt(videoEl.currentTime);
      return;
    }
    if (k === K.staticDebug) {
      debug = !debug;
      // In video mode the same key clears the diagnostics panel, which is the
      // only overlay "d" can affect there.
      if (isVideo) {
        diag = false;
        framesRendered = 0;
        if (videoEl.paused) drawFrameAt(videoEl.currentTime);
      }
      return;
    }
    if (!isVideo) return;

    if (k === K.playPause) {
      e.preventDefault();
      if (videoEl.paused) {
        videoEl.play();
        paused = false;
        lastPerf = performance.now();
      } else {
        videoEl.pause();
        paused = true;
        drawFrameAt(videoEl.currentTime);
      }
      return;
    }
    if (k === K.seekBack) seekBySeconds(-CONFIG.calibration.seekCoarse);
    if (k === K.seekForward) seekBySeconds(CONFIG.calibration.seekCoarse);
    if (k === K.frameBack) seekToFrame(currentFrame() - 1);
    if (k === K.frameForward) seekToFrame(currentFrame() + 1);
  });

  if (isVideo) {
    // when scrubbing while paused, redraw the overlays for the new time
    videoEl.addEventListener("seeked", () => drawFrameAt(videoEl.currentTime));

    // The canvas is pointer-events:none unless the editor took it, so the
    // coordinate probe listens on the window. The background layers are
    // position:fixed inset:0, so client coords ARE the viewport coords the cover
    // transform is expressed in.
    window.addEventListener("click", (e) => {
      // While the editor is open, clicks are edits — don't also log them.
      if (!calibrate || editing || !cover) return;
      if (isTypingTarget(e.target) || e.target?.closest?.(".te-root")) return;
      const { nx, ny } = screenToNorm(e.clientX, e.clientY, cover, IDENTITY);
      const time = videoEl.currentTime;
      // eslint-disable-next-line no-console
      console.log({
        frame: frameIndexAt(time),
        time: Number(time.toFixed(4)),
        screen: [Math.round(e.clientX), Math.round(e.clientY)],
        normalizedVideo: [Number(nx.toFixed(4)), Number(ny.toFixed(4))],
      });
    });
  }
}

// paused single-frame redraw (used while scrubbing and after any edit)
function drawFrameAt(mediaTime) {
  if (!cover) return;
  applyManeFrame(mediaTime);
  if (collider) collider.setPrimitives(primitivesToScreen(mediaTime));
  renderVideo(mediaTime);
}

let resizeTimer = null;
function onResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    dpr = Math.min(window.devicePixelRatio || 1, CONFIG.dprCap);
    sizeCanvas();
    if (MODE === "video") {
      computeCurrentCover();
      if (hair) {
        // The root descriptors are NOT re-derived here, and that is safe rather than
        // lucky. Both of the things a root now carries from screen space survive a
        // resize untouched, because computeCover keeps the clip's aspect ratio and so
        // the normalized -> screen map is always a UNIFORM scale:
        //   - the band offset is `profilePx * cover.scale` px, which divided by
        //     drawW = 1280 * cover.scale is a constant in normalized space;
        //   - the launch angle comes from a tangent, and a uniform scale does not
        //     change angles.
        // Verified by resizing 1445x813 -> 1777x1000 -> 1600x900 with the strand
        // angles read out of the live system: identical to a tenth of a degree.
        hair.build(cover, IDENTITY, dpr);
        applyManeFrame(videoEl.currentTime || 0);
      }
      drawFrameAt(videoEl.currentTime || 0);
    } else {
      rebuildStatic();
    }
  }, 150);
}

// ---------------------------------------------------------------------------
console.info(`Neon Mane boot — ${BUILD} — mode=${MODE}${inspecting() ? " (inspecting)" : ""}`);

// The typeface is a BUILD INPUT, not a style: the glyph atlas is baked once and
// canvas falls back to the next family in the stack without saying so, so a font
// that lands a moment after build() would leave the mane in the fallback face for
// the whole session. Awaited HERE, ahead of both modes, because it is the one thing
// both of them need before they can reach hair.build(). See shared/js/fonts.js —
// it gives up after 2.5s rather than hold the piece hostage to a font.
async function boot() {
  console.info(`Font: ${await ensureGlyphFont(CONFIG.fontFamily, CONFIG.fontWeight)}`);

  if (MODE === "video") {
    initVideo().catch((err) => {
      console.error(
        "initVideo failed, so the mane never started. The video may still be playing " +
          "underneath via its autoplay attribute, which looks like an empty canvas.",
        err
      );
    });
  } else {
    initStatic().catch((err) => console.error("initStatic failed:", err));
  }
}

boot();
