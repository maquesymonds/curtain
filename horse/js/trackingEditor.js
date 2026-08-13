// ============================================================================
//  TRACK EDITOR — the interactive layer: pointer handling, canvas overlay,
//  timeline, button panel and HUD.
//
//  It owns no tracking data (that's TrackingStore) and no render loop (that's
//  main.js). main.js hands it the video, the canvas, a way to read the current
//  cover transform and frame, a way to seek, and a way to ask for a repaint.
// ============================================================================

import { CONFIG } from "./config.js";
import { screenToNorm } from "../../shared/js/cover.js";
import { TrackingStore, seedPoints } from "./trackingStore.js";
import { exportTracking, pickTrackingFile } from "./trackingExport.js";

const TAU = Math.PI * 2;
const IDENTITY = { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 };

const isTypingTarget = (el) =>
  !!el &&
  (el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable);

export class TrackingEditor {
  constructor({ video, canvas, getCover, getFrame, seekToFrame, requestRedraw }) {
    this.video = video;
    this.canvas = canvas;
    this.getCover = getCover;
    this.getFrame = getFrame;
    this.seekToFrame = seekToFrame;
    this.requestRedraw = requestRedraw;

    this.store = new TrackingStore();
    this.status = this.store.init();

    this.active = false;
    this.selected = null; // index of the selected control point
    this.dragging = false;
    this.dragPointerId = null;
    this.hovering = null;
    this._prevTimelineFrame = null;

    this._buildDom();
    this._bindPointer();
  }

  // ----- DOM chrome (timeline + buttons), created once, hidden until active --

  _buildDom() {
    const root = document.createElement("div");
    root.className = "te-root";
    root.hidden = true;

    const panel = document.createElement("div");
    panel.className = "te-panel";

    const buttons = [
      ["Add keyframe", () => this.addKeyframe()],
      ["Delete keyframe", () => this.deleteKeyframe()],
      ["◀ Prev keyframe", () => this.gotoKeyframe(-1)],
      ["Next keyframe ▶", () => this.gotoKeyframe(1)],
      ["Copy prev", () => this.copyNeighbour(-1)],
      ["Copy next", () => this.copyNeighbour(1)],
      ["Close loop", () => this.closeLoop()],
      ["Export JSON", () => this.exportJson()],
      ["Import JSON", () => this.importJson()],
      ["Reset frame", () => this.resetCurrentFrame()],
      ["Clear all but 0", () => this.clearAllExceptFirst()],
    ];
    for (const [label, fn] of buttons) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.addEventListener("click", (e) => {
        fn();
        e.currentTarget.blur(); // don't let the button swallow the next shortcut
      });
      panel.appendChild(b);
    }

    const message = document.createElement("div");
    message.className = "te-message";
    panel.appendChild(message);

    // Timeline: one cell per frame, so a click maps to an exact frame index and
    // keyframe marks land on precisely the right column.
    const timeline = document.createElement("div");
    timeline.className = "te-timeline";
    this.cells = [];
    for (let f = 0; f < CONFIG.video.frameCount; f++) {
      const cell = document.createElement("div");
      cell.className = "te-cell";
      cell.dataset.frame = String(f);
      timeline.appendChild(cell);
      this.cells.push(cell);
    }
    timeline.addEventListener("click", (e) => {
      const frame = Number(e.target?.dataset?.frame);
      if (Number.isInteger(frame)) this.seekToFrame(frame);
    });

    root.appendChild(panel);
    root.appendChild(timeline);
    document.body.appendChild(root);

    this.dom = { root, panel, timeline, message };
    this._refreshTimelineKeys();
  }

  _message(text, isError = false) {
    this.dom.message.textContent = text;
    this.dom.message.classList.toggle("is-error", isError);
  }

  _refreshTimelineKeys() {
    const keys = new Set(this.store.frames());
    for (let f = 0; f < this.cells.length; f++) {
      this.cells[f].classList.toggle("is-key", keys.has(f));
    }
  }

  // Only touch the two cells that changed, so playback doesn't rewrite 121
  // class lists every frame.
  _refreshTimelinePlayhead(frame) {
    if (this._prevTimelineFrame === frame) return;
    if (this._prevTimelineFrame !== null && this.cells[this._prevTimelineFrame]) {
      this.cells[this._prevTimelineFrame].classList.remove("is-current");
    }
    if (this.cells[frame]) this.cells[frame].classList.add("is-current");
    this._prevTimelineFrame = frame;
  }

  // ----- activation --------------------------------------------------------

  activate() {
    if (this.active) return;
    this.active = true;
    this.dom.root.hidden = false;
    // The canvas is pointer-events:none by default so the experience isn't
    // clickable; the editor needs the events (and pointer capture), so it takes
    // them for as long as it is open and hands them back on the way out.
    this.canvas.style.pointerEvents = "auto";
    this._message(this.status);
    this._refreshTimelineKeys();
    this.requestRedraw();
  }

  deactivate() {
    if (!this.active) return;
    this.active = false;
    this.dragging = false;
    this.dragPointerId = null;
    this.dom.root.hidden = true;
    this.canvas.style.pointerEvents = "";
    this.canvas.style.cursor = "";
    this.store.saveNow();
    this.requestRedraw();
  }

  toggle() {
    this.active ? this.deactivate() : this.activate();
  }

  // ----- pointer editing ---------------------------------------------------

  // Screen px -> normalized video coords, honouring object-fit: cover exactly
  // (screenToNorm is the same inverse the rest of the system uses).
  _toNorm(clientX, clientY) {
    const cover = this.getCover();
    if (!cover) return null;
    return screenToNorm(clientX, clientY, cover, IDENTITY);
  }

  _pointScreen(points, index) {
    const cover = this.getCover();
    const [nx, ny] = points[index];
    return {
      x: cover.offsetX + nx * cover.drawW,
      y: cover.offsetY + ny * cover.drawH,
    };
  }

  // Nearest control point within the grab radius, which is deliberately larger
  // than the drawn dot so points are easy to catch.
  _hitTest(clientX, clientY) {
    const cover = this.getCover();
    if (!cover) return null;
    const points = this.store.poseAt(this.getFrame());
    const r = CONFIG.trackEditor.hitRadius;
    let best = null;
    let bestD = r;
    for (let i = 0; i < points.length; i++) {
      const s = this._pointScreen(points, i);
      const d = Math.hypot(clientX - s.x, clientY - s.y);
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  _bindPointer() {
    this.canvas.addEventListener("pointerdown", (e) => {
      if (!this.active) return;
      const hit = this._hitTest(e.clientX, e.clientY);
      if (hit === null) return;

      // Dragging while the clip plays would fight the playhead, so a drag always
      // pauses first. Points are therefore never dragged during playback.
      if (!this.video.paused) this.video.pause();

      const frame = this.getFrame();
      // Editing an in-between promotes it to a real keyframe first, so the edit
      // is stored on this frame and cannot leak into its neighbours.
      const wasInterpolated = !this.store.hasKeyframe(frame);
      this.store.materialize(frame);
      if (wasInterpolated) {
        this._refreshTimelineKeys();
        this._message(`frame ${frame}: interpolated pose promoted to a keyframe`);
      }

      this.selected = hit;
      this.dragging = true;
      this.dragPointerId = e.pointerId;
      // Capture keeps the drag alive if the cursor slips off the dot, off the
      // canvas, or moves faster than the pointermove stream.
      this.canvas.setPointerCapture(e.pointerId);
      this.canvas.style.cursor = "grabbing";
      e.preventDefault();
      this.requestRedraw();
    });

    this.canvas.addEventListener("pointermove", (e) => {
      if (!this.active) return;

      if (!this.dragging) {
        const hit = this._hitTest(e.clientX, e.clientY);
        if (hit !== this.hovering) {
          this.hovering = hit;
          this.canvas.style.cursor = hit === null ? "" : "grab";
          this.requestRedraw();
        }
        return;
      }
      if (e.pointerId !== this.dragPointerId) return;

      const n = this._toNorm(e.clientX, e.clientY);
      if (!n) return;
      // movePoint clamps into 0..1 itself.
      this.store.movePoint(this.getFrame(), this.selected, n.nx, n.ny);
      this.requestRedraw();
    });

    const endDrag = (e) => {
      if (!this.dragging || e.pointerId !== this.dragPointerId) return;
      this.dragging = false;
      this.dragPointerId = null;
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
      this.canvas.style.cursor = this.hovering === null ? "" : "grab";
      this.store.saveNow();
      this._message(`frame ${this.getFrame()}: point ${this.selected} saved`);
      this.requestRedraw();
    };
    this.canvas.addEventListener("pointerup", endDrag);
    this.canvas.addEventListener("pointercancel", endDrag);
  }

  // ----- commands (shared by buttons and shortcuts) ------------------------

  addKeyframe() {
    const frame = this.getFrame();
    const existed = this.store.hasKeyframe(frame);
    this.store.setKeyframe(frame, this.store.poseAt(frame));
    this._refreshTimelineKeys();
    this._message(existed ? `frame ${frame}: keyframe overwritten` : `frame ${frame}: keyframe created`);
    this.requestRedraw();
  }

  deleteKeyframe() {
    const frame = this.getFrame();
    if (!this.store.hasKeyframe(frame)) {
      this._message(`frame ${frame} is interpolated — nothing to delete`, true);
      return;
    }
    // Frame 0 anchors the whole track: without it every frame before the first
    // remaining keyframe would have nothing to hold on to.
    if (frame === 0 && !confirm("Delete the keyframe at frame 0?\n\nIt anchors the whole track.")) {
      return;
    }
    this.store.deleteKeyframe(frame);
    this._refreshTimelineKeys();
    this._message(`frame ${frame}: keyframe deleted`);
    this.requestRedraw();
  }

  // "Reset current frame" = drop this frame's keyframe so it goes back to being
  // interpolated from its neighbours.
  resetCurrentFrame() {
    const frame = this.getFrame();
    if (!this.store.hasKeyframe(frame)) {
      this._message(`frame ${frame} is already interpolated`);
      return;
    }
    // Frame 0 has no previous keyframe to fall back on, so "reset" there means
    // putting the 5-point seed pose back rather than deleting the anchor.
    if (frame === 0) {
      if (!confirm("Reset frame 0 back to the 5-point seed pose?")) return;
      this.store.setKeyframe(0, seedPoints());
      this._message("frame 0: reset to the seed pose");
    } else {
      this.store.deleteKeyframe(frame);
      this._message(`frame ${frame}: keyframe removed, back to interpolated`);
    }
    this._refreshTimelineKeys();
    this.requestRedraw();
  }

  clearAllExceptFirst() {
    if (!confirm("Delete every keyframe except frame 0?")) return;
    this.store.clearAllExceptFirst();
    this._refreshTimelineKeys();
    this._message("cleared everything except frame 0");
    this.requestRedraw();
  }

  copyNeighbour(dir) {
    const frame = this.getFrame();
    const src = this.store.copyFromNeighbour(frame, dir);
    if (src === null) {
      this._message(`no ${dir < 0 ? "previous" : "next"} keyframe to copy from`, true);
      return;
    }
    this._refreshTimelineKeys();
    this._message(`copied frame ${src} → ${frame}`);
    this.requestRedraw();
  }

  // The clip loops, so the last frame's pose has to match frame 0's or the mane
  // snaps every time it wraps. Copy frame 0 onto the last frame; the frames in
  // between then interpolate smoothly into the start pose.
  closeLoop() {
    const first = this.store.keyframes.get(0);
    if (!first) {
      this._message("frame 0 has no keyframe to close the loop with", true);
      return;
    }
    const last = CONFIG.video.frameCount - 1;
    this.store.setKeyframe(last, first);
    this.store.saveNow();
    this._refreshTimelineKeys();
    this._message(`loop closed: frame 0's pose copied to frame ${last}`);
    this.requestRedraw();
  }

  gotoKeyframe(dir) {
    const frame = this.getFrame();
    const target = dir < 0 ? this.store.prevKeyframe(frame) : this.store.nextKeyframe(frame);
    if (target === null) {
      this._message(`no ${dir < 0 ? "previous" : "next"} keyframe`, true);
      return;
    }
    this.seekToFrame(target);
  }

  exportJson() {
    const data = exportTracking(this.store);
    this._message(
      `exported ${data.keyframes.length} keyframe(s) + ${data.frames.length} evaluated frames`
    );
  }

  async importJson() {
    try {
      const entries = await pickTrackingFile();
      if (!entries) return; // cancelled
      this.store.replaceAll(entries);
      this.store.saveNow();
      this.selected = null;
      this._refreshTimelineKeys();
      this._message(`imported ${entries.length} keyframe(s)`);
      this.requestRedraw();
    } catch (err) {
      this._message(`import failed: ${err.message}`, true);
      console.error("Tracking import failed:", err);
    }
  }

  // ----- keyboard ----------------------------------------------------------

  // Returns true when the key was consumed, so main.js can skip its own handling.
  handleKey(e) {
    if (isTypingTarget(e.target)) return false;
    const K = CONFIG.keys;
    const k = e.key.toLowerCase();

    if (k === K.trackEditor) {
      this.toggle();
      return true;
    }
    if (!this.active) return false;

    if (k === K.addKeyframe) {
      this.addKeyframe();
      return true;
    }
    if (K.deleteKeyframe.includes(k)) {
      e.preventDefault(); // backspace would otherwise navigate back
      this.deleteKeyframe();
      return true;
    }
    if (k === K.prevKeyframe) {
      this.gotoKeyframe(-1);
      return true;
    }
    if (k === K.nextKeyframe) {
      this.gotoKeyframe(1);
      return true;
    }
    // Shift + ← / → jumps between keyframes instead of scrubbing by seconds.
    if (e.shiftKey && (k === K.seekBack || k === K.seekForward)) {
      this.gotoKeyframe(k === K.seekBack ? -1 : 1);
      return true;
    }
    return false;
  }

  // ----- drawing -----------------------------------------------------------

  draw(ctx, dpr, mediaTime) {
    if (!this.active) return;
    const cover = this.getCover();
    if (!cover) return;

    const cfg = CONFIG.trackEditor;
    const col = cfg.colors;
    const frame = this.getFrame();
    const points = this.store.poseAt(frame);
    const isKey = this.store.hasKeyframe(frame);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    const toScreen = (p) => ({
      x: cover.offsetX + p[0] * cover.drawW,
      y: cover.offsetY + p[1] * cover.drawH,
    });

    // 1. thin control polyline, so the point order is readable at a glance
    ctx.strokeStyle = col.hull;
    ctx.lineWidth = 1;
    ctx.beginPath();
    points.forEach((p, i) => {
      const s = toScreen(p);
      i === 0 ? ctx.moveTo(s.x, s.y) : ctx.lineTo(s.x, s.y);
    });
    ctx.stroke();

    // 2. the smooth open Catmull-Rom through all 14 points
    ctx.strokeStyle = col.spline;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i <= cfg.splineSamples; i++) {
      const s = toScreen(TrackingStore.curvePoint(points, i / cfg.splineSamples));
      i === 0 ? ctx.moveTo(s.x, s.y) : ctx.lineTo(s.x, s.y);
    }
    ctx.stroke();

    // 3. the control points and their indices
    ctx.font = cfg.labelFont;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    for (let i = 0; i < points.length; i++) {
      const s = toScreen(points[i]);
      const isSel = i === this.selected;
      const r = isSel ? cfg.selectedRadius : cfg.pointRadius;

      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, TAU);
      ctx.fillStyle = isSel ? col.selected : isKey ? col.keyframePoint : col.point;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = col.pointStroke;
      ctx.stroke();

      if (i === this.hovering && !isSel) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, cfg.hitRadius, 0, TAU);
        ctx.strokeStyle = col.point;
        ctx.stroke();
      }

      ctx.fillStyle = isSel ? col.selected : col.label;
      ctx.fillText(String(i), s.x + cfg.labelOffset, s.y - cfg.labelOffset);
    }

    this._refreshTimelinePlayhead(frame);
    this._drawHud(ctx, mediaTime, frame, isKey, points);
  }

  _drawHud(ctx, mediaTime, frame, isKey, points) {
    const { hud, colors } = CONFIG.calibration;
    const v = CONFIG.video;
    const store = this.store;

    const prev = store.prevKeyframe(frame);
    const next = store.nextKeyframe(frame);
    const sel = this.selected;
    const selText =
      sel === null
        ? "none"
        : `${sel}  [${points[sel][0].toFixed(4)}, ${points[sel][1].toFixed(4)}]`;

    const data = [
      `TRACK EDITOR`,
      `frame      ${frame} / ${v.frameCount - 1}   ${isKey ? "KEYFRAME" : "interpolated"}`,
      `mediaTime  ${mediaTime.toFixed(4)} s`,
      `prev key   ${prev === null ? "—" : prev}`,
      `next key   ${next === null ? "—" : next}`,
      `keyframes  ${store.count}`,
      `point      ${selText}`,
      `autosave   ${store.saveState}${store.lastSaveError ? ` (${store.lastSaveError})` : ""}`,
      `state      ${this.video.paused ? "PAUSED" : "PLAYING (drag disabled)"}`,
    ];
    const help = [
      `space play/pause   , . ±1 frame   ← → ±${CONFIG.calibration.seekCoarse}s`,
      `k keyframe   j l prev/next key   shift+← →  jump`,
      `backspace delete key   e close editor`,
    ];

    const width = CONFIG.trackEditor.hudWidth;
    const lines = data.length + help.length + 1;
    ctx.fillStyle = colors.hudBg;
    ctx.fillRect(hud.x, hud.y, width, hud.padding * 2 + lines * hud.lineHeight);

    ctx.font = hud.font;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    let y = hud.y + hud.padding + hud.lineHeight;
    ctx.fillStyle = colors.hudKey;
    for (const line of data) {
      ctx.fillText(line, hud.x + hud.padding, y);
      y += hud.lineHeight;
    }
    y += hud.lineHeight;
    ctx.fillStyle = colors.hudText;
    for (const line of help) {
      ctx.fillText(line, hud.x + hud.padding, y);
      y += hud.lineHeight;
    }
  }
}
