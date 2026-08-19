export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const lerp = (a, b, t) => a + (b - a) * t;

// Smooth Hermite interpolation between edge0 and edge1.
export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// Deterministic hash → 0..1, for stable per-strand/per-particle variation.
export function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// Sample a piecewise-linear profile array at t in 0..1.
export function sampleProfile(profile, t) {
  if (profile.length === 1) return profile[0];
  const x = clamp(t, 0, 1) * (profile.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = profile[i];
  const b = profile[Math.min(i + 1, profile.length - 1)];
  return lerp(a, b, f);
}

// ---------------------------------------------------------------------------
//  CONFIG PATHS
//
//  Dotted, with numeric segments for arrays: "gravity", "depth.haze.1",
//  "lengthRange.0", "maneShape.whorl.strength". Arrays are addressed by index on
//  purpose — it is how a [min, max] pair becomes two sliders without inventing a
//  parallel config shape for a panel's benefit.
//
//  Shared by the two things that write into CONFIG from outside: the authoring
//  panel (controls.js) and the visitor's knobs (tune.js).
// ---------------------------------------------------------------------------
export function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
}

export function setPath(obj, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  const target = keys.reduce((o, k) => o[k], obj);
  target[last] = value;
}
