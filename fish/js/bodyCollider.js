// ============================================================================
//  BODY COLLIDER — keeps the fins OUT of the fish.
//
//  horse/ collides against a hand-painted PNG mask because a horse's neck and
//  jaw are not any simple shape. A fish body is a convex blob, and the tracking
//  already hands us its centre, axis and both semi-axes every frame — so the
//  collider here is an analytic ellipse that rides the body for free. No mask to
//  paint, no mask to keep in sync with a recut clip.
//
//  This exists because it had to: with the swell strong enough to actually bend a
//  fin (strength 0.22), the pectoral and anal rays were driven straight through
//  the belly and drew glyphs across the fish's flank. A fin that overlaps the
//  body does not read as a fin at any brightness.
//
//  Satisfies the interface HairSystem._collide() expects: `cell`, `rawNormal`,
//  and resolve(x, y) -> { nx, ny } | null.
// ============================================================================

// Push step in css px per solver iteration. Applied up to CONFIG.iterations times
// per frame, so this times 7 is the most a deeply-buried particle can travel back
// out in one frame — generous on purpose, since a ray that lags outward for
// several frames reads as the fin briefly sinking into the fish.
const CELL = 16;

export class BodyCollider {
  constructor() {
    this.cell = CELL;
    // The normal is a true outward normal, so HairSystem must not apply the
    // static-PNG special-casing that refuses to ever push a strand upward.
    this.rawNormal = true;
    this.ready = false;
  }

  // Called once per frame, before the solver runs.
  //
  // The two shrink factors are not cosmetic. `halfLen` and `halfDepth` are the
  // body's MAXIMUM extents along each axis, and both are inflated by the fish's
  // own real fins — halfDepth by 24.6% over the clip as the tail flicks. Colliding
  // against the raw extents would hold the code fins off the skin by a visible
  // margin, which looks like the fins are not attached to anything.
  setPose(pose, cover) {
    this.a = pose.halfLen * 0.9;
    this.b = pose.halfDepth * 0.8;
    this.cx = pose.cx;
    this.cy = pose.cy;
    this.aspect = pose.aspect;
    const r = (pose.angle * Math.PI) / 180;
    this.ca = Math.cos(r);
    this.sa = Math.sin(r);
    this.cover = cover;
    this.ready = true;
  }

  resolve(x, y) {
    if (!this.ready) return null;
    const c = this.cover;
    // screen -> width-normalized offset from the body centre. Dividing the y term
    // by the aspect undoes the one place localToNorm() multiplied by it, so the
    // body frame is square again and the ellipse test is a plain circle test.
    const dx = (x - c.offsetX) / c.drawW - this.cx;
    const dy = ((y - c.offsetY) / c.drawH - this.cy) / this.aspect;
    // inverse body rotation
    const u = dx * this.ca + dy * this.sa;
    const v = -dx * this.sa + dy * this.ca;

    const q = (u * u) / (this.a * this.a) + (v * v) / (this.b * this.b);
    if (q >= 1) return null;

    // Gradient of the ellipse's implicit form: the outward normal in body space.
    let nu = u / (this.a * this.a);
    let nv = v / (this.b * this.b);
    const len = Math.hypot(nu, nv);
    if (len < 1e-9) {
      // Dead centre, where the gradient vanishes and there is no "out". Pick the
      // short way out rather than returning null and letting the particle sit
      // inside the fish forever.
      nu = 0;
      nv = this.b > 0 ? 1 : 0;
    } else {
      nu /= len;
      nv /= len;
    }

    // Body space -> screen. The local frame maps to the screen by a rotation and
    // a single uniform scale (drawW), because drawW/width === drawH/height under
    // `cover`. A uniform scale leaves directions alone, so rotating is enough.
    return {
      nx: nu * this.ca - nv * this.sa,
      ny: nu * this.sa + nv * this.ca,
    };
  }
}
