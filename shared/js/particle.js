import { Vec2 } from "./vec2.js";

// A single Verlet particle. Motion is derived from (pos - oldPos), which makes
// the chain stable under many constraint iterations without tracking velocity
// explicitly.
export class Particle {
  constructor(x, y, { pinned = false, char = " ", scale = 1, alpha = 1 } = {}) {
    this.pos = new Vec2(x, y);
    this.oldPos = new Vec2(x, y);
    // Rest position, used gently near the root. It is RELATIVE to the strand's
    // root: `restOffset` is fixed at build time, and `rest` is recomputed as
    // root + restOffset whenever the root moves. Storing rest as an absolute
    // screen point instead would pin the strand to wherever the head happened to
    // be when the system was built, and fight the tracking every frame.
    this.rest = new Vec2(x, y);
    this.restOffset = new Vec2(0, 0);
    this.acc = new Vec2();
    this.pinned = pinned;
    this.char = char;
    this.scale = scale;
    this.alpha = alpha;
    this.depth = 0; // 0 at root → 1 at tip
    this.prev = null;
    this.next = null;
  }

  addForce(fx, fy) {
    this.acc.x += fx;
    this.acc.y += fy;
  }

  integrate(dt, damping) {
    if (this.pinned) {
      this.acc.zero();
      return;
    }
    const vx = (this.pos.x - this.oldPos.x) * damping;
    const vy = (this.pos.y - this.oldPos.y) * damping;

    this.oldPos.copy(this.pos);

    const dd = dt * dt;
    this.pos.x += vx + this.acc.x * dd;
    this.pos.y += vy + this.acc.y * dd;

    this.acc.zero();
  }
}
