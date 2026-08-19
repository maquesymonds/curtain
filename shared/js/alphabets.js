// ============================================================================
//  ALPHABETS — what the curtain is WRITTEN IN, as something a visitor can switch.
//
//  Two controls, built here because both pieces want the same pair and the same
//  Chinese repertoire, and because the pair only works if the two halves know
//  about each other:
//
//    "alphabet"  a dropdown of presets. Picking one writes SEVERAL config values
//                at once, which is the whole reason tune.js takes get/set as well
//                as paths: a character set and the character SPACING that set
//                needs are one decision, not two.
//    "text"      the free field, and it edits WHICHEVER of the two the piece is
//                actually reading — CONFIG.charPool when a pool is set,
//                CONFIG.words when it is not. A field that showed the word list
//                while the piece was drawing from a pool would be a field that
//                lies: you would type into it and nothing would change.
//
//  WHY SPACING IS PART OF A PRESET. `segmentLength` is the step from one character
//  to the next, and it was tuned against the width of the characters the piece was
//  authored with. Measured through each piece's own font stack (2026-08-19):
//
//                    horse (12.75px)   fish (11px)
//      latin mean         8.09            7.11
//      CJK (every one)   13.01           11.24
//      authored step     16.00            7.15
//
//  So a Chinese character is 1.6x a latin one, exactly, because CJK is set on a
//  square em. On the horse that lands at 13.01 in a 16px step and reads as a denser
//  chain — wanted. On the fish it would be 11.24 inside a 7.15 step: 57% overlap, a
//  smear rather than a line. Hence `seg` per preset, and hence this file.
// ============================================================================

// Not a random repertoire: it is the vocabulary of the pieces themselves —
// filament, thread, writing, character, body, form, light, water, wind, flow,
// movement, life, body, hair, hair, horse, fish, language, speech, sound, force,
// weight, breath. 絲 is first on purpose: it is the filament.
export const CHINESE = "絲線文字書體形光水風流動生身毛髮馬魚語言音力重息";

export const NUMBERS = "0123456789";

// ---------------------------------------------------------------------------
//  alphabetControls(CONFIG, presets, opts)
//
//  presets: { name: { pool?, words?, fromRoot?, seg? } }. The three states of `pool`
//  are all meaningful and all needed:
//
//     omitted      whatever config.js authored — which is a punctuation pool on the
//                  fish and nothing at all on the horse. This is how a preset says
//                  "the piece as it was written".
//     null         explicitly no pool, i.e. read CONFIG.words. What FILAMENTO is.
//     "…"          that pool.
//
//  The FIRST key is the default, and it must describe the piece as its config.js
//  authored it, or the panel opens claiming something the piece is not.
//
//  Returns the two spec entries, to be spread into a piece's TUNE_SPEC.
// ---------------------------------------------------------------------------
export function alphabetControls(CONFIG, presets, { group = "type", hint = "" } = {}) {
  const names = Object.keys(presets);
  // What config.js said, captured at module load — which is safe because a piece's
  // config.js runs configure() before any of its other modules are evaluated (see
  // the header of shared/js/config.js). Anything a preset does not override goes
  // back to these, so "back to the original" really is the original.
  const authored = {
    pool: CONFIG.charPool,
    words: [...CONFIG.words],
    fromRoot: CONFIG.textFromRoot,
    seg: CONFIG.segmentLength,
  };

  let current = names[0];

  function apply(name) {
    const preset = presets[name];
    if (!preset) return;
    current = name;
    // `in`, not `??`: an omitted pool and an explicitly null one mean different
    // things here, and `??` cannot tell them apart.
    CONFIG.charPool = "pool" in preset ? preset.pool : authored.pool;
    CONFIG.words = preset.words ? [...preset.words] : [...authored.words];
    CONFIG.textFromRoot = preset.fromRoot ?? authored.fromRoot;
    CONFIG.segmentLength = preset.seg ?? authored.seg;
  }

  return [
    {
      group,
      label: "alphabet",
      kind: "choice",
      options: names,
      get: () => current,
      set: apply,
      // Every one of these is read while the strands are BUILT, so the piece has to
      // rebuild — which also re-bakes the atlas, which is what a new character set
      // needs anyway.
      apply: "rebuild",
      hint: hint || "what the curtain is written in",
    },
    {
      group,
      label: "text",
      kind: "text",
      // Whichever one the piece is really reading. See the header.
      get: () => CONFIG.charPool ?? CONFIG.words.join(" "),
      set: (v) => {
        if (CONFIG.charPool !== null) CONFIG.charPool = v;
        else CONFIG.words = String(v).split(/\s+/).filter(Boolean);
      },
      apply: "rebuild",
      hint: "the characters themselves — type over them",
    },
  ];
}
