import { describe, expect, it } from "vitest";
import {
  createDownsampler16to8,
  createDownsampler24to8,
  downsample16to8,
  downsample24to8,
} from "./audio.js";

/** Speech-like tone stack (200 Hz fundamental + harmonics through the voice band). */
function speech(sampleRate: number, samples: number): Buffer {
  const buf = Buffer.allocUnsafe(samples * 2);
  for (let i = 0; i < samples; i++) {
    let v = 0;
    for (let h = 1; h <= 8; h++) v += (6000 / h) * Math.sin((2 * Math.PI * 200 * h * i) / sampleRate);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v))), i * 2);
  }
  return buf;
}

function toSamples(buf: Buffer): number[] {
  const out: number[] = [];
  for (let i = 0; i < buf.length / 2; i++) out.push(buf.readInt16LE(i * 2));
  return out;
}

function rms(xs: number[]): number {
  return Math.sqrt(xs.reduce((a, v) => a + v * v, 0) / xs.length);
}

/** Feed `input` through `process` in fixed-size chunks, concatenating the output. */
function chunked(input: Buffer, chunkBytes: number, process: (b: Buffer) => Buffer): Buffer {
  const parts: Buffer[] = [];
  for (let i = 0; i < input.length; i += chunkBytes) {
    parts.push(process(input.subarray(i, i + chunkBytes)));
  }
  return Buffer.concat(parts);
}

describe("StreamingDecimator (16→8)", () => {
  const FRAME_16K_BYTES = 640; // 20ms @ 16kHz s16le — the TTS drain's block size

  it("keeps the stateless helper's output length per call", () => {
    const d = createDownsampler16to8();
    expect(d.process(Buffer.alloc(FRAME_16K_BYTES)).length).toBe(320);
    expect(d.process(Buffer.alloc(FRAME_16K_BYTES)).length).toBe(320);
  });

  it("matches a whole-buffer filter far more closely than per-block stateless calls", () => {
    const input = speech(16000, 16000); // 1s
    const reference = toSamples(downsample16to8(input));
    const stateful = toSamples(chunked(input, FRAME_16K_BYTES, ((d) => (b: Buffer) => d.process(b))(createDownsampler16to8())));
    const stateless = toSamples(chunked(input, FRAME_16K_BYTES, downsample16to8));

    // The stateful path lags by `half` input samples (7 @16k = 3.5 output
    // samples), so compare against the reference shifted by that constant.
    const LAG = 4;
    const err = (xs: number[], lag: number) => {
      const n = Math.min(xs.length - lag, reference.length - lag) - 32;
      const diffs: number[] = [];
      for (let i = 16; i < n; i++) diffs.push(xs[i + lag]! - reference[i]!);
      return rms(diffs);
    };

    const statefulErr = err(stateful, LAG);
    const statelessErr = err(stateless, 0);
    // Per-block stateless filtering scored ~33dB SNR (2.1% error); the stateful
    // decimator must be at least an order of magnitude cleaner.
    expect(statefulErr).toBeLessThan(statelessErr / 10);
  });

  it("has no periodic block-edge defect (the 50Hz buzz)", () => {
    const input = speech(16000, 16000);
    const stateful = toSamples(chunked(input, FRAME_16K_BYTES, ((d) => (b: Buffer) => d.process(b))(createDownsampler16to8())));
    const stateless = toSamples(chunked(input, FRAME_16K_BYTES, downsample16to8));
    const reference = toSamples(downsample16to8(input));

    // Energy at the first output sample of each 160-sample block, relative to
    // block-interior samples. Stateless filtering spikes here; stateful must not.
    const edgeVsInterior = (xs: number[], lag: number) => {
      const edge: number[] = [];
      const interior: number[] = [];
      for (let i = 160; i + lag + 160 < reference.length; i++) {
        const d = xs[i + lag]! - reference[i]!;
        (i % 160 === 0 ? edge : interior).push(d);
      }
      return rms(edge) / Math.max(1, rms(interior));
    };

    expect(edgeVsInterior(stateless, 0)).toBeGreaterThan(5);
    expect(edgeVsInterior(stateful, 4)).toBeLessThan(2);
  });

  it("carries sub-factor remainders across odd-sized chunks without drift", () => {
    const d = createDownsampler16to8();
    // 5 samples (10 bytes) at a time: 2 out, 1 sample carried, then 3 out, …
    const total = chunked(speech(16000, 1000), 10, (b) => d.process(b));
    expect(total.length / 2).toBe(500); // 1000 in / factor 2, nothing lost
  });

  it("reset() restores the silent pre-roll", () => {
    const d = createDownsampler16to8();
    const frame = speech(16000, 320);
    const first = d.process(frame);
    d.process(frame);
    d.reset();
    expect(d.process(frame).equals(first)).toBe(true);
  });
});

describe("StreamingDecimator (24→8)", () => {
  const FRAME_24K_BYTES = 960; // 20ms @ 24kHz — Gemini Live's slice size

  it("keeps the stateless helper's output length per call", () => {
    const d = createDownsampler24to8();
    expect(d.process(Buffer.alloc(FRAME_24K_BYTES)).length).toBe(320);
    expect(d.process(Buffer.alloc(FRAME_24K_BYTES)).length).toBe(320);
  });

  it("beats per-block stateless calls against a whole-buffer reference", () => {
    const input = speech(24000, 24000);
    const reference = toSamples(downsample24to8(input));
    const decim = createDownsampler24to8();
    const stateful = toSamples(chunked(input, FRAME_24K_BYTES, (b) => decim.process(b)));
    const stateless = toSamples(chunked(input, FRAME_24K_BYTES, downsample24to8));

    const LAG = decim.delaySamples;
    const err = (xs: number[], lag: number) => {
      const diffs: number[] = [];
      for (let i = 32; i + lag < Math.min(xs.length, reference.length) - 32; i++) {
        diffs.push(xs[i + lag]! - reference[i]!);
      }
      return rms(diffs);
    };

    expect(err(stateful, LAG)).toBeLessThan(err(stateless, 0) / 5);
  });
});
