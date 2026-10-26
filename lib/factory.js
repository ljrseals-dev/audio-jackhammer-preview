// Audio-Jackhammer
// Copyright (c) 2026 Lewis James Seals Jr. All rights reserved.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.

import { SpectralGateDenoiser, NullDenoiser } from "./spectral.js";

export class UnsupportedModelError extends Error {
  constructor(message) { super(message); this.name = "UnsupportedModelError"; this.status = 501; }
}

/** Fails loudly on models that need native code; never silently falls back to pass-through. */
export function createDenoiser(modelName = "spectral", options = {}) {
  switch (String(modelName).toLowerCase()) {
    case "spectral": case "gate": return new SpectralGateDenoiser(options);
    case "null": case "none": case "passthrough": return new NullDenoiser();
    case "rnnoise":
      throw new UnsupportedModelError("RNNoise needs the native librnnoise library, which is not available in this JavaScript/Vercel build. Use model=spectral, or run the original .NET app for RNNoise.");
    case "deepfilternet": case "dfn": case "deepfilter":
      throw new UnsupportedModelError("DeepFilterNet needs an ONNX runtime plus model files, which are not bundled in this Vercel build. Use model=spectral, or run the original .NET app for DeepFilterNet.");
    default:
      throw new UnsupportedModelError(`Unknown model '${modelName}'. Supported: spectral, null.`);
  }
}
