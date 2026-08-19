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
// When the last pointermove arrived. `active` is not enough to tell whether the
// cursor is MOVING: it is set true by the first move and only ever cleared by
// pointerleave or blur, so a cursor parked in the curtain — or one whose piece
// stopped receiving events because its iframe went pointer-events:none — reads
// as active for as long as the page lives.
let lastMoveAt = -Infinity;
// A pointer that has not moved for this long is treated as still. Two frames at
// 60 fps is too tight (a real hand produces gaps), 200 ms is long enough to hear
// as a lag; 110 ms is under one perceptible beat and over any plausible gap
// between two moves of a hand that is actually moving.
const STILL_AFTER_MS = 110;

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
    lastMoveAt = performance.now();
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

// Whether the cursor is moving RIGHT NOW, as opposed to having moved at some
// point. Anything that should only happen while a hand is travelling through the
// curtain — the sound, above all — has to ask this and not `pointer.active`.
//
// It is a timestamp comparison rather than a velocity threshold on purpose: the
// velocity is decayed by the render loop, so it only reaches zero while frames
// are being drawn. A piece whose loop is paused (a hidden iframe in the shell)
// freezes its last velocity instead, and would come back still holding it.
export function isPointerMoving() {
  return performance.now() - lastMoveAt < STILL_AFTER_MS;
}
