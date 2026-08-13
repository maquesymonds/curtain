// ============================================================================
//  SWELL — the water force. What WIND is to the willow, this is to the fish.
//
//  The difference is not "less gravity". Air pushes a hanging strand from the
//  side and gravity decides its resting shape; water does neither. A fin is
//  near-neutrally buoyant, so it has no resting shape to be pushed away from,
//  and the force that shapes it is a TRAVELLING WAVE running root -> tip.
//
//  Measured on the reference clip (magnific_animate..., 121 frames @ 24fps):
//    - beat period 2.52 s (0.40 Hz), by FFT on the tail-tip position. The base
//      clip's own tail flicks at the SAME 2.52 s, which is why the trimmed loop
//      is 60 frames / 2.50 s — one beat, so the wave closes with the video.
//    - tail-tip lateral travel 60.9 px vs 6.1 px for the base fish's stub tail:
//      the veil does not change the rhythm, it AMPLIFIES the same beat ×10.
//      That ×10 is what `envelope` is for.
//
//  Periodic over CONFIG.windPeriod, same contract as Wind: every time harmonic
//  is an integer multiple of the loop frequency, so the field returns to the
//  exact same state each period and the loop has no jump.
// ============================================================================

import { CONFIG } from "./config.js";

export class Swell {
  // Signed LATERAL force magnitude for one particle — the caller turns it into a
  // vector along the local perpendicular, because "sideways" for a filament means
  // across ITS OWN direction, not across the screen.
  //
  // `depth` is position ALONG the strand (0 root -> 1 tip). It appears twice, and
  // the two uses are the whole mechanism:
  //   - in `travel`, as a phase DELAY, so the crest reaches the tip after it left
  //     the root. This is what reads as water rather than as a flag.
  //   - in `env`, as a growing amplitude, so the root barely moves and the tip
  //     swings wide.
  lateral(depth, time, phase) {
    const cfg = CONFIG.swell;
    const w = (2 * Math.PI) / CONFIG.windPeriod;
    // Integer cycles per loop or the wave will not close. Rounded rather than
    // trusted: a fractional value here is a silent seam every period.
    const cycles = Math.max(1, Math.round(cfg.cycles));
    const travel = depth * cfg.wavelengths * Math.PI * 2;
    const env = Math.pow(depth, cfg.envelope);
    return Math.sin(cycles * w * time - travel + phase) * cfg.strength * env;
  }

  // Slow incoherent churn on top of the beat, so the mass shimmers instead of
  // every strand tracing the same clean sine. Deliberately weak — this is
  // texture, not the driver. Harmonics are 1x/2x/3x the loop base, so it closes.
  drift(x, y, depth, time) {
    const cfg = CONFIG.swell;
    const w = (2 * Math.PI) / CONFIG.windPeriod;
    const sc = cfg.scale;
    const a = Math.sin(x * sc + time * w * 2);
    const b = Math.sin(y * sc * 0.7 - time * w * 3 + 1.9);
    const c = Math.sin((x - y) * sc * 0.4 + time * w + 2.3);
    const amp = cfg.drift * depth;
    return { x: (a * 0.6 + c * 0.4) * amp, y: (b * 0.5 + c * 0.3) * amp };
  }
}
