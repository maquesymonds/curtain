// ============================================================================
//  TRACK CORRECTION EDITOR — drag the tracked body pose back onto the video
//  at the specific frames where fish-tracking.json slips.
//
//  Unlike the fin anchor editor (which moves a root's position RELATIVE to
//  the body, the same at every frame), this moves the BODY POSE ITSELF at one
//  chosen frame — translation by drag, rotation/scale by key. It is for the
//  other kind of "corrido": not a root authored in the wrong place, but the
//  tracked ellipse genuinely drifting off the fish for a few frames.
//
//  A drag always pauses the clip first — dragging while the frame keeps
//  advancing would fight the very thing you're trying to pin down (same rule
//  horse/js/trackingEditor.js follows).
// ============================================================================

import { localToNorm } from "./bodyTrack.js";
import { normToScreen } from "../../shared/js/cover.js";
import { poseAt as correctedPoseAt } from "./trackCorrectionStore.js";

const IDENTITY = { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 };
const ANGLE_STEP = 0.15; // degrees per [ ] press
const SCALE_STEP = 0.002; // normalized half-axis units per - = press
const RING_SEGMENTS = 48;

const isTypingTarget = (el) =>
  !!el &&
  (el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable);

export class TrackCorrectionEditor {
  constructor({ canvas, store, track, getCover, getTime, getFrame, isPaused, pause, onChange, requestRedraw }) {
    this.canvas = canvas;
    this.store = store;
    this.track = track;
    this.getCover = getCover;
    this.getTime = getTime;
    this.getFrame = getFrame;
    this.isPaused = isPaused;
    this.pause = pause;
    this.onChange = onChange;
    this.requestRedraw = requestRedraw;

    // Set from main.js after both editors exist, so activating this one closes
    // the fin anchor editor and vice versa — only one owns canvas pointer
    // capture at a time.
    this.exclusiveWith = null;

    this.active = false;
    this.dragging = false;
    this.dragPointerId = null;
    this.dragStart = null; // { frame, screenX, screenY, correction }
    this.status = "";

    this._buildDom();
    this._bindPointer();
  }

  // ----- DOM chrome --------------------------------------------------------

  _buildDom() {
    const root = document.createElement("div");
    root.className = "te-root";
    root.hidden = true;

    const panel = document.createElement("div");
    panel.className = "te-panel";

    const buttons = [
      ["Reset frame", () => this.resetFrame()],
      ["Clear all", () => this.clearAll()],
      ["Export JSON", () => this.exportJson()],
      ["Import JSON", () => this.importJson()],
    ];
    for (const [label, fn] of buttons) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.addEventListener("click", (e) => {
        fn();
        e.currentTarget.blur();
      });
      panel.appendChild(b);
    }

    const message = document.createElement("div");
    message.className = "te-message";
    panel.appendChild(message);

    root.appendChild(panel);
    document.body.appendChild(root);
    this.dom = { root, message };
  }

  _message(text, isError = false) {
    this.status = text;
    this.dom.message.textContent = text;
    this.dom.message.classList.toggle("is-error", isError);
  }

  // ----- activation ----------------------------------------------------------

  activate() {
    if (this.active) return;
    this.exclusiveWith?.deactivate();
    this.active = true;
    this.dom.root.hidden = false;
    this.canvas.style.pointerEvents = "auto";
    this.canvas.style.cursor = "move";
    this._message(this.isPaused() ? "drag to nudge this frame's pose" : "space to pause, or just start dragging");
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

  // ----- pointer ---------------------------------------------------------------

  _bindPointer() {
    this.canvas.addEventListener("pointerdown", (e) => {
      if (!this.active) return;
      const cover = this.getCover();
      if (!cover) return;
      e.preventDefault();

      if (!this.isPaused()) this.pause();

      const frame = this.getFrame();
      this.dragStart = {
        frame,
        screenX: e.clientX,
        screenY: e.clientY,
        correction: this.store.correctionAt(frame),
      };
      this.dragging = true;
      this.dragPointerId = e.pointerId;
      this.canvas.setPointerCapture(e.pointerId);
      this.canvas.style.cursor = "grabbing";
      this.requestRedraw();
    });

    this.canvas.addEventListener("pointermove", (e) => {
      if (!this.active || !this.dragging) return;
      if (e.pointerId !== this.dragPointerId) return;
      const cover = this.getCover();
      if (!cover) return;

      const { frame, screenX, screenY, correction } = this.dragStart;
      const dnx = (e.clientX - screenX) / cover.drawW;
      const dny = (e.clientY - screenY) / cover.drawH;
      this.store.setKeyframe(frame, {
        ...correction,
        dcx: correction.dcx + dnx,
        dcy: correction.dcy + dny,
      });
      this.onChange();
      this.requestRedraw();
    });

    const endDrag = (e) => {
      if (!this.dragging || e.pointerId !== this.dragPointerId) return;
      this.dragging = false;
      this.dragPointerId = null;
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
      this.canvas.style.cursor = "move";
      this.store.saveNow();
      const c = this.store.correctionAt(this.dragStart.frame);
      this._message(`frame ${this.dragStart.frame}: dcx ${c.dcx.toFixed(4)}  dcy ${c.dcy.toFixed(4)}`);
      this.dragStart = null;
      this.requestRedraw();
    };
    this.canvas.addEventListener("pointerup", endDrag);
    this.canvas.addEventListener("pointercancel", endDrag);
  }

  // ----- commands ----------------------------------------------------------------

  _nudgeActive(delta) {
    if (!this.isPaused()) this.pause();
    const frame = this.getFrame();
    const c = this.store.nudge(frame, delta);
    this._message(
      `frame ${frame}: dangle ${c.dangle.toFixed(2)}°  dHalfLen ${c.dHalfLen.toFixed(4)}  dHalfDepth ${c.dHalfDepth.toFixed(4)}`
    );
    this.onChange();
    this.requestRedraw();
  }

  rotate(dir) {
    this._nudgeActive({ dangle: dir * ANGLE_STEP });
  }

  scale(dir) {
    this._nudgeActive({ dHalfLen: dir * SCALE_STEP, dHalfDepth: dir * SCALE_STEP });
  }

  resetFrame() {
    const frame = this.getFrame();
    if (!this.store.removeKeyframe(frame)) {
      this._message(`frame ${frame}: no correction to reset`, true);
      return;
    }
    this._message(`frame ${frame}: correction removed`);
    this.onChange();
    this.requestRedraw();
  }

  clearAll() {
    if (!this.store.count) return;
    if (!confirm(`Clear all ${this.store.count} track correction keyframe(s)?`)) return;
    this.store.clearAll();
    this._message("all corrections cleared");
    this.onChange();
    this.requestRedraw();
  }

  exportJson() {
    const data = this.store.exportJson();
    this._message(`exported ${Object.keys(data.keyframes).length} keyframe(s)`);
  }

  async importJson() {
    try {
      const data = await this.store.importJson();
      if (data === null) return;
      this._message(`imported ${Object.keys(data.keyframes).length} keyframe(s)`);
      this.onChange();
      this.requestRedraw();
    } catch (err) {
      this._message(`import failed: ${err.message}`, true);
      console.error("Track correction import failed:", err);
    }
  }

  // ----- keyboard ------------------------------------------------------------------

  handleKey(e, editorKey) {
    if (isTypingTarget(e.target)) return false;
    const k = e.key.toLowerCase();

    if (k === editorKey) {
      this.toggle();
      return true;
    }
    if (!this.active) return false;

    if (k === "[") return this.rotate(-1), true;
    if (k === "]") return this.rotate(1), true;
    if (k === "-") return this.scale(-1), true;
    if (k === "=") return this.scale(1), true;
    if (k === "backspace" || k === "delete") {
      e.preventDefault();
      this.resetFrame();
      return true;
    }
    return false;
  }

  // ----- drawing -------------------------------------------------------------------

  // A ring of screen points for a pose, by walking the unit circle through
  // localToNorm — the same transform every fin root goes through, so this is
  // exactly the ellipse a root's own frame is measured against.
  _ring(pose, cover) {
    const pts = [];
    for (let i = 0; i <= RING_SEGMENTS; i++) {
      const a = (i / RING_SEGMENTS) * Math.PI * 2;
      const [nx, ny] = localToNorm(pose, Math.cos(a), Math.sin(a));
      pts.push(normToScreen(nx, ny, cover, IDENTITY));
    }
    return pts;
  }

  _strokeRing(ctx, pts, color, dashed) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash(dashed ? [5, 4] : []);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  draw(ctx, dpr) {
    if (!this.active) return;
    const cover = this.getCover();
    if (!cover) return;

    const time = this.getTime();
    const raw = this.track.poseAt(time);
    const corrected = correctedPoseAt(this.track, this.store, time);
    const frame = this.getFrame();
    const isKey = this.store.hasKeyframe(frame);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    // raw auto-tracked pose: dim, dashed
    this._strokeRing(ctx, this._ring(raw, cover), "rgba(127, 215, 255, 0.55)", true);
    // corrected (what actually renders): solid, brighter
    this._strokeRing(ctx, this._ring(corrected, cover), isKey ? "#fff34d" : "#7fffb0", false);

    this._drawHud(ctx, { frame, isKey, raw, corrected });
  }

  _drawHud(ctx, { frame, isKey, raw, corrected }) {
    const c = this.store.correctionAt(frame);
    const data = [
      "TRACK CORRECTION EDITOR",
      `state      ${this.isPaused() ? "PAUSED" : "PLAYING (drag to pause)"}`,
      `frame      ${frame}   ${isKey ? "KEYFRAME" : "interpolated / none"}   corrections ${this.store.count}`,
      `correction dcx ${c.dcx.toFixed(4)}  dcy ${c.dcy.toFixed(4)}  dangle ${c.dangle.toFixed(2)}°`,
      `           dHalfLen ${c.dHalfLen.toFixed(4)}  dHalfDepth ${c.dHalfDepth.toFixed(4)}`,
      `autosave   ${this.store.saveState}${this.store.lastError ? ` (${this.store.lastError})` : ""}`,
    ];
    const help = [
      "dashed = raw tracking · solid = corrected (what renders)",
      "drag: position   [ ]: rotate   - =: scale   ⌫ reset this frame",
      ", . step a frame · space pause — a correction only lives at THIS frame",
      "r closes the editor",
    ];

    const width = 480;
    const padding = 10;
    const lineHeight = 17;
    const x = 12;
    const y = 12;
    const lines = data.length + help.length + 1;

    ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
    ctx.fillRect(x, y, width, padding * 2 + lines * lineHeight);
    ctx.font = '13px ui-monospace, "SF Mono", Menlo, monospace';
    ctx.textAlign = "left";
    let ty = y + padding + lineHeight;
    ctx.fillStyle = "#7fffb0";
    for (const line of data) {
      ctx.fillText(line, x + padding, ty);
      ty += lineHeight;
    }
    ty += lineHeight;
    ctx.fillStyle = "#cfe";
    for (const line of help) {
      ctx.fillText(line, x + padding, ty);
      ty += lineHeight;
    }
  }
}
