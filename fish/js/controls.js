// ============================================================================
//  CONTROL SPEC — what the ?controls panel exposes for the fish.
//
//  Data only; shared/js/controls.js builds the Theatre.js panel and main.js decides
//  what each `apply` word costs:
//    live     read every frame — visible immediately
//    atlas    baked into the glyph bitmaps — hair.rebakeAtlas()
//    rebuild  read while strands are built — rebuild() from the tracked pose
//
//  THE FORCE HERE IS WATER, NOT AIR. `systems.wind` is off and the swell block is the
//  driver, so that is the group to open first. Gravity is on but nearly neutral
//  (0.004, 6% of the willow's): a fin floats, it does not hang.
//
//  DELIBERATELY ABSENT:
//   - lengthRange / lengthProfile / lengthJitter. Every ray carries an absolute
//     lengthPx from the fin geometry in fins.js, and HairSystem.build prefers it over
//     the profile. Ray length is authored there, not dragged here.
//   - systems.glow — the atlas bakes its halo off the AUTHORED snapshot, so the live
//     flag cannot reach it. glowIntensity can.
// ============================================================================

export const CONTROL_SPEC = {
  // ----- water: the travelling wave along each ray -------------------------
  agua: {
    strength: { path: "swell.strength", range: [0, 1], apply: "live" },
    wavelengths: { path: "swell.wavelengths", range: [0.2, 3], apply: "live" },
    // Higher starves the middle of the ray, which is exactly where a bend has to
    // form — measured: at 1.6 the short fins pivoted about their roots as rigid
    // sticks instead of flexing.
    envelope: { path: "swell.envelope", range: [0.5, 3], apply: "live" },
    drift: { path: "swell.drift", range: [0, 0.1], step: 0.002, apply: "live" },
    driftScale: { path: "swell.scale", range: [0.001, 0.02], step: 0.0002, apply: "live" },
    // MUST stay a whole number or the wave does not close over the loop and the
    // fins jump at the cut. It is a slider so you can hear that happen.
    cycles: { path: "swell.cycles", range: [1, 4], step: 1, apply: "live" },
    finPhase: { path: "swell.finPhase", range: [0, 3.2], apply: "rebuild" },
    arcPhase: { path: "swell.arcPhase", range: [0, 3.2], apply: "rebuild" },
    jitterPhase: { path: "swell.jitterPhase", range: [0, 1.5], apply: "rebuild" },
    // = the trimmed clip (2.5s). Change it and the wave stops closing with the video.
    period: { path: "windPeriod", range: [0.5, 10], apply: "live" },
  },

  fuerzas: {
    gravity: { path: "gravity", range: [0, 0.08], step: 0.001, apply: "live" },
    damping: { path: "damping", range: [0.7, 1], apply: "live" },
    iterations: { path: "iterations", range: [1, 14], step: 1, apply: "live" },
    drapeX: { path: "drapeX", range: [-0.03, 0.03], apply: "live" },
    drapeSpread: { path: "drapeSpread", range: [0, 0.08], apply: "live" },
    // The analytic body ellipse. Without it the swell pushed the pectoral and anal
    // rays clean through the belly and drew glyphs across the flank.
    collision: { path: "systems.collision", apply: "live" },
    collisionPush: { path: "collisionPush", range: [0, 1.5], apply: "live" },
    // Fraction of a ray, from the root, exempt from collision: a fin GROWS out of the
    // body, so its first characters belong on the skin.
    collisionFromDepth: { path: "collisionFromDepth", range: [0, 0.6], apply: "live" },
  },

  raiz: {
    bendReturn: { path: "bendReturn", range: [0, 0.06], apply: "live" },
    bendReturnCurve: { path: "bendReturnCurve", range: [1, 4], apply: "live" },
    rootStiffness: { path: "rootStiffness", range: [1, 10], step: 1, apply: "live" },
    cohesion: { path: "cohesion", range: [0, 0.4], apply: "live" },
    cohesionMaxDist: { path: "cohesionMaxDist", range: [6, 80], apply: "rebuild" },
    cohesionClump: { path: "cohesionClump", range: [0, 1], apply: "rebuild" },
    cohesionPull: { path: "cohesionPull", range: [0, 0.8], apply: "rebuild" },
  },

  mechon: {
    segmentLength: { path: "segmentLength", range: [6, 24], apply: "rebuild" },
    curveBias: { path: "curveBias", range: [0, 0.6], apply: "rebuild" },
    maxArcPx: { path: "maxArcPx", range: [20, 300], apply: "rebuild" },
    waverAmp: { path: "waverAmp", range: [0, 2], apply: "rebuild" },
    charJitterX: { path: "charJitterX", range: [0, 1], apply: "rebuild" },
    charSpacingJitter: { path: "charSpacingJitter", range: [0, 0.6], apply: "rebuild" },
    wander: { path: "wander", range: [0, 2], apply: "rebuild" },
    drapeLean: { path: "drapeLean", range: [0, 0.4], apply: "rebuild" },
    tipScale: { path: "tipScale", range: [0.2, 1.2], apply: "rebuild" },
    frayFrom: { path: "frayFrom", range: [0.4, 1], apply: "rebuild" },
    frayAmount: { path: "frayAmount", range: [0, 1], apply: "rebuild" },
    minScale: { path: "minScale", range: [0.4, 1.2], apply: "rebuild" },
    maxScale: { path: "maxScale", range: [0.6, 1.8], apply: "rebuild" },
    minAlpha: { path: "minAlpha", range: [0.2, 1], apply: "rebuild" },
    hideRootGlyph: { path: "hideRootGlyph", apply: "rebuild" },
    // A fin leaves the body along its own ray and STAYS in that plane, which is why
    // this is 0 here and 0.2 on the horse. Raising it makes the rays fall.
    angleRelax: { path: "angleRelax", range: [0, 0.6], apply: "rebuild" },
  },

  neon: {
    color: { path: "color", apply: "atlas" },
    glowIntensity: { path: "glowIntensity", range: [0, 16], apply: "atlas" },
    bloomPasses: { path: "glyphBloom.passes", range: [0, 5], step: 1, apply: "atlas" },
    bloomBlur: { path: "glyphBloom.blur", range: [0, 24], apply: "atlas" },
    bloomAlpha: { path: "glyphBloom.alpha", range: [0, 1], apply: "atlas" },
    coreAlpha: { path: "glyphCore.alpha", range: [0, 1], apply: "atlas" },
    outlineWidth: { path: "glyphOutline.width", range: [0, 4], apply: "atlas" },
    outlineColor: { path: "glyphOutline.color", apply: "atlas" },
    fontSize: { path: "fontSize", range: [8, 34], apply: "atlas" },
    fontWeight: { path: "fontWeight", range: [100, 700], step: 50, apply: "atlas" },
    glyphRotate: { path: "glyphRotate", apply: "live" },
    tipFade: { path: "tipFade", range: [0, 0.8], apply: "live" },
  },

  // REGLA 1, fish variant: inside a fin the luminance varies 2.14x more from ray to
  // ray than along one, so a fin reads as ribs — not as a ramp from the root. These
  // are the numbers that hold that up.
  profundidad: {
    buckets: { path: "depth.buckets", range: [1, 24], step: 1, apply: "atlas" },
    highlight: { path: "depth.highlight", range: [0, 1], apply: "atlas" },
    highlightGlow: { path: "depth.highlightGlow", range: [0.2, 4], apply: "atlas" },
    highlightColor: { path: "depth.highlightColor", apply: "atlas" },
    hazeMax: { path: "depth.haze.1", range: [0, 1], apply: "atlas" },
    hazeColor: { path: "depth.hazeColor", apply: "atlas" },
    scaleFar: { path: "depth.scale.1", range: [0.2, 1], apply: "atlas" },
    alphaFar: { path: "depth.alpha.1", range: [0.1, 1], apply: "atlas" },
    glowFar: { path: "depth.glow.1", range: [0, 1], apply: "atlas" },
    rampCurve: { path: "depth.rampCurve", range: [0.5, 4], apply: "atlas" },
    rampSpan: { path: "depth.rampSpan", range: [0.2, 1], apply: "atlas" },
  },

  // The fins light the water. At the first build's dose (alpha 0.05, every 2) ~2000
  // particles accumulated into opaque fog and the characters vanished inside it.
  luz: {
    enabled: { path: "lightWash.enabled", apply: "live" },
    alpha: { path: "lightWash.alpha", range: [0, 0.06], step: 0.001, apply: "live" },
    intensity: { path: "lightWash.intensity", range: [0, 3], apply: "live" },
    radius: { path: "lightWash.radius", range: [4, 90], apply: "live" },
    blur: { path: "lightWash.blur", range: [0, 12], apply: "live" },
    rootBoost: { path: "lightWash.rootBoost", range: [0, 3], apply: "live" },
    // 0 here: light spills evenly in water, there is no "below".
    ground: { path: "lightWash.ground", range: [0, 1], apply: "live" },
    groundOffset: { path: "lightWash.groundOffset", range: [0, 200], apply: "live" },
    color: { path: "lightWash.color", apply: "live" },
    resolution: { path: "lightWash.scale", range: [0.1, 0.6], apply: "live" },
    everyNth: { path: "lightWash.every", range: [1, 10], step: 1, apply: "live" },
    everyFrames: { path: "lightWash.everyFrames", range: [1, 8], step: 1, apply: "live" },
  },

  puntero: {
    enabled: { path: "systems.pointerInteraction", apply: "live" },
    radius: { path: "pointer.radius", range: [10, 400], apply: "live" },
    push: { path: "pointer.push", range: [0, 2], apply: "live" },
    drag: { path: "pointer.drag", range: [0, 0.6], apply: "live" },
    displace: { path: "pointer.displace", range: [0, 1], apply: "live" },
    falloff: { path: "pointer.falloff", range: [0.5, 5], apply: "live" },
    decay: { path: "pointer.decay", range: [0.5, 0.99], apply: "live" },
  },

  sistemas: {
    renderHair: { path: "systems.renderHair", apply: "live" },
    gravity: { path: "systems.gravity", apply: "live" },
    swell: { path: "systems.swell", apply: "live" },
    wind: { path: "systems.wind", apply: "live" },
    cohesion: { path: "systems.cohesion", apply: "live" },
    bendReturn: { path: "systems.bendReturn", apply: "live" },
  },
};
