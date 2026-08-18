// ============================================================================
//  FINS — the four fin groups, their root arcs, and the per-frame root update.
//
//  Each fin is a short ARC of roots on the body contour plus a growth direction
//  that FANS across that arc, which is what makes a fin read as a fin: real fin
//  rays leave a narrow base and open outward. Read off the reference clip, the
//  four groups are dorsal (tall fan behind the head), caudal (the long veil, the
//  big one), a near and a far pectoral under the front of the belly, and the anal
//  at the rear of the belly.
//
//  ------------------------------------------------------------------------
//  WHERE THE BRIGHTNESS COMES FROM — and it is NOT what the willow does.
//
//  In the willow every liana starts bright and fades along its own length. In a
//  fin it does not, and this is measured, not assumed. Over 41 reference frames,
//  splitting the luminance variation inside a fin into its two directions:
//
//      ALONG the fin (root -> tip), between radial bands   std =  7.97
//      ACROSS the fin (ray to ray)                         std = 17.05
//                                              across wins by x2.14
//
//  So a fin is lit as a STRUCTURE OF RAYS: bright ribs with darker membrane
//  between them, each rib roughly even along its length. The root-to-tip fall is
//  real but half as strong (the along profile runs 47.5 -> 33.2 over eight bands,
//  peaking in the first).
//
//  Hence: `zBright`/`zDim` set how far apart neighbouring RAYS are, `zFade` sets
//  the gentle fall along each one, and `rays` is how many bright ribs the fan
//  carries. The z range across the fan is deliberately about 2x the range along a
//  strand, to match the ×2.14 above.
//
//  REGLA 1 still holds where it actually bites: brightness is NEVER filtered by
//  ny or by a height band. A ray's brightness depends on WHICH RAY it is within
//  its own fan — never on where it happens to sit on screen. A bright rib at the
//  bottom of the belly is authored exactly as bright as one on top of the back.
//
//  Corollary, also from REGLA 1: a strand needs enough characters for a ramp to
//  BE a ramp. `lenFrac` is a fraction of the body's on-screen half-length (~331
//  css px at a 1440x900 viewport), so even the shortest ray here — pectoralFar at
//  0.55 — builds ~182 px, about 17 characters at segmentLength 11, and the caudal
//  runs to 60+. Nothing in this table is a 3-character stub used as filler.
//  ------------------------------------------------------------------------
// ============================================================================

import { CONFIG } from "./config.js";
import { hash, lerp, sampleProfile, smoothstep } from "../../shared/js/utils.js";
import { normToScreen } from "../../shared/js/cover.js";
import { localToNorm, dirToStrandAngle } from "./bodyTrack.js";

const IDENTITY = { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 };

// `arc`        root positions in body space, in order; roots spread along it
// `dirBase`    growth direction in body space (180° = straight astern)
// `spread`     total fan across the arc. Applied as (0.5 - s), so the FIRST arc
//              point gets dirBase + spread/2 and the last dirBase - spread/2.
//              Getting this sign backwards makes the rays converge and cross,
//              which reads as a knot rather than a fin.
// `lenMax`     longest ray, as a fraction of the body's on-screen half-length
// `lenProfile` how length varies ACROSS the fan, sampled by arc position. This is
//              the anatomy: a fan whose rays are all one length is a paper fan.
//              Each fin gets its own, because each fin has its own shape.
// `drape`      sideways arc of the resting pose. Small on purpose — see the note
//              on the lower fins.
// `zBright`/`zDim`/`zFade`/`rays`  see the brightness note in the header
export const FINS = [
  {
    name: "dorsal",
    // v pulled in from -0.86 to -0.72: `halfDepth` is the body's MAXIMUM transverse
    // extent, and that maximum includes the real tail fin flicking (24.6% of
    // variation over the clip), so it overstates where the back actually is. At
    // -0.86 the fan floated with a dark gap between it and the skin.
    arc: [[0.34, -0.66], [0.18, -0.72], [0.02, -0.74], [-0.14, -0.72], [-0.3, -0.66]],
    dirBase: 205,
    spread: 46, // front rays rise steeply (228°), rear rays trail astern (182°)
    lenMax: 1.0,
    // A clean triangular sail: short at the leading edge, longest just past the
    // middle, tapering off at the back. This is what gives the dorsal a silhouette
    // instead of a scatter of letters above the fish.
    lenProfile: [0.34, 0.62, 0.88, 1.0, 0.92, 0.7, 0.44],
    count: 22,
    zBright: -0.78, zDim: 0.14, zFade: 0.4, rays: 6,
    drape: 0.16,
  },
  {
    name: "caudal",
    // AT THE PEDUNCLE, not at the tail tip. `halfLen` measures to the far edge of
    // the fish's OWN tail fin, so roots at u = -1.0 were being born a whole tail
    // fin behind the body: the render showed the real orange tail, then a gap,
    // then the code starting on its own. Born at -0.74 the code fin lies OVER the
    // real one and grows out past it, which is what makes it read as attached.
    arc: [[-0.70, -0.28], [-0.76, -0.10], [-0.78, 0.10], [-0.74, 0.28]],
    dirBase: 180,
    spread: 34,
    // Bounded by where the fish actually swims: its centre sits at 0.46-0.53 of the
    // frame width and the tail therefore around 0.27, so a ray longer than ~1.4 of
    // the half-length runs out of picture.
    lenMax: 1.45,
    // LOBED, and this is the single most important profile in the file. A goldfish
    // veil tail is not one triangle — it is several lobes of different length that
    // overlap and part as it moves. The alternation here is what lets the eye
    // follow individual filaments from the body to the tip instead of reading one
    // cloud, and it is why the caudal gets its own profile rather than the arch
    // every fin used to share.
    lenProfile: [0.52, 0.86, 1.0, 0.74, 0.93, 0.66, 0.88, 1.0, 0.8, 0.5],
    count: 34, // the veil carries by far the most rays
    zBright: -0.82, zDim: 0.16, zFade: 0.42, rays: 8,
    drape: 0.13,
  },
  {
    name: "pectoral",
    // Was SMALL on purpose — giving it the scale of the lower fins previously
    // made the underside read as one big tangle (see the fish/README history
    // if this needs re-litigating). Made denser and longer anyway now that it
    // has its own tracked beat (flap, below) instead of just sitting there:
    // worth re-checking against the reference for that same tangle before
    // pushing count/lenMax any further.
    // Was 2 points ([[0.46,0.56],[0.40,0.64]]) — every ray born off the same
    // short line, which is why the curtain read as a strip glued onto part of
    // the fin instead of growing out of its whole base. 4 points now, wider
    // span. Rough — this is a starting shape, not a traced outline; nudge it
    // with the anchor editor (?anchors, "e", global mode) against the actual
    // video, which will beat guessing from a still every time.
    arc: [[0.5, 0.5], [0.46, 0.56], [0.4, 0.64], [0.34, 0.7]],
    dirBase: 150,
    spread: 34, // was 22 — wider fan
    lenMax: 0.7, // was 0.46
    lenProfile: [0.6, 1.0, 0.72],
    count: 16, // was 10
    zBright: -0.7, zDim: 0.2, zFade: 0.34, rays: 3,
    drape: 0.1,
    // Overrides the piece's global collisionFromDepth (0.18) for JUST this
    // fin's roots. The tuck half of `flap` below sweeps the ray back TOWARD
    // the body — collision resisting that is what capped the retract short
    // of the full authored angle, direction the other fins never sweep in.
    // Raising the global value instead would loosen collision for every fin,
    // and collision exists specifically because pectoral/anal rays got pushed
    // through the belly without it. Starting point, not measured.
    collisionFromDepth: 0.45,
    // GLUED, not just held — the fraction of the ray (from the root) that
    // tracks the real fin's tracked position and angle EXACTLY, no bendReturn
    // spring, no lag, the same way the single root particle already does.
    // Past this depth the curtain lets go and is ordinary physics. Rough
    // starting value for "about where the real fin ends" — the honest way to
    // pin it down is to watch the reference and see where the curtain stops
    // matching it.
    pinDepth: 0.4,
    // THE REAL FIN'S OWN BEAT — not swell. Unlike the other four fins, the
    // reference pectoral does not just get bent by the water: it sweeps on
    // its own, faster than the body's 2.5s cycle — about three beats per
    // loop. Read by eye off 30 frames sampled every 2, cropped and centred on
    // the fin using the body tracking (fish-tracking.json) so the crop
    // followed the fish instead of a fixed box. NOT a pixel measurement —
    // there is no way to segment a same-colour, translucent, fast-moving fin
    // from the body by a colour mask the way the whole-body pose was — but
    // the sweep-forward / tuck-back rhythm and its timing are read off the
    // actual footage, not invented. Degrees, ADDED to dirBase: negative sweeps
    // forward (toward the snout), positive tucks back toward the body.
    // [frame, deg] — wraps smoothly from the last pair back to the first.
    flap: [
      [0, 10], [2, 5], [4, 8], [6, 5], [8, -15], [10, -25],
      [12, -30], [14, -35], [16, -10], [18, 25], [20, 35], [22, 30],
      [24, 10], [26, 5], [28, -15], [30, -25], [32, -5], [34, 30],
      [36, 35], [38, 15], [40, 0], [42, 5], [44, 0], [46, 0],
      [48, 30], [50, 10], [52, -20], [54, -30], [56, -25], [58, 10],
    ],
  },
  {
    name: "pelvic",
    // Long trailing ribbon off the front of the belly.
    //
    // `drape` was 0.55 here with curveBias 0.14, and that combination is what drew
    // the big artificial U under the fish: `drape` arcs the resting pose SIDEWAYS
    // across its own direction, and at that strength on a long strand the arc came
    // back on itself into a loop. A fin trails; it does not curl. Everything below
    // is now a gentle directional bend, never a circle.
    arc: [[0.16, 0.68], [0.06, 0.72]],
    dirBase: 156,
    spread: 20,
    lenMax: 1.05,
    lenProfile: [0.55, 0.9, 1.0, 0.78],
    count: 14,
    zBright: -0.75, zDim: 0.1, zFade: 0.38, rays: 4,
    drape: 0.12,
  },
  {
    name: "anal",
    arc: [[-0.30, 0.70], [-0.46, 0.64], [-0.58, 0.54]],
    dirBase: 168,
    spread: 22,
    lenMax: 0.92,
    lenProfile: [0.6, 0.95, 1.0, 0.72, 0.48],
    count: 14,
    zBright: -0.75, zDim: 0.12, zFade: 0.38, rays: 4,
    drape: 0.1,
  },
];

// Depth of the ray at arc position `s`. A raised cosine across the fan gives
// `fin.rays` bright ribs with darker membrane between them; the strand sits
// somewhere on the zBright..zDim line accordingly.
function zFor(fin, s, index) {
  const rib = 0.5 + 0.5 * Math.cos(s * fin.rays * Math.PI * 2);
  const jitter = 0.78 + hash(index * 4.31) * 0.22;
  return lerp(fin.zDim, fin.zBright, Math.min(1, rib * jitter));
}

// Walk the arc as a polyline at parameter s in 0..1.
function alongArc(arc, s) {
  if (arc.length === 1) return arc[0];
  const x = Math.min(0.999999, Math.max(0, s)) * (arc.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = arc[i];
  const b = arc[i + 1];
  return [lerp(a[0], b[0], f), lerp(a[1], b[1], f)];
}

// The 60-frame tracked loop's own length (fish-tracking.json) — `flap`
// keyframes above are authored against this, same domain as trackCorrection/
// finAnchorFrame's `frame` argument.
const FLAP_FRAME_COUNT = 60;

// Wrapped interpolation across a fin's `flap` keyframes: smoothstep between
// the two bracketing entries, wrapping from the last one back to the first
// (frame count away, not frame 0) so a fin that beats on its own reads as a
// continuous cycle, not a table that resets. Returns 0 for a fin with no
// `flap` table.
//
// `lead` (CONFIG.flapLead, frames) shifts the lookup EARLIER — compensates
// for the rig reading late, whichever of two reasons that turns out to be:
// the by-eye keyframes themselves landing a frame or two behind the real
// footage, or bendReturn's spring not being stiff enough to reach a fast-
// moving target on time. Wrapped the same way `frame` itself is, so a lead
// that pushes past frame 60 (or before 0) still lands correctly.
function flapAngleAt(fin, frame, lead = 0) {
  const kf = fin.flap;
  if (!kf || !kf.length) return 0;
  const n = kf.length;
  const wrapped = (((frame + lead) % FLAP_FRAME_COUNT) + FLAP_FRAME_COUNT) % FLAP_FRAME_COUNT;
  let ai = n - 1;
  for (let i = 0; i < n; i++) {
    if (kf[i][0] <= wrapped) ai = i;
    else break;
  }
  const bi = (ai + 1) % n;
  const [fa, da] = kf[ai];
  const [fbRaw, db] = kf[bi];
  const fb = fbRaw <= fa ? fbRaw + FLAP_FRAME_COUNT : fbRaw;
  const f = wrapped < fa ? wrapped + FLAP_FRAME_COUNT : wrapped;
  const t = fb === fa ? 0 : smoothstep(0, 1, (f - fa) / (fb - fa));
  return da + (db - da) * t;
}

// Build the root descriptors HairSystem.build() consumes. Everything that has to
// survive to the per-frame update — the body-local position, the fan direction —
// is stashed on the descriptor, which arrives back as `strand.rootDef`.
export function buildFinRoots(pose, cover) {
  const halfLenPx = pose.halfLen * cover.drawW;
  const roots = [];
  let index = 0;

  for (const fin of FINS) {
    for (let i = 0; i < fin.count; i++) {
      const s = fin.count === 1 ? 0.5 : i / (fin.count - 1);
      const [u, v] = alongArc(fin.arc, s);
      // CONFIG.finSpreadScale is a global multiplier over every fin's own
      // authored `spread` — 1 leaves the table above untouched. It's the only
      // lever for "all the fans open wider" that doesn't mean re-authoring
      // five numbers in this file by hand.
      const dirDeg = fin.dirBase + (0.5 - s) * fin.spread * CONFIG.finSpreadScale;
      const [nx, ny] = localToNorm(pose, u, v);

      const h = hash(index * 9.17);
      // ANATOMY DOMINATES THE RANDOM. The fin's own profile decides this ray's
      // length; the hash only breaks the symmetry so the fan doesn't read as a
      // stencil. It is deliberately a narrow band (±8%) — a wide random here is
      // exactly what turns a fin into a bush, because then neighbouring rays stop
      // agreeing about where the fin's edge is and the silhouette dissolves.
      const lenFrac = fin.lenMax * sampleProfile(fin.lenProfile, s) * (0.92 + h * 0.16);

      roots.push({
        nx,
        ny,
        t: s,
        u, // body-local, NOT a spline parameter — see bodyTrack.js
        v,
        fin: fin.name,
        dirDeg,
        angle: dirToStrandAngle(pose, dirDeg),
        lengthPx: lenFrac * halfLenPx,
        // WHICH RAY this is decides how bright it is — see the header. `rib` runs
        // 1 at the centre of a bright rib to 0 in the membrane between two, so
        // neighbouring strands land far apart in z and the fan reads as ribbed.
        // The jitter keeps the ribs from being a perfectly regular comb, which
        // would read as a printed pattern rather than a fin.
        z: zFor(fin, s, index),
        // ...and then a GENTLE fall along its own length, half the size of the
        // rib-to-rib difference, matching the 7.97-vs-17.05 measured split.
        zTip: Math.min(1, zFor(fin, s, index) + fin.zFade),
        drape: fin.drape * (0.75 + hash(index * 2.53) * 0.5),
        windGain: 0.85 + hash(index * 6.71) * 0.4,
        // Per-fin override, read by hairSystem.js's _collide(); undefined for
        // every fin but pectoral, which falls back to CONFIG.collisionFromDepth.
        collisionFromDepth: fin.collisionFromDepth,
        // Read directly above in updateFinRoots — undefined (0) for every fin
        // but pectoral.
        pinDepth: fin.pinDepth,
      });
      index++;
    }
  }
  return roots;
}

// Per-frame: move each pinned root onto the body's current pose, and carry the
// whole rest pose with it — rotated by however much the body has turned since
// build. Without the rotation the rest poses stay locked to the build-time tilt
// and `bendReturn` quietly drags every fin back toward it; over the 3.9° this
// clip turns that is small but it is exactly the lag that made the horse's mane
// trail behind its head.
//
// `frameStore` (finAnchorFrameStore.js) + `frame` are optional: a per-frame
// nudge on individual arc CONTROL points, layered on top of the (possibly
// hand-edited) base arc, for the drift that shows up on a handful of roots at
// a handful of frames rather than the whole fan or the whole clip. Computed
// once per FIN here, not per strand — at most 5 fins x <=5 points, trivial
// next to the ~82 particles below — and skipped entirely when the store is
// empty, so a piece with no per-frame corrections pays nothing for this.
//
// `frame` is also what drives `flap` (the pectoral's own beat, read off the
// reference by eye — see its FINS entry): unlike the other four fins, which
// only ever rotate by however much the BODY has turned (`da`), a fin with a
// `flap` table adds its own tracked sweep on top, per fin, still once here
// and not per strand.
export function updateFinRoots(hair, pose, buildPose, cover, frameStore, frame) {
  const da = ((pose.angle - buildPose.angle) * Math.PI) / 180;
  const ca = Math.cos(da);
  const sa = Math.sin(da);
  // Fin length tracks the body's apparent size, so the strands don't have to be
  // rebuilt when it changes; the difference over this clip is small enough that
  // scaling the rest offsets covers it.
  const k = pose.halfLen / buildPose.halfLen;

  const correctedArcs =
    frameStore && frameStore.count > 0
      ? new Map(FINS.map((fin) => [fin.name, frameStore.correctedArc(fin.name, fin.arc, frame)]))
      : null;

  // Per-fin rotation for fins with their OWN beat (currently just the
  // pectoral — see `flap` on its FINS entry): `da` plus that fin's angle at
  // this frame, computed once per fin here rather than per strand. Fins
  // without a `flap` table just get `ca`/`sa`, unchanged from before this
  // existed.
  let flapRot = null;
  for (const fin of FINS) {
    if (!fin.flap) continue;
    if (!flapRot) flapRot = new Map();
    const rad = da + (flapAngleAt(fin, frame, CONFIG.flapLead) * Math.PI) / 180;
    flapRot.set(fin.name, [Math.cos(rad), Math.sin(rad)]);
  }

  for (let i = 0; i < hair.strands.length; i++) {
    const strand = hair.strands[i];
    const def = strand.rootDef;
    if (!def || def.u == null) continue;

    let u = def.u;
    let v = def.v;
    const arc = correctedArcs?.get(def.fin);
    if (arc) [u, v] = alongArc(arc, def.t);

    const [nx, ny] = localToNorm(pose, u, v);
    const { x, y } = normToScreen(nx, ny, cover, IDENTITY);

    const ps = strand.particles;
    const root = ps[0];
    root.pos.set(x, y);
    root.oldPos.set(x, y);
    root.rest.set(x, y);

    const rot = flapRot?.get(def.fin);
    const ca2 = rot ? rot[0] : ca;
    const sa2 = rot ? rot[1] : sa;
    // `pinDepth` (fraction of the ray, from the root) glues particles to the
    // tracked pose exactly, the same way the root itself is teleported above
    // — not held by bendReturn's spring, which still lets a fast target like
    // `flap` fall behind. This is "where the real fin ends": inside it the
    // curtain should track the actual fin with no lag or give, same as the
    // root; past it, ordinary physics (swell, bendReturn, gravity) takes over
    // same as any other strand.
    const pinDepth = def.pinDepth ?? 0;
    for (let j = 1; j < ps.length; j++) {
      const p = ps[j];
      const ox = p.restOffset.x * k;
      const oy = p.restOffset.y * k;
      const rx = x + (ox * ca2 - oy * sa2);
      const ry = y + (ox * sa2 + oy * ca2);
      p.rest.set(rx, ry);
      if (p.depth <= pinDepth) {
        p.pos.set(rx, ry);
        p.oldPos.set(rx, ry);
      }
    }

    if (hair.rootScreen[i]) {
      hair.rootScreen[i].x = x;
      hair.rootScreen[i].y = y;
    }
  }
}

// Per-strand phase offset for the swell, assigned once after build. Strands in
// the same fin share a beat but not an exact phase, so a fin flexes as a body of
// water instead of as one rigid sheet. Keyed off the fin so the four groups stay
// legibly separate.
export function assignSwellPhases(hair) {
  const finIndex = new Map(FINS.map((f, i) => [f.name, i]));
  for (let i = 0; i < hair.strands.length; i++) {
    const strand = hair.strands[i];
    const def = strand.rootDef || {};
    const base = (finIndex.get(def.fin) ?? 0) * CONFIG.swell.finPhase;
    strand.swellPhase = base + (def.t ?? 0) * CONFIG.swell.arcPhase + hash(i * 3.7) * CONFIG.swell.jitterPhase;
  }
}
