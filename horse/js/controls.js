// ============================================================================
//  CONTROL SPEC — what the ?controls panel exposes for the horse.
//
//  Data only: the paths into CONFIG, a sane range for each, and WHEN a change takes
//  effect. shared/js/controls.js turns this into the Theatre.js panel and main.js
//  decides what "rebuild" and "atlas" mean for this piece.
//
//    apply: "live"     read every frame — the change is visible immediately
//    apply: "atlas"    baked into the glyph bitmaps — needs hair.rebakeAtlas()
//    apply: "rebuild"  read while strands are being built — needs the roots and the
//                      strands made again from scratch
//
//  Labels are the config's own names on purpose: what the panel calls a control is
//  what you grep for, and what the "copiar cambios" dump prints.
//
//  RANGES ARE FOR DRAGGING, NOT LIMITS. They are wide enough to break the piece in
//  both directions, because finding the edge of a parameter is most of how you learn
//  what it does. Nothing here clamps what config.js may hold.
//
//  Two things deliberately absent:
//   - systems.glow. The atlas bakes its halo from AUTHORED_SYSTEMS.glow, the snapshot
//     of what the piece authored, so toggling the live flag would change nothing and
//     read as a broken control. glowIntensity and the bloom block below give the same
//     reach — set them to 0 and there is no glow.
//   - Text and the per-pen-point profiles (lengthProfile, crestOffsetPx, …). A word
//     list and a 14-stop array are not sliders; they are edits to config.js.
// ============================================================================

export const CONTROL_SPEC = {
  // ----- what pulls on a strand, every frame -------------------------------
  fuerzas: {
    gravity: { path: "gravity", range: [0, 0.2], apply: "live" },
    damping: { path: "damping", range: [0.75, 1], apply: "live" },
    iterations: { path: "iterations", range: [1, 12], step: 1, apply: "live" },
    drapeX: { path: "drapeX", range: [-0.06, 0.06], apply: "live" },
    drapeSpread: { path: "drapeSpread", range: [0, 0.08], apply: "live" },
    windStrength: { path: "windStrength", range: [0, 0.6], apply: "live" },
    windScale: { path: "windScale", range: [0.001, 0.02], step: 0.0002, apply: "live" },
    windVertical: { path: "windVertical", range: [0, 0.5], apply: "live" },
    // The wind field is periodic over this many seconds and the clip is 5.041667s.
    // Anything else makes the mane jump at the loop — it is here to hear that happen,
    // not to be left changed.
    windPeriod: { path: "windPeriod", range: [1, 20], apply: "live" },
  },

  // ----- how hard the root holds, which is what keeps the launch direction --
  raiz: {
    bendReturn: { path: "bendReturn", range: [0, 0.08], apply: "live" },
    bendReturnCurve: { path: "bendReturnCurve", range: [1, 4], apply: "live" },
    rootStiffness: { path: "rootStiffness", range: [1, 10], step: 1, apply: "live" },
    cohesion: { path: "cohesion", range: [0, 0.6], apply: "live" },
    cohesionMaxDist: { path: "cohesionMaxDist", range: [10, 160], apply: "rebuild" },
    // Both measured as no-ops on this piece — see the note in config.js. Left here
    // because the fastest way to see why is to drag them.
    cohesionClump: { path: "cohesionClump", range: [0, 1], apply: "rebuild" },
    cohesionPull: { path: "cohesionPull", range: [0, 0.8], apply: "rebuild" },
  },

  // ----- where the hair is born --------------------------------------------
  cresta: {
    strandCount: { path: "strandCount", range: [20, 220], step: 1, apply: "rebuild" },
    // LIVE, not rebuild: the offset is applied in buildCrestTable on every frame, so this
    // one answers the drag immediately. It was mislabelled as rebuild.
    crestOffsetScale: { path: "maneShape.crestOffsetScale", range: [0, 2.5], apply: "live" },
    rootBandSpread: { path: "maneShape.rootBandSpread", range: [0, 1], apply: "rebuild" },
    rootUstart: { path: "maneShape.rootURange.0", range: [0, 0.35], apply: "rebuild" },
    rootUend: { path: "maneShape.rootURange.1", range: [0.5, 1], apply: "rebuild" },
    crestSmoothPasses: { path: "maneShape.crestSmoothPasses", range: [0, 64], step: 1, apply: "rebuild" },
    lengthJitter: { path: "lengthJitter", range: [0, 0.4], apply: "rebuild" },
    lengthMin: { path: "lengthRange.0", range: [30, 220], apply: "rebuild" },
    lengthMax: { path: "lengthRange.1", range: [150, 700], apply: "rebuild" },
  },

  // ----- the direction it leaves in, and the swirl at the poll --------------
  flujo: {
    rootFlowStrength: { path: "maneShape.rootFlowStrength", range: [0, 1], apply: "rebuild" },
    flowJitterDeg: { path: "maneShape.flowJitterDeg", range: [0, 30], apply: "rebuild" },
    flowMaxDeg: { path: "maneShape.flowMaxDeg", range: [20, 150], apply: "rebuild" },
    angleRelax: { path: "angleRelax", range: [0, 0.6], apply: "rebuild" },
    angleRelaxCurve: { path: "angleRelaxCurve", range: [0.5, 4], apply: "rebuild" },
    whorlCenterU: { path: "maneShape.whorl.centerU", range: [0, 0.6], apply: "rebuild" },
    whorlCenterK: { path: "maneShape.whorl.centerK", range: [0, 3], apply: "rebuild" },
    whorlRadiusU: { path: "maneShape.whorl.radiusU", range: [0.01, 0.6], apply: "rebuild" },
    whorlStrength: { path: "maneShape.whorl.strength", range: [0, 1], apply: "rebuild" },
    whorlCurve: { path: "maneShape.whorl.curve", range: [0.3, 4], apply: "rebuild" },
    // +1 and -1 are the two physical directions; in between is a weaker swirl.
    whorlSpin: { path: "maneShape.whorl.spin", range: [-1, 1], apply: "rebuild" },
  },

  // ----- keeping the forelock's density in SCREEN space ---------------------
  // `refArcPx` is the projected band width at which nothing is thinned, so LOWERING it thins
  // less and raising it thins more. Drag it while parked around frame 67, where the band is
  // at its narrowest (46px measured).
  adelgazar: {
    enabled: { path: "maneShape.forelockThin.enabled", apply: "live" },
    refArcPx: { path: "maneShape.forelockThin.refArcPx", range: [40, 200], apply: "live" },
    curve: { path: "maneShape.forelockThin.curve", range: [1, 4], apply: "live" },
    feather: { path: "maneShape.forelockThin.feather", range: [0.02, 0.6], apply: "live" },
  },

  // ----- the holdout circle: where the letters are behind something --------
  // Phase 2 (2026-08-19) is the keyframed track authored in horse/js/holdoutEditor.js
  // ("H", or ?holdoutEditor) — when horse-holdout.json loads, THAT drives the zone's
  // position and size, and x/y/radio below do nothing (they only reach the fallback
  // CONFIG.holdout.zones, used when no track has been exported). `enabled` and `borde`
  // still apply either way: `enabled` is the one global on/off switch, and `borde` is
  // the feather RATIO (fraction of each zone's own r, not of the video width — see
  // featherRatio's comment in config.js) shared by every zone.
  tapar: {
    enabled: { path: "holdout.enabled", apply: "live" },
    x: { path: "holdout.zones.0.nx", range: [0, 1], apply: "live" },
    y: { path: "holdout.zones.0.ny", range: [0, 1], apply: "live" },
    radio: { path: "holdout.zones.0.r", range: [0, 0.3], apply: "live" },
    borde: { path: "holdout.featherRatio", range: [0, 0.9], apply: "live" },
  },

  // ----- the forelock, and the parting it implies ---------------------------
  // `untilU` is where the parting sits: everything in front of it falls toward the face.
  // Keep it above maneShape.rootURange.0 (0.055) or the zone collapses and the control
  // silently does nothing. `drapeMin/Max` are what hold the tuft forward against gravity
  // — they are multipliers and they belong above 1 here; see the measured sweep in
  // config.js before assuming a smaller number will do.
  cerquillo: {
    untilU: { path: "maneShape.forelock.untilU", range: [0.06, 0.4], apply: "rebuild" },
    density: { path: "maneShape.forelock.density", range: [1, 5], apply: "rebuild" },
    flow: { path: "maneShape.forelock.flow", range: [0, 1], apply: "rebuild" },
    pull: { path: "maneShape.forelock.pull", range: [0, 0.3], apply: "live" },
    // Where the crest aim gives way to straight down, in units of the aim's own vertical
    // component. Both live, and worth dragging together while scrubbing through frames
    // 55-105: that is the whole turn to camera, and these two decide what happens in it.
    aimDownFrom: { path: "maneShape.forelock.aimDown.0", range: [-0.4, 0.6], apply: "live" },
    aimDownTo: { path: "maneShape.forelock.aimDown.1", range: [-0.2, 1], apply: "live" },
    // Inert at 1 on purpose — see the measured sweep in config.js. At 0 it halves what is
    // left of the sideways march, at the cost of the tuft's lateral bias at those poses.
    aimDownDrapeFloor: { path: "maneShape.forelock.aimDownDrapeFloor", range: [0, 1], apply: "live" },
    drapeMin: { path: "maneShape.forelock.drape.0", range: [0, 8], apply: "rebuild" },
    drapeMax: { path: "maneShape.forelock.drape.1", range: [0, 8], apply: "rebuild" },
    lean: { path: "maneShape.forelock.lean", range: [-2, 2], apply: "rebuild" },
    enabled: { path: "maneShape.forelock.enabled", apply: "rebuild" },
  },

  // ----- the shape of one hair ---------------------------------------------
  mechon: {
    segmentLength: { path: "segmentLength", range: [8, 32], apply: "rebuild" },
    curveBias: { path: "curveBias", range: [0, 0.5], apply: "rebuild" },
    maxArcPx: { path: "maxArcPx", range: [10, 300], apply: "rebuild" },
    waverAmp: { path: "waverAmp", range: [0, 2], apply: "rebuild" },
    charJitterX: { path: "charJitterX", range: [0, 1], apply: "rebuild" },
    charSpacingJitter: { path: "charSpacingJitter", range: [0, 0.6], apply: "rebuild" },
    wander: { path: "wander", range: [0, 2], apply: "rebuild" },
    drapeLean: { path: "drapeLean", range: [0, 0.8], apply: "rebuild" },
    tipScale: { path: "tipScale", range: [0.2, 1.3], apply: "rebuild" },
    frayFrom: { path: "frayFrom", range: [0.2, 1], apply: "rebuild" },
    frayAmount: { path: "frayAmount", range: [0, 1], apply: "rebuild" },
    minScale: { path: "minScale", range: [0.4, 1.2], apply: "rebuild" },
    maxScale: { path: "maxScale", range: [0.6, 1.8], apply: "rebuild" },
    minAlpha: { path: "minAlpha", range: [0.2, 1], apply: "rebuild" },
    hideRootGlyph: { path: "hideRootGlyph", apply: "rebuild" },
  },

  // ----- the dense first stretch that covers the real crest ----------------
  volumen: {
    rvSpan: { path: "rootVolume.span", range: [0, 0.6], apply: "rebuild" },
    rvScale: { path: "rootVolume.scale", range: [0.8, 2], apply: "rebuild" },
    rvSpacing: { path: "rootVolume.spacing", range: [0.4, 1.4], apply: "rebuild" },
    rvCurve: { path: "rootVolume.curve", range: [0.5, 3], apply: "rebuild" },
  },

  // ----- emission ----------------------------------------------------------
  neon: {
    color: { path: "color", apply: "atlas" },
    glowIntensity: { path: "glowIntensity", range: [0, 12], apply: "atlas" },
    bloomPasses: { path: "glyphBloom.passes", range: [0, 5], step: 1, apply: "atlas" },
    bloomBlur: { path: "glyphBloom.blur", range: [0, 24], apply: "atlas" },
    bloomAlpha: { path: "glyphBloom.alpha", range: [0, 1], apply: "atlas" },
    bloomColor: { path: "glyphBloom.color", apply: "atlas" },
    coreAlpha: { path: "glyphCore.alpha", range: [0, 1], apply: "atlas" },
    coreColor: { path: "glyphCore.color", apply: "atlas" },
    outlineWidth: { path: "glyphOutline.width", range: [0, 4], apply: "atlas" },
    outlineColor: { path: "glyphOutline.color", apply: "atlas" },
    fontSize: { path: "fontSize", range: [8, 40], apply: "atlas" },
    fontWeight: { path: "fontWeight", range: [100, 700], step: 50, apply: "atlas" },
    tipFade: { path: "tipFade", range: [0, 0.8], apply: "live" },
  },

  // ----- front to back -----------------------------------------------------
  profundidad: {
    buckets: { path: "depth.buckets", range: [1, 24], step: 1, apply: "atlas" },
    highlight: { path: "depth.highlight", range: [0, 1], apply: "atlas" },
    highlightGlow: { path: "depth.highlightGlow", range: [0.2, 4], apply: "atlas" },
    highlightColor: { path: "depth.highlightColor", apply: "atlas" },
    hazeMax: { path: "depth.haze.1", range: [0, 1], apply: "atlas" },
    hazeColor: { path: "depth.hazeColor", apply: "atlas" },
    scaleFar: { path: "depth.scale.1", range: [0.3, 1], apply: "atlas" },
    alphaFar: { path: "depth.alpha.1", range: [0.2, 1], apply: "atlas" },
    glowFar: { path: "depth.glow.1", range: [0, 1], apply: "atlas" },
    rampCurve: { path: "depth.rampCurve", range: [0.5, 4], apply: "atlas" },
    rampSpan: { path: "depth.rampSpan", range: [0.2, 1], apply: "atlas" },
    // Per-strand ends of the ramp. Drawn per strand at build time, so these move
    // which strand is hot — not how hot the ramp is.
    zRootFrom: { path: "maneDepth.zRoot.0", range: [-1, 0], apply: "rebuild" },
    zRootTo: { path: "maneDepth.zRoot.1", range: [-1, 0.5], apply: "rebuild" },
    zTipFrom: { path: "maneDepth.zTip.0", range: [-0.5, 1], apply: "rebuild" },
    zTipTo: { path: "maneDepth.zTip.1", range: [-0.5, 1], apply: "rebuild" },
  },

  // ----- the light the mane throws on the horse -----------------------------
  luz: {
    enabled: { path: "lightWash.enabled", apply: "live" },
    alpha: { path: "lightWash.alpha", range: [0, 0.2], step: 0.002, apply: "live" },
    intensity: { path: "lightWash.intensity", range: [0, 3], apply: "live" },
    radius: { path: "lightWash.radius", range: [4, 90], apply: "live" },
    blur: { path: "lightWash.blur", range: [0, 12], apply: "live" },
    rootBoost: { path: "lightWash.rootBoost", range: [0, 3], apply: "live" },
    ground: { path: "lightWash.ground", range: [0, 1], apply: "live" },
    groundOffset: { path: "lightWash.groundOffset", range: [0, 180], apply: "live" },
    color: { path: "lightWash.color", apply: "live" },
    resolution: { path: "lightWash.scale", range: [0.1, 0.6], apply: "live" },
    everyNth: { path: "lightWash.every", range: [1, 6], step: 1, apply: "live" },
    everyFrames: { path: "lightWash.everyFrames", range: [1, 6], step: 1, apply: "live" },
  },

  // ----- reading the frame --------------------------------------------------
  // The probe (horse/js/silhouette.js). `skyLuma` is the one number to distrust if the
  // footage ever changes: it is what separates horse from night sky, and it is measured for
  // THIS clip. Turn `enabled` off to see what the piece does on the measured median profile
  // alone — which is what it did before, including throwing the forelock off the head.
  silueta: {
    enabled: { path: "silhouette.enabled", apply: "live" },
    skyLuma: { path: "silhouette.skyLuma", range: [20, 140], apply: "live" },
    pullClearPx: { path: "silhouette.pullClearPx", range: [20, 200], apply: "live" },
    stepPx: { path: "silhouette.stepPx", range: [2, 20], apply: "live" },
    clampSteps: { path: "silhouette.clampSteps", range: [1, 10], step: 1, apply: "live" },
  },

  // ----- the cursor through the mane ---------------------------------------
  // All live: the pointer values are read every frame, so this group is the one to drag
  // while actually brushing the mane with the other hand.
  puntero: {
    radius: { path: "pointer.radius", range: [10, 240], apply: "live" },
    falloff: { path: "pointer.falloff", range: [0.5, 4], apply: "live" },
    push: { path: "pointer.push", range: [0, 2], apply: "live" },
    drag: { path: "pointer.drag", range: [0, 0.6], apply: "live" },
    displace: { path: "pointer.displace", range: [0, 1], apply: "live" },
    decay: { path: "pointer.decay", range: [0.5, 0.98], apply: "live" },
    enabled: { path: "systems.pointerInteraction", apply: "live" },
  },

  // ----- one switch per subsystem, which is how you find out which one is
  //       ruining a look instead of guessing.
  //       Careful: opening the calibration overlay ("c") hands these back to what the
  //       file authored, so toggles made here do not survive it.
  sistemas: {
    renderHair: { path: "systems.renderHair", apply: "live" },
    gravity: { path: "systems.gravity", apply: "live" },
    wind: { path: "systems.wind", apply: "live" },
    cohesion: { path: "systems.cohesion", apply: "live" },
    bendReturn: { path: "systems.bendReturn", apply: "live" },
    collision: { path: "systems.collision", apply: "live" },
  },
};
