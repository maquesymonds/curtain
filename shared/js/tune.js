// ============================================================================
//  TUNE — the VISITOR's handful of knobs. Not the authoring panel.
//
//  shared/js/controls.js is a TOOL: 2.6 MB of Theatre.js, every parameter the
//  piece has, loaded only behind ?controls. This is its opposite on every axis —
//  ten controls, no dependencies, always on, and the UI itself lives in the shell
//  (the root index.html) so ONE panel serves whichever piece is on screen.
//
//  WHY THE PIECE OWNS THE LIST, NOT THE SHELL. The shell knows nothing about what
//  a piece is made of, and it should stay that way: the horse is moved by air and
//  the fish by water, so the same label ("fuerza") points at `windStrength` in one
//  and at `swell.strength` in the other. Each piece declares its own list, the
//  shell renders whatever it is handed, and adding a knob to a piece touches no
//  file in the shell.
//
//  THE PROTOCOL, layered on the one in stage.js:
//    piece → shell : { type: "curtain:tune", spec: [...] }  at boot, and after a reset
//    shell → piece : { type: "curtain:tune-set", id, value }
//    shell → piece : { type: "curtain:tune-reset" }
//    shell → piece : { type: "curtain:tune-ask" }           re-send the spec
//
//  CONTROLS ARE ADDRESSED BY `id`, NOT BY PATH, for two reasons. Half of what is
//  worth handing a visitor is not a CONFIG path at all (the sound switch lives in
//  interactionSound.js), and `obj` / `get` / `set` cannot survive postMessage
//  anyway. What crosses the frame boundary is the plain DESCRIPTION of a control —
//  label, kind, range, current value — and nothing else.
//
//  WHAT A CHANGE COSTS. The same three words as controls.js, with the same
//  meaning, handed to the same `onApply` the piece already wrote for it:
//    "live"     read every frame; nothing to do
//    "atlas"    baked into the glyph bitmaps; re-bake (~6 ms)
//    "rebuild"  read while the strands are BUILT; the piece's own rebuild
//
//  Opened outside the shell (http://localhost:8000/fish/) there is no parent to
//  talk to and nothing here posts anything — but window.__tune still works, which
//  is the console version of the same panel.
// ============================================================================

import { clamp, getPath, setPath } from "./utils.js";

const inShell = window.parent !== window;

// A `words` control is a string in the panel and an ARRAY in CONFIG (hairText()
// joins it with spaces). A `text` one — the fish's charPool — is a string on both
// sides. Nothing else needs translating.
function decode(kind, value) {
  if (kind !== "words") return value;
  const words = String(value).split(/\s+/).filter(Boolean);
  return words.length ? words : null; // null = ignore, see set() below
}

function encode(kind, value) {
  return kind === "words" ? (value || []).join(" ") : value;
}

// Inferred from what the config already holds, so a spec entry only has to say
// what cannot be guessed. Two kinds must be declared, because the value alone
// cannot say which they are: `text` (a string that is not a colour could be a word
// list or a character pool, and only one of them is split on spaces) and `choice`
// (a string out of a fixed set, which is a dropdown and not a free field).
function kindOf(value) {
  if (typeof value === "boolean") return "bool";
  if (typeof value === "number") return "number";
  if (Array.isArray(value)) return "words";
  if (typeof value === "string") return /^#[0-9a-f]{6}$/i.test(value) ? "color" : "text";
  return null;
}

// ---------------------------------------------------------------------------
//  offerTuning({ CONFIG, spec, onApply })
//
//  spec: an array of entries, in the order they should appear.
//    { group, label, path, obj?, kind?, min?, max?, step?, apply, hint? }
//    { group, label, get, set, kind, apply, hint? }
//    { group, label, get, set, kind: "choice", options: [...], apply, hint? }
//
//  A "choice" is where get/set earns its place: picking one changes SEVERAL config
//  values at once (a character set and the spacing that set needs), which no single
//  path can express.
//
//  `obj` defaults to CONFIG; `get`/`set` are for anything that is not a config
//  path. `apply` is the cost word above. Entries whose value cannot be read are
//  dropped with a warning rather than silently shipping a dead slider.
// ---------------------------------------------------------------------------
export function offerTuning({ CONFIG, spec, onApply }) {
  const entries = [];

  spec.forEach((e, i) => {
    const read = () => (e.get ? e.get() : getPath(e.obj || CONFIG, e.path));
    const value = read();
    if (value === undefined) {
      console.warn(`tune: no puedo leer "${e.group} / ${e.label}" (${e.path ?? "get()"}) — lo omito`);
      return;
    }
    const kind = e.kind || kindOf(value);
    if (!kind) {
      console.warn(`tune: no sé representar "${e.group} / ${e.label}" (${typeof value})`);
      return;
    }
    entries.push({
      ...e,
      // Stable across a reset and across a piece switch, and readable in a log.
      id: e.id || `${e.group}/${e.label}`,
      kind,
      read,
      write: (v) => (e.set ? e.set(v) : setPath(e.obj || CONFIG, e.path, v)),
      // What the file said. The reset button restores exactly this, so a visitor
      // can always get back to the authored piece.
      initial: kind === "words" ? [...value] : value,
    });
  });

  const byId = new Map(entries.map((e) => [e.id, e]));

  // Only the serializable half. `obj`, `read`, `write` and every function in an
  // entry stay on this side of the boundary.
  const wire = () =>
    entries.map((e) => ({
      id: e.id,
      group: e.group,
      label: e.label,
      hint: e.hint,
      kind: e.kind,
      min: e.min,
      max: e.max,
      step: e.step,
      options: e.options,
      value: encode(e.kind, e.read()),
    }));

  function announce() {
    if (!inShell) return;
    try {
      window.parent.postMessage({ type: "curtain:tune", spec: wire() }, "*");
    } catch (err) {
      console.warn("tune: no pude ofrecerle los controles al shell.", err);
    }
  }

  // Writes one control and returns the cost word it incurred, or null if the value
  // was refused. Separate from set() below so the message handler and the console
  // both end up applying exactly once.
  function write(id, raw) {
    const e = byId.get(id);
    if (!e) return null;
    // A half-typed field must not blank the piece: an empty text bakes an atlas with
    // no characters in it, i.e. a piece with no letters — the one thing the shell
    // handshake exists to prevent. Checked BEFORE decode and for both string kinds,
    // because "   " is neither empty nor usable.
    if ((e.kind === "text" || e.kind === "words") && !String(raw).trim()) return null;
    let value = decode(e.kind, raw);
    if (value === null || value === "") return null;
    if (e.kind === "number") {
      value = Number(value);
      if (!Number.isFinite(value)) return null;
      if (e.min !== undefined && e.max !== undefined) value = clamp(value, e.min, e.max);
    }
    if (e.kind === "bool") value = !!value;
    // A dropdown can only ever say one of the things it was built from. Anything
    // else arriving over the channel is a bug or a stale panel, and applying it
    // would hand the piece a preset that does not exist.
    if (e.kind === "choice" && !e.options?.includes(value)) {
      console.warn(`tune: "${value}" no es una opción de "${e.id}" — la ignoro`);
      return null;
    }
    e.write(value);
    return e.apply || "live";
  }

  function apply(kinds) {
    if (kinds.size) onApply?.(kinds);
  }

  function set(id, raw) {
    const kind = write(id, raw);
    if (!kind) return null;
    apply(new Set([kind]));
    // A choice writes SEVERAL values at once, so the other controls in the panel are
    // now out of date — pick "chinese" and the free text field is still showing the
    // latin word it replaced, i.e. showing something the piece is no longer drawing.
    // Re-announcing is what makes the panel follow the piece; nothing else in the
    // spec can go stale from a single-value write, so nothing else does this.
    if (byId.get(id)?.kind === "choice") announce();
    return kind;
  }

  function reset() {
    const kinds = new Set();
    for (const e of entries) {
      e.write(e.kind === "words" ? [...e.initial] : e.initial);
      kinds.add(e.apply || "live");
    }
    apply(kinds);
    announce(); // the panel's inputs follow the piece, not the other way round
  }

  if (inShell) {
    window.addEventListener("message", (ev) => {
      if (ev.source !== window.parent) return;
      const msg = ev.data;
      if (msg?.type === "curtain:tune-set") {
        set(msg.id, msg.value);
      } else if (msg?.type === "curtain:tune-reset") {
        reset();
      } else if (msg?.type === "curtain:tune-ask") {
        announce();
      }
    });
  }

  // The console version of the panel, and how a piece opened on its own still
  // gets at these: window.__tune.set("color/letras", "#00ff88").
  window.__tune = { entries, set, reset, announce, spec: wire };
  announce();
  return { announce, reset, set };
}
