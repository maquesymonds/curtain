// ============================================================================
//  TUNE SPEC — the nine things a VISITOR gets to move on the horse.
//
//  Data only; shared/js/tune.js writes the values and the shell (root index.html)
//  draws the panel. Different list, different audience and different file from
//  horse/js/controls.js: that one is the authoring panel behind ?controls, with
//  every parameter the piece has and a 2.6 MB dependency. This one always loads,
//  so it stays small — and every entry has to be a knob whose effect is legible
//  within one drag, without knowing anything about the physics.
//
//  WHAT IS DELIBERATELY NOT HERE, and why:
//   - anything that can empty the screen. `strandCount`, `systems.renderHair`,
//     `minAlpha`: a visitor who lands on a black rectangle has no way of knowing
//     they broke it rather than that it is broken.
//   - `segmentLength`. It pairs with `fontSize` (below the glyph size a strand
//     reads as a row of dots — see the "confetti" note in fish/js/config.js), and
//     a panel that lets one move without the other only offers new ways to be
//     wrong.
//   - the depth ramp. REGLA 1 lives in there. It is authored, not played with.
//
//  NO "FORCE" GROUP, DELIBERATELY (2026-08-19). The physics — wind, weight,
//  damping, the pointer radius — used to be four sliders here and was taken out to
//  keep this panel minimal: colour, type, sound. It is not lost, it moved back to
//  where it belongs, ?controls (horse/js/controls.js), which has all of it plus the
//  hundred parameters this list never showed. Putting it back is copying four
//  entries out of that spec.
//
//  THE FORCE HERE IS AIR (`windStrength` 0.38, more than double the shared default,
//  because gravity is 0.145 and a weak breeze cannot lift a mane that heavy) — but
//  that is now a thing the piece states, not a thing the visitor moves.
// ============================================================================

import { CONFIG } from "./config.js";
import { alphabetControls, CHINESE, NUMBERS } from "../../shared/js/alphabets.js";
import { SOUND, setSoundEnabled } from "../../shared/js/interactionSound.js";

// The first key is the default and it has to match config.js: `words: ["FILAMENTO"]`
// with `textFromRoot`, so every strand of the mane reads the word from the crest
// down. The other two swap in a character pool — no spacing override for either,
// because at a 16px step a 13.01px Chinese character reads as a denser chain and
// that is the look, not a problem (see shared/js/alphabets.js for the measurements).
const ALPHABETS = {
  filamento: {}, // = as config.js wrote it
  numbers: { pool: NUMBERS },
  chinese: { pool: CHINESE },
};

export const TUNE_SPEC = [
  // ----- colour: the three layers every glyph is baked from ----------------
  // Order matters — it is the neon structure from the outside in: halo, body,
  // core. See the long note above the colour block in config.js.
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
    // Short on purpose: the swatches sit in two narrow columns in the panel.
    label: "light",
    path: "lightWash.color",
    apply: "live",
    hint: "what the mane lights up on the horse",
  },

  // ----- the type itself ---------------------------------------------------
  {
    group: "type",
    label: "size",
    path: "fontSize",
    min: 8,
    max: 24,
    step: 0.25,
    apply: "atlas",
    hint: "12.75 is the piece's own value",
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
  // The alphabet dropdown and the free field that follows it. Both rebuild the
  // mane — the characters are handed out while the strands are built — which is
  // ~90 ms, and the pose is kept.
  ...alphabetControls(CONFIG, ALPHABETS, { hint: "latin, digits or Chinese" }),

  // ----- sound -------------------------------------------------------------
  // Not a CONFIG path: SOUND lives in interactionSound.js, which is why tune.js
  // takes get/set as well as paths.
  {
    group: "sound",
    label: "sound",
    get: () => SOUND.enabled,
    set: (on) => setSoundEnabled(on),
    kind: "bool",
    apply: "live",
    hint: "the mane sounds when you touch it with the cursor",
  },
];
