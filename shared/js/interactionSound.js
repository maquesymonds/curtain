// ============================================================================
//  INTERACTION SOUND — the curtain as ONE granular instrument, played by the
//  cursor. Shared by all three pieces, because all three are the same gesture:
//  a hand dragged through a hanging mass of glyphs.
//
//  ---------------------------------------------------------------------------
//  WHAT THIS REPLACED, AND WHY
//  ---------------------------------------------------------------------------
//  The previous version picked one of the five whimsical*.wav clips at random
//  on contact and chained more of them until contact ended. Measured, that
//  could not have worked, for three reasons that are properties of the clips
//  and not of the code:
//
//      clip          RMS      centroid   attack to 50%   onsets
//      whimsical    -15.4 dB   934 Hz        156 ms        56
//      whimsical1   -31.8 dB   431 Hz        304 ms        11
//      whimsical2   -32.1 dB   860 Hz        335 ms        12
//      whimsical3   -27.4 dB  1052 Hz        191 ms        15
//      whimsical4   -30.4 dB  2090 Hz        190 ms        13
//
//    1. 17 dB of level spread. Chained at random, one clip blares and the next
//       is inaudible. On its own that reads as several unrelated sounds.
//    2. No attack. Every clip needs 156-335 ms to reach half its level and
//       385-1688 ms to peak. A hover is often shorter than that, so the sound
//       arrived after the hand had already left — there was no audible link
//       between moving and hearing.
//    3. They are phrases, not sounds. 11 to 56 onsets each, at a fixed internal
//       tempo of roughly 70-90 ms. Triggering one is not playing the curtain;
//       it is starting a tape that happens to run while you touch. Two clips'
//       internal tempos never agree with each other or with a hand.
//
//  What was NOT wrong: the material. All five are the same instrument in the
//  same key — the combined chroma is C, Db, Eb, F, G, Ab, which is A flat major
//  missing only its Bb, and Ab reads as the tonic at 1.00 in three of the five.
//  whimsical2 (F5/G5/Ab5) and whimsical4 (F6/G6/Ab6) are literally the same
//  chord an octave apart. So the clips were never five sounds; they were one
//  instrument recorded at several registers and several volumes.
//
//  ---------------------------------------------------------------------------
//  THE DESIGN
//  ---------------------------------------------------------------------------
//  Three layers over a SINGLE source (shared/audio/mane.wav, built by
//  shared/audio/build-mane-instrument.py, where the level and register faults
//  above are corrected once and for all):
//
//    BED     one looping buffer, always the same, always at rate 1.0. Its level
//            and its lowpass cutoff follow the gesture. This layer is the glue:
//            because it never changes identity, everything else is heard as
//            detail ON an instrument rather than as another sound.
//    GRAINS  one 300 ms slice per stretch of curtain crossed, 4 ms attack. This
//            is the causal layer — the one that makes moving and hearing the
//            same event. Density and brightness follow how fast you move.
//    ACCENT  a long resonance, only on a big gesture, on a cooldown. Rare by
//            construction, so it stays an event and never becomes texture.
//
//  The rule that keeps it coherent: RANDOMNESS LIVES IN MICRO-PARAMETERS ONLY —
//  which slot, a few cents of detune, stereo placement, a rare neighbouring
//  step. Never in "which sound". The old version randomised the instrument,
//  which is the one thing that cannot be made to cohere.
//
//  ---------------------------------------------------------------------------
//  WHAT THE GESTURE CONTROLS
//  ---------------------------------------------------------------------------
//  All of it comes from HairSystem.contact (see hairSystem.js), which measures
//  the touch instead of reducing it to a boolean:
//
//    weight  -> thickness -> bed level, grain density, grain level
//               How much curtain is really being displaced. Brushing three
//               glyphs and sweeping the whole mane no longer sound alike.
//    speed   -> bed cutoff, grain density, grain level
//               Brushing anything faster crosses more filaments per second and
//               excites them harder: denser and brighter. That is physically
//               true of hair, and it is the mapping that makes the curtain feel
//               like a material rather than a trigger.
//    u       -> which step of the ladder a grain takes
//               Position ALONG THE CURTAIN, so the mane is playable: sweeping
//               it walks up the ladder and gives a real arpeggio, played by the
//               hand. Sweeping back walks down.
//    nx      -> stereo placement
//
//  Note what is NOT mapped: screen height. Which note a grain takes depends on
//  WHICH PART OF THE CURTAIN it is, never on where that part happens to fall on
//  screen — the same discipline CLAUDE.md's REGLA 1 imposes on the highlights,
//  and for the same reason. The horse's head crosses the frame; a mapping keyed
//  to screen position would make one lock of hair change note as the animal
//  walks.
//
//  ---------------------------------------------------------------------------
//  THE LADDER
//  ---------------------------------------------------------------------------
//  Every grain slot in mane.wav is register-aligned so its Ab partial sits on
//  Ab5 (measured: the six slots land between -2 and +8 cents of it, a 10 cent
//  spread, inaudible). So one playbackRate means one interval for every slot,
//  which is what lets six slices behave as a single sampled instrument.
//
//  The rates are not a chromatic scale. The slots are CHORDS, and transposing a
//  chord by an arbitrary semitone count moves it off the key. Fourths, fifths
//  and octaves are the intervals under which an Ab-major chord stays in Ab
//  major, so the ladder is built only from those — and as exact small-integer
//  ratios, which also means the least resampling damage:
//
//      0.250 = 1/4    Ab3        1.000 = 1/1    Ab5
//      0.333 = 1/3    Db4        1.333 = 4/3    Db6
//      0.375 = 3/8    Eb4        1.500 = 3/2    Eb6
//      0.500 = 1/2    Ab4
//      0.667 = 2/3    Db5
//      0.750 = 3/4    Eb5
//
//  Nine steps, Ab3 to Eb6, 2.6 octaves, every one of them diatonic to Ab major.
//  Sweeping the curtain therefore plays Ab-Db-Eb-Ab-Db-Eb-Ab-Db-Eb: a quartal
//  ladder, which is the harp-glissando sound, and which cannot go out of key
//  however fast or erratically it is played.
// ============================================================================

const SHEET_URL = new URL("../audio/mane.wav", import.meta.url).href;

// Layout of shared/audio/mane.wav, in seconds. MIRRORS the constants at the top
// of shared/audio/build-mane-instrument.py — change one and you must change the
// other, or grains will play across each other's slot boundaries.
const SHEET = {
  grainOffset: 0.0,
  grainDur: 0.3,
  grainSlots: 6,
  accentOffset: 1.8,
  accentDur: 1.5,
  bedOffset: 3.3,
  bedDur: 2.6,
};

// Exact ratios, not 2**(n/12): see THE LADDER above.
const LADDER = [1 / 4, 1 / 3, 3 / 8, 1 / 2, 2 / 3, 3 / 4, 1, 4 / 3, 3 / 2];

// Every random choice in this file goes through `rnd`, never Math.random
// directly, so renderPreview() can substitute a seeded generator and get the
// same output twice. An instrument whose test is a different sound every run
// cannot be regression-tested at all.
let rnd = Math.random;

// Tuning. Exported, and mirrored on window.maneSound, so this can be calibrated
// BY EAR while hovering the curtain — which is the only way to calibrate it.
export const SOUND = {
  enabled: true,
  master: 0.9,
  // Per-frame output metering, off by default because it copies the analyser's
  // window every frame. Turn it on (maneSound.meter = true) to read real output
  // level out of window.maneStats — the only way to check level in a headless
  // browser, which has no audio device to listen to.
  meter: false,

  // What counts as a FULL handful of curtain, in HairSystem.contact.weight units
  // (the sum of falloff × along-strand depth over every hit particle).
  //
  // THIS IS PER PIECE, and not by preference — measured. Driving each piece with
  // synthetic sweeps at three speeds and reading window.maneStats, the weight a
  // brisk 16 px/frame brush produces is:
  //
  //      piece    p50    p90    p99    peak   particles in radius
  //      horse    19.0    32     38      37    422
  //      willow  152.2   256    304     294   3832
  //      fish      5.7    22.6    32      34    431
  //
  //  An order of magnitude between horse and willow, because weight is a SUM and
  //  the willow's fronds put nine times as many particles inside the same radius.
  //  One shared number would leave the willow pinned at full intensity with no
  //  dynamics at all and the fish nearly silent. Each piece sets its own via
  //  configureSound() — see the call at the top of its main.js.
  //
  //  The default is the horse's: brisk p50 lands at 0.63, a slow brush at 0.19,
  //  and digging into the densest part of the mane at 1.0 — the gesture spends
  //  the whole range instead of living at one end of it.
  weightFull: 30,

  bed: {
    level: 0.5,
    cutMin: 300, // hand resting in the curtain: almost only body
    cutMax: 2300, // hand sweeping: the friction opens up
    // The SAME sweep on the grain bus, and it is the one that is actually heard:
    // with the filter only on the bed, measured spectral centroid was 732 Hz for
    // a motionless hand against 355 Hz for a medium sweep — brightness was being
    // decided by which step of the ladder the grains took, not by how fast the
    // hand moved, because the bed carries too little of the energy to steer it.
    grainCutMin: 1100,
    grainCutMax: 7500,
    attack: 0.1, // s, contact -> full. Slower than a grain on purpose: the bed
    release: 0.45, // s. Long enough to read as letting go, not as a cut.
  },

  grain: {
    // The bottom of the gesture, below which there are no grains at all. Not a
    // nicety — without it the release tail never ended. `rateMin` is a floor on
    // DENSITY, and it applied at any intensity above zero, so as intensity decayed
    // exponentially toward the 1e-4 clamp the instrument went on firing 4 grains
    // a second for 2.4 s, each still at half level because the level floor held
    // them up too. Measured: 2 s after the gesture stopped the output was -28.8 dB
    // and still going, and muting the grains was the only thing that silenced it.
    // Fading both density and level to nothing across this gate ends the tail in
    // about 0.7 s plus the last grains' own ring. 0.06 is well under the 0.089 a
    // deliberately gentle brush produces, so nothing audible is gated away.
    gate: 0.06,
    rateMin: 4, // grains/s at the faintest contact
    rateMax: 30, // grains/s at a full-speed sweep. Past ~34 the ear stops
    // hearing separate filaments and starts hearing a buzz.
    level: 0.55,
    attack: 0.004, // s. THE point of the rewrite — 4 ms, not 300.
    detuneCents: 14, // ± , so no two grains are the same pitch to the cent
    panWidth: 0.72,
    stepJitter: 0.2, // chance of taking a neighbouring ladder step, so a slow
    // hover shimmers around a note instead of repeating it dead
    //
    // A grain's slot is 0.3 s of BUFFER, so its wall-clock length is 0.3/rate —
    // 0.2 s at the top of the ladder and 1.2 s at the bottom. Letting a low note
    // ring longer than a high one is right, and this file used to leave it
    // unbounded on exactly that reasoning. Measured, that was wrong: at 30
    // grains/s a 1.2 s grain needs 36 simultaneous voices, the cap was 16, and
    // the rest were silently dropped — which made a flick down the ladder render
    // at -27.3 dB, QUIETER than a slow brush at -24.3, because the hardest
    // gesture was the one starving itself. Capped at 0.6 s the ratio is 2:1
    // instead of 4.8:1, the character survives, and the voice pool holds.
    maxLength: 0.6, // s of wall clock
    release: 0.08, // s, only used when maxLength cuts a grain before the slot's
    // own built-in decay would have brought it to zero
    maxVoices: 24,
  },

  accent: {
    // Measured: at 0.75 the accent WAS the whole release tail. Rendering the
    // scripted gesture with the accent muted dropped the level 2.5 s after
    // contact ended from -20.5 dB to -97 dB — silence — while the brush itself
    // only reads -23.9 dB. The garnish was louder than the instrument and
    // outlasted it by seconds.
    level: 0.34,
    minThickness: 0.5, // both gates must be passed: a big gesture is a lot of
    minSpeed: 0.6, // curtain moved FAST, not either one alone
    cooldown: 1.4, // s
    // Wall-clock, and that is the point. The accent slot is 1.5 s of BUFFER, so
    // at the bottom of the ladder (rate 0.25) it played for six seconds — which
    // is how a rare garnish turned into a drone that never let go. Its length is
    // now set in real time and is the same whatever note it takes.
    tail: 1.5,
    // And it only uses the middle of the ladder. Its slot is already an octave
    // below the grains, so transposing it down two more octaves put a resonance
    // at Ab2: not a highlight, a rumble.
    steps: [3 / 4, 1, 4 / 3],
  },

  // A short stereo delay on the grain bus only. Not reverb-for-atmosphere: a
  // granular layer with no space around it reads as clicks, and this is the
  // cheapest thing that makes the grains sound like they are happening in the
  // same room as each other.
  space: { send: 0.32, time: 0.19, feedback: 0.3, cut: 3000 },

  // Asymmetric smoothing of the gesture itself, before it reaches any audio
  // parameter. Rises fast so a touch is immediate; falls slower so a hand
  // crossing a gap in the curtain does not chop the sound into pieces.
  smooth: { attack: 0.07, release: 0.26 },

  // How speed maps to drive. Below 1 it lifts the slow end: at 0.6, a cursor
  // moving at a fifth of full speed drives the instrument to 0.38 rather than
  // 0.2, so a deliberately gentle brush is quiet but not nearly-silent. What it
  // does NOT do is lift zero — see the note on `target` in step().
  speedCurve: 0.6,
};

// ---------------------------------------------------------------------------
//  STATE
// ---------------------------------------------------------------------------
let ctx = null;
let buffer = null;
let sheetBytes = null; // fetched at module load, decoded once a ctx exists
let nodes = null; // { master, limiter, bedGain, bedFilter, grainBus, ... }
let ready = false;

let intensity = 0; // smoothed 0..1
let lastFrameTime = 0; // ctx.currentTime at the previous notifyContact
let grainDebt = 0; // fractional grains owed, so a low rate still fires
// Live voices, tracked as SCHEDULED END TIMES rather than as a counter kept by
// each source's 'ended' event. The counter version was wrong, and wrong in a way
// that hid itself: 'ended' does not fire while an OfflineAudioContext renders, so
// `voices` only ever went up during a render, and after the first maxVoices
// grains every later one was refused. Measured, a 3 s render fired 24 grains and
// dropped 64. Expiring by time needs no events and behaves the same in both
// kinds of context, which is the only way an offline render can be trusted to
// say anything about the live one.
let voiceEnds = [];
let lastAccent = -1e9;
let lastSlot = -1;
let wasHit = false;
// Held across contact gaps — see the note at the top of step().
let lastU = 0.5;
let lastNx = 0.5;

// ---------------------------------------------------------------------------
//  CALIBRATION READOUT
//
//  `weightFull` and the speed normalisation in hairSystem.js are the two
//  numbers this whole mapping hangs off, and neither can be reasoned about —
//  weight is a sum of falloff × depth over however many particles a piece's
//  radius happens to reach, which differs per piece and per viewport. So they
//  are measured, here, on the real gesture: sweep the curtain and read
//  window.maneStats. Kept in for good, because the numbers have to be re-taken
//  whenever pointer.radius or the strand density changes.
// ---------------------------------------------------------------------------
const STATS = {
  // Never cleared by reset(), unlike `frames`: together with `token` these two
  // answer "is this the same STATS I measured a moment ago, and is it being
  // written to at all" — the question that has to be settled before any other
  // number here means anything.
  lifeFrames: 0,
  token: Math.random().toString(36).slice(2, 8),
  frames: 0,
  hits: 0,
  maxWeight: 0,
  maxCount: 0,
  maxRawSpeed: 0, // contact.speed BEFORE it saturates, so a clipped
  // normalisation is visible instead of reading as a flat 1.0
  // The most recent frame's whole chain, from the raw contact through to the
  // grain rate it produced. The one readout that tells you WHICH link is wrong
  // when the instrument is too quiet or too busy, instead of only that it is.
  last: null,
  outPeak: 0, // output sample peak, when SOUND.meter is on
  outRms: 0, // running mean-square of the output, same condition
  outFrames: 0,
  maxVoices: 0,
  grains: 0,
  dropped: 0, // grains the voice cap refused — if this is not ~0 the
  // instrument is starving itself exactly when the gesture is hardest
  accents: 0,
  // Weight is bucketed LOGARITHMICALLY, four buckets per octave, covering 1 to
  // ~860. Two linear scales were tried first and both saturated on every
  // sample — because weight is a SUM over however many particles the radius
  // reaches, and that is 400 particles on the horse's mane against 3500 in the
  // willow's fronds. The quantity spans more than an order of magnitude BETWEEN
  // PIECES, which is the finding that forced weightFull to be per piece.
  wHist: new Array(40).fill(0),
  sHist: new Array(10).fill(0), // speed, bucketed by 0.1
  reset() {
    this.frames = this.hits = this.maxWeight = this.maxCount = this.maxRawSpeed = 0;
    this.outPeak = this.outRms = this.outFrames = this.maxVoices = 0;
    this.grains = this.dropped = this.accents = 0;
    this.wHist.fill(0);
    this.sHist.fill(0);
  },
  report() {
    // `value` turns a bucket index back into the quantity it stands for, so the
    // two histograms can share this without sharing a scale.
    const pct = (h, value) => {
      const tot = h.reduce((a, b) => a + b, 0) || 1;
      const out = {};
      for (const q of [0.5, 0.9, 0.99]) {
        let acc = 0;
        for (let i = 0; i < h.length; i++) {
          acc += h[i];
          if (acc / tot >= q) {
            out["p" + q * 100] = +value(i).toFixed(2);
            break;
          }
        }
      }
      return out;
    };
    const rms = this.outFrames ? Math.sqrt(this.outRms / this.outFrames) : 0;
    return {
      token: this.token,
      lifeFrames: this.lifeFrames,
      frames: this.frames,
      hits: this.hits,
      maxWeight: +this.maxWeight.toFixed(2),
      maxCount: this.maxCount,
      maxSpeed: +this.maxRawSpeed.toFixed(2),
      weight: pct(this.wHist, (i) => 2 ** (i / 4)),
      speed: pct(this.sHist, (i) => (i + 1) * 0.1),
      // audio side
      ctx: ctx ? ctx.state : "none",
      ready,
      grains: this.grains,
      dropped: this.dropped,
      accents: this.accents,
      maxVoices: this.maxVoices,
      intensity: +intensity.toFixed(3),
      last: this.last,
      outPeak: +this.outPeak.toFixed(4),
      outRmsDb: rms > 0 ? +(20 * Math.log10(rms)).toFixed(1) : null,
    };
  },
};
if (typeof window !== "undefined") window.maneStats = STATS;

function record(contact) {
  STATS.lifeFrames++;
  STATS.frames++;
  if (!contact || !contact.hit) return;
  STATS.hits++;
  if (contact.weight > STATS.maxWeight) STATS.maxWeight = contact.weight;
  if (contact.count > STATS.maxCount) STATS.maxCount = contact.count;
  if (contact.speed > STATS.maxRawSpeed) STATS.maxRawSpeed = contact.speed;
  if (contact.weight > 0)
    STATS.wHist[Math.max(0, Math.min(39, Math.round(4 * Math.log2(contact.weight))))]++;
  STATS.sHist[Math.min(9, Math.floor(contact.speed / 0.1))]++;
}

function meterOutput() {
  if (!SOUND.meter || !nodes || !nodes.meter) return;
  nodes.meter.getFloatTimeDomainData(nodes.meterBuf);
  let ms = 0;
  for (let i = 0; i < nodes.meterBuf.length; i++) {
    const v = nodes.meterBuf[i];
    ms += v * v;
    const a = Math.abs(v);
    if (a > STATS.outPeak) STATS.outPeak = a;
  }
  STATS.outRms += ms / nodes.meterBuf.length;
  STATS.outFrames++;
}

// Fetch immediately — no AudioContext needed to hold an ArrayBuffer, and doing
// it now means the first touch is not also the first network round trip.
const sheetFetch = fetch(SHEET_URL)
  .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status} ${SHEET_URL}`))))
  .then((b) => {
    sheetBytes = b;
  })
  .catch((e) => {
    console.warn("[interactionSound] sheet unavailable, staying silent:", e.message);
  });

// ---------------------------------------------------------------------------
//  GRAPH
//
//      grains -> env -> pan -+-> grainBus -+-> master -> limiter -> out
//                            |             |
//      bed -> bedFilter -----+-------------+
//                                          |
//                            grainBus -> delay <-> feedback -> dlyFilter -^
//
//  The bed deliberately bypasses the delay: it is already a smear, and sending
//  a sustained layer into a feedback delay is how a bed turns into mud.
// ---------------------------------------------------------------------------
function buildGraph() {
  const master = ctx.createGain();
  master.gain.value = SOUND.master;

  // A limiter, not a compressor for character. A dense sweep can put a dozen
  // grains inside 100 ms; without this, density and loudness are the same
  // control and the top of the gesture just clips.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -12;
  limiter.knee.value = 10;
  limiter.ratio.value = 6;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.18;

  const grainBus = ctx.createGain();
  grainBus.gain.value = 1;
  // Ahead of the delay send as well as the dry path, so the repeats inherit the
  // brightness of the gesture that made them instead of staying open when the
  // hand has slowed down.
  const grainFilter = ctx.createBiquadFilter();
  grainFilter.type = "lowpass";
  grainFilter.frequency.value = SOUND.bed.grainCutMin;
  grainFilter.Q.value = 0.7;

  // PING-PONG, not a single delay line. Measured on the first render, the output
  // came back with an L/R correlation of 0.974 to 1.000 — mono in all but name,
  // even though every grain gets its own StereoPanner, because at any instant
  // all the live grains sit at nearly the same pan and the two layers that carry
  // the most energy (bed, delay) were both centred. Alternating the repeats
  // across the stereo field is what actually opens it up, and it costs two extra
  // nodes.
  const dlySend = ctx.createGain();
  dlySend.gain.value = SOUND.space.send;
  const dL = ctx.createDelay(1.0);
  const dR = ctx.createDelay(1.0);
  dL.delayTime.value = SOUND.space.time;
  dR.delayTime.value = SOUND.space.time;
  const fb = ctx.createGain();
  fb.gain.value = SOUND.space.feedback;
  const lpL = ctx.createBiquadFilter();
  const lpR = ctx.createBiquadFilter();
  lpL.type = lpR.type = "lowpass";
  lpL.frequency.value = lpR.frequency.value = SOUND.space.cut;
  const panL = ctx.createStereoPanner();
  const panR = ctx.createStereoPanner();
  panL.pan.value = -0.85;
  panR.pan.value = 0.85;

  // send -> L -> (out left) -> R -> (out right) -> feedback -> L ...
  // Repeats get darker each pass, which is what makes them recede instead of
  // stacking up as more clicks.
  grainBus.connect(grainFilter);
  grainFilter.connect(dlySend);
  dlySend.connect(dL);
  dL.connect(lpL);
  lpL.connect(panL);
  panL.connect(master);
  lpL.connect(dR);
  dR.connect(lpR);
  lpR.connect(panR);
  panR.connect(master);
  lpR.connect(fb);
  fb.connect(dL);
  const dlyFilter = lpL; // kept under the old name for the returned node bag

  const bedFilter = ctx.createBiquadFilter();
  bedFilter.type = "lowpass";
  bedFilter.frequency.value = SOUND.bed.cutMin;
  bedFilter.Q.value = 0.8;
  const bedGain = ctx.createGain();
  bedGain.gain.value = 0;

  // Started once and never stopped. A bed that starts and stops per contact
  // has to fade in from silence at the loop's current phase, which ticks; one
  // that runs forever behind a gain has no transient to hide.
  const bedSrc = ctx.createBufferSource();
  bedSrc.buffer = buffer;
  bedSrc.loop = true;
  bedSrc.loopStart = SHEET.bedOffset;
  bedSrc.loopEnd = SHEET.bedOffset + SHEET.bedDur;
  bedSrc.connect(bedFilter);
  bedFilter.connect(bedGain);
  bedGain.connect(master);
  bedSrc.start(0, SHEET.bedOffset);

  // Post-limiter, so the meter reads what actually leaves the piece.
  const meter = ctx.createAnalyser();
  meter.fftSize = 256;

  grainFilter.connect(master);
  master.connect(limiter);
  limiter.connect(meter);
  meter.connect(ctx.destination);

  return { master, limiter, grainBus, grainFilter, bedGain, bedFilter, bedSrc, dL, dR, fb, dlyFilter, dlySend, meter, meterBuf: new Float32Array(meter.fftSize) };
}

function ensureContext() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC({ latencyHint: "interactive" });
  lastFrameTime = ctx.currentTime;
  sheetFetch.then(() => {
    if (!sheetBytes || !ctx) return;
    // decodeAudioData detaches the ArrayBuffer, so hand it a copy — a second
    // context (a piece reloaded in place) would otherwise decode nothing.
    ctx.decodeAudioData(sheetBytes.slice(0)).then(
      (buf) => {
        buffer = buf;
        nodes = buildGraph();
        ready = true;
      },
      (e) => console.warn("[interactionSound] decode failed:", e)
    );
  });
}

// Chrome grants an AudioContext only on a real activation — a pointerdown, a
// key, a touch. A pointermove does not count, which is exactly the gesture this
// instrument is played with, so the context has to be armed separately from
// being used. Also armed from the PARENT document: the pieces run in iframes in
// the root index.html, sticky activation is per-document, and the arrow keys
// that switch pieces land on the parent.
function armActivation() {
  const wake = () => {
    ensureContext();
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
  };
  const evts = ["pointerdown", "keydown", "touchstart", "wheel"];
  for (const e of evts) window.addEventListener(e, wake, { passive: true, capture: true });
  try {
    if (window.parent && window.parent !== window && window.parent.document) {
      for (const e of evts)
        window.parent.document.addEventListener(e, wake, { passive: true, capture: true });
    }
  } catch {
    // cross-origin parent: nothing to do, the in-frame listeners still work
  }
  // Letting go of the window releases the curtain (see pointer.js); it should
  // release the sound too, rather than leaving a bed ringing in a hidden piece.
  const drop = () => {
    intensity = 0;
    if (nodes) nodes.bedGain.gain.cancelScheduledValues(ctx.currentTime);
  };
  window.addEventListener("blur", drop);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) drop();
  });
}
armActivation();

// ---------------------------------------------------------------------------
//  VOICES
// ---------------------------------------------------------------------------
function pickSlot() {
  let i = Math.floor(rnd() * SHEET.grainSlots);
  if (i === lastSlot) i = (i + 1) % SHEET.grainSlots; // never twice running
  lastSlot = i;
  return i;
}

function ladderStep(u) {
  let i = Math.round(u * (LADDER.length - 1));
  if (rnd() < SOUND.grain.stepJitter) i += rnd() < 0.5 ? -1 : 1;
  return LADDER[Math.max(0, Math.min(LADDER.length - 1, i))];
}

// `now` is passed in rather than read from ctx.currentTime, so the same function
// serves the live loop and an offline render, where currentTime does not advance
// until rendering starts.
function fireGrain(now, u, nx, level) {
  const g = SOUND.grain;
  if (voiceEnds.length) voiceEnds = voiceEnds.filter((t) => t > now);
  if (voiceEnds.length >= g.maxVoices) {
    STATS.dropped++;
    return;
  }
  const slot = pickSlot();
  const cents = (rnd() * 2 - 1) * g.detuneCents;
  const rate = ladderStep(u) * 2 ** (cents / 1200);

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = rate;

  // Wall-clock length, capped — see maxLength above. `dur` goes back into buffer
  // seconds because that is the unit start()'s third argument speaks.
  const wall = Math.min(g.maxLength, SHEET.grainDur / rate);
  const dur = wall * rate;
  const cut = dur < SHEET.grainDur - 1e-6;

  // The slot itself decays to exactly zero (windowed in the build script), so
  // normally this envelope only needs an attack — no release, nothing to time
  // against the buffer's end, and no click either way. A grain cut short by
  // maxLength never reaches that built-in decay, so that one gets a release.
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(level, now + g.attack);
  if (cut) env.gain.setTargetAtTime(0, now + Math.max(g.attack, wall - g.release), g.release / 3);

  const pan = ctx.createStereoPanner();
  pan.pan.value = (nx * 2 - 1) * g.panWidth;

  src.connect(env);
  env.connect(pan);
  pan.connect(nodes.grainBus);

  voiceEnds.push(now + wall);
  STATS.grains++;
  if (voiceEnds.length > STATS.maxVoices) STATS.maxVoices = voiceEnds.length;
  // Still worth wiring: live, it releases the nodes as soon as each grain is
  // done instead of leaving them for the collector. It is no longer what the
  // voice count depends on.
  src.onended = () => {
    src.disconnect();
    env.disconnect();
    pan.disconnect();
  };
  src.start(now, SHEET.grainOffset + slot * SHEET.grainDur, dur);
}

function fireAccent(now, u, level) {
  const a = SOUND.accent;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const steps = a.steps;
  src.playbackRate.value = steps[Math.max(0, Math.min(steps.length - 1, Math.round(u * (steps.length - 1))))];

  const env = ctx.createGain();
  env.gain.setValueAtTime(0, now);
  // 20 ms, not 4: this one is a resonance being set going, not a filament being
  // plucked, and a hard edge on a long tail reads as a different sound again.
  env.gain.linearRampToValueAtTime(level, now + 0.02);
  // The envelope, not the buffer, decides how long this lasts — so the tail is
  // the same length at every step of the ladder. The ramp starts a quarter of a
  // second in so the resonance is heard before it begins to go.
  env.gain.setTargetAtTime(0, now + 0.25, a.tail / 4);
  // Panned by position like a grain, if less widely: the first render came back
  // with the flick act at an L/R correlation of exactly 1.000, because the accent
  // carrying that act was the one voice wired dead centre.
  const pan = ctx.createStereoPanner();
  pan.pan.value = (u * 2 - 1) * 0.4;
  src.connect(env);
  env.connect(pan);
  pan.connect(nodes.master); // dry, past the grain delay: it has its own tail

  src.onended = () => {
    src.disconnect();
    env.disconnect();
    pan.disconnect();
  };
  src.start(now, SHEET.accentOffset, SHEET.accentDur);
  // A hard stop as well as the fade, so nothing can outlive its tail whatever
  // rate it is playing at. By now the envelope is ~50 dB down, so this is
  // inaudible rather than a cut.
  src.stop(now + 0.25 + a.tail);
  STATS.accents++;
  lastAccent = now;
}

// ---------------------------------------------------------------------------
//  PER-FRAME ENTRY POINT
// ---------------------------------------------------------------------------
// Call once per rendered frame with hair.contact. dt is taken from the audio
// clock rather than from the caller's frame delta: the three pieces measure dt
// in different units (frames on the horse, seconds elsewhere) and a grain rate
// in grains-per-second has to be scheduled against the clock the grains
// actually play on.
// ---------------------------------------------------------------------------
//  ONE FRAME OF THE INSTRUMENT
//
//  Split out of notifyContact so that the live loop and renderPreview() drive
//  exactly the same code. `now` and `dt` are arguments, not readings off the
//  clock, which is the whole reason an offline render can test what ships.
// ---------------------------------------------------------------------------
function step(contact, now, dt) {
  const hit = !!(contact && contact.hit);
  // Position is HELD when contact breaks, never zeroed. Two reasons: the
  // release tail keeps firing grains after `contact` has gone null, and on the
  // horse the mane moves out from under a still cursor several times a second
  // (measured: contact flickers on and off every few frames during one smooth
  // gesture), so snapping u to 0 on every gap would retune the curtain to its
  // bottom note mid-brush.
  if (hit) {
    lastU = contact.u;
    lastNx = contact.nx;
  }

  const thickness = hit ? Math.min(1, contact.weight / SOUND.weightFull) : 0;
  const speed = hit ? contact.speed : 0;
  // Thickness sets the ceiling, SPEED DECIDES WHETHER THERE IS A SOUND AT ALL.
  //
  // This was `thickness * (0.34 + 0.66 * speed)` — an offset, so a hand resting
  // in the curtain kept a quiet bed going. That state was deliberate and it was
  // wrong, in the plainest way: measured, a cursor moved onto the mane and then
  // held completely still went on sounding for as long as it was left there —
  // three consecutive 2.5 s windows read -26.1, -25.4 and -26.5 dB, 15 grains
  // apiece, contact on every single frame. Nothing about that reads as hover.
  //
  // A factor instead of an offset, and the physics agrees with the interaction:
  // brushing hair makes noise while the hand TRAVELS. A hand at rest in hair is
  // silent, no matter how much hair it is resting in. Zero speed is now zero
  // sound, and because pointer velocity decays and isPointerMoving() forces it
  // to zero within 110 ms of the last move, stopping is its own release.
  const target = thickness * (speed <= 0 ? 0 : speed ** SOUND.speedCurve);

  const tau = target > intensity ? SOUND.smooth.attack : SOUND.smooth.release;
  intensity += (target - intensity) * (1 - Math.exp(-dt / tau));
  if (intensity < 1e-4) intensity = 0;

  STATS.last = {
    dt: +dt.toFixed(4),
    hit,
    weight: +(+(contact && contact.weight) || 0).toFixed(2),
    thickness: +thickness.toFixed(3),
    speed: +speed.toFixed(3),
    target: +target.toFixed(3),
    intensity: +intensity.toFixed(3),
    u: +lastU.toFixed(3),
    debt: +grainDebt.toFixed(3),
  };

  // ---- bed
  const b = SOUND.bed;
  nodes.bedGain.gain.setTargetAtTime(
    intensity * b.level,
    now,
    (intensity > 0 ? b.attack : b.release) / 3 // setTargetAtTime's constant is
    // 1/3 of the time to ~95%, which is what the numbers above mean
  );
  nodes.bedFilter.frequency.setTargetAtTime(b.cutMin + (b.cutMax - b.cutMin) * speed, now, 0.05);
  nodes.grainFilter.frequency.setTargetAtTime(
    b.grainCutMin + (b.grainCutMax - b.grainCutMin) * speed,
    now,
    0.05
  );

  // ---- grains
  const g = SOUND.grain;
  // Fades in over the bottom of the range rather than switching on, so the gate
  // is a floor on the SOUND and never an audible edge.
  const gate = Math.min(1, intensity / g.gate);
  const rate = intensity > 0 ? (g.rateMin + (g.rateMax - g.rateMin) * intensity) * gate : 0;
  grainDebt += rate * dt;
  // Cap the backlog. Without it a frame drop pays its debt as a burst, which is
  // heard as a stutter exactly when the framerate is already struggling.
  if (grainDebt > 2) grainDebt = 2;
  while (grainDebt >= 1) {
    grainDebt -= 1;
    // Level per grain rises with intensity but not linearly — a soft brush
    // should still be clearly audible, or the whole low end of the gesture is
    // wasted range.
    // The 0.5 floor, not 0.35: with the gesture curve ALSO having a 0.34 floor
    // the two multiplied out to 0.12, and a hand resting in the curtain rendered
    // at -36.9 dB against the brush's -23.9 — technically present, practically
    // inaudible. Both floors are wanted; compounding them was not.
    const lvl = g.level * (0.5 + 0.5 * intensity) * gate * (0.78 + 0.22 * rnd());
    fireGrain(now, lastU, lastNx, lvl);
  }
  // Note that grains keep firing, sparsely, through the release tail: intensity
  // is still decaying, so a few last filaments ring after the hand has gone.
  // That settling is the sound of the curtain coming to rest and it is wanted.

  // ---- accent
  const a = SOUND.accent;
  if (hit && thickness > a.minThickness && speed > a.minSpeed && now - lastAccent > a.cooldown) {
    fireAccent(now, lastU, a.level * thickness);
  }
}

// ---------------------------------------------------------------------------
//  PER-FRAME ENTRY POINT
// ---------------------------------------------------------------------------
// Call once per rendered frame with hair.contact. dt comes from the AUDIO clock
// rather than the caller's frame delta: the three pieces measure dt in different
// units (frames on the horse, seconds elsewhere) and a rate in grains-per-second
// has to be scheduled against the clock the grains actually play on.
export function notifyContact(contact) {
  if (!SOUND.enabled) return;
  const hit = !!(contact && contact.hit);

  // A rising edge is the only place a resume is worth attempting from a move:
  // it costs nothing when the policy has already been satisfied, and it catches
  // the case where activation happened before this module had a context.
  if (hit && !wasHit) {
    ensureContext();
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
  }
  wasHit = hit;
  record(contact); // before the bail-out: calibration must work in a headless
  // browser, which has no audio device and never reaches "running"
  if (!ready || !ctx || ctx.state !== "running") return;

  meterOutput();

  const now = ctx.currentTime;
  let dt = now - lastFrameTime;
  lastFrameTime = now;
  // A piece that was paused, backgrounded, or is mid-scene-swap comes back with
  // a huge dt; letting that through would dump a whole second of grains into
  // one frame.
  if (!(dt > 0) || dt > 0.1) {
    dt = 1 / 60;
    // And a gap that long is a DISCONTINUITY, not a slow frame: the piece was
    // not running, so there is no gesture in progress to carry on from. Measured
    // in the shell, switching pieces with the arrow keys left the outgoing one
    // holding intensity 0.133 frozen — above the grain gate — so returning to it
    // fired a stray grain before the decay caught up. Dropping the state instead
    // means a piece always comes back silent and waits to be touched.
    intensity = 0;
    grainDebt = 0;
  }

  step(contact, now, dt);
}

// ---------------------------------------------------------------------------
//  OFFLINE RENDER
//
//  Renders a scripted gesture through the REAL graph and the REAL step(), into
//  an OfflineAudioContext, and hands back the samples. This exists because the
//  instrument cannot otherwise be checked: a headless browser has no audio
//  device, and "it did not throw" says nothing about whether a sound is at the
//  right level, in the right key, or dense enough to read as one instrument.
//
//    const pcm = await renderPreview({ seconds: 8, gesture: t => ({...}) })
//
//  `gesture(t)` returns a contact object for time t, or null for no contact —
//  the same shape HairSystem.contact has. Module state is saved and restored, so
//  calling this does not disturb a piece that is running.
// ---------------------------------------------------------------------------
export async function renderPreview({ seconds = 8, fps = 60, sampleRate = 44100, gesture, seed = 1 } = {}) {
  await sheetFetch;
  if (!sheetBytes) throw new Error("sample sheet never loaded");

  const saved = { ctx, nodes, buffer, ready, intensity, grainDebt, voiceEnds, lastAccent, lastSlot, lastU, lastNx, rnd };
  // A tiny LCG, so two renders of the same gesture are the same samples and a
  // difference means the instrument changed rather than the dice.
  let st = seed >>> 0;
  rnd = () => ((st = (st * 1664525 + 1013904223) >>> 0) / 4294967296);

  try {
    const off = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
    ctx = off;
    // Always re-decoded from the fetched bytes: an AudioBuffer belongs to the
    // context that decoded it and cannot be handed to another one.
    buffer = await off.decodeAudioData(sheetBytes.slice(0));
    nodes = buildGraph();
    intensity = 0;
    grainDebt = 0;
    voiceEnds = [];
    lastAccent = -1e9;
    lastSlot = -1;

    const dt = 1 / fps;
    for (let i = 0; i < Math.floor(seconds * fps); i++) {
      const t = i * dt;
      step(gesture ? gesture(t) : null, t, dt);
    }
    const rendered = await off.startRendering();
    return {
      sampleRate: rendered.sampleRate,
      length: rendered.length,
      left: rendered.getChannelData(0),
      right: rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : rendered.getChannelData(0),
    };
  } finally {
    ctx = saved.ctx;
    nodes = saved.nodes;
    buffer = saved.buffer;
    ready = saved.ready;
    intensity = saved.intensity;
    grainDebt = saved.grainDebt;
    voiceEnds = saved.voiceEnds;
    lastAccent = saved.lastAccent;
    lastSlot = saved.lastSlot;
    lastU = saved.lastU;
    lastNx = saved.lastNx;
    rnd = saved.rnd;
  }
}


// Backwards-compatible shim for any call site still passing the old boolean.
// It cannot map thickness, position or speed — there is nothing in a boolean to
// map them from — so it plays the instrument at a fixed middling gesture. Real
// call sites should pass hair.contact.
export function notifyPointerHit(hit) {
  notifyContact(hit ? { hit: true, weight: SOUND.weightFull * 0.6, u: 0.5, speed: 0.45, nx: 0.5 } : null);
}

// The visitor-facing on/off, used by horse/js/tune.js. Turning it off also lets
// go of the bed immediately rather than leaving whatever was sounding to hang:
// a mute that takes half a second to arrive reads as broken.
export function setSoundEnabled(on) {
  SOUND.enabled = !!on;
  if (!SOUND.enabled) {
    intensity = 0;
    grainDebt = 0;
    if (nodes && ctx) {
      nodes.bedGain.gain.cancelScheduledValues(ctx.currentTime);
      nodes.bedGain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
    }
  }
}

// Per-piece tuning, called once at a piece's module scope. Shallow-merges one
// level deep, so { grain: { rateMax: 40 } } keeps the rest of `grain` intact.
// A piece MUST set weightFull — see the measured table above for why a shared
// value cannot work.
export function configureSound(patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && SOUND[k] && typeof SOUND[k] === "object") {
      Object.assign(SOUND[k], v);
    } else {
      SOUND[k] = v;
    }
  }
}

// Handy while calibrating by ear: window.maneSound.grain.rateMax = 40, etc.
if (typeof window !== "undefined") window.maneSound = SOUND;
