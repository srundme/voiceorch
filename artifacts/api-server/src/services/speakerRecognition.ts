/**
 * Local speaker recognition — voice fingerprinting, cross-number caller identity,
 * and mid-call speaker change detection.
 *
 * Replaces Azure Speaker Recognition (Limited Access / blocked) with a local
 * SpeechBrain ECAPA-TDNN model running inside the gender-service (port 5000).
 *
 * Model: speechbrain/spkrec-ecapa-voxceleb — 192-dim d-vector embeddings.
 * No external API keys or cloud access required.
 *
 * Endpoints used:
 *   POST /voice-analysis/speaker/embed  → { embedding: number[] }
 *
 * Usage flow:
 *   1. At call start: buffer caller audio for IDENT_BUFFER_SECONDS
 *   2. Extract embedding and compare (cosine similarity) against all enrolled
 *      profiles for this agent → cross-number identity match
 *   3. At call end: enroll by averaging new embedding into stored profile
 *   4. Speaker-change detection: compare each 5-second window against stored
 *      own embedding; two consecutive low-score windows = change event
 */

import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db, voicePrintsTable } from "@workspace/db";
import { pcmToWav, decodeMulaw } from "../orchestration/audio.js";
import { logger } from "../lib/logger.js";

// ── Constants ────────────────────────────────────────────────────────────────

/** Seconds of caller audio to buffer before attempting identification */
const IDENT_BUFFER_SECONDS = 8;
/** Minimum cosine similarity (0–1) to accept a cross-number voice match */
const IDENT_MIN_CONFIDENCE = 0.5;
/** Target enrolled seconds — stop enrolling once this is reached */
const ENROLL_TARGET_SECONDS = 60;
/** Minimum seconds of new audio to bother embedding for enrollment */
const ENROLL_MIN_NEW_SECONDS = 5;
/** Seconds of caller audio window for mid-call speaker change verification */
const CHANGE_WINDOW_SECONDS = 5;
/**
 * Cosine similarity below this for 2+ consecutive windows → speaker change.
 * Lowered from 0.4: same-room/same-mic conditions make different-speaker
 * similarities higher than expected; 0.3 gives cleaner separation.
 */
const CHANGE_MIN_CONFIDENCE = 0.3;
/** Weight given to the existing averaged embedding vs new enrollment audio */
const ENROLL_BLEND_WEIGHT = 0.7;

// ── Voice service ────────────────────────────────────────────────────────────

const VOICE_SERVICE_BASE = "http://localhost:5000";

/**
 * POST audio bytes to the local ECAPA-TDNN endpoint and return the 192-dim embedding.
 * Audio must be a valid WAV buffer (PCM 8 kHz or 16 kHz mono).
 */
async function extractEmbedding(wavBuffer: Buffer): Promise<number[]> {
  const boundary = `VPrint${Date.now()}`;
  const header = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="audio.wav"\r\n` +
    `Content-Type: audio/wav\r\n\r\n`,
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([header, wavBuffer, footer]);

  const res = await fetch(`${VOICE_SERVICE_BASE}/voice-analysis/speaker/embed`, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`speaker embed ${res.status}: ${text}`);
  }
  const json = await res.json() as { embedding: number[] };
  return json.embedding;
}

// ── Math helpers ─────────────────────────────────────────────────────────────

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na  += a[i]! * a[i]!;
    nb  += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Weighted blend of an existing enrolled embedding with a new one.
 * Keeps more of the accumulated history (existingWeight = 0.7 by default).
 */
function blendEmbeddings(existing: number[], incoming: number[], existingWeight = ENROLL_BLEND_WEIGHT): number[] {
  return existing.map((v, i) => v * existingWeight + incoming[i]! * (1 - existingWeight));
}

// ── DB helpers ───────────────────────────────────────────────────────────────

function parseEmbedding(raw: string | null | undefined): number[] | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as number[]; } catch { return null; }
}

async function upsertVoicePrint(agentId: number, phoneNumber: string): Promise<string> {
  const existing = await db
    .select()
    .from(voicePrintsTable)
    .where(and(eq(voicePrintsTable.agentId, agentId), eq(voicePrintsTable.phoneNumber, phoneNumber)));

  if (existing[0]) return existing[0].azureProfileId;

  const profileId = randomUUID();
  await db
    .insert(voicePrintsTable)
    .values({ agentId, phoneNumber, azureProfileId: profileId })
    .onConflictDoNothing();
  return profileId;
}

async function updateEnrollment(
  profileId: string,
  embedding: number[],
  newSpeechSeconds: number,
  currentSeconds: number,
): Promise<void> {
  const total = currentSeconds + newSpeechSeconds;
  await db
    .update(voicePrintsTable)
    .set({
      enrollmentStatus:        "Enrolled",
      enrollmentSpeechSeconds: total,
      embedding:               JSON.stringify(embedding),
      updatedAt:               new Date(),
    })
    .where(eq(voicePrintsTable.azureProfileId, profileId));
}

// ── Health / connectivity test ───────────────────────────────────────────────

/**
 * Test connectivity to the local ECAPA-TDNN speaker recognition service.
 * Returns { ok: true } when the gender-service is up and the model is loaded,
 * or { ok: false, error } when unreachable or model not yet warmed up.
 *
 * (Previously tested Azure Speaker Recognition — replaced by local model.)
 */
export async function testAzureConnection(): Promise<
  | { ok: true; region: string }
  | { ok: false; region: string | null; status?: number; error: string }
> {
  try {
    const res = await fetch(`${VOICE_SERVICE_BASE}/voice-analysis/speaker/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      return { ok: false, region: null, status: res.status, error: `Health check HTTP ${res.status}` };
    }
    const json = await res.json() as { model: string; loaded: boolean };
    if (!json.loaded) {
      return { ok: false, region: "local", error: "Model still loading — try again in ~30 s after first start" };
    }
    return { ok: true, region: "local (ECAPA-TDNN)" };
  } catch (err) {
    return { ok: false, region: null, error: `Gender service unreachable: ${String(err)}` };
  }
}

// ── Audio conversion ──────────────────────────────────────────────────────────

/** Convert raw PCM8k (LINEAR16) to a proper WAV buffer for the embedding endpoint. */
function toWav8k(pcm8k: Buffer): Buffer {
  return pcmToWav(pcm8k, 8000, 1, 16);
}

// ── Public VoiceIntelSession ──────────────────────────────────────────────────

export interface VoiceIdResult {
  /** Phone number of the matched known caller */
  matchedPhone: string;
  /** Cosine similarity score (0–1) */
  confidence: number;
  /** Display name if available */
  name: string | null;
}

/**
 * Per-call voice intelligence session.
 *
 * Usage (telephony path):
 *   const vi = new VoiceIntelSession(agentId, callerPhone);
 *   pipeline config: callerAudioTap = (buf) => vi.addChunk(buf)
 *   at call end: await vi.finalise(callerPhone)
 *
 * Usage (webcall path): same, but drive addChunk from webcall's pcm8k tap.
 */
export class VoiceIntelSession {
  private readonly agentId: number;
  private readonly callerPhone: string | null;

  /** Accumulated 8 kHz PCM chunks (caller side only) */
  private chunks: Buffer[] = [];
  private totalSeconds = 0;

  /** Identification fired once after IDENT_BUFFER_SECONDS */
  private identFired = false;
  private identResult: VoiceIdResult | null = null;
  private identPromise: Promise<void> | null = null;

  /** Speaker-change detection — chunks collected since last window flush */
  private changeWindowChunks: Buffer[] = [];
  private changeWindowSeconds = 0;
  /** Number of consecutive windows that scored below threshold */
  private changeLowWindows = 0;
  /** Callback fired when a likely speaker change is detected */
  onSpeakerChange?: () => void;

  /**
   * The caller's own stored ECAPA embedding (set during runIdentification).
   * Used for mid-call speaker-change detection.
   */
  private ownEmbedding: number[] | null = null;

  constructor(agentId: number, callerPhone: string | null) {
    this.agentId     = agentId;
    this.callerPhone = callerPhone;
  }

  /**
   * True once the reference embedding has been extracted from the caller's audio.
   * Used by webcall.ts to know when to relax the !speaking gate and allow all
   * frames through so speaker-change windows can accumulate quickly enough.
   */
  hasOwnEmbedding(): boolean {
    return this.ownEmbedding !== null;
  }

  // ── Audio ingestion ─────────────────────────────────────────────────────────

  /**
   * Feed a raw 8 kHz LINEAR16 PCM chunk from the caller.
   * Telephony adapters pass linear16 PCM directly; mulaw callers must decode first.
   */
  addChunk(pcm8k: Buffer): void {
    this.chunks.push(pcm8k);
    const chunkSec = pcm8k.length / (8000 * 2);
    this.totalSeconds += chunkSec;

    // Fire identification once after enough audio has accumulated
    if (!this.identFired && this.totalSeconds >= IDENT_BUFFER_SECONDS) {
      this.identFired  = true;
      this.identPromise = this.runIdentification();
    }

    // Speaker-change detection window (only once we have own embedding)
    if (this.ownEmbedding) {
      this.changeWindowChunks.push(pcm8k);
      this.changeWindowSeconds += chunkSec;
      if (this.changeWindowSeconds >= CHANGE_WINDOW_SECONDS) {
        const window = Buffer.concat(this.changeWindowChunks);
        this.changeWindowChunks   = [];
        this.changeWindowSeconds  = 0;
        void this.checkSpeakerChange(window);
      }
    }
  }

  /** Add a mulaw-encoded chunk (Plivo/Twilio path). Decodes before buffering. */
  addMulawChunk(mulaw: Buffer): void {
    this.addChunk(decodeMulaw(mulaw));
  }

  // ── Identification ──────────────────────────────────────────────────────────

  private async runIdentification(): Promise<void> {
    try {
      // Fetch all enrolled profiles for this agent that have a stored embedding
      const prints = await db
        .select()
        .from(voicePrintsTable)
        .where(
          and(
            eq(voicePrintsTable.agentId, this.agentId),
            eq(voicePrintsTable.enrollmentStatus, "Enrolled"),
          )
        );

      // Always extract a fresh embedding from THIS call's first 8 s of audio.
      // Using the live audio (same mic, same room) as the reference for
      // speaker-change detection is far more accurate than a stored embedding
      // from a previous call where room/mic conditions may differ.
      const wav = toWav8k(Buffer.concat(this.chunks));
      const queryEmbedding = await extractEmbedding(wav);

      // Set own embedding from fresh audio — overrides any stored embedding.
      // This is the reference we compare every 5-second window against.
      this.ownEmbedding = queryEmbedding;

      if (prints.length === 0) return;

      // Candidates = enrolled callers other than the current one
      const candidates = prints.filter(p => p.phoneNumber !== this.callerPhone);
      if (candidates.length === 0) return;

      // Only candidates with a stored embedding can be compared
      const withEmbeddings = candidates
        .map(p => ({ print: p, embedding: parseEmbedding(p.embedding) }))
        .filter((x): x is { print: typeof prints[0]; embedding: number[] } => x.embedding !== null);

      if (withEmbeddings.length === 0) return;

      // Find best cosine similarity match
      let best: { print: typeof prints[0]; similarity: number } | null = null;
      for (const { print, embedding } of withEmbeddings) {
        const sim = cosineSim(queryEmbedding, embedding);
        if (!best || sim > best.similarity) {
          best = { print, similarity: sim };
        }
      }

      if (!best || best.similarity < IDENT_MIN_CONFIDENCE) return;

      this.identResult = {
        matchedPhone: best.print.phoneNumber,
        confidence:   best.similarity,
        name:         null,
      };

      await db
        .update(voicePrintsTable)
        .set({ lastIdentifiedAt: new Date(), lastConfidenceScore: best.similarity, updatedAt: new Date() })
        .where(eq(voicePrintsTable.id, best.print.id));

      logger.info(
        {
          agentId:      this.agentId,
          callerPhone:  this.callerPhone,
          matchedPhone: best.print.phoneNumber,
          confidence:   best.similarity,
        },
        "Voice intelligence: cross-number identity match",
      );
    } catch (err) {
      logger.warn({ agentId: this.agentId, err }, "Voice intelligence: identification failed");
    }
  }

  /** Returns the identification result, or null if not yet complete / no match. */
  getIdentResult(): VoiceIdResult | null {
    return this.identResult;
  }

  // ── Speaker change detection ────────────────────────────────────────────────

  private async checkSpeakerChange(window: Buffer): Promise<void> {
    if (!this.ownEmbedding) return;
    try {
      const wav = toWav8k(window);
      const windowEmbedding = await extractEmbedding(wav);
      const sim = cosineSim(windowEmbedding, this.ownEmbedding);
      logger.debug({ agentId: this.agentId, similarity: sim, threshold: CHANGE_MIN_CONFIDENCE, lowWindows: this.changeLowWindows }, "Voice intel: speaker-change window similarity");

      if (sim < CHANGE_MIN_CONFIDENCE) {
        this.changeLowWindows++;
        if (this.changeLowWindows >= 2) {
          this.changeLowWindows = 0;
          logger.info({ agentId: this.agentId, similarity: sim }, "Voice intelligence: speaker change detected");
          this.onSpeakerChange?.();
        }
      } else {
        this.changeLowWindows = 0;
      }
    } catch (err) {
      logger.debug({ err }, "Voice intelligence: speaker change check failed (non-fatal)");
    }
  }

  // ── Enrollment ──────────────────────────────────────────────────────────────

  /**
   * Enroll accumulated audio for the given phone number.
   * Call at the end of a call to progressively build up voice prints.
   * Safe to call even if audio is too short — skips if below minimum.
   *
   * Subsequent enrollments blend the new embedding with the stored one so the
   * profile improves with each call rather than being overwritten.
   */
  async enroll(phoneNumber: string): Promise<void> {
    if (this.totalSeconds < ENROLL_MIN_NEW_SECONDS) return;

    try {
      // Look up or create the voice print row
      const existing = await db
        .select()
        .from(voicePrintsTable)
        .where(
          and(
            eq(voicePrintsTable.agentId,     this.agentId),
            eq(voicePrintsTable.phoneNumber, phoneNumber),
          )
        );
      const print = existing[0];

      // Already fully enrolled — no need to keep blending
      if (print && (print.enrollmentSpeechSeconds ?? 0) >= ENROLL_TARGET_SECONDS) return;

      // Get or create the profile row
      const profileId = await upsertVoicePrint(this.agentId, phoneNumber);

      // Extract embedding from this call's audio
      const wav = toWav8k(Buffer.concat(this.chunks));
      const newEmbedding = await extractEmbedding(wav);

      // Blend with existing embedding if one is stored
      const existingEmbedding = parseEmbedding(print?.embedding);
      const finalEmbedding = existingEmbedding
        ? blendEmbeddings(existingEmbedding, newEmbedding)
        : newEmbedding;

      // Also keep this in memory for speaker-change detection this call
      if (phoneNumber === this.callerPhone) {
        this.ownEmbedding = finalEmbedding;
      }

      const currentSeconds = print?.enrollmentSpeechSeconds ?? 0;
      await updateEnrollment(profileId, finalEmbedding, this.totalSeconds, currentSeconds);

      logger.info(
        {
          agentId:     this.agentId,
          phoneNumber,
          profileId,
          addedSeconds: this.totalSeconds,
          totalSeconds: currentSeconds + this.totalSeconds,
          firstEnroll:  !existingEmbedding,
        },
        "Voice intelligence: enrollment updated",
      );
    } catch (err) {
      logger.warn({ agentId: this.agentId, phoneNumber, err }, "Voice intelligence: enrollment failed (non-fatal)");
    }
  }

  /** Wait for any in-flight identification to settle (at call end). */
  async waitForIdent(): Promise<void> {
    if (this.identPromise) await this.identPromise.catch(() => {});
  }
}
