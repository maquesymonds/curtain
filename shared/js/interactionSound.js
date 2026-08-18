// ============================================================================
//  INTERACTION SOUND — a random sequence of clips, chained for as long as the
//  cursor is touching the curtain, and only that long. Shared by all three
//  pieces so the envelope/sequencing logic lives in one place instead of three.
//
//  Driven by HairSystem.pointerHit (hairSystem.js), which is only true for a
//  frame where the cursor was within reach of at least one particle — not
//  just moving somewhere over the canvas. A piece calls notifyPointerHit()
//  once per render frame with that flag; this module does the rest.
// ============================================================================

// Resolved relative to THIS file, so every piece — fish/, horse/, willow/,
// all at a different folder depth from the project root — gets the same
// absolute URLs without needing to know where they live.
const FILES = ["whimsical.wav", "whimsical1.wav", "whimsical2.wav", "whimsical3.wav", "whimsical4.wav"];
const SRCS = FILES.map((f) => new URL(`../../${f}`, import.meta.url).href);

const BASE_VOLUME = 0.6;
// How long the falloff takes when contact ends. Long enough to read as a
// release rather than a cut, short enough that a quick tap-tap-tap across the
// curtain doesn't leave three overlapping tails ringing at once.
const FADE_MS = 350;

let audio = null;
let wasHit = false;
let fadeRAF = null;
// Whether contact is still ongoing — read by the 'ended' handler to decide
// whether to chain another random clip or just stop.
let touching = false;
let lastIndex = -1;

// Never the same clip twice in a row — a "random sequence" that can repeat
// back-to-back reads as broken more often than it reads as random.
function pickIndex() {
  if (SRCS.length === 1) return 0;
  let i;
  do {
    i = Math.floor(Math.random() * SRCS.length);
  } while (i === lastIndex);
  lastIndex = i;
  return i;
}

function getAudio() {
  if (!audio) {
    audio = new Audio();
    audio.volume = BASE_VOLUME;
    // Chains the sequence: a clip ending while contact continues picks the
    // next random one. If contact already ended, this fires anyway (the clip
    // was mid-fade or already faded/paused) and does nothing.
    audio.addEventListener("ended", () => {
      if (touching) playRandomClip();
    });
  }
  return audio;
}

function playRandomClip() {
  const a = getAudio();
  cancelFade();
  a.src = SRCS[pickIndex()];
  a.volume = BASE_VOLUME;
  // A bare mousemove is not always enough of a "user gesture" for a
  // browser's autoplay policy — the promise can reject the first few times.
  // That's expected, not a bug: it succeeds once the browser decides the
  // visitor has engaged with the page.
  a.play().catch(() => {});
}

function cancelFade() {
  if (fadeRAF != null) {
    cancelAnimationFrame(fadeRAF);
    fadeRAF = null;
  }
}

// Ramps volume down to 0 over FADE_MS, then stops — never a hard cut.
// Cancellable: a touch resuming mid-fade aborts this and starts a fresh clip
// instead of fighting it for the volume.
function fadeOutAndStop(a) {
  cancelFade();
  const start = performance.now();
  const startVolume = a.volume;
  const step = (now) => {
    const t = Math.min(1, (now - start) / FADE_MS);
    a.volume = startVolume * (1 - t);
    if (t < 1) {
      fadeRAF = requestAnimationFrame(step);
    } else {
      fadeRAF = null;
      a.pause();
      a.volume = BASE_VOLUME; // restored for the next touch
    }
  };
  fadeRAF = requestAnimationFrame(step);
}

// Call once per rendered frame with hair.pointerHit (or the OR of several
// HairSystems, for a piece that runs more than one).
//   rising edge  (touch begins) — cancel any fade still running, start a
//                                 fresh random clip.
//   falling edge (touch ends)   — stop chaining, fade out whatever is
//                                 currently playing instead of cutting it.
export function notifyPointerHit(hit) {
  if (hit && !wasHit) {
    touching = true;
    playRandomClip();
  } else if (!hit && wasHit) {
    touching = false;
    if (audio && !audio.paused) fadeOutAndStop(audio);
  }
  wasHit = hit;
}
