// ============================================================================
//  TRACKING STORE — the editable tracking data and nothing else.
//
//  Keyframes are keyed by INTEGER FRAME NUMBER, each holding the full set of
//  `pointCount` normalized [nx, ny] points (never a partial edit). Frames with
//  no keyframe are evaluated by interpolating the surrounding pair.
//
//  This module owns validation and the localStorage autosave. It knows nothing
//  about drawing, the DOM, the canvas or the video element.
// ============================================================================

import { CONFIG } from "./config.js";
import { smoothstep } from "../../shared/js/utils.js";
import { catmullRomAt, resampleByArcLength, sampleTracking, splinePoint } from "./tracking.js";

const N = () => CONFIG.trackEditor.pointCount;

// Deep copy so callers can never alias a stored keyframe and mutate it by
// accident — that is how neighbouring keyframes get corrupted.
const clonePoints = (pts) => pts.map((p) => [p[0], p[1]]);

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Returns null when the array is a valid pose, otherwise a string naming
// exactly what is wrong — an importer that only says "invalid" is useless when
// you are staring at a 121-frame file.
function pointArrayProblem(pts, expected) {
  if (!Array.isArray(pts)) return `points is ${typeof pts}, expected an array`;
  if (pts.length !== expected) return `has ${pts.length} point(s), needs exactly ${expected}`;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (!Array.isArray(p) || p.length !== 2) return `point ${i} is not a [x, y] pair`;
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
      return `point ${i} has a non-finite coordinate (${JSON.stringify(p)})`;
    }
    if (p[0] < 0 || p[0] > 1 || p[1] < 0 || p[1] > 1) {
      return `point ${i} is outside 0..1 (${JSON.stringify(p)})`;
    }
  }
  return null;
}

const isValidPointArray = (pts, expected) => pointArrayProblem(pts, expected) === null;

// The 14-point seed: resample the legacy 5-point curve at t=0 by arc length, so
// the editor opens with points already sitting along the crest instead of at
// zero. Purely a starting position — it is meant to be corrected by hand.
export function seedPoints() {
  const cfg = CONFIG.trackEditor;
  const pts0 = sampleTracking(0);
  return resampleByArcLength((u) => splinePoint(pts0, u), cfg.pointCount, cfg.arcLengthSamples);
}

// ---------------------------------------------------------------------------
//  The one interpolation rule, shared by the editor and by playback so what you
//  see while authoring is exactly what the mane gets at runtime.
//
//  Exact keyframe -> that pose. Between two keyframes -> smoothstep blend, per
//  point. Only one side available -> hold that pose. No keyframes -> null.
//  Always returns a fresh array; callers can never write into stored data.
// ---------------------------------------------------------------------------
export function poseFromKeyframes(keyframes, frame) {
  if (keyframes.size === 0) return null;
  const exact = keyframes.get(frame);
  if (exact) return clonePoints(exact);

  let a = null;
  let b = null;
  for (const f of keyframes.keys()) {
    if (f < frame && (a === null || f > a)) a = f;
    if (f > frame && (b === null || f < b)) b = f;
  }
  if (a === null) return clonePoints(keyframes.get(b));
  if (b === null) return clonePoints(keyframes.get(a));

  const pa = keyframes.get(a);
  const pb = keyframes.get(b);
  const f = smoothstep(0, 1, (frame - a) / (b - a));
  return pa.map((p, i) => [p[0] + (pb[i][0] - p[0]) * f, p[1] + (pb[i][1] - p[1]) * f]);
}

export class TrackingStore {
  constructor() {
    this.keyframes = new Map(); // frame:int -> points[N][2]
    this.lastSaveError = null;
    this.saveState = "idle"; // "idle" | "saved" | "error"
    this._saveTimer = null;
  }

  // ----- lifecycle ---------------------------------------------------------

  // Three tiers, same order willow's AnchorStore.init() uses: the autosave (your
  // actual in-progress work) first, then the shipped horse-tracking.json (so
  // opening the editor with no autosave starts from the CURRENT working track
  // instead of the bare 5-point seed — see the note on loadFromFile below), and
  // only the seed if neither exists. Returns a short human-readable status string.
  async init() {
    const local = this.loadFromStorage();
    if (local.ok) return local.status;

    const file = await this.loadFromFile();
    if (file.ok) return file.status;

    this.keyframes.clear();
    this.setKeyframe(0, seedPoints(), { save: true });
    return [local.status, file.status].filter(Boolean).join(" · ") || "new session, frame 0 seeded";
  }

  // The committed file — the same one TrackingSource loads for playback. Used
  // when there is no autosave, e.g. a fresh browser, or after clearing storage.
  // Without this tier, editing meant re-tracking the WHOLE clip from a straight
  // 5-point line every time, instead of nudging the track that already ships.
  async loadFromFile() {
    const url = CONFIG.trackingSource.url;
    if (!url) return { ok: false, status: "" };
    let res;
    try {
      res = await fetch(url, { cache: "no-cache" });
    } catch (err) {
      return { ok: false, status: "" }; // no file committed yet; not an error
    }
    if (!res.ok) return { ok: false, status: "" };
    try {
      const entries = parseKeyframes(await res.json(), { requirePointCount: N() });
      this.replaceAll(entries);
      this.saveState = "saved";
      return { ok: true, status: `loaded ${entries.length} keyframe(s) from ${url}` };
    } catch (err) {
      console.error(`${url} rejected: ${err.message}`);
      return { ok: false, status: `${url} rejected: ${err.message}` };
    }
  }

  // ----- queries -----------------------------------------------------------

  get count() {
    return this.keyframes.size;
  }

  hasKeyframe(frame) {
    return this.keyframes.has(frame);
  }

  // Sorted list of frames that carry a keyframe.
  frames() {
    return [...this.keyframes.keys()].sort((a, b) => a - b);
  }

  prevKeyframe(frame) {
    let best = null;
    for (const f of this.keyframes.keys()) if (f < frame && (best === null || f > best)) best = f;
    return best;
  }

  nextKeyframe(frame) {
    let best = null;
    for (const f of this.keyframes.keys()) if (f > frame && (best === null || f < best)) best = f;
    return best;
  }

  // The pose to show at `frame`. Exact keyframe if there is one, otherwise the
  // smoothstep blend of the surrounding pair. With only one side available the
  // pose is held. Always returns a COPY, so callers can't write through it.
  poseAt(frame) {
    return poseFromKeyframes(this.keyframes, frame) ?? seedPoints();
  }

  // Whether `frame` is a real keyframe or an interpolated in-between.
  kindAt(frame) {
    return this.keyframes.has(frame) ? "keyframe" : "interpolated";
  }

  // Spatial curve for a pose: the same open Catmull-Rom used everywhere else.
  static curvePoint(points, u) {
    return catmullRomAt(points, u);
  }

  // ----- mutations ---------------------------------------------------------

  // Write (or overwrite) the keyframe at `frame`. Never partial: the whole set
  // of points is stored. Coordinates are clamped into the video rectangle.
  setKeyframe(frame, points, { save = true } = {}) {
    if (!isValidPointArray(points, N())) {
      throw new Error(`setKeyframe(${frame}): expected ${N()} points inside 0..1`);
    }
    this.keyframes.set(frame, points.map((p) => [clamp01(p[0]), clamp01(p[1])]));
    if (save) this.scheduleSave();
    return this.keyframes.get(frame);
  }

  // Turn the currently visible (possibly interpolated) pose at `frame` into a
  // real keyframe, leaving its neighbours untouched. No-op if it already is one.
  materialize(frame, { save = true } = {}) {
    if (this.keyframes.has(frame)) return this.keyframes.get(frame);
    return this.setKeyframe(frame, this.poseAt(frame), { save });
  }

  // Move one point of the keyframe at `frame`. The frame must already be a
  // keyframe (call materialize first) so an edit can never leak into a neighbour.
  movePoint(frame, index, nx, ny, { save = true } = {}) {
    const pts = this.keyframes.get(frame);
    if (!pts) throw new Error(`movePoint: frame ${frame} is not a keyframe`);
    if (index < 0 || index >= pts.length) throw new Error(`movePoint: bad index ${index}`);
    pts[index][0] = clamp01(nx);
    pts[index][1] = clamp01(ny);
    if (save) this.scheduleSave();
    return pts;
  }

  deleteKeyframe(frame, { save = true } = {}) {
    const had = this.keyframes.delete(frame);
    if (had && save) this.scheduleSave();
    return had;
  }

  // Copy a neighbour's pose onto `frame` as a new keyframe. `dir` is -1 (previous)
  // or +1 (next). Returns the source frame, or null if there is no neighbour.
  copyFromNeighbour(frame, dir) {
    const src = dir < 0 ? this.prevKeyframe(frame) : this.nextKeyframe(frame);
    if (src === null) return null;
    this.setKeyframe(frame, clonePoints(this.keyframes.get(src)));
    return src;
  }

  // Drop every keyframe except frame 0, re-seeding frame 0 if it was missing.
  clearAllExceptFirst() {
    const first = this.keyframes.get(0);
    this.keyframes.clear();
    this.setKeyframe(0, first ? clonePoints(first) : seedPoints(), { save: false });
    this.scheduleSave();
  }

  replaceAll(entries) {
    this.keyframes.clear();
    for (const [frame, points] of entries) this.setKeyframe(frame, points, { save: false });
    if (!this.keyframes.has(0)) this.setKeyframe(0, seedPoints(), { save: false });
    this.scheduleSave();
  }

  // ----- persistence -------------------------------------------------------

  // Serialized shape kept in localStorage (frame numbers as object keys).
  serialize() {
    const v = CONFIG.video;
    const keyframes = {};
    for (const frame of this.frames()) {
      keyframes[String(frame)] = { points: clonePoints(this.keyframes.get(frame)) };
    }
    return {
      version: 1,
      pointCount: N(),
      video: {
        width: v.width,
        height: v.height,
        fps: v.fps,
        frameCount: v.frameCount,
        duration: v.duration,
      },
      keyframes,
    };
  }

  scheduleSave() {
    clearTimeout(this._saveTimer);
    this.saveState = "saving";
    this._saveTimer = setTimeout(() => this.saveNow(), CONFIG.trackEditor.saveDebounceMs);
  }

  saveNow() {
    clearTimeout(this._saveTimer);
    try {
      localStorage.setItem(CONFIG.trackEditor.storageKey, JSON.stringify(this.serialize()));
      this.saveState = "saved";
      this.lastSaveError = null;
    } catch (err) {
      this.saveState = "error";
      this.lastSaveError = err.message;
      console.error("Tracking autosave failed:", err);
    }
  }

  // Read the autosave slot. Anything that doesn't validate is REJECTED with a
  // clear message rather than silently repaired — a half-loaded tracking is
  // worse than starting over, because you'd edit on top of it without noticing.
  loadFromStorage() {
    let raw;
    try {
      raw = localStorage.getItem(CONFIG.trackEditor.storageKey);
    } catch (err) {
      return { ok: false, status: `localStorage unavailable (${err.message})` };
    }
    if (!raw) return { ok: false, status: "" };

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error(`Saved tracking in "${CONFIG.trackEditor.storageKey}" is not valid JSON:`, err);
      return { ok: false, status: "autosave unreadable (bad JSON)" };
    }

    try {
      const entries = parseKeyframes(parsed, { requirePointCount: N() });
      this.replaceAll(entries);
      this.saveState = "saved";
      return { ok: true, status: `loaded ${entries.length} keyframe(s) from autosave` };
    } catch (err) {
      console.error(`Saved tracking rejected: ${err.message}`);
      return { ok: false, status: `autosave rejected: ${err.message}` };
    }
  }
}

// ---------------------------------------------------------------------------
//  Validation shared by the autosave loader and the JSON importer.
//  Accepts BOTH shapes:
//    keyframes: [{ frame, points }]            (export file)
//    keyframes: { "0": { points } }            (autosave)
//  Returns [[frame, points], ...] sorted by frame, or throws with a clear
//  message naming exactly what was wrong.
// ---------------------------------------------------------------------------
export function parseKeyframes(data, { requirePointCount, checkVideo = true } = {}) {
  if (!data || typeof data !== "object") throw new Error("not an object");
  if (data.version !== 1) throw new Error(`unsupported version ${JSON.stringify(data.version)} (expected 1)`);

  const expected = requirePointCount ?? CONFIG.trackEditor.pointCount;
  if (data.pointCount !== undefined && data.pointCount !== expected) {
    throw new Error(`pointCount is ${data.pointCount}, this editor works with ${expected}`);
  }

  if (checkVideo && data.video) {
    const v = CONFIG.video;
    if (data.video.fps !== undefined && data.video.fps !== v.fps) {
      throw new Error(`fps is ${data.video.fps}, the clip is ${v.fps}`);
    }
    if (data.video.frameCount !== undefined && data.video.frameCount !== v.frameCount) {
      throw new Error(`frameCount is ${data.video.frameCount}, the clip has ${v.frameCount}`);
    }
  }

  // Only `keyframes` is editable data. A file may also carry the 121 evaluated
  // `frames`, but those are OUTPUT — importing them would turn every frame into
  // a keyframe and destroy the interpolation.
  const src = data.keyframes;
  if (!src) throw new Error("no `keyframes` field");

  const raw = Array.isArray(src)
    ? src.map((k) => [k?.frame, k?.points])
    : Object.entries(src).map(([f, k]) => [Number(f), k?.points]);

  if (raw.length === 0) throw new Error("`keyframes` is empty");

  const out = [];
  for (const [frame, points] of raw) {
    if (!Number.isInteger(frame) || frame < 0 || frame >= CONFIG.video.frameCount) {
      throw new Error(`frame ${JSON.stringify(frame)} is outside 0..${CONFIG.video.frameCount - 1}`);
    }
    const problem = pointArrayProblem(points, expected);
    if (problem) throw new Error(`frame ${frame}: ${problem}`);
    out.push([frame, clonePoints(points)]);
  }

  out.sort((a, b) => a[0] - b[0]);
  const dupe = out.find(([f], i) => i > 0 && out[i - 1][0] === f);
  if (dupe) throw new Error(`frame ${dupe[0]} appears more than once`);
  return out;
}
