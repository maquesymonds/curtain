// ============================================================================
//  HORSE CONFIG — only what is specific to this piece.
//
//  Everything generic (physics, glyphs, wind, systems toggles, dpr) lives in
//  ../../shared/js/config.js. This file overrides what the horse needs and adds
//  the blocks nothing else has: the clip's real facts, the tracking source, the
//  collision primitives, and the two authoring tools.
//
//  `configure()` runs at module load, before anything reads CONFIG. Every module
//  in this folder imports THIS file, so that ordering is guaranteed.
// ============================================================================

import { CONFIG, configure } from "../../shared/js/config.js";

// The clip's real facts, measured with ffprobe. Not round numbers: `duration` is
// derived from frameCount / fps so the two can never drift apart.
const VIDEO = {
  src: "Caballo.mp4",
  width: 1280,
  height: 720,
  fps: 24,
  frameCount: 121,
  duration: 121 / 24, // 5.041667 s
};

configure({
  // ----- MODE --------------------------------------------------------------
  // "video" = animated clip with keyframe tracking (roots follow the moving
  //           crest, collision uses animated primitives).
  // "static" = original single photo (roots from the white line, PNG collision).
  mode: "video",
  video: VIDEO,
  static: {
    image: "Caballo1.png",
    mask: "horse-collision-mask.png",
  },

  // The wind field is periodic over this many seconds. It MUST be the clip
  // length here, or the breeze would not return to its starting state when the
  // video loops and the mane would jump.
  windPeriod: VIDEO.duration,

  // ----- SYSTEM TOGGLES ----------------------------------------------------
  // Only the ones that differ from the shared defaults. `collision` is off for a
  // measured reason — see the long note on curvePrimitives below.
  systems: {
    collision: false,
    glow: true, // neon: see the colour block below
    pointerInteraction: true, // brushing the mane with the cursor — see `pointer` below
  },

  // ----- MANE NEON — EMISSION, NOT LEGIBLE PINK TEXT -------------------------
  //
  // The previous version of this block optimised for one thing: keeping a glyph
  // readable as a glyph over a bright neck of its own hue. It did that with a fat
  // dark outline and a pale, desaturated pink, and it worked — it was also the
  // reason the mane read as text laid on a photograph rather than as something lit.
  //
  // The goal here is different and so the mechanism is different. Instead of a flat
  // fill separated by a graphic border, every glyph is baked in three layers:
  //
  //     bloom   #ff1493  wide soft halo, 4 passes at blur 14.2  <- light AROUND it
  //     body    #ff5fcb  saturated hot pink, S 63%              <- the hue
  //     core    #fff2fb  near-white, alpha 1, no blur           <- the hot filament
  //
  // That structure is why the saturation can go up. The old note here was right that
  // saturating a pink costs luminance — #ff5fcb is lum 141 against the neck's 143, so
  // as a flat fill it would vanish tonally, exactly as that note predicted. What
  // separates it now is not the fill at all: it is the near-white core carrying the
  // luminance and the halo carrying the light, with the hue free to be as saturated as
  // the piece wants. The contrast comes from luminance and bloom, not from a border.
  //
  // Which is why the outline drops from 3px to 0.85px at half the alpha. It is no
  // longer load-bearing; it is a hairline of separation so that adjacent glyphs in the
  // packed root zone do not fuse into one bright mass.
  //
  // All of it is baked into the atlas, per depth bucket, so the frame is still one
  // drawImage per character — see glyphBloom in shared/js/config.js.
  //
  // WHAT THE WIDE HALO COSTS. `blur` sets the padding every glyph bitmap needs, so it is
  // paid in fill rate rather than in per-frame work. Measured at 1440x900, frame 40:
  //     no bloom at all        box 39px    draw 1.27 ms
  //     2 passes at blur 9     box 57px    draw 3.45 ms
  //     4 passes at blur 14.2  box 70px    draw 1.85 ms   <- this config
  // The last row looks impossible and is not: the box grew 1.5x in pixels, but this pass
  // also turned lightWash.ground off, which removed the second offset blob per sample
  // from the wash, and halved its radius. The wash was the expensive half. Total frame
  // cost 2.57 ms of the 41.7 ms a 24fps frame has — 6.2%. Baking all 13 buckets is
  // 8.5 ms, once, on build or resize.
  color: "#ff5fcb", // body: H 318° S 63% V 100%, lum 141
  fontSize: 17.2, // over the shared 16, against an unchanged segmentLength of 16
  glowIntensity: 1.45, // tight halo on the body pass, under the wide bloom
  glyphBloom: {
    passes: 4,
    blur: 14.2,
    alpha: 0.28,
    color: "#ff1493", // deep pink: the halo stays more saturated than the body
  },
  glyphCore: {
    alpha: 1, // opaque: the core is the letter, the bloom is the light
    color: "#fff2fb", // near-white, tinted pink so it never reads as grey
  },
  glyphOutline: {
    width: 0.85,
    color: "rgba(70, 0, 40, 0.55)",
  },
  minAlpha: 0.86,
  tipFade: 0, // the depth ramp already dims what recedes; this was doubling it

  // ----- THE LIGHT THE MANE THROWS ON THE HORSE -----------------------------
  // Was off, and that absence was a large part of why the letters read as pasted on.
  // A neon mane lights the neck it grows out of. Built at quarter resolution and
  // composited with "lighter", so it costs almost nothing (see _drawLightWash).
  //
  // Local, and after tuning it live it is very local: a tight, strong core of light
  // along the crest instead of a wide soft field. `radius` halved to 16px, `intensity`
  // doubled and `rootBoost` at its ceiling, which together put nearly all of the light
  // within a couple of characters of the roots — the crest glows, the rest of the neck
  // is lit by the glyph bloom rather than by this layer.
  //
  // `ground` is 0: the downward spill exists for the willow, whose canopy hangs in
  // front of a trunk with something behind it to catch the light. A mane lies ON the
  // neck, so a second offset blob below every character was lighting nothing that the
  // bloom was not already lighting, and softened the crest by filling in under it.
  lightWash: {
    enabled: true,
    scale: 0.25,
    every: 2,
    everyFrames: 2,
    radius: 16,
    alpha: 0.028,
    intensity: 2,
    blur: 4,
    rootBoost: 3,
    color: "#ff2fa8",
    ground: 0,
    groundOffset: 0,
  },

  depth: {
    // Was off, which is why the horse had no highlights at all. Turning it on is
    // what makes the white roots possible — with it off there is one flat atlas.
    enabled: true,
    buckets: 13, // as in willow: fewer and the white-to-pink run shows as bands
    scale: [1.0, 0.78],
    alpha: [1.0, 0.72],
    glow: [1.0, 0.2],
    // A mane is a THIN curtain lying on a bright subject, not a deep canopy in
    // front of the sky, so both of these are far gentler than the willow's.
    haze: [0.0, 0.34],
    // NOT the night sky. The willow hazes toward sky blue because its lianas hang
    // against the sky; the mane hangs against the HORSE. Hazing toward blue over a
    // pink neck mixed to a dirty lavender and the letters read as grey mush — the
    // first attempt at this was measurably worse than the pale pink it replaced.
    // This is the shadow colour inside the mane itself.
    hazeColor: "#7a2b5c",
    highlightColor: "#fff2fb", // near-white, tinted pink the way willow's is tinted green
    // Lower than the fish's 0.78: a near-white glyph on a near-white-pink horse is
    // no contrast at all. The white is a hot core, not the body of the strand.
    highlight: 0.55,
    highlightGlow: 1.5,
    rampCurve: 1.5,
    rampSpan: 0.55, // finishes before the frayed tail
  },
  // Per-strand ends of the neon ramp, applied in main.js by withNeonDepth(). RANGES,
  // drawn per strand from a hash of its index — never from where it sits on screen
  // (REGLA 1). The width of these ranges is what keeps the crest from fusing into one
  // bar of light: at the old fixed -0.9 every strand was an equally hot highlight, and
  // 84 of those overlapping along the crest read as a painted stripe rather than as
  // hair. Now some strands are hot at the root and others are already receding.
  maneDepth: { zRoot: [-1.0, -0.28], zTip: [0.16, 0.62] },

  // ----- MANE SHAPE — the code IS the mane, not a fringe under it ------------
  //
  // The premise of everything in this block: the tracked curve is ANATOMY (it runs
  // along the top of the neck, inside the body) and the mane is a BAND of hair
  // reaching outward from it. Roots born on the curve are born underneath real
  // horse hair, and no amount of glow fixes that — measured on the untouched piece,
  // 18.9 px of real crest (video px) sat above the letters, with only 43.9% of the
  // band covered and 80.9% of the crest showing more than 6 px of bare hair.
  maneShape: {
    // EVERY PROFILE IN THIS BLOCK HAS ONE ENTRY PER TRACKED PEN POINT — 14 of them, so
    // entry i is the value AT the point labelled `i` in the track editor (which labels
    // from 0). See the table over lengthProfile above for the u of each one. Keeping all
    // of them in the same coordinate language is deliberate: a profile in twelfths next
    // to a profile in pen points is a trap for whoever edits this next.
    //
    // DEPTH OF THE REAL HAIR BAND, in video px, sampled along u (0 = poll, 1 =
    // withers). Not invented: for 13 frames of the clip, at 49 points along the
    // curve, the outward normal was walked until the frame went dark (the night sky
    // behind the horse), and this is the median of those distances, smoothed. The
    // spike the raw data shows at u≈0.17 is the EAR, not hair, and is flattened
    // here. Video px rather than screen px because that is the space it was
    // measured in; crestOffsetPx() scales it by the cover, like the footage.
    // One entry per pen point, like lengthProfile — see the table there.
    crestOffsetPx: [18, 22, 25, 28, 31, 34, 34, 32, 28, 25, 21, 15, 8, 3],
    // One number to move the whole profile.
    //
    // Raised to 1.3 because the profile was measured against the WRONG EDGE. The walk that
    // produced crestOffsetPx stopped at the first sustained run below luminance 62, and the
    // horse's own crest hair is semi-transparent: measured outward from the curve there is a
    // band of 45..100 luminance — dim hair over dark sky — 4-8px deep at the median and up
    // to 38px at p90. All of that fell on the "sky" side of the measurement, so the profile
    // stops short of the hair the eye actually sees, and the real fringe showed above the
    // letters at the poses where the head faces the camera.
    //
    // Re-measured with the threshold at 45, which includes the fringe, the exposed hair is:
    //     scale 1.00   f60 1.4px (p90 3.5)   f70 4.0 (18.6)   f80 5.0 (23.0)
    //     scale 1.15   f60 0.7 (0.0)         f70 3.4 (15.1)   f80 4.1 (19.5)
    //     scale 1.30   f60 0.5 (0.0)         f70 2.7 (11.2)   f80 3.4 (15.9)
    // A bigger push is only safe because silhouette.js now holds a root back when it would
    // leave the body — before that, 1.3 would have put roots in the sky at other poses.
    crestOffsetScale: 1.3,
    // How far back into the band a root may be set, as a fraction of its own depth:
    // each root keeps a `crestK` in [1 - spread, 1]. 0 lays every root on one line
    // out at the silhouette, which covers the edge and leaves the band behind it
    // bare. Hair does not grow from a line.
    rootBandSpread: 0.45,

    // Extra length variation per zone of the crest, on top of the anatomical profile
    // in `lengthProfile`. Sampled by u, applied as the root's `lenScale`. The point
    // is the LOWER third: a mane's bottom edge is ragged, and an even edge there is
    // the clearest tell that lengths came from one formula. The profile still rules —
    // this only wobbles it.
    lengthJitterByU: [
      0.1, 0.1, 0.117, 0.12, 0.134, 0.14, 0.151, 0.178, 0.215, 0.252, 0.285, 0.297, 0.277,
      0.24,
    ],

    // Per-strand wind gain range. A few strands visibly looser than their neighbours
    // is what stops a mane reading as one rigid sheet in motion.
    windGain: [0.82, 1.34],

    // Sideways fall. Signed: negative is the near side, the way this mane hangs.
    // `cross` is the share of strands that go the OTHER way — real manes always have
    // some hair crossing back over the crest, and it is what breaks the curtain read
    // at the top edge.
    drape: [-1.0, -0.45],
    drapeCross: 0.16,
    drapeCrossRange: [0.25, 0.6],
    // WHERE ALONG THE TRACKED CURVE HAIR ACTUALLY GROWS. The curve does not stop at
    // the poll: it carries on down the forehead to the brow, because that is what was
    // convenient to track. Rooting strands on that stretch put a horizontal row of
    // letters across the brow — a banner, not hair, since no hair grows out of the
    // middle of a forehead. The forelock starts BETWEEN THE EARS, which on this track
    // is u≈0.055, and the whorl just behind it is what throws it forward over the
    // face. The far end stays at 1: there the crest runs into the withers and the
    // length profile has already taken the strands down to a third.
    rootURange: [0.055, 1.0],

    // ----- THE FORELOCK, AND THE PARTING IT IMPLIES -------------------------
    // A mane has a parting. Behind it the hair sweeps back along the neck; in front of
    // it, between the ears, the forelock breaks FORWARD and falls over the forehead.
    // Every strand on this piece used to lean backwards, which is why the horse read as
    // having no forelock at all: the crest tangent was only ever used in one direction.
    //
    // In front of `untilU` three things change, and they have to change together or the
    // hair leaves forward and then gets dragged back:
    //   - the crest tangent is REVERSED, so the launch direction points at the face;
    //   - `flow` is taken from here rather than from rootFlowByU, which deliberately
    //     suppresses the front (it was written when that tangent pointed the wrong way);
    //   - `drape` goes POSITIVE and above 1, because the global drapeX (-0.012) pulls
    //     the whole piece toward the near side every frame, and the forelock's own
    //     lateral force (drapeSpread * drape) is what has to beat it.
    //
    // `untilU` is the parting itself. It sits just behind whorl.centerU on purpose: the
    // whorl IS the place where real hair changes direction, so the swirl lands on the
    // division rather than next to it.
    forelock: {
      enabled: true,
      untilU: 0.16,
      flow: 0.8,
      // Above 1 on purpose. `drape` is a signed MULTIPLIER, not a value clamped to
      // -1..+1: it feeds both the resting arc and the per-strand lateral force
      // (drapeSpread * drape), and the forelock has to beat gravity with it. At 0.145,
      // gravity is roughly nine times the lateral force a drape of 1 can muster, so the
      // strand hangs about 6 degrees off vertical and reads as not going anywhere.
      //
      // Measured, mean horizontal travel from root to tip over 24 samples across 3s
      // (positive = toward the face):
      //     drape 1.3  +24px      drape 5.0  +50px
      //     drape 2.5  +33px      drape 7.0  +65px
      //     drape 3.5  +37px
      // WHERE THIS STOPS BEING A PARAMETER PROBLEM. At the poses where the head turns
      // toward the camera the forelock hangs in the air beside the ear instead of over the
      // forehead, and nothing in this block fixes it. Measured as the share of forelock
      // characters falling over the sky:
      //     drape [4.2,5.8]  f30 31.8%  f60 69.0%
      //     drape [3.2,4.4]  f30 15.5%  f60 64.3%
      //     drape [2.4,3.4]  f30 11.6%  f60 63.6%
      //     flow 0.8 -> 0.15 (drape fixed)  f60 67.4% -> 66.7%
      // Halving the drape and killing the flow leave frame 60 where it was, because the
      // hair is not leaving in the wrong direction — it is being BORN in the wrong place.
      // Measured per keyframe, the depth of the curve's front point inside the head:
      // 20-32px through keyframes 68..100, but only 0-8px at keyframes 0, 4, 18, 28, 33,
      // 55, 61 and 64. At those the front of the curve sits ON the silhouette, up past the
      // ear rather than down the forehead, so anything rooted there hangs over the sky.
      // The fix is in the tracking (bring points 0-2 down onto the forehead at those
      // keyframes) or in making the outward push read the real silhouette per frame
      // instead of trusting one measured median profile. Not in this number.
      //
      // [3.2, 4.4] is where the measurement leaves it: half the overshoot of [4.2, 5.8]
      // at frame 30, no worse at frame 60, and still +40px of forward travel.
      // Those are MEANS and they matter as means: the same 10 strands swing between -50
      // and +100px within one wind cycle, because windStrength is 0.38 and a forelock
      // strand is only ~120px long. A single reading here is worthless — the first one
      // taken said -74px and sent me looking for a bug that was not there.
      // Weight on the forelock's share of the strands, against the mane's. 1 = even
      // spacing along the whole crest, which gave the forelock its proportional 10 of 84
      // and left the forehead bare at the poses where the head turns to camera — worst at
      // the start of the clip. The total strand count does NOT change: a denser forelock
      // takes those strands from the mane.
      density: 2.6,
      // Moderate now, and only for the RESTING ARC. `drape` also feeds a screen-space x
      // force, and that force is what dragged the forelock into the sky at the poses where
      // the head turns — see `pull` below, which does the aiming instead. Keeping some
      // drape keeps the arc that opens the tuft away from the crest.
      drape: [1.6, 2.4],
      // Force along the CURRENT crest tangent, re-derived every frame in aimForelock().
      // This is the aimed half of the job: 0.09 against a gravity of 0.145, so the tuft
      // travels forward at roughly 30 degrees off vertical, in whatever direction the head
      // is facing at that moment rather than always toward screen +x.
      pull: 0.09,
      // Multiplier on CONFIG.drapeLean for these strands. Negative leans the resting
      // pose forward instead of back. Measured on the resting pose alone, this is what
      // took the tip from -31px (backwards, the global lean winning) to +30..+66px
      // forward — necessary, but not sufficient on its own, because the solver then
      // flattens a pose it disagrees with. It is `drape` above that holds it there.
      lean: -1,
    },

    // ----- FLOW: the direction a hair is BORN in ----------------------------
    // How far the launch direction leans from straight down toward the crest's own
    // tangent. 0 = every strand starts falling immediately, which is the look this
    // rewrite exists to get rid of. 1 = the hair sets off exactly along the crest and
    // only gravity brings it down. The lean is applied to the RESTING pose, so what
    // holds it is bendReturn at the top of the strand — see angleRelax.
    rootFlowStrength: 0.72,
    // And how much of that lean each ZONE takes. The crest is not the only thing the
    // tracked curve describes: at u≈0 it turns down the forehead, and hair there is a
    // FORELOCK — it falls down the face, it does not run across it. Leaning those
    // roots into the local tangent produced a horizontal banner of letters over the
    // brow. So the front takes almost none of the lean and the neck takes all of it.
    rootFlowByU: [
      0.12, 0.203, 0.286, 0.454, 0.638, 0.768, 0.869, 0.938, 0.975, 1.0, 1.0, 1.0, 1.0, 1.0,
    ],
    // Degrees of per-strand scatter on that launch, so the crest is not combed.
    flowJitterDeg: 9,
    // Nothing launches further than this from straight down. The tracked curve turns
    // down the forehead at u≈0, where the tangent points up out of the skull; without
    // the cap those strands start upward and read as spikes.
    flowMaxDeg: 96,

    // THE WHORL. One global swirl near the poll, not a spiral per strand.
    whorl: {
      // Where the centre sits along the crest. 0.12 is just behind the ears, which is
      // where the real hair changes direction on this horse.
      centerU: 0.12,
      // And how far out of the band the centre sits (same units as crestK): slightly
      // proud of the silhouette, so the roots swing AROUND it rather than through it.
      centerK: 1.35,
      // How far along the crest it reaches, in u. Beyond this the crest flow alone.
      radiusU: 0.17,
      // How much of the launch direction it takes at the centre, 0..1.
      strength: 0.62,
      // Falloff shape. Above 1 keeps the swirl tight around the centre instead of
      // smearing a rotation over the whole poll.
      curve: 1.5,
      // Which way round. +1 and -1 are both physical; on this horse +1 sweeps the
      // hair ahead of the centre up over the poll and the hair behind it down the
      // neck, which is the way the real forelock falls.
      spin: 1,
    },

    // Samples in the per-frame crest table, and how hard it is smoothed before the
    // outward push. The push FOLDS on a hand-authored curve — measured across the
    // 121 frames, the unsmoothed offset line put two roots 0.14px apart while others
    // sat 41px apart. 32 passes here take the spacing spread (p95/p05) from 4.3x to
    // 2.6x; past ~40 the curve starts leaving the anatomy behind.
    crestSamples: 128,
    crestSmoothPasses: 32,
    // Samples used for the arc-length walk the roots are spaced along. 400 is what
    // the editor uses on the same curve.
    arcSamples: 400,
    // The root parameterization is the median over every Nth frame of the clip, not
    // frame 0's (see rootUs). 8 costs ~2ms at build and lands within 0.1x of the
    // spread of using all 121.
    arcFrameStride: 8,
  },

  // ----- STRAND SHAPE — anatomy first, then irregularity ---------------------
  //
  // LENGTH BY POSITION ON THE CREST, not by chance. A mane is short at the poll,
  // longest through the upper and middle neck, and shorter again as it runs into the
  // withers. Sampled by each root's u, so this IS maneLengthAtU, multiplying lengthRange.
  //
  // ONE ENTRY PER PEN POINT. The array has 14 stops because the tracking has 14 control
  // points, and that is not decoration: sampleProfile puts entry i at u = i/13, and
  // catmullRomAt puts control point i at exactly the same u. So entry i is the length AT
  // the point labelled `i` in the track editor — which labels from 0, not 1. Editing the
  // mane by pen point is then a direct edit of one number, with no arithmetic:
  //
  //   idx   0     1     2     3     4     5     6     7     8     9    10    11    12    13
  //   u    .000  .077  .154  .231  .308  .385  .462  .538  .615  .692  .769  .846  .923 1.000
  //   px    111   116   128   151   192   296   343   360   348   325   302   273   241   215
  //        \_____ forelock / poll: short _____/      \___ body of the mane ___/  \_ withers _/
  //
  // Points 0-4 are the short ones on purpose: 0 is the brow, 1-2 sit at the ears and 3-4
  // start the crest, so that stretch is the FORELOCK, and a forelock is a short tuft that
  // breaks forward over the face — not mane-length hair. It is also where the whorl acts
  // (maneShape.whorl reaches to u≈0.29), and long strands there swung across the forehead
  // instead of gathering into a tuft. The floor is ~110px rather than shorter because a
  // strand needs enough characters for the neon ramp to be a ramp: 111px over a 16px
  // segment builds 8 particles, and rampSpan 0.55 lands the bright run across 4 of them.
  // Points 5 and 6 stay long. The climb from 0.42 at point 4 to 0.78 at point 5 is steep
  // as a pair of numbers, but there are ~6 strands between two pen points, so on screen
  // it is a gradient of about 18px per strand — the body of the mane keeps its length.
  lengthProfile: [0.14, 0.16, 0.2, 0.28, 0.42, 0.78, 0.94, 1.0, 0.96, 0.88, 0.8, 0.7, 0.59, 0.5],
  lengthRange: [70, 360],
  // Base organic wobble on top of the profile. Deliberately small — the zone-by-zone
  // variation that matters lives in maneShape.lengthJitterByU, so the raggedness is
  // where a mane actually is ragged instead of spread evenly over the whole crest.
  lengthJitter: 0.06,

  // The four knobs that separate a hanging strand from a column of set type. All of
  // these were at their neutral default here, which is why the mane read as 84
  // parallel lines of text: the willow and the fish have used them since they were
  // added, the horse never did.
  curveBias: 0.1, // resting arc sideways, as a fraction of the strand's own length
  maxArcPx: 90, // capped, so the long mid-neck strands don't sweep off the neck
  drapeSpread: 0.022, // holds that arc open against gravity, strongest at the tip
  waverAmp: 0.45, // slow bend along the strand. Half the willow's: hair, not vine
  charJitterX: 0.22, // per-character sideways nudge, in units of one segment
  charSpacingJitter: 0.18, // uneven gaps between characters
  tipScale: 0.72, // glyphs taper toward the loose end
  // Ends scatter instead of stopping on a clean line. Starts at 70% — inside the
  // 65-75% the brief asks for, and above depth.rampSpan (0.55) so the bright part of
  // the neon ramp is finished before characters start dropping out.
  frayFrom: 0.7,
  frayAmount: 0.5,
  // NOT enabled here, unlike the willow and the fish, and for a measured reason.
  // Both of those hang from something that never moves, so their root glyph travels
  // 0px over the loop and reads as a letter pinned to a branch. This mane's roots ride
  // the tracked crest: measured across the 121 frames at a 1440x900 viewport, a root
  // travels a median of 168px of path and gets a median of 62px away from where it
  // started (p90 103px, max 119px). They are not static characters. They are also the
  // OUTERMOST glyphs, the ones covering the real hair edge — hiding them would reopen
  // the silhouette this whole rewrite is about.
  hideRootGlyph: false,

  // Slightly above the shared 0.14, so neighbouring strands travel together enough to
  // read as a shared mass rather than as independent columns.
  cohesion: 0.24,
  // BOTH DELIBERATELY OFF, and this is the interesting part. The mane does need to
  // separate into locks with gaps between them rather than space itself out like a comb,
  // and the obvious lever looked like uneven cohesion — bond some neighbouring pairs
  // hard, leave others slack. Measured on the mid-strand spacing distribution over 84
  // strands, it does not work:
  //     cohesion 0.2, clump 0     p05 2.8  p50 11.3  p95 26.5   spread 9.6x
  //     cohesion 0.5, clump 0.85  p05 2.9  p50 11.5  p95 26.4   spread 9.2x
  //     cohesion 0.32 + pull 0.4  p05 2.8  p50  9.3  p95 22.0   spread 7.9x
  // The first two are the same picture: the cohesion spring targets the distance each
  // pair was BUILT at, so however strongly or unevenly it is applied, it defends the
  // status quo instead of changing it. Adding a real pull does move the mane, but it
  // pulls everything together and makes it MORE even, not clumpier.
  // The lock structure is already there, and it comes from the launch angles, the
  // per-strand drape and the length variation — the 9.6x spread in that first row IS
  // the families-and-gaps structure. Nothing here needed to produce it.
  cohesionClump: 0.0,
  cohesionPull: 0.0,

  // ----- READING THE FRAME (horse/js/silhouette.js) -------------------------
  // The one thing in this piece that is not a static number: a per-frame read of where the
  // horse is, used by the two things whose right answer moves with the head.
  //   1. the outward push, so the median band profile can never put a root in the sky;
  //   2. the forelock's aim, scaled by how much horse there is in the direction it wants
  //      to pull, so it falls instead of flying off at the poses where the crest and the
  //      face disagree.
  // Costs one drawImage + one getImageData of a 160x90 probe per frame.
  silhouette: {
    enabled: true,
    width: 160, // probe resolution; 160x90 is one cell per ~8 screen px at 1440 wide
    // 45, not 62. The horse's crest hair is semi-transparent, so the band just outside the
    // body reads 45..100 — that IS horse, and treating it as sky made the probe pull roots
    // back off the fringe they are supposed to cover. 45 is the top of the measured night
    // sky (25-45), so this is the threshold that separates sky from anything else.
    skyLuma: 45,
    stepPx: 6, // walk stride, about one probe cell
    clampSteps: 4, // how many tries walking a root back toward the anatomy
    pullClearPx: 90, // room ahead that counts as "full strength" for the forelock pull
  },

  // ----- THE CURSOR THROUGH THE MANE ----------------------------------------
  // The willow's effect, on a mane. Same mechanism (shared/js/pointer.js plus the three
  // components in HairSystem.update), different numbers, because the two curtains are
  // not the same shape: the willow's fronds are long and hang in air, this is a short
  // dense band lying on a neck.
  //
  // `radius` is the whole decision. The shared default is 30px — barely one glyph, and
  // measured, a hover you cannot see. Sweeping the cursor across the crest and measuring
  // each particle's displacement RELATIVE TO ITS OWN ROOT (absolute displacement is
  // useless here: the tracked head moves the entire mane every frame):
  //       radius  30   +9px      radius 110  +29px
  //       radius  70  +14px      radius 150   +3px
  // Read those as a trend and not as precision. With windStrength at 0.38 the mane's own
  // churn is 16-38px over the same window, so the noise floor is the same order as the
  // signal — the 150 row measured lower than the 110 one, which cannot be true. What the
  // numbers do settle is that 30 is too small and that around 100 the parting is clearly
  // visible, which the screenshots agree with.
  //
  // `displace` is what makes it feel physical rather than magnetic: it moves POSITIONS
  // out of the radius, which the solver then relaxes, instead of fighting the length
  // constraints with a force. See the long note in shared/js/config.js.
  pointer: {
    radius: 100,
    falloff: 1.8,
    push: 0.6,
    drag: 0.18,
    displace: 0.5,
    decay: 0.82,
  },

  // ----- PHYSICS — heavier and draggier than the shared defaults -------------
  // Four numbers that used to be inherited and are now the horse's own, tuned live
  // against the footage. Read them together, because they fight each other:
  //   gravity   2.3x the shared 0.062. A mane is heavy hair lying on a neck, not a
  //             liana hanging in air, so it drops rather than drifts.
  //   damping   0.83 against 0.9: more drag, which is what stops that heavier pull
  //             turning into swinging. Heavy AND loose reads as cloth, not hair.
  //   iterations 7 rather than 6 — one more relaxation pass, because a heavier strand
  //             stretches its segments more per frame.
  //   windStrength 0.38 against 0.16. With gravity this high a 0.16 breeze does not
  //             show at all; the two have to go up together or the mane looks dead.
  gravity: 0.145,
  damping: 0.83,
  iterations: 7,
  windStrength: 0.38,

  // ----- LAUNCH, THEN FALL ---------------------------------------------------
  // Each root is handed a growth direction (see rootAngle in main.js). This is the
  // fraction of the strand over which that direction gives way to straight down: the
  // hair leaves the crest along the surface, and by a fifth of the way down it is
  // falling. Below 0.15 the launch reads as a kink; above ~0.3 the strands start
  // travelling sideways far enough to leave the neck.
  angleRelax: 0.2,
  angleRelaxCurve: 1.6, // holds the launch direction over the first characters
  // The stiff root has to hold that launch against gravity, so it is gripped harder
  // than any other piece grips (0.012 in the willow) and over one more particle —
  // then handed over fast. Measured directions at the top of a strand are in the
  // report; the point is a gradient, not a hinge.
  bendReturn: 0.022,
  bendReturnCurve: 2.0,
  rootStiffness: 4,

  // Over the first fifth of every strand the characters are bigger and packed
  // tighter, so the crest reads as one dense mass of code instead of the tops of 84
  // separate columns with neck showing between them.
  rootVolume: {
    span: 0.22,
    scale: 1.22,
    spacing: 0.78,
    curve: 1.4,
  },

  // x-range (fraction of photo width) where the mane crest line lives; static
  // mode samples roots from the bright line inside this band.
  rootXRange: [0.305, 0.63],

  // ----- COLLISION / ROOT BAND (static mode) -------------------------------
  collisionCell: 7, // grid cell size in css px (smaller = finer, slower)
  // Covers the white line baked into the photo with a blurred strip of the photo
  // itself, so the line dissolves and only the strands are left over it. Static
  // mode only: the video has no baked line, and there bgImage is null so the
  // root band self-disables.
  rootBand: true,

  // ----- ALIGNMENT (mask → photo) ------------------------------------------
  // Roots are sampled straight from the photo, so they need no alignment.
  align: { offsetX: 0.0, offsetY: 0.0, scaleX: 1.0, scaleY: 1.0 },
  // The collision mask does: its silhouette covers more area, so the aspect
  // mismatch with the photo shows up more than it does on the roots.
  maskAlign: { offsetX: -0.083, offsetY: -0.02, scaleX: 0.96, scaleY: 1.04 },

  // ----- LOOP CONVERGENCE (retired) ---------------------------------------
  // Used to drag the free particles back toward their start pose in the tail of
  // the clip so the loop wouldn't jump. It fought the moving roots and is now
  // off via systems.loopConverge. Values kept only so the switch still means
  // something if it is ever turned back on.
  loopConverge: 0.06,
  loopConvergeFrom: 0.8,

  // ----- TRACKING SOURCE (what playback runs on) ---------------------------
  // The file exported from the track editor. When it loads and validates, the
  // mane roots ride ITS 14-point curve. When it doesn't, the legacy 5-point
  // keyframes in tracking.js are used instead and a warning is logged.
  trackingSource: {
    url: "horse-tracking.json",
    enabled: true, // false forces the legacy 5-point keyframes
    // Warn when the last frame's pose is further than this from frame 0's,
    // because the clip loops and the mane would visibly snap.
    loopGapWarnPx: 12,
  },

  // ----- COLLISION PRIMITIVES ----------------------------------------------
  // LEGACY path, from the 5 named points. Radii are fractions of the cover's
  // smaller side. Only used when there is no tracking file.
  primitives: {
    show: true, // draw them in calibration mode
    skullRadius: 0.09,
    neckRadius: 0.085,
    bodyOffset: 0.05,
  },

  // Primitives built by walking the edited 14-point curve. Only consulted if
  // systems.collision is on — it is OFF by default, for a measured reason:
  //
  // The model is "push the curve inward by `offset`, lay capsules of `radius`
  // along it, so the capsule surface lands back on the birth line". That only
  // works if the curve is smooth relative to the offset. A hand-authored curve
  // is not: on this track the local radius of curvature dips to ~7px against a
  // ~40px offset, so the offset curve folds through its own centre of curvature.
  // Sweeping smoothPasses x segments across 14 frames and 5 viewport sizes, the
  // closest the offset axis ever comes to the crest is 0.71 x offset — so a
  // radius equal to the offset would swallow the birth line and fling every
  // strand off the neck.
  //
  // Hence radiusFactor: radius = offset * radiusFactor, kept safely under that
  // measured 0.71. The cost is that strands sink ~0.4 x offset into the neck
  // before they collide. Doing this properly needs a real body mask, or a
  // deliberately low-frequency neck spine authored separately from the crest.
  curvePrimitives: {
    segments: 32,
    smoothPasses: 2,
    offset: 0.045,
    radiusFactor: 0.6,
  },

  // ----- KEY BINDINGS ------------------------------------------------------
  // Every shortcut lives here. Compared against `event.key.toLowerCase()`.
  keys: {
    calibration: "c",
    staticDebug: "d",
    playPause: " ",
    seekBack: "arrowleft",
    seekForward: "arrowright",
    frameBack: ",",
    frameForward: ".",
    trackEditor: "e",
    controls: "t", // show/hide the ?controls panel. Free in all three pieces.
    addKeyframe: "k",
    deleteKeyframe: ["backspace", "delete"],
    prevKeyframe: "j",
    nextKeyframe: "l",
  },

  // ----- CALIBRATION -------------------------------------------------------
  calibration: {
    // While a tool is open, CONFIG.systems is replaced by this block, so the only
    // thing on screen is the video plus the overlay. Restored on the way out.
    systems: {
      renderHair: false,
      gravity: false,
      wind: false,
      collision: false,
      cohesion: false,
      bendReturn: false,
      loopConverge: false,
      pointerInteraction: false,
      glow: false,
    },
    seekCoarse: 0.25, // seconds moved by ← / → (fine step is 1 / video.fps)
    // Where inside a frame to land when stepping, as a fraction of one frame.
    // Two conventions have to agree here:
    //   the browser  — frame f occupies [f/fps, (f+1)/fps)
    //   frameIndexAt — round(t*fps), so f's bucket is ((f-0.5)/fps, (f+0.5)/fps]
    // Their overlap is [f/fps, (f+0.5)/fps]. Sitting a quarter-frame in is clear
    // of the boundary (no float rounding to f-1) and still reads back as f.
    frameSeekBias: 0.25,
    splineSamples: 60,
    pointRadius: 5,
    rootDotRadius: 2,
    showRootDots: true,
    labelFont: '12px ui-monospace, "SF Mono", Menlo, monospace',
    colors: {
      spline: "rgba(0, 255, 120, 0.9)",
      point: "#00ff66",
      label: "#aaffcc",
      rootDot: "rgba(0, 255, 120, 0.55)",
      primitive: "rgba(0, 200, 255, 0.8)",
      hudBg: "rgba(0, 0, 0, 0.6)",
      hudKey: "#00ff66",
      hudText: "#cfe",
    },
    hud: { x: 12, y: 12, width: 330, lineHeight: 17, padding: 10, font: '13px ui-monospace, "SF Mono", Menlo, monospace' },
  },

  // ----- TRACK EDITOR (?trackEditor, or the "e" key) -----------------------
  // A 14-point curve edited by hand, frame by frame, with keyframes stored per
  // frame number and smoothstep interpolation in between.
  trackEditor: {
    pointCount: 14, // fixed: points are never added or removed while editing
    storageKey: "horse-mane-tracking-v1",
    exportFilename: "horse-tracking.json",
    exportDecimals: 6,
    arcLengthSamples: 400,
    splineSamples: 120,
    hitRadius: 14, // px grab radius — deliberately larger than the dot
    pointRadius: 5,
    selectedRadius: 7,
    labelOffset: 9,
    saveDebounceMs: 200,
    hudWidth: 430,
    labelFont: '11px ui-monospace, "SF Mono", Menlo, monospace',
    colors: {
      spline: "rgba(0, 255, 120, 0.95)",
      hull: "rgba(0, 255, 120, 0.28)",
      point: "#0f8",
      pointStroke: "rgba(0, 0, 0, 0.55)",
      selected: "#fff34d",
      label: "#aaffcc",
      keyframePoint: "#ff2fae",
    },
  },
});

export { CONFIG, AUTHORED_SYSTEMS } from "../../shared/js/config.js";
