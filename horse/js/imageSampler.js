// ============================================================================
//  IMAGE SAMPLING
//   - loadImage / getImageData helpers
//   - sampleRoots(): read the green mane-root-guide line → strand root points
//   - CollisionField: turn the horse-collision-mask (alpha = solid body) into a
//     fast screen-space grid with an outward push direction for the strands.
// ============================================================================

import { screenToNorm } from "../../shared/js/cover.js";
import { clamp } from "../../shared/js/utils.js";

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load image: ${src}`));
    img.src = src;
  });
}

// Rasterize an image to its natural size once and read back the pixels.
export function getImageData(img) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, w, h);
}

// Walk the guide image column by column; the green stroke marks where the mane
// crest lives. Each column with green pixels contributes one crest point at the
// mean green y. Points come back sorted front→back with a normalized `t` used
// to drive the per-strand length profile.
//
// Returns [{ nx, ny, t }] in normalized (0..1) guide space.
export function sampleRoots(guideData, { strandCount }) {
  const { data, width: w, height: h } = guideData;
  const isGreen = (x, y) => {
    const i = (y * w + x) * 4;
    return data[i + 3] > 128 && data[i + 1] > 140 && data[i] < 160 && data[i + 2] < 160;
  };

  const crest = [];
  for (let x = 0; x < w; x++) {
    let sum = 0;
    let n = 0;
    for (let y = 0; y < h; y++) {
      if (isGreen(x, y)) {
        sum += y;
        n++;
      }
    }
    if (n > 0) crest.push({ x, y: sum / n });
  }
  if (crest.length === 0) return [];

  // front = head/forelock side = higher x; back = shoulder = lower x
  const minX = crest[0].x;
  const maxX = crest[crest.length - 1].x;
  const spanX = Math.max(1, maxX - minX);

  // Resample the dense crest list down to `strandCount` evenly-indexed roots.
  const roots = [];
  for (let s = 0; s < strandCount; s++) {
    const idx = Math.round((s / (strandCount - 1)) * (crest.length - 1));
    const p = crest[idx];
    const t = (maxX - p.x) / spanX; // 0 at front, 1 at shoulder
    roots.push({ nx: p.x / w, ny: p.y / h, t });
  }
  return roots;
}

// Sample roots straight from the bright "mane crest" line baked into the photo
// itself, restricted to the x-range where the mane lives (past that it's just
// the lit face). Because the roots come from the photo, they sit EXACTLY on the
// white line at any viewport size and hide it — no guide alignment needed.
//
// Returns [{ nx, ny, t }] normalized in PHOTO space (front→back via `t`).
export function sampleRootsFromLine(photoData, { strandCount, xRange = [0.33, 0.63] }) {
  const { data, width: w, height: h } = photoData;
  const isWhite = (x, y) => {
    const i = (y * w + x) * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const mn = Math.min(r, g, b);
    const mx = Math.max(r, g, b);
    return mn > 195 && mx - mn < 34; // bright & near-neutral = the crest line
    // (strict: the lit face is bright too but slightly pink, so it's excluded)
  };

  const x0 = Math.floor(xRange[0] * w);
  const x1 = Math.ceil(xRange[1] * w);
  const yMax = Math.floor(h * 0.72);

  // topmost thin near-white run per column
  const raw = [];
  for (let x = x0; x <= x1; x++) {
    let inRun = false;
    let start = 0;
    let found = -1;
    for (let y = 0; y < yMax; y++) {
      const white = isWhite(x, y);
      if (white && !inRun) {
        inRun = true;
        start = y;
      } else if (!white && inRun) {
        inRun = false;
        if (y - start >= 1 && y - start <= 16) {
          found = (start + y) / 2;
          break; // keep only the topmost run
        }
      }
    }
    if (found >= 0) raw.push({ x, y: found });
  }
  if (raw.length === 0) return [];

  // smooth out jitter/outliers with a small median window
  const smooth = raw.map((p, i) => {
    const win = [];
    for (let k = -3; k <= 3; k++) {
      const q = raw[i + k];
      if (q) win.push(q.y);
    }
    win.sort((a, b) => a - b);
    return { x: p.x, y: win[win.length >> 1] };
  });

  const minX = smooth[0].x;
  const maxX = smooth[smooth.length - 1].x;
  const span = Math.max(1, maxX - minX);

  // sample the horse's own colour a little BELOW the line (into the body) so we
  // can paint over the white line with a matte colour that blends away.
  const below = Math.round(h * 0.026); // sample well clear of the bright ridge
  const sampleRGB = (x, y) => {
    const i = (Math.min(h - 1, y) * w + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };

  const roots = [];
  for (let s = 0; s < strandCount; s++) {
    const idx = Math.round((s / (strandCount - 1)) * (smooth.length - 1));
    const p = smooth[idx];
    roots.push({
      nx: p.x / w,
      ny: p.y / h,
      t: (maxX - p.x) / span,
      cover: sampleRGB(p.x, p.y + below),
    });
  }
  return roots;
}

// ----------------------------------------------------------------------------

export class CollisionField {
  constructor(maskData) {
    this.mask = maskData; // ImageData in mask-pixel space (alpha = solid)
    this.cols = 0;
    this.rows = 0;
    this.cell = 1;
    this.field = null; // Float32Array smoothed occupancy 0..1
  }

  _maskAlphaAtNorm(nx, ny) {
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return 0;
    const mx = clamp((nx * this.mask.width) | 0, 0, this.mask.width - 1);
    const my = clamp((ny * this.mask.height) | 0, 0, this.mask.height - 1);
    return this.mask.data[(my * this.mask.width + mx) * 4 + 3];
  }

  // Build a screen-space occupancy grid, then box-blur it a couple of times so
  // its gradient gives a smooth outward normal for pushing strands off the body.
  build(cover, align, viewW, viewH, cell) {
    this.cell = cell;
    this.cols = Math.ceil(viewW / cell) + 1;
    this.rows = Math.ceil(viewH / cell) + 1;
    const cols = this.cols;
    const rows = this.rows;

    let occ = new Float32Array(cols * rows);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const sx = i * cell;
        const sy = j * cell;
        const { nx, ny } = screenToNorm(sx, sy, cover, align);
        occ[j * cols + i] = this._maskAlphaAtNorm(nx, ny) > 128 ? 1 : 0;
      }
    }
    // two light box-blur passes for a soft distance-ish field
    for (let pass = 0; pass < 2; pass++) occ = this._blur(occ, cols, rows);
    this.field = occ;
  }

  _blur(src, cols, rows) {
    const out = new Float32Array(cols * rows);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        let sum = 0;
        let n = 0;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const ii = i + di;
            const jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= cols || jj >= rows) continue;
            sum += src[jj * cols + ii];
            n++;
          }
        }
        out[j * cols + i] = sum / n;
      }
    }
    return out;
  }

  _sample(sx, sy) {
    if (!this.field) return 0;
    const i = clamp(Math.round(sx / this.cell), 0, this.cols - 1);
    const j = clamp(Math.round(sy / this.cell), 0, this.rows - 1);
    return this.field[j * this.cols + i];
  }

  // If (sx,sy) is inside the body, return an outward push vector; else null.
  resolve(sx, sy, threshold = 0.5) {
    const here = this._sample(sx, sy);
    if (here < threshold) return null;
    const e = this.cell;
    // gradient of occupancy; body is "high", so outward = -gradient
    const gx = this._sample(sx + e, sy) - this._sample(sx - e, sy);
    const gy = this._sample(sx, sy + e) - this._sample(sx, sy - e);
    let nx = -gx;
    let ny = -gy;
    const len = Math.hypot(nx, ny);
    if (len < 1e-4) {
      nx = 0;
      ny = -1; // fallback: push up toward the crest
    } else {
      nx /= len;
      ny /= len;
    }
    return { nx, ny, depth: here };
  }
}
