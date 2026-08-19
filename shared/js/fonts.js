// ============================================================================
//  FONTS — wait for the typeface BEFORE the atlas is baked.
//
//  WHY THIS FILE EXISTS AT ALL. In ordinary HTML a webfont that arrives late just
//  restyles the text when it lands. Canvas does not work that way, and these
//  pieces are canvas: every character is drawn ONCE into a bitmap atlas at build
//  time (hairSystem.js _buildAtlas), and `ctx.font` silently falls back to the
//  next family in the stack if the one it names is not loaded YET. Nothing throws,
//  nothing warns — the atlas bakes in the fallback and the piece keeps that
//  fallback for the rest of the session, however fast the real font arrives a
//  moment later.
//
//  So the font is not a style here, it is a BUILD INPUT, and like the tracking
//  JSON it has to be there before the build starts. Self-hosting it
//  (shared/css/fonts.css) makes that wait short; this makes it certain.
//
//  The timeout is deliberate and it is not an error path: a piece that shows its
//  letters in a fallback face is worth infinitely more than a piece that never
//  shows letters, which is what waiting forever on a font would produce.
// ============================================================================

const TIMEOUT_MS = 2500;

// One promise per (weight, family) — every piece calls this once, but a rebuild or
// a reload of the same face should not pay for it twice.
const pending = new Map();

export function ensureGlyphFont(family, weight = 400, { timeout = TIMEOUT_MS } = {}) {
  const spec = `${weight} 16px ${family}`;
  if (pending.has(spec)) return pending.get(spec);

  const load = (async () => {
    if (!document.fonts?.load) return "sin document.fonts — se usa lo que haya";
    try {
      // The shorthand carries the whole stack; document.fonts.load resolves the
      // web faces in it and ignores the generic fallbacks, which is exactly right.
      const faces = await Promise.race([
        document.fonts.load(spec),
        new Promise((res) => setTimeout(() => res(null), timeout)),
      ]);
      if (faces === null) {
        console.warn(
          `fonts: "${family}" no llegó en ${timeout}ms; el atlas se hornea con la ` +
            `familia de reserva. Recargar arregla el look, no hay estado roto.`
        );
        return "timeout";
      }
      return `${faces.length} cara(s) listas`;
    } catch (err) {
      console.warn(`fonts: no pude cargar "${family}"; sigo con la reserva.`, err);
      return `error: ${err.message}`;
    }
  })();

  pending.set(spec, load);
  return load;
}
