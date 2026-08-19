// ============================================================================
//  FISH — bootstrap, the render loop, diagnostics.
//
//  Closest to horse/ of the three pieces, because there is a video and therefore
//  time: the roots ride a tracked body every frame. The pose is GENERATED, not
//  hand-keyed (see bodyTrack.js) — but generated tracking still drifts on
//  particular frames, so there is a tracking editor after all: not horse's
//  "author the whole clip by hand" one, a sparse patch on top of the auto
//  track instead. See trackCorrectionStore.js.
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
import { notifyContact, configureSound } from "../../shared/js/interactionSound.js";
import { BodyTrack, boomerangTime, boomerangHalf } from "./bodyTrack.js";
import { BodyCollider } from "./bodyCollider.js";
import { buildFinRoots, updateFinRoots, assignSwellPhases, FINS } from "./fins.js";
import { FinAnchorStore } from "./finAnchorStore.js";
import { FinAnchorFrameStore } from "./finAnchorFrameStore.js";
import { FinAnchorEditor } from "./finAnchorEditor.js";
import { TrackCorrectionStore, poseAt as correctedPoseAt } from "./trackCorrectionStore.js";
import { TrackCorrectionEditor } from "./trackCorrectionEditor.js";
import { stageReady, onStage } from "../../shared/js/stage.js";
import { ensureGlyphFont } from "../../shared/js/fonts.js";
import { offerTuning } from "../../shared/js/tune.js";
import { TUNE_SPEC } from "./tune.js";

// Lower than the horse's despite a similar particle count (431), because the
// fins are sparse and discrete where the mane is a continuous band: measured, a
// brisk brush reads p50 only 5.7 but p99 32, a 5.6x spread, since most frames
// catch a fin's edge and only a few catch it square. So a fin's sound is meant to
// be quiet in between and loud when you actually hook one.
//
// Unlike the horse's and the willow's, this number barely matters. Sweeping it
// over 24 / 16 / 12 / 9 and metering the piece's own output gave -24.7, -24.1,
// -25.4 and -25.9 dB — under 2 dB across the whole range, and not monotonic,
// which is measurement noise on a moving subject rather than a trend. 16 is the
// midpoint of that flat region and sits near the p90 a real catch produces.
configureSound({ weightFull: 16 });

const IDENTITY = { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 };
const BUILD = "2026-08-11 · fish, code fins driven by swell";

const isTypingTarget = (el) =>
  !!el &&
  (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);

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
let finAnchorStore = null;
let finAnchorFrameStore = null;
let finAnchorEditor = null;
let trackCorrectionStore = null;
let trackCorrectionEditor = null;
// Whip damper state — which raw-file half we were in last frame, and how many
// more frames the extra brake still has to run. See CONFIG.whipDamper.
let lastBoomerangHalf = null;
let whipDamperFramesLeft = 0;
const collider = new BodyCollider();

// The pose everything actually renders with: the raw tracked pose plus
// whatever trackCorrectionStore has at this frame (zero almost everywhere).
// Every other call site should go through this, not track.poseAt directly —
// see trackCorrectionStore.js for why the two can drift apart otherwise.
//
// `time` is folded through boomerangTime first: the video FILE plays forward
// then reversed (fish-loop-boomerang.mp4, ~4.92s), but fish-tracking.json and
// every hand-placed correction are keyed to the original 60-frame / 2.5s pass
// — see the comment on boomerangTime in bodyTrack.js.
function poseNow(time) {
  const t = boomerangTime(time, CONFIG.video.duration, CONFIG.video.fps);
  return trackCorrectionStore ? correctedPoseAt(track, trackCorrectionStore, t) : track.poseAt(t);
}

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

// ---------------------------------------------------------------------------
//  PAUSE + FRAME STEP — for working against one still frame (e.g. lining up
//  fin anchors), same pattern as horse/js/main.js's video calibration keys.
// ---------------------------------------------------------------------------

// track.frames.length is the authoritative frame count (fish-tracking.json is
// built for the exact clip in play), CONFIG.video.duration*fps is only a
// fallback for the moment before tracking has loaded.
const frameCount = () => (track ? track.frames.length : Math.round(CONFIG.video.duration * CONFIG.video.fps));

// Folded through boomerangTime first, same reason as poseNow: `mediaTime` can
// be a raw position over the doubled boomerang file, and the frame it names is
// always one of the original 60.
function frameIndexAt(mediaTime) {
  const t = boomerangTime(mediaTime, CONFIG.video.duration, CONFIG.video.fps);
  return Math.min(frameCount() - 1, Math.max(0, Math.round(t * CONFIG.video.fps)));
}

// The inverse is simpler: a frame's forward-pass time is always inside
// [0, loopDuration], which boomerangTime leaves untouched — no folding needed
// on the way out, only on the way in.
function timeOfFrame(frame) {
  const f = Math.min(frameCount() - 1, Math.max(0, frame));
  return f / CONFIG.video.fps;
}

function seekToFrame(frame) {
  videoEl.pause();
  paused = true;
  videoEl.currentTime = timeOfFrame(frame);
}

function seekBySeconds(delta) {
  seekToFrame(frameIndexAt(videoEl.currentTime + delta));
}

const currentFrame = () => frameIndexAt(videoEl.currentTime);

function pauseVideo() {
  videoEl.pause();
  paused = true;
  syncToFrame();
}

function playVideo() {
  videoEl.play();
  paused = false;
  lastPerf = performance.now();
}

// While paused nothing in loop() runs (see the paused/stageHidden check), so a
// seek needs its own redraw: move the pinned roots onto the new pose and
// repaint, without touching hair.update — the rest of each strand keeps
// whatever shape the physics last settled into, only the roots (and hence the
// anchor editor's dots) land exactly on the frame you stepped to.
function syncToFrame() {
  if (hair && track) {
    const time = boomerangTime(videoEl.currentTime || 0, CONFIG.video.duration, CONFIG.video.fps);
    const pose = poseNow(time); // idempotent re-fold, harmless
    collider.setPose(pose, cover);
    updateFinRoots(hair, pose, buildPose, cover, finAnchorFrameStore, track.frameAt(time));
  }
  render();
}

// Strands are built ONCE, against the pose at t=0, and thereafter only their
// roots move (updateFinRoots). Rebuilding per frame would throw away the inertia
// that makes a fin trail — the whole point of the piece.
function rebuild() {
  buildPose = poseNow(0);
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
  finAnchorEditor?.draw(ctx, dpr);
  trackCorrectionEditor?.draw(ctx, dpr);

  framesRendered++;
  // "no letters" and "letters too faint" look identical from the outside, so the
  // piece says which one it is rather than failing silently.
  if (diag || (hair && CONFIG.systems.renderHair && glyphsDrawn === 0 && framesRendered > 30)) {
    drawDiagnostics();
  }
}

function drawDiagnostics() {
  const pose = track ? poseNow(videoEl.currentTime || 0) : null;
  const perFin = FINS.map((f) => `${f.name}=${f.count}`).join(" ");
  const lines = [
    `FISH DIAGNOSTICS   ${BUILD}`,
    ``,
    `video           ${CONFIG.video.src}  ${videoEl.videoWidth}x${videoEl.videoHeight}`,
    `                readyState=${videoEl.readyState} paused=${videoEl.paused} t=${(videoEl.currentTime || 0).toFixed(2)}s ` +
      `frame=${track ? currentFrame() : "—"}/${track ? frameCount() - 1 : "—"}`,
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
    `press e for the fin anchor editor · ?anchors to open it directly`,
    `press r for the tracking correction editor · ?track to open it directly`,
    `space play/pause   ← → ±${CONFIG.seekCoarse}s   , . ±1 frame`,
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
// Both panels that write into CONFIG from outside land here: the authoring one
// (?controls, shared/js/controls.js) and the visitor's dozen knobs in the shell
// (shared/js/tune.js). Same three cost words, so one handler serves both.
//
// A rebuild subsumes an atlas re-bake — hair.build() bakes on its way through —
// which is why these are `else if` and not two ifs.
function applyParamChange(kinds) {
  if (kinds.has("rebuild")) controlsRebuild = true;
  else if (kinds.has("atlas")) {
    hair?.rebakeAtlas(dpr);
    // Nothing repaints while the clip is paused (loop() returns early), so a
    // change made against a still frame would look like it did nothing.
    if (paused) render();
  }
}

function startControls() {
  Promise.all([import("./controls.js"), import("../../shared/js/controls.js")])
    .then(([{ CONTROL_SPEC }, { initControls }]) =>
      initControls({
        CONFIG,
        name: "pez",
        spec: CONTROL_SPEC,
        onApply: applyParamChange,
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
    // Same reason as in applyParamChange: past the check below nothing draws
    // while the clip is paused, so the new fins would not appear until it plays.
    if (paused || stageHidden) render();
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
    // footage however long the page is left open. Folded through boomerangTime:
    // the FILE runs ~4.92s (forward + reversed) for smooth native playback, but
    // the swell — like the tracking — is periodic over the original 2.5s pass,
    // and a triangle wave played backward over exactly one period is already
    // continuous, so nothing about the wave needed retuning for this.
    const loopTime = boomerangTime(videoEl.currentTime || 0, CONFIG.video.duration, CONFIG.video.fps);

    // Catch the exact frame the body's own velocity reverses (see
    // boomerangHalf / CONFIG.whipDamper) and hold extra drag for a few frames
    // from there — the shock gets absorbed on the spot instead of ringing
    // through the strands as a whip.
    const half = boomerangHalf(videoEl.currentTime || 0, CONFIG.video.duration, CONFIG.video.fps);
    if (lastBoomerangHalf !== null && half !== lastBoomerangHalf) {
      whipDamperFramesLeft = CONFIG.whipDamper.frames;
    }
    lastBoomerangHalf = half;
    const dampingBoost = whipDamperFramesLeft > 0 ? CONFIG.whipDamper.factor : 1;
    if (whipDamperFramesLeft > 0) whipDamperFramesLeft--;

    if (hair && track) {
      const pose = poseNow(loopTime); // idempotent re-fold, harmless
      // Before update(), so the solver collides against where the body IS this
      // frame and not where it was last one.
      collider.setPose(pose, cover);
      updateFinRoots(hair, pose, buildPose, cover, finAnchorFrameStore, track.frameAt(loopTime));
      hair.update(dt, loopTime, dampingBoost);
      notifyContact(hair.contact);
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

  // Applied to FINS in place before the first build, so a saved edit is what
  // gets built rather than something rebuild() has to notice later.
  finAnchorStore = new FinAnchorStore();
  console.info(`Fin anchors: ${await finAnchorStore.init()}`);

  // Read by updateFinRoots() every frame, same as trackCorrectionStore below —
  // no rebuild involved, so it doesn't need to exist before rebuild() the way
  // finAnchorStore does.
  finAnchorFrameStore = new FinAnchorFrameStore();
  console.info(`Fin anchor frame corrections: ${await finAnchorFrameStore.init()}`);

  // Read by poseNow() on every pose lookup from here on, including the
  // rebuild() right below — so a correction at frame 0 is picked up by
  // buildPose too, not just by playback.
  trackCorrectionStore = new TrackCorrectionStore();
  console.info(`Track corrections: ${await trackCorrectionStore.init()}`);

  // Before the first build, never after: the atlas bakes whichever face is loaded
  // at that moment and canvas never admits it fell back. See shared/js/fonts.js.
  console.info(`Font: ${await ensureGlyphFont(CONFIG.fontFamily, CONFIG.fontWeight)}`);

  rebuild();
  settle(CONFIG.reduceMotionSettleSteps);
  // Paint HERE, not in the loop's first frame. Inside the shell the piece is
  // revealed off the back of this call: an empty canvas at this point is the fish
  // arriving without fins and growing them a moment later.
  render();

  finAnchorEditor = new FinAnchorEditor({
    canvas,
    store: finAnchorStore,
    frameStore: finAnchorFrameStore,
    getCover: () => cover,
    getPose: () => poseNow(videoEl.currentTime || 0),
    getFrame: currentFrame,
    isPaused: () => videoEl.paused,
    pause: pauseVideo,
    // Global mode: moving a root changes what a whole fan is built from — same
    // cost as an "apply: rebuild" CONTROL_SPEC param, so it rides the same
    // coalesced flag. Frame mode: read live every frame by updateFinRoots, so
    // it only needs a repaint while paused.
    onChangeGlobal: () => {
      controlsRebuild = true;
    },
    onChangeFrame: () => {
      if (videoEl.paused) syncToFrame();
    },
    requestRedraw: render,
  });
  trackCorrectionEditor = new TrackCorrectionEditor({
    canvas,
    store: trackCorrectionStore,
    track,
    getCover: () => cover,
    // Folded through boomerangTime — this editor reads track.poseAt(time)
    // directly (for the dashed "raw tracking" ring), bypassing poseNow, so it
    // has to fold for itself. Everything downstream of this call is already in
    // the tracked loop's own 60-frame domain and needs no further change.
    getTime: () => boomerangTime(videoEl.currentTime || 0, CONFIG.video.duration, CONFIG.video.fps),
    getFrame: currentFrame,
    isPaused: () => videoEl.paused,
    pause: pauseVideo,
    // A pose correction is read live every frame (poseNow), unlike a fin arc
    // edit — no rebuild needed, just a repaint while paused.
    onChange: () => {
      if (videoEl.paused) syncToFrame();
    },
    requestRedraw: render,
  });
  // Only one of the two owns canvas pointer capture at a time.
  finAnchorEditor.exclusiveWith = trackCorrectionEditor;
  trackCorrectionEditor.exclusiveWith = finAnchorEditor;

  if (params.has("anchors")) finAnchorEditor.activate();
  else if (params.has("track")) trackCorrectionEditor.activate();

  window.__fish = {
    cfg: CONFIG, // live, so swell values can be tried from the console
    getHair: () => hair,
    getTrack: () => track,
    getCover: () => cover,
    getPose: () => poseNow(videoEl.currentTime || 0),
    rebuild,
  };

  attachPointer();
  // The visitor's knobs: a plain message channel, no dependency, drawn by the
  // shell. Announced only now, with `hair` already built, so the first thing the
  // panel can ask for is something the piece can actually apply.
  offerTuning({ CONFIG, spec: TUNE_SPEC, onApply: applyParamChange });
  // Last, and only behind the flag: for a visitor the 2.6MB studio bundle is not even
  // a request.
  if (controlsWanted) startControls();
  window.addEventListener("resize", onResize);
  document.addEventListener("visibilitychange", () => {
    // OR'd with the video's own state: coming back to a visible tab must not
    // silently resume the sim out from under a manual pause left for editing.
    paused = document.hidden || videoEl.paused;
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
  // Redraws on every seek while paused — see syncToFrame(). Fires whether the
  // seek came from a key (seekToFrame) or from scrubbing the element directly.
  videoEl.addEventListener("seeked", () => {
    if (paused) syncToFrame();
  });

  window.addEventListener("keydown", (e) => {
    if (isTypingTarget(e.target)) return;
    if (finAnchorEditor?.handleKey(e, CONFIG.keys.finAnchors)) return;
    if (trackCorrectionEditor?.handleKey(e, CONFIG.keys.trackFix)) return;
    const K = CONFIG.keys;
    const k = e.key.toLowerCase();

    if (k === K.diagnostics) {
      diag = !diag;
      framesRendered = 0;
      render();
      return;
    }
    if (k === K.playPause) {
      e.preventDefault(); // space would otherwise scroll the page
      videoEl.paused ? playVideo() : pauseVideo();
      return;
    }
    if (k === K.seekBack) return seekBySeconds(-CONFIG.seekCoarse);
    if (k === K.seekForward) return seekBySeconds(CONFIG.seekCoarse);
    if (k === K.frameBack) return seekToFrame(currentFrame() - 1);
    if (k === K.frameForward) return seekToFrame(currentFrame() + 1);
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
