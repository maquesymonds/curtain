// ============================================================================
//  POINTER — where the cursor is, and how fast it is moving.
//
//  Listened for on the WINDOW, not on the canvas: the canvas is
//  pointer-events:none so the piece isn't clickable, and an editor takes those
//  events for itself while it is open. The window sees the motion either way.
//
//  Velocity is tracked as well as position, because a hand brushing through a
//  curtain drags it along the direction of movement — a purely radial push feels
//  like a magnet instead of a touch. It decays on its own, so the strands settle
//  when the cursor stops rather than staying deflected.
// ============================================================================

export const pointer = {
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  active: false,
};

let lastX = 0;
let lastY = 0;
let seen = false;

export function attachPointer(target = window) {
  const onMove = (e) => {
    const x = e.clientX;
    const y = e.clientY;
    if (seen) {
      // Blend into the existing velocity rather than replacing it, so a fast
      // flick still reads as one gesture instead of a single-frame spike.
      pointer.vx = pointer.vx * 0.6 + (x - lastX) * 0.4;
      pointer.vy = pointer.vy * 0.6 + (y - lastY) * 0.4;
    }
    lastX = x;
    lastY = y;
    seen = true;
    pointer.x = x;
    pointer.y = y;
    pointer.active = true;
  };

  target.addEventListener("pointermove", onMove, { passive: true });
  target.addEventListener("pointerdown", onMove, { passive: true });
  // Leaving the window releases the curtain instead of freezing it mid-push.
  document.addEventListener("pointerleave", () => {
    pointer.active = false;
  });
  window.addEventListener("blur", () => {
    pointer.active = false;
  });
}

// Called once per frame by the render loop, after the forces have been applied.
export function decayPointer(factor = 0.82) {
  pointer.vx *= factor;
  pointer.vy *= factor;
}
