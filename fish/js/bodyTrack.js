// ============================================================================
//  BODY TRACK — where the fish is, every frame, and the local frame that lets a
//  fin root be authored once and then ride along.
//
//  Unlike horse/, there is NO manual tracking editor here and no need for one.
//  The fish is a saturated red object on a near-black ground, so its pose comes
//  straight out of a colour mask: centroid, principal axis, extent. Measured on
//  the trimmed loop, that pose is smooth enough to use raw — 4.87 px of centroid
//  travel per frame on average, 8.48 px at the worst, 0.16°/frame of rotation.
//  No smoothing pass, because there is nothing to smooth.
//
//  fish-tracking.json is generated, not hand-authored. Regenerate it with the
//  measuring script if the clip is ever recut; the numbers in the comments here
//  and in config.js belong to fish-loop.mp4 as it stands.
//
//  THE LOCAL FRAME. A fin root is authored as (u, v):
//     u  along the body axis:  +1 the snout, -1 the tail
//     v  across it:            -1 the back (dorsal), +1 the belly
//  so "the pectoral sits at the front of the belly" is (0.42, 0.62) and stays
//  true while the fish translates 7.3% of the frame and rotates 3.9°. Authoring
//  fin roots in screen coordinates instead would mean re-placing all 82 of them
//  for every frame of the clip.
// ============================================================================

export class BodyTrack {
  async init(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
    this.doc = await res.json();
    this.video = this.doc.video;
    this.frames = this.doc.frames;
    // Both semi-axes were normalized to the frame WIDTH, so the local frame stays
    // square and a fin does not stretch with the viewport's aspect ratio. Turning
    // a width-normalized offset into a height fraction costs this one factor.
    this.aspect = this.video.width / this.video.height;
    return `${this.frames.length} frames, ${this.video.duration.toFixed(2)}s`;
  }

  // Continuous (fractional) frame position for a time in seconds, CLAMPED into
  // [0, n-1] — not wrapped. Exposed separately from poseAt so a correction can
  // be looked up at the exact same fractional position the raw pose
  // interpolates at — see trackCorrectionStore.js.
  //
  // Clamped rather than wrapped: this used to wrap (mod n), back when the
  // video played forward-only and time legitimately needed to cycle past the
  // last frame back to the first. Now that playback is boomerangTime()-folded
  // (see below), the input here is already inside [0, loopDuration] by
  // construction, and wrapping it AGAIN would blend the last frame toward the
  // first — exactly backward from what a reflection wants at that end, and the
  // bug that made the fins collapse after the boomerang video shipped.
  frameAt(time) {
    const n = this.frames.length;
    return Math.min(n - 1, Math.max(0, time * this.video.fps));
  }

  // Pose at a time in seconds within the loop. Interpolates between the two
  // bracketing frames so the roots move smoothly at any refresh rate instead
  // of stepping at the clip's 24fps. Holds at the last frame rather than
  // blending toward the first — see the note on frameAt.
  poseAt(time) {
    const f = this.frameAt(time);
    const n = this.frames.length;
    const i = Math.min(n - 2, Math.floor(f));
    const t = Math.min(1, f - i);
    const a = this.frames[i];
    const b = this.frames[i + 1];
    const mix = (k) => a[k] + (b[k] - a[k]) * t;
    return {
      cx: a.c[0] + (b.c[0] - a.c[0]) * t,
      cy: a.c[1] + (b.c[1] - a.c[1]) * t,
      angle: mix("angle"),
      halfLen: mix("halfLen"),
      halfDepth: mix("halfDepth"),
      aspect: this.aspect,
    };
  }

  // Reference pose used at build time. Strand rest poses are baked once against
  // this one and then rotated per frame by the DIFFERENCE, so the geometry only
  // ever has to be built a single time.
  get buildPose() {
    return this.poseAt(0);
  }
}

// (u, v) in body space -> normalized (0..1) picture coordinates.
export function localToNorm(pose, u, v) {
  const a = (pose.angle * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  // axis points at the snout; perp is axis turned +90°, i.e. toward the belly
  const ox = ca * u * pose.halfLen - sa * v * pose.halfDepth;
  const oy = sa * u * pose.halfLen + ca * v * pose.halfDepth;
  return [pose.cx + ox, pose.cy + oy * pose.aspect];
}

// Inverse of localToNorm: normalized (0..1) picture coordinates -> (u, v) in
// body space. Used by the fin anchor editor to turn a dragged screen point
// back into the frame the `arc` tables in fins.js are authored in.
export function normToLocal(pose, nx, ny) {
  const a = (pose.angle * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const ox = nx - pose.cx;
  const oy = (ny - pose.cy) / pose.aspect;
  return [(ca * ox + sa * oy) / pose.halfLen, (-sa * ox + ca * oy) / pose.halfDepth];
}

// The video FILE can be longer than the tracked loop — fish-loop-boomerang.mp4
// is fish-loop.mp4 (60 frames) played forward then reversed back-to-back, 120
// frames total, so the pixels play forward the whole time for smooth native
// decoding, with no per-frame JS seeking. But fish-tracking.json is NOT
// doubled to match — it stays the single 60-frame pass it was measured over,
// and every hand-placed correction (trackCorrectionStore.js,
// finAnchorFrameStore.js) is keyed to THOSE frame numbers.
//
// This is what reconciles the two: it folds a raw playback time over the
// doubled file back into the tracked loop's own domain, so "frame 34" means
// the same measured (and possibly corrected) pose whether you're seeing it on
// the way out or its mirror image on the way back.
//
// NOT a plain triangle wave mirrored around loopDuration — that was the first
// version, and it was wrong by exactly one frame's worth of time for the
// ENTIRE reverse half, not just at the seam, because frame index n does not
// exist: file frame n (the first frame of the reversed half) is original
// frame n-1, not n. Confirmed empirically (SSIM), not just by the algebra:
// file frame 90 matches original frame 29 (SSIM 0.975) far better than frame
// 30 (0.922), which is what the naive "period = 2*loopDuration" formula would
// have picked. The mirror point is (2n-1)/fps, one frame short of 2*loopDuration.
export function boomerangTime(rawTime, loopDuration, fps) {
  const n = Math.round(loopDuration * fps); // frames in the forward pass, e.g. 60
  const fileDuration = (2 * n) / fps; // the file's own actual duration, e.g. 5.0s
  let t = rawTime % fileDuration;
  if (t < 0) t += fileDuration;
  if (t <= loopDuration) return t; // forward half: identity
  return (2 * n - 1) / fps - t; // reverse half: mirror around frame n-1's time
}

// Which of the two passes `rawTime` falls in — "fwd" while the body is
// swimming forward through the tracked data, "rev" during its mirror image.
// The BODY'S OWN VELOCITY genuinely reverses, hard, at every switch between
// the two (a boomerang loop has no eased turnaround — the source footage
// doesn't slow down before the video reverses, so neither does the tracked
// pose). Whatever is pinned to that root inherits the same instant reversal
// and, being flexible, whips at it while the rest of the strand's inertia
// catches up. Exposed so main.js can catch the switch and calm the strands
// right at that instant instead of everywhere, all the time — see the
// "whip damper" in the render loop.
export function boomerangHalf(rawTime, loopDuration, fps) {
  const n = Math.round(loopDuration * fps);
  const fileDuration = (2 * n) / fps;
  let t = rawTime % fileDuration;
  if (t < 0) t += fileDuration;
  return t <= loopDuration ? "fwd" : "rev";
}

// A growth direction authored in BODY space -> the `angle` Strand wants.
//
// `dirDeg` is measured in the local frame: 0° points at the snout, 90° at the
// belly, 180° astern. So "trails backward and slightly up" is about 205°, and it
// stays that regardless of how the fish is tilted on screen — the body's own
// rotation is simply added.
//
// Strand builds along +y and rotates by `angle`, giving growth (-sin A, cos A).
// Solving that against the direction we want is the atan2 below.
export function dirToStrandAngle(pose, dirDeg) {
  const theta = ((pose.angle + dirDeg) * Math.PI) / 180;
  return (Math.atan2(-Math.cos(theta), Math.sin(theta)) * 180) / Math.PI;
}
