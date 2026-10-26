#!/usr/bin/env node
// Audio-Jackhammer
// Copyright (c) 2026 Lewis James Seals Jr. All rights reserved.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.

import { readFileSync, writeFileSync } from "node:fs";
import { decodeWav, encodeWav, resampleLinear } from "../lib/wav.js";
import { createDenoiser } from "../lib/factory.js";
import { runPipeline } from "../lib/pipeline.js";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const flag = (name) => args.includes(`--${name}`);
if (flag("help") || !opt("input") || !opt("output")) {
  console.log("Usage: denoise --input in.wav --output out.wav [--model spectral|null] [--highpass 90] [--reduce-db 18] [--lookahead] [--float32]");
  process.exit(opt("input") && opt("output") ? 0 : 1);
}
try {
  const { samples, sampleRate } = decodeWav(readFileSync(opt("input")));
  const hp = Number(opt("highpass", 90));
  const r = runPipeline(resampleLinear(samples, sampleRate, 48000),
    createDenoiser(opt("model", "spectral"), { reduceDb: Number(opt("reduce-db", 18)) }),
    { highPassHz: hp || 90, enableHighPass: hp > 0, lookAhead: flag("lookahead") });
  writeFileSync(opt("output"), encodeWav(r.samples, 48000, { float32: flag("float32") }));
  console.log(`Done. Model=${r.model}, Samples=${r.samples.length}, Audio=${(r.audioMs / 1000).toFixed(2)}s, Wall=${(r.wallMs / 1000).toFixed(2)}s, RTF=${r.rtf.toFixed(3)}`);
} catch (e) {
  console.error(`error: ${e.message}`);
  process.exit(e.status === 501 ? 2 : 1);
}
