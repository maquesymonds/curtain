// ============================================================================
//  AMBIENT — the bed that runs under the whole exhibition, for as long as the
//  page is open.
//
//  WHY THIS LIVES IN THE SHELL AND NOT IN A PIECE
//  Each piece is an iframe with its own document, its own module scope and its
//  own AudioContext. A bed started inside a piece would therefore be a different
//  bed per piece, each at its own position in the loop, and switching pieces
//  would jump the recording — which is the one thing a continuous bed must never
//  do. So the shell owns it: one instance, started once, never interrupted by a
//  scene change. shared/js/interactionSound.js stays what it is, the sound of
//  TOUCHING a curtain, and the two do not know about each other.
//
//  Opened standalone (http://localhost:8000/horse/) there is no shell, so there
//  is no bed — the same arrangement stage.js already has for the show/hide
//  handshake. That is the development path, not the piece.
//
//  WHY 15.125 SECONDS
//  horse/js/config.js declares the clip as 121 frames at 24 fps and makes the
//  wind field periodic over exactly that, so the mane does not jump when the
//  video wraps. shared/audio/ambient.wav is built to THREE of those, 15.125 s,
//  for the same reason applied to sound: a period that is an exact multiple of
//  the picture's holds a fixed relationship to it for as long as the page lives.
//  Any other length drifts against the 5 s loop, and a bed that drifts is a bed
//  you eventually start hearing as a separate thing.
//
//  Note what this does NOT claim: the two are not phase-LOCKED. A <video loop>
//  resets currentTime every 5.0416667 s, so there is no way to know which of the
//  three turns the bed should be on, and waiting for one to align would mean up
//  to five seconds of silence after the visitor's first click. Commensurate
//  periods are what was asked for and what matters: the relationship is constant
//  rather than sliding.
//
//  THE SAME AUTOPLAY RULE APPLIES. A browser will not run an AudioContext until
//  the document has had a real press, and moving the pointer is not one. So the
//  bed, like the curtain, is silent until the first click or key — which is what
//  the "click for sound" line in index.html is there to say.
// ============================================================================

const SRC = new URL("../audio/ambient.wav", import.meta.url).href;

// Length of shared/audio/ambient.wav, and the reason for it. Kept here as a
// statement of intent: if the clip is ever recut, build-ambient.py and this
// number both have to move.
export const HORSE_LOOP = 121 / 24; // 5.0416667 s
export const LOOPS = 3; // -> 15.125 s

export const AMBIENT = {
  enabled: true,
  // The file is normalised to -33 dB rms (plain, stereo — see build-ambient.py
  // for why not K-weighted), with a 28.6 dB crest factor: a quiet average with
  // loud snow transients, peaking at 0.60 in the file itself. At 0.85 the bed
  // averages about -34 dB and peaks near -5.4 dBFS, which is roughly 12 dB under
  // the curtain's -22 dB while it is being brushed — present on its own, clearly
  // behind whatever the visitor is doing.
  //
  // Not limited on purpose. A compressor here would flatten the gust, which is
  // the part of the recording worth keeping. The cost is that this and the
  // curtain run in SEPARATE AudioContexts (this one in the shell, that one in
  // the piece's iframe) so nothing sums them: if their peaks ever land on the
  // same sample the total can pass 0 dBFS for a sample or two. Inaudible, and
  // cheaper than squashing the one event the bed is here for.
  //
  // Turn it by ear — window.ambient.AMBIENT.level = 1.2 while it is playing.
  // Values above 1 are fine; the file's own peak leaves room to about 1.5.
  level: 0.85,
  // Slow, because it starts on a click the visitor made for some other reason
  // (turning a page, opening the panel) and a bed that snaps in announces
  // itself. Two seconds and they simply find it already there.
  fadeIn: 2.0,
  fadeOut: 0.6,
};

let ctx = null;
let gain = null;
let src = null;
let meter = null;
let meterBuf = null;
let buffer = null;
let bytes = null;
let started = false;

// Fetched at module load: no context is needed to hold an ArrayBuffer, and doing
// it now means the first press only has to resume, not also wait for 1.4 MB.
const fetched = fetch(SRC)
  .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status} ${SRC}`))))
  .then((b) => {
    bytes = b;
  })
  .catch((e) => console.warn("[ambient] sin cama de sonido:", e.message));

function build() {
  gain = ctx.createGain();
  gain.gain.value = 0;
  // A meter between the gain and the output, read only when someone asks for it,
  // so it costs nothing while idle. "ctx.state === running" says the context is
  // allowed to play; only this says something is actually coming out — the
  // distinction that matters when checking a bed nobody is supposed to notice.
  meter = ctx.createAnalyser();
  meter.fftSize = 512;
  meterBuf = new Float32Array(meter.fftSize);
  gain.connect(meter);
  meter.connect(ctx.destination);

  src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  // No loopStart/loopEnd: the file IS the loop, to the sample. 363000 frames at
  // 24 kHz = 15.125000 s, and both ends fade to true zero, so the wrap has a
  // measured discontinuity of exactly 0.
  src.connect(gain);
  src.start(0);
  started = true;
}

function ensure() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC({ latencyHint: "playback" }); // a bed, not an instrument
  fetched.then(() => {
    if (!bytes || !ctx) return;
    ctx.decodeAudioData(bytes.slice(0)).then(
      (b) => {
        buffer = b;
        if (ctx.state === "running") ramp();
      },
      (e) => console.warn("[ambient] no pude decodificar:", e)
    );
  });
}

function ramp() {
  if (!buffer || !AMBIENT.enabled) return;
  if (!started) build();
  const now = ctx.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(AMBIENT.level, now + AMBIENT.fadeIn);
}

let lastResume = -Infinity;
function wake() {
  ensure();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    const t = performance.now();
    // resume() rejects while the document has had no press, and this is wired to
    // events that fire whether or not one has; without the throttle that is a
    // rejected promise on every pointermove.
    if (t - lastResume < 400) return;
    lastResume = t;
    ctx.resume().then(ramp, () => {});
  } else if (ctx.state === "running") {
    ramp();
  }
}

// Every event that counts as an activation, plus the harmless aliases: a missed
// first press costs the visitor the bed for as long as they do not press again.
for (const e of ["pointerdown", "pointerup", "mousedown", "click", "keydown", "touchstart", "touchend", "wheel"]) {
  window.addEventListener(e, wake, { passive: true, capture: true });
}
// A pointermove cannot grant activation, but it can catch the case where one was
// granted before this module was listening.
window.addEventListener("pointermove", wake, { passive: true });

// AND A RETRY, which is the one that actually does the work here.
//
// Listening on this window is not enough, and measured, it caught nothing: a
// piece fills the viewport as an iframe with pointer-events:auto, so the
// visitor's first click lands inside ANOTHER DOCUMENT and the shell never sees
// the event. (The same reason the arrow keys stop reaching the shell once a
// piece has focus.) What does happen is that user activation propagates to
// ancestor documents, so by then this document is allowed to start audio — it
// simply has no event to tell it so.
//
// Hence polling: ask every half second, stop the moment it works. Half a second
// of delay disappears inside a two second fade-in.
const retry = setInterval(() => {
  if (ctx && ctx.state === "running") {
    clearInterval(retry);
    ramp();
    return;
  }
  lastResume = -Infinity; // the throttle guards event storms, not this
  wake();
}, 500);

document.addEventListener("visibilitychange", () => {
  if (!ctx || !gain) return;
  const now = ctx.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  if (document.hidden) {
    // Let go rather than keeping a bed running behind another tab. The source
    // keeps playing, so the loop stays where it was and coming back is a fade
    // rather than a restart.
    gain.gain.linearRampToValueAtTime(0, now + AMBIENT.fadeOut);
  } else if (AMBIENT.enabled) {
    gain.gain.linearRampToValueAtTime(AMBIENT.level, now + AMBIENT.fadeIn);
  }
});

// Built now, suspended, so the press only has to resume it.
ensure();

export function setAmbientEnabled(on) {
  AMBIENT.enabled = !!on;
  if (!ctx || !gain) return;
  const now = ctx.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(AMBIENT.enabled ? AMBIENT.level : 0, now + (AMBIENT.enabled ? AMBIENT.fadeIn : AMBIENT.fadeOut));
}

// Whether the bed is actually sounding. index.html asks this to decide when the
// "click for sound" line has done its job.
export function ambientRunning() {
  return !!(ctx && ctx.state === "running" && started);
}

// Output right now: rms and peak in dBFS, plus where the loop head is. `null`
// until there is something to measure.
export function ambientLevel() {
  if (!meter || !ctx) return null;
  meter.getFloatTimeDomainData(meterBuf);
  let ms = 0;
  let pk = 0;
  for (let i = 0; i < meterBuf.length; i++) {
    const v = meterBuf[i];
    ms += v * v;
    const a = Math.abs(v);
    if (a > pk) pk = a;
  }
  const rms = Math.sqrt(ms / meterBuf.length);
  return {
    rmsDb: rms > 0 ? +(20 * Math.log10(rms)).toFixed(1) : null,
    peak: +pk.toFixed(4),
    gain: +gain.gain.value.toFixed(3),
    // Where in the 15.125 s loop the bed is, so it can be lined up against the
    // clip by eye if that is ever wanted.
    loopAt: buffer ? +(ctx.currentTime % buffer.duration).toFixed(3) : null,
    loopLen: buffer ? +buffer.duration.toFixed(6) : null,
  };
}

if (typeof window !== "undefined") {
  window.ambient = { AMBIENT, setAmbientEnabled, ambientRunning, ambientLevel, state: () => (ctx ? ctx.state : "none") };
}
