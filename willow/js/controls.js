// ============================================================================
//  CONTROL SPEC — what the ?controls panel exposes for the willow.
//
//  Data only; shared/js/controls.js builds the Theatre.js panel from it and main.js
//  decides what each `apply` word costs here:
//    live     read every frame — visible immediately
//    atlas    baked into the glyph bitmaps — hair.rebakeAtlas()
//    rebuild  read while strands are built — rebuild() from the stores
//
//  DELIBERATELY ABSENT, because they would be controls that do nothing:
//   - lengthRange / lengthProfile / lengthJitter. Every strand in this piece carries
//     an ABSOLUTE lengthPx, authored one at a time in the strand editor ("s"), and
//     HairSystem.build takes that in preference to the profile. Length here is a
//     drag in the editor, not a slider.
//   - systems.glow. The atlas bakes its halo off AUTHORED_SYSTEMS.glow, a snapshot of
//     what the file authored, so the live flag cannot reach it. glowIntensity does.
//   - charPool. A 120-character string is an edit, not a control.
// ============================================================================

export const CONTROL_SPEC = {
  // The willow's driver is wind, and it is a big one (1.4 against the horse's 0.16)
  // because a frond has to travel, not shiver.
  fuerzas: {
    gravity: { path: "gravity", range: [0, 0.4], apply: "live" },
    damping: { path: "damping", range: [0.8, 1], apply: "live" },
    iterations: { path: "iterations", range: [1, 12], step: 1, apply: "live" },
    windStrength: { path: "windStrength", range: [0, 4], apply: "live" },
    windScale: { path: "windScale", range: [0.0005, 0.02], step: 0.0002, apply: "live" },
    windVertical: { path: "windVertical", range: [0, 1], apply: "live" },
    // 17s here, and nothing forces it to match anything: a still photograph has no
    // loop to close, so a long period just reads as less repetitive.
    windPeriod: { path: "windPeriod", range: [2, 40], apply: "live" },
    drapeX: { path: "drapeX", range: [-0.04, 0.04], apply: "live" },
    drapeSpread: { path: "drapeSpread", range: [0, 0.12], apply: "live" },
  },

  raiz: {
    bendReturn: { path: "bendReturn", range: [0, 0.08], apply: "live" },
    bendReturnCurve: { path: "bendReturnCurve", range: [1, 4], apply: "live" },
    rootStiffness: { path: "rootStiffness", range: [1, 10], step: 1, apply: "live" },
    // Fronds are far more independent than a mane: 0.06 against 0.24.
    cohesion: { path: "cohesion", range: [0, 0.4], apply: "live" },
    cohesionMaxDist: { path: "cohesionMaxDist", range: [10, 120], apply: "rebuild" },
    cohesionClump: { path: "cohesionClump", range: [0, 1], apply: "rebuild" },
    cohesionPull: { path: "cohesionPull", range: [0, 0.8], apply: "rebuild" },
  },

  // The shape of one liana. This is where the willow's identity lives: a big resting
  // arc that opens away from the trunk, held open against gravity by drapeSpread.
  mechon: {
    segmentLength: { path: "segmentLength", range: [8, 32], apply: "rebuild" },
    curveBias: { path: "curveBias", range: [0, 0.8], apply: "rebuild" },
    maxArcPx: { path: "maxArcPx", range: [20, 500], apply: "rebuild" },
    waverAmp: { path: "waverAmp", range: [0, 2.5], apply: "rebuild" },
    charJitterX: { path: "charJitterX", range: [0, 1.2], apply: "rebuild" },
    charSpacingJitter: { path: "charSpacingJitter", range: [0, 0.8], apply: "rebuild" },
    wander: { path: "wander", range: [0, 5], apply: "rebuild" },
    drapeLean: { path: "drapeLean", range: [0, 0.5], apply: "rebuild" },
    tipScale: { path: "tipScale", range: [0.2, 1.2], apply: "rebuild" },
    frayFrom: { path: "frayFrom", range: [0.2, 1], apply: "rebuild" },
    frayAmount: { path: "frayAmount", range: [0, 1], apply: "rebuild" },
    minScale: { path: "minScale", range: [0.4, 1.2], apply: "rebuild" },
    maxScale: { path: "maxScale", range: [0.6, 1.8], apply: "rebuild" },
    minAlpha: { path: "minAlpha", range: [0.2, 1], apply: "rebuild" },
    hideRootGlyph: { path: "hideRootGlyph", apply: "rebuild" },
    // Untouched in this piece (0), but it is what the horse's crest flow rides on —
    // worth having to hand if a frond should ever leave the branch sideways.
    angleRelax: { path: "angleRelax", range: [0, 0.6], apply: "rebuild" },
    rvSpan: { path: "rootVolume.span", range: [0, 0.6], apply: "rebuild" },
    rvScale: { path: "rootVolume.scale", range: [0.8, 2], apply: "rebuild" },
    rvSpacing: { path: "rootVolume.spacing", range: [0.4, 1.4], apply: "rebuild" },
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
    // Off in this piece: characters stay level, like the reference, and it is the
    // cheap path in the renderer (one transform for the whole batch).
    glyphRotate: { path: "glyphRotate", apply: "live" },
    tipFade: { path: "tipFade", range: [0, 0.8], apply: "live" },
  },

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

  // The green the canopy throws on the trunk, the branches and the ground. ~4700
  // overlapping halos, so alpha is tiny by necessity — see the note in config.js.
  luz: {
    enabled: { path: "lightWash.enabled", apply: "live" },
    alpha: { path: "lightWash.alpha", range: [0, 0.06], step: 0.001, apply: "live" },
    intensity: { path: "lightWash.intensity", range: [0, 3], apply: "live" },
    radius: { path: "lightWash.radius", range: [4, 90], apply: "live" },
    blur: { path: "lightWash.blur", range: [0, 12], apply: "live" },
    rootBoost: { path: "lightWash.rootBoost", range: [0, 3], apply: "live" },
    ground: { path: "lightWash.ground", range: [0, 1.5], apply: "live" },
    groundOffset: { path: "lightWash.groundOffset", range: [0, 300], apply: "live" },
    color: { path: "lightWash.color", apply: "live" },
    resolution: { path: "lightWash.scale", range: [0.1, 0.6], apply: "live" },
    everyNth: { path: "lightWash.every", range: [1, 10], step: 1, apply: "live" },
    everyFrames: { path: "lightWash.everyFrames", range: [1, 8], step: 1, apply: "live" },
  },

  // Brushing the cursor through the curtain. `displace` is the one that matters:
  // pushing with a force alone is undone by the length constraints within the frame.
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
    wind: { path: "systems.wind", apply: "live" },
    cohesion: { path: "systems.cohesion", apply: "live" },
    bendReturn: { path: "systems.bendReturn", apply: "live" },
    // The 28 generated anchor clusters, off since they buried the hand-placed
    // strands. Turning them on here rebuilds with them included.
    anchors: { path: "anchors.enabled", apply: "rebuild" },
  },
};
