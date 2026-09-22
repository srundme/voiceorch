/**
 * Streaming 8 kHz PCM → leftover buffer → upsample → exact Silero 16 kHz frames.
 *
 * Used on the classic pipeline for advisory caller_speaking / soft-duck fusion.
 * Never gates the STT feed. VoBiz inbound chunks are not aligned to Silero's
 * 512-sample window — leftover PCM is kept between WebSocket messages.
 */

import { upsample8to16 } from "./audio.js";
import { SileroVAD } from "./silero-vad.js";
import { HysteresisVad, resolveSileroHysteresis, type VadFrameResult } from "./hysteresis-vad.js";

/** 256 samples @ 8 kHz = 512 samples @ 16 kHz = one Silero window (32 ms). */
export const SILERO_FRAME_8K_SAMPLES = 256;
export const SILERO_FRAME_8K_BYTES = SILERO_FRAME_8K_SAMPLES * 2;

export type SileroFrameHandler = (frame: VadFrameResult & { inferMs: number }) => void;

export function appendAlignedPcm8k(leftover: Buffer, incoming: Buffer): {
  leftover: Buffer;
  frames8k: Buffer[];
} {
  const merged = leftover.length > 0 ? Buffer.concat([leftover, incoming]) : incoming;
  const evenLen = merged.length & ~1;
  const frames8k: Buffer[] = [];
  let offset = 0;
  while (offset + SILERO_FRAME_8K_BYTES <= evenLen) {
    frames8k.push(Buffer.from(merged.subarray(offset, offset + SILERO_FRAME_8K_BYTES)));
    offset += SILERO_FRAME_8K_BYTES;
  }
  const rest = Buffer.from(merged.subarray(offset));
  return { leftover: rest, frames8k };
}

export class SileroStream {
  private leftover8k = Buffer.alloc(0);
  private readonly vad: SileroVAD;
  private readonly hysteresis: HysteresisVad;
  private readonly onFrame: SileroFrameHandler;
  private inferMs: number[] = [];
  private destroyed = false;

  constructor(opts: {
    callId?: string | number;
    onFrame: SileroFrameHandler;
    hysteresis?: HysteresisVad;
  }) {
    this.vad = new SileroVAD(0.5, opts.callId);
    this.hysteresis = opts.hysteresis ?? new HysteresisVad(resolveSileroHysteresis());
    this.onFrame = opts.onFrame;
    this.vad.setOnInference((prob, inferMs) => {
      if (this.destroyed) return;
      this.inferMs.push(inferMs);
      const result = this.hysteresis.push(prob);
      this.onFrame({ ...result, inferMs });
    });
  }

  /**
   * Accept an arbitrary 8 kHz s16le chunk. Incomplete samples/frames stay in
   * leftover until later messages fill a Silero window.
   */
  push8k(pcm8k: Buffer): void {
    if (this.destroyed || pcm8k.length === 0) return;
    const split = appendAlignedPcm8k(this.leftover8k, pcm8k);
    this.leftover8k = split.leftover;
    for (const frame8k of split.frames8k) {
      this.vad.push(upsample8to16(frame8k));
    }
  }

  async flush(): Promise<void> {
    await this.vad.flush();
  }

  isAvailable(): boolean {
    return this.vad.isAvailable();
  }

  inferenceTimesMs(): number[] {
    return this.inferMs.slice();
  }

  leftoverBytes(): number {
    return this.leftover8k.length;
  }

  destroy(): void {
    this.destroyed = true;
    this.leftover8k = Buffer.alloc(0);
    this.vad.destroy();
    this.hysteresis.reset();
  }
}
