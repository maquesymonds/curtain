// ============================================================================
//  TRACK CORRECTION STORE — sparse per-frame nudges on top of the auto-tracked
//  pose in fish-tracking.json.
//
//  bodyTrack.js says there is no manual tracking editor and no need for one —
//  true almost everywhere (4.87px/frame average drift, smooth). But "almost
//  everywhere" still leaves specific frames where the colour-mask tracker
//  slips and a fin root visibly detaches from the body for a moment. This
//  store does NOT replace the tracked pose, it PATCHES it: a small set of
//  correction keyframes — { dcx, dcy, dangle, dHalfLen, dHalfDepth } deltas at
//  specific integer frames — added on top of BodyTrack's own output.
//
//  Outside the span the placed keyframes cover, the correction is exactly
//  zero: the auto track is trusted by default. This is the opposite of
//  horse's TrackingStore, which holds a keyframe's value out to the edges of
//  the whole clip — here that would turn a fix for one bad frame into a
//  constant offset for the entire loop, which is precisely NOT what a local
//  correction is for.
// ============================================================================

import { smoothstep } from "../../shared/js/utils.js";
import { downloadJSON, pickJSONText } from "../../shared/js/jsonFile.js";

const STORAGE_KEY = "fish-track-correction-v1";
const SOURCE_URL = "fish-track-correction.json";
const EXPORT_FILENAME = "fish-track-correction.json";
const SAVE_DEBOUNCE_MS = 200;
const ZERO = Object.freeze({ dcx: 0, dcy: 0, dangle: 0, dHalfLen: 0, dHalfDepth: 0 });
const round = (v) => Math.round(v * 1e5) / 1e5;

const lerpCorrection = (a, b, t) => ({
  dcx: a.dcx + (b.dcx - a.dcx) * t,
  dcy: a.dcy + (b.dcy - a.dcy) * t,
  dangle: a.dangle + (b.dangle - a.dangle) * t,
  dHalfLen: a.dHalfLen + (b.dHalfLen - a.dHalfLen) * t,
  dHalfDepth: a.dHalfDepth + (b.dHalfDepth - a.dHalfDepth) * t,
});

export class TrackCorrectionStore {
  constructor() {
    this.keyframes = new Map(); // frame:int -> {dcx,dcy,dangle,dHalfLen,dHalfDepth}
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

    return "no corrections — trusting fish-tracking.json";
  }

  get count() {
    return this.keyframes.size;
  }

  hasKeyframe(frame) {
    return this.keyframes.has(frame);
  }

  frames() {
    return [...this.keyframes.keys()].sort((a, b) => a - b);
  }

  // The correction to ADD to the raw tracked pose, at a possibly fractional
  // frame position (BodyTrack.frameAt's output — same fractional position the
  // raw pose itself interpolates at, so the two never step out of sync).
  // Exactly ZERO before the first keyframe and after the last one.
  correctionAt(frame) {
    const fs = this.frames();
    if (fs.length === 0) return ZERO;

    const first = fs[0];
    const last = fs[fs.length - 1];
    if (frame <= first) return frame === first ? this.keyframes.get(first) : ZERO;
    if (frame >= last) return frame === last ? this.keyframes.get(last) : ZERO;

    let a = first;
    for (const f of fs) {
      if (f <= frame) a = f;
      else break;
    }
    if (a === frame) return this.keyframes.get(a);
    const b = fs[fs.indexOf(a) + 1];
    const t = smoothstep(0, 1, (frame - a) / (b - a));
    return lerpCorrection(this.keyframes.get(a), this.keyframes.get(b), t);
  }

  // ----- mutation ------------------------------------------------------------

  // Overwrite the keyframe at an INTEGER frame outright — what a drag does,
  // continuously, over the course of one gesture.
  setKeyframe(frame, correction) {
    this.keyframes.set(frame, { ...ZERO, ...correction });
    this.scheduleSave();
  }

  // Add to whatever correction already applies at `frame` (interpolated or
  // zero), materializing a keyframe there if none existed. What the rotate /
  // scale keys do, one press at a time.
  nudge(frame, delta) {
    const cur = this.keyframes.get(frame) ?? this.correctionAt(frame);
    this.setKeyframe(frame, {
      dcx: cur.dcx + (delta.dcx || 0),
      dcy: cur.dcy + (delta.dcy || 0),
      dangle: cur.dangle + (delta.dangle || 0),
      dHalfLen: cur.dHalfLen + (delta.dHalfLen || 0),
      dHalfDepth: cur.dHalfDepth + (delta.dHalfDepth || 0),
    });
    return this.keyframes.get(frame);
  }

  removeKeyframe(frame) {
    const had = this.keyframes.delete(frame);
    if (had) this.scheduleSave();
    return had;
  }

  clearAll() {
    this.keyframes.clear();
    this.scheduleSave();
  }

  // ----- persistence -----------------------------------------------------------

  serialize() {
    const out = {};
    for (const f of this.frames()) {
      const c = this.keyframes.get(f);
      out[String(f)] = {
        dcx: round(c.dcx),
        dcy: round(c.dcy),
        dangle: round(c.dangle),
        dHalfLen: round(c.dHalfLen),
        dHalfDepth: round(c.dHalfDepth),
      };
    }
    return { version: 1, keyframes: out };
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
      console.error("Track correction autosave failed:", err);
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
      return { ok: true, status: `loaded ${this.count} track correction keyframe(s)` };
    } catch (err) {
      return { ok: false, status: `saved corrections rejected: ${err.message}` };
    }
  }

  _applyData(data) {
    if (!data || typeof data !== "object") throw new Error("not an object");
    if (data.version !== 1) throw new Error(`unsupported version ${JSON.stringify(data.version)} (expected 1)`);
    if (!data.keyframes || typeof data.keyframes !== "object") throw new Error("no `keyframes` object");

    const entries = [];
    for (const [key, c] of Object.entries(data.keyframes)) {
      const frame = Number(key);
      if (!Number.isInteger(frame) || frame < 0) throw new Error(`bad frame key ${JSON.stringify(key)}`);
      for (const k of ["dcx", "dcy", "dangle", "dHalfLen", "dHalfDepth"]) {
        if (!Number.isFinite(c[k])) throw new Error(`frame ${frame}: ${k} is not a finite number`);
      }
      entries.push([frame, { dcx: c.dcx, dcy: c.dcy, dangle: c.dangle, dHalfLen: c.dHalfLen, dHalfDepth: c.dHalfDepth }]);
    }
    this.keyframes.clear();
    for (const [frame, c] of entries) this.keyframes.set(frame, c);
  }
}

// Composition point: the pose the piece actually renders with. `track` is a
// BodyTrack, `store` a TrackCorrectionStore. Kept as a free function (not a
// method on either) because it is the one place that needs both.
export function poseAt(track, store, time) {
  const raw = track.poseAt(time);
  const c = store.correctionAt(track.frameAt(time));
  return {
    cx: raw.cx + c.dcx,
    cy: raw.cy + c.dcy,
    angle: raw.angle + c.dangle,
    halfLen: raw.halfLen + c.dHalfLen,
    halfDepth: raw.halfDepth + c.dHalfDepth,
    aspect: raw.aspect,
  };
}
