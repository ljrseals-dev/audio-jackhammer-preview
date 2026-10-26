// Audio-Jackhammer
// Copyright (c) 2026 Lewis James Seals Jr. All rights reserved.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.

/** Minimal WAV codec: PCM 8/16/24/32-bit and IEEE float32 in; 16-bit PCM or float32 out. */

/** @returns {{samples: Float32Array, sampleRate: number}} mono float32 */
export function decodeWav(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Not a RIFF/WAVE file.");
  }
  let pos = 12, fmt = null, data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    let size = buf.readUInt32LE(pos + 4);
    const start = pos + 8;
    if (start + size > buf.length) size = buf.length - start; // tolerate truncated/streamed headers
    if (id === "fmt ") {
      fmt = {
        format: buf.readUInt16LE(start),
        channels: buf.readUInt16LE(start + 2),
        sampleRate: buf.readUInt32LE(start + 4),
        bits: buf.readUInt16LE(start + 14),
      };
      if (fmt.format === 0xfffe && size >= 26) fmt.format = buf.readUInt16LE(start + 24); // WAVE_FORMAT_EXTENSIBLE
    } else if (id === "data") {
      data = buf.subarray(start, start + size);
      break;
    }
    pos = start + size + (size & 1);
  }
  if (!fmt || !data) throw new Error("WAV is missing a fmt or data chunk.");
  const { format, channels, sampleRate, bits } = fmt;
  if (channels < 1) throw new Error("Invalid channel count.");
  const bytes = bits / 8;
  const isFloat = format === 3;
  if (!(format === 1 || isFloat) || ![8, 16, 24, 32].includes(bits) || (isFloat && bits !== 32)) {
    throw new Error(`Unsupported WAV encoding (format=${format}, bits=${bits}).`);
  }
  const frames = Math.floor(data.length / (bytes * channels));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const o = (i * channels + c) * bytes;
      let v;
      if (isFloat) v = data.readFloatLE(o);
      else if (bits === 16) v = data.readInt16LE(o) / 32768;
      else if (bits === 8) v = (data[o] - 128) / 128;
      else if (bits === 24) v = data.readIntLE(o, 3) / 8388608;
      else v = data.readInt32LE(o) / 2147483648;
      sum += v;
    }
    out[i] = sum / channels;
  }
  return { samples: out, sampleRate };
}

/** Linear-interpolation resampler (adequate for 44.1/48 kHz; the browser UI resamples properly). */
export function resampleLinear(samples, from, to) {
  if (from === to || samples.length === 0) return samples;
  const n = Math.max(1, Math.round((samples.length * to) / from));
  const out = new Float32Array(n);
  const ratio = from / to;
  for (let i = 0; i < n; i++) {
    const p = i * ratio;
    const i0 = Math.floor(p);
    const i1 = Math.min(i0 + 1, samples.length - 1);
    const f = p - i0;
    out[i] = samples[Math.min(i0, samples.length - 1)] * (1 - f) + samples[i1] * f;
  }
  return out;
}

export function encodeWav(samples, sampleRate = 48000, { float32 = false } = {}) {
  const bytes = float32 ? 4 : 2;
  const dataLen = samples.length * bytes;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(float32 ? 3 : 1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * bytes, 28);
  buf.writeUInt16LE(bytes, 32);
  buf.writeUInt16LE(bytes * 8, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < samples.length; i++) {
    if (float32) buf.writeFloatLE(samples[i], 44 + i * 4);
    else {
      const v = Math.max(-1, Math.min(1, samples[i]));
      buf.writeInt16LE(Math.round(v < 0 ? v * 32768 : v * 32767), 44 + i * 2);
    }
  }
  return buf;
}
