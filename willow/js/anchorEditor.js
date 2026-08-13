// ============================================================================
//  ANCHOR EDITOR — you click the tree, letters grow from there.
//
//  Click empty canvas   place a new anchor
//  Drag an anchor       move it
//  Select + [ ]         fewer / more strands in that cluster
//  Select + - =         shorter / longer strands
//  Select + , .         narrower / wider cluster
//  Backspace/Delete     remove the selected anchor
//
//  It owns no data (that's AnchorStore) and no render loop (that's main.js).
//  When anything changes it calls onChange(), and main.js rebuilds the strands.
// ============================================================================

import { CONFIG } from "./config.js";
import { screenToNorm } from "../../shared/js/cover.js";
import { downloadJSON, pickJSONText } from "../../shared/js/jsonFile.js";
import { AnchorStore, parseAnchors } from "./anchorStore.js";

const TAU = Math.PI * 2;
const IDENTITY = { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 };

const isTypingTarget = (el) =>
  !!el &&
  (el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable);

export class AnchorEditor {
  constructor({ canvas, store, getCover, onChange, requestRedraw }) {
    this.canvas = canvas;
    this.store = store;
    this.getCover = getCover;
    this.onChange = onChange;
    this.requestRedraw = requestRedraw;

    this.active = false;
    this.selected = null;
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
      ["− strands", () => this.adjustSelected("count", -1)],
      ["+ strands", () => this.adjustSelected("count", 1)],
      ["shorter", () => this.adjustSelected("len", -CONFIG.anchors.lenStep)],
      ["longer", () => this.adjustSelected("len", CONFIG.anchors.lenStep)],
      ["narrower", () => this.adjustSelected("spread", -CONFIG.anchors.spreadStep)],
      ["wider", () => this.adjustSelected("spread", CONFIG.anchors.spreadStep)],
      ["Delete anchor", () => this.removeSelected()],
      ["Export JSON", () => this.exportJson()],
      ["Import JSON", () => this.importJson()],
      ["Clear all", () => this.clearAll()],
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
    // The canvas is pointer-events:none by default; the editor takes the events
    // (and pointer capture) for as long as it is open.
    this.canvas.style.pointerEvents = "auto";
    this.canvas.style.cursor = "crosshair";
    this._message(this.store.count ? `${this.store.count} anchors — click the tree to add more` : "click the tree to place your first anchor");
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

  // ----- geometry ----------------------------------------------------------

  _anchorScreen(a) {
    const cover = this.getCover();
    return { x: cover.offsetX + a.nx * cover.drawW, y: cover.offsetY + a.ny * cover.drawH };
  }

  _hitTest(clientX, clientY) {
    const cover = this.getCover();
    if (!cover) return null;
    const r = CONFIG.anchors.hitRadius;
    let best = null;
    let bestD = r;
    this.store.anchors.forEach((a, i) => {
      const s = this._anchorScreen(a);
      const d = Math.hypot(clientX - s.x, clientY - s.y);
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  // ----- pointer -----------------------------------------------------------

  _bindPointer() {
    this.canvas.addEventListener("pointerdown", (e) => {
      if (!this.active) return;
      const cover = this.getCover();
      if (!cover) return;
      e.preventDefault();

      const hit = this._hitTest(e.clientX, e.clientY);
      this.movedWhileDown = false;

      if (hit === null) {
        // Empty space: this is where a new anchor goes.
        const { nx, ny } = screenToNorm(e.clientX, e.clientY, cover, IDENTITY);
        this.selected = this.store.add(nx, ny);
        this._message(`anchor ${this.selected} placed`);
        this.onChange();
      } else {
        this.selected = hit;
        this._message(`anchor ${hit} selected`);
      }

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
        if (hit !== this.hovering) {
          this.hovering = hit;
          this.canvas.style.cursor = hit === null ? "crosshair" : "grab";
          this.requestRedraw();
        }
        return;
      }
      if (e.pointerId !== this.dragPointerId || this.selected === null) return;

      const cover = this.getCover();
      const { nx, ny } = screenToNorm(e.clientX, e.clientY, cover, IDENTITY);
      this.store.move(this.selected, nx, ny);
      this.movedWhileDown = true;
      this.onChange();
      this.requestRedraw();
    });

    const endDrag = (e) => {
      if (!this.dragging || e.pointerId !== this.dragPointerId) return;
      this.dragging = false;
      this.dragPointerId = null;
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
      this.canvas.style.cursor = this.hovering === null ? "crosshair" : "grab";
      this.store.saveNow();
      if (this.movedWhileDown) this._message(`anchor ${this.selected} moved`);
      this.requestRedraw();
    };
    this.canvas.addEventListener("pointerup", endDrag);
    this.canvas.addEventListener("pointercancel", endDrag);
  }

  // ----- commands ----------------------------------------------------------

  adjustSelected(key, delta) {
    if (this.selected === null) {
      this._message("select an anchor first", true);
      return;
    }
    this.store.adjust(this.selected, key, delta);
    const a = this.store.anchors[this.selected];
    this._message(`anchor ${this.selected}: ${key} = ${key === "count" ? a.count : a[key].toFixed(3)}`);
    this.onChange();
    this.requestRedraw();
  }

  removeSelected() {
    if (this.selected === null) {
      this._message("select an anchor first", true);
      return;
    }
    const i = this.selected;
    this.store.remove(i);
    this.selected = null;
    this._message(`anchor ${i} removed — ${this.store.count} left`);
    this.onChange();
    this.requestRedraw();
  }

  clearAll() {
    if (!this.store.count) return;
    if (!confirm(`Delete all ${this.store.count} anchors?`)) return;
    this.store.clear();
    this.selected = null;
    this._message("all anchors cleared");
    this.onChange();
    this.requestRedraw();
  }

  exportJson() {
    const data = this.store.serialize();
    downloadJSON(data, CONFIG.anchors.exportFilename);
    this._message(`exported ${data.anchors.length} anchor(s)`);
  }

  async importJson() {
    try {
      const text = await pickJSONText();
      if (text === null) return; // cancelled
      const list = parseAnchors(JSON.parse(text));
      this.store.replaceAll(list);
      this.store.saveNow();
      this.selected = null;
      this._message(`imported ${list.length} anchor(s)`);
      this.onChange();
      this.requestRedraw();
    } catch (err) {
      this._message(`import failed: ${err.message}`, true);
      console.error("Anchor import failed:", err);
    }
  }

  // ----- keyboard ----------------------------------------------------------

  // Returns true when the key was consumed.
  handleKey(e) {
    if (isTypingTarget(e.target)) return false;
    const K = CONFIG.keys;
    const k = e.key.toLowerCase();

    if (k === K.editor) {
      this.toggle();
      return true;
    }
    if (!this.active) return false;

    const A = CONFIG.anchors;
    if (K.remove.includes(k)) {
      e.preventDefault(); // backspace would navigate back
      this.removeSelected();
      return true;
    }
    if (k === K.fewer) return this.adjustSelected("count", -1), true;
    if (k === K.more) return this.adjustSelected("count", 1), true;
    if (k === K.shorter) return this.adjustSelected("len", -A.lenStep), true;
    if (k === K.longer) return this.adjustSelected("len", A.lenStep), true;
    if (k === K.narrower) return this.adjustSelected("spread", -A.spreadStep), true;
    if (k === K.wider) return this.adjustSelected("spread", A.spreadStep), true;
    return false;
  }

  // ----- drawing -----------------------------------------------------------

  draw(ctx, dpr) {
    if (!this.active) return;
    const cover = this.getCover();
    if (!cover) return;

    const c = CONFIG.anchors;
    const col = c.colors;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.font = c.labelFont;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";

    this.store.anchors.forEach((a, i) => {
      const s = this._anchorScreen(a);
      const isSel = i === this.selected;
      const half = (a.spread / 2) * cover.drawW;

      // the bar shows how wide this cluster fans out
      if (half > 1) {
        ctx.strokeStyle = isSel ? col.selected : col.spread;
        ctx.lineWidth = isSel ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(s.x - half, s.y);
        ctx.lineTo(s.x + half, s.y);
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(s.x, s.y, isSel ? c.selectedRadius : c.dotRadius, 0, TAU);
      ctx.fillStyle = isSel ? col.selected : col.dot;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = col.dotStroke;
      ctx.stroke();

      if (i === this.hovering && !isSel) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, c.hitRadius, 0, TAU);
        ctx.strokeStyle = col.dot;
        ctx.stroke();
      }

      ctx.fillStyle = isSel ? col.selected : col.label;
      ctx.fillText(`${i}·${a.count}`, s.x, s.y - c.selectedRadius - 5);
    });

    this._drawHud(ctx);
  }

  _drawHud(ctx) {
    const { hud, colors } = CONFIG.anchors;
    const a = this.selected === null ? null : this.store.anchors[this.selected];
    const totalStrands = this.store.anchors.reduce((n, x) => n + x.count, 0);

    const data = [
      "ANCHOR EDITOR",
      `anchors    ${this.store.count}   strands ${totalStrands}`,
      `selected   ${this.selected === null ? "none" : this.selected}`,
      a ? `  at       [${a.nx.toFixed(4)}, ${a.ny.toFixed(4)}]` : "  at       —",
      a ? `  count    ${a.count}   spread ${a.spread.toFixed(3)}   len ${a.len.toFixed(2)}` : "  count    —",
      `autosave   ${this.store.saveState}${this.store.lastError ? ` (${this.store.lastError})` : ""}`,
    ];
    const help = [
      "click empty space: new anchor · drag: move",
      "[ ] strands   - = length   , . width   ⌫ delete",
      "e close editor",
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
