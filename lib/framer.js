// Audio-Jackhammer
// Copyright (c) 2026 Lewis James Seals Jr. All rights reserved.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.

/** Guarantees consumers only ever see exact frameSize-sample frames; flush() zero-pads the tail. */
export class FrameAccumulator {
  constructor(frameSize) {
    if (!(frameSize > 0)) throw new RangeError("frameSize must be > 0");
    this.frameSize = frameSize;
    this.buf = new Float32Array(frameSize);
    this.fill = 0;
  }
  get pending() { return this.fill; }
  /** onFrame(frame: Float32Array) is called once per complete frame; the buffer is reused. */
  push(input, onFrame) {
    let off = 0;
    while (off < input.length) {
      const take = Math.min(this.frameSize - this.fill, input.length - off);
      this.buf.set(input.subarray(off, off + take), this.fill);
      this.fill += take;
      off += take;
      if (this.fill === this.frameSize) { onFrame(this.buf); this.fill = 0; }
    }
  }
  flush(onFrame) {
    if (this.fill === 0) return false;
    this.buf.fill(0, this.fill);
    onFrame(this.buf);
    this.fill = 0;
    return true;
  }
  reset() { this.fill = 0; this.buf.fill(0); }
}
