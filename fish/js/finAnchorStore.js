// ============================================================================
//  FIN ANCHOR STORE — the `arc` root positions in fins.js, made editable.
//
//  fins.js authors FINS[i].arc as hardcoded [u, v] points in body space (see
//  the header there). This store lets the fin anchor editor move those
//  points, and persists the result the way willow's AnchorStore does:
//  localStorage autosave first, then a committed JSON file, then whatever
//  fins.js shipped with.
//
//  It mutates FINS IN PLACE — buildFinRoots() reads fin.arc directly off the
//  same module singleton, so there is no second copy for main.js to
//  reconcile, and no change here does anything until the piece rebuilds.
// ============================================================================

import { FINS } from "./fins.js";
import { downloadJSON, pickJSONText } from "../../shared/js/jsonFile.js";

const STORAGE_KEY = "fish-fin-anchors-v1";
const SOURCE_URL = "fish-fin-anchors.json";
const EXPORT_FILENAME = "fish-fin-anchors.json";
const SAVE_DEBOUNCE_MS = 200;

// Frozen at module load, before anything can mutate FINS — this is what
// "reset" means: the values fins.js was authored with, not last session's.
const ORIGINAL = FINS.map((f) => f.arc.map((p) => [p[0], p[1]]));

const round = (v) => Math.round(v * 1e5) / 1e5;

export class FinAnchorStore {
  constructor() {
    this.saveState = "idle"; // "idle" | "saving" | "saved" | "error"
    this.lastError = null;
    this._timer = null;
  }

  // Autosave first, then the shipped file, then fins.js's own defaults.
  async init() {
    const local = this._loadFrom(this._readStorage());
    if (local.ok) return local.status;

    let fileData = null;
    try {
      const res = await fetch(SOURCE_URL, { cache: "no-cache" });
      if (res.ok) fileData = await res.json();
    } catch {
      // no file committed yet — not an error
    }
    const file = this._loadFrom(fileData);
    if (file.ok) return file.status;

    return "using fins.js defaults";
  }

  // ----- mutation ------------------------------------------------------------

  move(finIndex, pointIndex, u, v) {
    const arc = FINS[finIndex]?.arc;
    if (!arc || !arc[pointIndex]) return;
    arc[pointIndex][0] = u;
    arc[pointIndex][1] = v;
    this.scheduleSave();
  }

  // Appends a point after the selected one, so extending an arc from either
  // end is just "select the end point, add".
  addPoint(finIndex, afterIndex) {
    const arc = FINS[finIndex]?.arc;
    if (!arc) return -1;
    const at = Math.max(0, Math.min(afterIndex, arc.length - 1));
    const p = arc[at];
    arc.splice(at + 1, 0, [p[0], p[1] + 0.04]);
    this.scheduleSave();
    return at + 1;
  }

  removePoint(finIndex, pointIndex) {
    const arc = FINS[finIndex]?.arc;
    // alongArc() needs at least one point to interpolate against.
    if (!arc || arc.length <= 1 || !arc[pointIndex]) return false;
    arc.splice(pointIndex, 1);
    this.scheduleSave();
    return true;
  }

  resetFin(finIndex) {
    const arc = FINS[finIndex]?.arc;
    const orig = ORIGINAL[finIndex];
    if (!arc || !orig) return;
    arc.length = 0;
    for (const p of orig) arc.push([p[0], p[1]]);
    this.scheduleSave();
  }

  resetAll() {
    FINS.forEach((_, i) => this.resetFin(i));
  }

  // ----- persistence -----------------------------------------------------------

  serialize() {
    return {
      version: 1,
      fins: FINS.map((f) => ({ name: f.name, arc: f.arc.map((p) => [round(p[0]), round(p[1])]) })),
    };
  }

  scheduleSave() {
    clearTimeout(this._timer);
    this.saveState = "saving";
    this._timer = setTimeout(() => this.saveNow(), SAVE_DEBOUNCE_MS);
  }

  saveNow() {
    clearTimeout(this._timer);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.serialize()));
      this.saveState = "saved";
      this.lastError = null;
    } catch (err) {
      this.saveState = "error";
      this.lastError = err.message;
      console.error("Fin anchor autosave failed:", err);
    }
  }

  exportJson() {
    const data = this.serialize();
    downloadJSON(data, EXPORT_FILENAME);
    return data;
  }

  async importJson() {
    const text = await pickJSONText();
    if (text === null) return null; // cancelled
    const data = JSON.parse(text);
    this._applyData(data);
    this.saveNow();
    return data;
  }

  _readStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  _loadFrom(data) {
    if (!data) return { ok: false, status: "" };
    try {
      this._applyData(data);
      return { ok: true, status: `loaded fin anchors (${data.fins.length} fin(s))` };
    } catch (err) {
      return { ok: false, status: `saved fin anchors rejected: ${err.message}` };
    }
  }

  _applyData(data) {
    if (!data || typeof data !== "object") throw new Error("not an object");
    if (data.version !== 1) throw new Error(`unsupported version ${JSON.stringify(data.version)} (expected 1)`);
    if (!Array.isArray(data.fins)) throw new Error("no `fins` array");

    const byName = new Map(data.fins.map((f) => [f.name, f]));
    for (const f of FINS) {
      const saved = byName.get(f.name);
      if (!saved) continue;
      if (!Array.isArray(saved.arc) || !saved.arc.length) throw new Error(`${f.name}: empty or missing arc`);
      for (const p of saved.arc) {
        if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
          throw new Error(`${f.name}: bad point ${JSON.stringify(p)}`);
        }
      }
    }
    // Only write once every fin has validated, so a bad file changes nothing.
    for (const f of FINS) {
      const saved = byName.get(f.name);
      if (!saved) continue;
      f.arc.length = 0;
      for (const p of saved.arc) f.arc.push([p[0], p[1]]);
    }
  }
}
