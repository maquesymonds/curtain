// ============================================================================
//  FIN ANCHOR FRAME STORE — per-frame nudges on INDIVIDUAL arc control points.
//
//  Different from both other correction layers:
//    finAnchorStore.js       moves an arc point for EVERY frame alike (constant
//                            offset, rides with the tracked body).
//    trackCorrectionStore.js moves the WHOLE body pose at specific frames (all
//                            roots slip together, because the tracking itself
//                            is what's wrong there).
//  This one is for the third case: individual roots from DIFFERENT fins drift
//  at DIFFERENT times, not together and not constantly — so neither of the
//  other two layers fits. Keyed by (fin name, point index), each with its own
//  sparse set of frame keyframes; zero outside the span you actually placed
//  keyframes in, same rule as trackCorrectionStore.js and for the same reason
//  — a fix for one point at one frame must not leak anywhere else.
// ============================================================================

import { smoothstep } from "../../shared/js/utils.js";
import { downloadJSON, pickJSONText } from "../../shared/js/jsonFile.js";

const STORAGE_KEY = "fish-fin-anchor-frames-v1";
const SOURCE_URL = "fish-fin-anchor-frames.json";
const EXPORT_FILENAME = "fish-fin-anchor-frames.json";
const SAVE_DEBOUNCE_MS = 200;
const ZERO = Object.freeze({ du: 0, dv: 0 });
const round = (v) => Math.round(v * 1e5) / 1e5;
const keyOf = (fin, point) => `${fin}.${point}`;
const KEY_RE = /^([a-zA-Z]+)\.(\d+)$/;

export class FinAnchorFrameStore {
  constructor() {
    this.tracks = new Map(); // "fin.point" -> Map<frame:int, {du,dv}>
    this.saveState = "idle";
    this.lastError = null;
    this._timer = null;
  }

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

    return "no per-frame anchor corrections";
  }

  _track(fin, point) {
    return this.tracks.get(keyOf(fin, point));
  }

  hasKeyframe(fin, point, frame) {
    return this._track(fin, point)?.has(frame) ?? false;
  }

  framesFor(fin, point) {
    const t = this._track(fin, point);
    return t ? [...t.keys()].sort((a, b) => a - b) : [];
  }

  get count() {
    let n = 0;
    for (const t of this.tracks.values()) n += t.size;
    return n;
  }

  countFor(fin) {
    let n = 0;
    for (const [k, t] of this.tracks) if (k.startsWith(fin + ".")) n += t.size;
    return n;
  }

  // The {du, dv} to add to the base arc point, at a possibly fractional frame
  // position. Exactly zero before the first keyframe placed on THIS point and
  // after the last one — see the header for why.
  correctionAt(fin, point, frame) {
    const fs = this.framesFor(fin, point);
    if (fs.length === 0) return ZERO;
    const t = this._track(fin, point);

    const first = fs[0];
    const last = fs[fs.length - 1];
    if (frame <= first) return frame === first ? t.get(first) : ZERO;
    if (frame >= last) return frame === last ? t.get(last) : ZERO;

    let a = first;
    for (const f of fs) {
      if (f <= frame) a = f;
      else break;
    }
    if (a === frame) return t.get(a);
    const b = fs[fs.indexOf(a) + 1];
    const s = smoothstep(0, 1, (frame - a) / (b - a));
    const ca = t.get(a);
    const cb = t.get(b);
    return { du: ca.du + (cb.du - ca.du) * s, dv: ca.dv + (cb.dv - ca.dv) * s };
  }

  // The whole arc for one fin, at a frame, with every point's correction
  // applied. Cheap enough to call once per fin per frame — fins.js does.
  correctedArc(fin, baseArc, frame) {
    return baseArc.map((p, pi) => {
      const c = this.correctionAt(fin, pi, frame);
      return [p[0] + c.du, p[1] + c.dv];
    });
  }

  // ----- mutation ------------------------------------------------------------

  setKeyframe(fin, point, frame, correction) {
    const k = keyOf(fin, point);
    let t = this.tracks.get(k);
    if (!t) {
      t = new Map();
      this.tracks.set(k, t);
    }
    t.set(frame, { du: correction.du, dv: correction.dv });
    this.scheduleSave();
  }

  removeKeyframe(fin, point, frame) {
    const k = keyOf(fin, point);
    const t = this.tracks.get(k);
    if (!t) return false;
    const had = t.delete(frame);
    if (t.size === 0) this.tracks.delete(k);
    if (had) this.scheduleSave();
    return had;
  }

  clearFin(fin) {
    let changed = false;
    for (const k of [...this.tracks.keys()]) {
      if (k.startsWith(fin + ".")) {
        this.tracks.delete(k);
        changed = true;
      }
    }
    if (changed) this.scheduleSave();
  }

  clearAll() {
    this.tracks.clear();
    this.scheduleSave();
  }

  // ----- persistence -----------------------------------------------------------

  serialize() {
    const points = {};
    for (const [k, t] of this.tracks) {
      const frames = {};
      for (const f of [...t.keys()].sort((a, b) => a - b)) {
        const c = t.get(f);
        frames[String(f)] = { du: round(c.du), dv: round(c.dv) };
      }
      points[k] = frames;
    }
    return { version: 1, points };
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
      console.error("Fin anchor frame autosave failed:", err);
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
      return { ok: true, status: `loaded ${this.count} per-frame anchor correction(s)` };
    } catch (err) {
      return { ok: false, status: `saved anchor-frame corrections rejected: ${err.message}` };
    }
  }

  _applyData(data) {
    if (!data || typeof data !== "object") throw new Error("not an object");
    if (data.version !== 1) throw new Error(`unsupported version ${JSON.stringify(data.version)} (expected 1)`);
    if (!data.points || typeof data.points !== "object") throw new Error("no `points` object");

    const next = new Map();
    for (const [k, frames] of Object.entries(data.points)) {
      if (!KEY_RE.test(k)) throw new Error(`bad point key ${JSON.stringify(k)}`);
      const t = new Map();
      for (const [fk, c] of Object.entries(frames)) {
        const frame = Number(fk);
        if (!Number.isInteger(frame) || frame < 0) throw new Error(`${k}: bad frame key ${JSON.stringify(fk)}`);
        if (!Number.isFinite(c?.du) || !Number.isFinite(c?.dv)) throw new Error(`${k} frame ${frame}: du/dv not finite`);
        t.set(frame, { du: c.du, dv: c.dv });
      }
      if (t.size) next.set(k, t);
    }
    this.tracks = next;
  }
}
