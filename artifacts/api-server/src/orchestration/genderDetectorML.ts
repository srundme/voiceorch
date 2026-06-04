/**
 * Caller gender detector — "Gender Detection ML Model" provider.
 *
 * Buffers the first 2 seconds of caller audio (32 000 bytes @ 8 kHz PCM16),
 * then POSTs a WAV to the voice-analysis microservice's autocorrelation
 * endpoint (/voice-analysis/gender-ml) and resolves with the detected gender.
 *
 * Drop-in replacement for GenderDetector — exposes the same `.gender` property
 * and `addSpeechChunk(pcm8k)` interface so pipeline.ts and webcall.ts can
 * switch between the two with a single conditional.
 */

import { logger as rootLogger } from "../lib/logger.js";

const SAMPLE_RATE  = 8_000;
const BITS         = 16;
const CHANNELS     = 1;
const SAMPLE_BYTES = BITS / 8;

/**
 * 2 seconds of 8 kHz 16-bit mono PCM = 32 000 bytes.
 */
const TARGET_BYTES = 2 * SAMPLE_RATE * SAMPLE_BYTES;

const GENDER_ML_SERVICE_URL = "http://localhost:5000/voice-analysis/gender-ml";

// ── WAV builder ───────────────────────────────────────────────────────────────

function buildWav(pcmData: Buffer): Buffer {
  const dataLen  = pcmData.byteLength;
  const byteRate = SAMPLE_RATE * CHANNELS * SAMPLE_BYTES;
  const hdr      = Buffer.alloc(44);

  hdr.write("RIFF",    0, "ascii");
  hdr.writeUInt32LE(36 + dataLen, 4);
  hdr.write("WAVE",    8, "ascii");
  hdr.write("fmt ",   12, "ascii");
  hdr.writeUInt32LE(16,          16);
  hdr.writeUInt16LE(1,           20); // PCM
  hdr.writeUInt16LE(CHANNELS,    22);
  hdr.writeUInt32LE(SAMPLE_RATE, 24);
  hdr.writeUInt32LE(byteRate,    28);
  hdr.writeUInt16LE(CHANNELS * SAMPLE_BYTES, 32);
  hdr.writeUInt16LE(BITS,        34);
  hdr.write("data",  36, "ascii");
  hdr.writeUInt32LE(dataLen,     40);

  return Buffer.concat([hdr, pcmData]);
}

// ── Detector ──────────────────────────────────────────────────────────────────

export type DetectedGender = "male" | "female" | null;

export class GenderDetectorML {
  /** Resolved gender, or null if detection hasn't completed yet. */
  gender: DetectedGender = null;

  private chunks: Buffer[] = [];
  private accumulated = 0;
  private fired = false;
  private readonly callId: number;
  private readonly log: typeof rootLogger;

  constructor(callId: number, log?: typeof rootLogger) {
    this.callId = callId;
    this.log = log ?? rootLogger;
  }

  /**
   * Feed a chunk of caller audio (PCM 8 kHz 16-bit LE mono).
   * Once 2 seconds (TARGET_BYTES) have accumulated, fires async detection.
   * Subsequent calls are no-ops.
   */
  addSpeechChunk(pcm8k: Buffer): void {
    if (this.fired) return;
    this.chunks.push(pcm8k);
    this.accumulated += pcm8k.byteLength;
    if (this.accumulated >= TARGET_BYTES) {
      this.fired = true;
      const combined = Buffer.concat(this.chunks);
      this.chunks = [];
      this.log.info(
        { callId: this.callId, bytes: combined.byteLength, provider: "ml_model" },
        "Gender detection (ML model) firing",
      );
      this._detect(combined).catch((err) => {
        this.log.warn({ callId: this.callId, err }, "GenderDetectorML promise rejected unexpectedly");
      });
    }
  }

  private async _detect(pcm: Buffer): Promise<void> {
    try {
      const wavBuf = buildWav(pcm);
      const ab     = wavBuf.buffer.slice(wavBuf.byteOffset, wavBuf.byteOffset + wavBuf.byteLength) as ArrayBuffer;
      const blob   = new Blob([ab], { type: "audio/wav" });
      const form   = new FormData();
      form.append("file", blob, "caller.wav");

      const res = await fetch(GENDER_ML_SERVICE_URL, {
        method: "POST",
        body:   form,
        signal: AbortSignal.timeout(60_000),
      });

      if (!res.ok) {
        this.log.warn({ callId: this.callId, status: res.status }, "Gender ML service returned non-200");
        return;
      }

      const json = await res.json() as { estimated_gender: string; confidence: number };
      const g    = json.estimated_gender;

      if (g === "male" || g === "female") {
        this.gender = g;
        this.log.info(
          { callId: this.callId, gender: g, confidence: json.confidence, provider: "ml_model" },
          "Caller gender detected (ML model)",
        );
      } else {
        this.log.info(
          { callId: this.callId, result: g, provider: "ml_model" },
          "Gender ML detection returned unknown — salutation will be generic",
        );
      }
    } catch (err) {
      this.log.warn({ callId: this.callId, err }, "Gender ML detection request failed — continuing without salutation");
    }
  }
}
