// ============================================================================
//  WILLOW CONFIG — only what is specific to this piece.
//
//  Generic knobs live in ../../shared/js/config.js. The willow is much simpler
//  than the horse: a STILL image, so there is no video, no frames, no temporal
//  tracking and no keyframes. The tree never moves. The only thing that moves is
//  the wind acting on the letters hanging from the branches.
//
//  What replaces the horse's tracking is the ANCHOR set: a list of points you
//  place by hand over the canopy, each spawning a small cluster of strands.
// ============================================================================

import { CONFIG, configure } from "../../shared/js/config.js";

// The base picture. Anchor and strand coordinates are normalized against THIS
// image, so swapping it moves nothing automatically — placements authored over a
// different tree will not line up with a new one.
//
// Arbolverde is a near-bare willow: the drooping branches have almost no foliage,
// so the glyph strands read as the tree's leaves rather than fighting with
// painted ones. (SauceLloron.png, the magic-realist painting, is still in the
// folder if you want to go back.)
const IMAGE = {
  // WebP, not the PNG. Measured: 6.57 MB -> 0.89 MB, a 7.4x cut, at PSNR 40.7 dB
  // with a worst-case channel difference of 33/255 — visually lossless, and the
  // willow is by far the heaviest slide in the gallery. Arbolverde.png stays in
  // the repo as the master; nothing on the web ever downloads it.
  //
  // Safe because the image is only READ BACK by sampleBranchStrands(), and that
  // runs from the strand editor's "generate" button, never at runtime.
  src: "Arbolverde.webp",
  width: 2752,
  height: 1536,
};

configure({
  image: IMAGE,

  // ----- WIND --------------------------------------------------------------
  // Nothing loops here, so the period only controls how long before the breeze
  // repeats itself. Long enough that the eye doesn't catch the cycle.
  windPeriod: 17,
  // Wind is the whole point of this piece, so it is far stronger than on the
  // horse and carries real vertical lift — these swing, they don't just sway.
  //
  // Measured on the 125 authored strands, peak-to-peak tip travel over one full
  // wind period, at 1512x862:
  //     0.42 ->  58px average / 78px max   (the earlier, gentler setting)
  //     1.40 -> 164px average / 246px max  (this one)
  //     1.80 -> 192px average / 307px max
  //     2.40 -> 223px average / 377px max
  // Nothing diverges and no strand lifts above its own branch at any of these,
  // so pushing further is safe if you want it wilder — those are the numbers.
  //
  // DELIBERATELY LEFT AT 1.40. It was briefly raised to 1.75 to compensate for
  // the heavier gravity below — weight and wind fight each other, so adding
  // gravity costs travel — and that was a mistake worth recording, because the
  // compensation is what made the fronds read as weightless.
  //
  // Measured on the current 464 strands at 1512x775, share of strands whose tip
  // rises to less than half its own length below its root at some point in the
  // wind period — i.e. fronds that FLEW UP instead of hanging:
  //     gravity 0.068, wind 1.75 -> 16% lifted
  //     gravity 0.068, wind 1.40 ->  2% lifted
  //     gravity 0.130, wind 1.40 ->  0% lifted
  // So the wind strength mattered more to the weightless look than the gravity
  // did. Raise this only if you want the piece wilder, and expect lift-off to
  // come back with it.
  //
  // The older numbers above were taken on 125 strands and are not comparable.
  // Treat travel measurements as ±10%: they sample ~30 points across one 17s
  // period and where those land in the cycle varies from run to run, so there is
  // no point fine-tuning below a ~15% step.
  windStrength: 1.4,
  windVertical: 0.35,
  windScale: 0.0042, // slightly coarser field: neighbouring fronds move together

  // ----- STRAND SHAPE ------------------------------------------------------
  // Willow fronds hang nearly straight down and are long. The horse's mane drapes
  // sideways over a neck, which is why its lean is large; here it is almost nil.
  drapeLean: 0.05,
  drapeX: -0.004,
  lengthRange: [70, 300],
  // Flat profile: the horse varies length along one crest line via `t`, but the
  // willow's length is authored per anchor instead (root.lenScale), because each
  // branch hangs to its own depth.
  lengthProfile: [1],
  lengthJitter: 0.22, // more variation: a willow is not a comb
  // Spacing between characters, brought down with fontSize so a strand stays a
  // continuous column instead of turning into spaced-out dots. Authored strand
  // LENGTHS are untouched by this — a liana still reaches exactly as far as it
  // was dragged; it just fits more, smaller characters into that same distance.
  segmentLength: 16,
  // Raised to match: the longest authored strand is ~421px, which at 12px
  // spacing wants ~35 characters. A cap of 30 would have quietly stretched the
  // spacing back out on the long ones, undoing the change.
  // 940px at 16px spacing wants ~59 characters. A lower cap would quietly stretch
  // the spacing on the longest strands and open gaps between their glyphs.
  maxParticles: 62,
  // The shared default is 6, which suits a mane where every strand is long. Here
  // strands are placed one by one and a short one is a deliberate choice: forcing
  // 6 characters into a 30px strand stacked them 5px apart, unreadable. With 2,
  // a short strand renders as the two or three letters actually asked for.
  minParticles: 2,

  // ----- NATURAL SHAPE -----------------------------------------------------
  // What stops the curtain reading as a barcode. Dead-vertical parallel columns
  // of evenly-sized glyphs is the single most artificial thing this can do; a
  // real frond leaves its branch almost vertically, arcs outward away from the
  // trunk, and thins toward the loose end.
  curveBias: 0.34, // resting arc, as a fraction of the strand's own length
  maxArcPx: 210, // and never more than this, however long the strand is
  // Outward force that keeps that arc open against gravity — so it MUST rise with
  // gravity or the arc closes and the tree turns into a comb. This is the single
  // thing to remember when touching `gravity`. Measured mean tip-to-root
  // horizontal distance at rest, all at gravity 0.13:
  //     spread 0.019 (the original) -> arc collapses
  //     spread 0.036 -> 34px
  //     spread 0.046 -> 43px   <- matches the original light setting's 46px
  //     spread 0.056 -> 52px   (wider than the picture ever was)
  drapeSpread: 0.046,
  tipScale: 0.62, // glyphs at the tip are well under those at the top
  wander: 2.4, // sideways drift per strand, so neighbours aren't ruler-parallel
  // Per-character irregularity — the difference between a bending filament and a
  // ruled line of type. Without these the strand curves as a whole but its
  // characters still sit on one exact axis at one exact pitch.
  waverAmp: 0.9, // slow sideways bend, in units of one segment
  charJitterX: 0.45, // per-character sideways nudge
  charSpacingJitter: 0.3, // ± 30% variation in the gap between characters
  frayFrom: 0.62, // past 62% along the strand, characters start dropping out
  frayAmount: 0.75, // up to a 75% drop chance at the very tip
  // ON here. Measured over one wind cycle on 1243 lianas: the root character
  // travels 0.0px against 7.1px for the next one and 26.9px three down, so it was
  // 1243 letters nailed to the branches — 9.7% of everything drawn, and the most
  // visible 9.7%, because the ramp makes each liana brightest exactly there.
  hideRootGlyph: true,

  // ----- PHYSICS -----------------------------------------------------------
  // 0.05 was the original "these should drift, not hang like rope" setting, and
  // it read as weightless — the fronds hung in the air on the way back down from
  // a cursor sweep. 0.13 is 2.6x that. Heavy for this piece by intent.
  //
  // Worth knowing what gravity does and does NOT do here, because it is not what
  // you would expect. It barely changes how far they HANG: mean tip-to-root drop
  // moves only 317px -> 338px between 0.05 and 0.13, because the segments are
  // inextensible and the strands already hang nearly straight at rest. If you
  // want them to reach further down, that is strand LENGTH in the editor, not
  // this. What gravity changes is how much they RESIST being thrown around:
  //     0.05  -> 7025ms to go still after a cursor sweep, 16% of fronds lifted
  //     0.068 -> 5905ms,  2% lifted
  //     0.13  -> 4053ms,  0% lifted
  // It is also the ONLY knob that moves that settling time: measured, `damping`
  // (0.90) and `iterations` (up to 8) leave it untouched to within 1% while both
  // cost wind travel, which is why neither was changed.
  //
  // The cost is real and unavoidable: peak-to-peak tip travel under wind falls
  // 351px -> 201px. Heavier things move less. Do not buy it back with
  // `windStrength` — see the note there for why.
  gravity: 0.13,
  damping: 0.94, // less drag, so a gust keeps travelling through the frond
  cohesion: 0.06, // fronds are much more independent than strands of a mane
  cohesionMaxDist: 40,
  bendReturn: 0.02, // a branch tip is stiffer at its attachment than hair is
  // 4 instead of the shared 6. With 460 loose strands the constraint passes are
  // the dominant per-frame cost, and these don't need a mane's stiffness — the
  // uneven character spacing survives 4 passes just as well.
  iterations: 4,

  // ----- GLYPHS ------------------------------------------------------------
  // Neon green, the Matrix-rain read. The base picture is a night scene lit from
  // below in yellow-green, so a brighter, more saturated green separates the
  // strands from the tree's own lit bark instead of blending into it.
  color: "#54ff45",
  fontSize: 14, // see segmentLength, which tracks this so columns stay continuous
  glyphRotate: false, // characters stay level, like the reference; also much cheaper
  // A dark green-black edge, not neutral black: it keeps the glyph legible where
  // it crosses the lit trunk and the bright grass without reading as a shadow.
  // Scaled down with the font — a 2.5px stroke around a 10px glyph reads as a
  // blob, which would undo making the characters smaller.
  glyphOutline: {
    width: 2.1,
    color: "rgba(2, 26, 8, 0.92)",
  },
  // Brightness varies character to character — the spec asks for it, and a mass
  // at one uniform alpha reads as printed rather than as hundreds of separate
  // lights. Kept high (0.82 floor) so nothing looks washed out. `tipFade` stays
  // off: the ends thin out through fraying and taper, not through going
  // transparent, which keeps every visible character crisp.
  minAlpha: 0.82,
  maxAlpha: 1.0,
  tipFade: 0,

  // ----- DEPTH -------------------------------------------------------------
  // What turns a flat decal into a mass with volume. Strands carry a z from the
  // generator's layers, and everything here interpolates front -> back.
  // `hazeColor` is the night sky behind the tree, so a receding strand loses
  // saturation toward the background instead of just going grey.
  depth: {
    enabled: true,
    // Raised from 4: a strand that fades from white at its root to green at its
    // tip needs enough baked steps for that run to look continuous. With 4, the
    // -1..1 range steps by 0.67 and the gradient shows as visible bands.
    //
    // Raised again 9 -> 13 when EVERY layer became a ramp rather than just the
    // highlights. At 9 the -1..1 range steps by 0.22, and the body layers ramp by
    // 0.55-0.75, so a strand crossed only 2-3 steps: the fade read as a couple of
    // hard jumps down its length. 13 steps by 0.15. It costs one baked atlas per
    // bucket per character, so this is the dial to bring back down if the glyph
    // atlas ever becomes a memory problem.
    buckets: 13,
    // Pushed hard on purpose. Subtle differences lose to the sheer amount of
    // green: a deep strand has to be obviously smaller, dimmer and closer to the
    // sky's colour before the eye reads it as further away rather than as just
    // another strand.
    scale: [1.0, 0.5],
    alpha: [1.0, 0.34],
    glow: [1.0, 0.12], // near strands are self-lit, deep ones almost matte
    haze: [0.0, 0.72],
    hazeColor: "#0d2233",
    // Holds the bright root value further down each strand before it fades. Linear
    // (1) put the whole highlight on the first character or two, which are the
    // pinned root and the two the bend return holds — so the glow landed on the
    // only part of the liana that does not move and read as a lit dot hanging in
    // the air. This carries it into the part that sways.
    rampCurve: 1.5,
    // Finished by 55% of the strand, comfortably before `frayFrom: 0.62` starts
    // dropping characters. Without this the held-bright section reached the frayed
    // tail and lit up the scattered single glyphs there — loose bright letters with
    // nothing attached, which is the opposite of the intent.
    rampSpan: 0.55,
  },

  // ----- LIGHT WASH --------------------------------------------------------
  // The characters have to look like what is lighting the scene, not like a layer
  // pasted over a photo. This casts their green onto the trunk, the branches and
  // the ground under the whole canopy.
  lightWash: {
    enabled: true,
    scale: 0.25,
    // Sampling every 3rd character over ~460 strands is still ~4700 additive
    // halos. They OVERLAP roughly 25-30 deep across the canopy, so the per-sample
    // alpha has to be tiny or the whole crown saturates to white — at 0.07 it did
    // exactly that and buried the tree. 0.008 x ~27 lands near 0.2 accumulated,
    // which reads as light on the scene while every character stays crisp.
    every: 6,
    everyFrames: 4, // the wash is soft and slow; a quarter of the frames is plenty
    radius: 26,
    alpha: 0.013,  // raised to compensate for sampling every 6th character
    color: "#4aff33",
    ground: 0.55,
    groundOffset: 120,
  },

  // ----- TEXT --------------------------------------------------------------
  // Abstract digital information, not language and not binary rain. The pool is
  // weighted by repetition: letters appear ~3x as often as digits and symbols are
  // occasional, so it reads as data without collapsing into 0s and 1s. An even
  // A-Z + 0-9 mix lands ~28% digits, which already looks like Matrix binary.
  words: null,
  charPool:
    "ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ" +
    "0123456789012345678901" +
    "#$%&*+=/<>[]{}?!@~^|",

  // ----- SYSTEMS -----------------------------------------------------------
  systems: {
    collision: false, // there is no body to collide with here
    renderHair: true,
    // Brushing the cursor through the curtain. Tuning lives in CONFIG.pointer.
    pointerInteraction: true,
    // ON here, unlike the horse. The reference for this piece is glowing code
    // rain, and the halo is what makes the strands look self-lit against a night
    // sky rather than painted on top of it. Baked into the glyph atlas once.
    glow: true,
  },
  glowIntensity: 6,

  // ----- POINTER -----------------------------------------------------------
  // The shared default is 30px, sized for the horse's mane — a small, tight
  // curtain read at head scale. On the willow it is invisible: a 30px circle in
  // a ~1500px window barely covers two neighbouring fronds, so the cursor
  // parted a couple of letters and nothing else moved. These fronds are long,
  // dense and hang free, so the hand should open a real gap in them.
  //
  // `falloff` is raised along with the radius on purpose. Influence at a given
  // distance is (1 - d/radius)^falloff, so widening the radius alone also
  // strengthens the whole mid-range and the parting turns into a hard-edged
  // circular hole travelling with the cursor. A steeper falloff keeps the push
  // concentrated near the cursor and leaves the outer ring gentle, so the gap
  // has a soft silhouette instead of a stamped edge.
  pointer: {
    radius: 120,
    falloff: 2.4,
  },

  // ----- STRAND EDITOR (?strands, or the "s" key) --------------------------
  // Individually authored strands: you drag out each one by hand, position AND
  // length together, no cluster/spread/jitter involved. Combines with whatever
  // the anchor editor produces — this adds strands on top, it doesn't replace
  // them. `lengthPx` is CSS px, same convention as CONFIG.lengthRange elsewhere:
  // not scaled by the cover transform, so a strand stays the same physical
  // length regardless of window size.
  strands: {
    storageKey: "willow-strands-v1",
    exportFilename: "willow-strands.json",
    exportDecimals: 5,
    sourceUrl: "willow-strands.json", // loaded at boot when present

    defaultLengthPx: 160, // used for a click with no real drag
    minDragPx: 8, // drags shorter than this count as "just a click"
    minLengthPx: 20,
    maxLengthPx: 940, // outer strands must be able to reach near the grass

    hitRadius: 16, // px grab radius for root/tip handles, larger than the dot
    dotRadius: 5,
    selectedRadius: 8,
    saveDebounceMs: 200,
    labelFont: '11px ui-monospace, "SF Mono", Menlo, monospace',
    previewFont: '12px ui-monospace, "SF Mono", Menlo, monospace',
    hud: { x: 12, y: 12, width: 470, lineHeight: 17, padding: 10, font: '13px ui-monospace, "SF Mono", Menlo, monospace' },
    colors: {
      root: "#7fd7ff",
      tip: "#ffb37f",
      dotStroke: "rgba(0, 0, 0, 0.6)",
      line: "rgba(127, 215, 255, 0.55)",
      selected: "#fff34d",
      preview: "#ffe27f",
      label: "#bfe9ff",
      hudBg: "rgba(0, 0, 0, 0.72)",
      hudKey: "#7fd7ff",
      hudText: "#cfe",
    },
  },

  // ----- BRANCH SAMPLER ----------------------------------------------------
  // Generates hundreds of strands straight from the base image, so the curtain
  // reads as the tree's foliage instead of a few strings hung by hand. Placing
  // that many one at a time isn't realistic.
  //
  // How the tree is separated from the background, measured on Arbolverde.png:
  //   sky        rgb(2,6,22)      green/blue ratio ~0.27
  //   clouds     rgb(10,31,63)    ratio ~0.49
  //   dark twigs rgb(31,37,49)    ratio ~0.76
  //   lit twigs  rgb(124,125,129) ratio ~0.97
  // So the green/blue ratio splits tree from sky cleanly at ~0.72, while
  // luminance alone does not (the upper twigs are dark silhouettes, and a bright
  // cloud outshines them).
  //
  // The grass is also green and bright, but it starts abruptly: the share of
  // green pixels per row jumps from 0.7% to 35% at y=0.80, so a hard cut at 0.79
  // removes it without touching the lowest branch tips.
  branchSampler: {
    gbRatio: 0.72, // min green/blue to count a pixel as tree
    minLum: 8, // ignore near-black pixels
    grassY: 0.79, // everything at or below this is ground, not tree
    xRange: [0.15, 0.8], // ignore the distant bushes on the horizon
    analyzeScale: 0.5, // analyse at half resolution; plenty, and much faster

    // ROOT CANDIDATES. Roots sit on real branch pixels, found as runs of tree
    // rows within each column — see the long note at the top of branchSampler.js
    // for why the previous contour-interpolation approach produced a curtain.
    //
    // How far apart candidates are taken along one run, in analyze px. Smaller
    // means more places a strand can be born; the layer's `spacingPx` is what
    // decides how many are actually used, so this only has to be fine enough not
    // to miss short runs. 7 gives ~24k candidates over the whole tree.
    rootStepPx: 7,
    // Above this horizontal width the structure is the TRUNK, not a branch, and
    // nothing should hang off it. Measured on Arbolverde at analyzeScale 0.5, the
    // structure's horizontal width is 2px at the median and 9px at p90, while the
    // trunk runs 33-109px — so this threshold sits in an empty gap between the
    // two populations and is not delicate.
    maxRootWidthPx: 24,
    // Connected blobs smaller than this are erased before anything else. A white
    // star has a green/blue ratio near 1.0, so it passes the colour test and would
    // otherwise get letters hanging off it in mid-sky. Measured, 9% of sampled
    // structure pixels were specks of 1-2px with no solid neighbourhood; the tree
    // itself is one component of many thousands of px, so this is a wide margin.
    minComponentPx: 60,
    // A root also needs COMPANY, not just a branch pixel under it. A twig tip
    // poking out of the crown's silhouette is a real branch, but a strand born
    // there hangs in open sky and its lit first characters read as loose letters
    // floating next to the tree instead of as part of a liana. Both numbers are in
    // analyze px: at least this share of the box around the root has to be tree.
    rootDensityRadiusPx: 18,
    rootMinDensity: 0.1,
    // ANISOTROPIC ROOT SPACING. Multipliers on each layer's `spacingPx`, turning the
    // minimum gap between two roots from a circle into an ellipse: narrow across,
    // tall down.
    //
    // A circle spaces roots evenly in every direction, which reads as a field of
    // unrelated points — but a branch is a roughly horizontal thing and fronds hang
    // off it side by side. Letting roots sit CLOSE horizontally packs them into rows
    // along the branch they belong to; keeping them FAR apart vertically stops one
    // branch's row from merging into the next one's. Extra density and the visible
    // line of origin come from the same change, which is why they are one setting.
    //
    // Floor on the horizontal one: it must stay above the glyph width or neighbours
    // collide sideways into a solid slab. A monospace glyph is about 0.6 x fontSize,
    // so ~8.4px here; at spacingPx 20-22 these ratios give 11-12px.
    spacingRatioX: 0.40,
    spacingRatioY: 1.55,
    // Branch UNDERSIDES (the foot of each column run) claim their spacing slots
    // before anything else. Selection is greedy, so order decides what survives:
    // feet of the same branch across neighbouring columns sit at nearly the same y,
    // so giving them priority is what draws the rows. With one mixed pass, a point
    // halfway up a run can take the slot and the row blurs into a cloud.
    footFirst: true,
    // Irregularity ON TOP of the height profile, not instead of it. It was 0.42,
    // which at ±42% made the bands overlap almost completely — a top liana could
    // come out at 75px and a middle one at 125px, so the gradient the profile
    // describes was not readable in the result. At 0.18 the bands separate:
    // top 107-153px, middle 72-104px, low 37-53px, with no overlap between top
    // and middle. Raise it only as far as the gradient survives.
    lengthJitter: 0.18,
    // Clumping. Below `clumpFloor` the field thins the candidates out. Dense
    // masses beside open gaps, instead of an even comb.
    clumpFloor: 0.42,
    // Extra length toward the edges of the crown. Cut from 0.26 to 0.10: at 0.26 the
    // outer lianas were up to a quarter longer than their height profile asks for,
    // and since the crown is widest where the mass is heaviest, that was enough on
    // its own to rebuild the continuous sheet at the sides. Some variation toward
    // the extremes is still wanted, just not enough to override the profile.
    outerLengthBonus: 0.1,
    // LENGTH PROFILE BY ANCHOR HEIGHT. This is what decides how long a liana is. It
    // replaced `lengthFraction` / `lengthFractionLow`, which derived length from the
    // distance down to `tipFloor` — and that coupling is what built the continuous
    // sheet, because room to the floor is largest at the top, so high-born lianas
    // were both the longest AND fell straight through every band where the lower
    // ones are born. Measured on the set this replaces, a liana rooted at ny 0.20
    // ended at ny 0.52 and one rooted at 0.30 ended at 0.63.
    //
    // Values are FRACTIONS OF THE COVER HEIGHT, not px, so the canopy keeps its
    // proportions at any window size. Sampled across `lengthSpanNy`, the height
    // range where anchors actually appear. At 1512x775 the cover is 844px tall, so
    // the profile reads as roughly:
    //     ny 0.05 (crown top)  0.154 -> 130px   ~8 characters
    //     ny 0.22              0.140 -> 118px
    //     ny 0.40 (mid)        0.104 ->  88px   ~5-6 characters
    //     ny 0.57              0.073 ->  62px
    //     ny 0.75 (lowest)     0.053 ->  45px   ~3 characters
    // The drop is meant to be obvious: a low branch carries a short fringe, a high
    // one a long fall. Keep it MONOTONIC — any rise on the way down starts rebuilding
    // the sheet, which is exactly what the old `lengthFractionLow` was doing.
    lengthSpanNy: [0.05, 0.75],
    lengthProfileNy: [0.154, 0.14, 0.104, 0.073, 0.053],
    // Floor for a generated strand, and now a CLAMP rather than a reason to discard
    // it. 34px at segmentLength 16 is two visible characters, about as short as a
    // liana can be and still read as one. It was 80px (five characters) while lengths
    // came from `room`, where anything shorter meant a root with no space under it;
    // with the profile a short liana is the intended result for a low anchor, so
    // dropping those would empty out exactly the zone this change exists to fill.
    minRunPx: 34,
    // Lowest normalized y a tip may reach. The trunk meets the grass around 0.81,
    // so stopping at ~0.70 leaves a clear band of lit ground below the canopy and
    // keeps the trunk and lower branches visible — which is what the reference
    // does. Jittered per strand so the bottom edge is ragged, not a ruled line.
    // Raised from 0.70: it is what caps how much room a low root has to hang into,
    // and at 0.70 a root at ny 0.65 had 42px to work with, which is two characters.
    // The grass starts at 0.79, so 0.75 plus the jitter keeps the tips just off it
    // while giving the low branches lianas that actually hang.
    tipFloor: 0.72,
    tipFloorJitter: 0.04,

    // DEPTH LAYERS, back to front. The mass only reads as having volume if it is
    // built in layers: a deep one that is dense, short and dim, and a near one
    // that is sparse, long and bright. A single layer at uniform size and
    // brightness always reads as a flat decal, however many strands it has.
    //
    // `spacingPx` is the density dial: the MINIMUM gap allowed between two roots
    // of the same layer, in screen px. It must stay at or above the glyph width,
    // or strands collide sideways and the tree fills in as a solid slab. A
    // monospace glyph is roughly 0.6 x fontSize wide. Layers are independent, so
    // roots from different layers may sit closer than this to each other — which
    // is what gives the canopy overlap in front of and behind the branches.
    //
    // `rootFrom` / `rootJitter` / `rootSpread` / `phase` are GONE. They existed to
    // scatter roots vertically as a fraction of each column's extent, back when
    // the sampler had no idea where the branches were. Roots now come from the
    // branch pixels themselves, so what separates the planes is density, length
    // and brightness rather than an artificial contour offset.
    //
    // `lengthFactor` multiplies the height profile above. Deep layers hang slightly
    // LONGER so they show below and between the front ones instead of hiding
    // behind them.
    //
    // The last entry is the HIGHLIGHT layer: negative z, so it sits nearer than
    // the front plane, blended toward near-white with extra glow. Sparse, and with
    // a raised windGain so it moves looser than everything around it — a handful
    // of these is what keeps a mass of one colour from reading as flat. `zTip` is
    // what makes them work: they start near-white at the branch and blend into the
    // ordinary green by the tip, so they read as lit strands within the mass
    // rather than as separate white objects.
    // EVERY layer ramps from `z` at the root to `zTip` at the tip, so the first
    // characters of every strand are the crisp, bright, glowing ones and each
    // strand fades hazier toward its loose end. This used to be true of the
    // highlight layer ONLY — the other four had a constant z, so 90% of the
    // strands had no brightness gradient along them at all. What made it read
    // anyway was that all roots sat in a narrow band at the top of the canopy, so
    // the bright ends lined up into a glowing upper edge; once roots followed the
    // real branches, that accident disappeared and took the effect with it.
    //
    // The ramps are WIDE on purpose. Brightness is baked per z bucket, so a ramp
    // narrower than a couple of buckets shows up as one hard step instead of a
    // fade — that is what `buckets` in CONFIG.depth is for.
    //
    // Each layer keeps its old CONSTANT z at the ROOT and ramps only its tip
    // hazier. That direction matters, and it is not obvious — brightness is very
    // non-linear in z, so you cannot centre a ramp on the old value and expect the
    // same amount of light. Between z=0.15 and z=1.0 alpha goes 0.9 -> 0.34, scale
    // 0.93 -> 0.5 (so area 0.86 -> 0.25) and glow 0.9 -> 0.12: the product falls
    // about 9x, which means the bright half of a ramp dominates what you see.
    // Measured mean luminance of the crown, against 61 for the flat-z version this
    // replaced: ramping down from the old z gave 81, centring the ramp on it still
    // gave 78. Ramping only the tips gives back the original level while still
    // making the first characters clearly the bright ones.
    layers: [
      { z: 0.9, zTip: 1.0, spacingPx: 22, lengthFactor: 1.3 },
      { z: 0.72, zTip: 1.0, spacingPx: 20, lengthFactor: 1.15 },
      { z: 0.45, zTip: 0.85, spacingPx: 20, lengthFactor: 1.0 },
      { z: 0.15, zTip: 0.6, spacingPx: 22, lengthFactor: 0.9 },
      // NO `rootNy` band: these are born anywhere the branches are, exactly like
      // the body layers. It briefly had one, pinning it to the top 42% of the
      // canopy, and that was wrong — in the reference the intense white-to-green
      // lianas hang off the low and mid branches too, each glowing at ITS OWN
      // start. Restricting the layer by height produced the opposite reading: the
      // only bright lianas were the ones coming off the top, so the glow looked
      // like a property of the crown rather than of how a liana begins.
      //
      // What makes them read as lianas rather than as loose bright letters is not
      // where they are born but the ramp shape — see `rampCurve` and `rampSpan` in
      // CONFIG.depth above.
      //
      // `spacingPx` here is dosage, and worth measuring rather than guessing,
      // because the highlights carry far more light per strand than anything else.
      // Counting total highlight length as a stand-in for how much glow is on
      // screen: the original set had ~16,200px of it (44 strands x 369px), and at
      // spacing 26 confined to the top band this layer produced 29,100px, which
      // lifted bright pixels in the crown to 7.4% against the original 2.5%.
      // Spread over the whole canopy it covers far more ground for the same
      // spacing, so the number is set from the measured dose, not by eye.
      { z: -0.95, zTip: 0.2, spacingPx: 37, lengthFactor: 1.4, windGain: 1.35 },
    ]
  },

  // ----- ANCHOR EDITOR (?anchors, or the "e" key) --------------------------
  // You place the anchors; each one is a point on a branch that letters hang
  // from. An anchor is { nx, ny, count, spread, len }: where it is, how many
  // strands it spawns, how wide they fan out, and how far they hang.
  anchors: {
    // OFF. The 28 anchors in willow-anchors.json were scaffolding I generated so
    // the piece wouldn't start empty; they expanded into 97 auto-generated
    // strands, which was 54% of everything on screen and buried the strands
    // placed by hand. The data is kept (and the editor still works) — set this
    // back to true to bring the clusters back.
    enabled: false,

    storageKey: "willow-anchors-v1",
    exportFilename: "willow-anchors.json",
    exportDecimals: 5,
    sourceUrl: "willow-anchors.json", // loaded at boot when present

    // Defaults for a freshly placed anchor.
    defaults: { count: 5, spread: 0.012, len: 1 },
    // Bounds and steps for the adjustment shortcuts.
    countRange: [1, 24],
    spreadRange: [0, 0.12],
    spreadStep: 0.003,
    lenRange: [0.15, 2.5],
    lenStep: 0.1,
    // Deterministic scatter inside a cluster so a group doesn't read as a comb.
    jitterX: 0.004,
    jitterY: 0.006,

    // editor visuals
    hitRadius: 16, // px grab radius, larger than the drawn dot
    dotRadius: 5,
    selectedRadius: 8,
    saveDebounceMs: 200,
    labelFont: '11px ui-monospace, "SF Mono", Menlo, monospace',
    hud: { x: 12, y: 12, width: 430, lineHeight: 17, padding: 10, font: '13px ui-monospace, "SF Mono", Menlo, monospace' },
    colors: {
      dot: "#7fd7ff",
      dotStroke: "rgba(0, 0, 0, 0.6)",
      selected: "#fff34d",
      spread: "rgba(127, 215, 255, 0.5)", // the bar showing a cluster's width
      label: "#bfe9ff",
      hudBg: "rgba(0, 0, 0, 0.72)",
      hudKey: "#7fd7ff",
      hudText: "#cfe",
    },
  },

  // ----- KEY BINDINGS ------------------------------------------------------
  keys: {
    controls: "t", // show/hide the ?controls panel. Free in all three pieces.
    editor: "e", // toggle the anchor (cluster) editor
    strandEditor: "s", // toggle the individual strand editor
    toggleLetters: "h", // show/hide the glyphs while an editor is open
    remove: ["backspace", "delete"],
    // anchor editor: adjusts the selected CLUSTER
    fewer: "[", // strands in the selected cluster
    more: "]",
    shorter: "-",
    longer: "=",
    narrower: ",",
    wider: ".",
    // strand editor: adjusts the selected individual strand, by exactly one
    // character. Deliberately the same keys as the anchor editor's fewer/more —
    // only one editor is ever active at a time, so there is no collision, and
    // "[ ]" reads the same way in both: fewer/more letters.
    fewerChars: "[",
    moreChars: "]",
    diagnostics: "d",
  },
});

export { CONFIG, AUTHORED_SYSTEMS } from "../../shared/js/config.js";
