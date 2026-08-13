// ============================================================================
//  STRAND STORE — individually authored strands, placed and sized by hand.
//
//  Where AnchorStore holds CLUSTERS (a point that spawns N auto-generated
//  strands), this holds single strands, one at a time: { nx, ny, lengthPx }.
//  Position is normalized (0..1 in the image); length is in css px, same
//  convention CONFIG.lengthRange already uses elsewhere in the app — it is NOT
//  scaled by the cover transform, so a strand is the same physical length
//  regardless of window size, exactly like every other length in this codebase.
//
//  Combines with AnchorStore's output in main.js: nothing here replaces
//  anchors, it adds to them.
// ============================================================================

import { CONFIG } from "./config.js";
import { roundPairs } from "../../shared/js/jsonFile.js";
import { fingerprint, chooseSource } from "../../shared/js/syncedStore.js";

const cfg = () => CONFIG.strands;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = (v) => clamp(v, 0, 1);
const clampZ = (v) => clamp(v, -1, 1);
const clampLen = (px) => clamp(px, cfg().minLengthPx, cfg().maxLengthPx);

// How many characters a length in px will actually render as, given the shared
// physics config — the same formula Strand's constructor uses. Shown live in
// the editor so "how long" reads as "how many letters" the way you think of it.
export function charCountForLength(lengthPx) {
  const raw = Math.round(lengthPx / CONFIG.segmentLength);
  return clamp(raw, CONFIG.minParticles, CONFIG.maxParticles);
}

function strandProblem(s, index) {
  const where = `strand ${index}`;
  if (!s || typeof s !== "object") return `${where} is not an object`;
  for (const key of ["nx", "ny"]) {
    if (!Number.isFinite(s[key])) return `${where}: ${key} is not a finite number`;
    if (s[key] < 0 || s[key] > 1) return `${where}: ${key} is outside 0..1 (${s[key]})`;
  }
  if (!Number.isFinite(s.lengthPx) || s.lengthPx <= 0) return `${where}: lengthPx must be > 0`;
  // z is optional: files written before depth existed simply have none. It spans
  // -1..1, where negative means a highlight nearer than the front plane.
  if (s.z !== undefined && (!Number.isFinite(s.z) || s.z < -1 || s.z > 1)) {
    return `${where}: z must be between -1 and 1`;
  }
  if (s.windGain !== undefined && (!Number.isFinite(s.windGain) || s.windGain < 0)) {
    return `${where}: windGain must be >= 0`;
  }
  if (s.drape !== undefined && (!Number.isFinite(s.drape) || s.drape < -1 || s.drape > 1)) {
    return `${where}: drape must be between -1 and 1`;
  }
  if (s.zTip !== undefined && (!Number.isFinite(s.zTip) || s.zTip < -1 || s.zTip > 1)) {
    return `${where}: zTip must be between -1 and 1`;
  }
  return null;
}

export class StrandStore {
  constructor() {
    this.strands = [];
    this.saveState = "idle";
    this.lastError = null;
    // Fingerprint of the project file this draft descends from; null until one is
    // read or written. See shared/js/syncedStore.js.
    this.syncedFingerprint = null;
    this._timer = null;
  }

  get count() {
    return this.strands.length;
  }

  // Read BOTH sources and let the fingerprint decide which one is current — see
  // shared/js/syncedStore.js. Preferring the autosave unconditionally meant that
  // once the project file changed from outside (a regenerated set, another
  // window, a file installed by hand) this browser silently kept showing its own
  // stale draft, and writing the file appeared to do nothing.
  async init() {
    const file = await this.readFile();
    const local = this.readStorage();
    const chosen = chooseSource(file, local, "strand");

    this.replaceAll(chosen.list, { save: false });
    this.syncedFingerprint = file.ok ? file.fingerprint : null;

    // If the file won, persist the decision so the next reload can trust the
    // draft again instead of re-reading the file every time.
    if (chosen.source === "file") this.saveNow();
    else this.saveState = local.ok ? "saved" : "idle";

    return chosen.status || "no hand-placed strands yet";
  }

  // The fingerprint of the strand list as it currently stands.
  currentFingerprint() {
    return fingerprint(this.serialize().strands);
  }

  // Called after the SAVE button successfully writes the file, so the draft is
  // marked as descending from what was just written.
  markSyncedToFile() {
    this.syncedFingerprint = this.currentFingerprint();
    this.saveNow();
  }

  // ----- mutations ---------------------------------------------------------

  add(nx, ny, lengthPx, z = 0) {
    this.strands.push({ nx: clamp01(nx), ny: clamp01(ny), lengthPx: clampLen(lengthPx), z: clampZ(z), windGain: 1 });
    this.scheduleSave();
    return this.strands.length - 1;
  }

  moveRoot(index, nx, ny) {
    const s = this.strands[index];
    if (!s) return;
    s.nx = clamp01(nx);
    s.ny = clamp01(ny);
    this.scheduleSave();
  }

  setLength(index, lengthPx) {
    const s = this.strands[index];
    if (!s) return;
    s.lengthPx = clampLen(lengthPx);
    this.scheduleSave();
  }

  adjustLengthBySegments(index, deltaSegments) {
    const s = this.strands[index];
    if (!s) return;
    s.lengthPx = clampLen(s.lengthPx + deltaSegments * CONFIG.segmentLength);
    this.scheduleSave();
  }

  remove(index) {
    if (index < 0 || index >= this.strands.length) return false;
    this.strands.splice(index, 1);
    this.scheduleSave();
    return true;
  }

  clear() {
    this.strands = [];
    this.scheduleSave();
  }

  replaceAll(list, { save = true } = {}) {
    this.strands = list.map((s) => ({
      nx: clamp01(s.nx),
      ny: clamp01(s.ny),
      lengthPx: clampLen(s.lengthPx),
      z: clampZ(s.z ?? 0),
      zTip: clampZ(s.zTip ?? s.z ?? 0),
      windGain: Math.max(0, s.windGain ?? 1),
      drape: clampZ(s.drape ?? 0),
    }));
    if (save) this.scheduleSave();
  }

  // ----- roots ---------------------------------------------------------------

  // Flat root list for HairSystem.build(). `t`/`u` are unused here (this is a
  // still image, and length is absolute, not profile-driven) but kept present
  // because HairSystem reads them unconditionally.
  toRoots() {
    return this.strands.map((s, i) => ({
      nx: s.nx,
      ny: s.ny,
      t: 0,
      u: this.strands.length === 1 ? 0 : i / (this.strands.length - 1),
      lengthPx: s.lengthPx,
      z: s.z ?? 0,
      zTip: s.zTip ?? s.z ?? 0,
      windGain: s.windGain ?? 1,
      drape: s.drape ?? 0,
    }));
  }

  // ----- persistence -------------------------------------------------------

  serialize() {
    const d = cfg().exportDecimals;
    const positions = roundPairs(
      this.strands.map((s) => [s.nx, s.ny]),
      d
    );
    return {
      version: 1,
      strandCount: this.strands.length,
      strands: this.strands.map((s, i) => ({
        nx: positions[i][0],
        ny: positions[i][1],
        lengthPx: Math.round(s.lengthPx * 10) / 10,
        z: Math.round((s.z ?? 0) * 1000) / 1000,
        zTip: Math.round((s.zTip ?? s.z ?? 0) * 1000) / 1000,
        windGain: Math.round((s.windGain ?? 1) * 100) / 100,
        drape: Math.round((s.drape ?? 0) * 1000) / 1000,
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
      // The autosave carries `fileFingerprint`, the project file this draft came
      // from. The FILE itself never carries it — it would be self-referential and
      // would change the very fingerprint it records.
      const payload = { ...this.serialize(), fileFingerprint: this.syncedFingerprint ?? null };
      localStorage.setItem(cfg().storageKey, JSON.stringify(payload));
      this.saveState = "saved";
      this.lastError = null;
    } catch (err) {
      this.saveState = "error";
      this.lastError = err.message;
      console.error("Strand autosave failed:", err);
    }
  }

  // Read the autosave WITHOUT applying it. `fingerprint` is the project file this
  // draft was last in sync with, or null if it was never synced.
  readStorage() {
    let raw;
    try {
      raw = localStorage.getItem(cfg().storageKey);
    } catch (err) {
      return { ok: false, list: [], fingerprint: null };
    }
    if (!raw) return { ok: false, list: [], fingerprint: null };
    try {
      const parsed = JSON.parse(raw);
      return {
        ok: true,
        list: parseStrands(parsed),
        fingerprint: parsed.fileFingerprint ?? null,
      };
    } catch (err) {
      console.error(`Saved strands rejected: ${err.message}`);
      return { ok: false, list: [], fingerprint: null };
    }
  }

  // Read the committed project file WITHOUT applying it.
  async readFile() {
    const url = cfg().sourceUrl;
    if (!url) return { ok: false, list: [], fingerprint: null };
    let res;
    try {
      res = await fetch(url, { cache: "no-cache" });
    } catch {
      return { ok: false, list: [], fingerprint: null }; // nothing committed yet
    }
    if (!res.ok) return { ok: false, list: [], fingerprint: null };
    try {
      const parsed = await res.json();
      const list = parseStrands(parsed);
      // Fingerprint the same shape serialize() produces, so a file this browser
      // wrote fingerprints identically when read back.
      return { ok: true, list, fingerprint: fingerprint(parsed.strands), raw: parsed };
    } catch (err) {
      console.error(`${url} rejected: ${err.message}`);
      return { ok: false, list: [], fingerprint: null };
    }
  }
}

export function parseStrands(data) {
  if (!data || typeof data !== "object") throw new Error("not an object");
  if (data.version !== 1) throw new Error(`unsupported version ${JSON.stringify(data.version)} (expected 1)`);
  if (!Array.isArray(data.strands)) throw new Error("no `strands` array");

  data.strands.forEach((s, i) => {
    const problem = strandProblem(s, i);
    if (problem) throw new Error(problem);
  });
  return data.strands.map((s) => ({
    nx: s.nx,
    ny: s.ny,
    lengthPx: s.lengthPx,
    z: s.z ?? 0,
    zTip: s.zTip ?? s.z ?? 0,
    windGain: s.windGain ?? 1,
    drape: s.drape ?? 0,
  }));
}
