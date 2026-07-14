/**
 * Caller gender detector — wav2vec2-primary ordered fallback chain.
 *
 * This is the single detection strategy used by the orchestration pipeline. On
 * each eligible caller turn (until locked) it sends the accumulated caller audio
 * to three models IN ORDER and commits the first result that clears the
 * confidence threshold:
 *
 *   1. wav2vec2 (transformer)   → POST /voice-analysis/gender-ml-v2
 *   2. autocorrelation (NumPy)  → POST /voice-analysis/gender-ml
 *   3. pitch-based (librosa)    → POST /voice-analysis/gender
 *
 * Each request has a hard 1.5 s timeout. If a model times out OR returns a
 * confidence below CONFIDENCE_THRESHOLD, the chain immediately falls through to
 * the next model. The first model that returns male/female with confidence
 * ≥ CONFIDENCE_THRESHOLD wins and the gender is LOCKED for the rest of the call.
 * If no model qualifies on this turn, the neutral default is kept and detection
 * retries on the next caller turn.
 *
 * Interface mirrors the other detectors (gender / locked / addSpeechChunk /
 * runDetection) so the pipeline can use it interchangeably.
 */

import { logger as rootLogger } from "../lib/logger.js";
import { genderServiceBaseUrl } from "./genderService.js";

const SAMPLE_RATE  = 8_000;
const BITS         = 16;
const CHANNELS     = 1;
const SAMPLE_BYTES = BITS / 8;

/**
 * Minimum audio before we bother running detection. Lowered to 0.5 s so a
 * detection attempt fires after less caller speech, resolving the Sir/Ma'am
 * salutation sooner (typically within the caller's first, shorter response).
 * Tunable in production via GENDER_MIN_AUDIO_MS (milliseconds, default 500).
 */
const MIN_AUDIO_MS = (() => {
  const raw = Number(process.env.GENDER_MIN_AUDIO_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 500;
})();
const MIN_BYTES = Math.round((MIN_AUDIO_MS / 1000) * SAMPLE_RATE) * SAMPLE_BYTES;

/**
 * Cap on accumulated audio when detection never locks. Keeps memory bounded on
 * long calls where no model ever clears the threshold — we retain only the most
 * recent window (more audio does not improve a pitch/transformer estimate).
 */
const MAX_BYTES = 10 * SAMPLE_RATE * SAMPLE_BYTES;

/** Per-model request timeout. Falls through to the next model on expiry. */
const MODEL_TIMEOUT_MS = 1_500;

/**
 * Minimum confidence (0–1) a model must report to win and lock the gender.
 * Lowered to 0.60 so a tentative-but-likely result locks sooner (fewer
 * fall-throughs/retries before the salutation resolves). Tunable in production
 * via GENDER_CONFIDENCE_THRESHOLD (default 0.60).
 */
const CONFIDENCE_THRESHOLD = (() => {
  const raw = Number(process.env.GENDER_CONFIDENCE_THRESHOLD);
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 0.60;
})();

const BASE = genderServiceBaseUrl();

/** Ordered fallback chain: wav2vec2 first, then autocorrelation, then pitch. */
const MODEL_CHAIN: ReadonlyArray<{ name: string; url: string }> = [
  { name: "wav2vec2",        url: `${BASE}/voice-analysis/gender-ml-v2` },
  { name: "autocorrelation", url: `${BASE}/voice-analysis/gender-ml` },
  { name: "pitch",           url: `${BASE}/voice-analysis/gender` },
];

/**
 * Rate-limit for the "whole service unreachable" warn so a fully-down gender
 * service can't flood the logs on every caller turn. Process-wide (the failure
 * is about the shared service, not any one call). One loud line per window.
 */
const SERVICE_DOWN_WARN_WINDOW_MS = 60_000;
let lastServiceDownWarnAt = 0;

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

export class GenderDetectorChained {
  /** Resolved gender once a model clears the threshold, null until then. */
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
   * Accumulates only — detection is triggered by runDetection(), not here.
   * Oldest audio is dropped once MAX_BYTES is exceeded to bound memory.
   */
  addSpeechChunk(pcm8k: Buffer): void {
    if (this.locked) return;
    this.chunks.push(pcm8k);
    this.accumulated += pcm8k.byteLength;
    while (this.accumulated > MAX_BYTES && this.chunks.length > 1) {
      const dropped = this.chunks.shift()!;
      this.accumulated -= dropped.byteLength;
    }
  }

  /**
   * Trigger a detection attempt (fire-and-forget — never blocks the caller).
   * Call this after each user speech turn ends.
   *
   * No-op if already locked, a detection is in flight, or not enough audio has
   * accumulated yet (< MIN_BYTES).
   */
  runDetection(): void {
    if (this.locked || this.detecting || this.accumulated < MIN_BYTES) return;
    this.detecting = true;
    const combined = Buffer.concat(this.chunks);
    this.log.info(
      { callId: this.callId, bytes: combined.byteLength, provider: "chained" },
      "Gender detection (wav2vec2-primary chain) firing",
    );
    this._detectChain(combined)
      .catch((err) => {
        this.log.warn({ callId: this.callId, err }, "GenderDetectorChained runDetection rejected unexpectedly");
      })
      .finally(() => { this.detecting = false; });
  }

  /**
   * Unlock gender so a new speaker on the line can be re-detected.
   * Clears locked state and buffers — used by Voice Memory on handoff.
   */
  resetForNewSpeaker(): void {
    this.locked = false;
    this.gender = null;
    this.chunks = [];
    this.accumulated = 0;
    this.detecting = false;
    this.log.info({ callId: this.callId, provider: "chained" }, "Gender detection reset for new speaker");
  }

  /** Try each model in order; lock on the first result ≥ CONFIDENCE_THRESHOLD. */
  private async _detectChain(pcm: Buffer): Promise<void> {
    const wavBuf = buildWav(pcm);

    // Track whether ANY model in the chain actually answered this turn. If every
    // model failed (timeout / network / non-200) the service is effectively down,
    // which is a production misconfig (GENDER_SERVICE_URL) — log it loudly with
    // the resolved URL, rate-limited so it can't flood the logs.
    let anyResponded = false;
    let lastFailure = "";

    for (const model of MODEL_CHAIN) {
      const res = await this._detectOne(model.url, model.name, wavBuf);
      if (!res) {
        lastFailure = `${model.name} did not respond`;
        continue; // timeout / error / unreachable — fall through
      }
      anyResponded = true;

      const { gender, confidence } = res;
      if ((gender === "male" || gender === "female") && confidence >= CONFIDENCE_THRESHOLD) {
        this.gender = gender;
        this.locked = true;
        this.chunks = []; // free memory
        this.log.info(
          { callId: this.callId, gender, confidence, model: model.name, bytes: pcm.byteLength, provider: "chained" },
          "Caller gender locked (chained detection)",
        );
        return;
      }

      this.log.info(
        { callId: this.callId, result: gender, confidence, model: model.name, provider: "chained" },
        "Gender model below threshold — falling through to next model",
      );
    }

    if (!anyResponded) {
      // Whole service unreachable — make this LOUD (not a silent neutral fall-through)
      // so the GENDER_SERVICE_URL / deployment misconfig is diagnosable from logs.
      const now = Date.now();
      if (now - lastServiceDownWarnAt >= SERVICE_DOWN_WARN_WINDOW_MS) {
        lastServiceDownWarnAt = now;
        this.log.warn(
          { callId: this.callId, resolvedUrl: BASE, reason: lastFailure || "all detection endpoints failed", provider: "chained" },
          "Gender service UNREACHABLE — every detection endpoint failed; caller salutation (Sir/Ma'am) will be neutral. Check GENDER_SERVICE_URL points at the running Voice Analysis service (this warning is rate-limited).",
        );
      }
      return;
    }

    this.log.info(
      { callId: this.callId, provider: "chained" },
      "No gender model cleared the confidence threshold this turn — keeping neutral, will retry next turn",
    );
  }

  /** POST one WAV to a single model with a hard timeout. Returns null on any failure. */
  private async _detectOne(
    url: string,
    name: string,
    wavBuf: Buffer,
  ): Promise<{ gender: string; confidence: number } | null> {
    try {
      const ab   = wavBuf.buffer.slice(wavBuf.byteOffset, wavBuf.byteOffset + wavBuf.byteLength) as ArrayBuffer;
      const blob = new Blob([ab], { type: "audio/wav" });
      const form = new FormData();
      form.append("file", blob, "caller.wav");

      const res = await fetch(url, {
        method: "POST",
        body:   form,
        signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
      });

      if (!res.ok) {
        this.log.warn({ callId: this.callId, model: name, url, status: res.status }, "Gender model returned non-200 — falling through");
        return null;
      }

      const json = await res.json() as { estimated_gender?: string; confidence?: number };
      return { gender: json.estimated_gender ?? "unknown", confidence: json.confidence ?? 0 };
    } catch (err) {
      // Timeout (AbortError) or network failure — fall through to the next model.
      this.log.warn({ callId: this.callId, model: name, url, err: (err as Error)?.name ?? String(err) }, "Gender model timed out / failed — falling through");
      return null;
    }
  }
}
