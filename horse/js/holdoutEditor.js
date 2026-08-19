// ============================================================================
//  HOLDOUT EDITOR — drag the "tapar" zone's center and radius, frame by frame.
//
//  Same shape as trackingEditor.js (keyframes, timeline, JSON export/import),
//  but the interaction is the anchorEditor.js kind: two draggable points per
//  zone instead of a fixed pen count. Unlike trackingEditor, this tool does NOT
//  suppress the mane — main.js never adds it to inspecting() — because the whole
//  point is watching the letters pile up on the ear while you park the circle
//  on it.
//
//  A zone is { nx, ny, r }: normalized center plus a radius as a fraction of the
//  video WIDTH (same convention CONFIG.holdout.zones has always used). Two
//  handles per zone:
//    center  dragged freely, sets nx/ny directly.
//    edge    always redrawn straight right of the center, at screen distance
//            r * cover.drawW; dragging it only reads the distance to the
//            center (in cover.drawW units), never the angle, so a zone can't
//            accidentally become an ellipse.
// ============================================================================

import { CONFIG } from "./config.js";
import { normToScreen, screenToNorm } from "../../shared/js/cover.js";
import { downloadJSON, pickJSONText } from "../../shared/js/jsonFile.js";
import { HoldoutStore, seedZones, parseHoldoutKeyframes } from "./holdoutStore.js";

const TAU = Math.PI * 2;
const IDENTITY = { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 };

const isTypingTarget = (el) =>
  !!el &&
  (el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable);

export class HoldoutEditor {
  constructor({ video, canvas, getCover, getFrame, seekToFrame, requestRedraw }) {
    this.video = video;
    this.canvas = canvas;
    this.getCover = getCover;
    this.getFrame = getFrame;
    this.seekToFrame = seekToFrame;
    this.requestRedraw = requestRedraw;

    this.store = new HoldoutStore();
    this.status = this.store.init();

    this.active = false;
    // A handle is { zone, which } — which is "center" or "edge".
    this.selected = null;
    this.dragging = false;
    this.dragPointerId = null;
    this.hovering = null;
    this._prevTimelineFrame = null;

    this._buildDom();
    this._bindPointer();
  }

  // ----- DOM chrome (reuses the shared .te-* editor chrome) -----------------

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
      ["Toggle enabled", () => this.toggleEnabled()],
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
        e.currentTarget.blur();
      });
      panel.appendChild(b);
    }

    const message = document.createElement("div");
    message.className = "te-message";
    panel.appendChild(message);

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
    // The canvas is pointer-events:none by default so the mane isn't clickable;
    // the editor needs the events for as long as it is open. Unlike
    // trackingEditor, the mane itself keeps simulating and drawing underneath.
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

  // ----- geometry ------------------------------------------------------------

  _centerScreen(cover, z) {
    return normToScreen(z.nx, z.ny, cover, IDENTITY);
  }

  _edgeScreen(cover, z) {
    const c = this._centerScreen(cover, z);
    return { x: c.x + z.r * cover.drawW, y: c.y };
  }

  // Every handle on screen, as [{ zone, which, x, y }, ...].
  _handles(cover, zones) {
    const out = [];
    zones.forEach((z, zone) => {
      const c = this._centerScreen(cover, z);
      const e = this._edgeScreen(cover, z);
      out.push({ zone, which: "center", x: c.x, y: c.y });
      out.push({ zone, which: "edge", x: e.x, y: e.y });
    });
    return out;
  }

  _hitTest(clientX, clientY) {
    const cover = this.getCover();
    if (!cover) return null;
    const zones = this.store.poseAt(this.getFrame());
    const r = CONFIG.holdoutEditor.hitRadius;
    let best = null;
    let bestD = r;
    for (const h of this._handles(cover, zones)) {
      const d = Math.hypot(clientX - h.x, clientY - h.y);
      if (d <= bestD) {
        bestD = d;
        best = h;
      }
    }
    return best;
  }

  _sameHandle(a, b) {
    return !!a && !!b && a.zone === b.zone && a.which === b.which;
  }

  // ----- pointer -------------------------------------------------------------

  _bindPointer() {
    this.canvas.addEventListener("pointerdown", (e) => {
      if (!this.active) return;
      const hit = this._hitTest(e.clientX, e.clientY);
      if (hit === null) return;

      // Dragging while the clip plays would fight the playhead.
      if (!this.video.paused) this.video.pause();

      const frame = this.getFrame();
      const wasInterpolated = !this.store.hasKeyframe(frame);
      this.store.materialize(frame);
      if (wasInterpolated) {
        this._refreshTimelineKeys();
        this._message(`frame ${frame}: interpolated zone promoted to a keyframe`);
      }

      this.selected = { zone: hit.zone, which: hit.which };
      this.dragging = true;
      this.dragPointerId = e.pointerId;
      this.canvas.setPointerCapture(e.pointerId);
      this.canvas.style.cursor = "grabbing";
      e.preventDefault();
      this.requestRedraw();
    });

    this.canvas.addEventListener("pointermove", (e) => {
      if (!this.active) return;

      if (!this.dragging) {
        const hit = this._hitTest(e.clientX, e.clientY);
        const hitHandle = hit ? { zone: hit.zone, which: hit.which } : null;
        if (!this._sameHandle(hitHandle, this.hovering)) {
          this.hovering = hitHandle;
          this.canvas.style.cursor = hitHandle === null ? "" : "grab";
          this.requestRedraw();
        }
        return;
      }
      if (e.pointerId !== this.dragPointerId || !this.selected) return;

      const cover = this.getCover();
      if (!cover) return;
      const frame = this.getFrame();

      if (this.selected.which === "center") {
        const { nx, ny } = screenToNorm(e.clientX, e.clientY, cover, IDENTITY);
        this.store.moveZoneCenter(frame, this.selected.zone, nx, ny);
      } else {
        // Only the distance to the center matters — the handle itself always
        // redraws straight right of it, so a zone can't become an ellipse.
        const zones = this.store.poseAt(frame);
        const z = zones[this.selected.zone];
        const c = this._centerScreen(cover, z);
        const dist = Math.hypot(e.clientX - c.x, e.clientY - c.y);
        this.store.setZoneRadius(frame, this.selected.zone, dist / cover.drawW);
      }
      this.requestRedraw();
    });

    const endDrag = (e) => {
      if (!this.dragging || e.pointerId !== this.dragPointerId) return;
      this.dragging = false;
      this.dragPointerId = null;
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
      this.canvas.style.cursor = this.hovering === null ? "" : "grab";
      this.store.saveNow();
      this._message(`frame ${this.getFrame()}: ${this.selected.which} saved`);
      this.requestRedraw();
    };
    this.canvas.addEventListener("pointerup", endDrag);
    this.canvas.addEventListener("pointercancel", endDrag);
  }

  // ----- commands ------------------------------------------------------------

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
    if (frame === 0 && !confirm("Delete the keyframe at frame 0?\n\nIt anchors the whole track.")) {
      return;
    }
    this.store.deleteKeyframe(frame);
    this._refreshTimelineKeys();
    this._message(`frame ${frame}: keyframe deleted`);
    this.requestRedraw();
  }

  resetCurrentFrame() {
    const frame = this.getFrame();
    if (!this.store.hasKeyframe(frame)) {
      this._message(`frame ${frame} is already interpolated`);
      return;
    }
    if (frame === 0) {
      if (!confirm("Reset frame 0 back to the seed zone?")) return;
      this.store.setKeyframe(0, seedZones());
      this._message("frame 0: reset to the seed zone");
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

  // The clip loops, so the last frame's zones have to match frame 0's or the
  // circle snaps every time it wraps.
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
    this._message(`loop closed: frame 0's zones copied to frame ${last}`);
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

  // Flips CONFIG.holdout.enabled directly, exactly like the ?controls "tapar"
  // panel's `enabled` slider — a live preview toggle, not part of the track.
  toggleEnabled() {
    CONFIG.holdout.enabled = !CONFIG.holdout.enabled;
    this._message(`holdout ${CONFIG.holdout.enabled ? "enabled" : "disabled"}`);
    this.requestRedraw();
  }

  exportJson() {
    const data = this.store.serialize();
    downloadJSON(data, CONFIG.holdoutEditor.exportFilename);
    this._message(`exported ${this.store.count} keyframe(s)`);
  }

  async importJson() {
    try {
      const text = await pickJSONText();
      if (text === null) return; // cancelled
      const entries = parseHoldoutKeyframes(JSON.parse(text));
      this.store.replaceAll(entries);
      this.store.saveNow();
      this.selected = null;
      this._refreshTimelineKeys();
      this._message(`imported ${entries.length} keyframe(s)`);
      this.requestRedraw();
    } catch (err) {
      this._message(`import failed: ${err.message}`, true);
      console.error("Holdout import failed:", err);
    }
  }

  // ----- keyboard --------------------------------------------------------

  handleKey(e) {
    if (isTypingTarget(e.target)) return false;
    const K = CONFIG.keys;
    const k = e.key.toLowerCase();

    if (k === K.holdoutEditor) {
      this.toggle();
      return true;
    }
    if (!this.active) return false;

    if (k === K.addKeyframe) {
      this.addKeyframe();
      return true;
    }
    if (K.deleteKeyframe.includes(k)) {
      e.preventDefault();
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

    const cfg = CONFIG.holdoutEditor;
    const col = cfg.colors;
    const frame = this.getFrame();
    const zones = this.store.poseAt(frame);
    const isKey = this.store.hasKeyframe(frame);
    const featherRatio = CONFIG.holdout.featherRatio ?? 0;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    zones.forEach((z, zi) => {
      const c = this._centerScreen(cover, z);
      const r = z.r * cover.drawW;
      const inner = Math.max(0, r * (1 - featherRatio));

      // The two rings this zone actually renders at: the hard outer edge and
      // the point past which _holdoutAt is fully opaque.
      ctx.strokeStyle = col.ring;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, TAU);
      ctx.stroke();
      if (inner > 0) {
        ctx.strokeStyle = col.ringInner;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(c.x, c.y, inner, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      for (const which of ["center", "edge"]) {
        const p = which === "center" ? c : this._edgeScreen(cover, z);
        const isSel = this._sameHandle(this.selected, { zone: zi, which });
        const rad = isSel ? cfg.selectedRadius : cfg.pointRadius;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rad, 0, TAU);
        ctx.fillStyle = isSel ? col.selected : isKey ? col.keyframePoint : col.point;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = col.pointStroke;
        ctx.stroke();

        if (this._sameHandle(this.hovering, { zone: zi, which }) && !isSel) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, cfg.hitRadius, 0, TAU);
          ctx.strokeStyle = col.point;
          ctx.stroke();
        }
      }
    });

    this._refreshTimelinePlayhead(frame);
    this._drawHud(ctx, mediaTime, frame, isKey, zones);
  }

  _drawHud(ctx, mediaTime, frame, isKey, zones) {
    const { hud, colors } = CONFIG.calibration;
    const v = CONFIG.video;
    const store = this.store;

    const prev = store.prevKeyframe(frame);
    const next = store.nextKeyframe(frame);
    const z = zones[0];
    const selText = this.selected
      ? `zone ${this.selected.zone} · ${this.selected.which}`
      : "none";

    const data = [
      `HOLDOUT EDITOR ("tapar")`,
      `frame      ${frame} / ${v.frameCount - 1}   ${isKey ? "KEYFRAME" : "interpolated"}`,
      `mediaTime  ${mediaTime.toFixed(4)} s`,
      `prev key   ${prev === null ? "—" : prev}`,
      `next key   ${next === null ? "—" : next}`,
      `keyframes  ${store.count}`,
      `zone 0     [${z.nx.toFixed(4)}, ${z.ny.toFixed(4)}]  r ${z.r.toFixed(4)}`,
      `holdout    ${CONFIG.holdout.enabled ? "ENABLED" : "disabled"}`,
      `selected   ${selText}`,
      `autosave   ${store.saveState}${store.lastSaveError ? ` (${store.lastSaveError})` : ""}`,
      `state      ${this.video.paused ? "PAUSED" : "PLAYING (drag disabled)"}`,
    ];
    const help = [
      `space play/pause   , . ±1 frame   ← → ±${CONFIG.calibration.seekCoarse}s`,
      `k keyframe   j l prev/next key   shift+← →  jump`,
      `drag center or edge dot   backspace delete key   h close editor`,
    ];

    const width = CONFIG.holdoutEditor.hudWidth;
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
