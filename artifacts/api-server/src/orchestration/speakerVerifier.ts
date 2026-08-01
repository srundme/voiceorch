/**
 * In-call Voice Memory verifier (ECAPA via gender-service).
 *
 * Phase 1 — Enroll: first ~2–4 s of caller speech → reference embedding
 * Phase 2 — Verify: every ~6 s of new caller-only speech → cosine vs reference
 * On handoff (score < VOICE_HANDOFF_THRESHOLD): notify pipeline callback.
 * On enroll: persist / match via voiceMemoryStore (cross-number person linking).
 *
 * Sampling is paused while the agent speaks / echo grace is active so TTS
 * echo never poisons the reference (critical on no-AEC telephony).
 *
 * Only runs when agentConfig.voiceMemoryEnabled is true.
 */

import { logger as rootLogger } from "../lib/logger.js";
import { writeExecutionLog } from "../services/execution-log.js";
import { genderServiceBaseUrl } from "./genderService.js";
import {
  VOICE_HANDOFF_THRESHOLD,
  VOICE_MATCH_THRESHOLD,
  upsertCallerVoiceprint,
} from "./voiceMemoryStore.js";

const SAMPLE_RATE = 8_000;
const SAMPLE_BYTES = 2;
const ENROLL_MS = Number(process.env["VOICE_MEMORY_ENROLL_MS"] ?? 2500);
/** Faster mid-call windows so a phone handoff is detected within ~1 turn, not after 20s of mixed speech. */
const VERIFY_MS = Number(process.env["VOICE_MEMORY_VERIFY_MS"] ?? 6_000);
const ENROLL_BYTES = Math.round((ENROLL_MS / 1000) * SAMPLE_RATE) * SAMPLE_BYTES;
const VERIFY_BYTES = Math.round((VERIFY_MS / 1000) * SAMPLE_RATE) * SAMPLE_BYTES;
/** Only adapt the reference when we are confident it's the same speaker (avoid poisoning on mixed audio). */
const VOICE_ADAPT_THRESHOLD = Number(process.env["VOICE_MEMORY_ADAPT_THRESHOLD"] ?? 0.85);
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
  private samplingPaused = false;
  /**
   * Running mean of all confident same-speaker embeddings this call (enroll
   * window + every strong verify window). The first call thus builds the
   * voiceprint from the FULL call's speech, not just the first 2.5s; the
   * refined mean is persisted once at call end via finalize().
   */
  private refSum: number[] | null = null;
  private refCount = 0;
  private refDirty = false;
  private finalized = false;
  /** Latched for the whole call — set on ANY handoff, never cleared, hard-blocks finalize(). */
  private hadAnyHandoff = false;
  /** Require two consecutive low scores before handoff (reduces noise false-positives). */
  private lowScoreStreak = 0;
  /** True once a cross-number voice link fired this call (enroll or refined re-match). */
  private linked = false;
  /** Last refCount at which a refined cross-number re-match ran (milestone gate). */
  private lastRematchRefCount = 1;
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

  /** One-shot latches so retry loops don't spam the call's Logs tab. */
  private execEmbedErrorLogged = false;
  private execVerifyErrorLogged = false;

  /** Per-call execution-log row (Call Log "Logs" tab). Never throws. */
  private execLog(status: import("../services/execution-log.js").ExecStatus, note: string, metadata: Record<string, unknown> = {}): void {
    writeExecutionLog(this.callId, this.agentId, "VoiceMemory", "response", {
      status,
      metadata: { note, ...metadata },
    });
  }

  /** Start sampling after greeting (same timing as gender detection). */
  arm(): void {
    if (this.armed) return;
    this.armed = true;
    this.log.info({ callId: this.callId }, "Voice Memory ARMED — sampling caller for enroll/verify");
    this.execLog("info", "Voice Memory armed — sampling caller speech for voiceprint enroll/verify");
  }

  /**
   * Pause while the agent is talking (or echo-grace is active). Carrier paths
   * feed TTS echo back into the mic — that must never enter enroll/verify
   * windows or the reference poisons and mid-call handoffs become invisible.
   */
  setSamplingPaused(paused: boolean): void {
    if (this.samplingPaused === paused) return;
    this.samplingPaused = paused;
    if (paused) {
      // Drop a half-built verify window that may already contain echo / speaker A.
      this.verifyChunks = [];
      this.verifyAccumulated = 0;
    }
  }

  /**
   * @param hasSpeech energy-VAD verdict for this frame from the pipeline.
   * Silence / carrier comfort-noise frames must never enter enroll or verify
   * windows: a window diluted with silence embeds as a "different voice"
   * (near-zero similarity) and fires false mid-call handoffs on the SAME
   * speaker (calls 5026/5028 — scores 0.28/-0.04 for one person talking).
   */
  addSpeechChunk(pcm8k: Buffer, hasSpeech: boolean): void {
    if (!this.armed || this.samplingPaused || !hasSpeech) return;
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
      // Continuous check: don't wait for turn end — run verify as soon as we
      // have a full caller-only window (phone handoffs mid-sentence).
      if (this.verifyAccumulated >= VERIFY_BYTES && !this.busy && !this.handoffFired) {
        this.tick();
      }
    } else if (this.accumulated >= ENROLL_BYTES && !this.busy) {
      this.tick();
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

  /**
   * Persist the refined full-call voiceprint at call end. No-op unless the
   * reference actually improved (>=1 strong verify window folded in) — the
   * enroll-time upsert already saved the initial print. Never persists after
   * a handoff fired (mixed speakers must not overwrite the caller's print).
   */
  async finalize(): Promise<void> {
    if (this.finalized) return;
    this.finalized = true;
    // Hard block after ANY handoff this call — resetForNewSpeaker() clears
    // handoffFired, so a re-enrolled second speaker must never be persisted
    // under the original caller's phone record.
    if (this.hadAnyHandoff) return;
    // Let an in-flight enroll/verify settle so we snapshot the latest mean
    // (bounded wait — never delay teardown by more than ~2s).
    const waitDeadline = Date.now() + 2_000;
    while (this.busy && Date.now() < waitDeadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (this.hadAnyHandoff) return;
    if (!this.enrolled || !this.refDirty || this.handoffFired) return;
    if (!this.phoneNumber || !this.reference?.length) return;
    try {
      await upsertCallerVoiceprint({
        agentId: this.agentId,
        phoneNumber: this.phoneNumber,
        embedding: this.reference,
      });
      this.log.info(
        { callId: this.callId, windows: this.refCount },
        "Voice Memory: persisted refined full-call voiceprint",
      );
    } catch (err) {
      this.log.warn({ callId: this.callId, err }, "Voice Memory: finalize persist failed");
    }
  }

  /** After confirmed handoff — re-enroll the new speaker as the reference. */
  resetForNewSpeaker(): void {
    this.reference = null;
    this.enrolled = false;
    this.handoffFired = false;
    this.lowScoreStreak = 0;
    this.nextEnrollAttemptAt = 0;
    this.refSum = null;
    this.refCount = 0;
    this.refDirty = false;
    // New speaker = new identity: clear the cross-number link latch and the
    // rematch milestone so speaker B gets fresh 2/4/8 rematch attempts.
    this.linked = false;
    this.lastRematchRefCount = 1;
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
    this.refSum = emb.slice();
    this.refCount = 1;
    this.refDirty = false;

    let personKey = "session-only";
    let linkedFromPhone: string | null = null;
    let score: number | null = null;
    let nearMiss: { score: number; phoneNumber: string } | null = null;
    if (this.phoneNumber) {
      const saved = await upsertCallerVoiceprint({
        agentId: this.agentId,
        phoneNumber: this.phoneNumber,
        embedding: emb,
      });
      personKey = saved.personKey;
      linkedFromPhone = saved.linkedFromPhone;
      score = saved.score;
      nearMiss = saved.nearMiss;
    }
    this.linked = !!linkedFromPhone;

    this.log.info(
      { callId: this.callId, bytes: pcm.byteLength, linked: !!linkedFromPhone },
      "Voice Memory: enrolled reference voiceprint",
    );
    this.execLog(
      "success",
      linkedFromPhone
        ? `Voiceprint enrolled — same voice recognized from another number (${linkedFromPhone})`
        : nearMiss
          ? `Voiceprint enrolled — a similar voice exists on ${nearMiss.phoneNumber} but scored ${nearMiss.score.toFixed(2)}, below the ${VOICE_MATCH_THRESHOLD} match bar (will retry with a refined voiceprint as the call goes on)`
          : "Voiceprint enrolled for this caller",
      { personKey, linkedFromPhone, score, nearMiss },
    );
    this.onEvent({ type: "enrolled", personKey, linkedFromPhone, score });
  }

  /**
   * Cross-number re-match with the refined running-mean voiceprint. The
   * 2.5s enroll window is the weakest sample of the whole call — two different
   * handsets often score just under the match bar on it (calls 5029-5031).
   * As strong verify windows fold into the reference, retry the match at
   * refCount milestones; a late link still lets the live call pick up the
   * matched person's memory via the same "enrolled" event path.
   */
  private async attemptRefinedRematch(): Promise<void> {
    if (this.linked || !this.phoneNumber || !this.reference?.length) return;
    try {
      const saved = await upsertCallerVoiceprint({
        agentId: this.agentId,
        phoneNumber: this.phoneNumber,
        embedding: this.reference,
      });
      this.refDirty = false; // just persisted the current mean
      if (saved.linkedFromPhone) {
        this.linked = true;
        this.log.info(
          { callId: this.callId, linkedFromPhone: saved.linkedFromPhone, score: saved.score, windows: this.refCount },
          "Voice Memory: refined voiceprint matched another number mid-call",
        );
        this.execLog(
          "success",
          `Same voice recognized from another number (${saved.linkedFromPhone}) after voiceprint refinement`,
          { personKey: saved.personKey, linkedFromPhone: saved.linkedFromPhone, score: saved.score, windows: this.refCount },
        );
        this.onEvent({
          type: "enrolled",
          personKey: saved.personKey,
          linkedFromPhone: saved.linkedFromPhone,
          score: saved.score,
        });
      } else if (saved.nearMiss) {
        this.log.info(
          { callId: this.callId, nearMiss: saved.nearMiss, windows: this.refCount },
          "Voice Memory: refined re-match still below match bar",
        );
        // Exec-log so user-downloadable call logs show the retry trail —
        // logger.info alone is server-console-only (calls 4980-4982 were
        // undiagnosable without it).
        this.execLog(
          "info",
          `Refined voiceprint re-match (window ${this.refCount}) still below the match bar — best candidate ${saved.nearMiss.phoneNumber} scored ${saved.nearMiss.score.toFixed(2)}`,
          { nearMiss: saved.nearMiss, windows: this.refCount },
        );
      }
    } catch (err) {
      this.log.warn({ callId: this.callId, err }, "Voice Memory: refined re-match failed");
      this.execLog(
        "error",
        `Refined voiceprint re-match failed: ${err instanceof Error ? err.message : String(err)}`,
        { windows: this.refCount },
      );
    }
  }

  private async verify(pcm: Buffer): Promise<void> {
    if (!this.reference) return;
    const result = await this.fetchVerify(pcm, this.reference);
    if (result.similarity == null) return;
    this.log.info(
      { callId: this.callId, similarity: result.similarity, threshold: VOICE_HANDOFF_THRESHOLD },
      "Voice Memory: verify window scored",
    );
    if (result.similarity < VOICE_HANDOFF_THRESHOLD) {
      this.lowScoreStreak++;
      // Require persistence — false handoffs mute the line with a forced
      // "who is speaking?" challenge when the same caller briefly mismatches
      // (noise, distance, codec). Call 2626 fired on short “Hello…” / Tamil talk
      // overlaps — need a longer streak and a deeper single-shot cliff.
      // A single deep-low window is no longer enough (false handoffs on the
      // same speaker, calls 5026/5028): even speech-only windows can score low
      // on short bursts/noise. Require TWO consecutive deep-low windows for the
      // fast path; the 5-window streak stays as the slow path.
      const definite = result.similarity < VOICE_HANDOFF_THRESHOLD - 0.22;
      if (!this.handoffFired && ((definite && this.lowScoreStreak >= 2) || this.lowScoreStreak >= 5)) {
        this.handoffFired = true;
        this.hadAnyHandoff = true;
        this.execLog("info", "Different voice detected mid-call — speaker handoff", {
          similarity: result.similarity,
          threshold: VOICE_HANDOFF_THRESHOLD,
        });
        this.onEvent({ type: "handoff", similarity: result.similarity });
      }
    } else {
      this.lowScoreStreak = 0;
      if (
        result.embedding?.length
        && result.similarity >= VOICE_ADAPT_THRESHOLD
      ) {
        // Only adapt on strong same-speaker matches — mixed two-person audio
        // must not slowly rewrite the reference toward the second speaker.
        // Fold the window into a running mean so the voiceprint converges on
        // the whole call's speech instead of hopping to the latest window.
        if (this.refSum && this.refSum.length === result.embedding.length) {
          for (let i = 0; i < this.refSum.length; i++) {
            this.refSum[i]! += result.embedding[i]!;
          }
          this.refCount++;
          this.reference = this.refSum.map((v) => v / this.refCount);
          this.refDirty = true;
          // Retry the cross-number match with the refined mean at doubling
          // milestones (2, 4, 8, ...) — the enroll-window match often lands
          // just under the bar across two different handsets.
          if (!this.linked && this.phoneNumber && this.refCount >= this.lastRematchRefCount * 2) {
            this.lastRematchRefCount = this.refCount;
            void this.attemptRefinedRematch();
          }
        } else {
          this.reference = result.embedding;
        }
      }
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
        if (!this.execEmbedErrorLogged) {
          this.execEmbedErrorLogged = true;
          this.execLog("error", `Voice analysis service rejected the enroll request (HTTP ${res.status}) — voiceprint not created`, { httpStatus: res.status });
        }
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
        if (!this.execEmbedErrorLogged) {
          this.execEmbedErrorLogged = true;
          this.execLog("error", "Voice analysis service returned no voiceprint (speaker model not ready?) — voiceprint not created", { error: body.error ?? "empty_embedding" });
        }
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
      if (!this.execEmbedErrorLogged) {
        this.execEmbedErrorLogged = true;
        this.execLog("error", "Voice analysis service unreachable — voiceprint not created (check GENDER_SERVICE_URL / service health)", { errName: (err as Error)?.name, errMsg: (err as Error)?.message });
      }
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
      if (!this.execVerifyErrorLogged) {
        this.execVerifyErrorLogged = true;
        this.execLog("error", "Voice analysis service unreachable during mid-call verification", { errName: (err as Error)?.name, errMsg: (err as Error)?.message });
      }
      return { similarity: null, embedding: null };
    }
  }
}
