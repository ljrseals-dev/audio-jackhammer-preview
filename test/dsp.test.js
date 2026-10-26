// Audio-Jackhammer — Copyright (c) 2026 Lewis James Seals Jr. All rights reserved. Provided "AS IS", without warranty.
import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { HighPassFilter } from "../lib/highpass.js";
import { SoftLimiter } from "../lib/limiter.js";
import { FrameAccumulator } from "../lib/framer.js";
import { SnrEstimator } from "../lib/snr.js";
import { decodeWav, encodeWav, resampleLinear } from "../lib/wav.js";
import { createDenoiser, UnsupportedModelError } from "../lib/factory.js";
import { runPipeline } from "../lib/pipeline.js";
import handler from "../api/denoise.js";

const rms = (a, s = 0, e = a.length) => { let t = 0; for (let i = s; i < e; i++) t += a[i] * a[i]; return Math.sqrt(t / (e - s)); };
function prng(seed = 42) { let x = seed >>> 0; return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 2 ** 32) * 2 - 1; }
const sine = (n, hz, amp = 0.5, sr = 48000) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / sr));

test("high-pass attenuates DC and preserves 1 kHz", () => {
  const dc = new Float32Array(48000).fill(0.5);
  new HighPassFilter(90).process(dc);
  assert.ok(Math.abs(dc[47999]) < 0.01);
  const tone = sine(48000, 1000);
  const ref = rms(tone);
  new HighPassFilter(90).process(tone);
  assert.ok(rms(tone, 4800) / ref > 0.98);
});

test("soft limiter clamps peaks (plain and look-ahead)", () => {
  for (const lookAhead of [false, true]) {
    const buf = Float32Array.from({ length: 4800 }, (_, i) => (i % 100 === 0 ? 3 : 0.2));
    new SoftLimiter({ lookAhead }).process(buf);
    assert.ok(Math.max(...buf.map(Math.abs)) <= 1.0001, `lookAhead=${lookAhead}`);
  }
  assert.throws(() => new SoftLimiter({ lookAhead: true, lookAheadMs: 10, releaseMs: 15 }), RangeError);
});

test("frame accumulator emits exact frames and zero-pads on flush", () => {
  const f = new FrameAccumulator(480), sizes = [];
  f.push(new Float32Array(1000).fill(1), (fr) => sizes.push(fr.length));
  assert.deepEqual(sizes, [480, 480]);
  assert.equal(f.pending, 40);
  let tail;
  assert.ok(f.flush((fr) => { tail = Float32Array.from(fr); }));
  assert.equal(tail.length, 480);
  assert.equal(tail[39], 1);
  assert.equal(tail[40], 0);
});

test("null pipeline is bit-exact below the limiter threshold; length is ceil(n/frame)*frame", () => {
  const input = sine(2000, 440, 0.5);
  const r = runPipeline(input, createDenoiser("null"), { enableHighPass: false });
  assert.equal(r.samples.length, Math.ceil(2000 / 480) * 480);
  for (let i = 0; i < input.length; i++) assert.equal(r.samples[i], input[i]);
  for (let i = input.length; i < r.samples.length; i++) assert.equal(r.samples[i], 0);
});

test("WAV round trip (16-bit and float32) and resampling", () => {
  const x = sine(4800, 300, 0.6);
  const a = decodeWav(encodeWav(x, 48000));
  assert.equal(a.sampleRate, 48000);
  assert.ok(x.every((v, i) => Math.abs(v - a.samples[i]) < 1e-3));
  const b = decodeWav(encodeWav(x, 48000, { float32: true }));
  assert.ok(x.every((v, i) => v === b.samples[i]));
  assert.equal(resampleLinear(new Float32Array(441), 44100, 48000).length, 480);
  assert.throws(() => decodeWav(Buffer.from("nope")), /RIFF/);
});

test("SNR estimator reports higher SNR for bursty than flat signal", () => {
  const flat = sine(4800, 500, 0.3);
  const bursty = Float32Array.from(flat, (v, i) => (i % 1600 < 320 ? v * 3 : v * 0.05));
  assert.ok(SnrEstimator.estimateDb(bursty) > SnrEstimator.estimateDb(flat) + 10);
});

test("unsupported native models fail loudly with 501", () => {
  for (const m of ["rnnoise", "deepfilternet", "bogus"]) {
    assert.throws(() => createDenoiser(m), (e) => e instanceof UnsupportedModelError && e.status === 501);
  }
});

function noisyBursts(seconds = 3, noiseAmp = 0.05, seed = 7) {
  const n = 48000 * seconds, rnd = prng(seed);
  const clean = new Float32Array(n), noisy = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / 48000;
    const on = Math.floor(t * 2) % 2 === 1; // tone on for the 2nd half of each second
    clean[i] = on ? 0.4 * Math.sin(2 * Math.PI * 600 * t) + 0.2 * Math.sin(2 * Math.PI * 1800 * t) : 0;
    noisy[i] = clean[i] + noiseAmp * rnd();
  }
  return { clean, noisy, n };
}

test("spectral denoiser cuts steady noise, keeps the signal, stays time-aligned", () => {
  const { clean, noisy, n } = noisyBursts();
  const r = runPipeline(noisy, createDenoiser("spectral"), { enableHighPass: false });
  assert.equal(r.samples.length, Math.ceil(n / 256) * 256);
  // Noise-only window: 2.0s..2.4s in each case is tone-off? tone-off is t in [k, k+0.5)
  const off = [2 * 48000 + 4800, 2 * 48000 + 19200], on = [2.5 * 48000 + 4800, 2.5 * 48000 + 19200];
  const reductionDb = 20 * Math.log10(rms(noisy, ...off) / rms(r.samples, ...off));
  assert.ok(reductionDb > 8, `noise reduction only ${reductionDb.toFixed(1)} dB`);
  const keptDb = 20 * Math.log10(rms(r.samples, ...on) / rms(clean, ...on));
  assert.ok(Math.abs(keptDb) < 2, `signal changed by ${keptDb.toFixed(1)} dB`);
  // Alignment: correlation with the clean signal at lag 0 beats +/-256 lag.
  const corr = (lag) => { let s = 0; for (let i = on[0]; i < on[1]; i++) s += r.samples[i + lag] * clean[i]; return s; };
  assert.ok(corr(0) > 4 * Math.abs(corr(256)) && corr(0) > 4 * Math.abs(corr(-256)));
});

test("API handler denoises a WAV and enforces errors", async () => {
  const { noisy } = noisyBursts(1);
  const wav = encodeWav(noisy, 48000);
  const call = async (method, url, body) => {
    const req = Object.assign(Readable.from(body ? [body] : []), { method, url });
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
    await handler(req, res);
    return res;
  };
  const ok = await call("POST", "/api/denoise?model=spectral", wav);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.headers["Content-Type"], "audio/wav");
  assert.equal(decodeWav(ok.body).samples.length, Math.ceil(48000 / 256) * 256);
  assert.equal((await call("GET", "/api/denoise")).statusCode, 405);
  assert.equal((await call("POST", "/api/denoise", Buffer.from("junk junk"))).statusCode, 415);
  const rn = await call("POST", "/api/denoise?model=rnnoise", wav);
  assert.equal(rn.statusCode, 501);
  assert.match(JSON.parse(rn.body).error, /RNNoise/);
  assert.equal((await call("POST", "/api/denoise?reduceDb=999", wav)).statusCode, 400);
});
