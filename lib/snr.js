// Audio-Jackhammer
// Copyright (c) 2026 Lewis James Seals Jr. All rights reserved.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.

/** Rough RMS-based SNR estimate per block (noise floor = quiet 20th-percentile window). */
export class SnrEstimator {
  constructor() { this.lastDb = 0; }
  observe(samples) { this.lastDb = SnrEstimator.estimateDb(samples); return this.lastDb; }
  static estimateDb(samples, windowSize = 160) {
    if (samples.length === 0) return 0;
    const windows = Math.max(1, Math.floor(samples.length / windowSize));
    const rms = new Float64Array(windows);
    let total = 0;
    for (let w = 0; w < windows; w++) {
      const start = w * windowSize;
      const len = Math.min(windowSize, samples.length - start);
      let e = 0;
      for (let i = 0; i < len; i++) { const s = samples[start + i]; e += s * s; }
      rms[w] = Math.sqrt(e / len);
      total += e;
    }
    const overall = Math.sqrt(total / samples.length);
    const sorted = Array.from(rms).sort((a, b) => a - b);
    const floor = Math.max(sorted[Math.floor(sorted.length / 5)], 1e-10);
    if (overall < 1e-10) return 0;
    return 20 * Math.log10(overall / floor);
  }
}
