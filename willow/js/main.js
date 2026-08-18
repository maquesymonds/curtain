// ============================================================================
//  WILLOW — bootstrap, resize, the render loop, and the two editors' wiring.
//
//  The tree is a STILL image and never moves. What moves is the wind acting on
//  the letters hanging from the branches. So there is no video, no frames, no
//  temporal tracking: compared with the horse this is the same physics with all
//  the time machinery removed.
//
//  TWO editors, both video-tools-style (letters hidden while either is open),
//  and their outputs are COMBINED, not exclusive:
//   - ?anchors / "e"  — clusters: click a point, it auto-generates N strands
//                       fanned out around it.
//   - ?strands / "s"  — individual strands: drag out one at a time, position
//                       and length together, exact control per letter count.
//  Only one editor is ever ACTIVE (its own UI/pointer-capture) at a time —
//  opening one closes the other — but both stores always contribute roots.
// ============================================================================

import { CONFIG, AUTHORED_SYSTEMS } from "./config.js";
import { computeCover } from "../../shared/js/cover.js";
import { HairSystem } from "../../shared/js/hairSystem.js";
import { AnchorStore } from "./anchorStore.js";
import { AnchorEditor } from "./anchorEditor.js";
import { StrandStore } from "./strandStore.js";
import { StrandEditor } from "./strandEditor.js";
import { sampleBranchStrands } from "./branchSampler.js";
import { attachPointer, decayPointer } from "../../shared/js/pointer.js";
import { notifyPointerHit } from "../../shared/js/interactionSound.js";
import { stageReady, onStage } from "../../shared/js/stage.js";

const IDENTITY = { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 };
const BUILD = "2026-08-09 · willow, hand-placed strands + anchor clusters";

const params = new URLSearchParams(location.search);
const bgEl = document.getElementById("bg");
const canvas = document.getElementById("fronds");
const ctx = canvas.getContext("2d");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let dpr = Math.min(window.devicePixelRatio || 1, CONFIG.dprCap);
let cover = null;
let hair = null;
let anchorStore = null;
let strandStore = null;
let anchorEditor = null;
let strandEditor = null;

let anyEditorActive = () => anchorEditor.active || strandEditor.active;

let diag = params.has("diag");
// The live parameter panel (shared/js/controls.js). Unlike the two editors it does not
// suppress the letters — the point is dragging values while the piece runs.
const controlsWanted = params.has("controls");
// Set by the panel when a changed parameter is one that is read while strands are
// BUILT. Kept separate from `needsRebuild` so the editors' behaviour is untouched:
// this path also settles, because a rebuild mid-drag otherwise shows 460 straight
// rulers for a second.
let controlsRebuild = false;
let paused = document.hidden;
// Set from the shell's "curtain:hide" / "curtain:show" (shared/js/stage.js).
let stageHidden = false;
let lastPerf = 0;
let clock = 0; // seconds of wind time, advanced by the loop
let glyphsDrawn = 0;
let framesRendered = 0;
let loopError = null;
let needsRebuild = false;

// Letters stay VISIBLE while editing, because the whole point of placing a strand
// by hand is watching what it does to the picture. The horse's tools hide their
// subject because there you are checking a tracking line against the footage;
// here you are composing, so you need to see the result as you work. Press the
// toggle key if the handles ever get lost among the glyphs.
let showLettersWhileEditing = true;

function applySystems() {
  Object.assign(CONFIG.systems, AUTHORED_SYSTEMS);
  if (anyEditorActive() && !showLettersWhileEditing) CONFIG.systems.renderHair = false;
}

const viewport = () => ({ w: window.innerWidth, h: window.innerHeight });

function sizeCanvas() {
  const { w, h } = viewport();
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function computeCurrentCover() {
  const { w, h } = viewport();
  cover = computeCover(CONFIG.image.width, CONFIG.image.height, w, h);
  return cover;
}

// Rebuild the strands from BOTH sources combined. Cheap enough to run whenever
// either set changes; the loop coalesces bursts into one rebuild per frame.
function rebuild() {
  // Anchor clusters are opt-in (CONFIG.anchors.enabled), so auto-generated
  // strands never compete with the ones placed by hand unless asked for.
  const anchorRoots = CONFIG.anchors.enabled ? anchorStore.toRoots() : [];
  const roots = [...anchorRoots, ...strandStore.toRoots()];
  if (roots.length === 0) {
    hair = null;
    return;
  }
  hair = new HairSystem({ roots, collision: null, bgImage: null });
  hair.build(cover, IDENTITY, dpr);
}

function render() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  glyphsDrawn = hair && CONFIG.systems.renderHair ? hair.draw(ctx, dpr) : 0;
  anchorEditor.draw(ctx, dpr);
  strandEditor.draw(ctx, dpr);

  framesRendered++;
  // Self-report rather than fail silently: "no letters" and "letters too faint"
  // look identical from the outside.
  if (diag || (hair && CONFIG.systems.renderHair && glyphsDrawn === 0 && framesRendered > 30)) {
    drawDiagnostics();
  }
}

function drawDiagnostics() {
  const lines = [
    `WILLOW DIAGNOSTICS   ${BUILD}`,
    ``,
    `anchor editor   ${anchorEditor.active}     strand editor   ${strandEditor.active}`,
    `reduceMotion    ${reduceMotion}`,
    `dpr             ${dpr}   devicePixelRatio=${window.devicePixelRatio}`,
    `viewport        ${window.innerWidth}x${window.innerHeight}`,
    `canvas px       ${canvas.width}x${canvas.height}`,
    `image           ${CONFIG.image.width}x${CONFIG.image.height}  loaded=${bgEl.complete}`,
    `cover           draw ${cover ? `${Math.round(cover.drawW)}x${Math.round(cover.drawH)}` : "—"}`,
    ``,
    `anchors         ${anchorStore ? anchorStore.count : "—"}  (clusters)`,
    `hand strands    ${strandStore ? strandStore.count : "—"}  (individual)`,
    `hair            ${hair ? "built" : "NULL (nothing placed)"}`,
    `strands total   ${hair ? hair.strands.length : "—"}`,
    `particles       ${hair ? hair.particles.length : "—"}`,
    `atlas glyphs    ${hair ? hair.atlas.size : "—"}`,
    `GLYPHS DRAWN    ${glyphsDrawn}`,
    `font            ${CONFIG.fontWeight} ${CONFIG.fontSize}px  color ${CONFIG.color}`,
    ``,
    `systems         ${Object.entries(CONFIG.systems)
      .map(([k, v]) => `${k}=${v ? "on" : "off"}`)
      .join(" ")}`,
    `wind            strength ${CONFIG.windStrength}  period ${CONFIG.windPeriod}s  clock ${clock.toFixed(1)}s`,
    `loop error      ${loopError || "none"}`,
    ``,
    `press d to hide · ?anchors: cluster editor · ?strands: individual strand editor`,
  ];

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  const pad = 12;
  const lh = 16;
  ctx.fillStyle = "rgba(0,0,0,0.86)";
  ctx.fillRect(10, 10, 640, pad * 2 + lines.length * lh);
  ctx.font = '12px ui-monospace, "SF Mono", Menlo, monospace';
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  let y = 10 + pad + lh;
  for (const line of lines) {
    ctx.fillStyle = line.startsWith("GLYPHS DRAWN")
      ? glyphsDrawn > 0
        ? "#7fd7ff"
        : "#ff5588"
      : line === lines[0]
        ? "#7fd7ff"
        : "#cfe";
    ctx.fillText(line, 10 + pad, y);
    y += lh;
  }
}

function loop(now) {
  requestAnimationFrame(loop);
  // `stageHidden` is not optional bookkeeping. Parking a piece with display:none
  // does NOT stop its rAF — Chrome kept firing it 19 times/s in a hidden iframe
  // (measured 2026-08-12), and willow is the most expensive piece there is at
  // 4.28 ms/frame over 20211 particles. Left running behind another piece it cost
  // the visible one 30.7 -> 18.6 fps. `lastPerf` is kept current while parked so
  // dt is sane on the way back instead of arriving as one clamped jump.
  if (paused || stageHidden) {
    lastPerf = now;
    return;
  }

  // One throw must not kill the loop and leave a frozen canvas with no visible
  // explanation, which is exactly how the horse failed silently once.
  try {
    const dt = Math.min((now - lastPerf) / 16.6667, 2.2) || 1;
    lastPerf = now;
    clock += (dt * 16.6667) / 1000;

    if (needsRebuild) {
      needsRebuild = false;
      rebuild();
    }
    if (controlsRebuild) {
      controlsRebuild = false;
      rebuild();
      settle(CONFIG.controlsSettleSteps);
    }
    if (hair) {
      hair.update(dt, clock);
      notifyPointerHit(hair.pointerHit);
    }
    // After the forces are applied, so a flick pushes once and then releases.
    decayPointer(CONFIG.pointer.decay);
    render();
  } catch (err) {
    if (!loopError) {
      loopError = `${err.name}: ${err.message}`;
      console.error("Render loop threw. If this followed a code change, hard-reload (Cmd+Shift+R).", err);
    }
  }
}

// Every strand is built as a straight ruled line out of its root, so the first
// painted frame is rulers, not lianas. Settle before showing it — the shell
// reveals the piece off that first paint, and CONFIG.reduceMotionSettleSteps is
// the same dose the reduced-motion path has always used to reach rest.
function settle(steps) {
  if (!hair || !hair.simulating) return;
  for (let i = 0; i < steps; i++) hair.update(1, 0);
}

let resizeTimer = null;
function onResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    dpr = Math.min(window.devicePixelRatio || 1, CONFIG.dprCap);
    sizeCanvas();
    computeCurrentCover();
    rebuild();
    render();
  }, 150);
}

async function init() {
  console.info(`Willow boot — ${BUILD}`);

  bgEl.src = CONFIG.image.src;
  if (!bgEl.complete) {
    await new Promise((res) => {
      bgEl.addEventListener("load", res, { once: true });
      bgEl.addEventListener("error", res, { once: true });
    });
  }
  if (bgEl.naturalWidth && bgEl.naturalWidth !== CONFIG.image.width) {
    console.warn(
      `CONFIG.image says ${CONFIG.image.width}x${CONFIG.image.height} but ` +
        `${CONFIG.image.src} is ${bgEl.naturalWidth}x${bgEl.naturalHeight}. ` +
        `Update CONFIG.image — anchor/strand coordinates depend on it.`
    );
  }

  sizeCanvas();
  computeCurrentCover();

  anchorStore = new AnchorStore();
  strandStore = new StrandStore();
  const [anchorStatus, strandStatus] = await Promise.all([anchorStore.init(), strandStore.init()]);
  console.info(`Anchors: ${anchorStatus}`);
  console.info(`Strands: ${strandStatus}`);

  rebuild();
  settle(CONFIG.reduceMotionSettleSteps);

  const getCover = () => cover;
  const onChange = () => {
    needsRebuild = true;
  };

  anchorEditor = new AnchorEditor({ canvas, store: anchorStore, getCover, onChange, requestRedraw: render });
  strandEditor = new StrandEditor({ canvas, store: strandStore, getCover, onChange, requestRedraw: render });
  // the panel button and the "h" key do the same thing
  strandEditor.onToggleLetters = () => {
    showLettersWhileEditing = !showLettersWhileEditing;
    applySystems();
    render();
  };
  // Read the tree out of the base image and hang strands on its branches.
  strandEditor.onGenerate = () => {
    const made = sampleBranchStrands(bgEl, cover.drawW, cover.drawH);
    strandStore.replaceAll(made);
    needsRebuild = true;
    return made.length;
  };

  // Exactly one editor's own UI/pointer-capture is active at a time. Whichever
  // the URL asks for wins; if both are requested, strands (the more precise,
  // newer tool) takes it.
  if (params.has("strands")) strandEditor.activate();
  else if (params.has("anchors")) anchorEditor.activate();
  applySystems();

  // Debug hook: lets the browser console (or an external driver) inspect live
  // state without adding UI for it. Read-only in spirit — nothing in the app
  // depends on this existing.
  window.__willow = {
    // Live CONFIG, so pointer/wind/depth values can be tried from the console
    // without an edit-reload cycle.
    cfg: CONFIG,
    anchorStore,
    strandStore,
    getCover: () => cover,
    getHair: () => hair,
    get anchorsEnabled() {
      return CONFIG.anchors.enabled;
    },
  };

  attachPointer();

  window.addEventListener("resize", onResize);
  document.addEventListener("visibilitychange", () => {
    paused = document.hidden;
    lastPerf = performance.now();
  });
  // Coming back from being parked in the shell: the canvas still holds the last
  // frame painted, so there is nothing to rebuild — only the clock to re-anchor,
  // or the first dt would be the whole time spent off screen and the wind would
  // jump.
  onStage({
    onShow: () => {
      stageHidden = false;
      lastPerf = performance.now();
      render();
    },
    // Nothing to pause here — the tree is a still image, there is no clip — but
    // the solver has to stop, which display:none does not do on its own.
    onHide: () => {
      stageHidden = true;
    },
  });
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();

    // Opening one editor closes the other, so their pointer handling and
    // bottom panels never fight each other.
    if (k === CONFIG.keys.editor && !isTyping(e.target)) {
      if (strandEditor.active) strandEditor.deactivate();
      anchorEditor.toggle();
      applySystems();
      render();
      return;
    }
    if (k === CONFIG.keys.strandEditor && !isTyping(e.target)) {
      if (anchorEditor.active) anchorEditor.deactivate();
      strandEditor.toggle();
      applySystems();
      render();
      return;
    }

    if (k === CONFIG.keys.toggleLetters && !isTyping(e.target)) {
      showLettersWhileEditing = !showLettersWhileEditing;
      applySystems();
      render();
      return;
    }

    if (anchorEditor.handleKey(e) || strandEditor.handleKey(e)) {
      applySystems();
      render();
      return;
    }
    if (k === CONFIG.keys.diagnostics) {
      diag = false;
      framesRendered = 0;
      render();
    }
  });

  // The strands are already settled (above, before the editors existed); this is
  // the first paint, and inside the shell it is what the piece is revealed on.
  render();

  if (reduceMotion) {
    stageReady();
    return;
  }

  lastPerf = performance.now();
  requestAnimationFrame(loop);
  stageReady();

  // Last, and only behind the flag: for a visitor the 2.6MB studio bundle is not even
  // a request, and the panel must never delay the first paint.
  if (controlsWanted) startControls();
}

// ---------------------------------------------------------------------------
//  LIVE CONTROLS (?controls) — shared/js/controls.js + ./controls.js
//
//  A change costs one of three things, and the spec says which for every parameter:
//   live     nothing; the solver and the renderer read CONFIG every frame
//   atlas    re-bake the glyph bitmaps (~6ms), strands untouched
//   rebuild  rebuild every strand from the stores. Coalesced through a flag the loop
//            consumes, so a drag that fires thirty changes a second rebuilds once a
//            frame — this piece carries ~20k particles and rebuilding per change
//            would stall the drag completely.
// ---------------------------------------------------------------------------
function startControls() {
  Promise.all([import("./controls.js"), import("../../shared/js/controls.js")])
    .then(([{ CONTROL_SPEC }, { initControls }]) =>
      initControls({
        CONFIG,
        name: "sauce",
        spec: CONTROL_SPEC,
        onApply: (kinds) => {
          if (kinds.has("rebuild")) controlsRebuild = true;
          else if (kinds.has("atlas")) hair?.rebakeAtlas(dpr);
        },
      })
    )
    .then((api) => {
      window.addEventListener("keydown", (e) => {
        if (isTyping(e.target)) return;
        if (e.key.toLowerCase() === CONFIG.keys.controls) api.toggle();
      });
    })
    .catch((err) => console.error("controls: no arrancó, la pieza sigue corriendo.", err));
}

const isTyping = (el) =>
  !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);

init().catch((err) => console.error("Willow init failed:", err));
