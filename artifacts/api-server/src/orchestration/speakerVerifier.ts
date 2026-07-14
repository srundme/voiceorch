/**
 * In-call Voice Memory verifier (ECAPA via gender-service).
 *
 * Phase 1 — Enroll: first ~2–4 s of caller speech → reference embedding
 * Phase 2 — Verify: every ~20 s of new caller speech → cosine vs reference
 * On handoff (score < VOICE_HANDOFF_THRESHOLD): notify pipeline callback.
 * On enroll: persist / match via voiceMemoryStore (cross-number person linking).
 *
 * Only runs when agentConfig.voiceMemoryEnabled is true.
 */

import { logger as rootLogger } from "../lib/logger.js";
import { genderServiceBaseUrl } from "./genderService.js";
import {
  VOICE_HANDOFF_THRESHOLD,
  upsertCallerVoiceprint,
} from "./voiceMemoryStore.js";

const SAMPLE_RATE = 8_000;
const SAMPLE_BYTES = 2;
const ENROLL_MS = Number(process.env["VOICE_MEMORY_ENROLL_MS"] ?? 2500);
const VERIFY_MS = Number(process.env["VOICE_MEMORY_VERIFY_MS"] ?? 20_000);
const ENROLL_BYTES = Math.round((ENROLL_MS / 1000) * SAMPLE_RATE) * SAMPLE_BYTES;
const VERIFY_BYTES = Math.round((VERIFY_MS / 1000) * SAMPLE_RATE) * SAMPLE_BYTES;
const MAX_BYTES = 12 * SAMPLE_RATE * SAMPLE_BYTES;
/** ECAPA on CPU often needs >2.5s (cold load much longer). Gender health ≠ speaker ready. */
const REQUEST_TIMEOUT_MS = Number(process.env["VOICE_MEMORY_REQUEST_TIMEOUT_MS"] ?? 20_000);
/** Spacing between failed enroll retries so we don't spam the gender-service. */
const ENROLL_RETRY_BACKOFF_MS = Number(process.env["VOICE_MEMORY_ENROLL_RETRY_MS"] ?? 5_000);

function buildWav(pcmData: Buffer): Buffer {
  const dataLen = pcmData.byteLength;
  const byteRate = SAMPLE_RATE * SAMPLE_BYTES;
  const hdr = Buffer.alloc(44);
  hdr.write("RIFF", 0, "ascii");
  hdr.writeUInt32LE(36 + dataLen, 4);
  hdr.write("WAVE", 8, "ascii");
  hdr.write("fmt ", 12, "ascii");
  hdr.writeUInt32LE(16, 16);
  hdr.writeUInt16LE(1, 20);
  hdr.writeUInt16LE(1, 22);
  hdr.writeUInt32LE(SAMPLE_RATE, 24);
  hdr.writeUInt32LE(byteRate, 28);
  hdr.writeUInt16LE(SAMPLE_BYTES, 32);
  hdr.writeUInt16LE(16, 34);
  hdr.write("data", 36, "ascii");
  hdr.writeUInt32LE(dataLen, 40);
  return Buffer.concat([hdr, pcmData]);
}

export type VoiceMemoryEvent =
  | {
      type: "enrolled";
      personKey: string;
      linkedFromPhone: string | null;
      score: number | null;
    }
  | {
      type: "handoff";
      similarity: number;
    };

export class SpeakerVerifier {
  private chunks: Buffer[] = [];
  private accumulated = 0;
  private verifyChunks: Buffer[] = [];
  private verifyAccumulated = 0;
  private reference: number[] | null = null;
  private enrolled = false;
  private busy = false;
  private armed = false;
  private handoffFired = false;
  private nextEnrollAttemptAt = 0;
  private readonly callId: number;
  private readonly agentId: number;
  private readonly phoneNumber: string | null;
  private readonly onEvent: (ev: VoiceMemoryEvent) => void;
  private readonly log: typeof rootLogger;

  constructor(opts: {
    callId: number;
    agentId: number;
    phoneNumber: string | null;
    onEvent: (ev: VoiceMemoryEvent) => void;
  }) {
    this.callId = opts.callId;
    this.agentId = opts.agentId;
    this.phoneNumber = opts.phoneNumber;
    this.onEvent = opts.onEvent;
    this.log = rootLogger;
  }

  /** Start sampling after greeting (same timing as gender detection). */
  arm(): void {
    if (this.armed) return;
    this.armed = true;
    this.log.info({ callId: this.callId }, "Voice Memory ARMED — sampling caller for enroll/verify");
  }

  addSpeechChunk(pcm8k: Buffer): void {
    if (!this.armed) return;
    this.chunks.push(pcm8k);
    this.accumulated += pcm8k.byteLength;
    while (this.accumulated > MAX_BYTES && this.chunks.length > 1) {
      const dropped = this.chunks.shift()!;
      this.accumulated -= dropped.byteLength;
    }
    if (this.enrolled) {
      this.verifyChunks.push(pcm8k);
      this.verifyAccumulated += pcm8k.byteLength;
      while (this.verifyAccumulated > VERIFY_BYTES * 2 && this.verifyChunks.length > 1) {
        const dropped = this.verifyChunks.shift()!;
        this.verifyAccumulated -= dropped.byteLength;
      }
    }
  }

  /** Call after each confirmed user turn (non-blocking). */
  tick(): void {
    if (!this.armed || this.busy) return;
    if (!this.enrolled) {
      if (this.accumulated < ENROLL_BYTES) return;
      if (Date.now() < this.nextEnrollAttemptAt) return;
      this.busy = true;
      void this.enroll()
        .catch((err) => this.log.warn({ callId: this.callId, err }, "Voice Memory enroll failed"))
        .finally(() => { this.busy = false; });
      return;
    }
    if (this.handoffFired) return;
    if (this.verifyAccumulated < VERIFY_BYTES) return;
    this.busy = true;
    const window = Buffer.concat(this.verifyChunks);
    this.verifyChunks = [];
    this.verifyAccumulated = 0;
    void this.verify(window)
      .catch((err) => this.log.warn({ callId: this.callId, err }, "Voice Memory verify failed"))
      .finally(() => { this.busy = false; });
  }

  /** After confirmed handoff — re-enroll the new speaker as the reference. */
  resetForNewSpeaker(): void {
    this.reference = null;
    this.enrolled = false;
    this.handoffFired = false;
    this.nextEnrollAttemptAt = 0;
    this.chunks = [];
    this.accumulated = 0;
    this.verifyChunks = [];
    this.verifyAccumulated = 0;
    this.log.info({ callId: this.callId }, "Voice Memory: reset reference for new speaker");
  }

  private async enroll(): Promise<void> {
    const pcm = Buffer.concat(this.chunks);
    const emb = await this.fetchEmbed(pcm);
    if (!emb?.length) {
      this.nextEnrollAttemptAt = Date.now() + ENROLL_RETRY_BACKOFF_MS;
      return;
    }
    this.reference = emb;
    this.enrolled = true;
    this.nextEnrollAttemptAt = 0;

    let personKey = "session-only";
    let linkedFromPhone: string | null = null;
    let score: number | null = null;
    if (this.phoneNumber) {
      const saved = await upsertCallerVoiceprint({
        agentId: this.agentId,
        phoneNumber: this.phoneNumber,
        embedding: emb,
      });
      personKey = saved.personKey;
      linkedFromPhone = saved.linkedFromPhone;
      score = saved.score;
    }

    this.log.info(
      { callId: this.callId, bytes: pcm.byteLength, linked: !!linkedFromPhone },
      "Voice Memory: enrolled reference voiceprint",
    );
    this.onEvent({ type: "enrolled", personKey, linkedFromPhone, score });
  }

  private async verify(pcm: Buffer): Promise<void> {
    if (!this.reference) return;
    const result = await this.fetchVerify(pcm, this.reference);
    if (result.similarity == null) return;
    this.log.info(
      { callId: this.callId, similarity: result.similarity, threshold: VOICE_HANDOFF_THRESHOLD },
      "Voice Memory: verify window scored",
    );
    if (result.similarity < VOICE_HANDOFF_THRESHOLD && !this.handoffFired) {
      this.handoffFired = true;
      this.onEvent({ type: "handoff", similarity: result.similarity });
    } else if (result.embedding?.length && result.similarity >= VOICE_HANDOFF_THRESHOLD) {
      // Slowly adapt reference toward recent same-speaker audio
      this.reference = result.embedding;
    }
  }

  private async fetchEmbed(pcm: Buffer): Promise<number[] | null> {
    const base = genderServiceBaseUrl();
    const url = `${base}/voice-analysis/speaker/embed`;
    const wav = buildWav(pcm);
    const ab   = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer;
    const blob = new Blob([ab], { type: "audio/wav" });
    const form = new FormData();
    form.append("file", blob, "enroll.wav");
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        this.log.warn(
          { callId: this.callId, url, status: res.status, latencyMs: Date.now() - t0 },
          "Voice Memory: embed request non-200",
        );
        return null;
      }
      const body = (await res.json()) as { embedding?: number[] | null; error?: string };
      if (!body.embedding?.length) {
        this.log.warn(
          {
            callId: this.callId,
            url,
            error: body.error ?? "empty_embedding",
            latencyMs: Date.now() - t0,
          },
          "Voice Memory: embed returned no embedding — check gender-service /speaker/health (ECAPA)",
        );
        return null;
      }
      return body.embedding;
    } catch (err) {
      this.log.warn(
        {
          callId: this.callId,
          url,
          errName: (err as Error)?.name,
          errMsg: (err as Error)?.message,
          timeoutMs: REQUEST_TIMEOUT_MS,
          latencyMs: Date.now() - t0,
        },
        "Voice Memory: embed request failed",
      );
      return null;
    }
  }

  private async fetchVerify(
    pcm: Buffer,
    reference: number[],
  ): Promise<{ similarity: number | null; embedding: number[] | null }> {
    const base = genderServiceBaseUrl();
    const url = `${base}/voice-analysis/speaker/verify`;
    const wav = buildWav(pcm);
    const ab   = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer;
    const blob = new Blob([ab], { type: "audio/wav" });
    const form = new FormData();
    form.append("file", blob, "verify.wav");
    form.append("reference_embedding", JSON.stringify(reference));
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        this.log.warn(
          { callId: this.callId, url, status: res.status, latencyMs: Date.now() - t0 },
          "Voice Memory: verify request non-200",
        );
        return { similarity: null, embedding: null };
      }
      const body = (await res.json()) as {
        similarity?: number | null;
        embedding?: number[] | null;
        error?: string;
      };
      return {
        similarity: typeof body.similarity === "number" ? body.similarity : null,
        embedding: body.embedding ?? null,
      };
    } catch (err) {
      this.log.warn(
        {
          callId: this.callId,
          url,
          errName: (err as Error)?.name,
          errMsg: (err as Error)?.message,
          timeoutMs: REQUEST_TIMEOUT_MS,
          latencyMs: Date.now() - t0,
        },
        "Voice Memory: verify request failed",
      );
      return { similarity: null, embedding: null };
    }
  }
}
