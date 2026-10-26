# Audio Jackhammer (Vercel edition)

> **PREVIEW: NOT FOR EMERGENCY, 911, OR OTHER SAFETY-CRITICAL USE.**
> This JavaScript edition is a demonstration build for Vercel. Its denoiser is a basic spectral gate, not RNNoise or DeepFilterNet. It has no realtime mode, no latency guarantees, no uptime guarantees, and it sends audio to a third-party host. The production-intended implementation is the .NET 8 application in the main repository. Do not route live call audio through this build.


Copyright © 2026 Lewis James Seals Jr. All rights reserved.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.

Environmental denoiser for construction-site audio, rewritten from the .NET 8 original in dependency-free JavaScript (Node 20+) so it deploys on Vercel as a static page plus one serverless function. This is **speech/environmental enhancement**, not active noise cancellation.

## What is ported

| .NET original | This version |
|---|---|
| `HighPassFilter` | `lib/highpass.js` (same biquad) |
| `SoftLimiter` (soft knee + look-ahead) | `lib/limiter.js` |
| `SnrEstimator` | `lib/snr.js` |
| `FrameAccumulator` | `lib/framer.js` |
| `DenoiserPipeline` | `lib/pipeline.js` (same order: HPF → denoiser → limiter; zero-padded tail; flush) |
| `NullDenoiser` | `lib/spectral.js` |
| NAudio WAV I/O | `lib/wav.js` (PCM 8/16/24/32 + float32; browser decodes MP3/M4A/etc.) |
| CLI | `bin/denoise.mjs` |
| RNNoise / DeepFilterNet | **Not ported** (need native code / ONNX). Replaced by `SpectralGateDenoiser`. |
| Realtime (WASAPI) | **Not ported** (needs a local audio device). |

`model=rnnoise` and `model=deepfilternet` return HTTP 501 with an explanation. Nothing silently falls back to pass-through, matching the original's "fail loudly" rule.

## About the new denoiser

`SpectralGateDenoiser` is a baseline spectral-subtraction gate (512-pt STFT, hop 256, per-bin noise tracking, smoothed gains). It reduces steady rumble and broadband noise. It does **not** match RNNoise or DeepFilterNet quality, and impulsive jackhammer strikes pass through. It assumes roughly the first 40 ms is noise-dominated. Algorithmic delay is 256 samples and is trimmed so output stays time-aligned. Output length is `ceil(samples / 256) * 256`.

## Deploy

```sh
npm install --global vercel@latest
vercel login
vercel deploy          # preview
vercel deploy --prod   # production
```

Or import the Git repo in the Vercel dashboard. No build step or environment variables are needed.

## API

`POST /api/denoise?model=spectral|null&highpass=90&reduceDb=18&lookahead=0&format=wav16|wav32`
Body: WAV file (`Content-Type: application/octet-stream`). Response: mono 48 kHz WAV, with `X-Denoiser-RTF` and `X-Denoiser-Audio-Seconds` headers.

Vercel Functions limit request and response bodies to 4.5 MB, so clips are limited to about 45 s of 48 kHz mono 16-bit audio. For longer files, upload to Vercel Blob from the browser and process by URL (not implemented here).

## Local use

```sh
npm test
node bin/denoise.mjs --input in.wav --output out.wav --model spectral --highpass 90
```
