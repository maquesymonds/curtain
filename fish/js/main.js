// ============================================================================
//  FISH — bootstrap, the render loop, diagnostics.
//
//  Closest to horse/ of the three pieces, because there is a video and therefore
//  time: the roots ride a tracked body every frame. Simpler than horse/ in one
//  respect — the pose is generated, not hand-keyed, so there is no tracking
//  editor, no store, and no export path. See bodyTrack.js for why that is enough.
//
//  The clock is `video.currentTime`, never an accumulated wall clock. The swell
//  is periodic over CONFIG.windPeriod = 2.5 s = the clip's exact duration, so
//  driving it from the video's own time is what keeps the wave and the footage
//  from drifting apart over a few minutes of playback.
// ============================================================================

import { CONFIG } from "./config.js";
import { computeCover } from "../../shared/js/cover.js";
import { HairSystem } from "../../shared/js/hairSystem.js";
import { attachPointer, decayPointer } from "../../shared/js/pointer.js";
import { BodyTrack } from "./bodyTrack.js";
import { BodyCollider } from "./bodyCollider.js";
import { buildFinRoots, updateFinRoots, assignSwellPhases, FINS } from "./fins.js";
import { stageReady, onStage } from "../../shared/js/stage.js";

const IDENTITY = { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 };
const BUILD = "2026-08-11 · fish, code fins driven by swell";

const params = new URLSearchParams(location.search);
const videoEl = document.getElementById("bg");
const canvas = document.getElementById("fins");
const ctx = canvas.getContext("2d");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let dpr = Math.min(window.devicePixelRatio || 1, CONFIG.dprCap);
let cover = null;
let hair = null;
let track = null;
let buildPose = null;
const collider = new BodyCollider();

let diag = params.has("diag");
// The live parameter panel (shared/js/controls.js). It does not suppress the letters —
// the point is dragging values while the piece runs.
const controlsWanted = params.has("controls");
// Set by the panel when a changed parameter is read while strands are BUILT. Coalesced
// here rather than acted on immediately, so a drag firing thirty changes a second
// rebuilds once per frame instead of thirty times.
let controlsRebuild = false;
let paused = document.hidden;
// Set from the shell's "curtain:hide" / "curtain:show" (shared/js/stage.js).
let stageHidden = false;
let lastPerf = 0;
let glyphsDrawn = 0;
let framesRendered = 0;
let loopError = null;
let trackStatus = "not loaded";

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
  cover = computeCover(CONFIG.video.width, CONFIG.video.height, w, h);
  return cover;
}

// Strands are built ONCE, against the pose at t=0, and thereafter only their
// roots move (updateFinRoots). Rebuilding per frame would throw away the inertia
// that makes a fin trail — the whole point of the piece.
function rebuild() {
  buildPose = track.buildPose;
  const roots = buildFinRoots(buildPose, cover);
  collider.setPose(buildPose, cover);
  hair = new HairSystem({ roots, collision: collider, bgImage: null });
  hair.build(cover, IDENTITY, dpr);
  assignSwellPhases(hair);
}

function render() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  glyphsDrawn = hair && CONFIG.systems.renderHair ? hair.draw(ctx, dpr) : 0;
  if (diag) hair?.drawDebug?.(ctx, dpr);

  framesRendered++;
  // "no letters" and "letters too faint" look identical from the outside, so the
  // piece says which one it is rather than failing silently.
  if (diag || (hair && CONFIG.systems.renderHair && glyphsDrawn === 0 && framesRendered > 30)) {
    drawDiagnostics();
  }
}

function drawDiagnostics() {
  const pose = track ? track.poseAt(videoEl.currentTime || 0) : null;
  const perFin = FINS.map((f) => `${f.name}=${f.count}`).join(" ");
  const lines = [
    `FISH DIAGNOSTICS   ${BUILD}`,
    ``,
    `video           ${CONFIG.video.src}  ${videoEl.videoWidth}x${videoEl.videoHeight}`,
    `                readyState=${videoEl.readyState} paused=${videoEl.paused} t=${(videoEl.currentTime || 0).toFixed(2)}s`,
    `tracking        ${trackStatus}`,
    `pose            ${pose ? `c=(${pose.cx.toFixed(3)}, ${pose.cy.toFixed(3)}) ang=${pose.angle.toFixed(2)}°` : "—"}`,
    `dpr             ${dpr}   viewport ${window.innerWidth}x${window.innerHeight}`,
    `cover           ${cover ? `${Math.round(cover.drawW)}x${Math.round(cover.drawH)}` : "—"}`,
    ``,
    `fins            ${perFin}`,
    `strands         ${hair ? hair.strands.length : "—"}`,
    `particles       ${hair ? hair.particles.length : "—"}`,
    `GLYPHS DRAWN    ${glyphsDrawn}`,
    ``,
    `systems         ${Object.entries(CONFIG.systems)
      .map(([k, v]) => `${k}=${v ? "on" : "off"}`)
      .join(" ")}`,
    `swell           strength ${CONFIG.swell.strength}  cycles ${CONFIG.swell.cycles}  ` +
      `wavelengths ${CONFIG.swell.wavelengths} (UNMEASURED)`,
    `                envelope ${CONFIG.swell.envelope}  period ${CONFIG.windPeriod}s`,
    `gravity         ${CONFIG.gravity}   damping ${CONFIG.damping}`,
    `loop error      ${loopError || "none"}`,
    ``,
    `press d to hide · ?diag to show`,
  ];

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  const pad = 12;
  const lh = 16;
  ctx.fillStyle = "rgba(0,0,0,0.86)";
  ctx.fillRect(10, 10, 680, pad * 2 + lines.length * lh);
  ctx.font = '12px ui-monospace, "SF Mono", Menlo, monospace';
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  let y = 10 + pad + lh;
  for (const line of lines) {
    ctx.fillStyle = line.startsWith("GLYPHS DRAWN")
      ? glyphsDrawn > 0
        ? "#ffb07f"
        : "#ff5588"
      : line === lines[0]
        ? "#ffb07f"
        : "#fde";
    ctx.fillText(line, 10 + pad, y);
    y += lh;
  }
}

// ---------------------------------------------------------------------------
//  LIVE CONTROLS (?controls) — shared/js/controls.js + ./controls.js
//
//  Three costs, declared per parameter in the spec:
//   live     nothing; CONFIG is read every frame. The whole swell block is live.
//   atlas    re-bake the glyph bitmaps (~6ms), strands and physics untouched
//   rebuild  rebuild every fin from the tracked pose, then settle briefly
// ---------------------------------------------------------------------------
function startControls() {
  Promise.all([import("./controls.js"), import("../../shared/js/controls.js")])
    .then(([{ CONTROL_SPEC }, { initControls }]) =>
      initControls({
        CONFIG,
        name: "pez",
        spec: CONTROL_SPEC,
        onApply: (kinds) => {
          if (kinds.has("rebuild")) controlsRebuild = true;
          else if (kinds.has("atlas")) hair?.rebakeAtlas(dpr);
        },
      })
    )
    .then((api) => {
      window.addEventListener("keydown", (e) => {
        const el = document.activeElement;
        if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
        if (e.key.toLowerCase() === CONFIG.keys.controls) api.toggle();
      });
    })
    .catch((err) => console.error("controls: no arrancó, la pieza sigue corriendo.", err));
}

function loop(now) {
  requestAnimationFrame(loop);
  if (controlsRebuild) {
    controlsRebuild = false;
    rebuild();
    settle(CONFIG.controlsSettleSteps);
  }
  // Parked by the shell while another piece is on screen — see the longer note on
  // the same check in willow/js/main.js. Pausing the clip is not enough by
  // itself: display:none does not stop rAF (19 ticks/s measured 2026-08-12), so
  // without this the solver keeps chewing 2241 particles out of sight, on a
  // frozen clock, for nothing.
  if (paused || stageHidden) {
    lastPerf = now;
    return;
  }

  try {
    const dt = Math.min((now - lastPerf) / 16.6667, 2.2) || 1;
    lastPerf = now;
    // The video's own clock, so the wave can never drift out of phase with the
    // footage however long the page is left open.
    const loopTime = videoEl.currentTime || 0;

    if (hair && track) {
      const pose = track.poseAt(loopTime);
      // Before update(), so the solver collides against where the body IS this
      // frame and not where it was last one.
      collider.setPose(pose, cover);
      updateFinRoots(hair, pose, buildPose, cover);
      hair.update(dt, loopTime);
    }
    decayPointer(CONFIG.pointer.decay);
    render();
  } catch (err) {
    if (!loopError) {
      loopError = `${err.name}: ${err.message}`;
      console.error("Render loop threw. After a code change, hard-reload (Cmd+Shift+R).", err);
    }
  }
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

// Let the fins settle before the first frame is shown. Built from the rest pose,
// every strand starts as a straight ruled line out of the body; without this the
// first second of the piece is 82 rulers relaxing into fins.
function settle(steps) {
  for (let i = 0; i < steps; i++) hair.update(1, (i / steps) * CONFIG.windPeriod);
}

async function init() {
  console.info(`Fish boot — ${BUILD}`);

  videoEl.src = CONFIG.video.src;
  videoEl.muted = true;
  videoEl.loop = true;
  videoEl.playsInline = true;
  if (videoEl.readyState < 2) {
    await new Promise((res) => {
      videoEl.addEventListener("loadeddata", res, { once: true });
      videoEl.addEventListener("error", res, { once: true });
    });
  }
  if (videoEl.videoWidth && videoEl.videoWidth !== CONFIG.video.width) {
    console.warn(
      `CONFIG.video says ${CONFIG.video.width}x${CONFIG.video.height} but the clip is ` +
        `${videoEl.videoWidth}x${videoEl.videoHeight}. Fin roots are normalized, so they ` +
        `will still land — but the cover rectangle will be wrong.`
    );
  }

  sizeCanvas();
  computeCurrentCover();

  track = new BodyTrack();
  try {
    trackStatus = await track.init(CONFIG.tracking);
    console.info(`Tracking: ${trackStatus}`);
  } catch (err) {
    trackStatus = `FAILED — ${err.message}`;
    console.error(
      `Could not load ${CONFIG.tracking}. Serve over HTTP with serve.py — ES modules ` +
        `and fetch both fail on file://.`,
      err
    );
    diag = true;
    render();
    return;
  }

  rebuild();
  settle(CONFIG.reduceMotionSettleSteps);
  // Paint HERE, not in the loop's first frame. Inside the shell the piece is
  // revealed off the back of this call: an empty canvas at this point is the fish
  // arriving without fins and growing them a moment later.
  render();

  window.__fish = {
    cfg: CONFIG, // live, so swell values can be tried from the console
    getHair: () => hair,
    getTrack: () => track,
    getCover: () => cover,
    getPose: () => track.poseAt(videoEl.currentTime || 0),
    rebuild,
  };

  attachPointer();
  // Last, and only behind the flag: for a visitor the 2.6MB studio bundle is not even
  // a request.
  if (controlsWanted) startControls();
  window.addEventListener("resize", onResize);
  document.addEventListener("visibilitychange", () => {
    paused = document.hidden;
    lastPerf = performance.now();
  });
  // Parked inside the shell: rAF stops on its own (display:none), but the clip
  // would keep playing under a frozen canvas and come back with the body ahead
  // of the fins. lastPerf is reset on the way in so the first dt is one frame,
  // not however long the piece spent off screen.
  onStage({
    onShow: () => {
      stageHidden = false;
      lastPerf = performance.now();
      if (!reduceMotion) videoEl.play().catch(() => {});
      render();
    },
    onHide: () => {
      stageHidden = true;
      videoEl.pause();
    },
  });
  window.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === CONFIG.keys.diagnostics) {
      diag = !diag;
      framesRendered = 0;
      render();
    }
  });

  // Autoplay can still be refused even muted. Say so instead of showing a black
  // rectangle with fins twitching on top of it.
  try {
    await videoEl.play();
  } catch (err) {
    console.warn("Video autoplay refused; fins will hold at t=0 until it plays.", err);
  }

  if (reduceMotion) {
    videoEl.pause();
    render();
    stageReady();
    return;
  }

  lastPerf = performance.now();
  requestAnimationFrame(loop);
  stageReady();
}

init().catch((err) => console.error("Fish init failed:", err));
