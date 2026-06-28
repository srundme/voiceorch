/**
 * Caller gender detector — progressive ML-based detection.
 *
 * Instead of firing once after a fixed audio buffer, this detector runs after
 * each user speech turn and locks in a gender once it is confident enough.
 *
 * - addSpeechChunk(pcm8k) — accumulates caller audio (called on every frame).
 * - runDetection()        — call this after each user turn ends (non-blocking).
 *   • If confidence ≥ CONFIDENCE_THRESHOLD  → lock gender immediately.
 *   • If accumulated audio ≥ FALLBACK_BYTES → lock with best available result.
 *   • Otherwise keep collecting and retry next turn.
 *
 * "locked" turns true once the gender is committed. Subsequent runDetection()
 * calls are no-ops and chunks are freed to release memory.
 *
 * The greeting always uses a neutral salutation (no waiting). The resolved
 * gender is available for subsequent turns via the `.gender` property.
 */

import { logger as rootLogger } from "../lib/logger.js";
import { genderServiceBaseUrl } from "./genderService.js";

const SAMPLE_RATE  = 8_000;
const BITS         = 16;
const CHANNELS     = 1;
const SAMPLE_BYTES = BITS / 8;

/** Minimum audio before we bother running detection (1 second). */
const MIN_BYTES = 1 * SAMPLE_RATE * SAMPLE_BYTES;

/**
 * After this much audio we lock regardless of confidence — the model has seen
 * enough of the caller's voice to make a reasonable decision (4 seconds).
 */
const FALLBACK_BYTES = 4 * SAMPLE_RATE * SAMPLE_BYTES;

/** Confidence threshold for an immediate lock (0–1 scale from the ML service). */
const CONFIDENCE_THRESHOLD = 0.75;

const GENDER_ML_SERVICE_URL = `${genderServiceBaseUrl()}/voice-analysis/gender-ml`;

// Startup warning so misconfigured deployments are caught in logs immediately.
if (process.env["GENDER_SERVICE_URL"] && (
  process.env["GENDER_SERVICE_URL"].includes("/gender-ml") ||
  process.env["GENDER_SERVICE_URL"].includes("/voice-analysis")
)) {
  rootLogger.warn(
    { configured: process.env["GENDER_SERVICE_URL"] },
    "GENDER_SERVICE_URL should be a bare host URL (e.g. http://host:5000). The /voice-analysis/gender-ml suffix is appended automatically — do not include any path in this env var.",
  );
}

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
  /** Resolved gender once detection completes, null until then. */
  gender: DetectedGender = null;

  /** True once gender is committed — no further detection will run. */
  locked = false;

  private chunks: Buffer[] = [];
  private accumulated = 0;
  private detecting = false;
  private readonly callId: number;
  private readonly log: typeof rootLogger;

  constructor(callId: number, log?: typeof rootLogger) {
    this.callId = callId;
    this.log = log ?? rootLogger;
  }

  /**
   * Feed a chunk of caller audio (PCM 8 kHz 16-bit LE mono).
   * Just accumulates — detection is triggered by runDetection(), not here.
   */
  addSpeechChunk(pcm8k: Buffer): void {
    if (this.locked) return;
    this.chunks.push(pcm8k);
    this.accumulated += pcm8k.byteLength;
  }

  /**
   * Trigger a detection attempt (fire-and-forget — does not block the caller).
   * Call this after each user speech turn ends.
   *
   * No-op if:
   *   - already locked
   *   - a detection is already in flight
   *   - not enough audio has accumulated yet (< MIN_BYTES)
   */
  runDetection(): void {
    if (this.locked || this.detecting || this.accumulated < MIN_BYTES) return;
    this.detecting = true;
    const combined = Buffer.concat(this.chunks);
    this.log.info(
      { callId: this.callId, bytes: combined.byteLength, provider: "ml_model" },
      "Gender detection (ML model) firing",
    );
    this._detect(combined).catch((err) => {
      this.log.warn({ callId: this.callId, err }, "GenderDetectorML runDetection rejected unexpectedly");
    }).finally(() => { this.detecting = false; });
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

      const json       = await res.json() as { estimated_gender: string; confidence: number };
      const g          = json.estimated_gender;
      const confidence = json.confidence ?? 0;

      if (g !== "male" && g !== "female") {
        this.log.info(
          { callId: this.callId, result: g, confidence, bytes: pcm.byteLength, provider: "ml_model" },
          "Gender ML detection returned unknown — will retry next turn",
        );
        return;
      }

      const highConfidence  = confidence >= CONFIDENCE_THRESHOLD;
      const enoughAudio     = this.accumulated >= FALLBACK_BYTES;
      const shouldLock      = highConfidence || enoughAudio;

      // Always record the tentative result so the system prompt can use it.
      this.gender = g;

      if (shouldLock) {
        this.locked = true;
        this.chunks = []; // free memory
        this.log.info(
          {
            callId: this.callId,
            gender: g,
            confidence,
            bytes: pcm.byteLength,
            reason: highConfidence ? "high_confidence" : "enough_audio_fallback",
            provider: "ml_model",
          },
          "Caller gender locked (progressive detection)",
        );
      } else {
        this.log.info(
          { callId: this.callId, gender: g, confidence, bytes: pcm.byteLength, provider: "ml_model" },
          "Caller gender detected (tentative — awaiting higher confidence)",
        );
      }
    } catch (err) {
      this.log.warn({ callId: this.callId, err }, "Gender ML detection request failed — continuing without salutation");
    }
  }
}
