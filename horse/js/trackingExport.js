// ============================================================================
//  TRACKING EXPORT / IMPORT
//
//  The exported file carries two arrays with different jobs:
//    keyframes — ONLY the frames actually edited. This is the editable source.
//    frames    — all `frameCount` frames already evaluated and interpolated.
//                Output for whatever consumes the tracking; never re-imported
//                as keyframes (that would make every frame a keyframe and throw
//                the interpolation away).
// ============================================================================

import { CONFIG } from "./config.js";
import { parseKeyframes } from "./trackingStore.js";

const round = (v, decimals) => {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
};

const roundPoints = (pts, decimals) => pts.map((p) => [round(p[0], decimals), round(p[1], decimals)]);

// Presentation time of a frame. Plain frame / fps — NOT the seek bias used to
// land the playhead on a frame, which is a UI concern and would pollute the data.
export const timeOfFrameExact = (frame) => frame / CONFIG.video.fps;

export function buildExport(store) {
  const v = CONFIG.video;
  const cfg = CONFIG.trackEditor;
  const d = cfg.exportDecimals;

  const keyframes = store.frames().map((frame) => ({
    frame,
    time: round(timeOfFrameExact(frame), d),
    points: roundPoints(store.poseAt(frame), d),
  }));

  const frames = [];
  for (let frame = 0; frame < v.frameCount; frame++) {
    frames.push({
      frame,
      time: round(timeOfFrameExact(frame), d),
      points: roundPoints(store.poseAt(frame), d),
    });
  }

  return {
    version: 1,
    video: {
      width: v.width,
      height: v.height,
      fps: v.fps,
      frameCount: v.frameCount,
      duration: v.duration,
    },
    pointCount: cfg.pointCount,
    keyframes, // sorted by frame — store.frames() is sorted
    frames, // sorted by frame — built in order
  };
}

export function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // give the browser a tick to start the download before revoking
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function exportTracking(store) {
  const data = buildExport(store);
  downloadJSON(data, CONFIG.trackEditor.exportFilename);
  return data;
}

// Parse + validate a file's text. Throws with a message naming what was wrong.
// Returns [[frame, points], ...] ready for store.replaceAll().
export function parseImportedTracking(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`not valid JSON — ${err.message}`);
  }
  return parseKeyframes(parsed, { requirePointCount: CONFIG.trackEditor.pointCount });
}

// Open a file picker and resolve with the validated entries. Resolves null if
// the user cancels.
export function pickTrackingFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.style.display = "none";
    document.body.appendChild(input);

    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) return resolve(null);
      try {
        resolve(parseImportedTracking(await file.text()));
      } catch (err) {
        reject(err);
      }
    });
    // Cancelling a file dialog fires no event in every browser, so the element
    // is left for the GC if that happens; harmless and display:none.
    input.click();
  });
}
