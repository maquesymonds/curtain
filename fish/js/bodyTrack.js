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

  // Pose at a time in seconds within the loop. Wraps, and interpolates between
  // the two bracketing frames so the roots move smoothly at any refresh rate
  // instead of stepping at the clip's 24fps.
  poseAt(time) {
    const n = this.frames.length;
    const f = (((time * this.video.fps) % n) + n) % n;
    const i = Math.floor(f);
    const t = f - i;
    const a = this.frames[i];
    const b = this.frames[(i + 1) % n];
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
