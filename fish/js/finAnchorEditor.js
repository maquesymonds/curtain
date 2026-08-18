// ============================================================================
//  FIN ANCHOR EDITOR — drag the `arc` points in fins.js against the video.
//
//  Two modes, one tool, because they answer two different complaints:
//
//    "global"  (default) moves an arc point for EVERY frame alike — a
//              constant offset that rides with the tracked body. For when a
//              point is authored in the wrong place, period.
//    "frame"   moves a point only around the CURRENT frame, fading to zero
//              a few frames out (finAnchorFrameStore.js). For when different
//              roots from different fins slip at different times — not a
//              constant mistake, not the whole body's tracking, just this
//              root, right here, right now. Requires the clip to be paused
//              (auto-pauses on drag) so "here" means something.
//
//  Press `f` while the editor is open to switch. Both modes share the same
//  drag math: a screen point converts to an absolute body (u, v) with
//  bodyTrack's normToLocal against the pose at drag time; global mode writes
//  that straight into the arc, frame mode writes the DELTA from the arc's
//  base point into a keyframe at the current frame.
//
//  It owns no physics and no render loop (that's main.js); it owns the arc
//  points via FinAnchorStore/FinAnchorFrameStore and the DOM chrome. A global
//  edit costs a rebuild (onChangeGlobal, same as dragging `segmentLength`
//  does); a frame edit is read live every frame and only needs a repaint
//  while paused (onChangeFrame).
//
//  Deliberately NOT click-anywhere-to-add, unlike willow's anchor editor: a
//  fin's arc is an ordered polyline with a fixed identity (dorsal, caudal...),
//  not a bag of independent clusters, so a new point (global mode only — a
//  frame correction can't add a control point, only nudge an existing one) is
//  always inserted next to the one you have selected rather than wherever you
//  clicked.
// ============================================================================

import { FINS } from "./fins.js";
import { screenToNorm, normToScreen } from "../../shared/js/cover.js";
import { localToNorm, normToLocal } from "./bodyTrack.js";

const TAU = Math.PI * 2;
const IDENTITY = { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 };
const HIT_RADIUS = 16;
const DOT_RADIUS = 5;
const SELECTED_RADIUS = 8;
const GHOST_RADIUS = 3;
const LABEL_FONT = '11px ui-monospace, "SF Mono", Menlo, monospace';
const PALETTE = ["#7fd7ff", "#ffb07f", "#c9ff7f", "#ff7fd0", "#ffe97f"]; // one per FINS index

const isTypingTarget = (el) =>
  !!el &&
  (el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable);

export class FinAnchorEditor {
  constructor({
    canvas,
    store,
    frameStore,
    getCover,
    getPose,
    getFrame,
    isPaused,
    pause,
    onChangeGlobal,
    onChangeFrame,
    requestRedraw,
  }) {
    this.canvas = canvas;
    this.store = store;
    this.frameStore = frameStore;
    this.getCover = getCover;
    this.getPose = getPose;
    this.getFrame = getFrame;
    this.isPaused = isPaused;
    this.pause = pause;
    this.onChangeGlobal = onChangeGlobal;
    this.onChangeFrame = onChangeFrame;
    this.requestRedraw = requestRedraw;

    // Set from main.js after both editors exist, so activating this one closes
    // the track correction editor and vice versa — only one owns canvas
    // pointer capture at a time.
    this.exclusiveWith = null;

    this.mode = "global"; // "global" | "frame"
    this.active = false;
    this.selected = null; // { fin, point }
    this.dragging = false;
    this.dragPointerId = null;
    this.movedWhileDown = false;
    this.hovering = null;
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
      ["Mode: global/frame (f)", () => this.toggleMode()],
      ["+ point", () => this.addPoint()],
      ["Delete point", () => this.removeSelected()],
      ["Reset fin", () => this.resetFin()],
      ["Reset all", () => this.resetAll()],
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
    this.canvas.style.cursor = "crosshair";
    this._message('drag a point · "f" switches global/frame mode');
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
    this.frameStore.saveNow();
    this.requestRedraw();
  }

  toggle() {
    this.active ? this.deactivate() : this.activate();
  }

  toggleMode() {
    this.mode = this.mode === "global" ? "frame" : "global";
    this.dragging = false;
    this._message(
      this.mode === "frame"
        ? "frame mode: drag nudges THIS FRAME only (auto-pauses) · f for global"
        : "global mode: drag moves the point for the whole clip · f for per-frame"
    );
    this.requestRedraw();
  }

  // ----- geometry --------------------------------------------------------------

  // Base (u, v): what the arc says regardless of frame — global mode's target,
  // and the reference a frame-mode correction is a delta FROM.
  _baseUV(fi, pi) {
    return FINS[fi].arc[pi];
  }

  // What actually renders right now: base, plus a frame correction if we're in
  // frame mode and one applies at this frame.
  _effectiveUV(fi, pi) {
    const base = this._baseUV(fi, pi);
    if (this.mode !== "frame") return base;
    const c = this.frameStore.correctionAt(FINS[fi].name, pi, this.getFrame());
    return [base[0] + c.du, base[1] + c.dv];
  }

  _screenFor(uv, pose, cover) {
    const [nx, ny] = localToNorm(pose, uv[0], uv[1]);
    return normToScreen(nx, ny, cover, IDENTITY);
  }

  _hitTest(clientX, clientY) {
    const cover = this.getCover();
    if (!cover) return null;
    const pose = this.getPose();
    let best = null;
    let bestD = HIT_RADIUS;
    FINS.forEach((fin, fi) => {
      fin.arc.forEach((_, pi) => {
        const s = this._screenFor(this._effectiveUV(fi, pi), pose, cover);
        const d = Math.hypot(clientX - s.x, clientY - s.y);
        if (d <= bestD) {
          bestD = d;
          best = { fin: fi, point: pi };
        }
      });
    });
    return best;
  }

  // ----- pointer ---------------------------------------------------------------

  _bindPointer() {
    this.canvas.addEventListener("pointerdown", (e) => {
      if (!this.active) return;
      const cover = this.getCover();
      if (!cover) return;
      e.preventDefault();

      if (this.mode === "frame" && !this.isPaused()) this.pause();

      const hit = this._hitTest(e.clientX, e.clientY);
      this.movedWhileDown = false;

      if (hit === null) {
        this.selected = null;
        this._message("no point there — click empty space to deselect");
        this.requestRedraw();
        return;
      }

      this.selected = hit;
      this._message(`${FINS[hit.fin].name}·${hit.point} selected`);
      this.dragging = true;
      this.dragPointerId = e.pointerId;
      this.canvas.setPointerCapture(e.pointerId);
      this.canvas.style.cursor = "grabbing";
      this.requestRedraw();
    });

    this.canvas.addEventListener("pointermove", (e) => {
      if (!this.active) return;

      if (!this.dragging) {
        const hit = this._hitTest(e.clientX, e.clientY);
        const key = hit ? `${hit.fin}.${hit.point}` : null;
        const prevKey = this.hovering ? `${this.hovering.fin}.${this.hovering.point}` : null;
        if (key !== prevKey) {
          this.hovering = hit;
          this.canvas.style.cursor = hit === null ? "crosshair" : "grab";
          this.requestRedraw();
        }
        return;
      }
      if (e.pointerId !== this.dragPointerId || this.selected === null) return;

      const cover = this.getCover();
      const pose = this.getPose();
      const { nx, ny } = screenToNorm(e.clientX, e.clientY, cover, IDENTITY);
      const [u, v] = normToLocal(pose, nx, ny);
      const { fin, point } = this.selected;

      if (this.mode === "global") {
        this.store.move(fin, point, u, v);
        this.onChangeGlobal();
      } else {
        const base = this._baseUV(fin, point);
        this.frameStore.setKeyframe(FINS[fin].name, point, this.getFrame(), { du: u - base[0], dv: v - base[1] });
        this.onChangeFrame();
      }
      this.movedWhileDown = true;
      this.requestRedraw();
    });

    const endDrag = (e) => {
      if (!this.dragging || e.pointerId !== this.dragPointerId) return;
      this.dragging = false;
      this.dragPointerId = null;
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
      this.canvas.style.cursor = this.hovering === null ? "crosshair" : "grab";
      this.store.saveNow();
      this.frameStore.saveNow();
      if (this.movedWhileDown && this.selected) {
        const [u, v] = this._effectiveUV(this.selected.fin, this.selected.point);
        const where = this.mode === "frame" ? ` @ frame ${this.getFrame()}` : "";
        this._message(`${FINS[this.selected.fin].name}·${this.selected.point}${where} -> [${u.toFixed(4)}, ${v.toFixed(4)}]`);
      }
      this.requestRedraw();
    };
    this.canvas.addEventListener("pointerup", endDrag);
    this.canvas.addEventListener("pointercancel", endDrag);
  }

  // ----- commands ----------------------------------------------------------------

  addPoint() {
    if (this.mode === "frame") {
      this._message("points are added in global mode (f) — a frame correction only nudges an existing one", true);
      return;
    }
    if (this.selected === null) {
      this._message("select a point first — the new one lands right after it", true);
      return;
    }
    const { fin, point } = this.selected;
    const at = this.store.addPoint(fin, point);
    this.selected = { fin, point: at };
    this._message(`${FINS[fin].name}: point added at ${at}`);
    this.onChangeGlobal();
    this.requestRedraw();
  }

  removeSelected() {
    if (this.selected === null) {
      this._message("select a point first", true);
      return;
    }
    const { fin, point } = this.selected;

    if (this.mode === "frame") {
      const frame = this.getFrame();
      if (!this.frameStore.removeKeyframe(FINS[fin].name, point, frame)) {
        this._message(`${FINS[fin].name}·${point}: no correction at frame ${frame}`, true);
        return;
      }
      this._message(`${FINS[fin].name}·${point}: correction at frame ${frame} removed`);
      this.onChangeFrame();
      this.requestRedraw();
      return;
    }

    if (!this.store.removePoint(fin, point)) {
      this._message(`${FINS[fin].name}: can't remove its last point`, true);
      return;
    }
    this.selected = null;
    this._message(`${FINS[fin].name}·${point} removed`);
    this.onChangeGlobal();
    this.requestRedraw();
  }

  resetFin() {
    if (this.selected === null) {
      this._message("select a point first — resets that whole fin", true);
      return;
    }
    const fin = this.selected.fin;
    if (this.mode === "frame") {
      this.frameStore.clearFin(FINS[fin].name);
      this._message(`${FINS[fin].name}: all per-frame corrections cleared`);
      this.onChangeFrame();
    } else {
      this.store.resetFin(fin);
      this.selected = null;
      this._message(`${FINS[fin].name} reset to fins.js defaults`);
      this.onChangeGlobal();
    }
    this.requestRedraw();
  }

  resetAll() {
    if (this.mode === "frame") {
      if (!this.frameStore.count) return;
      if (!confirm(`Clear all ${this.frameStore.count} per-frame anchor correction(s)?`)) return;
      this.frameStore.clearAll();
      this._message("all per-frame corrections cleared");
      this.onChangeFrame();
    } else {
      if (!confirm("Reset every fin's anchor points to the fins.js defaults?")) return;
      this.store.resetAll();
      this.selected = null;
      this._message("all fins reset");
      this.onChangeGlobal();
    }
    this.requestRedraw();
  }

  exportJson() {
    if (this.mode === "frame") {
      const data = this.frameStore.exportJson();
      this._message(`exported ${Object.keys(data.points).length} point track(s)`);
    } else {
      const data = this.store.exportJson();
      this._message(`exported anchors for ${data.fins.length} fin(s)`);
    }
  }

  async importJson() {
    try {
      if (this.mode === "frame") {
        const data = await this.frameStore.importJson();
        if (data === null) return;
        this._message(`imported ${Object.keys(data.points).length} point track(s)`);
        this.onChangeFrame();
      } else {
        const data = await this.store.importJson();
        if (data === null) return;
        this.selected = null;
        this._message(`imported anchors for ${data.fins.length} fin(s)`);
        this.onChangeGlobal();
      }
      this.requestRedraw();
    } catch (err) {
      this._message(`import failed: ${err.message}`, true);
      console.error("Fin anchor import failed:", err);
    }
  }

  // ----- keyboard ------------------------------------------------------------------

  // Returns true when the key was consumed.
  handleKey(e, editorKey) {
    if (isTypingTarget(e.target)) return false;
    const k = e.key.toLowerCase();

    if (k === editorKey) {
      this.toggle();
      return true;
    }
    if (!this.active) return false;

    if (k === "f") {
      this.toggleMode();
      return true;
    }
    if (k === "backspace" || k === "delete") {
      e.preventDefault();
      this.removeSelected();
      return true;
    }
    return false;
  }

  // ----- drawing -------------------------------------------------------------------

  draw(ctx, dpr) {
    if (!this.active) return;
    const cover = this.getCover();
    if (!cover) return;
    const pose = this.getPose();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.font = LABEL_FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";

    const frame = this.mode === "frame" ? this.getFrame() : null;

    FINS.forEach((fin, fi) => {
      const col = PALETTE[fi % PALETTE.length];
      const effPts = fin.arc.map((_, pi) => this._screenFor(this._effectiveUV(fi, pi), pose, cover));

      // the polyline the roots actually interpolate along, at THIS frame
      if (effPts.length > 1) {
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(effPts[0].x, effPts[0].y);
        for (let i = 1; i < effPts.length; i++) ctx.lineTo(effPts[i].x, effPts[i].y);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      fin.arc.forEach((_, pi) => {
        const s = effPts[pi];
        const isSel = this.selected && this.selected.fin === fi && this.selected.point === pi;
        const isHov = this.hovering && this.hovering.fin === fi && this.hovering.point === pi;

        // Frame mode: a faint ghost at the UNCORRECTED base position, so the
        // nudge you're carrying reads as a distance, not just a dot.
        if (this.mode === "frame") {
          const base = this._screenFor(this._baseUV(fi, pi), pose, cover);
          if (Math.hypot(base.x - s.x, base.y - s.y) > 0.5) {
            ctx.beginPath();
            ctx.arc(base.x, base.y, GHOST_RADIUS, 0, TAU);
            ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(base.x, base.y);
            ctx.lineTo(s.x, s.y);
            ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }

        ctx.beginPath();
        ctx.arc(s.x, s.y, isSel ? SELECTED_RADIUS : DOT_RADIUS, 0, TAU);
        ctx.fillStyle = isSel ? "#fff34d" : col;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
        ctx.stroke();

        if (isHov && !isSel) {
          ctx.beginPath();
          ctx.arc(s.x, s.y, HIT_RADIUS, 0, TAU);
          ctx.strokeStyle = col;
          ctx.stroke();
        }

        const hasFrameKey = this.mode === "frame" && this.frameStore.hasKeyframe(fin.name, pi, frame);
        const label = `${fin.name}·${pi}${hasFrameKey ? " •" : ""}`;
        ctx.fillStyle = isSel ? "#fff34d" : "#e8f6ff";
        ctx.fillText(label, s.x, s.y - (isSel ? SELECTED_RADIUS : DOT_RADIUS) - 5);
      });
    });

    this._drawHud(ctx, frame);
  }

  _drawHud(ctx, frame) {
    const sel = this.selected;
    const uv = sel ? this._effectiveUV(sel.fin, sel.point) : null;
    const totalPoints = FINS.reduce((n, f) => n + f.arc.length, 0);

    const data = [
      "FIN ANCHOR EDITOR",
      `mode       ${this.mode.toUpperCase()}${this.mode === "frame" ? `   frame ${frame}   ${this.isPaused() ? "PAUSED" : "PLAYING (drag to pause)"}` : ""}`,
      `fins       ${FINS.length}   points ${totalPoints}` +
        (this.mode === "frame" ? `   frame corrections ${this.frameStore.count}` : ""),
      `selected   ${sel ? `${FINS[sel.fin].name}·${sel.point}` : "none"}`,
      uv ? `  (u, v)   [${uv[0].toFixed(4)}, ${uv[1].toFixed(4)}]` : "  (u, v)   —",
      `autosave   ${this.store.saveState} / ${this.frameStore.saveState}`,
    ];
    const help =
      this.mode === "frame"
        ? [
            "drag: nudge the point at THIS FRAME ONLY (fades out a few frames either side)",
            "⌫ removes just this frame's correction · \"Reset fin\": clear the whole fin",
            ", . step a frame · space pause",
            "f: back to global mode · e closes the editor",
          ]
        : [
            "drag a point to move it (screen -> body u,v at THIS frame's pose)",
            "+ point: insert after selected · ⌫ delete · reset fin/all",
            "f: switch to per-frame mode, for drift that isn't constant",
            "e closes the editor",
          ];

    const width = 480;
    const padding = 10;
    const lineHeight = 17;
    const x = Math.max(12, window.innerWidth - width - 12);
    const y = 12;
    const lines = data.length + help.length + 1;

    ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
    ctx.fillRect(x, y, width, padding * 2 + lines * lineHeight);
    ctx.font = '13px ui-monospace, "SF Mono", Menlo, monospace';
    ctx.textAlign = "left";
    let ty = y + padding + lineHeight;
    ctx.fillStyle = "#7fd7ff";
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
