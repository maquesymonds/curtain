// ============================================================================
//  ANCHOR STORE — where the letters come from, and nothing else.
//
//  An anchor is one point on a branch:
//    { nx, ny, count, spread, len }
//  nx/ny  normalized position in the image (0..1), so it survives any viewport
//  count  how many strands hang from it
//  spread how wide the cluster fans out, in normalized x
//  len    length multiplier for this cluster's strands
//
//  This module owns validation, the localStorage autosave, and turning anchors
//  into the root list HairSystem expects. It knows nothing about drawing.
// ============================================================================

import { CONFIG } from "./config.js";
import { hash } from "../../shared/js/utils.js";
import { roundPairs } from "../../shared/js/jsonFile.js";

const cfg = () => CONFIG.anchors;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = (v) => clamp(v, 0, 1);

// Returns null when the anchor is valid, otherwise a string naming what is wrong.
function anchorProblem(a, index) {
  const where = `anchor ${index}`;
  if (!a || typeof a !== "object") return `${where} is not an object`;
  for (const key of ["nx", "ny"]) {
    if (!Number.isFinite(a[key])) return `${where}: ${key} is not a finite number`;
    if (a[key] < 0 || a[key] > 1) return `${where}: ${key} is outside 0..1 (${a[key]})`;
  }
  if (!Number.isInteger(a.count) || a.count < 1) return `${where}: count must be an integer >= 1`;
  if (!Number.isFinite(a.spread) || a.spread < 0) return `${where}: spread must be >= 0`;
  if (!Number.isFinite(a.len) || a.len <= 0) return `${where}: len must be > 0`;
  return null;
}

export class AnchorStore {
  constructor() {
    this.anchors = [];
    this.saveState = "idle"; // "idle" | "saving" | "saved" | "error"
    this.lastError = null;
    this._timer = null;
  }

  get count() {
    return this.anchors.length;
  }

  // Autosave first, then the shipped file, then empty. Returns a status string.
  async init() {
    const local = this.loadFromStorage();
    if (local.ok) return local.status;

    const file = await this.loadFromFile();
    if (file.ok) return file.status;

    return [local.status, file.status].filter(Boolean).join(" · ") || "no anchors yet — click the tree to place some";
  }

  // ----- mutations ---------------------------------------------------------

  add(nx, ny) {
    const d = cfg().defaults;
    this.anchors.push({
      nx: clamp01(nx),
      ny: clamp01(ny),
      count: d.count,
      spread: d.spread,
      len: d.len,
    });
    this.scheduleSave();
    return this.anchors.length - 1;
  }

  move(index, nx, ny) {
    const a = this.anchors[index];
    if (!a) return;
    a.nx = clamp01(nx);
    a.ny = clamp01(ny);
    this.scheduleSave();
  }

  remove(index) {
    if (index < 0 || index >= this.anchors.length) return false;
    this.anchors.splice(index, 1);
    this.scheduleSave();
    return true;
  }

  // Nudge one property of an anchor, clamped to its configured range.
  adjust(index, key, delta) {
    const a = this.anchors[index];
    if (!a) return;
    const c = cfg();
    if (key === "count") a.count = clamp(Math.round(a.count + delta), c.countRange[0], c.countRange[1]);
    if (key === "spread") a.spread = clamp(a.spread + delta, c.spreadRange[0], c.spreadRange[1]);
    if (key === "len") a.len = clamp(a.len + delta, c.lenRange[0], c.lenRange[1]);
    this.scheduleSave();
  }

  clear() {
    this.anchors = [];
    this.scheduleSave();
  }

  replaceAll(list) {
    this.anchors = list.map((a) => ({
      nx: clamp01(a.nx),
      ny: clamp01(a.ny),
      count: Math.max(1, Math.round(a.count)),
      spread: Math.max(0, a.spread),
      len: Math.max(0.01, a.len),
    }));
    this.scheduleSave();
  }

  // ----- roots -------------------------------------------------------------

  // Expand the anchors into the flat root list HairSystem.build() consumes.
  // Each cluster fans out across `spread`, with a deterministic per-strand
  // scatter so a group reads as foliage rather than as a row of teeth.
  toRoots() {
    const c = cfg();
    const roots = [];
    this.anchors.forEach((a, ai) => {
      for (let i = 0; i < a.count; i++) {
        const f = a.count === 1 ? 0.5 : i / (a.count - 1);
        const seed = ai * 977 + i * 31;
        const jx = (hash(seed) - 0.5) * 2 * c.jitterX;
        const jy = (hash(seed + 0.5) - 0.5) * 2 * c.jitterY;
        roots.push({
          nx: clamp01(a.nx + (f - 0.5) * a.spread + jx),
          ny: clamp01(a.ny + jy),
          // `t` feeds the length profile, which is flat here, and `u` is only
          // used by the horse's moving roots. Length comes from lenScale.
          t: 0,
          u: f,
          lenScale: a.len * (1 + (hash(seed + 0.25) - 0.5) * 0.3),
          anchorIndex: ai,
        });
      }
    });
    return roots;
  }

  // ----- persistence -------------------------------------------------------

  serialize() {
    const d = cfg().exportDecimals;
    const positions = roundPairs(
      this.anchors.map((a) => [a.nx, a.ny]),
      d
    );
    return {
      version: 1,
      image: { ...CONFIG.image },
      anchorCount: this.anchors.length,
      anchors: this.anchors.map((a, i) => ({
        nx: positions[i][0],
        ny: positions[i][1],
        count: a.count,
        spread: Math.round(a.spread * 10 ** d) / 10 ** d,
        len: Math.round(a.len * 10 ** d) / 10 ** d,
      })),
    };
  }

  scheduleSave() {
    clearTimeout(this._timer);
    this.saveState = "saving";
    this._timer = setTimeout(() => this.saveNow(), cfg().saveDebounceMs);
  }

  saveNow() {
    clearTimeout(this._timer);
    try {
      localStorage.setItem(cfg().storageKey, JSON.stringify(this.serialize()));
      this.saveState = "saved";
      this.lastError = null;
    } catch (err) {
      this.saveState = "error";
      this.lastError = err.message;
      console.error("Anchor autosave failed:", err);
    }
  }

  loadFromStorage() {
    let raw;
    try {
      raw = localStorage.getItem(cfg().storageKey);
    } catch (err) {
      return { ok: false, status: `localStorage unavailable (${err.message})` };
    }
    if (!raw) return { ok: false, status: "" };
    try {
      const list = parseAnchors(JSON.parse(raw));
      this.replaceAll(list);
      this.saveState = "saved";
      return { ok: true, status: `loaded ${list.length} anchor(s) from autosave` };
    } catch (err) {
      console.error(`Saved anchors rejected: ${err.message}`);
      return { ok: false, status: `autosave rejected: ${err.message}` };
    }
  }

  // The committed file, used when there is no autosave — e.g. a fresh browser.
  async loadFromFile() {
    const url = cfg().sourceUrl;
    if (!url) return { ok: false, status: "" };
    let res;
    try {
      res = await fetch(url, { cache: "no-cache" });
    } catch (err) {
      return { ok: false, status: "" }; // no file committed yet; not an error
    }
    if (!res.ok) return { ok: false, status: "" };
    try {
      const list = parseAnchors(await res.json());
      this.replaceAll(list);
      return { ok: true, status: `loaded ${list.length} anchor(s) from ${url}` };
    } catch (err) {
      console.error(`${url} rejected: ${err.message}`);
      return { ok: false, status: `${url} rejected: ${err.message}` };
    }
  }
}

// Validate a parsed file. Throws with a message naming exactly what was wrong.
export function parseAnchors(data) {
  if (!data || typeof data !== "object") throw new Error("not an object");
  if (data.version !== 1) throw new Error(`unsupported version ${JSON.stringify(data.version)} (expected 1)`);
  if (!Array.isArray(data.anchors)) throw new Error("no `anchors` array");

  // An empty set is legitimate — you may have cleared it on purpose.
  data.anchors.forEach((a, i) => {
    const problem = anchorProblem(a, i);
    if (problem) throw new Error(problem);
  });
  return data.anchors.map((a) => ({
    nx: a.nx,
    ny: a.ny,
    count: a.count,
    spread: a.spread,
    len: a.len,
  }));
}
