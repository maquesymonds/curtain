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
import { hash, lerp, sampleProfile } from "../../shared/js/utils.js";
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
    // SMALL, and kept small deliberately. It sits just behind the head and in the
    // reference it is a short fin, not a streamer — giving it the scale of the
    // lower fins was part of what made the underside read as one big tangle.
    arc: [[0.46, 0.56], [0.40, 0.64]],
    dirBase: 150,
    spread: 22,
    lenMax: 0.46,
    lenProfile: [0.6, 1.0, 0.72],
    count: 10,
    zBright: -0.7, zDim: 0.2, zFade: 0.34, rays: 3,
    drape: 0.1,
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
      const dirDeg = fin.dirBase + (0.5 - s) * fin.spread;
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
export function updateFinRoots(hair, pose, buildPose, cover) {
  const da = ((pose.angle - buildPose.angle) * Math.PI) / 180;
  const ca = Math.cos(da);
  const sa = Math.sin(da);
  // Fin length tracks the body's apparent size, so the strands don't have to be
  // rebuilt when it changes; the difference over this clip is small enough that
  // scaling the rest offsets covers it.
  const k = pose.halfLen / buildPose.halfLen;

  for (let i = 0; i < hair.strands.length; i++) {
    const strand = hair.strands[i];
    const def = strand.rootDef;
    if (!def || def.u == null) continue;
    const [nx, ny] = localToNorm(pose, def.u, def.v);
    const { x, y } = normToScreen(nx, ny, cover, IDENTITY);

    const ps = strand.particles;
    const root = ps[0];
    root.pos.set(x, y);
    root.oldPos.set(x, y);
    root.rest.set(x, y);

    for (let j = 1; j < ps.length; j++) {
      const ox = ps[j].restOffset.x * k;
      const oy = ps[j].restOffset.y * k;
      ps[j].rest.set(x + (ox * ca - oy * sa), y + (ox * sa + oy * ca));
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
