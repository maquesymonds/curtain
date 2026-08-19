// ============================================================================
//  HAIR SYSTEM
//  Owns the strands, the physics step, the glyph atlas and the renderer.
// ============================================================================

import { CONFIG, AUTHORED_SYSTEMS, hairText } from "./config.js";
import { Strand } from "./strand.js";
import { Wind } from "./wind.js";
import { Swell } from "./swell.js";
import { normToScreen } from "./cover.js";
import { sampleProfile, lerp, hash, smoothstep } from "./utils.js";
import { pointer, isPointerMoving } from "./pointer.js";

const IDENTITY_ALIGN = { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 };

// Blend two "#rrggbb" colours. Used to haze a glyph toward the background as it
// recedes — the desaturation is what sells distance, more than dimming alone.
function mixHex(a, b, t) {
  const parse = (h) => {
    const v = parseInt(h.replace("#", ""), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  };
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const c = (x, y) => Math.round(x + (y - x) * t);
  return `rgb(${c(ar, br)}, ${c(ag, bg)}, ${c(ab, bb)})`;
}

// The three things that vary with a strand's z, shared by atlas baking and by
// the draw loop so a bucket and the strand using it always agree.
// z < 0 is a highlight (nearer than the front plane), z > 0 recedes.
function fillForZ(depth, color, z) {
  if (z < 0) return mixHex(color, depth.highlightColor, -z * depth.highlight);
  return mixHex(color, depth.hazeColor, lerp(depth.haze[0], depth.haze[1], z));
}

function glowForZ(depth, z) {
  if (z < 0) return lerp(depth.glow[0], depth.highlightGlow, -z);
  return lerp(depth.glow[0], depth.glow[1], z);
}

// Highlights keep the front plane's size and full opacity; only receding strands
// shrink and fade.
function scaleForZ(depth, z) {
  return z <= 0 ? depth.scale[0] : lerp(depth.scale[0], depth.scale[1], z);
}

function alphaForZ(depth, z) {
  return z <= 0 ? depth.alpha[0] : lerp(depth.alpha[0], depth.alpha[1], z);
}

// Which baked atlas covers a given z, mapping -1..1 onto 0..lastBucket.
function bucketFor(z, lastBucket, enabled) {
  if (!enabled) return 0;
  return Math.max(0, Math.min(lastBucket, Math.round(((z + 1) / 2) * lastBucket)));
}

export class HairSystem {
  constructor({ roots, collision, bgImage }) {
    this.roots = roots; // [{ nx, ny, t }]
    this.collision = collision; // CollisionField (built on resize)
    this.bgImage = bgImage; // the horse photo, for the blurred root-band cover
    this.wind = new Wind();
    this.swell = new Swell();

    this.strands = [];
    this.particles = [];
    this.cohesion = []; // soft lateral springs { a, b, len }
    this.atlas = new Map();
    this.rootScreen = []; // screen positions, for the calibration/debug overlays
    // Set for one update() call whenever the cursor was actually within reach
    // of at least one particle this frame — a piece uses this to trigger
    // something (a sound, say) on real contact, not just on cursor movement
    // anywhere near the canvas. See shared/js/interactionSound.js.
    this.pointerHit = false;
    // The same contact, MEASURED rather than reduced to a yes/no. A boolean is
    // enough to start a sound and nothing more: brushing three glyphs and
    // sweeping the whole curtain set it identically, so anything driven by it
    // can only ever play at one intensity. These are the quantities a gesture
    // actually has, and shared/js/interactionSound.js maps every one of them:
    //
    //   count     particles inside the radius. Raw, unweighted.
    //   weight    sum of each hit particle's falloff × its along-strand depth,
    //             i.e. how much curtain is really being displaced. This, not
    //             `count`, is the honest "thickness" of the touch: forty roots
    //             barely clipped at the radius edge move less than eight tips
    //             taken head-on, and weight says so while count does not.
    //   u         where along the curtain the contact is, 0..1, averaged over
    //             the hit particles and weighted by the same falloff. Taken
    //             from `strand.rootU` when the piece has one (the horse's mane
    //             spline) and from the strand's build order otherwise.
    //   speed     cursor speed, 0..1, normalised against SPEED_FULL below.
    //   nx        cursor x across the viewport, 0..1, for stereo placement.
    this.contact = { hit: false, count: 0, weight: 0, u: 0.5, speed: 0, nx: 0.5 };

    // HOLDOUT ZONES — screen-space circles where glyphs are not drawn.
    //
    // A matte, not a force: the point is not that hair cannot GO somewhere, it is that
    // something is IN FRONT of it. On the horse that something is an ear, and hair behind an
    // ear is hidden by the ear — so the honest fix for letters piling up over one is to say
    // where the ear is, not to fight the physics into avoiding it.
    //
    // Set by the piece, in css px, as [{ x, y, r, inner, r2, inner2 }] — the squared radii are
    // precomputed because this is tested per GLYPH, and `inner` is where the fade has finished
    // so the edge is soft. null means no zones, which is what the other two pieces leave it as.
    this.holdoutZones = null;
  }

  // (Re)build all strands for the current cover transform + dpr.
  build(cover, align, dpr) {
    this.cover = cover;
    this.align = align;

    const density =
      window.innerWidth <= CONFIG.mobileBreakpoint ? CONFIG.mobileDensityFactor : 1;
    // Floor of 1, not some larger minimum: `this.roots` is sometimes a dense pool
    // meant to be resampled (the horse's spline, an anchor cluster), but it can
    // also be a handful of individually authored points meant literally — e.g.
    // one hand-placed strand should build as ONE strand, not get padded up by
    // resampling the same point 4 times over.
    const count = Math.max(1, Math.round(this.roots.length * density));

    this.strands = [];
    this.particles = [];
    this.cohesion = [];
    this.rootScreen = [];

    let cursor = 0;
    const [lenMin, lenMax] = CONFIG.lengthRange;
    const text = hairText();

    for (let s = 0; s < count; s++) {
      // evenly pick from the available roots. count === 1 would divide by zero
      // in the general formula (0/0), so it's handled directly: the one strand
      // maps to the one root.
      const pick = count === 1 ? 0 : Math.round((s / (count - 1)) * (this.roots.length - 1));
      const root = this.roots[pick];
      const { x: rootX, y: rootY } = normToScreen(root.nx, root.ny, cover, align);
      this.rootScreen.push({ x: rootX, y: rootY, cover: root.cover });

      // Length: normally the profile sampled by the root's `t`, times an organic
      // jitter, times an optional per-root multiplier (the willow's anchor
      // clusters use `root.lenScale` this way). A root can instead carry an
      // ABSOLUTE `lengthPx`, authored by hand (the willow's strand editor) — no
      // profile, no jitter, exactly the length the person set.
      let length;
      if (root.lengthPx != null) {
        length = root.lengthPx;
      } else {
        const profile = sampleProfile(CONFIG.lengthProfile, root.t);
        const jitter = 1 + (hash(s * 3.7) - 0.5) * 2 * CONFIG.lengthJitter;
        length = lerp(lenMin, lenMax, profile) * jitter * (root.lenScale ?? 1);
      }

      const strand = new Strand({
        rootX,
        rootY,
        length,
        index: s,
        // Where this strand reads from. Normally it carries on from the previous
        // strand, so the curtain never repeats itself; with CONFIG.textFromRoot it
        // starts at 0, which is how one word comes out legible down every strand.
        textCursor: CONFIG.textFromRoot && !CONFIG.charPool ? 0 : cursor,
        text,
        z: root.z ?? 0,
        zTip: root.zTip ?? null,
        windGain: root.windGain ?? 1,
        drape: root.drape ?? 0,
        angle: root.angle ?? 0,
        lean: root.lean ?? 1,
      });
      strand.rootU = root.u; // position along the animated spline (video mode)
      // The whole root descriptor, so a piece can drive its roots from something
      // richer than a single `u` along one curve. The fish needs body-local (u, v)
      // plus a growth direction per root, and resampling above means a piece
      // cannot reliably match strand index back to root index on its own.
      strand.rootDef = root;
      cursor += strand.textAdvance;

      this.strands.push(strand);
      this.particles.push(...strand.particles);
    }

    this._buildCohesion();
    this._buildAtlas(dpr);
    this._buildRootBand(dpr); // self-guards on CONFIG.rootBand and a missing bgImage
  }

  // VIDEO MODE: move only the pinned roots so they ride the tracked crest. The
  // strands themselves are NOT rebuilt — the free particles follow with inertia.
  //
  // `curveAt(u, strand)` returns a normalized [nx, ny] on the birth curve. main.js
  // passes the edited 14-point tracking when it is available, and the legacy
  // 5-point spline otherwise; this method doesn't care which. The strand comes
  // along as a second argument because a birth curve can be per strand: the horse
  // pushes each root a different depth out of the crest band, and only the strand
  // knows which depth is its own.
  updateRoots(cover, curveAt) {
    for (let i = 0; i < this.strands.length; i++) {
      const s = this.strands[i];
      const [nx, ny] = curveAt(s.rootU, s);
      const { x, y } = normToScreen(nx, ny, cover, IDENTITY_ALIGN);
      const root = s.particles[0];
      root.pos.set(x, y);
      root.oldPos.set(x, y);
      root.rest.set(x, y);

      // Carry every rest pose along with the root. Without this, bendReturn pulls
      // the top of each strand toward wherever the root was when build() ran, and
      // the mane visibly lags behind the horse.
      const ps = s.particles;
      for (let k = 1; k < ps.length; k++) {
        ps[k].rest.set(x + ps[k].restOffset.x, y + ps[k].restOffset.y);
      }

      if (this.rootScreen[i]) {
        this.rootScreen[i].x = x;
        this.rootScreen[i].y = y;
      }
    }
  }

  // Pre-render the blurred crest cover ONCE into an offscreen canvas (the crest
  // is static, so there's no reason to blur every frame). Per-frame we just blit
  // this cache — cheap, and it dissolves the white line baked into the photo.
  _buildRootBand(dpr) {
    this.bandCanvas = null;
    if (!CONFIG.rootBand || !this.bgImage || !this.cover || this.rootScreen.length < 2) return;

    const c = this.cover;
    const vw = c.drawW + 2 * c.offsetX;
    const vh = c.drawH + 2 * c.offsetY;
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(vw * dpr));
    cv.height = Math.max(1, Math.round(vh * dpr));
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    const pts = this.rootScreen;
    const up = CONFIG.rootBandUp;
    const down = CONFIG.rootBandDown;

    // Offset each point along the LOCAL NORMAL of the crest (not straight up),
    // so the ribbon hugs the line whether it's flat (poll) or steep (withers)
    // without bulging into the sky.
    const normal = (i) => {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      let tx = b.x - a.x;
      let ty = b.y - a.y;
      const len = Math.hypot(tx, ty) || 1;
      tx /= len;
      ty /= len;
      let nx = -ty;
      let ny = tx;
      if (ny > 0) {
        nx = -nx;
        ny = -ny;
      } // orient toward the sky (negative y)
      return { nx, ny };
    };

    g.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const n = normal(i);
      const x = pts[i].x + n.nx * up;
      const y = pts[i].y + n.ny * up;
      i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    for (let i = pts.length - 1; i >= 0; i--) {
      const n = normal(i);
      g.lineTo(pts[i].x - n.nx * down, pts[i].y - n.ny * down);
    }
    g.closePath();
    g.clip();

    g.filter = `blur(${CONFIG.rootBandBlur}px)`;
    for (let p = 0; p < CONFIG.rootBandPasses; p++) {
      g.drawImage(this.bgImage, c.offsetX, c.offsetY, c.drawW, c.drawH);
    }
    g.filter = "none";
    this.bandCanvas = cv;
  }

  // Very soft springs between neighbouring strands at matching depth, so the
  // mane keeps shared volume instead of every strand swinging independently.
  _buildCohesion() {
    const clump = CONFIG.cohesionClump;
    for (let i = 0; i < this.strands.length - 1; i++) {
      const a = this.strands[i].particles;
      const b = this.strands[i + 1].particles;
      const depth = Math.min(a.length, b.length);
      // Bond strength is drawn ONCE PER PAIR, not per particle: two neighbouring
      // strands either travel together for their whole run or they do not, and it is
      // that all-or-nothing quality that reads as a lock rather than as noise.
      const draw = clump > 0 ? hash(i * 17.3) : 1;
      const bond = 1 - clump + clump * draw;
      // A bonded pair is also pulled CLOSER than it was built, which is the half that
      // actually forms a lock — see cohesionPull.
      const pull = 1 - CONFIG.cohesionPull * draw;
      for (let k = 1; k < depth; k++) {
        const pa = a[k];
        const pb = b[k];
        const len = Math.hypot(pa.pos.x - pb.pos.x, pa.pos.y - pb.pos.y);
        if (len <= 0 || len > CONFIG.cohesionMaxDist) continue;
        this.cohesion.push({ a: pa, b: pb, len: len * pull, k: bond });
      }
    }
  }

  // Pre-render each glyph once, so a frame is just drawImage calls.
  //
  // With depth on, one atlas is baked PER DEPTH BUCKET. Scale and alpha can be
  // applied per draw call, but colour and glow cannot — they are burned into the
  // bitmap — so receding haze and fading self-light need their own variants.
  _buildAtlas(dpr) {
    const chars = new Set(hairText().replace(/\s/g, ""));
    // Read the AUTHORED flag, not the live one: the atlas is baked once here, and
    // a tool's temporary all-off override must not get burned into it.
    const baseGlow = AUTHORED_SYSTEMS.glow ? CONFIG.glowIntensity : 0;
    const outline = CONFIG.glyphOutline;
    const fs = CONFIG.fontSize;
    const depth = CONFIG.depth;
    const buckets = depth.enabled ? Math.max(1, depth.buckets) : 1;
    const bloom = CONFIG.glyphBloom;
    const core = CONFIG.glyphCore;
    // The bloom is only baked when the piece asked for it AND the glow subsystem is
    // on, so switching glow off still gives a flat atlas to compare against.
    const bloomOn = AUTHORED_SYSTEMS.glow && bloom.passes > 0 && bloom.blur > 0;

    // The halo needs room in the bitmap or it is clipped at the box edge, which reads
    // as a square of light around every character.
    const pad = Math.max(baseGlow, bloomOn ? bloom.blur * 1.15 : 0) + outline.width + 4;
    const box = Math.ceil(fs * 1.6 + pad * 2);
    this.glyphBox = box;
    this.atlases = [];

    for (let b = 0; b < buckets; b++) {
      // Bucket position across the full -1..1 range, so a single bucket is the
      // plain front colour and the extremes are highlight / deep haze.
      const t = buckets === 1 ? 0 : -1 + (2 * b) / (buckets - 1);
      const glow = baseGlow * (depth.enabled ? glowForZ(depth, t) : 1);
      const fill = depth.enabled ? fillForZ(depth, CONFIG.color, t) : CONFIG.color;
      // How lit this bucket is relative to the front plane. Highlights get more halo
      // and a hotter core; receding strands get less of both, for the same reason they
      // are hazed — light does not survive distance either.
      const lit = depth.enabled ? glowForZ(depth, t) / (depth.glow[0] || 1) : 1;
      const bloomFill = depth.enabled
        ? fillForZ(depth, bloom.color || CONFIG.color, Math.max(0, t))
        : bloom.color || CONFIG.color;
      const coreFill = depth.enabled
        ? fillForZ(depth, core.color || CONFIG.color, Math.max(0, t))
        : core.color || CONFIG.color;
      const bloomAlpha = Math.min(1, bloom.alpha * lit);
      const coreAlpha = Math.min(1, core.alpha * lit);

      const atlas = new Map();
      for (const ch of chars) {
        const c = document.createElement("canvas");
        c.width = c.height = box * dpr;
        const g = c.getContext("2d");
        g.scale(dpr, dpr);
        g.font = `${CONFIG.fontWeight} ${fs}px ${CONFIG.fontFamily}`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        // BLOOM FIRST, under everything: the light the character throws, laid down
        // before the character itself so the letter always sits on top of its own
        // halo. Repeated passes accumulate instead of one huge alpha, which is what
        // gives the falloff a shoulder rather than a flat disc.
        if (bloomOn) {
          g.shadowColor = bloomFill;
          g.shadowBlur = bloom.blur;
          g.fillStyle = bloomFill;
          g.globalAlpha = bloomAlpha;
          for (let p = 0; p < bloom.passes; p++) g.fillText(ch, box / 2, box / 2);
          g.globalAlpha = 1;
          g.shadowBlur = 0;
        }
        if (glow > 0) {
          g.shadowColor = fill;
          g.shadowBlur = glow;
        }
        // Contrast outline first, so the fill sits on top of it and the glyph
        // keeps its own weight.
        if (outline.width > 0) {
          g.lineWidth = outline.width;
          g.strokeStyle = outline.color;
          g.lineJoin = "round";
          g.miterLimit = 2;
          g.strokeText(ch, box / 2, box / 2);
        }
        g.fillStyle = fill;
        g.fillText(ch, box / 2, box / 2);
        g.shadowBlur = 0;
        // CORE LAST, on top of the body: the hot middle of the filament. Same glyph,
        // no blur, so what shows through is the letter's own stroke reading brighter
        // than its halo — the neon-sign structure rather than a lighter shade of paint.
        if (coreAlpha > 0) {
          g.globalAlpha = coreAlpha;
          g.fillStyle = coreFill;
          g.fillText(ch, box / 2, box / 2);
          g.globalAlpha = 1;
        }
        atlas.set(ch, c);
      }
      this.atlases.push(atlas);
    }
    // Nearest bucket, kept for the debug/diagnostic readouts.
    this.atlas = this.atlases[0];
  }

  // Re-bake the glyph bitmaps against the current CONFIG, keeping the strands and
  // their physics state exactly as they are. Colour, outline, bloom, core, font and
  // the depth ramp all live inside the baked atlas, so a piece that changes one of
  // them at runtime — the ?controls panel does — needs this and nothing more. About
  // 6ms for 13 buckets, which is why the panel can afford to call it on every drag.
  rebakeAtlas(dpr) {
    this._buildAtlas(dpr);
  }

  // Deepest first, nearest last, so near strands overlap far ones. With depth off
  // every z is 0 and this preserves the original creation order.
  _drawOrder() {
    if (!CONFIG.depth.enabled) return this.strands;
    return [...this.strands].sort((a, b) => b.z - a.z);
  }

  // True when at least one dynamic subsystem is on. With everything off (e.g.
  // calibration) there is nothing to integrate or relax, so update() bails out
  // and the strands stay exactly where they were. Roots are NOT affected — they
  // are driven by updateRoots(), which is tracking, not physics.
  get simulating() {
    const s = CONFIG.systems;
    return (
      s.gravity || s.wind || s.swell || s.collision || s.cohesion || s.bendReturn || s.loopConverge
    );
  }

  // `dampingBoost` multiplies CONFIG.damping for this call only — 1 (default)
  // changes nothing. For absorbing a single-frame shock (fish's boomerang
  // turnaround) without touching the piece's normal, permanent damping: pass
  // something below 1 for exactly the frames where the shock happens, and 1
  // everywhere else. See fish/js/main.js's whip damper.
  update(dt, loopTime, dampingBoost = 1) {
    const sys = CONFIG.systems;
    if (!this.simulating) return;

    // 1. accumulate forces + integrate. Iterated per strand rather than over the
    // flat particle list, because wind gain is a per-strand property: a piece can
    // make some strands visibly looser than their neighbours.
    const pt = CONFIG.pointer;
    const usePointer = sys.pointerInteraction && pointer.active;
    const r2 = pt.radius * pt.radius;
    this.pointerHit = false;

    // Body centre in SCREEN space, once per frame — not per particle. Only
    // meaningful for a collider that tracks a body (fish's analytic ellipse);
    // a mask-based one (horse, willow) has no single centre, so this silently
    // does nothing for them regardless of the CONFIG flag.
    const rp = sys.radialPush && CONFIG.radialPush > 0 ? this.collision : null;
    const useRadialPush = !!(rp && rp.cover && typeof rp.cx === "number");
    const radialCenterX = useRadialPush ? rp.cover.offsetX + rp.cx * rp.cover.drawW : 0;
    const radialCenterY = useRadialPush ? rp.cover.offsetY + rp.cy * rp.cover.drawH : 0;

    // Contact accumulators, summed over every particle the cursor reaches this
    // frame and folded into `this.contact` once the loop is done. `uAcc` is
    // weighted by the same falloff as `wAcc`, so a contact straddling two parts
    // of the curtain reports the part it is actually pressing rather than the
    // arithmetic middle of the two.
    let cCount = 0;
    let wAcc = 0;
    let uAcc = 0;
    // Position along the curtain comes from BUILD ORDER, not from screen x or y.
    // Build order runs along the curtain by construction — the horse picks its
    // roots evenly along the mane spline, the willow along its branches — so
    // index/(count-1) is a real curtain coordinate that survives the subject
    // moving, turning or being re-tracked. Screen position would not: the horse's
    // head crosses the frame, and a mapping keyed to screen x would make the same
    // lock of hair change note as the animal walks.
    const strandCount = this.strands.length;
    const uDen = Math.max(1, strandCount - 1);
    let si = -1;

    for (const strand of this.strands) {
      si++;
      const gain = strand.windGain ?? 1;
      // Outward pull for this strand, stronger toward the tip. Without it gravity
      // straightens the arc built into the resting pose within a second or two
      // and every strand collapses back to a parallel vertical line.
      // `drapeGain` lets a piece dial this strand's lateral bias per frame without a
      // rebuild, which matters because `drape` is ALSO baked into the resting pose and so
      // cannot be rewritten mid-clip. Same shape as `windGain` and `pullX` above: absent
      // means 1, and the two pieces that do not set it are untouched. The horse uses it to
      // fade the forelock's forward push out at the poses where "forward" stops meaning
      // "over the forehead" — see aimForelock() in horse/js/main.js.
      const spread = CONFIG.drapeSpread * (strand.drape ?? 0) * (strand.drapeGain ?? 1);
      // Per-strand aimed pull, if the piece set one. Scaled toward the tip like every
      // other lateral term, so the attachment stays put and the loose end travels.
      const pullX = strand.pullX || 0;
      const pullY = strand.pullY || 0;
      for (const p of strand.particles) {
        if (p.pinned) continue;
        // gravity + a sideways drape bias (stronger toward the tips) + the aimed pull
        if (sys.gravity) {
          p.addForce(
            (CONFIG.drapeX + spread + pullX) * p.depth,
            CONFIG.gravity + pullY * p.depth
          );
        }
        if (sys.wind) {
          const w = this.wind.sample(p.pos.x, p.pos.y, p.depth, loopTime);
          p.addForce(w.x * gain, w.y * gain);
        }
        if (sys.swell) {
          // Lateral means across the strand's OWN local direction, so the wave
          // bends the filament instead of dragging it bodily across the screen.
          // Taken from the live neighbours rather than the rest pose: once the
          // strand is curved, the perpendicular has curved with it, which is what
          // lets an S-bend keep developing along its own length.
          const ref = p.next || p.prev;
          let px = 1;
          let py = 0;
          if (ref) {
            const dx = p.next ? ref.pos.x - p.pos.x : p.pos.x - ref.pos.x;
            const dy = p.next ? ref.pos.y - p.pos.y : p.pos.y - ref.pos.y;
            const d = Math.hypot(dx, dy) || 1e-4;
            px = -dy / d;
            py = dx / d;
          }
          const m = this.swell.lateral(p.depth, loopTime, strand.swellPhase ?? 0);
          const dr = this.swell.drift(p.pos.x, p.pos.y, p.depth, loopTime);
          p.addForce(px * m * gain + dr.x, py * m * gain + dr.y);
        }
        if (usePointer) {
          const dx = p.pos.x - pointer.x;
          const dy = p.pos.y - pointer.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < r2) {
            this.pointerHit = true;
            const d = Math.sqrt(d2) || 1e-4;
            // Falls off to nothing at the edge of the radius, and scales toward
            // the tip: the attachment barely gives, the loose end gives a lot.
            const k = (1 - d / pt.radius) ** pt.falloff * p.depth;
            // `k` is already exactly the quantity the sound wants — how much
            // THIS particle is being displaced — so the contact measurement
            // rides along on the force calculation instead of costing a second
            // pass over the particles.
            cCount++;
            wAcc += k;
            uAcc += (si / uDen) * k;
            p.addForce(
              (dx / d) * pt.push * k + pointer.vx * pt.drag * k,
              (dy / d) * pt.push * k + pointer.vy * pt.drag * k
            );
          }
        }
        if (useRadialPush) {
          const dx = p.pos.x - radialCenterX;
          const dy = p.pos.y - radialCenterY;
          const d = Math.hypot(dx, dy) || 1e-4;
          const f = CONFIG.radialPush * p.depth;
          p.addForce((dx / d) * f, (dy / d) * f);
        }
      }
    }
    // Fold the accumulators into the frame's contact report. Kept next to the
    // loop that produced it rather than deferred, so a piece reading
    // `hair.contact` after update() always sees this frame and never the last.
    const c = this.contact;
    c.hit = this.pointerHit;
    c.count = cCount;
    c.weight = wAcc;
    if (wAcc > 0) c.u = uAcc / wAcc; // else: hold the last u, so a re-touch in
    // the same place resumes there instead of snapping to the middle of the
    // curtain for one frame.
    // Cursor speed, normalised. 26 px/frame is not a limit of the hardware, it
    // is where a deliberate brush across the curtain tops out — measured by
    // logging hypot(vx, vy) while sweeping. Past it the gesture is a flick, and
    // a flick should read as "as fast as this gets", not keep scaling.
    //
    // Forced to zero the moment the cursor stops arriving, rather than left to
    // the velocity decay: a stationary cursor must report a stationary gesture
    // immediately and unconditionally, including in a piece whose render loop is
    // paused and therefore is not decaying anything.
    c.speed = isPointerMoving() ? Math.min(1, Math.hypot(pointer.vx, pointer.vy) / 26) : 0;
    c.nx = window.innerWidth > 0 ? Math.min(1, Math.max(0, pointer.x / window.innerWidth)) : 0.5;

    const effectiveDamping = CONFIG.damping * dampingBoost;
    for (const p of this.particles) p.integrate(dt, effectiveDamping);

    // 1b. RETIRED loop-state correction. It dragged the free particles toward a
    // `rest` captured at build time, in absolute screen coords — which in video
    // mode belongs to the t=0 head pose and fights the moving roots. Off by
    // default via systems.loopConverge; kept only so the switch still works.
    if (sys.loopConverge) {
      const phase = loopTime / CONFIG.windPeriod;
      const k =
        phase > CONFIG.loopConvergeFrom
          ? smoothstep(CONFIG.loopConvergeFrom, 1, phase) * CONFIG.loopConverge
          : 0;
      if (k > 0) {
        for (const p of this.particles) {
          if (p.pinned) continue;
          p.pos.x += (p.rest.x - p.pos.x) * k;
          p.pos.y += (p.rest.y - p.pos.y) * k;
        }
      }
    }

    // 1c. Positional pointer displacement, applied AFTER integration and BEFORE
    // the constraints, so the solver relaxes the parting instead of fighting it.
    // A force alone can't open the curtain much — the length constraints undo it
    // within the same frame — which is why raising `push` stops helping. Moving
    // the positions out of the radius is the same trick the body collision uses,
    // and it is what actually makes a hand feel like it parts the strands.
    if (usePointer && pt.displace > 0) {
      for (const p of this.particles) {
        if (p.pinned) continue;
        const dx = p.pos.x - pointer.x;
        const dy = p.pos.y - pointer.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r2 || d2 < 1e-8) continue;
        const d = Math.sqrt(d2);
        const k = (1 - d / pt.radius) ** pt.falloff * p.depth * pt.displace;
        // move toward the point on the radius edge along the same direction
        const targetX = pointer.x + (dx / d) * pt.radius;
        const targetY = pointer.y + (dy / d) * pt.radius;
        p.pos.x += (targetX - p.pos.x) * k;
        p.pos.y += (targetY - p.pos.y) * k;
      }
    }

    // 2. constraint / collision relaxation
    for (let it = 0; it < CONFIG.iterations; it++) {
      for (const s of this.strands) {
        for (const seg of s.segments) this._solveSegment(seg);
      }
      if (sys.cohesion) {
        for (const c of this.cohesion) this._solveSpring(c, CONFIG.cohesion);
      }
      if (sys.bendReturn) this._bendReturn();
      if (sys.bendStiffness) this._bendStiffness();
      if (sys.collision && this.collision) this._collide();
    }
  }

  _solveSegment(seg) {
    const { a, b, len } = seg;
    const dx = b.pos.x - a.pos.x;
    const dy = b.pos.y - a.pos.y;
    const d = Math.hypot(dx, dy) || 1e-4;
    const diff = (d - len) / d;
    const aw = a.pinned ? 0 : 1;
    const bw = b.pinned ? 0 : 1;
    const tot = aw + bw || 1;
    const ka = aw / tot;
    const kb = bw / tot;
    a.pos.x += dx * diff * ka;
    a.pos.y += dy * diff * ka;
    b.pos.x -= dx * diff * kb;
    b.pos.y -= dy * diff * kb;
  }

  _solveSpring(c, softness) {
    const { a, b, len } = c;
    const dx = b.pos.x - a.pos.x;
    const dy = b.pos.y - a.pos.y;
    const d = Math.hypot(dx, dy) || 1e-4;
    const diff = ((d - len) / d) * softness * 0.5;
    if (!a.pinned) {
      a.pos.x += dx * diff;
      a.pos.y += dy * diff;
    }
    if (!b.pinned) {
      b.pos.x -= dx * diff;
      b.pos.y -= dy * diff;
    }
  }

  // Keep the few particles nearest each root close to their rest position so
  // strands keep their orientation at the scalp and don't fold sideways.
  //
  // `bendReturnCurve` shapes the handover. At 1 the weight falls off linearly over
  // `rootStiffness` particles, which is a fairly abrupt "held, held, held, free".
  // Above 1 it becomes a real gradient — the first particle is gripped hard and each
  // one after it is given away faster — which is what lets a strand leave the body in
  // an authored direction (see Strand.angle) and still be fully the physics' a few
  // characters later.
  _bendReturn() {
    const k = CONFIG.bendReturn;
    const curve = CONFIG.bendReturnCurve;
    for (const s of this.strands) {
      // A root can carry its OWN rootStiffness (rootDef, set at build time —
      // see fins.js's pectoral), for a fin whose transition from tracked
      // motion to free physics needs to reach further than the piece's
      // general strands do. Falls back to the shared value for everyone else.
      const n = Math.min(s.rootDef?.rootStiffness ?? CONFIG.rootStiffness, s.particles.length - 1);
      for (let i = 1; i <= n; i++) {
        const p = s.particles[i];
        const f = 1 - i / (n + 1); // 1 at the root, 0 past the last stiff particle
        const w = (curve === 1 ? f : f ** curve) * k;
        p.pos.x += (p.rest.x - p.pos.x) * w;
        p.pos.y += (p.rest.y - p.pos.y) * w;
      }
    }
  }

  // Resists CURVATURE along the WHOLE strand — unlike bendReturn, which only
  // holds the first `rootStiffness` particles near their built angle. Past
  // that zone a strand is just distance constraints, which fix how far apart
  // neighbours are but not the ANGLE between them: two rigid links joined by a
  // free hinge, not a stiff rod, no matter how many iterations run. This pulls
  // every free particle toward the midpoint of its two neighbours, which is
  // the straight-line position — the harder that pull, the more a bend costs
  // to hold, everywhere along the strand, not just at the base.
  _bendStiffness() {
    const k = CONFIG.bendStiffness;
    if (!k) return;
    for (const s of this.strands) {
      const ps = s.particles;
      for (let i = 1; i < ps.length - 1; i++) {
        const b = ps[i];
        if (b.pinned) continue;
        const a = ps[i - 1];
        const c = ps[i + 1];
        b.pos.x += ((a.pos.x + c.pos.x) * 0.5 - b.pos.x) * k;
        b.pos.y += ((a.pos.y + c.pos.y) * 0.5 - b.pos.y) * k;
      }
    }
  }

  _collide() {
    const step = this.collision.cell * CONFIG.collisionPush;
    const raw = this.collision.rawNormal === true; // primitives push out truly
    // How far along a strand collision starts. 0 (the default) collides the whole
    // strand, which is right when the strand merely hangs PAST a body. It is wrong
    // when the strand GROWS OUT of one: a fin is attached, so its first characters
    // belong on the skin, and pushing them off leaves the fin floating with a gap
    // where it should join. Only the free part of the strand has to stay outside.
    //
    // Per-strand, not a flat particle loop: a root can carry its OWN
    // collisionFromDepth (rootDef, e.g. fins.js's pectoral) for a fin whose
    // authored motion sweeps close to the body more than the piece's general
    // fins do — raising the global value would loosen collision everywhere
    // and risk the exact "glyphs poke through the belly" bug collision exists
    // to prevent.
    const globalFrom = CONFIG.collisionFromDepth || 0;
    for (const strand of this.strands) {
      const from = strand.rootDef?.collisionFromDepth ?? globalFrom;
      for (const p of strand.particles) {
        if (p.pinned || p.depth < from) continue;
        const r = this.collision.resolve(p.pos.x, p.pos.y);
        if (!r) continue;
        let nx = r.nx;
        let ny = r.ny;
        if (!raw) {
          // Static PNG ridge: never lift a strand up — hair slides off sideways,
          // and on a near-flat top nudge toward the near side so it drapes off.
          ny = ny > 0 ? ny : 0;
          if (ny === 0 && Math.abs(nx) < 0.2) nx = -1;
        }
        const len = Math.hypot(nx, ny) || 1;
        p.pos.x += (nx / len) * step;
        p.pos.y += (ny / len) * step;
        // bleed off velocity so the strand rests on the surface (no bounce)
        p.oldPos.x = p.pos.x - (p.pos.x - p.oldPos.x) * 0.4;
        p.oldPos.y = p.pos.y - (p.pos.y - p.oldPos.y) * 0.4;
      }
    }
  }

  // Dissolve the white line baked into the photo: clip to a thin ribbon along
  // the crest and paint a BLURRED copy of the photo into it. The blur mixes the
  // real sky (above) and neck (below) and smears the thin bright line away, so
  // no line is left — only the strands fall over it. Drawn under the glyphs.
  drawRootBand(ctx) {
    if (!this.bandCanvas) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0); // blit the cache 1:1 in device pixels
    ctx.drawImage(this.bandCanvas, 0, 0);
  }

  // The green light the characters throw onto whatever is behind them — trunk,
  // branches, grass, ground. Without this the glyphs read as pasted on top of a
  // photograph; with it they read as the thing lighting the scene.
  //
  // Built at a fraction of the resolution and blitted back up: a few hundred soft
  // blobs at quarter scale costs almost nothing, and the upscale IS the blur, so
  // no filter is needed. Composited with "lighter" so it adds light rather than
  // painting over the picture.
  // How much of a STRAND survives the holdout zones: 1 outside all of them, 0 well inside
  // one, feathered across the rim. Called once per strand, at its ROOT (particles[0], the
  // anchor point updateRoots() pins to the crest every frame) — not once per glyph. A zone
  // over the ear hides the anchor point and everything hanging from it as one piece, the
  // way real hair growing from behind the ear is hidden whole, rather than fading out only
  // the individual characters that happen to cross the zone this frame while the rest of
  // the same strip stays lit above and below it (2026-08-19; was per-glyph before).
  //
  // SHARED WITH THE LIGHT WASH on purpose. The wash is a separate layer built from the same
  // particles, and masking the letters without masking their light leaves a glow with nothing
  // making it — which reads as a bug rather than as an ear in front of the mane, and undoes
  // the whole point of doing this as occlusion.
  _holdoutAt(x, y) {
    const zones = this.holdoutZones;
    if (!zones || !zones.length) return 1;
    let w = 1;
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      const dx = x - z.x;
      const dy = y - z.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= z.r2) continue; // outside this zone: no opinion
      if (d2 <= z.inner2) return 0;
      w *= smoothstep(z.inner, z.r, Math.sqrt(d2));
      if (w <= 0.004) return 0;
    }
    return w;
  }

  _drawLightWash(ctx, dpr) {
    const cfg = CONFIG.lightWash;
    if (!cfg || !cfg.enabled || !this.strands.length) return;

    const w = Math.max(1, Math.round((this.cover.drawW + 2 * this.cover.offsetX) * cfg.scale));
    const h = Math.max(1, Math.round((this.cover.drawH + 2 * this.cover.offsetY) * cfg.scale));
    if (!this._washCanvas || this._washCanvas.width !== w || this._washCanvas.height !== h) {
      this._washCanvas = document.createElement("canvas");
      this._washCanvas.width = w;
      this._washCanvas.height = h;
    }
    // The wash is soft and changes slowly, so it is rebuilt every `everyFrames`
    // frames and the cached canvas is re-blitted in between. At ~5000 additive
    // blobs a frame this is the difference between a smooth loop and a stuttering
    // one, and halving its update rate is not visible.
    this._washTick = (this._washTick ?? 0) + 1;
    const rebuild = this._washTick % Math.max(1, cfg.everyFrames || 1) === 0;
    const g = this._washCanvas.getContext("2d");
    if (rebuild) g.clearRect(0, 0, w, h);
    g.globalCompositeOperation = "lighter";
    g.fillStyle = cfg.color;

    const r = Math.max(1, cfg.radius * cfg.scale);
    const depth = CONFIG.depth;
    const gain = cfg.intensity ?? 1;
    if (rebuild) for (const strand of this.strands) {
      // Same strand-level decision the main draw uses (see _holdoutAt's comment): a
      // strand hidden behind the ear throws no light either, or the wash would glow
      // where there is visibly nothing casting it.
      const hk = this._holdoutAt(strand.particles[0].pos.x, strand.particles[0].pos.y);
      if (hk <= 0.004) continue;
      // Deep strands light the scene less, for the same reason they are drawn
      // dimmer: they are further from what they are lighting.
      const zk = depth.enabled ? 1 - Math.max(0, strand.z) * 0.6 : 1;
      for (let i = 0; i < strand.particles.length; i += cfg.every) {
        const p = strand.particles[i];
        if (!p.char || p.char === " ") continue;
        // Brighter near the root, where the strands are packed together and the light
        // of many of them lands on the same place.
        const rk = cfg.rootBoost ? 1 + cfg.rootBoost * (1 - p.depth) : 1;
        const a = cfg.alpha * zk * gain * rk * hk;
        g.globalAlpha = Math.min(1, a);
        g.beginPath();
        g.arc(p.pos.x * cfg.scale, p.pos.y * cfg.scale, r, 0, Math.PI * 2);
        g.fill();
        // Spill below the strand, so the ground under the canopy is lit and not
        // just the branches the characters happen to overlap.
        if (cfg.ground > 0) {
          g.globalAlpha = Math.min(1, a * cfg.ground);
          g.beginPath();
          g.arc(p.pos.x * cfg.scale, (p.pos.y + cfg.groundOffset) * cfg.scale, r * 1.6, 0, Math.PI * 2);
          g.fill();
        }
      }
    }

    // One blur for the whole wash, on the small canvas, only when it was rebuilt.
    // Blurring each blob as it is drawn would be the same picture at ~700x the cost.
    if (rebuild && cfg.blur > 0) {
      if (!this._washBlur || this._washBlur.width !== w || this._washBlur.height !== h) {
        this._washBlur = document.createElement("canvas");
        this._washBlur.width = w;
        this._washBlur.height = h;
      }
      const b = this._washBlur.getContext("2d");
      b.clearRect(0, 0, w, h);
      b.filter = `blur(${cfg.blur}px)`;
      b.drawImage(this._washCanvas, 0, 0);
      b.filter = "none";
      g.clearRect(0, 0, w, h);
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
      g.drawImage(this._washBlur, 0, 0);
      g.globalCompositeOperation = "lighter";
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this._washCanvas, 0, 0, this._washCanvas.width * dpr / cfg.scale, this._washCanvas.height * dpr / cfg.scale);
    ctx.restore();
  }

  // Returns how many glyphs were actually painted. Zero while strands exist is a
  // real signal, not a detail — see the diagnostic overlay in main.js.
  draw(ctx, dpr) {
    this.drawRootBand(ctx, dpr);
    // Under the glyphs, so a character always sits on top of its own light.
    this._drawLightWash(ctx, dpr);
    const box = this.glyphBox;
    const half = box / 2;
    const depth = CONFIG.depth;
    const lastBucket = this.atlases.length - 1;
    const rotate = CONFIG.glyphRotate;
    let drawn = 0;
    const zones = this.holdoutZones && this.holdoutZones.length ? this.holdoutZones : null;
    // Set once for the whole upright batch; the fast path never touches it again.
    if (!rotate) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Per strand rather than over the flat particle list, because depth applies
    // to a whole strand and the draw order is by strand.
    for (const strand of this._drawOrder()) {
      // Per-strand draw weight, if the piece set one (absent = 1, so the other pieces are
      // untouched). It multiplies the glyph alpha rather than gating the strand, so a strand
      // fades in and out instead of popping — a hard cut on a moving subject reads as
      // flicker. Below the threshold the whole strand is skipped, which is also the point:
      // the horse uses this to THIN a band whose projected width collapses, and the glyphs
      // it drops are glyphs it no longer pays for. See thinForelock() in horse/js/main.js.
      const drawGain = strand.drawGain ?? 1;
      if (drawGain <= 0.004) continue;
      // Is this strand's anchor point behind something? Decided once, at the root, and
      // applied to every glyph on the strand — see _holdoutAt.
      const holdout = zones === null ? 1 : this._holdoutAt(strand.particles[0].pos.x, strand.particles[0].pos.y);
      if (holdout <= 0.004) continue;
      const constantZ = !depth.enabled || strand.zTip === strand.z;
      // When z is constant along the strand the bucket is resolved once; when it
      // isn't, it has to be resolved PER CHARACTER, which is what lets a strand
      // fade from one plane into another down its own length.
      const flatBucket = constantZ ? bucketFor(strand.z, lastBucket, depth.enabled) : 0;

      for (const p of strand.particles) {
        if (!p.char || p.char === " ") continue;
        // The z ramp has to be shaped, not linear, for two reasons that pull in
        // opposite directions.
        //
        // `rampCurve` above 1 holds the root's z further down the strand. A linear
        // ramp puts all of a highlight on the first character or two — exactly the
        // particles that barely move, since the root is pinned and `bendReturn`
        // holds the two below it — so the glow reads as a lit dot stuck in the air
        // instead of the top of a liana.
        //
        // `rampSpan` then finishes the ramp early, within that fraction of the
        // strand. Necessary because the tail of a strand is deliberately frayed
        // (`frayFrom`): past that point characters are dropped and the last ones
        // are scattered singles. A ramp still bright when it reaches the frayed
        // stretch lights up precisely those scattered characters, which is how you
        // get loose glowing letters with nothing attached to them. Keep rampSpan
        // below `frayFrom`.
        const dt = depth.rampSpan >= 1 ? p.depth : Math.min(1, p.depth / depth.rampSpan);
        const zT = depth.rampCurve === 1 ? dt : dt ** depth.rampCurve;
        const z = constantZ ? strand.z : lerp(strand.z, strand.zTip, zT);
        const atlas =
          this.atlases[constantZ ? flatBucket : bucketFor(z, lastBucket, true)] || this.atlases[0];
        const zScale = depth.enabled ? scaleForZ(depth, z) : 1;
        const zAlpha = depth.enabled ? alphaForZ(depth, z) : 1;
        const img = atlas.get(p.char);
        if (!img) continue;

        const s = p.scale * zScale;
        ctx.globalAlpha = p.alpha * lerp(1, 1 - CONFIG.tipFade, p.depth) * zAlpha * drawGain * holdout;

        if (!rotate) {
          // FAST PATH: glyphs stay upright. One transform is set for the whole
          // batch and each glyph is a plain positional drawImage, instead of a
          // setTransform per character — measured, that per-glyph transform was
          // most of the frame cost at ~15k glyphs. Upright is also how the
          // reference reads: falling code keeps its characters level.
          const d = box * s;
          ctx.drawImage(img, p.pos.x - d / 2, p.pos.y - d / 2, d, d);
          drawn++;
          continue;
        }

        // orient the glyph along the local strand direction
        const ref = p.next || p.prev;
        let cos = 1;
        let sin = 0;
        if (ref) {
          const dx = p.next ? ref.pos.x - p.pos.x : p.pos.x - ref.pos.x;
          const dy = p.next ? ref.pos.y - p.pos.y : p.pos.y - ref.pos.y;
          const angle = Math.atan2(dy, dx) - Math.PI / 2;
          cos = Math.cos(angle);
          sin = Math.sin(angle);
        }
        ctx.setTransform(
          dpr * cos * s,
          dpr * sin * s,
          -dpr * sin * s,
          dpr * cos * s,
          dpr * p.pos.x,
          dpr * p.pos.y
        );
        ctx.drawImage(img, -half, -half, box, box);
        drawn++;
      }
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    return drawn;
  }

  // ----- debug overlay (toggle with "D") -----------------------------------
  drawDebug(ctx, dpr, viewW, viewH) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // collision body, sampled coarse
    if (this.collision && this.collision.field) {
      const cell = this.collision.cell;
      ctx.fillStyle = "rgba(0, 200, 255, 0.28)";
      for (let j = 0; j < this.collision.rows; j++) {
        for (let i = 0; i < this.collision.cols; i++) {
          if (this.collision.field[j * this.collision.cols + i] > 0.5) {
            ctx.fillRect(i * cell, j * cell, cell, cell);
          }
        }
      }
    }
    // roots
    ctx.fillStyle = "#00ff66";
    for (const r of this.rootScreen) {
      ctx.beginPath();
      ctx.arc(r.x, r.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#00ff66";
    ctx.font = "12px ui-monospace, monospace";
    ctx.fillText(`roots: ${this.rootScreen.length}   [D] debug on`, 16, 24);
  }
}
