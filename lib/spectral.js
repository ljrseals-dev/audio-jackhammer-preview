// Audio-Jackhammer
// Copyright (c) 2026 Lewis James Seals Jr. All rights reserved.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.

/**
 * Pure-JS spectral-gating denoiser (stationary/slowly-varying noise such as machinery
 * rumble and broadband traffic). 512-pt STFT, hop 256, sqrt-Hann analysis + synthesis
 * (COLA-compliant at 50% overlap). Per-bin noise floor tracking, over-subtraction,
 * time/frequency gain smoothing.
 *
 * This is NOT RNNoise or DeepFilterNet. It is a dependency-free baseline that runs on
 * Vercel. Impulsive events (jackhammer strikes) pass through; steady rumble is reduced.
 */
const N = 512;
const H = 256;
const BINS = N / 2 + 1;

class FFT {
  constructor(n) {
    this.n = n;
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = -Math.sin((2 * Math.PI * i) / n);
    }
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      this.rev[i] = r;
    }
  }
  /** In-place forward FFT; pass inverse=true for the (unscaled-then-scaled) inverse. */
  transform(re, im, inverse = false) {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const j = this.rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0, t = 0; k < half; k++, t += step) {
          const wr = this.cos[t], wi = inverse ? -this.sin[t] : this.sin[t];
          const a = start + k, b = a + half;
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
        }
      }
    }
    if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }
}

export class SpectralGateDenoiser {
  /** @param {{reduceDb?: number, oversubtraction?: number}} opts */
  constructor({ reduceDb = 18, oversubtraction = 2.5 } = {}) {
    this.name = "spectral";
    this.frameSize = H;
    this.sampleRate = 48000;
    this.latencySamples = H;
    this.requiresOverlapAdd = false;
    this.gMin = Math.pow(10, -reduceDb / 20);
    this.over = oversubtraction;
    this.fft = new FFT(N);
    this.win = new Float64Array(N);
    for (let i = 0; i < N; i++) this.win[i] = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
    this.prev = new Float64Array(H);
    this.ola = new Float64Array(N);
    this.re = new Float64Array(N);
    this.im = new Float64Array(N);
    this.noise = new Float64Array(BINS);
    this.gain = new Float64Array(BINS).fill(1);
    this.tmpGain = new Float64Array(BINS);
    this.frames = 0;
  }

  /** Processes exactly frameSize samples in place; output is delayed by latencySamples. */
  process(frame) {
    if (frame.length !== H) throw new RangeError(`Expected ${H}-sample frame, got ${frame.length}.`);
    const { re, im, win, prev, ola } = this;
    for (let i = 0; i < H; i++) {
      re[i] = prev[i] * win[i];
      re[H + i] = frame[i] * win[H + i];
      prev[i] = frame[i];
    }
    im.fill(0);
    this.fft.transform(re, im);

    // Noise tracking + gain
    const noise = this.noise, g = this.tmpGain;
    const init = this.frames < 8;
    for (let k = 0; k < BINS; k++) {
      const p = re[k] * re[k] + im[k] * im[k];
      if (init) noise[k] += (p - noise[k]) / (this.frames + 1);      // assumes the first ~40 ms is noise-dominated
      else if (p < 3 * noise[k]) noise[k] += 0.02 * (p - noise[k]);   // noise-like frame: running mean
      else noise[k] *= 1.003;                                         // loud bin: drift up slowly (tracks rising floors)
      const sub = p - this.over * noise[k];
      g[k] = p > 1e-20 ? Math.max(this.gMin, Math.sqrt(Math.max(sub, 0) / p)) : this.gMin;
    }
    // Frequency smoothing (3-tap) then temporal smoothing (fast attack, slower release)
    for (let k = 0; k < BINS; k++) {
      const a = g[Math.max(0, k - 1)], b = g[k], c = g[Math.min(BINS - 1, k + 1)];
      const target = 0.25 * a + 0.5 * b + 0.25 * c;
      const old = this.gain[k];
      this.gain[k] = target > old ? 0.3 * old + 0.7 * target : 0.6 * old + 0.4 * target;
    }
    for (let k = 0; k < BINS; k++) {
      re[k] *= this.gain[k]; im[k] *= this.gain[k];
      if (k > 0 && k < N / 2) { re[N - k] = re[k]; im[N - k] = -im[k]; }
    }
    this.fft.transform(re, im, true);
    for (let i = 0; i < N; i++) ola[i] += re[i] * win[i];
    for (let i = 0; i < H; i++) frame[i] = ola[i];
    ola.copyWithin(0, H);
    ola.fill(0, H);
    this.frames++;
  }

  /** Drains the pending overlap tail into out (length >= frameSize). Returns samples written. */
  flush(out) {
    const z = new Float32Array(H);
    this.process(z);
    out.set(z, 0);
    return H;
  }
}

/** Pass-through, bit-exact. For A/B testing and pipeline smoke tests. */
export class NullDenoiser {
  constructor() { this.name = "null"; this.frameSize = 480; this.sampleRate = 48000; this.latencySamples = 0; }
  process() {}
}
