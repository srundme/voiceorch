/**
 * Real-time caller gender detector.
 *
 * Buffers the first SAMPLE_SECONDS of caller speech frames (hasSpeech == true),
 * then POSTs a WAV to the voice-analysis microservice and resolves with the
 * detected gender. Subsequent calls to addSpeechChunk() are no-ops once
 * detection has fired.
 *
 * Uses Node.js 24 built-in fetch + FormData — no external deps needed.
 *
 * Usage:
 *   const det = new GenderDetector(callId, logger);
 *   // In handleProcessedAudio when hasSpeech:
 *   det.addSpeechChunk(pcm8k);
 *   // In processTurn:
 *   const g = det.gender;   // "male" | "female" | null
 */

import { logger as rootLogger } from "../lib/logger.js";

const SAMPLE_RATE  = 8_000;
const BITS         = 16;
const CHANNELS     = 1;
const SAMPLE_BYTES = BITS / 8;

/**
 * Collect 2 s of total caller audio before calling the API (= 32 000 bytes @ 8 kHz 16-bit mono).
 * We include all frames (not just hasSpeech) — librosa pyin ignores silent frames when
 * computing the median pitch, so silence doesn't hurt detection accuracy.
 * 2 s is plenty for a reliable F0 estimate and fires well within the first caller turn.
 */
const TARGET_BYTES = 2 * SAMPLE_RATE * SAMPLE_BYTES;

// Resolve the gender-service base URL from the environment so the same binary
// works in dev (same-VM localhost) and on Railway (separate container with a
// GENDER_SERVICE_URL env var set to the internal service hostname).
const _GENDER_BASE = (process.env["GENDER_SERVICE_URL"] ?? "http://localhost:5000").replace(/\/$/, "");
const GENDER_SERVICE_URL = `${_GENDER_BASE}/voice-analysis/gender`;

// ── WAV builder ──────────────────────────────────────────────────────────────

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

// ── Detector ─────────────────────────────────────────────────────────────────

export type DetectedGender = "male" | "female" | null;

export class GenderDetector {
  /** Resolved gender, or null if detection hasn't completed yet. */
  gender: DetectedGender = null;

  /** True once gender is committed — mirrors `fired` for interface compatibility with GenderDetectorML. */
  get locked(): boolean { return this.fired; }

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
   * Feed a chunk of caller speech audio (PCM 8 kHz 16-bit LE mono).
   * Call this only when `hasSpeech` is true so silence doesn't dilute the
   * sample.  Once TARGET_BYTES is reached, kicks off async detection.
   */
  addSpeechChunk(pcm8k: Buffer): void {
    if (this.fired) return;
    this.chunks.push(pcm8k);
    this.accumulated += pcm8k.byteLength;
    if (this.accumulated >= TARGET_BYTES) {
      this.fired = true;
      const combined = Buffer.concat(this.chunks);
      this.chunks = [];   // free memory
      this.log.info({ callId: this.callId, bytes: combined.byteLength }, "Gender detection firing");
      this._detect(combined).catch((err) => {
        this.log.warn({ callId: this.callId, err }, "Gender detection promise rejected unexpectedly");
      });
    }
  }

  /**
   * No-op stub for interface compatibility with GenderDetectorML.
   * The plain GenderDetector fires automatically via addSpeechChunk().
   */
  runDetection(): void { /* auto-fires in addSpeechChunk */ }

  private async _detect(pcm: Buffer): Promise<void> {
    try {
      const wavBuf   = buildWav(pcm);
      // Copy into a plain ArrayBuffer so Blob constructor accepts it (strict TS)
      const ab       = wavBuf.buffer.slice(wavBuf.byteOffset, wavBuf.byteOffset + wavBuf.byteLength) as ArrayBuffer;
      const blob     = new Blob([ab], { type: "audio/wav" });
      const form     = new FormData();
      form.append("file", blob, "caller.wav");

      const res = await fetch(GENDER_SERVICE_URL, {
        method: "POST",
        body:   form,
        signal: AbortSignal.timeout(60_000),
      });

      if (!res.ok) {
        this.log.warn({ callId: this.callId, status: res.status }, "Gender service returned non-200");
        return;
      }

      const json = await res.json() as { estimated_gender: string; confidence: number };
      const g    = json.estimated_gender;

      if (g === "male" || g === "female") {
        this.gender = g;
        this.log.info({ callId: this.callId, gender: g, confidence: json.confidence }, "Caller gender detected");
      } else {
        this.log.info({ callId: this.callId, result: g }, "Gender detection returned unknown — salutation will be generic");
      }
    } catch (err) {
      this.log.warn({ callId: this.callId, err }, "Gender detection request failed — continuing without salutation");
    }
  }
}
