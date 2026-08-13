// ============================================================================
//  TRACKING SOURCE — the tracking the EXPERIENCE runs on, at playback time.
//
//  The editor authors into localStorage; that is a working copy. This module
//  reads the exported horse-tracking.json, which is the file that ships. Keeping
//  them separate means editing never changes what visitors see until you export,
//  and the shipped result doesn't depend on one browser's localStorage.
//
//  It interpolates with poseFromKeyframes — the exact same rule the editor draws
//  with — so what you authored is what the mane gets.
//
//  If the file is missing or invalid, `load` returns null and the caller falls
//  back to the legacy 5-point keyframes in tracking.js.
// ============================================================================

import { CONFIG } from "./config.js";
import { catmullRomAt } from "./tracking.js";
import { parseKeyframes, poseFromKeyframes } from "./trackingStore.js";

export class TrackingSource {
  constructor(entries) {
    this.keyframes = new Map(entries);
    // One pose per frame, resolved once at load. The tracking is authored per
    // frame and the video presents discrete frames, so there is nothing to gain
    // from re-interpolating 24 times a second — and this makes the per-frame
    // lookup a plain array index.
    this.poses = [];
    for (let f = 0; f < CONFIG.video.frameCount; f++) {
      this.poses.push(poseFromKeyframes(this.keyframes, f));
    }
    this.keyframeCount = this.keyframes.size;
  }

  static async load(url = CONFIG.trackingSource.url) {
    let res;
    try {
      res = await fetch(url, { cache: "no-cache" });
    } catch (err) {
      console.warn(`Tracking file ${url} could not be fetched (${err.message}).`);
      return null;
    }
    if (!res.ok) {
      console.warn(`Tracking file ${url} returned ${res.status}.`);
      return null;
    }
    try {
      const entries = parseKeyframes(await res.json(), {
        requirePointCount: CONFIG.trackEditor.pointCount,
      });
      return new TrackingSource(entries);
    } catch (err) {
      console.error(`Tracking file ${url} rejected: ${err.message}`);
      return null;
    }
  }

  // The 14 normalized points for a frame index (already clamped by the caller).
  poseAtFrame(frame) {
    const f = Math.min(this.poses.length - 1, Math.max(0, frame));
    return this.poses[f];
  }

  // A point along the birth curve for a frame. `u` runs 0 (front / poll) to
  // 1 (lower neck), matching the direction the legacy 5-point curve ran in, so
  // the per-strand length profile keeps its orientation.
  curvePointAtFrame(frame, u) {
    return catmullRomAt(this.poseAtFrame(frame), u);
  }

  // How far the pose at `frame` is from the pose at frame 0, as a fraction of
  // the video width. Used to report whether the loop actually closes.
  loopGap() {
    const a = this.poseAtFrame(0);
    const b = this.poseAtFrame(this.poses.length - 1);
    let max = 0;
    for (let i = 0; i < a.length; i++) {
      max = Math.max(max, Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1]));
    }
    return max;
  }
}
