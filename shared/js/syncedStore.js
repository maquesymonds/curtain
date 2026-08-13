// ============================================================================
//  SYNCED STORE — deciding between the browser's draft and the project file.
//
//  Every editor here keeps two copies of its data:
//    localStorage  a live autosave, so nothing is lost on reload mid-edit
//    the JSON file in the project, written by the SAVE button
//
//  Naively preferring localStorage breaks the moment the file changes from
//  outside that one browser — a regenerated set, an edit from another window, a
//  file installed by hand. The browser then silently keeps showing its old draft
//  and the file looks like it did nothing.
//
//  So the autosave records a FINGERPRINT of the file it was derived from:
//    fingerprints match  -> the draft descends from this exact file, and may hold
//                           unsaved edits, so the draft wins
//    they differ         -> the file moved on independently, so the FILE wins
//                           and the stale draft is replaced
// ============================================================================

// Small, stable, order-sensitive hash of a JSON-able value. Not cryptographic —
// it only has to change when the content changes.
export function fingerprint(value) {
  const s = JSON.stringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16) + ":" + s.length;
}

// `file` and `local` are each { ok, list, fingerprint? } — `local.fingerprint` is
// the file fingerprint recorded when that draft was last in sync.
// Returns { list, source, status } where source is "draft" | "file" | "empty".
export function chooseSource(file, local, label = "item") {
  const n = (l) => `${l.length} ${label}${l.length === 1 ? "" : "s"}`;

  if (local.ok && file.ok && local.fingerprint === file.fingerprint) {
    return { list: local.list, source: "draft", status: `loaded ${n(local.list)} from autosave` };
  }
  if (file.ok) {
    const superseded = local.ok
      ? ` (the browser had an older draft of ${n(local.list)}, replaced)`
      : "";
    return { list: file.list, source: "file", status: `loaded ${n(file.list)} from the project file${superseded}` };
  }
  if (local.ok) {
    return { list: local.list, source: "draft", status: `loaded ${n(local.list)} from autosave (no project file)` };
  }
  return { list: [], source: "empty", status: "" };
}
