// ============================================================================
//  TUNE SPEC — the nine things a VISITOR gets to move on the fish.
//
//  Same shape and same rules as horse/js/tune.js (read the note there for what is
//  left out and why — including the whole force group, which both pieces dropped to
//  keep this panel minimal). Worth knowing anyway, because it is what the sliders
//  that ARE here sit on top of: THE WATER MANDA. `systems.wind` is off in this
//  piece and the swell block is the driver, and gravity is nearly neutral (0.003,
//  2% of the horse's) because a fin floats, it does not hang.
//
//  The text control is `charPool`, not `words`: a fin reads as data moving through
//  water, and hairText() prefers the pool over the word list whenever it is set
//  (see shared/js/config.js). Typing words into a piece that is built out of a
//  character pool would write into a field nothing reads.
// ============================================================================

import { CONFIG } from "./config.js";
import { alphabetControls, CHINESE, NUMBERS } from "../../shared/js/alphabets.js";
import { SOUND, setSoundEnabled } from "../../shared/js/interactionSound.js";

// `code` first because that is what config.js authored and what the piece IS —
// "aletas de código", a fin reading as data moving through water. The others are
// offers, not the piece.
//
// Only `chinese` overrides the spacing, and it has to: the authored 7.15px step was
// measured against this pool's 5.28px mean width, and a Chinese character is
// 11.24px at fontSize 11 — 57% overlap, a smear instead of a ray. 11.3 puts them
// just touching, which is the same relationship the code pool has (see
// shared/js/alphabets.js).
const ALPHABETS = {
  code: {}, // = the authored punctuation pool
  filamento: { pool: null, words: ["FILAMENTO"], fromRoot: true },
  numbers: { pool: NUMBERS },
  chinese: { pool: CHINESE, seg: 11.3 },
};

export const TUNE_SPEC = [
  // ----- colour: halo, body, core, and the water behind them ---------------
  {
    group: "color",
    label: "letters",
    path: "color",
    apply: "atlas",
    hint: "the body of each letter",
  },
  {
    group: "color",
    label: "halo",
    path: "glyphBloom.color",
    apply: "atlas",
    hint: "the light the letter throws around itself",
  },
  {
    group: "color",
    label: "core",
    path: "glyphCore.color",
    apply: "atlas",
    hint: "the hot filament at the centre",
  },
  {
    group: "color",
    // depth.hazeColor, i.e. what the far rays are mixed toward. On this piece it
    // reads as the colour of the water between the rays of a fin.
    label: "water",
    path: "depth.hazeColor",
    apply: "atlas",
    hint: "the colour the far rays are mixed toward",
  },

  // ----- the type itself ---------------------------------------------------
  {
    group: "type",
    label: "size",
    path: "fontSize",
    min: 8,
    max: 20,
    step: 0.25,
    apply: "atlas",
    hint: "11 is the piece's own value",
  },
  {
    group: "type",
    label: "glow",
    path: "glyphBloom.blur",
    min: 0,
    max: 24,
    step: 0.5,
    apply: "atlas",
    hint: "the width of the halo, in pixels",
  },
  // The alphabet dropdown and the free field that follows it. Both rebuild every
  // fin — the characters are handed out ray by ray while the strands are built —
  // then settle for ~18 steps.
  ...alphabetControls(CONFIG, ALPHABETS, { hint: "code, FILAMENTO, digits or Chinese" }),

  // ----- sound -------------------------------------------------------------
  {
    group: "sound",
    label: "sound",
    get: () => SOUND.enabled,
    set: (on) => setSoundEnabled(on),
    kind: "bool",
    apply: "live",
    hint: "the fins sound when you touch them with the cursor",
  },
];
