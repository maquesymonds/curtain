// ============================================================================
//  BRANCH SAMPLER — read the tree out of the base image and hang strands on it.
//
//  Placing the hundreds of strands needed to read as foliage is not something
//  anyone should do by hand. This finds the tree's own branches in the picture
//  and roots strands ON them, each hanging as far as its own branch allows.
//
//  Separating tree from background is done on the GREEN/BLUE RATIO, not on
//  brightness: the upper twigs are dark silhouettes against a night sky, so a
//  luminance threshold finds the lit trunk and misses the whole top of the tree,
//  while a bright cloud would pass it. See the measured numbers in config.js.
//
//  HOW ROOTS ARE CHOSEN — this is the part that was rebuilt.
//
//  The first version worked per column and reduced each one to two numbers, the
//  crown's smoothed top and its bottom, then placed roots at a FRACTION of that
//  span (`rootFrom` + `rootSpread`). Nothing knew where the branches actually
//  were, so roots landed on smooth contour curves parallel to the crown outline,
//  interpolated through open sky. Measured on the 464 strands it produced, 80% of
//  them were born between ny 0.19 and 0.48 — a narrow band across the top — and
//  each one was long (median 315px). A narrow band of long strands is a
//  continuous curtain, and it buried the tree's own branch structure.
//
//  This version keeps the run structure the mask already contains. Within one
//  column, consecutive tree rows form RUNS, and a run is a branch crossing that
//  column. Sampling points along those runs gives ~24k candidate roots spread
//  over the full height of the canopy (ny 0.00 to 0.80, measured), every one of
//  them on a real branch pixel. Strands are then short, taking a fraction of the
//  room below their own root, so the branches stay readable between them.
//
//  Two things have to be filtered out of the candidates:
//    stars   a white star has a green/blue ratio near 1.0, so it passes the
//            colour test. Small connected components are dropped, which removes
//            them along with sensor speckle — the tree is one large component.
//    trunk   nothing should hang off the trunk itself. Measured, the horizontal
//            width of the structure is 2px at the median and 9px at p90, while
//            the trunk runs 33-109px, so a width threshold separates them
//            cleanly.
//
//  Output is the same { nx, ny, lengthPx } shape StrandStore already holds, so
//  generated strands are ordinary strands: individually draggable, resizable and
//  deletable in the editor.
// ============================================================================

import { CONFIG } from "./config.js";
import { clamp, hash, sampleProfile } from "../../shared/js/utils.js";

// Pull the pixels once, at reduced resolution. Returns the raw tree mask.
function buildMask(imgEl) {
  const cfg = CONFIG.branchSampler;
  const w = Math.max(1, Math.round(CONFIG.image.width * cfg.analyzeScale));
  const h = Math.max(1, Math.round(CONFIG.image.height * cfg.analyzeScale));

  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(imgEl, 0, 0, w, h);
  const { data } = g.getImageData(0, 0, w, h);

  const mask = new Uint8Array(w * h);
  const grassRow = Math.floor(cfg.grassY * h);
  for (let y = 0; y < grassRow; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = data[i];
      const gr = data[i + 1];
      const b = data[i + 2];
      if ((r + gr + b) / 3 < cfg.minLum) continue;
      if (gr >= b * cfg.gbRatio) mask[y * w + x] = 1;
    }
  }
  return { mask, w, h };
}

// Drop every connected blob smaller than `minComponentPx`. The tree — trunk,
// branches and twigs — is one big 8-connected component; stars and speckle are
// blobs of a few pixels. Iterative flood fill, because a recursive one blows the
// stack on a component this size.
function dropSpecks(mask, w, h, minComponentPx) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const blob = new Int32Array(1024);
  let dropped = 0;

  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    let sp = 0;
    let n = 0;
    stack[sp++] = i;
    seen[i] = 1;
    let big = false;
    while (sp > 0) {
      const p = stack[--sp];
      if (n < blob.length) blob[n] = p;
      n++;
      if (n > minComponentPx) big = true; // no need to keep collecting
      const px = p % w;
      const py = (p - px) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = py + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = px + dx;
          if (xx < 0 || xx >= w) continue;
          const q = yy * w + xx;
          if (mask[q] && !seen[q]) {
            seen[q] = 1;
            stack[sp++] = q;
          }
        }
      }
    }
    // Small enough to be a star: erase it. Only reachable when the whole blob
    // fit in `blob`, which is guaranteed since `big` is set well before that.
    if (!big) {
      for (let k = 0; k < Math.min(n, blob.length); k++) mask[blob[k]] = 0;
      dropped++;
    }
  }
  return dropped;
}

// Horizontal extent of the structure through (x, y). The trunk is wide, a branch
// is not, so this is what tells them apart.
function widthAt(mask, w, x, y) {
  const row = y * w;
  let a = x;
  let b = x;
  while (a > 0 && mask[row + a - 1]) a--;
  while (b < w - 1 && mask[row + b + 1]) b++;
  return b - a + 1;
}

// Summed-area table over the mask, so "how much tree is around this point" is
// four lookups instead of a scan. One extra row and column of zeros, the usual
// way, to avoid bounds checks at the edges.
function integralOf(mask, w, h) {
  const iw = w + 1;
  const sat = new Int32Array(iw * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += mask[y * w + x];
      sat[(y + 1) * iw + (x + 1)] = sat[y * iw + (x + 1)] + rowSum;
    }
  }
  return { sat, iw };
}

// Fraction of pixels that are tree, in a box of side 2r+1 centred on (x, y).
function localDensity({ sat, iw }, w, h, x, y, r) {
  const x0 = Math.max(0, x - r);
  const y0 = Math.max(0, y - r);
  const x1 = Math.min(w, x + r + 1);
  const y1 = Math.min(h, y + r + 1);
  const area = (x1 - x0) * (y1 - y0);
  if (area <= 0) return 0;
  const s = sat[y1 * iw + x1] - sat[y0 * iw + x1] - sat[y1 * iw + x0] + sat[y0 * iw + x0];
  return s / area;
}

// Every place a strand could be born: points along the runs, on real branch
// pixels, minus the trunk. Returns analyze-space coords.
function buildCandidates(mask, w, h, cfg) {
  const x0 = Math.floor(cfg.xRange[0] * w);
  const x1 = Math.ceil(cfg.xRange[1] * w);
  const step = Math.max(1, cfg.rootStepPx);
  const out = [];

  // Roots need company. A twig tip poking out of the crown's silhouette is a
  // perfectly good branch pixel, but a strand born there hangs in open sky with
  // nothing around it, and its lit first characters read as loose letters
  // floating beside the tree rather than as part of a liana.
  const sat = integralOf(mask, w, h);
  const r = Math.max(1, cfg.rootDensityRadiusPx);

  for (let x = x0; x < x1; x++) {
    let y = 0;
    while (y < h) {
      if (!mask[y * w + x]) {
        y++;
        continue;
      }
      // extent of this run, tolerating a 1px hole so a faint twig stays one run
      let end = y;
      while (end + 1 < h && (mask[(end + 1) * w + x] || (end + 2 < h && mask[(end + 2) * w + x]))) end++;

      const usable = (ry) =>
        widthAt(mask, w, x, ry) <= cfg.maxRootWidthPx && // not the trunk
        localDensity(sat, w, h, x, ry, r) >= cfg.rootMinDensity; // not out in the sky

      for (let ry = y; ry <= end; ry += step) {
        if (usable(ry)) out.push({ x, y: ry, foot: false });
      }
      // The foot of a run is the UNDERSIDE of a branch, and it is marked, because
      // that is where a real frond hangs from. It also happens to be the thing that
      // makes births read as a row: a branch runs roughly horizontally, so the feet
      // of its runs across neighbouring columns sit at nearly the same y. Giving
      // these priority in the selection below is what draws the horizontal lines of
      // origin instead of a field of unrelated points.
      if (end - y > step && usable(end)) out.push({ x, y: end, foot: true });
      y = end + 1;
    }
  }
  return out;
}

// Roots for the whole tree, in normalized image coords plus a screen-px length.
//
// `coverDrawH` is the on-screen height of the image's cover rectangle: lengths
// are stored in css px (the same convention as every hand-placed strand), so the
// normalized vertical distance found in the image has to be converted through
// the current cover. Generating at a very different window size therefore yields
// slightly different lengths — harmless, but worth knowing.
export function sampleBranchStrands(imgEl, coverDrawW, coverDrawH) {
  const cfg = CONFIG.branchSampler;
  const lim = CONFIG.strands;
  const { mask, w, h } = buildMask(imgEl);
  dropSpecks(mask, w, h, cfg.minComponentPx);

  const candidates = buildCandidates(mask, w, h, cfg);
  if (!candidates.length) return [];

  const pxPerImageCol = coverDrawW / w;
  const x0 = Math.floor(cfg.xRange[0] * w);
  const x1 = Math.ceil(cfg.xRange[1] * w);

  // Horizontal centre of the tree, weighted by how much tree each column holds:
  // the axis strands drape AWAY from, so the crown opens outward instead of
  // hanging as parallel bars.
  let cxSum = 0;
  let cxN = 0;
  for (const p of candidates) {
    cxSum += p.x;
    cxN++;
  }
  const centerX = cxN ? cxSum / cxN : (x0 + x1) / 2;
  const halfWidth = Math.max(1, Math.max(centerX - x0, x1 - centerX));

  // A slow, smooth pseudo-random field across x, used to make density CLUMP.
  // Uniform spacing is the single clearest tell of a generated image: real
  // foliage has thick masses and open gaps. Summed at three frequencies so the
  // clumping itself has no obvious period.
  const clumpAt = (x) => {
    const u = (x - x0) / Math.max(1, x1 - x0);
    const f = (k, p) => Math.sin(u * k * Math.PI * 2 + p);
    return (f(2.3, 0.7) * 0.5 + f(5.1, 2.1) * 0.32 + f(11.3, 4.4) * 0.18 + 1) / 2; // 0..1
  };

  const out = [];
  let seed = 0;

  for (let li = 0; li < cfg.layers.length; li++) {
    const layer = cfg.layers[li];

    // Minimum gap between two roots of this layer, in analyze px. This is the
    // density dial, and it replaces the old per-column stepping: candidates are
    // scattered over real branches rather than sitting on a lattice, so spacing
    // has to be enforced between them directly. A grid of cells that size makes
    // the test a 3x3 cell lookup instead of a scan over everything accepted.
    // ANISOTROPIC spacing. The gap is an ELLIPSE, not a circle: narrow across,
    // tall down. A circle spaces roots evenly in every direction, which scatters
    // them as a field of unrelated points — but a branch is a roughly horizontal
    // thing, and fronds hang off it side by side. Allowing roots to sit close
    // HORIZONTALLY packs them into rows along the branch they belong to, while a
    // wider VERTICAL gap keeps one branch's row from merging into the next one's.
    // Density and the row reading come from the same change.
    //
    // The horizontal gap must stay above the glyph width or neighbouring lianas
    // collide sideways into a slab: a monospace glyph is about 0.6 x fontSize, so
    // ~8.4px at fontSize 14. At spacingPx 20-22 and ratio 0.55 this lands at
    // 11-12px, which is clear of that.
    const baseGap = Math.max(1, layer.spacingPx / pxPerImageCol);
    const gapX = Math.max(1, baseGap * cfg.spacingRatioX);
    const gapY = Math.max(1, baseGap * cfg.spacingRatioY);
    // Cells sized by the LARGER radius, so a 3x3 lookup still covers everything the
    // ellipse could reject.
    const cell = Math.max(gapX, gapY);
    const cols = Math.ceil(w / cell) + 1;
    const taken = new Map(); // cell index -> array of accepted points

    const cellKey = (cx, cy) => cy * cols + cx;
    const farEnough = (px, py) => {
      const cx = Math.floor(px / cell);
      const cy = Math.floor(py / cell);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const arr = taken.get(cellKey(cx + dx, cy + dy));
          if (!arr) continue;
          for (const q of arr) {
            const ddx = (q.x - px) / gapX;
            const ddy = (q.y - py) / gapY;
            if (ddx * ddx + ddy * ddy < 1) return false;
          }
        }
      }
      return true;
    };
    const remember = (px, py) => {
      const k = cellKey(Math.floor(px / cell), Math.floor(py / cell));
      const arr = taken.get(k);
      if (arr) arr.push({ x: px, y: py });
      else taken.set(k, [{ x: px, y: py }]);
    };

    // Walk the candidates in a deterministic scattered order. Going through them
    // in scan order would fill the top-left of every cell region first and leave
    // a directional bias in the result; the stride is coprime-ish with the count
    // so it wanders over the whole tree.
    const N = candidates.length;
    const stride = 1 + Math.floor(N * 0.618) + li; // golden-ratio hop, offset per layer

    // TWO PASSES when `footFirst` is on: branch UNDERSIDES claim their places
    // first, everything else fills in around them afterwards. Selection is greedy
    // — whoever is tested first takes the spacing slot — so the order decides what
    // the eye ends up seeing. Feet across neighbouring columns of the same branch
    // sit at nearly the same y, so letting them win produces visible rows of origin
    // along each branch; with a single mixed pass a point halfway up a run could
    // take the slot and blur the row into a cloud.
    const passes = cfg.footFirst ? [true, false] : [null];
    for (const wantFoot of passes) {
      for (let i = 0; i < N; i++) {
        const p = candidates[(i * stride) % N];
        if (wantFoot !== null && p.foot !== wantFoot) continue;

        // Irregular density: thin the field out where the clump function is low.
        const clump = clumpAt(p.x);
        const keep = clump < cfg.clumpFloor ? clump / cfg.clumpFloor : 1;
        if (hash(++seed) > keep) continue;
        if (!farEnough(p.x, p.y)) continue;

        const rootNy = p.y / h;

        // Optional height band for this layer. Roots come from wherever the
        // branches are, which is right for the body of the canopy but wrong for the
        // HIGHLIGHT layer: its whole job is a concentration of glow up where the
        // branches leave the trunk, and scattering it evenly through the mass turns
        // it into speckle. Measured on the set this replaced, the highlights sat at
        // ny 0.13-0.39; letting them spread to 0.19-0.63 is what lost the effect.
        if (layer.rootNy && (rootNy < layer.rootNy[0] || rootNy > layer.rootNy[1])) continue;

        // Drape direction: signed distance from the tree's centre, so strands on
        // the left open left and those on the right open right. Raised to a power
        // below 1 so even columns fairly near the trunk get some outward lean —
        // linear would leave the middle of the crown falling dead straight.
        const off = (p.x - centerX) / halfWidth;
        const drape = Math.sign(off) * Math.abs(off) ** 0.65;
        const edge = Math.abs(off) ** 1.2;

        // LENGTH — driven by the anchor's own HEIGHT, through an explicit profile.
        //
        // It used to be derived from `room`, the distance down to a global floor
        // line, taken as a fraction. That coupling is what built the continuous
        // sheet: room is largest at the top, so the strands born high were the
        // longest in absolute terms AND crossed every band where the lower ones are
        // born, burying them. Measured on the set this replaces, a liana born at ny
        // 0.20 ended at ny 0.52 and one born at 0.30 ended at 0.63 — so the eye read
        // one curtain falling from the crown instead of a canopy of separate groups.
        //
        // Now the profile decides directly how long a liana born at a given height
        // is, and the floor line only ever SHORTENS one that would reach the grass.
        // Two independent controls instead of one tangled one.
        const t = clamp(
          (rootNy - cfg.lengthSpanNy[0]) / (cfg.lengthSpanNy[1] - cfg.lengthSpanNy[0]),
          0,
          1
        );
        const base = sampleProfile(cfg.lengthProfileNy, t) * coverDrawH;
        const jitter = 1 + (hash(seed * 2.7) - 0.5) * 2 * cfg.lengthJitter;
        const outward = 1 + edge * cfg.outerLengthBonus;
        let lengthPx = base * layer.lengthFactor * jitter * outward;

        // A strand under the minimum is CLAMPED UP, not dropped. Dropping it was
        // right when lengths came from `room` — a stub there meant a root with no
        // space under it — but with the profile a short length is the intended
        // result for a low anchor, and discarding those would thin out exactly the
        // zone this change exists to populate.
        lengthPx = Math.max(lengthPx, cfg.minRunPx);

        // The floor line, last and downward only, so nothing reaches the grass.
        const floorNy = cfg.tipFloor + (hash(seed + 41) - 0.5) * 2 * cfg.tipFloorJitter;
        const room = (floorNy - rootNy) * coverDrawH;
        lengthPx = Math.min(lengthPx, room);

        // Only genuinely impossible roots are dropped now: those with less than the
        // editor's absolute floor of space beneath them.
        if (lengthPx < lim.minLengthPx) continue;

        remember(p.x, p.y);
        out.push({
          nx: p.x / w,
          ny: rootNy,
          lengthPx: Math.min(lim.maxLengthPx, Math.round(lengthPx)),
          z: layer.z,
          zTip: layer.zTip ?? layer.z,
          windGain: layer.windGain ?? 1,
          drape,
        });
      }
    }
  }
  return out;
}
