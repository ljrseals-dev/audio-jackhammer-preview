// Audio-Jackhammer
// Copyright (c) 2026 Lewis James Seals Jr. All rights reserved.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.

import { decodeWav, encodeWav, resampleLinear } from "../lib/wav.js";
import { createDenoiser } from "../lib/factory.js";
import { runPipeline } from "../lib/pipeline.js";

// Vercel Functions cap request and response bodies at 4.5 MB.
const MAX_BYTES = 4.5 * 1024 * 1024;

async function readBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body, "binary");
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BYTES) { const e = new Error("Request body exceeds the 4.5 MB Vercel limit."); e.status = 413; throw e; }
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

function send(res, status, body, headers = {}) {
  res.statusCode = status;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(body);
}
const sendJson = (res, status, obj) => send(res, status, JSON.stringify(obj), { "Content-Type": "application/json" });

/**
 * POST /api/denoise?model=spectral|null&highpass=90&lookahead=0&reduceDb=18&format=wav16|wav32
 * Body: a WAV file (send as application/octet-stream). Response: denoised mono 48 kHz WAV.
 */
export default async function handler(req, res) {
  if (req.method === "OPTIONS") return send(res, 204, "", { Allow: "POST, OPTIONS" });
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return sendJson(res, 405, { error: "Use POST with a WAV body." });
  }
  try {
    const url = new URL(req.url, "http://localhost");
    const q = url.searchParams;
    const highPassHz = Number(q.get("highpass") ?? 90);
    const reduceDb = Number(q.get("reduceDb") ?? 18);
    if (!Number.isFinite(highPassHz) || highPassHz < 0 || highPassHz >= 24000) return sendJson(res, 400, { error: "highpass must be 0 (off) up to 24000 Hz." });
    if (!Number.isFinite(reduceDb) || reduceDb < 0 || reduceDb > 60) return sendJson(res, 400, { error: "reduceDb must be between 0 and 60." });

    const denoiser = createDenoiser(q.get("model") ?? "spectral", { reduceDb });
    const body = await readBody(req);
    if (body.length === 0) return sendJson(res, 400, { error: "Empty body. POST a WAV file." });

    const { samples, sampleRate } = decodeWav(body);
    const input = resampleLinear(samples, sampleRate, 48000);
    const result = runPipeline(input, denoiser, {
      highPassHz: highPassHz || 90,
      enableHighPass: highPassHz > 0,
      lookAhead: q.get("lookahead") === "1",
    });
    const wav = encodeWav(result.samples, 48000, { float32: q.get("format") === "wav32" });
    if (wav.length > MAX_BYTES) return sendJson(res, 413, { error: "Result exceeds the 4.5 MB Vercel response limit. Send a shorter clip." });

    return send(res, 200, wav, {
      "Content-Type": "audio/wav",
      "Content-Length": String(wav.length),
      "X-Denoiser-Model": result.model,
      "X-Denoiser-RTF": result.rtf.toFixed(3),
      "X-Denoiser-Audio-Seconds": (result.audioMs / 1000).toFixed(2),
      "Cache-Control": "no-store",
    });
  } catch (err) {
    const status = err.status ?? (err.message?.includes("WAV") ? 415 : 500);
    return sendJson(res, status, { error: err.message });
  }
}
