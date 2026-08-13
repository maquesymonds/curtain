// ============================================================================
//  WIND — smooth procedural breeze that is PERIODIC over the loop duration.
//  All time harmonics are integer multiples of the base loop frequency, so the
//  wind returns to the exact same state every `CONFIG.windPeriod` seconds. A
//  looping clip sets that to the clip length so the loop has no visible jump; a
//  still image can use any period.
// ============================================================================

import { CONFIG } from "./config.js";

export class Wind {
  // `time` is seconds within the loop (video.currentTime, or an accumulated
  // clock in static mode). depth: 0 root → 1 tip (tips catch more wind).
  sample(x, y, depth, time) {
    const w = (2 * Math.PI) / CONFIG.windPeriod; // one cycle per period
    const t = time || 0;
    const sc = CONFIG.windScale;

    // slow gust envelope, one swell per loop, 0.4..1.0
    const gust = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * w));

    // layered coherent noise — frequencies are 1×,2×,3× the loop base
    const w1 = Math.sin(x * sc + t * w * 2);
    const w2 = Math.sin(y * sc * 0.6 - t * w * 3 + 1.7);
    const w3 = Math.sin((x + y) * sc * 0.35 + t * w * 1 + 3.1);

    const horizontal = (w1 * 0.6 + w2 * 0.3 + w3 * 0.4) * gust;
    const vertical = (w2 * 0.5 + w3 * 0.3) * gust * CONFIG.windVertical;

    const amp = CONFIG.windStrength * depth;
    return { x: horizontal * amp * 0.06, y: vertical * amp * 0.06 };
  }
}
