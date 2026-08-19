// ============================================================================
//  HOLDOUT STORE — the editable "tapar" zone data, and nothing else.
//
//  Mirrors trackingStore.js: keyframes are keyed by INTEGER FRAME NUMBER, each
//  holding the full set of zones (never a partial edit). Frames with no keyframe
//  are evaluated by interpolating the surrounding pair.
//
//  One difference from the crest curve: a zone is a TRIO [nx, ny, r], not a pair
//  [x, y], so poseFromKeyframes from trackingStore.js (hardcoded to pairs) can't
//  be reused as-is — holdoutPoseFromKeyframes below is the same rule for 3
//  components instead of 2.
//
//  This module owns validation and the localStorage autosave. It knows nothing
//  about drawing, the DOM, the canvas or the video element.
// ============================================================================

import { CONFIG } from "./config.js";
import { smoothstep } from "../../shared/js/utils.js";

const N = () => CONFIG.holdoutEditor.zoneCount;

// Deep copy so callers can never alias a stored keyframe and mutate it by accident.
const cloneZones = (zones) => zones.map((z) => ({ nx: z.nx, ny: z.ny, r: z.r }));

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clampR = (v) => (v < 0 ? 0 : v);

// Returns null when the array is a valid set of zones, otherwise a string naming
// exactly what is wrong.
function zonesProblem(zones, expected) {
  if (!Array.isArray(zones)) return `zones is ${typeof zones}, expected an array`;
  if (zones.length !== expected) return `has ${zones.length} zone(s), needs exactly ${expected}`;
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    if (!z || typeof z !== "object") return `zone ${i} is not an object`;
    for (const key of ["nx", "ny", "r"]) {
      if (!Number.isFinite(z[key])) return `zone ${i}: ${key} is not a finite number`;
    }
    if (z.nx < 0 || z.nx > 1 || z.ny < 0 || z.ny > 1) {
      return `zone ${i}: nx/ny outside 0..1 (${z.nx}, ${z.ny})`;
    }
    if (z.r < 0) return `zone ${i}: r must be >= 0 (${z.r})`;
  }
  return null;
}

const isValidZones = (zones, expected) => zonesProblem(zones, expected) === null;

// The seed: CONFIG.holdout.zones as authored today, so the editor opens with the
// circle already near the ear instead of at (0,0). Purely a starting position.
export function seedZones() {
  const authored = CONFIG.holdout.zones || [];
  const n = N();
  const out = [];
  for (let i = 0; i < n; i++) {
    const z = authored[i];
    out.push(z ? { nx: z.nx, ny: z.ny, r: z.r } : { nx: 0.5, ny: 0.5, r: 0.04 });
  }
  return out;
}

// ---------------------------------------------------------------------------
//  The one interpolation rule, shared by the editor and by playback so what you
//  see while authoring is exactly what the holdout mask gets at runtime.
//
//  Exact keyframe -> those zones. Between two keyframes -> smoothstep blend, per
//  zone, per component. Only one side available -> hold that pose. No keyframes
//  -> null. Always returns a fresh array; callers can never write into stored data.
// ---------------------------------------------------------------------------
export function holdoutPoseFromKeyframes(keyframes, frame) {
  if (keyframes.size === 0) return null;
  const exact = keyframes.get(frame);
  if (exact) return cloneZones(exact);

  let a = null;
  let b = null;
  for (const f of keyframes.keys()) {
    if (f < frame && (a === null || f > a)) a = f;
    if (f > frame && (b === null || f < b)) b = f;
  }
  if (a === null) return cloneZones(keyframes.get(b));
  if (b === null) return cloneZones(keyframes.get(a));

  const za = keyframes.get(a);
  const zb = keyframes.get(b);
  const t = smoothstep(0, 1, (frame - a) / (b - a));
  return za.map((z, i) => ({
    nx: z.nx + (zb[i].nx - z.nx) * t,
    ny: z.ny + (zb[i].ny - z.ny) * t,
    r: z.r + (zb[i].r - z.r) * t,
  }));
}

export class HoldoutStore {
  constructor() {
    this.keyframes = new Map(); // frame:int -> zones[N]
    this.lastSaveError = null;
    this.saveState = "idle"; // "idle" | "saving" | "saved" | "error"
    this._saveTimer = null;
  }

  // ----- lifecycle ---------------------------------------------------------

  init() {
    const loaded = this.loadFromStorage();
    if (loaded.ok) return loaded.status;

    this.keyframes.clear();
    this.setKeyframe(0, seedZones(), { save: true });
    return loaded.status ? `${loaded.status} — started from the seed zone` : "new session, frame 0 seeded";
  }

  // ----- queries -----------------------------------------------------------

  get count() {
    return this.keyframes.size;
  }

  hasKeyframe(frame) {
    return this.keyframes.has(frame);
  }

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

  poseAt(frame) {
    return holdoutPoseFromKeyframes(this.keyframes, frame) ?? seedZones();
  }

  kindAt(frame) {
    return this.keyframes.has(frame) ? "keyframe" : "interpolated";
  }

  // ----- mutations ---------------------------------------------------------

  setKeyframe(frame, zones, { save = true } = {}) {
    if (!isValidZones(zones, N())) {
      throw new Error(`setKeyframe(${frame}): expected ${N()} zone(s)`);
    }
    this.keyframes.set(
      frame,
      zones.map((z) => ({ nx: clamp01(z.nx), ny: clamp01(z.ny), r: clampR(z.r) }))
    );
    if (save) this.scheduleSave();
    return this.keyframes.get(frame);
  }

  materialize(frame, { save = true } = {}) {
    if (this.keyframes.has(frame)) return this.keyframes.get(frame);
    return this.setKeyframe(frame, this.poseAt(frame), { save });
  }

  // Move one point of one zone at `frame`. `which` is "center" (sets nx/ny) or
  // "edge" (sets r, from the screen-space distance to the center — see
  // holdoutEditor.js, which does that conversion before calling this). The frame
  // must already be a keyframe (call materialize first).
  moveZoneCenter(frame, zoneIndex, nx, ny, { save = true } = {}) {
    const zones = this.keyframes.get(frame);
    if (!zones) throw new Error(`moveZoneCenter: frame ${frame} is not a keyframe`);
    const z = zones[zoneIndex];
    if (!z) throw new Error(`moveZoneCenter: bad zone index ${zoneIndex}`);
    z.nx = clamp01(nx);
    z.ny = clamp01(ny);
    if (save) this.scheduleSave();
    return z;
  }

  setZoneRadius(frame, zoneIndex, r, { save = true } = {}) {
    const zones = this.keyframes.get(frame);
    if (!zones) throw new Error(`setZoneRadius: frame ${frame} is not a keyframe`);
    const z = zones[zoneIndex];
    if (!z) throw new Error(`setZoneRadius: bad zone index ${zoneIndex}`);
    z.r = clampR(r);
    if (save) this.scheduleSave();
    return z;
  }

  deleteKeyframe(frame, { save = true } = {}) {
    const had = this.keyframes.delete(frame);
    if (had && save) this.scheduleSave();
    return had;
  }

  copyFromNeighbour(frame, dir) {
    const src = dir < 0 ? this.prevKeyframe(frame) : this.nextKeyframe(frame);
    if (src === null) return null;
    this.setKeyframe(frame, cloneZones(this.keyframes.get(src)));
    return src;
  }

  clearAllExceptFirst() {
    const first = this.keyframes.get(0);
    this.keyframes.clear();
    this.setKeyframe(0, first ? cloneZones(first) : seedZones(), { save: false });
    this.scheduleSave();
  }

  replaceAll(entries) {
    this.keyframes.clear();
    for (const [frame, zones] of entries) this.setKeyframe(frame, zones, { save: false });
    if (!this.keyframes.has(0)) this.setKeyframe(0, seedZones(), { save: false });
    this.scheduleSave();
  }

  // ----- persistence -------------------------------------------------------

  serialize() {
    const v = CONFIG.video;
    const keyframes = {};
    for (const frame of this.frames()) {
      keyframes[String(frame)] = { zones: cloneZones(this.keyframes.get(frame)) };
    }
    return {
      version: 1,
      zoneCount: N(),
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
    this._saveTimer = setTimeout(() => this.saveNow(), CONFIG.holdoutEditor.saveDebounceMs);
  }

  saveNow() {
    clearTimeout(this._saveTimer);
    try {
      localStorage.setItem(CONFIG.holdoutEditor.storageKey, JSON.stringify(this.serialize()));
      this.saveState = "saved";
      this.lastSaveError = null;
    } catch (err) {
      this.saveState = "error";
      this.lastSaveError = err.message;
      console.error("Holdout autosave failed:", err);
    }
  }

  loadFromStorage() {
    let raw;
    try {
      raw = localStorage.getItem(CONFIG.holdoutEditor.storageKey);
    } catch (err) {
      return { ok: false, status: `localStorage unavailable (${err.message})` };
    }
    if (!raw) return { ok: false, status: "" };

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error(`Saved holdout in "${CONFIG.holdoutEditor.storageKey}" is not valid JSON:`, err);
      return { ok: false, status: "autosave unreadable (bad JSON)" };
    }

    try {
      const entries = parseHoldoutKeyframes(parsed, { requireZoneCount: N() });
      this.replaceAll(entries);
      this.saveState = "saved";
      return { ok: true, status: `loaded ${entries.length} keyframe(s) from autosave` };
    } catch (err) {
      console.error(`Saved holdout rejected: ${err.message}`);
      return { ok: false, status: `autosave rejected: ${err.message}` };
    }
  }
}

// ---------------------------------------------------------------------------
//  Validation shared by the autosave loader, the JSON importer and the boot-time
//  loader in main.js. Accepts BOTH shapes:
//    keyframes: [{ frame, zones }]           (export file)
//    keyframes: { "0": { zones } }           (autosave)
//  Returns [[frame, zones], ...] sorted by frame, or throws with a clear message
//  naming exactly what was wrong.
// ---------------------------------------------------------------------------
export function parseHoldoutKeyframes(data, { requireZoneCount, checkVideo = true } = {}) {
  if (!data || typeof data !== "object") throw new Error("not an object");
  if (data.version !== 1) throw new Error(`unsupported version ${JSON.stringify(data.version)} (expected 1)`);

  const expected = requireZoneCount ?? CONFIG.holdoutEditor.zoneCount;
  if (data.zoneCount !== undefined && data.zoneCount !== expected) {
    throw new Error(`zoneCount is ${data.zoneCount}, this editor works with ${expected}`);
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

  const src = data.keyframes;
  if (!src) throw new Error("no `keyframes` field");

  const raw = Array.isArray(src)
    ? src.map((k) => [k?.frame, k?.zones])
    : Object.entries(src).map(([f, k]) => [Number(f), k?.zones]);

  if (raw.length === 0) throw new Error("`keyframes` is empty");

  const out = [];
  for (const [frame, zones] of raw) {
    if (!Number.isInteger(frame) || frame < 0 || frame >= CONFIG.video.frameCount) {
      throw new Error(`frame ${JSON.stringify(frame)} is outside 0..${CONFIG.video.frameCount - 1}`);
    }
    const problem = zonesProblem(zones, expected);
    if (problem) throw new Error(`frame ${frame}: ${problem}`);
    out.push([frame, cloneZones(zones)]);
  }

  out.sort((a, b) => a[0] - b[0]);
  const dupe = out.find(([f], i) => i > 0 && out[i - 1][0] === f);
  if (dupe) throw new Error(`frame ${dupe[0]} appears more than once`);
  return out;
}
