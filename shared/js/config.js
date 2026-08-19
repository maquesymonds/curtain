// ============================================================================
//  SHARED CONFIG — the knobs every piece has in common.
//
//  This holds DEFAULTS. Each piece (horse/, willow/, …) has its own config.js
//  that calls `configure({...})` with its overrides plus whatever extra blocks
//  it needs, then re-exports CONFIG. Because CONFIG is one mutable object, the
//  shared modules below read the merged result without knowing which piece they
//  are running inside.
//
//  Order matters: a piece's config.js must run `configure()` at module load,
//  before anything reads CONFIG. Importing the piece's config.js first (which
//  every module does) guarantees that.
// ============================================================================

export const CONFIG = {
  // ----- SYSTEM TOGGLES ----------------------------------------------------
  // Every subsystem can be switched off on its own, which is how you find out
  // which one is ruining a look instead of guessing.
  systems: {
    renderHair: true, // draw the glyph strands at all
    gravity: true, // downward pull + the sideways drape bias
    wind: true, // procedural breeze
    swell: false, // water: travelling wave along each strand (see swell.js)
    collision: false, // push particles out of the body primitives / mask
    // A steady force pushing every particle away from the body's centre (not
    // its surface, like collision does) — see radialPush below. Off by
    // default: it only means something for a collider that exposes a body
    // centre (cx/cy/cover), which willow's mask-based one does not.
    radialPush: false,
    cohesion: true, // lateral springs between neighbouring strands
    bendReturn: true, // root stiffness, pulls top particles toward rest
    // A curvature-resisting pull along the WHOLE strand — see bendStiffness
    // below and the note on hairSystem.js's _bendStiffness(). Off by default;
    // bendReturn already covers what every piece has wanted at the root.
    bendStiffness: false,
    loopConverge: false, // retired; see the horse config for the history
    pointerInteraction: false, // not wired yet
    glow: false, // bake a halo into each glyph
  },

  // ----- TEXT --------------------------------------------------------------
  // Either `words` (reads as language) or `charPool` (reads as abstract data).
  // charPool wins when set — see hairText() at the bottom of this file.
  words: ["FILAMENTO", "MEMORY", "MOTION", "BODY", "SYSTEM", "IDENTITY", "DATA", "010101"],
  charPool: null,
  charSequenceLength: 4096,
  // Every strand starts at the FIRST character of the text instead of where the
  // previous strand left off, so a one-word text reads as that word from the root
  // down, over and over, in every strand — the curtain says something instead of
  // showing a slice of something. The trailing space hairText() adds is what
  // separates one repetition from the next.
  //
  // Ignored when `charPool` is set, and that is not a limitation but the rule: a
  // pool is a shuffled repertoire with no first character to start from, so
  // starting every strand at index 0 would make every strand identical.
  textFromRoot: false,

  // ----- GLYPHS ------------------------------------------------------------
  color: "#ffd9ee", // glyph fill. Must be LIGHTER than what it falls over.
  // The typeface the curtain is SET IN. A stack, and the last entries matter: the
  // atlas is baked once (hairSystem._buildAtlas) and canvas falls back silently, so
  // whatever is reachable when the build runs is what the piece wears all session —
  // see shared/js/fonts.js, which is what makes the wait certain.
  //
  // A proportional face is fine here even though this looks like a job for a
  // monospace one: every glyph is drawn CENTRED in its own square box and the step
  // along a strand is `segmentLength`, never the character's advance width. Nothing
  // downstream reads a glyph's width.
  fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
  fontSize: 16,
  fontWeight: 300, // 300 light / 400 regular; keep off bold
  // Rotate each glyph to follow its strand's local direction. Off is both cheaper
  // (one transform for the whole batch instead of one per character) and closer to
  // how falling code reads — the characters stay level while the column curves.
  glyphRotate: true,
  glowIntensity: 0, // halo blur radius in px; only used when systems.glow

  // ----- EMISSION ----------------------------------------------------------
  // A glyph can be flat colour with a contrast outline, or it can look like it is
  // LIT. The difference is BAKED, not drawn per frame: each atlas variant can carry a
  // wide soft bloom under the letter and a hotter core inside it, so a frame is still
  // one drawImage per character no matter how many passes the look needed.
  //
  //   bloom  the glyph drawn `passes` times with a large shadowBlur in `color`. This
  //          is what puts light AROUND the character — the thing a stroke cannot do.
  //   core   the glyph drawn once more in `color` on top, no blur. This is what makes
  //          the middle read as the hot part of a filament instead of tinted paint.
  //
  // The two together are the neon-sign structure: a white-hot core, a saturated body,
  // a soft halo. Both are off by default (passes 0, alpha 0), so a piece that does not
  // ask for them bakes exactly the atlas it baked before.
  //
  // Costs box size, not frame time: `blur` widens the padding every glyph bitmap
  // needs, which is fill rate on the blit. Measured on the horse at 1440x900, the box
  // goes 39px with no bloom -> 57px at 2 passes of blur 9 -> 70px at 4 passes of blur
  // 14.2. That last one is 3.2x the pixels per glyph against no bloom, and it still
  // draws in under 2ms at ~1100 glyphs, because the work is one blit either way.
  glyphBloom: {
    passes: 0,
    blur: 0, // px of shadowBlur for the halo
    alpha: 0.5, // per pass; they accumulate
    color: null, // falls back to CONFIG.color
  },
  glyphCore: {
    alpha: 0, // 0 = no core pass
    color: null, // falls back to CONFIG.color
  },
  // Thin outline behind each glyph. NOT a glow: a stroke is centred on the path,
  // so `width` only grows the glyph by half of it. It exists because thin pink
  // text over a bright subject has almost no contrast on its own.
  glyphOutline: {
    width: 2.5,
    color: "rgba(120, 0, 55, 0.9)",
  },
  // ----- DEPTH -------------------------------------------------------------
  // Strands can carry a `z` (0 = nearest the viewer, 1 = deepest in the mass).
  // Everything below interpolates front -> back across that range, which is what
  // separates a flat decal from something with volume:
  //   scale  smaller as it recedes
  //   alpha  dimmer as it recedes
  //   glow   less self-light as it recedes
  //   haze   blended toward `hazeColor` — atmospheric perspective, the strongest
  //          cue of the four, because it also desaturates
  // Draw order follows z as well: deepest first, nearest last.
  //
  // Off by default: with it disabled a single glyph atlas is baked and the
  // renderer behaves exactly as it did before, which is what the horse wants.
  // `z` runs from -1 to 1, not 0 to 1:
  //    z < 0   HIGHLIGHTS — nearer than the front plane, blended toward
  //            `highlightColor` and given extra glow. A handful of these is what
  //            keeps a mass of one colour from looking flat and even.
  //    z = 0   the front plane, the glyph's own colour
  //    z > 0   receding, blended toward `hazeColor`
  depth: {
    enabled: false,
    buckets: 6, // baked atlas variants across the whole -1..1 range
    scale: [1.0, 0.6], // at z=0 and z=1; highlights use the z=0 value
    alpha: [1.0, 0.4],
    glow: [1.0, 0.25],
    haze: [0.0, 0.6],
    hazeColor: "#12283a",
    highlightColor: "#eafff0", // near-white
    highlight: 0.6, // how far toward it a z=-1 strand goes
    highlightGlow: 1.7, // glow multiplier at z=-1
    // Shape of the z ramp from root to tip, for strands where zTip differs from z.
    // 1 = linear. Above 1 holds the root's value further down the strand, which
    // spreads a highlight over several characters instead of concentrating it on
    // the pinned root that never moves. Only matters when a piece ramps z.
    rampCurve: 1,
    // Fraction of the strand the ramp completes within; 1 = all the way to the tip.
    // Set it below the piece's `frayFrom` so the ramp is finished before the frayed
    // stretch where characters start dropping out — otherwise the bright part of
    // the ramp lands on scattered single glyphs.
    rampSpan: 1,
  },

  // Draw no glyph on the pinned root particle. Off by default so the horse is
  // untouched; a piece whose strands are brightest at the root wants it on, since
  // there the immobile character is also the most conspicuous one.
  hideRootGlyph: false,

  minAlpha: 0.8, // per-glyph alpha low end
  maxAlpha: 1.0,
  minScale: 0.8, // per-glyph size multiplier low end
  maxScale: 1.12,
  tipFade: 0.3, // extra fade toward the loose tip of each strand (0..1)

  // ----- STRAND SHAPE ------------------------------------------------------
  strandCount: 84, // meaning depends on the piece (see each config)
  lengthRange: [80, 340], // [shortest, longest] strand length in css px
  segmentLength: 16, // css px between particles (drives particles-per-strand)
  minParticles: 6,
  maxParticles: 32,
  // 0..1 multipliers applied along lengthRange, sampled by each root's `t`.
  // A single-entry array means "no profile": every strand uses lengthRange fully.
  lengthProfile: [0.15, 0.45, 0.8, 1.0, 0.95, 0.75, 0.6],
  lengthJitter: 0.16, // ± random variation per strand so it feels organic
  drapeLean: 0.28, // initial lean of each strand toward the near side (frac)

  // ----- NATURAL SHAPE -----------------------------------------------------
  // Four things that separate a hanging strand from a printed column of text.
  // All default to neutral, so a piece that doesn't set them behaves as before.
  //
  // A strand can carry a signed `drape` (-1 left .. +1 right). On a tree that is
  // the direction away from the trunk, so the crown opens outward the way real
  // foliage does instead of every strand falling dead vertical and parallel.
  curveBias: 0, // how far the RESTING pose arcs sideways, as a fraction of length
  maxArcPx: 1e9, // absolute cap on that arc, so long strands don't sweep out of frame

  // ----- GROWTH DIRECTION, AND LETTING GO OF IT ----------------------------
  // A root can carry an `angle` (see Strand): the direction the whole resting pose
  // grows in, 0 being straight down. `angleRelax` is the fraction of the strand over
  // which that direction decays back to straight down.
  //
  //   0  keep the angle for the strand's whole length. What a fin wants: it leaves
  //      the body and stays in the plane it left in.
  //   >0 leave along the angle, then bend into the fall. What hair on a crest does —
  //      it emerges almost flat along the surface and gravity takes it from there.
  //
  // This is a property of the RESTING pose, so what holds it against gravity is
  // `bendReturn` at the top of the strand; past the stiff root particles the physics
  // wins, which is the progressive handover rather than a break.
  angleRelax: 0,
  angleRelaxCurve: 1, // >1 holds the launch direction longer before it gives way

  // ----- ROOT VOLUME -------------------------------------------------------
  // A hanging strand can read as a line of type for its whole length, or it can
  // start as part of a MASS. Over the first `span` of the strand the characters are
  // set larger and packed closer, so the first stretch of every strand reads as one
  // dense surface instead of N separate columns with the subject showing between
  // them. Neutral by default (`span: 0` switches the whole block off).
  rootVolume: {
    span: 0, // fraction of the strand affected
    scale: 1, // glyph size multiplier AT the root, fading to 1 by `span`
    spacing: 1, // segment length multiplier at the root; < 1 packs characters
    curve: 1, // shape of the fade; > 1 keeps the effect nearer the root
  },
  drapeSpread: 0, // lateral force per unit of drape, scaled toward the tip, which
  //                 is what holds the arc open against gravity
  tipScale: 1, // glyph size multiplier at the tip: < 1 tapers the strand
  wander: 0.5, // per-strand horizontal drift, in units of one segment

  // Per-character irregularity. Without these a strand is evenly set type on a
  // ruled axis, which is the tell that gives away a procedural grid however much
  // the strand as a whole curves.
  waverAmp: 0, // slow sideways bend along the strand, in units of one segment
  // How many waver cycles fit along a strand, picked per strand from this range.
  // The default is what every piece had hard-coded. LOW values give one long lazy
  // bend — what something suspended in water does; high values give a repetitive
  // ripple that reads as procedural noise laid on a line.
  waverFreq: [1.4, 3.6],
  charJitterX: 0, // per-character sideways nudge, in units of one segment
  charSpacingJitter: 0, // ± variation in the gap between characters
  // Fraying: past `frayFrom` (0..1 along the strand) characters start dropping
  // out, so the end scatters into isolated glyphs instead of stopping on a clean
  // horizontal line. `frayAmount` is the drop chance reached at the very tip.
  frayFrom: 1,
  frayAmount: 0,

  // ----- PHYSICS -----------------------------------------------------------
  gravity: 0.062, // downward pull per frame (higher = heavier hang)
  damping: 0.9, // velocity retention (lower = more drag / calmer)
  iterations: 6, // constraint solver passes per frame (higher = stiffer)
  rootStiffness: 3, // how many top particles stay near-rigid at the root
  cohesion: 0.14, // soft lateral spring between neighbour strands (0..1)
  cohesionMaxDist: 70, // don't link strands farther apart than this (css px)
  // How unevenly that spring is handed out, 0..1. At 0 every neighbouring pair is
  // bonded equally. Above 0 each PAIR draws its own strength once, for its whole
  // length, so some neighbours are held together and others are left slack.
  cohesionClump: 0,
  // How far a fully bonded pair is drawn TOGETHER, as a fraction of the distance it was
  // built at. This is the half that actually forms locks, and it is worth knowing why:
  // the cohesion spring targets the distance the pair was BUILT at, so on its own it is
  // a stabiliser, not an attractor — it holds whatever spacing the build produced.
  // Measured on the horse, raising `cohesion` from 0.2 to 0.5 and handing it out
  // unevenly moved the mid-strand spacing distribution by under 2% (p05 2.8->2.9,
  // p95 26.5->26.4): a spring that wants the status quo cannot change the status quo.
  // Shortening the rest distance of the bonded pairs is what gathers them into locks
  // and opens gaps between them.
  cohesionPull: 0,
  bendReturn: 0.012, // gentle pull of upper strand back toward its rest angle
  // Shape of that pull across the stiff particles. 1 = linear falloff (what every
  // piece had). Above 1 grips the first particle harder and lets go faster after it,
  // turning "stiff then free" into a gradient.
  bendReturnCurve: 1,
  // How hard every free particle is pulled straight toward its two neighbours'
  // midpoint, each solver iteration — requires systems.bendStiffness. 0 (off)
  // leaves a strand exactly as floppy as pure distance constraints make it.
  bendStiffness: 0,
  drapeX: -0.012, // sideways "fall" bias so strands drape to the near side

  // ----- WIND (procedural) -------------------------------------------------
  // The field is periodic over `windPeriod` seconds: all time harmonics are
  // integer multiples of that base frequency, so it returns to the exact same
  // state every period. A looping clip must set this to the clip length; a still
  // image can use any period, and a longer one reads as less repetitive.
  windPeriod: 5,
  windStrength: 0.16, // amplitude of the breeze
  windScale: 0.0055, // spatial frequency of the wind field
  windVertical: 0.14, // how much the wind also lifts vertically (0..1)

  // ----- SWELL (water) -----------------------------------------------------
  // Only read when systems.swell. Defaults are inert-ish; the fish sets them.
  // See shared/js/swell.js for what each one does and what was measured.
  swell: {
    cycles: 1, // wave cycles per loop. MUST be an integer or the loop seams.
    wavelengths: 0.6, // wavelengths along one strand
    envelope: 1.5, // amplitude exponent along the strand: higher = deader root
    strength: 0.1, // lateral force at the tip
    drift: 0.012, // weak incoherent churn on top
    scale: 0.006, // spatial frequency of that churn
  },

  // ----- LIGHT WASH --------------------------------------------------------
  // The light the characters throw onto what is behind them. Off by default; the
  // horse doesn't want it. Built at `scale` resolution and blitted back up with
  // "lighter", so the upscale doubles as the blur and the cost stays flat.
  lightWash: {
    enabled: false,
    scale: 0.25, // offscreen resolution factor
    every: 2, // sample every Nth character along a strand
    everyFrames: 1, // rebuild the wash every Nth frame; the cache is reused between
    radius: 30, // px of glow per sample, at full resolution
    alpha: 0.075, // per-sample contribution; they accumulate
    color: "#4aff33",
    ground: 0.45, // strength of the extra spill cast below each sample
    groundOffset: 90, // px below the character that spill is centred
    // One multiplier over the whole wash, so it can be dialled without touching the
    // per-sample balance above.
    intensity: 1,
    // Extra blur, in px at wash resolution, applied ONCE per rebuild rather than per
    // blob. The upscale already blurs; this is for when the wash still reads as a
    // cluster of discs instead of a field of light.
    blur: 0,
    // Extra weight near the root of each strand, fading to nothing at the tip. Light
    // pools where the strands are densest, and on a mane that is the crest.
    rootBoost: 0,
  },

  // ----- POINTER -----------------------------------------------------------
  // Brushing the cursor through the curtain. Two components, because a purely
  // radial push feels magnetic rather than physical:
  //   push  outward from the cursor, so strands part around it
  //   drag  along the cursor's own movement, so a sweep carries them with it
  // Both scale toward the tips, which is where a real hanging thing gives.
  // Requires systems.pointerInteraction.
  // Three components, and the important one is `displace`:
  //   push      a FORCE outward. Cheap, but a force is fought by the length
  //             constraints, so raising it stops helping past a point — measured,
  //             the deflection peaks around 0.5 and gets WORSE by 2.0.
  //   drag      a force along the cursor's own motion, so a sweep carries strands
  //             with it instead of just parting them.
  //   displace  moves POSITIONS directly out of the radius, the same technique the
  //             body collision uses. This is what produces a big, stable parting:
  //             the solver relaxes it smoothly instead of fighting it.
  pointer: {
    radius: 30, // px of influence
    push: 0.5, // outward force at the centre
    drag: 0.14, // how much of the cursor's motion is transferred
    displace: 0.45, // 0..1, how far toward the radius edge particles are moved
    falloff: 1.6, // higher = influence drops off more sharply with distance
    decay: 0.82, // per-frame velocity decay, so it settles when the cursor stops
  },

  // ----- COLLISION ---------------------------------------------------------
  collisionPush: 0.9, // how hard particles are pushed out of the body (0..1)
  // Fraction of a strand, from the root, exempt from collision. 0 = collide all.
  // Raise it for a strand that grows OUT of the body rather than past it.
  collisionFromDepth: 0,
  // A constant outward FORCE from the body centre (requires systems.radialPush
  // and a collider that exposes one — see hairSystem.js). Different from
  // collision: collision only reacts once a particle is already inside the
  // body; this pushes every particle outward all the time, which is what
  // keeps a strand from folding back toward the centre in the first place
  // instead of only correcting it after the fact. Scales toward the tip like
  // every other lateral force, so the root stays anchored.
  radialPush: 0,

  // ----- RENDER / ROOT BAND (static-photo pieces only) --------------------
  rootBand: false,
  rootBandUp: 15,
  rootBandDown: 22,
  rootBandBlur: 8,
  rootBandPasses: 3,

  // ----- RESPONSIVE / PERF -------------------------------------------------
  dprCap: 2,
  mobileBreakpoint: 640,
  mobileDensityFactor: 0.7,
  reduceMotionSettleSteps: 120,
  // Physics steps run after a ?controls rebuild, so the new shape is readable instead
  // of a field of straight rulers relaxing. Far below reduceMotionSettleSteps, which
  // runs once at boot: this one runs on every drag of a "rebuild" parameter, and each
  // step costs a full solver pass (0.7ms on the horse, 4.3ms on the willow).
  controlsSettleSteps: 18,
};

// Snapshot of the toggles as the piece authored them, so a tool that switches
// everything off can hand them back untouched. Filled by configure().
export const AUTHORED_SYSTEMS = {};

// Merge plain objects recursively; arrays and primitives are replaced wholesale
// (a piece overriding `lengthProfile` means its array, not a merge of both).
function deepMerge(target, source) {
  for (const [key, value] of Object.entries(source)) {
    const isPlainObject =
      value && typeof value === "object" && !Array.isArray(value) && value.constructor === Object;
    if (isPlainObject && target[key] && typeof target[key] === "object") {
      deepMerge(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

// Call once, from a piece's config.js, before anything reads CONFIG.
export function configure(overrides = {}) {
  deepMerge(CONFIG, overrides);
  Object.assign(AUTHORED_SYSTEMS, CONFIG.systems);
  return CONFIG;
}

// The character sequence strands read from, as one long cyclic string. A function
// rather than a constant because the piece's overrides arrive after this module
// is evaluated.
//
// Two modes:
//   CONFIG.charPool set  — a weighted pool of individual characters, shuffled
//     deterministically into a long sequence. Reads as abstract information: no
//     words form, and no character dominates. Weighting matters because an even
//     mix of A-Z + 0-9 still lands ~28% digits, which starts to look like binary
//     rain; the pool string itself controls the proportions by repetition.
//   CONFIG.words set     — the word list joined, so the text reads as language.
export function hairText() {
  if (!CONFIG.charPool) return CONFIG.words.join(" ") + " ";

  const pool = CONFIG.charPool;
  const n = CONFIG.charSequenceLength;
  // Deterministic so a rebuild doesn't reshuffle every glyph in the picture, and
  // long enough that the cycle isn't visible across thousands of characters.
  let out = "";
  for (let i = 0; i < n; i++) {
    const h = Math.sin((i + 1) * 12.9898) * 43758.5453;
    out += pool[Math.floor((h - Math.floor(h)) * pool.length)];
  }
  return out;
}
