// ============================================================================
//  SILHOUETTE — where the horse actually is, this frame.
//
//  Everything else in this piece trusts the 14-point tracking plus a band profile
//  measured once as a median over the clip. That works while the head keeps roughly
//  the same relationship to the camera, and it stops working when the head turns:
//  the same outward push that lands a root on the silhouette at one pose puts it in
//  the sky at another, and the same "forward along the crest" direction that points
//  down the face at one pose points off the head at another.
//
//  No amount of parameter tuning fixes that, and it is worth saying why rather than
//  discovering it three times: a static number cannot answer a question whose answer
//  moves. Measured — the forelock's overshoot barely responded to halving its lateral
//  force (69% -> 64%), to killing its launch lean (67% -> 67%), or to correcting the
//  tracking (69% -> 69% at the worst pose), because none of those is the variable.
//
//  So this reads the frame. The video is drawn once per frame into a small offscreen
//  canvas and the pixels are pulled down as one array; after that, "is this point on
//  the horse" and "how far can I travel before leaving it" are array lookups.
//
//  It is a LUMINANCE test, not a matte. This clip is a lit horse against a night sky
//  (sampled: horse 120-200, sky 25-45), so one threshold separates them cleanly. On
//  footage without that separation this class is the wrong tool and the piece should
//  fall back to the measured profile — hence `ok`, and hence every caller treating a
//  failed probe as "no opinion" rather than as "outside".
// ============================================================================

import { CONFIG } from "./config.js";
import { screenToNorm } from "../../shared/js/cover.js";

const IDENTITY = { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 };

export class Silhouette {
  constructor(video) {
    this.video = video;
    const cfg = CONFIG.silhouette;
    this.w = cfg.width;
    this.h = Math.max(1, Math.round((cfg.width * CONFIG.video.height) / CONFIG.video.width));
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    // willReadFrequently: this canvas exists to be read every frame, and without the hint
    // Chrome keeps it on the GPU and pays a readback stall on every getImageData.
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    this.data = null;
    this.ok = false;
    this.frame = -1;
  }

  // Pull this frame's pixels down. Cheap enough to call unconditionally, but skipped
  // when the frame index has not changed — scrubbing and pausing both re-enter here.
  sample(frameIndex) {
    if (frameIndex === this.frame && this.data) return this.ok;
    const v = this.video;
    if (!v || v.readyState < 2 || !v.videoWidth) {
      this.ok = false;
      return false;
    }
    try {
      this.ctx.drawImage(v, 0, 0, this.w, this.h);
      this.data = this.ctx.getImageData(0, 0, this.w, this.h).data;
      this.frame = frameIndex;
      this.ok = true;
    } catch (err) {
      // A cross-origin frame taints the canvas and getImageData throws. Everything here
      // is same-origin, but a failure must degrade to "no opinion", never to a wrong one.
      if (!this._warned) {
        this._warned = true;
        console.warn("silhouette: no pude leer el fotograma; sigo con el perfil medido.", err);
      }
      this.ok = false;
    }
    return this.ok;
  }

  // Screen px -> is that on the horse? `false` also for anything off-frame.
  inside(sx, sy, cover) {
    if (!this.ok) return true; // no opinion: let the caller keep its own plan
    const { nx, ny } = screenToNorm(sx, sy, cover, IDENTITY);
    const x = Math.round(nx * (this.w - 1));
    const y = Math.round(ny * (this.h - 1));
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    const i = (y * this.w + x) * 4;
    const d = this.data;
    const lum = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return lum >= CONFIG.silhouette.skyLuma;
  }

  // How far from (sx, sy) along the unit direction (dx, dy) before leaving the horse,
  // in screen px, up to `maxPx`. Walks in `stepPx` strides — the probe is 160px wide, so
  // finer steps than one probe pixel would just re-read the same cell.
  clearance(sx, sy, dx, dy, maxPx, cover) {
    if (!this.ok) return maxPx;
    const step = CONFIG.silhouette.stepPx;
    let d = 0;
    while (d + step <= maxPx) {
      if (!this.inside(sx + dx * (d + step), sy + dy * (d + step), cover)) return d;
      d += step;
    }
    return maxPx;
  }
}
