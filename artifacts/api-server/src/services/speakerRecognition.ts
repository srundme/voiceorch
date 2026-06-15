/**
 * Azure Speaker Recognition integration — voice fingerprinting, cross-number
 * caller identity, and mid-call speaker change detection.
 *
 * Azure Cognitive Services Speaker Recognition v2.0 (text-independent):
 *   - Profile create / enroll / identify endpoints
 *   - Identification is async → we poll with a configurable timeout
 *   - Requires WAV audio (PCM 16-bit, mono, 8 kHz or 16 kHz)
 *
 * NOTE: The v1.0 "cognitiveservices/v1.0" endpoint was retired by Microsoft.
 *       This file uses the v2.0 text-independent API.
 *       v2.0 base: https://{region}.api.cognitive.microsoft.com/speaker/identification/v2.0/text-independent
 *
 * Usage flow:
 *   1. At call start: buffer caller audio for IDENT_BUFFER_SECONDS
 *   2. Submit identification against all profiles for this agent
 *   3. If matched with confidence ≥ IDENT_MIN_CONFIDENCE → cross-number identity found
 *   4. At call end: if this caller has < ENROLL_TARGET_SECONDS enrolled, enroll from call audio
 */

import { and, eq, inArray } from "drizzle-orm";
import { db, platformSettingsTable, voicePrintsTable } from "@workspace/db";
import { pcmToWav, decodeMulaw } from "../orchestration/audio.js";
import { logger } from "../lib/logger.js";

// ── Constants ────────────────────────────────────────────────────────────────

/** Seconds of caller audio to buffer before attempting identification */
const IDENT_BUFFER_SECONDS = 8;
/** Minimum confidence score (0–1) to accept a cross-number voice match */
const IDENT_MIN_CONFIDENCE = 0.5;
/** Target enrolled seconds — stop enrolling once this is reached */
const ENROLL_TARGET_SECONDS = 60;
/** Minimum seconds of new audio to bother sending for enrollment */
const ENROLL_MIN_NEW_SECONDS = 5;
/** How long to poll for async identification result (ms) */
const IDENT_POLL_TIMEOUT_MS = 15_000;
/** Polling interval (ms) */
const IDENT_POLL_INTERVAL_MS = 1_000;
/** Seconds of caller audio window for mid-call speaker change verification */
const CHANGE_WINDOW_SECONDS = 5;
/** Confidence below this triggers a speaker-change flag */
const CHANGE_MIN_CONFIDENCE = 0.4;

// ── Azure credentials ─────────────────────────────────────────────────────────

async function getAzureCreds(): Promise<{ key: string; region: string } | null> {
  const rows = await db
    .select()
    .from(platformSettingsTable)
    .where(
      inArray(platformSettingsTable.key, [
        "managed_azure_speech_key",
        "managed_azure_speech_region",
      ])
    );
  const key    = rows.find(r => r.key === "managed_azure_speech_key")?.value;
  const region = rows.find(r => r.key === "managed_azure_speech_region")?.value ?? "eastus";
  if (!key) return null;
  return { key, region };
}

// ── Azure REST helpers (v2.0) ─────────────────────────────────────────────────

/**
 * v2.0 base URL.
 * All speaker recognition paths are relative to this.
 */
function baseUrl(region: string): string {
  return `https://${region}.api.cognitive.microsoft.com/speaker/identification/v2.0/text-independent`;
}

/** Create a new text-independent identification profile. Returns the Azure profile ID. */
async function createAzureProfile(key: string, region: string): Promise<string> {
  const res = await fetch(`${baseUrl(region)}/profiles`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Ocp-Apim-Subscription-Key": key,
    },
    body: JSON.stringify({ locale: "en-us" }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Azure createProfile ${res.status}: ${body}`);
  }
  // v2.0 response uses "profileId" (v1.0 used "identificationProfileId")
  const json = await res.json() as { profileId: string };
  return json.profileId;
}

/** Enroll WAV audio into a profile. Returns the updated enrollment status and speech seconds. */
async function enrollAzureProfile(
  profileId: string,
  wavAudio: Buffer,
  key: string,
  region: string,
): Promise<{ status: string; speechSeconds: number }> {
  // v2.0: POST /profiles/{profileId}/enrollments (no shortAudio param — always async 202)
  const url = `${baseUrl(region)}/profiles/${profileId}/enrollments`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Ocp-Apim-Subscription-Key": key,
    },
    body: wavAudio,
  });

  if (res.status === 202) {
    const opUrl = res.headers.get("Operation-Location");
    if (opUrl) {
      const result = await pollOperation(opUrl, key, IDENT_POLL_TIMEOUT_MS);
      // v2.0 poll result: processingResult.enrollmentStatus, processingResult.enrollmentsSpeechLength (seconds)
      const pr = result?.["processingResult"] as Record<string, unknown> | undefined;
      return {
        status:       (pr?.["enrollmentStatus"] as string | undefined) ?? "Enrolling",
        speechSeconds: (pr?.["enrollmentsSpeechLength"] as number | undefined) ?? 0,
      };
    }
    return { status: "Enrolling", speechSeconds: 0 };
  }

  if (res.status === 200) {
    // Synchronous response (some regions/configs may still return 200)
    const json = await res.json() as {
      enrollmentStatus: string;
      enrollmentsSpeechLength: number;
    };
    return {
      status:       json.enrollmentStatus ?? "Enrolling",
      speechSeconds: json.enrollmentsSpeechLength ?? 0,
    };
  }

  const body = await res.text();
  throw new Error(`Azure enroll ${res.status}: ${body}`);
}

/**
 * Submit audio for text-independent speaker identification against a set of profiles.
 * Returns the matched profile ID and confidence, or null if not matched / no profiles.
 *
 * v2.0 endpoint: POST /profiles:identifySingleSpeaker?profileIds={ids}
 * Poll result: processingResult.identifiedProfile.profileId + .score (float 0–1)
 */
async function identifyAzureSpeaker(
  profileIds: string[],
  wavAudio: Buffer,
  key: string,
  region: string,
): Promise<{ profileId: string; confidence: number } | null> {
  if (profileIds.length === 0) return null;

  const idList = profileIds.join(",");
  // v2.0: POST /profiles:identifySingleSpeaker?profileIds=...
  const url = `${baseUrl(region)}/profiles:identifySingleSpeaker?profileIds=${encodeURIComponent(idList)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Ocp-Apim-Subscription-Key": key,
    },
    body: wavAudio,
  });

  if (res.status !== 202) {
    const body = await res.text();
    logger.warn({ status: res.status, body }, "Azure speaker identify unexpected status");
    return null;
  }

  const opUrl = res.headers.get("Operation-Location");
  if (!opUrl) return null;

  const result = await pollOperation(opUrl, key, IDENT_POLL_TIMEOUT_MS);
  if (!result?.processingResult) return null;

  // v2.0 poll result shape:
  // { processingResult: { identifiedProfile: { profileId: "...", score: 0.82 } } }
  const pr = result.processingResult as Record<string, unknown>;
  const identified = pr["identifiedProfile"] as Record<string, unknown> | undefined;
  if (!identified) return null;

  const profileId = identified["profileId"] as string | undefined;
  const rawScore  = identified["score"];
  const score     = typeof rawScore === "number" ? rawScore : parseFloat(String(rawScore ?? "0"));

  if (!profileId || isNaN(score) || score < IDENT_MIN_CONFIDENCE) return null;
  return { profileId, confidence: score };
}

/** Poll an Azure async operation URL until succeeded/failed or timeout. */
async function pollOperation(
  opUrl: string,
  key: string,
  timeoutMs: number,
): Promise<Record<string, unknown> | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(IDENT_POLL_INTERVAL_MS);
    const res = await fetch(opUrl, {
      headers: { "Ocp-Apim-Subscription-Key": key },
    });
    if (!res.ok) break;
    const json = await res.json() as Record<string, unknown>;
    const status = (json["status"] as string | undefined)?.toLowerCase();
    if (status === "succeeded") return json;
    if (status === "failed") return null;
    // "running" → keep polling
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function findPrintByAzureProfileId(azureProfileId: string) {
  const [row] = await db
    .select()
    .from(voicePrintsTable)
    .where(eq(voicePrintsTable.azureProfileId, azureProfileId));
  return row ?? null;
}

async function upsertVoicePrint(
  agentId: number,
  phoneNumber: string,
  azureProfileId: string,
): Promise<void> {
  await db
    .insert(voicePrintsTable)
    .values({ agentId, phoneNumber, azureProfileId })
    .onConflictDoNothing();
}

async function markEnrolled(
  azureProfileId: string,
  status: string,
  speechSeconds: number,
  confidence?: number,
): Promise<void> {
  await db
    .update(voicePrintsTable)
    .set({
      enrollmentStatus:        status,
      enrollmentSpeechSeconds: speechSeconds,
      lastIdentifiedAt:        confidence !== undefined ? new Date() : undefined,
      lastConfidenceScore:     confidence ?? undefined,
      updatedAt:               new Date(),
    })
    .where(eq(voicePrintsTable.azureProfileId, azureProfileId));
}

// ── Audio conversion ──────────────────────────────────────────────────────────

/** Convert raw PCM8k (LINEAR16) to a proper WAV buffer for Azure. */
function toWav8k(pcm8k: Buffer): Buffer {
  return pcmToWav(pcm8k, 8000, 1, 16);
}

// ── Public VoiceIntelSession ──────────────────────────────────────────────────

export interface VoiceIdResult {
  /** Phone number of the matched known caller */
  matchedPhone: string;
  /** Azure confidence score (0–1) */
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

  /** Azure profile ID for the current caller (set after first enroll) */
  private ownAzureProfileId: string | null = null;

  constructor(agentId: number, callerPhone: string | null) {
    this.agentId  = agentId;
    this.callerPhone = callerPhone;
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

    // Fire identification once
    if (!this.identFired && this.totalSeconds >= IDENT_BUFFER_SECONDS) {
      this.identFired = true;
      this.identPromise = this.runIdentification();
    }

    // Speaker-change window
    if (this.ownAzureProfileId) {
      this.changeWindowChunks.push(pcm8k);
      this.changeWindowSeconds += chunkSec;
      if (this.changeWindowSeconds >= CHANGE_WINDOW_SECONDS) {
        const window = Buffer.concat(this.changeWindowChunks);
        this.changeWindowChunks = [];
        this.changeWindowSeconds = 0;
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
      const creds = await getAzureCreds();
      if (!creds) return;

      // Fetch all enrolled profiles for this agent
      const prints = await db
        .select()
        .from(voicePrintsTable)
        .where(
          and(
            eq(voicePrintsTable.agentId, this.agentId),
            eq(voicePrintsTable.enrollmentStatus, "Enrolled"),
          )
        );

      if (prints.length === 0) return;

      // Exclude the current caller's own profile from identification
      // (no need to match someone to themselves)
      const own = prints.find(p => p.phoneNumber === this.callerPhone);
      this.ownAzureProfileId = own?.azureProfileId ?? null;
      const candidates = prints.filter(p => p.phoneNumber !== this.callerPhone);
      if (candidates.length === 0) return;

      const wav = toWav8k(Buffer.concat(this.chunks));
      const match = await identifyAzureSpeaker(
        candidates.map(p => p.azureProfileId),
        wav,
        creds.key,
        creds.region,
      );
      if (!match) return;

      const matched = await findPrintByAzureProfileId(match.profileId);
      if (!matched) return;

      this.identResult = {
        matchedPhone: matched.phoneNumber,
        confidence:   match.confidence,
        name:         null,
      };

      await db
        .update(voicePrintsTable)
        .set({ lastIdentifiedAt: new Date(), lastConfidenceScore: match.confidence, updatedAt: new Date() })
        .where(eq(voicePrintsTable.azureProfileId, match.profileId));

      logger.info(
        { agentId: this.agentId, callerPhone: this.callerPhone, matchedPhone: matched.phoneNumber, confidence: match.confidence },
        "Voice intelligence: cross-number identity match"
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
    if (!this.ownAzureProfileId) return;
    try {
      const creds = await getAzureCreds();
      if (!creds) return;

      const wav = toWav8k(window);
      // Run identification against own profile only — effectively a quick 1:1 verify
      const match = await identifyAzureSpeaker(
        [this.ownAzureProfileId],
        wav,
        creds.key,
        creds.region,
      );

      const score = match?.confidence ?? 0;
      if (score < CHANGE_MIN_CONFIDENCE) {
        this.changeLowWindows++;
        if (this.changeLowWindows >= 2) {
          this.changeLowWindows = 0;
          logger.info({ agentId: this.agentId, score }, "Voice intelligence: speaker change detected");
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
   * Safe to call even if audio is too short — it will skip if below minimum.
   */
  async enroll(phoneNumber: string): Promise<void> {
    if (this.totalSeconds < ENROLL_MIN_NEW_SECONDS) return;

    try {
      const creds = await getAzureCreds();
      if (!creds) {
        logger.debug({ agentId: this.agentId }, "Voice intelligence: no Azure creds, skipping enroll");
        return;
      }

      // Look up or create the voice print row
      let [print] = await db
        .select()
        .from(voicePrintsTable)
        .where(
          and(
            eq(voicePrintsTable.agentId,     this.agentId),
            eq(voicePrintsTable.phoneNumber, phoneNumber),
          )
        );

      let azureProfileId: string;
      if (print) {
        azureProfileId = print.azureProfileId;
        // Already fully enrolled — no need to keep enrolling
        if ((print.enrollmentSpeechSeconds ?? 0) >= ENROLL_TARGET_SECONDS) return;
      } else {
        azureProfileId = await createAzureProfile(creds.key, creds.region);
        await upsertVoicePrint(this.agentId, phoneNumber, azureProfileId);
        // Re-fetch the row after insert
        const rows = await db
          .select()
          .from(voicePrintsTable)
          .where(eq(voicePrintsTable.azureProfileId, azureProfileId));
        print = rows[0];
      }

      const wav = toWav8k(Buffer.concat(this.chunks));
      const result = await enrollAzureProfile(azureProfileId, wav, creds.key, creds.region);

      await markEnrolled(azureProfileId, result.status, result.speechSeconds);

      logger.info(
        {
          agentId: this.agentId,
          phoneNumber,
          azureProfileId,
          enrollmentStatus: result.status,
          speechSeconds:    result.speechSeconds,
        },
        "Voice intelligence: enrollment updated"
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
