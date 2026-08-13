// ============================================================================
//  COVER TRANSFORM + IMAGE ALIGNMENT
//
//  The horse photo fills the viewport with object-fit:cover behaviour. The
//  root-guide and collision-mask must land on the SAME on-screen rectangle so
//  everything stays locked together at any viewport size.
//
//  Because the guide/mask images do not share the photo's aspect ratio, we map
//  them by NORMALIZED coordinates (0..1) onto the horse's cover rectangle, plus
//  an optional align offset/scale from CONFIG for fine tuning.
// ============================================================================

// Cover rectangle of the horse image inside the viewport.
export function computeCover(imgW, imgH, viewW, viewH) {
  const scale = Math.max(viewW / imgW, viewH / imgH);
  const drawW = imgW * scale;
  const drawH = imgH * scale;
  return {
    scale,
    drawW,
    drawH,
    offsetX: (viewW - drawW) / 2,
    offsetY: (viewH - drawH) / 2,
  };
}

// Map a NORMALIZED (0..1) point from a guide/mask image onto the horse's
// on-screen cover rectangle, applying the alignment tuning.
export function normToScreen(nx, ny, cover, align) {
  const ax = 0.5 + (nx - 0.5) * align.scaleX + align.offsetX;
  const ay = 0.5 + (ny - 0.5) * align.scaleY + align.offsetY;
  return {
    x: cover.offsetX + ax * cover.drawW,
    y: cover.offsetY + ay * cover.drawH,
  };
}

// Inverse: screen point → normalized (0..1) in guide/mask space. Used by the
// collision grid to look up whether a screen pixel is inside the body mask.
export function screenToNorm(sx, sy, cover, align) {
  const ax = (sx - cover.offsetX) / cover.drawW;
  const ay = (sy - cover.offsetY) / cover.drawH;
  return {
    nx: (ax - 0.5 - align.offsetX) / align.scaleX + 0.5,
    ny: (ay - 0.5 - align.offsetY) / align.scaleY + 0.5,
  };
}
