// ============================================================================
//  STRAND EDITOR — draw a curtain, letter by letter, exactly where you want it.
//
//  Drag on empty canvas    place a new strand: root at pointerdown, length =
//                          distance dragged, live "N chars" readout while
//                          dragging, released on pointerup.
//  Click without dragging  place a strand at the default length.
//  Drag an existing root   move that strand.
//  Drag an existing tip    resize that strand.
//  [ / ]                   selected strand: −1 / +1 character
//  Backspace / Delete      remove the selected strand
//
//  Owns no rendering loop and no HairSystem — main.js rebuilds the strands
//  whenever onChange() fires. Combines with AnchorStore's clusters; it doesn't
//  replace them.
// ============================================================================

import { CONFIG } from "./config.js";
import { screenToNorm } from "../../shared/js/cover.js";
import { downloadJSON, pickJSONText } from "../../shared/js/jsonFile.js";
import { StrandStore, parseStrands, charCountForLength } from "./strandStore.js";

const TAU = Math.PI * 2;
const IDENTITY = { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 };

const isTypingTarget = (el) =>
  !!el &&
  (el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable);

export class StrandEditor {
  constructor({ canvas, store, getCover, onChange, requestRedraw }) {
    this.canvas = canvas;
    this.store = store;
    this.getCover = getCover;
    this.onChange = onChange;
    this.requestRedraw = requestRedraw;

    this.active = false;
    this.selected = null;
    this.status = "";

    // Drag state. `mode` is null | "new" | "move" | "resize".
    this.mode = null;
    this.dragPointerId = null;
    this.dragIndex = null;
    this.dragRootScreen = null; // {x,y} fixed during a resize drag
    this.hovering = null; // { index, part: "root" | "tip" } | null

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
      ["SAVE", () => this.saveToProject(), "te-save"],
      ["Generate from tree", () => this.generateFromTree()],
      ["− 1 char", () => this.adjustSelected(-1)],
      ["+ 1 char", () => this.adjustSelected(1)],
      ["Delete strand", () => this.removeSelected()],
      ["Letters on/off", () => this.onToggleLetters?.()],
      ["Export JSON", () => this.exportJson()],
      ["Import JSON", () => this.importJson()],
      ["Clear all", () => this.clearAll()],
    ];
    for (const [label, fn, cls] of buttons) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      if (cls) b.className = cls;
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

  // ----- activation --------------------------------------------------------

  activate() {
    if (this.active) return;
    this.active = true;
    this.dom.root.hidden = false;
    this.canvas.style.pointerEvents = "auto";
    this.canvas.style.cursor = "crosshair";
    this._message(
      this.store.count
        ? `${this.store.count} strands — drag to add more, drag a tip to resize`
        : "drag on the canopy to draw your first strand"
    );
    this.requestRedraw();
  }

  deactivate() {
    if (!this.active) return;
    this.active = false;
    this.mode = null;
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

  _rootScreen(s) {
    const cover = this.getCover();
    return { x: cover.offsetX + s.nx * cover.drawW, y: cover.offsetY + s.ny * cover.drawH };
  }

  // Strands hang straight down (a slight lean is applied by the physics, not
  // here) — the tip handle sits directly below the root by the strand's length,
  // matching the direction the actual strand will render in.
  _tipScreen(s) {
    const r = this._rootScreen(s);
    return { x: r.x, y: r.y + s.lengthPx };
  }

  // Nearest root or tip handle within the grab radius. Roots are checked first,
  // so grabbing near a short strand's root doesn't accidentally hit a neighbour's
  // tip.
  _hitTest(clientX, clientY) {
    const cover = this.getCover();
    if (!cover) return null;
    const r = CONFIG.strands.hitRadius;
    let best = null;
    let bestD = r;
    this.store.strands.forEach((s, i) => {
      const root = this._rootScreen(s);
      const dRoot = Math.hypot(clientX - root.x, clientY - root.y);
      if (dRoot <= bestD) {
        bestD = dRoot;
        best = { index: i, part: "root" };
      }
    });
    // tips checked separately so a root grab always wins at equal distance
    this.store.strands.forEach((s, i) => {
      const tip = this._tipScreen(s);
      const dTip = Math.hypot(clientX - tip.x, clientY - tip.y);
      if (dTip <= bestD) {
        bestD = dTip;
        best = { index: i, part: "tip" };
      }
    });
    return best;
  }

  // ----- pointer -------------------------------------------------------------

  _bindPointer() {
    this.canvas.addEventListener("pointerdown", (e) => {
      if (!this.active) return;
      const cover = this.getCover();
      if (!cover) return;
      e.preventDefault();

      const hit = this._hitTest(e.clientX, e.clientY);

      if (hit === null) {
        // Empty space: start drawing a new strand here. Its length is not known
        // yet — it becomes the drag distance, finalized on pointerup.
        const { nx, ny } = screenToNorm(e.clientX, e.clientY, cover, IDENTITY);
        this.mode = "new";
        this.dragRootScreen = { x: e.clientX, y: e.clientY };
        this.pendingNx = nx;
        this.pendingNy = ny;
        this.pendingLen = CONFIG.strands.defaultLengthPx;
        this.selected = null;
      } else if (hit.part === "root") {
        this.mode = "move";
        this.dragIndex = hit.index;
        this.selected = hit.index;
      } else {
        this.mode = "resize";
        this.dragIndex = hit.index;
        this.dragRootScreen = this._rootScreen(this.store.strands[hit.index]);
        this.selected = hit.index;
      }

      this.dragPointerId = e.pointerId;
      this.canvas.setPointerCapture(e.pointerId);
      this.canvas.style.cursor = "grabbing";
      this.requestRedraw();
    });

    this.canvas.addEventListener("pointermove", (e) => {
      if (!this.active) return;

      if (!this.mode) {
        const hit = this._hitTest(e.clientX, e.clientY);
        const key = hit ? `${hit.index}:${hit.part}` : null;
        const prevKey = this.hovering ? `${this.hovering.index}:${this.hovering.part}` : null;
        if (key !== prevKey) {
          this.hovering = hit;
          this.canvas.style.cursor = hit ? (hit.part === "root" ? "grab" : "ns-resize") : "crosshair";
          this.requestRedraw();
        }
        return;
      }
      if (e.pointerId !== this.dragPointerId) return;
      const cover = this.getCover();

      if (this.mode === "new") {
        this.pendingLen = clampToConfig(Math.hypot(e.clientX - this.dragRootScreen.x, e.clientY - this.dragRootScreen.y));
        this.requestRedraw();
      } else if (this.mode === "move") {
        const { nx, ny } = screenToNorm(e.clientX, e.clientY, cover, IDENTITY);
        this.store.moveRoot(this.dragIndex, nx, ny);
        this.onChange();
        this.requestRedraw();
      } else if (this.mode === "resize") {
        const len = clampToConfig(Math.hypot(e.clientX - this.dragRootScreen.x, e.clientY - this.dragRootScreen.y));
        this.store.setLength(this.dragIndex, len);
        this.onChange();
        this.requestRedraw();
      }
    });

    const endDrag = (e) => {
      if (!this.mode || e.pointerId !== this.dragPointerId) return;
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);

      if (this.mode === "new") {
        // A tap with no real drag still creates a strand, at the default length
        // — clicking to place is as valid as dragging to size.
        const len =
          this.pendingLen < CONFIG.strands.minDragPx ? CONFIG.strands.defaultLengthPx : this.pendingLen;
        this.selected = this.store.add(this.pendingNx, this.pendingNy, len);
        this.onChange();
        this._message(`strand ${this.selected}: ${charCountForLength(len)} chars`);
      } else if (this.mode === "move") {
        this._message(`strand ${this.dragIndex} moved`);
        this.store.saveNow();
      } else if (this.mode === "resize") {
        const s = this.store.strands[this.dragIndex];
        this._message(`strand ${this.dragIndex}: ${charCountForLength(s.lengthPx)} chars`);
        this.store.saveNow();
      }

      this.mode = null;
      this.dragPointerId = null;
      this.canvas.style.cursor = this.hovering ? (this.hovering.part === "root" ? "grab" : "ns-resize") : "crosshair";
      this.requestRedraw();
    };
    this.canvas.addEventListener("pointerup", endDrag);
    this.canvas.addEventListener("pointercancel", endDrag);
  }

  // ----- commands ------------------------------------------------------------

  adjustSelected(deltaSegments) {
    if (this.selected === null) {
      this._message("select a strand first", true);
      return;
    }
    this.store.adjustLengthBySegments(this.selected, deltaSegments);
    const s = this.store.strands[this.selected];
    this._message(`strand ${this.selected}: ${charCountForLength(s.lengthPx)} chars (${Math.round(s.lengthPx)}px)`);
    this.onChange();
    this.requestRedraw();
  }

  removeSelected() {
    if (this.selected === null) {
      this._message("select a strand first", true);
      return;
    }
    const i = this.selected;
    this.store.remove(i);
    this.selected = null;
    this._message(`strand ${i} removed — ${this.store.count} left`);
    this.onChange();
    this.requestRedraw();
  }

  // Fill the tree from the image itself. Generated strands are ordinary strands,
  // so everything can still be dragged, resized or deleted afterwards.
  generateFromTree() {
    if (!this.onGenerate) return;
    const had = this.store.count;
    if (had && !confirm(`Replace the ${had} strand(s) you have with a set generated from the tree's own branches?\n\nThe current set is saved in the project file until you press SAVE again, so you can reload to get it back.`)) {
      return;
    }
    try {
      const made = this.onGenerate();
      this.selected = null;
      this._message(`generated ${made} strand(s) from the tree — press SAVE to keep them`);
      this.requestRedraw();
    } catch (err) {
      this._message(`generate failed: ${err.message}`, true);
      console.error("Generate from tree failed:", err);
    }
  }

  clearAll() {
    if (!this.store.count) return;
    if (!confirm(`Delete all ${this.store.count} hand-placed strands?`)) return;
    this.store.clear();
    this.selected = null;
    this._message("all hand-placed strands cleared");
    this.onChange();
    this.requestRedraw();
  }

  // Write straight into the project file via the dev server, so what you just
  // arranged IS what the piece loads from now on — no download, no moving files
  // around. Falls back to telling you to use Export JSON if the server can't
  // write (e.g. you're serving this with something else).
  async saveToProject() {
    const data = this.store.serialize();
    this._message("saving…");
    try {
      const res = await fetch(CONFIG.strands.sourceUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        throw new Error(body.error || `server said ${res.status}`);
      }
      // Record that the draft now descends from exactly what was written, so a
      // reload trusts the draft instead of re-reading the file over it.
      this.store.markSyncedToFile();
      this._message(`SAVED — ${body.count} strand(s) written to ${body.path}`);
    } catch (err) {
      this._message(`save failed: ${err.message} — use Export JSON instead`, true);
      console.error("Save to project failed:", err);
    }
  }

  exportJson() {
    const data = this.store.serialize();
    downloadJSON(data, CONFIG.strands.exportFilename);
    this._message(`exported ${data.strands.length} strand(s)`);
  }

  async importJson() {
    try {
      const text = await pickJSONText();
      if (text === null) return;
      const list = parseStrands(JSON.parse(text));
      this.store.replaceAll(list);
      this.store.saveNow();
      this.selected = null;
      this._message(`imported ${list.length} strand(s)`);
      this.onChange();
      this.requestRedraw();
    } catch (err) {
      this._message(`import failed: ${err.message}`, true);
      console.error("Strand import failed:", err);
    }
  }

  // ----- keyboard --------------------------------------------------------------

  handleKey(e) {
    if (isTypingTarget(e.target)) return false;
    const K = CONFIG.keys;
    const k = e.key.toLowerCase();

    if (k === K.strandEditor) {
      this.toggle();
      return true;
    }
    if (!this.active) return false;

    if (K.remove.includes(k)) {
      e.preventDefault();
      this.removeSelected();
      return true;
    }
    if (k === K.fewerChars) return this.adjustSelected(-1), true;
    if (k === K.moreChars) return this.adjustSelected(1), true;
    return false;
  }

  // ----- drawing -------------------------------------------------------------

  draw(ctx, dpr) {
    if (!this.active) return;
    const cover = this.getCover();
    if (!cover) return;

    const c = CONFIG.strands;
    const col = c.colors;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.lineCap = "round";
    ctx.font = c.labelFont;
    ctx.textAlign = "center";

    this.store.strands.forEach((s, i) => {
      const isSel = i === this.selected;
      const root = this._rootScreen(s);
      const tip = this._tipScreen(s);

      ctx.strokeStyle = isSel ? col.selected : col.line;
      ctx.lineWidth = isSel ? 2 : 1.25;
      ctx.beginPath();
      ctx.moveTo(root.x, root.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(root.x, root.y, isSel ? c.selectedRadius : c.dotRadius, 0, TAU);
      ctx.fillStyle = isSel ? col.selected : col.root;
      ctx.fill();
      ctx.strokeStyle = col.dotStroke;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(tip.x, tip.y, isSel ? c.selectedRadius - 1 : c.dotRadius - 1, 0, TAU);
      ctx.fillStyle = isSel ? col.selected : col.tip;
      ctx.fill();
      ctx.strokeStyle = col.dotStroke;
      ctx.stroke();

      if (this.hovering && this.hovering.index === i && !isSel) {
        const hs = this.hovering.part === "root" ? root : tip;
        ctx.beginPath();
        ctx.arc(hs.x, hs.y, c.hitRadius, 0, TAU);
        ctx.strokeStyle = col.root;
        ctx.stroke();
      }

      ctx.fillStyle = isSel ? col.selected : col.label;
      ctx.fillText(`${i}·${charCountForLength(s.lengthPx)}`, root.x, root.y - c.selectedRadius - 5);
    });

    // live preview while drawing a brand new strand
    if (this.mode === "new") {
      const root = this.dragRootScreen;
      const tip = { x: root.x, y: root.y + this.pendingLen };
      ctx.strokeStyle = col.preview;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(root.x, root.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = col.preview;
      ctx.font = c.previewFont;
      ctx.fillText(
        `${charCountForLength(this.pendingLen)} chars`,
        tip.x,
        tip.y + 16
      );
    }

    this._drawHud(ctx);
  }

  _drawHud(ctx) {
    const { hud, colors } = CONFIG.strands;
    const s = this.selected === null ? null : this.store.strands[this.selected];

    const data = [
      "STRAND EDITOR",
      `hand-placed strands   ${this.store.count}`,
      `selected               ${this.selected === null ? "none" : this.selected}`,
      s ? `  at                  [${s.nx.toFixed(4)}, ${s.ny.toFixed(4)}]` : "  at                  —",
      s ? `  length               ${Math.round(s.lengthPx)}px  ·  ${charCountForLength(s.lengthPx)} chars` : "  length               —",
      `autosave               ${this.store.saveState}${this.store.lastError ? ` (${this.store.lastError})` : ""}`,
    ];
    const help = [
      "drag empty canvas: new strand · drag root: move · drag tip: resize",
      "[ ] length by 1 char · ⌫ delete · h letters on/off · s close editor",
    ];

    const lines = data.length + help.length + 1;
    ctx.fillStyle = colors.hudBg;
    ctx.fillRect(hud.x, hud.y, hud.width, hud.padding * 2 + lines * hud.lineHeight);
    ctx.font = hud.font;
    ctx.textAlign = "left";
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

function clampToConfig(px) {
  const c = CONFIG.strands;
  return Math.min(c.maxLengthPx, Math.max(1, px));
}
