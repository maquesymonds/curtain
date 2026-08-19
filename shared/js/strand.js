import { Particle } from "./particle.js";
import { hash, lerp, smoothstep } from "./utils.js";
import { CONFIG } from "./config.js";

// A strand: a chain of particles pinned at the root (on the mane crest) and
// hanging freely below. Chars are assigned down the chain so the strand reads
// as flowing code.
export class Strand {
  constructor({
    rootX,
    rootY,
    length,
    index,
    textCursor,
    text,
    z = 0,
    zTip = null,
    windGain = 1,
    drape = 0,
    angle = 0,
    lean = 1,
  }) {
    this.particles = [];
    this.segments = []; // { a, b, len }
    // How deep this whole strand sits: 0 nearest the viewer, 1 deepest. Drives
    // size, brightness, glow, haze and draw order in HairSystem. Distinct from
    // Particle.depth, which is position ALONG a strand (0 root -> 1 tip).
    // Depth AT THE ROOT and AT THE TIP. A strand can change plane along its own
    // length: a highlight starts near-white at the branch and blends into the
    // ordinary colour further down, so it belongs to the mass instead of reading
    // as a separate white object laid on top. Defaults to a constant z.
    this.z = z;
    this.zTip = zTip ?? z;
    // Multiplier on the wind force for this strand. Lets a piece make a few
    // strands visibly looser than their neighbours.
    this.windGain = windGain;
    // Signed sideways direction, -1 to +1. On a tree this points away from the
    // trunk, so the crown opens outward instead of hanging as parallel bars.
    this.drape = drape;
    // Which way, and how much, this strand's resting pose leans across itself:
    // CONFIG.drapeLean is a single global bias toward "the near side", and for a whole
    // curtain hanging one way that is enough. It is not enough where one part of the
    // piece falls the other way — a horse's forelock breaks forward over the face while
    // the mane sweeps back — so a root can scale or flip it. 1 is what every piece had.
    this.lean = lean;
    // A lateral force this strand carries, in force units per frame, already a VECTOR.
    // Zero unless a piece sets it, and a piece may re-aim it every frame — which is the
    // point: CONFIG.drapeX and drapeSpread are screen-space x forces, correct for a
    // curtain that always falls the same way, wrong for anything whose direction is set by
    // a subject that moves. The horse's forelock is aimed by the tracking, so its pull has
    // to be re-aimed by the tracking as the head turns.
    this.pullX = 0;
    this.pullY = 0;
    // GROWTH DIRECTION, in degrees, of the whole resting pose. 0 = straight down
    // (+y), which is what a hanging strand wants and what horse/ and willow/ get
    // by default. A fin does not hang: it leaves the body along the local normal
    // and trails backward, at a different angle for every root around the arc.
    // The pose is still BUILT in the downward frame below — all the arc, waver
    // and jitter maths stay written as "along the strand" — and then rotated once
    // into place. Rotating at the end rather than threading a direction through
    // every term is what keeps this one number from touching the rest of the file.
    this.angle = angle;

    const count = Math.max(
      CONFIG.minParticles,
      Math.min(CONFIG.maxParticles, Math.round(length / CONFIG.segmentLength))
    );
    const seg = length / count;
    this.segLength = seg;

    // A per-strand horizontal drift so the curtain isn't a rigid grid.
    const drift = (hash(index * 7.3) - 0.5) * seg * CONFIG.wander;
    // Per-strand phase and frequency for the sideways waver, so no two strands
    // bend in the same places. Shared frequency would read as a printed pattern.
    const wavePhase = hash(index * 3.11) * Math.PI * 2;
    const wf = CONFIG.waverFreq;
    const waveFreq = wf[0] + hash(index * 5.77) * (wf[1] - wf[0]);

    // THE POSE IS WALKED, NOT ROTATED. The strand advances one segment at a time
    // along its CURRENT growth direction, and that direction decays from `angle`
    // toward straight down over `CONFIG.angleRelax` of the length. Integrating it is
    // what keeps the segment lengths exactly `segLen` while the pose curves: rotating
    // each point by a different angle about the root would bend the strand but leave
    // the built spacing disagreeing with the rest lengths the solver holds, and the
    // first frames would yank it into a different shape.
    //
    // With `angleRelax: 0` the direction never changes and (sx, sy) reduces to the
    // old single rotation of (0, ly) — the fish and the willow build the exact same
    // geometry they did before.
    const rv = CONFIG.rootVolume;
    let sx = 0;
    let sy = 0;
    let ly = 0;
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const seed = index * 131 + i * 17;

      // Root-zone weight: 1 at the root, 0 from `span` on.
      const rvW =
        rv.span > 0 ? (1 - Math.min(1, t / rv.span)) ** rv.curve : 0;

      // Growth direction here, in radians, 0 = straight down (+y).
      const hold =
        CONFIG.angleRelax > 0
          ? 1 - Math.min(1, t / CONFIG.angleRelax) ** CONFIG.angleRelaxCurve
          : 1;
      const th = (angle * hold * Math.PI) / 180;
      const ca = Math.cos(th);
      const sa = Math.sin(th);

      // Arc sideways in the `drape` direction. The profile is a SMOOTHSTEP, not a
      // power curve: it leaves the branch almost vertically, opens out through the
      // middle, then FLATTENS so the lower half falls straight down. A power curve
      // keeps accelerating outward all the way to the tip, which sends long outer
      // strands sweeping sideways out of frame instead of hanging like a frond.
      // Capped in absolute px too, so a 900px strand doesn't arc proportionally
      // further than a 300px one.
      const arcSpan = Math.min(CONFIG.curveBias * length, CONFIG.maxArcPx);
      const arc = drape * arcSpan * smoothstep(0, 1, t);
      // Slow sideways waver plus a small per-character jitter. The waver is what
      // makes a strand read as a bending filament rather than a ruled line; the
      // jitter stops the characters sitting on one exact axis.
      const waver = Math.sin(wavePhase + t * waveFreq * Math.PI * 2) * seg * CONFIG.waverAmp * t;
      const jitterX = (hash(seed + 7) - 0.5) * seg * CONFIG.charJitterX;

      const lx = drift * t - seg * i * CONFIG.drapeLean * lean + arc + waver + jitterX;

      // Spacing varies character to character, so a vine doesn't read as evenly
      // set type. Each segment keeps its own rest length, so the solver holds
      // the uneven spacing instead of averaging it away. Near the root it is also
      // COMPRESSED by rootVolume.spacing, which is what packs the first stretch of
      // every strand into a surface rather than a row of separate columns.
      const segLen =
        i === 0
          ? 0
          : seg *
            (1 + (hash(seed + 13) - 0.5) * 2 * CONFIG.charSpacingJitter) *
            lerp(1, rv.spacing, rvW);
      ly += segLen;
      // One step along the current growth direction. d(th) = (-sin, cos): "down"
      // turned by th, the same mapping the old single rotation applied.
      sx += -sa * segLen;
      sy += ca * segLen;

      // The lateral terms ride the perpendicular of that same direction, so an arc
      // stays an arc across the strand instead of skewing as the strand turns.
      const rx = sx + lx * ca;
      const ry = sy + lx * sa;
      const x = rootX + rx;
      const y = rootY + ry;

      // Ends fray instead of stopping on a clean line: past `frayFrom` a growing
      // share of characters is dropped, so the last few are scattered and the
      // very tip is often a single isolated glyph.
      // WHERE THE WORD STARTS. With CONFIG.textFromRoot every strand reads from the
      // first character of the text, so a one-word text comes out legible down every
      // strand. Two things get in the way of that and both are handled here.
      //
      // 1. hideRootGlyph draws nothing on the pinned root particle (for good reason —
      //    see the note below), which would eat the word's FIRST LETTER: the fish's
      //    fins read "ILAMENTO". So the read is shifted by one, and the word starts on
      //    the first character that is actually drawn.
      const fromRoot = CONFIG.textFromRoot && !CONFIG.charPool;
      const rootShift = fromRoot && CONFIG.hideRootGlyph ? 1 : 0;
      let char = text[(textCursor + i - rootShift + text.length) % text.length];
      // 2. Fraying scatters the end of a strand, and on a SHORT strand it begins
      //    inside the first repetition: measured on the mane, 11 of 84 strands lost a
      //    letter that way and read "FILAMENT  F". So the first pass of the text is
      //    exempt, and everything past it frays as before. What this cannot fix is a
      //    strand with fewer particles than the word has letters — 2 of the 84 have 8,
      //    so they read "FILAMENT" and stop. Raising minParticles would lengthen the
      //    shortest locks at the edge of the crest, which costs more than it buys.
      const wordGuard = fromRoot ? text.length + rootShift : 0;
      if (t > CONFIG.frayFrom && i >= wordGuard) {
        const frayT = (t - CONFIG.frayFrom) / (1 - CONFIG.frayFrom);
        if (hash(seed + 29) < frayT * CONFIG.frayAmount) char = " ";
      }
      // The root particle carries NO glyph when `hideRootGlyph` is on. It is
      // pinned, so it is the one character in the strand that cannot move at all:
      // measured over a wind cycle, index 0 travels 0.0px while index 1 travels
      // 7px and index 3 travels 27px. A letter sitting there reads as pinned to
      // the branch — and it is worse when the strand is brightest at its start,
      // because then the frozen character is also the most visible one. Dropping
      // it makes the first drawn character one that actually sways, and costs
      // nothing physically: the particle stays as the anchor.
      if (i === 0 && CONFIG.hideRootGlyph) char = " ";

      const p = new Particle(x, y, {
        pinned: i === 0,
        char,
        // Taper: glyphs shrink toward the loose end, so a strand thins out the way
        // a real one does instead of staying the same weight for its whole run. And
        // they are set LARGER at the root, where the strand belongs to a mass.
        scale:
          lerp(CONFIG.minScale, CONFIG.maxScale, hash(seed)) *
          lerp(1, CONFIG.tipScale, t) *
          lerp(1, rv.scale, rvW),
        alpha: lerp(CONFIG.minAlpha, CONFIG.maxAlpha, hash(seed + 1)),
      });
      p.depth = t;
      // Rest pose kept as an offset from the root, so it travels with it.
      p.restOffset.set(rx, ry);

      if (i > 0) {
        const prev = this.particles[i - 1];
        prev.next = p;
        p.prev = prev;
        this.segments.push({ a: prev, b: p, len: segLen });
      }
      this.particles.push(p);
    }

    this.textAdvance = count + 1;
  }
}
