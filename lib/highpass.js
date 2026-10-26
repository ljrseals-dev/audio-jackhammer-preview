// Audio-Jackhammer
// Copyright (c) 2026 Lewis James Seals Jr. All rights reserved.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.

/** 2nd-order Butterworth high-pass (RBJ biquad). Strips machinery rumble. */
export class HighPassFilter {
  constructor(cutoffHz = 90, sampleRate = 48000) {
    if (!(cutoffHz > 0 && cutoffHz < sampleRate / 2)) {
      throw new RangeError("cutoffHz must be in (0, sampleRate/2)");
    }
    this.cutoffHz = cutoffHz;
    const w0 = (2 * Math.PI * cutoffHz) / sampleRate;
    const cos = Math.cos(w0);
    const alpha = Math.sin(w0) / Math.SQRT2; // Q = 1/sqrt(2)
    const a0 = 1 + alpha;
    this.b0 = (1 + cos) / 2 / a0;
    this.b1 = -(1 + cos) / a0;
    this.b2 = this.b0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
    this.reset();
  }
  /** Processes in place. */
  process(s) {
    let { x1, x2, y1, y2 } = this;
    for (let i = 0; i < s.length; i++) {
      const x0 = s[i];
      const y0 = this.b0 * x0 + this.b1 * x1 + this.b2 * x2 - this.a1 * y1 - this.a2 * y2;
      x2 = x1; x1 = x0; y2 = y1; y1 = y0;
      s[i] = y0;
    }
    this.x1 = x1; this.x2 = x2; this.y1 = y1; this.y2 = y2;
  }
  reset() { this.x1 = this.x2 = this.y1 = this.y2 = 0; }
}
