// Audio-Jackhammer
// Copyright (c) 2026 Lewis James Seals Jr. All rights reserved.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.

import { HighPassFilter } from "./highpass.js";
import { SoftLimiter } from "./limiter.js";
import { SnrEstimator } from "./snr.js";
import { FrameAccumulator } from "./framer.js";

/**
 * Source -> HighPass -> Denoiser -> SoftLimiter -> Output.
 * Model calls always use exact frameSize via FrameAccumulator. The zero-padded residual frame
 * and any denoiser tail (flush) are emitted. Output length = ceil(inputSamples / frameSize) * frameSize;
 * a denoiser's algorithmic latency is trimmed so output stays time-aligned with the input.
 */
export function runPipeline(input, denoiser, {
  sampleRate = 48000, highPassHz = 90, enableHighPass = true, lookAhead = false,
} = {}) {
  const t0 = process.hrtime.bigint();
  const fs = denoiser.frameSize;
  const latency = denoiser.latencySamples ?? 0;
  const target = Math.ceil(input.length / fs) * fs;
  const out = new Float32Array(target + latency + fs);
  const hp = enableHighPass ? new HighPassFilter(highPassHz, sampleRate) : null;
  const limiter = new SoftLimiter({ lookAhead, sampleRate });
  const snr = new SnrEstimator();
  const framer = new FrameAccumulator(fs);
  const snrDb = [];
  let w = 0, block = 0;

  const emit = (frame) => {
    limiter.process(frame);
    if (block++ % 50 === 0) snrDb.push(snr.observe(frame));
    out.set(frame, w);
    w += frame.length;
  };
  const onFrame = (frame) => {
    hp?.process(frame);
    denoiser.process(frame);
    emit(frame);
  };

  const CHUNK = fs * 16;
  for (let off = 0; off < input.length; off += CHUNK) {
    framer.push(input.subarray(off, Math.min(off + CHUNK, input.length)), onFrame);
  }
  framer.flush(onFrame);
  if (typeof denoiser.flush === "function") {
    const tail = new Float32Array(fs);
    const n = denoiser.flush(tail);
    if (n > 0) emit(tail.subarray(0, n));
  }

  const samples = out.slice(latency, latency + target);
  const wallMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const audioMs = (input.length / sampleRate) * 1000;
  return { samples, wallMs, audioMs, rtf: audioMs > 0 ? wallMs / audioMs : 0, snrDb, model: denoiser.name };
}
