// Audio-Jackhammer
// Copyright (c) 2026 Lewis James Seals Jr. All rights reserved.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.

/**
 * Peak limiter. Default: soft-knee tanh compression above (threshold - knee).
 * Optional look-ahead: delay line, instant attack, smooth release.
 */
export class SoftLimiter {
  constructor({ threshold = 0.95, knee = 0.05, lookAhead = false, sampleRate = 48000, lookAheadMs = 5, releaseMs = 50 } = {}) {
    if (!(threshold > 0 && threshold <= 1)) throw new RangeError("threshold must be in (0, 1]");
    if (!(knee >= 0 && knee <= threshold)) throw new RangeError("knee must be in [0, threshold]");
    if (!(sampleRate > 0)) throw new RangeError("sampleRate must be > 0");
    if (lookAhead && !(lookAheadMs > 0)) throw new RangeError("lookAheadMs must be > 0");
    if (lookAhead && releaseMs < 2 * lookAheadMs) {
      throw new RangeError("releaseMs must be at least 2x lookAheadMs to avoid gain pumping.");
    }
    this.ceiling = threshold;
    this.knee = knee;
    this.lookAhead = lookAhead;
    this.gain = 1;
    this.pos = 0;
    if (lookAhead) {
      const raw = Math.max(1, Math.round((sampleRate * lookAheadMs) / 1000));
      let pow2 = 1;
      while (pow2 < raw) pow2 <<= 1;
      this.delayLength = pow2;
      this.mask = pow2 - 1;
      this.delay = new Float32Array(pow2);
      this.release = 1 / Math.max(1, Math.floor((sampleRate * releaseMs) / 1000));
    } else {
      this.delayLength = 0;
      this.mask = 0;
      this.delay = new Float32Array(0);
      this.release = 0;
    }
  }
  get delaySamples() { return this.delayLength; }
  process(buf) {
    if (buf.length === 0) return;
    if (this.lookAhead) {
      for (let i = 0; i < buf.length; i++) {
        const x = buf[i];
        const peak = Math.abs(x);
        const target = peak <= this.ceiling ? 1 : this.ceiling / peak;
        if (target < this.gain) this.gain = target;
        else this.gain += (target - this.gain) * this.release;
        const delayed = this.delay[this.pos];
        this.delay[this.pos] = x;
        this.pos = (this.pos + 1) & this.mask;
        buf[i] = delayed * this.gain;
      }
    }
    this.#softKnee(buf);
  }
  #softKnee(buf) {
    const t = this.ceiling - this.knee;
    for (let i = 0; i < buf.length; i++) {
      const x = buf[i];
      const a = Math.abs(x);
      if (a <= t) continue;
      const c = t + this.knee * Math.tanh((a - t) / this.knee);
      buf[i] = x < 0 ? -c : c;
    }
  }
}
