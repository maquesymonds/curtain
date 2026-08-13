// Tiny mutable 2D vector used throughout the physics.
export class Vec2 {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }
  set(x, y) {
    this.x = x;
    this.y = y;
    return this;
  }
  copy(v) {
    this.x = v.x;
    this.y = v.y;
    return this;
  }
  zero() {
    this.x = 0;
    this.y = 0;
    return this;
  }
}
