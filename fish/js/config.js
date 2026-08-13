// ============================================================================
//  FISH CONFIG — code fins on a swimming fish, driven by water instead of wind.
//
//  Same strand system as horse/ and willow/. Three things are genuinely
//  different, and they are the whole piece:
//
//   1. NO GRAVITY WORTH THE NAME. A fin is near-neutrally buoyant, so it has no
//      hanging rest shape. `gravity` here is 6% of the willow's, just enough to
//      keep a settled fin from looking weightless in a still frame.
//   2. THE DRIVER IS A TRAVELLING WAVE, not a breeze. systems.wind is OFF and
//      systems.swell is ON. See shared/js/swell.js.
//   3. STRANDS DO NOT HANG DOWN. Each root has its own growth direction around
//      the body contour, via the `angle` that Strand grew support for.
//
//  MEASURED (fish video.mp4 and the reference clip, both 121 frames @ 24fps):
//    beat period          2.52 s (0.40 Hz), FFT on tail-tip position, and the
//                         SAME in both clips — the veil doesn't change the rhythm
//    tip travel           6.1 px bare -> 60.9 px veiled: the fin amplifies ×10
//    silhouette height    108 px -> 233 px: the fins slightly more than double it
//    body drift           7.3% of frame width and 3.9° over the trimmed loop
//    loop closure         29.8 px / 1.68° at the cut (was 109 px / 4.19° untrimmed)
//
//  NOT MEASURED, and it matters: the wave's phase lag per unit length along a
//  fin. Two attempts failed — cross-correlation came out flat (r≈0.50 across
//  lags 0-7, swamped by the shared drift), and an arc-length centreline only
//  resolved 3 radii because the caudal veil sweeps forward alongside the body,
//  so any "behind the root" gate throws it away while removing the gate lets the
//  pectorals contaminate the rings. `swell.wavelengths` below is therefore a
//  CHOICE, not a measurement. It is flagged as such at the parameter.
// ============================================================================

import { configure } from "../../shared/js/config.js";

export const CONFIG = configure({
  systems: {
    renderHair: true,
    gravity: true, // on, but see the value: nearly neutral
    wind: false, // air. Not this piece.
    swell: true, // water. The driver.
    // Had to be turned on: once the swell was strong enough to bend a fin, the
    // pectoral and anal rays were pushed clean through the belly and drew glyphs
    // across the fish's flank. An analytic ellipse from the tracking, not a mask
    // — see bodyCollider.js.
    collision: true,
    cohesion: true, // holds each fin together as one membrane
    bendReturn: true, // keeps the rays anchored in their fan direction
    glow: true,
  },

  video: {
    src: "fish-loop.mp4",
    width: 1920,
    height: 1080,
    fps: 24,
    // 60 frames. Chosen by searching every (start, length) pair for the smallest
    // pose jump at the cut: 30 px and 1.82°, against 109 px and 4.19° for the
    // untrimmed clip. It is also 0.99 of one 2.52 s beat, which is why
    // windPeriod below can be 2.5 and have the wave close with the video.
    duration: 2.5,
  },
  tracking: "fish-tracking.json",

  // ----- TEXT --------------------------------------------------------------
  // A pool, not words: a fin should read as data moving through water, and any
  // recognisable word stops the eye and turns the fin into a sign. Weighted by
  // repetition — an even A-Z+0-9 mix lands ~28% digits and starts to look like
  // binary rain.
  charPool: "01{}[]()<>/\\|=+-*&^%$#@!?:;.,~_" + "abcdefghijklmnopqrstuvwxyz" + "0123456789",

  // ----- GLYPHS ------------------------------------------------------------
  // The hue comes from the fish, measured over 262901 body pixels: it runs 8.2°
  // (whole body) to 18.7° at its brightest 0.5%, and DESATURATES as it brightens,
  // 85% down to 67%, the way a lit saturated object does. The three layers below
  // follow that same run — deep red halo, orange tube, near-white core.
  //
  // ----- NEON: THREE LAYERS, NOT A COLOUR WITH A GLOW ----------------------
  // The old look was "orange text + shadowBlur", which reads as illuminated text.
  // A neon tube is a structure: a hot near-white core inside a saturated body
  // inside a deep coloured halo. The atlas bakes all three per glyph ONCE, so a
  // frame is still just drawImage calls and the halo costs nothing per frame.
  //
  //   core  #fff0d0  the filament itself, drawn last, no blur
  //   body  #ff7a18  the saturated tube
  //   glow  #ff4a00  the light it throws — deeper and REDDER than the tube, which
  //                  is what makes it read as light rather than as a blurred copy:
  //                  a real halo loses the short wavelengths first.
  color: "#ff7a18",
  glyphBloom: { passes: 3, blur: 9, alpha: 0.3, color: "#ff4a00" },
  glyphCore: { alpha: 0.55, color: "#fff0d0" },
  fontWeight: 300,
  glyphRotate: true, // rays follow their own curve
  // Low now, because `glyphBloom` above is doing the halo properly. This is the
  // old single-shadow glow and stacking a big one on top of the bloom just muddies
  // the falloff.
  glowIntensity: 2,
  glyphOutline: {
    // Nearly gone. The old 2.1px dark stroke is what made these read as GRAPHIC
    // characters with a border rather than emissive ones; the reference gets its
    // separation from luminance and a dark background, not from an outline. A
    // hairline is kept only so a core-white glyph doesn't dissolve into its own
    // bloom where rays overlap at the fin base.
    width: 0.9,
    color: "rgba(28, 4, 0, 0.55)",
  },

  depth: {
    enabled: true,
    // 13, willow's number, and for its reason. Every strand here ramps from
    // z -0.9 to +0.35, so at 7 buckets the -1..1 range stepped by 0.33 and a
    // strand crossed only 3 or 4 steps: the white-to-orange run down its length
    // read as a couple of hard jumps instead of a fade. 13 steps by 0.15.
    buckets: 13,
    scale: [1.0, 0.55],
    alpha: [1.0, 0.34],
    glow: [1.0, 0.12], // near strands self-lit, deep ones almost matte
    haze: [0.0, 0.72],
    hazeColor: "#04161c", // the clip's dark teal
    // THE WHITE. Same move as willow, whose green strands run to a near-white
    // #eafff0 at their roots — the white is not a second colour, it is where each
    // strand's own ramp STARTS. Tinted toward the orange the way willow's is
    // tinted toward its green, so it reads as the hot core of the tube and not as
    // a grey cap dropped on top.
    highlightColor: "#fff3e8",
    highlight: 0.78, // pushed past willow's 0.6: the roots go properly white
    highlightGlow: 2.2,
    // REGLA 1 is about WHERE the brightness comes from (the strand's own start);
    // these two are about the SHAPE of that ramp, which is the only legitimate
    // place to fix a glow that reads wrong.
    // rampCurve > 1 holds the root's value further along, so a highlight covers
    // several characters instead of landing on the pinned root that cannot move.
    rampCurve: 1.5,
    // Finished before frayFrom (0.72) so the bright part never lands on the
    // scattered singles at the frayed tip.
    rampSpan: 0.55,
  },
  hideRootGlyph: true, // the root is pinned; a glyph there reads as stuck

  minAlpha: 0.86, // neon is not a faint thing; the old 0.72 floor greyed it out
  maxAlpha: 1.0,
  minScale: 0.8,
  maxScale: 1.1,
  // 0, as in willow. Depth already dims what recedes; fading the tip on TOP of
  // that greys out precisely the long trailing part the reference is all about.
  // The veil thins and frays, it does not fade.
  tipFade: 0,

  // ----- STRAND SHAPE ------------------------------------------------------
  // strandCount is unused here: fins.js authors an exact root per ray, and
  // HairSystem builds one strand per root.
  // THIS is what made the fins read as confetti rather than as fin rays. At 15px
  // with a 17px glyph the characters were spaced further apart than they are wide,
  // so a strand read as a row of separate dots. A fin ray in the reference is a
  // CONTINUOUS line. Below the glyph size the characters touch and the strand
  // becomes a ribbon of text, which is what a curtain of code should be.
  // A FIN RAY IS A CONTINUOUS LINE, and the size of the type is what decides
  // whether it can be one. At 17px with 11px spacing a ray was ~30 big glyphs and
  // read as a chain of blobs; at 11px with 8px spacing it is ~80 small ones and
  // reads as a drawn filament. The reference works the same way: small characters,
  // long elegant lines. Not microscopic — 11px is still legible as type.
  fontSize: 11,
  segmentLength: 8,
  minParticles: 10,
  maxParticles: 170, // the caudal runs ~1.45x the half-length at 8px a character
  lengthProfile: [1], // ignored; every root carries an absolute lengthPx
  lengthJitter: 0,
  drapeLean: 0.02,

  // THE LOOP KILLERS. `curveBias` x `drape` is the sideways arc of the resting
  // pose, and at 0.14 x 0.55 on a long lower fin the arc came back on itself and
  // drew a circle under the fish. Halved here and the per-fin `drape` cut to ~0.12
  // in fins.js, with a much tighter absolute cap: enough for a directional bend,
  // never enough for a U.
  curveBias: 0.07,
  maxArcPx: 62,
  drapeSpread: 0.008,
  // Strong taper. The reference filaments come off the body with weight and end in
  // fine points; 0.82 barely thinned them at all.
  tipScale: 0.5,
  wander: 0.1,

  // ONE LONG BEND, not a ripple. `waverFreq` used to be hard-coded at 1.4-3.6
  // cycles per strand, which on an 80-character ray is visible procedural noise.
  // Under half a cycle reads as something suspended in water.
  waverAmp: 0.35,
  waverFreq: [0.25, 0.55],
  // Both cut hard. These two are what threw characters off their own ray and made
  // the fins read as a cloud: at 0.3 and 0.22 a glyph could sit a third of a
  // segment off the line and the spacing swung ±22%, so the eye lost the filament.
  charJitterX: 0.07,
  charSpacingJitter: 0.09,

  // ----- ROOT VOLUME -------------------------------------------------------
  // Was off. This is what fuses the fin into the fish: over the first 18% of every
  // ray the characters are packed to just over half their spacing and set 1.35x
  // larger, so the attachment reads as one continuous dense surface flowing out of
  // the body instead of N separate columns with black water showing between them.
  // It is also what hides any small discontinuity against the footage.
  rootVolume: { span: 0.18, spacing: 0.5, scale: 1.35, curve: 1.5 },
  // A hanging vine can fray hard, because its neighbours hang parallel and the
  // scattered tips still read as one mass. A FAN cannot: its rays diverge, so the
  // same 0.72/0.85 turned the last third of the caudal into a cone of confetti
  // with no ribbon left to read. Later and gentler still now that the rays are
  // long: in the reference the veil thins to fine points but never dissolves.
  // Only the last 12%, and gently. Fray is what produces loose characters, and
  // loose characters are the single thing that most makes this read as a cloud of
  // glyphs rather than a fin. A hint of it keeps the tips from ending on a ruled
  // line; more than that and the fin dissolves.
  frayFrom: 0.88,
  frayAmount: 0.18,

  // ----- PHYSICS -----------------------------------------------------------
  gravity: 0.004, // 6% of the willow's 0.062. Neutral buoyancy, near enough.
  // INERTIA, not drag. Water is viscous but it is also HEAVY: a fin does not stop
  // when the fish stops, it keeps going and settles. 0.86 was bleeding velocity
  // fast enough that the tips arrived almost with the root and the secondary
  // motion — the whole reason a veil tail is worth animating — never developed.
  damping: 0.89, // 0.92 kept the lag but let the fins swing further than the reference
  iterations: 7,
  rootStiffness: 3,
  // Measured: at 0.17 with a 46px reach the rays of a fan welded into one solid
  // sheet — the fin moved as a paddle and the gaps between rays closed, which is
  // what turned the caudal into a butterfly wing. A fin membrane is held by its
  // rays, not by its neighbours, so this is deliberately weak and short-reaching.
  // Neighbouring rays should move as a GROUP, not as 94 independent strands. Raised
  // just enough to couple a ray to the two either side of it — beyond ~34px it
  // starts welding the fan into the solid paddle that was measured before.
  cohesion: 0.085,
  cohesionMaxDist: 32,
  // Lowered from 0.02: this is the spring that pulls the top of a strand back to
  // its built angle, and it was most of why the fins looked stiff and "poco
  // libres". Enough to keep a ray rooted in its fan direction, not enough to stop
  // it drifting where the water takes it.
  bendReturn: 0.011,
  drapeX: 0, // no sideways "fall": there is no down here to fall toward
  // The first 18% of a strand is the ATTACHMENT and is allowed to lie on the
  // fish. Without this the collider shoved the caudal's base off the peduncle and
  // reopened the very gap the new root positions were meant to close.
  collisionFromDepth: 0.18,

  // ----- SWELL -------------------------------------------------------------
  windPeriod: 2.5, // = the trimmed clip. One beat, so the wave closes with it.
  swell: {
    cycles: 1, // one beat per loop, matching the measured 2.52 s
    // NOT MEASURED — see the header. 0.75 puts about three quarters of a
    // wavelength along a strand, which gives one clear S-bend developing toward
    // the tip. Below ~0.4 the fin flexes as one rigid sheet; above ~1.5 it
    // corrugates and reads as a flag. Starting point, to be tuned against the
    // reference by eye and by re-running the tip-travel measurement.
    wavelengths: 1.1,
    // Measured, and this one was backwards. At 1.6 the mid-strand got only 0.33 of
    // the tip's force — but mid-strand is exactly where a bend has to form, so the
    // short fins could not hold a wave at all and pivoted about their roots as
    // rigid sticks (phase along the pectoral was flat: -38°, -32.8°, -32.1°,
    // -39.6°). A steep envelope starves the wave instead of shaping it.
    envelope: 1.15,
    // Raised with it: the force has to beat the length constraints to bend the
    // chain, and below ~0.2 the solver wins and every fin moves as one piece.
    strength: 0.22, // paired with the raised damping: same travel, less excursion
    drift: 0.02, // weak churn so the mass shimmers
    scale: 0.005,
    // Phase offsets, applied in fins.js. The four fins share the beat but not the
    // instant, and rays within one fin fan out in time as well as in space —
    // that temporal fan is most of what separates a fin from a sheet of paper.
    finPhase: 0.55, // radians between one fin group and the next
    arcPhase: 0.9, // across a single fin's arc, root to root
    jitterPhase: 0.35, // per-strand scatter
  },

  // ----- LIGHT WASH --------------------------------------------------------
  // The fins light the water around them. Strongest justification in this piece:
  // without it the glyphs sit on top of the footage; with it they are in it.
  // Measured, and the biggest single mistake in the first build: at alpha 0.05 /
  // radius 26 / every 2 the wash from ~2000 particles accumulated into opaque fog
  // and the characters vanished inside it. The wash exists to put the glyphs IN
  // the water, not to replace them — so it is now a quarter of that dose.
  lightWash: {
    enabled: true,
    scale: 0.25,
    every: 6, // willow's sampling: fewer, wider blobs read as light, not as fog
    everyFrames: 4,
    radius: 34,
    alpha: 0.02,
    color: "#ff4a00", // the halo colour, so the spill on the scales matches the glow
    ground: 0, // no "below": light spills evenly in water, not downward
    groundOffset: 0,
  },

  pointer: {
    radius: 120,
    push: 0.4,
    drag: 0.12,
    displace: 0.4,
    falloff: 1.5,
    decay: 0.85,
  },

  keys: {
    diagnostics: "d",
    controls: "t", // show/hide the ?controls panel. Free in all three pieces.
  },

  dprCap: 2,
  mobileDensityFactor: 1, // fins are authored ray by ray; resampling wrecks a fan
});
