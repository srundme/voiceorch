import { performance } from "perf_hooks";
import {
  computeEndpointMs,
  TurnSafetyNet,
  recoveryReprompt,
  type TurnCloseReason,
} from "../endpointing.js";
import { checkTranscriptQuality, pickClarificationPhrase, isSemanticInterrupt } from "../transcriptQuality.js";
import type { WebSocket } from "ws";
import { db, agentsTable, callsTable, callEventsTable, scheduledCallbacksTable, providersTable, usersTable, walletTransactionsTable, platformSettingsTable, knowledgeEntriesTable, utterancesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { createSTTAdapter } from "../adapters/stt/index.js";
import { createLLMAdapter } from "../adapters/llm/index.js";
import { createTTSAdapter } from "../adapters/tts/index.js";
import { downsample16to8, upsample8to16, decodeMulaw } from "../audio.js";
import { processRawPcm8kIn } from "../audioPool.js";
import { AmbientNoiseStream, FileAmbientNoiseStream, TRACK_PARAMS, loadPcmLoop } from "../ambient.js";
import { toReadableError } from "../utils.js";
import { logger } from "../../lib/logger.js";
import { RecordingBuffer } from "../recorder.js";
import type { ConversationTurn, STTConfig, StreamSTT } from "../types.js";
import { DEFAULT_GOODBYE_MESSAGE, resolveGoodbyeMessage } from "../types.js";
import { decryptKey } from "../../lib/crypto.js";
import { getFlatRateCentsPerMin, resolveAgentBillingMode } from "../../services/minute-rates.js";
import { loadCallerContext, injectEnhancedMemory, updateCallerProfile, latchCallerName, latchCallerFact, detectCallbackRequest } from "../callerMemory.js";

import { GenderDetector } from "../genderDetector.js";
import { GenderDetectorML } from "../genderDetectorML.js";
import { GenderDetectorMLv2 } from "../genderDetectorMLv2.js";
import { buildDatetimeInjection } from "../datetimeInject.js";
import { getBackchannelFillers } from "../backchannel.js";
import { CONVERSATION_DISCIPLINE_BLOCK, CONVERSATION_DISCIPLINE_TURN_REMINDER, makeFlowStepGuard, truncateToSingleStep } from "../conversationDiscipline.js";
import { makeThinkFilter, stripReasoningBlocks } from "../reasoningFilter.js";
import { getAttachedSourceIds, buildKnowledgeBaseBlock } from "../kb-retrieval.js";
import {
  buildToolDefs,
  matchToolByName,
  executeNativeBooking,
  executeNativeCheckAvailability,
  executeNativeListBookings,
  executeNativeReschedule,
  executeNativeCancel,
  executeWebhookTool,
} from "../../services/tool-executor.js";
import { disposeCall } from "../../services/disposition.js";
import {
  createExecutionLogger,
  writeCallEndedLog,
  writeCallStartedLog,
  logPlaybackEvent,
  logRecordingEvent,
  logToolExecutionStarted,
  logWarningEvent,
  EXEC_COMPONENTS,
  type ExecLogFn,
  type PlaybackEvent,
} from "../../services/execution-log.js";
import { createHash } from "crypto";

// ── Per-user concurrent call rate limit ──────────────────────────────────────
const activeCalls = new Map<string, number>();
const DEFAULT_CONCURRENT_LIMIT = 15; // default when user row has no value

// ── Tuning constants ─────────────────────────────────────────────────────────
const VAD_SILENCE_MS           = 150;   // default silence window before sending audio to STT (ms) — per-agent tunable via vadSilenceMs
const SPEECH_RMS_THRESHOLD     = 400;   // normal VAD — user speaking (agent silent)
const BARGE_IN_RMS             = 800;   // energy threshold while agent is speaking.
                                        // Browser echoCancellation suppresses the mic signal during TTS by ~6–12 dB,
                                        // so a normal speaking voice may reach only 600–1200 RMS after AEC.
                                        // 800 gives ~2× headroom over SPEECH_RMS_THRESHOLD (400) to avoid false
                                        // triggers while still being reachable for actual speech.
const BARGE_IN_MIN_FRAMES      = 3;     // minimum frames — prevents a single loud sound from cutting the agent
const WEBCALL_FRAME_MS         = 128;   // browser ScriptProcessorNode(2048) at 16 kHz → one frame per 128 ms
                                        // (NOT 40ms — the telephony pipeline sends 40ms chunks, webcall doesn't)
const BARGE_IN_ECHO_GRACE_MS   = 700;  // suppress barge-in after TTS starts — allows browser echo cancellation to adapt
const ECHO_CONTENT_WINDOW_MS   = 900;  // only run content-based echo check for transcripts arriving within this
                                        // many ms of the last TTS chunk — outside this window the mic audio can't
                                        // be echo from the agent's own voice
const ECHO_SIM_THRESHOLD       = 0.6;  // token containment ratio (|intersection| / |transcript tokens|) above which
                                        // a post-speech transcript is classified as acoustic echo and discarded
const AGENT_TEXT_BUFFER_MS     = 8000; // retain agent utterances in the echo-detection buffer for this long.
                                        // Must cover: max sentence TTS duration + ECHO_CONTENT_WINDOW_MS + STT
                                        // finalize latency. With push-at-sentence-start timing, a 4s sentence has
                                        // entry.at ≈ 0 and the matching echo arrives at ~4s(TTS)+0.15s(tail)+
                                        // 0.9s(window)+0.5s(Sarvam finalize) ≈ 5.6s. 8 s gives headroom for
                                        // slower TTS providers and network jitter without unbounded buffer growth.
const AUDIO_TAIL_SILENCE_MS    = 300;  // extra wait after the last chunk so the client's audio buffer drains
                                        // before the server signals "listening" (prevents last-word cutoff)
const WEB_TAIL_ECHO_MARGIN_MS  = 100;  // extra echo-grace held PAST the tail-silence drain so the agent's own
                                        // final-word echo can't trip a false barge-in that flushes the last word.
const TTS_TAIL_SILENCE_MS      = 150;  // PCM silence appended to every TTS buffer so the last word isn't clipped
                                        // by the client's AudioContext reaching the end of its scheduled queue
const MIN_PCM_BYTES            = 3200; // ~100ms at 16kHz Int16 — minimum speech before processing
const AUDIO_CHUNK_BYTES        = 1280; // 40ms per WS frame
const HANDOFF_SILENCE_MS       = 3000; // sustained silence that may indicate a phone handoff
const TTS_VOLUME_GAIN          = 1.5;  // PCM amplitude multiplier — reduced from 2.5 to prevent hard-clipping distortion

/** Transcript phrases that strongly suggest the caller is handing the phone to someone else. */
const HANDOFF_PHRASES = [
  // English
  "talk to her", "talk to my wife", "talk to my sister", "talk to my mother",
  "here she is", "pass the phone", "give the phone to", "let her talk",
  "let her speak", "she will talk", "she wants to talk",
  "i'll pass", "passing you", "passing the phone",
  // Hindi-romanized
  "baat karo", "usse baat", "use de do", "phone de do",
  "le lo phone", "in se baat",
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function rmsEnergy(buf: Buffer): number {
  let sum = 0;
  const samples = buf.length >> 1;
  for (let i = 0; i < buf.length - 1; i += 2) {
    const s = buf.readInt16LE(i);
    sum += s * s;
  }
  return samples > 0 ? Math.sqrt(sum / samples) : 0;
}

/**
 * Split a streaming LLM token buffer into complete sentences and a remainder.
 *
 * Handles English punctuation (.  !  ?) plus:
 *   • Devanagari / Indic danda (।, U+0964) — Hindi, Tamil-mixed, etc.
 *   • Comma-clause fallback: when a long buffer (≥ 60 chars) has no sentence
 *     boundary yet, split at the last ", " after the first 30 chars so TTS
 *     can start synthesising before the full reply arrives (critical for
 *     Tamil/Hindi responses that don't use Latin punctuation).
 *
 * This mirrors the pipeline.ts implementation so telephony and webcall paths
 * have identical streaming-TTS behaviour.
 */
function extractSentences(buf: string, minCommaChars = 15): [string[], string] {
  const sentences: string[] = [];
  let i = 0;
  let segStart = 0;

  while (i < buf.length) {
    const ch = buf[i]!;

    // ── ! and ? ────────────────────────────────────────────────────────────
    if (ch === '!' || ch === '?') {
      while (i + 1 < buf.length && (buf[i + 1] === '!' || buf[i + 1] === '?')) i++;
      const s = buf.slice(segStart, i + 1).trim();
      if (s.length >= 4) sentences.push(s);
      i++;
      while (i < buf.length && buf[i] === ' ') i++;
      segStart = i;

    // ── Devanagari / Indic danda (।) ───────────────────────────────────────
    } else if (ch === '\u0964') {
      const s = buf.slice(segStart, i + 1).trim();
      if (s.length >= 4) sentences.push(s);
      i++;
      while (i < buf.length && buf[i] === ' ') i++;
      segStart = i;

    // ── Ellipsis ───────────────────────────────────────────────────────────
    } else if (ch === '.' && buf[i + 1] === '.' && buf[i + 2] === '.') {
      const s = buf.slice(segStart, i + 3).trim();
      if (s.length >= 4) sentences.push(s);
      i += 3;
      while (i < buf.length && buf[i] === ' ') i++;
      segStart = i;

    // ── Period ─────────────────────────────────────────────────────────────
    } else if (ch === '.') {
      const next = i + 1;
      if (next >= buf.length) {
        // Period at end of buffer
        const s = buf.slice(segStart, i + 1).trim();
        if (s.length >= 4) sentences.push(s);
        i++;
        segStart = i;
      } else if (buf[next] === ' ' || buf[next] === '\n') {
        let j = next + 1;
        while (j < buf.length && (buf[j] === ' ' || buf[j] === '\n')) j++;
        const afterSpace = j < buf.length ? buf[j] : undefined;

        // Split when the next real char starts a new sentence (uppercase / quote /
        // Indic script) or when nothing follows (trailing period in streaming chunk).
        // Indic scripts (U+0900–U+0D7F) have no uppercase so the letter-case check
        // never fires for Tamil/Hindi/etc — this range covers all major Indian scripts
        // so "நான்…. உங்களுக்கு…" correctly splits into two TTS jobs.
        const shouldSplit =
          afterSpace === undefined ||
          /[A-Z"'(\u2018\u201C\u0900-\u0D7F]/.test(afterSpace);

        if (shouldSplit) {
          // Skip if word before period is ≤ 4 alpha chars (likely an abbreviation).
          const wordBefore = buf.slice(segStart, i).match(/([A-Za-z]{1,4})$/)?.[1];
          const isAbbrev = wordBefore !== undefined;
          if (!isAbbrev) {
            const s = buf.slice(segStart, i + 1).trim();
            if (s.length >= 4) sentences.push(s);
            segStart = j;
            i = j;
          } else {
            i++;
          }
        } else {
          i++;
        }
      } else {
        i++; // decimal / URL — not a sentence boundary
      }

    } else {
      i++;
    }
  }

  let remainder = buf.slice(segStart);

  // Comma-clause fallback: fire TTS early on long Indic/list-heavy responses
  // that haven't hit a sentence boundary yet.
  // Threshold lowered from 30 → 15: commas in short Tamil lead-ins like
  // "ஓகே, வடபழனில apartment, villa..." sit at position ~22, which was
  // previously skipped (22 < 30) forcing TTS to wait until LLM completion.
  // At >= 15 the first comma-clause fires during streaming, giving TTS a
  // 400–600ms headstart on the main sentence.
  if (sentences.length === 0 && remainder.length >= 60) {
    const commaIdx = remainder.lastIndexOf(", ");
    if (commaIdx >= minCommaChars) {
      const clause = remainder.slice(0, commaIdx).trim();
      if (clause.length >= 8) {
        sentences.push(clause);
        remainder = remainder.slice(commaIdx + 2);
      }
    }
  }

  return [sentences, remainder];
}

/**
 * Append a short PCM silence trailer to every TTS audio buffer.
 * Ensures the client's AudioContext has samples queued PAST the final word,
 * so the last phoneme is never truncated when the scheduled queue empties.
 * (150 ms = 4800 bytes of PCM16 at 16 kHz)
 */
function withTailSilence(audio: Buffer): Buffer {
  const silenceBytes = Math.round((TTS_TAIL_SILENCE_MS / 1000) * 16000) * 2;
  return Buffer.concat([audio, Buffer.alloc(silenceBytes, 0)]);
}

type Status = "idle" | "listening" | "thinking" | "speaking";

/**
 * WebCall WebSocket handler — with barge-in (interruption) support.
 *
 * Barge-in flow:
 *   1. While agent is streaming audio (speaking = true), the server keeps
 *      monitoring incoming PCM energy from the client.
 *   2. If energy exceeds BARGE_IN_RMS, the server sets interrupted = true
 *      (halting the audio loop) and sends { type:"interrupted" } to the client.
 *   3. The client immediately stops all queued/playing audio on receipt of
 *      that message, and the server starts a new STT → LLM → TTS cycle.
 */
/**
 * Amplify a LINEAR16 PCM buffer by a fixed gain factor with hard-limiter
 * clipping to prevent wrap-around distortion.
 */
function amplifyPcm(buf: Buffer, gain: number): Buffer {
  const out = Buffer.allocUnsafe(buf.length);
  for (let i = 0; i < buf.length - 1; i += 2) {
    const s = buf.readInt16LE(i);
    const amplified = Math.max(-32768, Math.min(32767, Math.round(s * gain)));
    out.writeInt16LE(amplified, i);
  }
  return out;
}

export async function handleWebCallWebSocket(
  ws: WebSocket,
  agentId: number,
  callerUserId?: string,
  callbackId?: number,
  promptVariables?: Record<string, string>,
): Promise<void> {
  function send(data: Record<string, unknown>) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(data));
  }
  function sendStatus(status: Status) { send({ type: "status", status }); }
  function sendAudio(pcm: Buffer) { if (ws.readyState === ws.OPEN) { ws.send(pcm); lastChunkSentAt = Date.now(); } }
  // Speech output: amplify the TTS PCM16/16kHz chunk, then mix continuous ambient
  // background under it so the background audio is audible WHILE the agent speaks
  // (matching the live telephony pipeline, which mixes ambient into every TTS chunk).
  // The silence-fill interval is gated on `speaking`, so it never double-sends here.
  function sendSpeechAudio(pcm16k: Buffer) {
    if (_tFirstAudioOut === null) _tFirstAudioOut = performance.now();
    const amplified = amplifyPcm(pcm16k, TTS_VOLUME_GAIN);
    const out = ambientStream ? ambientStream.mixIntoPcm16k(amplified) : amplified;
    sendAudio(out);
  }

  // ── Load agent + provider keys ────────────────────────────────────────────
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
  if (!agent) { send({ type: "error", message: "Agent not found" }); ws.close(); return; }

  // Balance gate + concurrent limit — single DB fetch covers both checks
  let effectiveConcurrentLimit = DEFAULT_CONCURRENT_LIMIT;
  if (agent.userId) {
    const [user] = await db
      .select({ walletBalanceCents: usersTable.walletBalanceCents, concurrentLimit: usersTable.concurrentLimit })
      .from(usersTable).where(eq(usersTable.clerkId, agent.userId));
    if (user && user.walletBalanceCents <= 0) {
      send({ type: "error", message: "Insufficient balance. Please top up your wallet to start calls." });
      ws.close();
      return;
    }
    effectiveConcurrentLimit = user?.concurrentLimit ?? DEFAULT_CONCURRENT_LIMIT;
  }

  // ── Rate limit: max concurrent calls per user (DB limit, hard ceiling = 15) ─
  const rateLimitKey = agent.userId ?? `agent-${agentId}`;
  const current = activeCalls.get(rateLimitKey) ?? 0;
  if (current >= effectiveConcurrentLimit) {
    send({ type: "error", message: `Too many concurrent calls (max ${effectiveConcurrentLimit}). Please wait for an active call to finish.` });
    ws.close();
    return;
  }
  activeCalls.set(rateLimitKey, current + 1);
  ws.once("close", () => {
    const n = activeCalls.get(rateLimitKey) ?? 1;
    if (n <= 1) activeCalls.delete(rateLimitKey);
    else activeCalls.set(rateLimitKey, n - 1);
  });

  // Scope provider keys to this agent's owner.
  // Managed/admin agents (userId=null) get no user-specific keys — they rely
  // entirely on platform managed keys loaded below.
  const providerRows = agent.userId
    ? await db.select().from(providersTable).where(
        and(eq(providersTable.isActive, true), eq(providersTable.userId, agent.userId))
      )
    : [];
  const providerKeys = new Map<string, string>();
  for (const row of providerRows) {
    providerKeys.set(row.providerName.toLowerCase(), decryptKey(row.apiKey));
    if (row.extraConfig) providerKeys.set(`${row.providerName.toLowerCase()}:extraConfig`, row.extraConfig);
  }

  // Managed platform key fallback — same map as session.ts
  const MANAGED: Record<string, string> = {
    qwen:     "managed_qwen_key",
    groq:     "managed_qwen_key",
    google:   "managed_gemini_key",
    gemini:   "managed_gemini_key",
    deepgram: "managed_deepgram_key",
    sarvam:   "managed_sarvam_key",
    cartesia: "managed_cartesia_key",
    openai:   "managed_openai_key",
    azure:    "managed_azure_speech_key",
    assemblyai: "managed_assemblyai_key",
  };
  // Providers that also need an extra-config blob — key stores the region string, not JSON
  // (matches what the admin Managed Keys panel writes as managed_azure_speech_region)
  const MANAGED_EXTRA: Record<string, string> = {
    azure: "managed_azure_speech_region",
  };

  const requiredProviders = [
    agent.asrProvider?.toLowerCase(),
    agent.llmProvider?.toLowerCase(),
    agent.ttsProvider?.toLowerCase(),
  ].filter((p): p is string => !!p);

  const isManaged = agent.agentMode === "managed";

  for (const providerName of requiredProviders) {
    if (MANAGED[providerName]) {
      // Managed agents: platform key is primary — always use it (ignore user key)
      // BYOP agents: platform key is fallback — only if user has no key
      if (isManaged || !providerKeys.has(providerName)) {
        const [row] = await db.select().from(platformSettingsTable).where(eq(platformSettingsTable.key, MANAGED[providerName]!));
        if (row?.value) {
          providerKeys.set(providerName, row.value);
          logger.info({ providerName, isManaged }, "webcall: using platform managed key for provider");
        }
      }
    }
    // Extra config (e.g. Azure region) — stored as plain string, wrap into JSON blob
    if (MANAGED_EXTRA[providerName] && (isManaged || !providerKeys.has(`${providerName}:extraConfig`))) {
      const [extraRow] = await db.select().from(platformSettingsTable).where(eq(platformSettingsTable.key, MANAGED_EXTRA[providerName]!));
      if (extraRow?.value) {
        const existing = providerKeys.get(`${providerName}:extraConfig`);
        const cfg = existing ? JSON.parse(existing) as Record<string, string> : {};
        if (!cfg["region"]) cfg["region"] = extraRow.value;
        providerKeys.set(`${providerName}:extraConfig`, JSON.stringify(cfg));
      }
    }
  }

  const sttKey = providerKeys.get(agent.asrProvider?.toLowerCase());
  const llmKey = providerKeys.get(agent.llmProvider?.toLowerCase());
  const ttsKey = providerKeys.get(agent.ttsProvider?.toLowerCase());

  if (!sttKey || !llmKey || !ttsKey) {
    send({ type: "error", message: `Missing API keys for: ${[!sttKey && agent.asrProvider, !llmKey && agent.llmProvider, !ttsKey && agent.ttsProvider].filter(Boolean).join(", ")}` });
    ws.close();
    return;
  }

  const agentCfgWc = (agent.agentConfig ?? {}) as Record<string, unknown>;

  const sttConfig: STTConfig = {
    language: agent.asrLanguage || agent.language || null,
    backgroundDenoising: agent.asrBackgroundDenoising ?? false,
    confidenceThreshold: agent.asrConfidenceThreshold ?? 0.40,
    endOfTurnConfidence: agent.asrEndOfTurnConfidence ?? 0.70,
    endOfTurnTimeout: agent.asrEndOfTurnTimeout ?? 5000,
    keyterms: agent.asrKeyterms
      ? agent.asrKeyterms.split(",").map((s) => s.trim()).filter(Boolean)
      : [],
    smartEndpointing: agent.asrSmartEndpointing ?? "off",
    autoFallback: agent.asrAutoFallback ?? false,
    fallbackProviders: (agent.asrFallbackProviders as Array<{ provider: string; model: string | null }> | null | undefined) ?? [],
  };

  const sttExtraConfig = providerKeys.get(`${agent.asrProvider?.toLowerCase()}:extraConfig`) ?? null;
  const stt = createSTTAdapter(agent.asrProvider, sttKey, agent.asrModel, sttExtraConfig, sttConfig);
  const llm = createLLMAdapter(agent.llmProvider, llmKey, agent.llmModel);

  // ── Streaming STT (saaras:v3, Deepgram) ─────────────────────────────────
  // Initialised below, after the call record exists and callId is known.
  let streamSTT: StreamSTT | null = null;
  let pendingSttMeta: { endDetectToFinalMs?: number; lastPartialToFinalMs?: number; mergedSegments?: number; pauseCount?: number } | null = null;
  // Transcript received from streaming STT WebSocket — consumed by process()
  let streamingTranscriptPending: string | null = null;
  // Prefer asrLanguage over language for TTS — setting the Transcriber to
  // kn-IN signals intent for the whole agent to run in Kannada, not just ASR.
  const agentLanguage = agent.asrLanguage ?? agent.language ?? null;
  const ttsExtraConfig = agent.ttsProvider === "sarvam"
    ? JSON.stringify({ language: agentLanguage ?? "en-IN" })
    : null;
  const tts = createTTSAdapter(agent.ttsProvider, ttsKey, agent.ttsVoice, agent.ttsModel, ttsExtraConfig, agentLanguage);

  // Tracks the configured agent language for per-turn LLM language injection.
  const currentLangWc: string = agentLanguage ?? "";

  // ── Create call DB record ─────────────────────────────────────────────────
  const [callRecord] = await db.insert(callsTable).values({
    agentId,
    userId: agent.userId ?? null,
    status: "in_progress",
    toNumber: "webcall",
    fromNumber: "browser",
    metadata: JSON.stringify({ channel: "webcall" }),
  }).returning();

  if (!callRecord) { send({ type: "error", message: "Failed to create call record" }); ws.close(); return; }

  const callId    = callRecord.id;
  const startedAt = new Date();
  const history: ConversationTurn[] = [];
  let closed      = false;

  // Turn safety net — guards the "Listening…" hang (partials but no final, or no
  // usable transcript at all). Shared logic in endpointing.ts; mirrors pipeline.ts.
  // process/stallReprompt/speakFinalUtterance/hangup are hoisted function decls.
  let pendingCloseReason: TurnCloseReason = "stt_final";
  const safetyNet = new TurnSafetyNet({
    onForceFinalize: (transcript) => {
      if (closed) return;
      logger.warn({ callId, chars: transcript.length }, "Safety net: force-finalizing stuck turn from best partial");
      logWarningEvent(logExecution, EXEC_COMPONENTS.STT, "STT Timeout", ["stt_timeout"], {
        provider: agent.asrProvider,
        detail: { reason: "force-finalized stuck turn from best partial" },
      });
      pendingCloseReason = "force_finalized";
      streamingTranscriptPending = transcript;
      void process();
    },
    onStallReprompt: () => { if (!closed) void stallReprompt(); },
    onStallGiveUp: () => {
      if (closed) return;
      logger.warn({ callId }, "Safety net: stall reprompts exhausted — ending call");
      void (async () => {
        if (agent.inactivityMessage && !closed) await speakFinalUtterance(agent.inactivityMessage);
        if (!closed) void hangup("silence_timeout");
      })();
    },
  });

  // ── Per-call execution logger (fire-and-forget, never blocks the call) ────
  const logExecution = createExecutionLogger(callId, agentId);

  writeCallStartedLog(callId, agentId, {
    callType: "Webcall",
    direction: "Inbound",
    recordingEnabled: (agentCfgWc["recordingEnabled"] as boolean | undefined) ?? false,
    webrtcConnected: true,
    mediaStreamStarted: true,
    sessionId: `webcall-${callId}`,
    agentName: agent.name,
    asrProvider: agent.asrProvider,
    llmProvider: agent.llmProvider,
    ttsProvider: agent.ttsProvider,
    ttsVoice: agent.ttsVoice ?? null,
  });

  // ── Setup: provider-init / voice events (mirror the telephony path) ────────
  logExecution(EXEC_COMPONENTS.STT, "system", {
    status: "info",
    metadata: { event: "Provider Initialized", provider: agent.asrProvider, language: agent.asrLanguage ?? agent.language ?? null },
  });
  logExecution(EXEC_COMPONENTS.LLM, "system", {
    status: "info",
    metadata: { event: "Provider Initialized", provider: agent.llmProvider, model: agent.llmModel ?? null },
  });
  logExecution(EXEC_COMPONENTS.TTS, "system", {
    status: "info",
    metadata: { event: "Provider Initialized", provider: agent.ttsProvider },
  });
  logExecution(EXEC_COMPONENTS.TTS, "system", {
    status: "info",
    metadata: { event: "Voice Loaded", provider: agent.ttsProvider, voice: agent.ttsVoice ?? null },
  });

  // ── Per-call usage accumulators (written to usage_events on hangup) ──────
  let llmInputTokensTotal  = 0;
  let llmOutputTokensTotal = 0;
  let ttsCharactersTotal   = 0;

  // ── Initialise streaming STT if the adapter supports it ──────────────────
  // Streaming STT (Deepgram, Sarvam saaras:v3) eliminates the local VAD
  // silence wait — transcripts fire as soon as the utterance ends, reducing
  // STT latency from ~450ms+ to ~100–200ms.
  if (stt.transcribeStream) {
    try {
      streamSTT = stt.transcribeStream(
        (text, isFinal, _lang, sttMeta) => {
          if (closed) return;
          // Non-empty interim → drive the force-finalize timer, but ONLY while we
          // are actually listening (not during agent speech, where partials are
          // barge-in candidates). Don't process yet.
          if (!isFinal) { if (!speaking && text.trim()) { safetyNet.onPartial(text); resetHangupSilenceTimer(); } return; }
          if (!text.trim()) return;
          // Streaming produced a valid result — cancel batch-STT fallback timer and
          // clear the backup audio buffer; streaming STT has covered this utterance.
          clearStreamingFallback();
          audioChunks.splice(0);
          // NB: safetyNet.onFinal() is DEFERRED to process() so a transcript that is
          // later discarded below (echo / leftover) does NOT clear the stall backstop.
          pendingSttMeta = sttMeta ?? null;
          // Barge-in: if agent is speaking, only interrupt if the transcript
          // meets the same wordsForInterruption gate as energy-based barge-in.
          // This prevents a faint background speaker (distant person) producing
          // a short 1-word Sarvam/Deepgram transcript from cutting the agent off.
          if (speaking) {
            // Allow Barge-in disabled → the agent owns the turn while speaking; no
            // transcript (semantic or otherwise) may interrupt it, matching the
            // energy path and pipeline.ts which nests semantic barge-in under the flag.
            if (!bargeInEnabled) return;
            // P0-C: Semantic barge-in — keywords bypass the word-count gate
            const semanticOverride = isSemanticInterrupt(text);
            const wc = text.trim().split(/\s+/).length;
            if (!semanticOverride && wc < wordsForInterruption) {
              // Too short to interrupt — save it so it can be replayed as the user's
              // turn once the agent finishes speaking naturally. Without this, short
              // affirmatives like "ஆமாங்க" / "சரி" said during the agent's speech are
              // silently lost and the caller has to repeat themselves ("say it twice" bug).
              pendingShortUtterance = text;
              logger.info({ callId, text, wc, wordsForInterruption }, "Webcall: queuing short utterance for post-speech replay");
              return;
            }
            // Start echo-grace gate (parity with the energy-based path's inStartGrace).
            // During the grace window after TTS begins, a non-semantic transcript is almost
            // certainly the agent's own audio echoed back through the mic before browser AEC
            // has adapted. Discard it so self-echo can't trigger a false barge-in that clips
            // the response tail. Semantic interrupts (e.g. "stop") still bypass — our own
            // audio never utters them.
            if (!semanticOverride && Date.now() < echoGraceUntil) {
              logger.info({ callId, text, msToGraceEnd: echoGraceUntil - Date.now() }, "Webcall: ignoring STT transcript within echo grace");
              return;
            }
            // Content echo gate: catches the agent's own words echoing back AFTER the
            // echoGraceUntil window expires (e.g. a long TTS sentence whose AEC-adapted echo
            // still matches agent text). Semantic interrupts bypass this too.
            if (!semanticOverride && isAgentEcho(text)) {
              logger.info({ callId, text, msSinceLastChunk: Date.now() - lastChunkSentAt }, "Webcall: ignoring barge-in transcript (content-based echo, during-speech)");
              return;
            }
            interrupted = true;
            send({ type: "interrupted" });
            sendStatus("thinking");
            logExecution("STT", "system", {
              provider: agent.asrProvider,
              status: "info",
              turnNumber: _webcallTurnIdx,
              warningFlags: ["barge_in"],
              metadata: { event: "Barge-in Detected", reason: semanticOverride ? "semantic" : "word_count", wordCount: wc },
            });
            logger.info({ callId, wc, semanticOverride }, "Webcall: barge-in via streaming STT");
          } else if (isAgentEcho(text)) {
            // Content-based echo detection: the transcript's tokens overlap ≥ECHO_SIM_THRESHOLD
            // with recently spoken agent text AND arrived within ECHO_CONTENT_WINDOW_MS of the
            // last TTS chunk. This catches acoustic echo regardless of when in the turn the
            // caller's VAD fired — fixing the regression where a stale lastUserSpeechStartAt
            // caused genuine immediate replies to be discarded as "leftover".
            logger.info({ callId, text, msSinceLastChunk: Date.now() - lastChunkSentAt }, "Webcall: discarding post-speech transcript (content-based echo)");
            safetyNet.beginListening();
            return;
          }
          if (processing) {
            // A turn is already running — queue the transcript for after it finishes
            streamingTranscriptPending = text;
            return;
          }
          streamingTranscriptPending = text;
          void process();
        },
        () => {
          // WebSocket closed — null out so the message handler falls back to
          // batch STT (local VAD + REST).  Without this, all subsequent audio
          // frames are sent to the dead socket and silently discarded.
          logger.warn({ callId }, "Webcall: streaming STT closed — falling back to batch STT");
          streamSTT = null;

          // If auto-fallback is on, try to reconnect with a fallback streaming provider
          if (sttConfig.autoFallback && sttConfig.fallbackProviders.length > 0 && !closed) {
            for (const fb of sttConfig.fallbackProviders) {
              const fbKey = providerKeys.get(fb.provider);
              if (!fbKey) continue;
              try {
                const fbAdapter = createSTTAdapter(fb.provider, fbKey, fb.model, null, sttConfig);
                if (!fbAdapter.transcribeStream) continue;
                streamSTT = fbAdapter.transcribeStream(
                  (text: string, isFinal: boolean) => {
                    if (closed) return;
                    // Interim → drive force-finalize only while listening (not during speech).
                    if (!isFinal) { if (!speaking && text.trim()) { safetyNet.onPartial(text); resetHangupSilenceTimer(); } return; }
                    if (!text.trim()) return;
                    // onFinal() deferred to process() so discarded transcripts don't clear the stall.
                    if (speaking) {
                      // Allow Barge-in disabled → never interrupt while speaking.
                      if (!bargeInEnabled) return;
                      const semanticOverride = isSemanticInterrupt(text);
                      const wc = text.trim().split(/\s+/).length;
                      if (!semanticOverride && wc < wordsForInterruption) {
                        logger.info({ callId, text, wc, wordsForInterruption }, "Webcall: ignoring short transcript (fallback STT)");
                        return;
                      }
                      // Start echo-grace gate (parity with primary STT + energy path).
                      if (!semanticOverride && Date.now() < echoGraceUntil) {
                        logger.info({ callId, text, msToGraceEnd: echoGraceUntil - Date.now() }, "Webcall: ignoring transcript within echo grace (fallback STT)");
                        return;
                      }
                      // Content echo gate — same as primary STT speaking branch.
                      if (!semanticOverride && isAgentEcho(text)) {
                        logger.info({ callId, text, msSinceLastChunk: Date.now() - lastChunkSentAt }, "Webcall: ignoring barge-in transcript (content-based echo, during-speech, fallback STT)");
                        return;
                      }
                      interrupted = true;
                      send({ type: "interrupted" });
                      sendStatus("thinking");
                      logExecution("STT", "system", {
                        provider: agent.asrProvider,
                        status: "info",
                        turnNumber: _webcallTurnIdx,
                        warningFlags: ["barge_in"],
                        metadata: { event: "Barge-in Detected", reason: semanticOverride ? "semantic" : "word_count", wordCount: wc, path: "fallback_stt" },
                      });
                      logger.info({ callId, wc, semanticOverride }, "Webcall: barge-in via fallback streaming STT");
                    } else if (isAgentEcho(text)) {
                      // Content-based echo detection — same gate as primary STT path.
                      logger.info({ callId, text, msSinceLastChunk: Date.now() - lastChunkSentAt }, "Webcall: discarding post-speech transcript (content-based echo, fallback STT)");
                      safetyNet.beginListening();
                      return;
                    }
                    if (processing) { streamingTranscriptPending = text; return; }
                    streamingTranscriptPending = text;
                    void process();
                  },
                  () => { streamSTT = null; },
                );
                logger.info({ callId, provider: fb.provider }, "Webcall: streaming STT fallback reconnected");
                logWarningEvent(logExecution, EXEC_COMPONENTS.STT, "Provider Reconnected", ["provider_reconnect"], {
                  provider: fb.provider,
                  detail: { reason: "primary streaming STT dropped — reconnected via fallback provider" },
                });
                break;
              } catch (fbInitErr) {
                logger.warn({ callId, provider: fb.provider, err: fbInitErr }, "Webcall: streaming STT fallback init failed");
              }
            }
          }
        },
      );
      logger.info({ callId, provider: agent.asrProvider }, "Webcall: streaming STT initialised");
      // Hook dead-connection detector (Sarvam adapter). When it fires we skip
      // the 8 s last-resort timer and invoke batch STT immediately.
      if (streamSTT) {
        streamSTT.onConnectionDead = () => {
          logger.warn({ callId }, "Webcall: streaming STT WS dead — invoking batch STT immediately");
          clearStreamingFallback();
          if (!processing && !speaking && !closed && audioChunks.length > 0) {
            void process();
          }
        };
        // Track when the caller's VAD fires speech_start so we can tell whether
        // a transcript arrived from audio spoken AFTER the agent (new turn) vs.
        // audio that overlapped with agent speech but didn't trigger barge-in
        // (leftover — should be discarded). Without this, the post-speech 600ms
        // grace window discards every first user utterance whose Sarvam transcript
        // lands within 600ms of speakingEndedAt — i.e. "always 2nd time" bug.
        streamSTT.onSpeechStart = () => { lastUserSpeechStartAt = Date.now(); };
      }
    } catch (streamInitErr) {
      logger.warn({ callId, err: streamInitErr }, "Webcall: streaming STT init failed — falling back to batch");
      streamSTT = null;
    }
  }

  // ── Parallel pre-fetch: caller memory + knowledge base ───────────────────
  // Both are independent DB reads — fire simultaneously so KB lookup doesn't
  // block behind the memory query (saves ~20-40 ms on call setup).
  const webcallIdentifier = callerUserId ? `webcall:${callerUserId}` : null;

  const kbFetchPromise = getAttachedSourceIds(agent.id, agent.knowledgeBaseId).then(async (ids) => {
    if (ids.length === 0) return { ids: [] as number[], block: null };
    const block = await buildKnowledgeBaseBlock(ids).catch((kbErr) => {
      logger.warn({ callId, knowledgeSourceIds: ids, kbErr }, "Webcall: failed to load knowledge base — continuing without it");
      return null;
    });
    return { ids, block };
  }).catch(() => ({ ids: [] as number[], block: null }));

  let webcallProfile: import("../callerMemory.js").CallerProfile | null = null;
  // Tracks the name latched THIS call via latchCallerName (caller said "my name is X").
  let webcallNameLatchedThisCall: string | null = null;
  let webcallLatchedFacts = new Map<string, string>();
  let systemPrompt = agent.generatedPrompt ?? agent.systemPrompt ?? "";

  if (webcallIdentifier) {
    try {
      const webcallCtx = await loadCallerContext(agentId, webcallIdentifier);
      webcallProfile = webcallCtx.profile;
      for (const f of webcallCtx.facts) webcallLatchedFacts.set(f.key, f.value);
      if (webcallProfile || webcallCtx.facts.length > 0 || webcallCtx.recentCalls.length > 0) {
        systemPrompt = injectEnhancedMemory(systemPrompt, webcallCtx);
        logger.info({ callId, agentId, callCount: webcallProfile?.callCount ?? 0, factCount: webcallCtx.facts.length, archiveCount: webcallCtx.recentCalls.length }, "Webcall caller memory injected");
        logExecution("Memory", "response", {
          responsePayload: {
            profile: webcallProfile ? { name: webcallProfile.name, callCount: webcallProfile.callCount } : null,
            factCount: webcallCtx.facts.length,
            facts: Object.fromEntries(webcallCtx.facts.map(f => [f.key, f.value])),
            recentCallsCount: webcallCtx.recentCalls.length,
          },
          status: "success",
        });
      }
    } catch (memErr) {
      logger.warn({ callId, agentId, memErr }, "Failed to load webcall caller context — continuing without memory");
    }
  }

  // ── Callback context ──────────────────────────────────────────────────────
  // When this call was triggered by an incoming-callback notification, load the
  // prior call's summary so the agent can greet the user with context and then
  // speak an opening greeting immediately (instead of waiting for the user).
  if (callbackId) {
    try {
      const [cb] = await db
        .select()
        .from(scheduledCallbacksTable)
        .where(eq(scheduledCallbacksTable.id, callbackId));

      let priorSummary: string | null = null;
      if (cb?.createdFromCallId) {
        const [priorCall] = await db
          .select({ callSummary: callsTable.callSummary })
          .from(callsTable)
          .where(eq(callsTable.id, cb.createdFromCallId));
        priorSummary = priorCall?.callSummary ?? null;
      }
      // Fall back to the cross-call caller profile summary if no per-call summary
      if (!priorSummary) priorSummary = webcallProfile?.summary ?? null;

      const summaryLine = priorSummary
        ? `Summary of the prior conversation: ${priorSummary}`
        : "No summary of the prior conversation is available.";

      const callbackHeader = [
        "=== CALLBACK CALL ===",
        "This is a SCHEDULED CALLBACK. The user explicitly asked to be called back after their previous conversation.",
        summaryLine,
        `You are calling them back as requested. Open the conversation naturally — introduce yourself as ${agent.name}, briefly reference what was discussed, confirm this is the callback they requested, and ask if they would like to continue. Keep the opening to one or two sentences. Example: "Hi, this is ${agent.name}. We were discussing [topic] and you had asked me to follow up — shall we continue from where we left off?"`,
        "After the greeting, wait for the user to respond and guide the conversation naturally from there.",
        "====================",
      ].join("\n");
      systemPrompt = `${callbackHeader}\n\n${systemPrompt}`;

      logger.info({ callId, callbackId, hasPriorSummary: !!priorSummary }, "Callback context injected into system prompt");
    } catch (cbCtxErr) {
      logger.warn({ callId, callbackId, cbCtxErr }, "Failed to load callback context — proceeding without it");
    }
  }

  // ── Resolve prompt variables ──────────────────────────────────────────────
  // Substitutes {var} / {{var}} placeholders in the system prompt.
  // Built-in vars (agent_name, date) are always available; caller-supplied
  // vars (from the webcall URL ?variables=...) take the highest priority.
  {
    const now = new Date();
    const builtinVars: Record<string, string> = {
      agent_name:    agent.name,
      date: now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
      caller_number: "browser",
      ...promptVariables,
    };
    const resolveVar = (key: string, fullMatch: string): string => {
      if (key === "caller_salutation") return fullMatch;
      return key in builtinVars ? builtinVars[key]! : fullMatch;
    };
    systemPrompt = systemPrompt
      .replace(/\{\{(\w+)\}\}/g, (m, k: string) => resolveVar(k, m))
      .replace(/\{(\w+)\}/g,     (m, k: string) => resolveVar(k, m));
    const resolvedVars: Record<string, string> = {};
    for (const [k, v] of Object.entries(builtinVars)) resolvedVars[k] = v;
    logExecution("VariableResolver", "system", {
      requestPayload: { variables: resolvedVars },
      responsePayload: { resolvedPromptPreview: systemPrompt.substring(0, 600) },
      status: "info",
    });
  }

  // ── Knowledge base injection (result from parallel pre-fetch above) ─────
  const { ids: kbSourceIds, block: kbEntriesBlock } = await kbFetchPromise;
  if (kbEntriesBlock) {
    const kbBlock = [
      "=== KNOWLEDGE BASE ===",
      "Use the following information to answer questions accurately. Always prefer this over your general training data.",
      "",
      kbEntriesBlock,
      "=== END KNOWLEDGE BASE ===",
    ].join("\n\n");
    systemPrompt = `${kbBlock}\n\n${systemPrompt}`;
    logger.info({ callId, knowledgeSourceIds: kbSourceIds }, "Webcall: knowledge base injected into system prompt");
    logExecution("Knowledge", "response", {
      responsePayload: {
        sourceIds: kbSourceIds,
        injected: true,
        preview: kbEntriesBlock.substring(0, 400),
      },
      status: "success",
    });
  }

  // ── TTS output rules — injected here (webcall builds its own prompt outside
  //    session.ts, so session.ts rules don't reach this path automatically).
  systemPrompt +=
    `\n\n[TTS OUTPUT RULES — MANDATORY] Your responses are spoken aloud by a TTS engine. Follow these rules strictly:` +
    `\n- NEVER use XML or SSML markup tags. Do NOT write <emotion>, </emotion>, <break>, <prosody>, or any similar tags — the TTS engine will speak them aloud literally.` +
    `\n- Never use abbreviated place names with periods (write "T Nagar" not "T. Nagar").` +
    `\n- Never use ALL-CAPS words or acronyms — write them in lowercase or spell them out.` +
    `\n- Never use markdown (no asterisks, hashes, bullet points, or underscores).` +
    `\n- Use only plain conversational sentences suitable for speech.`;

  // ── Conversation discipline — mirrors session.ts (webcall builds its own
  //    prompt outside session.ts). Forces one-step-at-a-time delivery, turn
  //    yielding on "wait for response" markers, and resume-after-objection.
  systemPrompt += `\n\n${CONVERSATION_DISCIPLINE_BLOCK}`;

  logExecution(EXEC_COMPONENTS.Agent, "system", {
    status: "info",
    metadata: {
      event: "Prompt Generated",
      promptHash: createHash("sha256").update(systemPrompt).digest("hex").slice(0, 12),
      promptLength: systemPrompt.length,
      preview: systemPrompt.substring(0, 200),
    },
  });

  // ── Agent config (agentConfig JSONB) ─────────────────────────────────────
  const agentCfg = (agent.agentConfig ?? {}) as Record<string, unknown>;

  // ── Gender detection ──────────────────────────────────────────────────────
  const genderEnabled   = (agentCfg["genderDetectionEnabled"]          as boolean | undefined) ?? true;
  const genderProvider  = (agentCfg["genderDetectionProvider"]         as string  | undefined) ?? "deepgram";
  const maleSal         = (agentCfg["genderDetectionMaleSalutation"]   as string  | undefined) ?? "Sir";
  const femaleSal       = (agentCfg["genderDetectionFemaleSalutation"] as string  | undefined) ?? "Ma'am";
  const neutralSal      = (agentCfg["genderDetectionNeutralSalutation"] as string | undefined) ?? "";
  const genderDetector = genderEnabled
    ? genderProvider === "ml_model_v2"
      ? new GenderDetectorMLv2(callId, logger)
      : genderProvider === "ml_model"
        ? new GenderDetectorML(callId, logger)
        : new GenderDetector(callId, logger)
    : null;

  // ── Engine settings ────────────────────────────────────────────────────────
  const wordsForInterruption = (agentCfg["wordsForInterruption"] as number | undefined) ?? 2;
  // Browser sends 128ms frames (ScriptProcessorNode(2048) at 16kHz).
  // Each spoken word takes ~300ms ≈ 2–3 frames at 128ms.
  // The formula 6 × 40ms was calibrated for the telephony pipeline (40ms chunks).
  // Scale to webcall frame rate: 6 * 40ms / 128ms ≈ 2 frames per word.
  let effectiveBargeInMinFrames = Math.max(
    BARGE_IN_MIN_FRAMES,
    Math.round(wordsForInterruption * 6 * 40 / WEBCALL_FRAME_MS),
  );
  // P1-J: Stop Speaking Plan — override barge-in min frames when configured
  const stopSpeakingPlanCfg = agentCfg["stopSpeakingPlan"] as { numWords?: number; voiceSeconds?: number; backOffSeconds?: number } | undefined;
  if (stopSpeakingPlanCfg) {
    const framesFromWords = (stopSpeakingPlanCfg.numWords ?? 0) > 0
      ? Math.round((stopSpeakingPlanCfg.numWords ?? 0) * 6 * 40 / WEBCALL_FRAME_MS)
      : 0;
    const framesFromTime = (stopSpeakingPlanCfg.voiceSeconds ?? 0) > 0
      ? Math.round((stopSpeakingPlanCfg.voiceSeconds ?? 0) * 1000 / WEBCALL_FRAME_MS)
      : 0;
    const combined = Math.max(framesFromWords, framesFromTime);
    if (combined > 0) effectiveBargeInMinFrames = combined;
  }
  // Allow Barge-in (bargeInEnabled): when off, the agent is never interrupted
  // (neither the energy-based nor the STT-transcript path may fire).
  const bargeInEnabled = (agentCfg["bargeInEnabled"] as boolean | undefined) ?? true;
  // Energy Threshold (bargeInEnergyThreshold): RMS the caller mic must exceed while
  // the agent is speaking before a barge-in is counted. Falls back to BARGE_IN_RMS.
  const bargeInRmsThreshold = (agentCfg["bargeInEnergyThreshold"] as number | undefined) ?? BARGE_IN_RMS;
  // Back-off Silence (stopSpeakingPlan.backOffSeconds): the post-TTS-start echo-grace
  // window during which non-semantic barge-in is suppressed. Driven by the configured
  // back-off when set (>= 0), otherwise the hardcoded BARGE_IN_ECHO_GRACE_MS fallback.
  const echoGraceMs = (stopSpeakingPlanCfg && (stopSpeakingPlanCfg.backOffSeconds ?? -1) >= 0)
    ? Math.round((stopSpeakingPlanCfg.backOffSeconds ?? 0) * 1000)
    : BARGE_IN_ECHO_GRACE_MS;
  const incrementalDelayMs    = (agentCfg["incrementalDelay"]        as number | undefined) ?? 0;
  const ttsMinSentenceChars   = (agentCfg["ttsMinSentenceChars"]     as number | undefined) ?? 15;
  const llmMaxTokens          = (agentCfg["llmMaxTokens"]            as number | null | undefined) ?? null;
  // Per-agent endpointing: how long to wait after speech ends before sending to STT.
  // Falls back to VAD_SILENCE_MS (200ms) if not configured by the user.
  const agentVadSilenceMs = Math.max(50, Math.min(2000,
    (agentCfg["vadSilenceMs"] as number | undefined) ?? VAD_SILENCE_MS,
  ));
  const hangupAfterLlmCall = (agentCfg["hangupAfterLlmCall"] as boolean | undefined) ?? false;
  // P1-I: Start Speaking Plan — content-based delay before triggering LLM response
  const startSpeakingPlanCfg = agentCfg["startSpeakingPlan"] as {
    waitSeconds?: number; onPunctuationSeconds?: number;
    onNoPunctuationSeconds?: number; onNumberSeconds?: number;
  } | undefined;

  // ── Ambient noise ─────────────────────────────────────────────────────────
  const ambientEnabled = (agentCfg["ambientNoiseEnabled"] as boolean | undefined) ?? false;
  const ambientTrack   = (agentCfg["ambientNoiseTrack"]   as string | undefined) ?? null;
  let ambientStream: AmbientNoiseStream | FileAmbientNoiseStream | null = null;
  let ambientInterval: ReturnType<typeof setInterval> | null = null;
  if (ambientEnabled && ambientTrack) {
    if (Object.prototype.hasOwnProperty.call(TRACK_PARAMS, ambientTrack)) {
      // Built-in named track
      ambientStream = new AmbientNoiseStream(ambientTrack);
      logger.info({ callId, track: ambientTrack }, "Webcall: ambient noise enabled (built-in)");
    } else {
      // UUID — uploaded file; load asynchronously and assign once ready
      logger.info({ callId, track: ambientTrack }, "Webcall: ambient noise enabled (file upload)");
      loadPcmLoop(ambientTrack)
        .then((pcmBuffer) => {
          ambientStream = new FileAmbientNoiseStream(pcmBuffer);
        })
        .catch((err) => {
          logger.warn({ callId, track: ambientTrack, err }, "Webcall: failed to load uploaded ambient PCM; skipping");
        });
    }
  }

  // ── Reschedule context — set when list_bookings returns exactly one booking ──
  let activeRescheduleBooking: { bookingId: number; isoDate: string; timeLabel: string; eventName: string } | null = null;
  // All bookings from the most recent list_bookings call (for multi-booking inference)
  let pendingListedBookings: Array<{ bookingId: number; isoDate: string; timeLabel: string; eventName: string }> = [];

  function parseAllListedBookings(result: string): Array<{ bookingId: number; isoDate: string; timeLabel: string; eventName: string }> {
    if (!result.startsWith("bookings_found:")) return [];
    const entries = result.split(" | ");
    const parsed: Array<{ bookingId: number; isoDate: string; timeLabel: string; eventName: string }> = [];
    for (const entry of entries) {
      const bookingIdMatch = /booking_id=(\d+)/.exec(entry);
      const eventMatch = /event="([^"]+)"/.exec(entry);
      const isoStartMatch = /iso_start=([^\s,|]+)/.exec(entry);
      const dateMatch = /date="([^"]+)"/.exec(entry);
      if (!bookingIdMatch || !isoStartMatch) continue;
      const isoFull = isoStartMatch[1]!;
      parsed.push({
        bookingId: parseInt(bookingIdMatch[1]!, 10),
        isoDate: isoFull.split("T")[0] ?? isoFull,
        timeLabel: dateMatch?.[1] ?? isoFull,
        eventName: eventMatch?.[1] ?? "Appointment",
      });
    }
    return parsed;
  }

  function parseBookingIdArg(val: unknown): number | null {
    if (typeof val === "number") return val;
    if (typeof val === "string") { const n = parseInt(val, 10); return isNaN(n) ? null : n; }
    return null;
  }

  function buildRescheduleContextBlock(booking: { bookingId: number; isoDate: string; timeLabel: string; eventName: string }): string {
    return [
      "",
      "",
      "[ACTIVE RESCHEDULE CONTEXT]",
      `Currently rescheduling booking #${booking.bookingId} (${booking.eventName}: ${booking.timeLabel}).`,
      `When the caller proposes only a new time (e.g. "Can we do 12:30?"), you MUST default preferred_date to "${booking.isoDate}" unless they explicitly state a different date.`,
      `Always pass preferred_date as a full ISO datetime (e.g. "${booking.isoDate}T12:30:00+05:30") — never omit the date portion.`,
    ].join("\n");
  }

  // ── State ─────────────────────────────────────────────────────────────────
  const audioChunks: Buffer[] = [];
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let hangupSilenceTimer: ReturnType<typeof setTimeout> | null = null;
  // Fallback: if the client never sends `playback_ended` (old client, crash),
  // call resetHangupSilenceTimer after this many ms. Generous enough to cover
  // any plausible TTS response length (~120 s) so it is a backstop only.
  const PLAYBACK_ENDED_FALLBACK_MS = 120_000;
  let playbackSilenceTimer: ReturnType<typeof setTimeout> | null = null;
  let processing  = false;
  let speaking        = false; // true while audio frames are being sent to client
  let speakingStartedAt = 0;  // timestamp (ms) when speaking last transitioned to true
  let speakingEndedAt = 0;    // timestamp (ms) when speaking last transitioned to false
  let lastChunkSentAt = 0;    // timestamp (ms) of the most recent TTS audio chunk sent to client
  // Re-armable start echo-grace deadline (parity with pipeline.ts `bargeInHoldUntil`).
  // Suppresses NON-SEMANTIC barge-in (energy + word-count STT) for BARGE_IN_ECHO_GRACE_MS
  // after audio (re)starts. Unlike anchoring to speakingStartedAt (set ONCE at turn start),
  // this is re-armed at the start of EVERY sentence in a multi-sentence reply so the
  // browser AEC gets time to re-adapt after each inter-sentence pause — otherwise the
  // agent's own speaker echo leaks past the (long-expired) start grace and trips a false
  // barge-in mid-utterance, clipping the response. Semantic interrupts ("stop") bypass it.
  let echoGraceUntil = 0;
  // Rolling buffer of agent TTS sentences for content-based echo detection (see isAgentEcho below).
  const recentAgentText: { text: string; at: number }[] = [];
  // Timestamp of the most recent caller audio frame that exceeded the barge-in RMS threshold.
  // Used by isAgentEcho() as a tiebreaker for short (≤2-token) transcripts that overlap with
  // agent vocabulary. A timestamp is required (not a boolean): by the time Sarvam finalizes a
  // segment, several trailing silence frames have already overwritten a boolean to false — the
  // boolean would reflect end-of-utterance silence, not the speech itself. With a timestamp,
  // isAgentEcho checks whether ANY frame was loud within ECHO_CONTENT_WINDOW_MS, which correctly
  // spans the entire utterance plus the silence gap before the transcript fires.
  let lastLoudFrameAt = 0;
  let pendingShortUtterance: string | null = null; // short transcript discarded during speaking — replayed after agent finishes

  // ── Content-based echo detection ──────────────────────────────────────────
  // Replaces the old time-window (BARGE_IN_END_GRACE_MS) transcript discard that
  // keyed on lastUserSpeechStartAt. Time cannot distinguish echo from a fast caller
  // reply — both arrive in the same ~600ms window. Content can: echo is a subset of
  // the agent's own words; a genuine caller can say anything.
  //
  // normalizeIndic: NFC + strip ZWJ/ZWNJ + lowercase + collapse whitespace.
  // Ensures "சரி" from TTS and "சரி" from STT match despite Unicode encoding differences.
  function normalizeIndic(s: string): string {
    return s.normalize("NFC").replace(/[\u200C\u200D]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  // stripSsml: remove SSML/HTML markup tags from agent TTS text before storing in
  // recentAgentText. Cartesia and other TTS providers receive SSML-tagged strings;
  // storing raw markup prevents token matching because "சரி" with a surrounding
  // <break> tag won't tokenise to the same word as the STT output "சரி".
  function stripSsml(s: string): string {
    // Use a tag-specific pattern (</?[a-zA-Z][^>]*>) rather than the greedy <[^>]+>
    // so literal angle-bracket text in agent scripts ("policy < 5 lakh > tier") is
    // preserved in the echo buffer. The greedy form would delete "< 5 lakh >" from
    // the token set, causing an echo miss. SSML tags always start with a letter.
    return s.replace(/<\/?[a-zA-Z][^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }

  // isAgentEcho: returns true when `transcript` looks like acoustic echo of the agent.
  // Only fires within ECHO_CONTENT_WINDOW_MS of the last TTS chunk — outside that window
  // the microphone can't contain echo. Uses token containment (|intersection|/|transcript|)
  // so single-word echoes that Jaccard would miss are still caught. Tiebreaker for
  // short confirmations (≤2 tokens): uses lastLoudFrameAt (timestamp, NOT a boolean)
  // to check whether any loud frame arrived within ECHO_CONTENT_WINDOW_MS. A boolean
  // would be overwritten to false by the trailing silence frames that appear between
  // the caller's speech and Sarvam's onFinal — the timestamp survives that gap.
  function isAgentEcho(transcript: string): boolean {
    if (lastChunkSentAt <= 0 || Date.now() - lastChunkSentAt > ECHO_CONTENT_WINDOW_MS) return false;
    const t = normalizeIndic(transcript);
    const tTokens = t.split(/\s+/).filter(Boolean);
    if (tTokens.length === 0) return false;
    const tSet = new Set(tTokens);
    // Prune stale entries in-place
    const cutoff = Date.now() - AGENT_TEXT_BUFFER_MS;
    let i = 0;
    while (i < recentAgentText.length && recentAgentText[i]!.at < cutoff) i++;
    if (i > 0) recentAgentText.splice(0, i);
    for (const { text } of recentAgentText) {
      const aSet = new Set(normalizeIndic(text).split(/\s+/).filter(Boolean));
      let hit = 0;
      for (const w of tSet) if (aSet.has(w)) hit++;
      const containment = hit / tSet.size;
      if (containment >= ECHO_SIM_THRESHOLD) {
        // Tiebreaker: short (≤2 tokens) utterance where a loud caller frame arrived
        // within the echo window → almost certainly genuine (AEC attenuates echo
        // 6–12 dB, so real echo is low-energy). Accept as caller speech.
        const callerWasLoud = lastLoudFrameAt > 0 && (Date.now() - lastLoudFrameAt) < ECHO_CONTENT_WINDOW_MS;
        if (tSet.size <= 2 && callerWasLoud) return false;
        return true; // drop as echo
      }
    }
    return false;
  }

  // Streaming-STT batch fallback: when streaming gives no final (Azure NoMatch /
  // low-confidence), this timer fires batch STT on the audio we mirrored into
  // audioChunks while streaming was running.
  let streamingFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  const STREAMING_BATCH_FALLBACK_MS = 8000; // last-resort only — WS dead-detection fires first via onConnectionDead
  const clearStreamingFallback = () => {
    if (streamingFallbackTimer) { clearTimeout(streamingFallbackTimer); streamingFallbackTimer = null; }
  };
  let interrupted = false;          // barge-in flag; checked inside audio loop
  let bargeInFrames = 0;           // high-RMS frames accumulated while agent is speaking
  let bargeInLowEnergyFrames = 0;  // consecutive LOW-energy frames since the last high-energy frame
  // bargeInFrames is NOT reset on a single low-energy frame — natural speech has brief
  // inter-syllable dips. Only reset after BARGE_IN_LOW_RESET consecutive low frames.
  const BARGE_IN_LOW_RESET = 5;    // ~200ms of silence resets the barge-in run
  // Barge-in confidence gate: require sustained loud audio for at least this long
  // before accepting an interruption. Filters out coughs, dog barks, keyboard clicks,
  // and background TV bursts which are typically <100ms.
  const BARGE_IN_MIN_DURATION_MS = 150;
  let bargeInFirstFrameAt = 0;     // wall-clock when the current barge-in run's first loud frame arrived
  // Timestamp (ms) of the most recent Sarvam speech_start VAD event.
  // Used to distinguish "user started speaking after agent ended" (new turn, don't discard)
  // from "user spoke during agent speech but didn't interrupt" (leftover, discard).
  let lastUserSpeechStartAt = 0;

  // ── Per-turn latency instrumentation (monotonic via performance.now()) ─────
  let _webcallTurnIdx   = 0;
  let _tVadFlush        = 0;   // when VAD flush was scheduled → audio dispatched to STT
  let _tSttFinal        = 0;   // when STT returned transcript
  let _tLlmFirstToken:  number | null = null;
  let _tLlmFirstClause: number | null = null;
  let _tTtsFirstByte:   number | null = null;
  let _tFirstAudioOut:  number | null = null;
  let _tTurnFillerPlayed = false;
  let _llmStreamActive  = false;
  // Adaptive endpoint: set by scheduleSilenceFlush(), captured+reset in process()
  let _lastEndpointMs: number | null = null;
  let _lastEndpointReason = "";

  // ── Recording ─────────────────────────────────────────────────────────────
  // Stereo WAV: L=caller (16 kHz from browser), R=agent (TTS pre-amplification)
  const recording = new RecordingBuffer(16000);

  // ── Pipeline ─────────────────────────────────────────────────────────────
  async function process() {
    // Streaming STT path: a transcript is waiting — no audio accumulation needed
    const streamTranscript = streamingTranscriptPending;
    streamingTranscriptPending = null;

    if (processing || (!streamTranscript && audioChunks.length === 0)) return;

    processing  = true;
    interrupted = false;
    // Caller has produced a turn — cancel the silence-hangup countdown so it can
    // never fire mid-turn while we transcribe/think/respond. It is re-armed once
    // the agent's reply finishes playing (playback_ended / fallback).
    clearSilenceTimer();
    if (hangupSilenceTimer) { clearTimeout(hangupSilenceTimer); hangupSilenceTimer = null; }
    if (playbackSilenceTimer) { clearTimeout(playbackSilenceTimer); playbackSilenceTimer = null; }
    // Snapshot + reset the close reason for the turn_latency metric.
    const _closeReason = pendingCloseReason;
    pendingCloseReason = "stt_final";
    let beganTurn = false;
    const _curTurnIdx = ++_webcallTurnIdx;
    _tVadFlush        = performance.now();
    _tSttFinal        = 0;
    _tLlmFirstToken   = null;
    _tLlmFirstClause  = null;
    _tTtsFirstByte    = null;
    _tFirstAudioOut   = null;
    _tTurnFillerPlayed = false;
    _llmStreamActive  = false;
    // Capture adaptive endpoint decision (set by scheduleSilenceFlush).
    // null when turn was triggered by streaming STT path.
    const _thisEndpointMs = _lastEndpointMs;
    const _thisEndpointReason = _lastEndpointReason || "n/a";
    _lastEndpointMs = null;
    _lastEndpointReason = "";
    sendStatus("thinking");

    try {
      // 1. STT — use streaming transcript if available, otherwise batch-transcribe
      let userText: string | null | undefined;
      if (streamTranscript) {
        userText = streamTranscript;
        _tSttFinal = performance.now(); // streaming STT: transcript arrived from provider
        audioChunks.splice(0); // discard any stale barge-in frames — streaming STT already covered them
      } else {
        const rawPcm = Buffer.concat(audioChunks.splice(0));
        if (rawPcm.length < MIN_PCM_BYTES) { processing = false; return; }
        // Optional noise cancellation: downsample to 8 kHz → RNNoise → upsample back to 16 kHz
        // Buffer.concat returns Buffer<ArrayBufferLike>; cast needed to satisfy typed pool API.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let pcm: Buffer = rawPcm as any as Buffer;
        if (agent.noiseCancellationEnabled) {
          try {
            const pcm8k = Buffer.from(rawPcm.buffer as ArrayBuffer, rawPcm.byteOffset, rawPcm.byteLength);
            const downsampledPcm8k = Buffer.concat([downsample16to8(pcm8k)]);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const nc8k = downsampledPcm8k as any as Buffer;
            const ncResult = await processRawPcm8kIn(String(callId), nc8k, true);
            pcm = ncResult.pcm16k;
          } catch (ncErr) {
            logger.warn({ callId, ncErr }, "Webcall: noise cancellation failed — using raw audio");
          }
        }
        try {
          userText = await stt.transcribe(pcm, 16000);
        } catch (sttErr) {
          if (sttConfig.autoFallback && sttConfig.fallbackProviders.length > 0) {
            let recovered = false;
            for (const fb of sttConfig.fallbackProviders) {
              const fbKey = providerKeys.get(fb.provider);
              if (!fbKey) continue;
              try {
                const fbStt = createSTTAdapter(fb.provider, fbKey, fb.model, null, sttConfig);
                userText = await fbStt.transcribe(pcm, 16000);
                logger.info({ callId, provider: fb.provider }, "Webcall: batch STT fallback succeeded");
                recovered = true;
                break;
              } catch (fbErr) {
                logger.warn({ callId, provider: fb.provider, err: fbErr }, "Webcall: batch STT fallback failed, trying next");
              }
            }
            if (!recovered) {
              const reason = toReadableError(sttErr, "STT error (all fallbacks exhausted)");
              logger.error({ callId, err: sttErr }, reason);
              send({ type: "error", message: reason });
              speaking = false;
              speakingEndedAt = Date.now();
              processing = false;
              if (!closed) void hangup("error", reason);
              return;
            }
          } else {
            const reason = toReadableError(sttErr, "STT error");
            logger.error({ callId, err: sttErr }, reason);
            send({ type: "error", message: reason });
            speaking = false;
            speakingEndedAt = Date.now();
            processing = false;
            if (!closed) void hangup("error", reason);
            return;
          }
        }
      }

      if (_tSttFinal === 0) _tSttFinal = performance.now(); // batch STT path: stamp after all fallbacks
      // Empty transcript — do NOT clear the stall backstop; let it fire so the
      // caller is reprompted rather than left in a silent "Listening…" hang.
      if (!userText?.trim()) { processing = false; return; }

      safetyNet.onFinal();   // usable transcript — clear safety timers
      beganTurn = true;

      // Persist utterance analytics (fire-and-forget — never blocks the pipeline).
      db.insert(utterancesTable).values({
        callId:         callId,
        text:           userText.trim(),
        provider:       agent.asrProvider,
        latencyMs:      pendingSttMeta?.endDetectToFinalMs ?? null,
        mergedSegments: pendingSttMeta?.mergedSegments ?? 1,
        pauseCount:     pendingSttMeta?.pauseCount      ?? 0,
        coalesced:      (pendingSttMeta?.mergedSegments ?? 1) > 1,
      }).catch((err) => logger.warn({ callId, err }, "Webcall: utterance insert failed (non-fatal)"));

      // P0-A: Garbled transcript recovery — catch noise/garbage before it reaches the LLM
      {
        const { isGarbled, reason: garbledReason } = checkTranscriptQuality(userText);
        if (isGarbled) {
          const clarification = pickClarificationPhrase();
          logger.warn({ callId, transcript: userText, garbledReason }, "Webcall: garbled transcript — responding with clarification");
          history.push({ role: "assistant", content: clarification });
          send({ type: "transcript", speaker: "agent", text: clarification });
          recentAgentText.push({ text: stripSsml(normalizeIndic(clarification)), at: Date.now() });
          try {
            const { audio: rawAudio } = await tts.synthesize(clarification);
            if (!closed) {
              // Pad with trailing PCM silence (same as the main per-sentence and
              // terminal-utterance paths) so the client's AudioContext has samples
              // queued past the final word.
              const audio = withTailSilence(rawAudio);
              const _audioDurationMs = Math.round((audio.length / 2 / 16000) * 1000);
              sendStatus("speaking");
              speaking = true;
              speakingStartedAt = Date.now();
              const _clarPbStart = Date.now();
              logPlaybackEvent(logExecution, "Playback Started", { provider: agent.ttsProvider, turnNumber: _curTurnIdx });
              {
                const sentenceDurationMs = Math.round((audio.length / 2 / 16000) * 1000);
                echoGraceUntil = Date.now() + sentenceDurationMs + echoGraceMs;
              }
              for (let j = 0; j < audio.length; j += AUDIO_CHUNK_BYTES) {
                if (closed || interrupted) break;
                sendSpeechAudio(audio.slice(j, j + AUDIO_CHUNK_BYTES));
                await new Promise<void>((r) => setTimeout(r, 40));
              }
              // Tail-silence drain — physically extend the client's scheduled
              // audio timeline past the final word so the clarification isn't
              // clipped on return to listening (a passive wait does NOT help on
              // web), and hold echo grace through the whole drain + echo-decay
              // margin so the agent's own trailing echo can't trip a false
              // barge-in. Mirrors the main per-sentence playback tail.
              if (!interrupted && !closed) {
                echoGraceUntil = Math.max(
                  echoGraceUntil,
                  Date.now() + AUDIO_TAIL_SILENCE_MS + WEB_TAIL_ECHO_MARGIN_MS,
                );
                const silenceChunk = Buffer.alloc(AUDIO_CHUNK_BYTES, 0);
                const silenceFrames = Math.ceil(AUDIO_TAIL_SILENCE_MS / 40);
                for (let s = 0; s < silenceFrames && !interrupted && !closed; s++) {
                  sendAudio(silenceChunk);
                  await new Promise<void>((r) => setTimeout(r, 40));
                }
              }
              const _clarEvent: PlaybackEvent = closed
                ? "Playback Cancelled"
                : interrupted
                  ? "Playback Interrupted"
                  : "Playback Completed";
              logPlaybackEvent(logExecution, _clarEvent, {
                provider: agent.ttsProvider,
                turnNumber: _curTurnIdx,
                playbackDurationMs: Date.now() - _clarPbStart,
                audioDurationMs: _audioDurationMs,
                stopReason: closed ? "call_closed" : interrupted ? "barge_in" : "completed",
              });
              speaking = false;
              speakingEndedAt = Date.now();
            }
          } catch { /* ignore TTS errors on clarification */ }
          processing = false;
          return;
        }
      }

      const _sttMeta = pendingSttMeta;
      pendingSttMeta = null;
      logExecution("STT", "response", {
        provider: agent.asrProvider,
        responsePayload: { transcript: userText, ...(_sttMeta ?? {}) },
        latencyMs: _sttMeta?.lastPartialToFinalMs ? Math.round(_sttMeta.lastPartialToFinalMs) : undefined,
        turnNumber: _curTurnIdx,
        status: "success",
      });
      send({ type: "transcript", speaker: "user", text: userText });
      history.push({ role: "user", content: userText });

      // Real-time name + fact latch — fire-and-forget, never blocks the agent turn
      if (webcallIdentifier) {
        void latchCallerName({ agentId, phoneNumber: webcallIdentifier, transcript: userText, existingName: webcallProfile?.name ?? null, callId }).then((latched) => {
          if (latched && webcallProfile) webcallProfile = { ...webcallProfile, name: latched };
          if (latched) webcallNameLatchedThisCall = latched;
        });
        void latchCallerFact({ agentId, phoneNumber: webcallIdentifier, transcript: userText, callId, existingFacts: webcallLatchedFacts }).then((updated) => { webcallLatchedFacts = updated; });
      }

      // ── Progressive gender detection — fire after each confirmed user turn ─
      // Non-blocking: detection runs async and updates genderDetector.gender
      // for the NEXT turn's salutation. The greeting always uses neutral.
      if (genderDetector && !genderDetector.locked) genderDetector.runDetection();

      // ── End-call phrase detection ──────────────────────────────────────────
      // Mirror pipeline.ts: if the user says a configured goodbye phrase, speak
      // a goodbye aloud then end the call without routing through the LLM.
      if (agent.endCallPhrases) {
        const phrases = agent.endCallPhrases.split(",").map((s: string) => s.trim()).filter(Boolean);
        if (phrases.length > 0) {
          const lower = userText.toLowerCase();
          const matchedPhrase = phrases.find((p: string) => lower.includes(p.toLowerCase()));
          if (matchedPhrase) {
            logger.info({ callId, userText }, "Webcall: end-call phrase detected — speaking goodbye then hanging up");
            processing = false;
            const goodbyeText = phrases[0]?.trim() || DEFAULT_GOODBYE_MESSAGE;
            history.push({ role: "assistant", content: goodbyeText });
            send({ type: "transcript", speaker: "agent", text: goodbyeText });
            await speakFinalUtterance(goodbyeText);
            if (!closed) void hangup("normal");
            return;
          }
        }
      }

      // 2. LLM — stream tokens, kick off TTS synthesis per sentence in parallel
      // Each job starts as soon as its sentence is extracted, so synthesis
      // overlaps with LLM streaming. By the time LLM finishes, sentence 1
      // audio is usually already fully collected — minimising first-audio delay.
      // StreamJob: synthesis started immediately; readChunks() yields PCM as it
      // arrives from the TTS provider (no full-buffer wait).  Used when the
      // provider exposes synthesizeStream.  Fallback is Promise<Buffer>.
      type StreamJob = { readChunks: () => AsyncGenerator<Buffer>; done: Promise<void> };
      let sentenceJobs: (Promise<Buffer> | StreamJob)[] = [];
      let sentenceTexts: string[] = [];  // parallel to sentenceJobs — canonical text per sentence for UI highlighting
      let sentenceSynthDoneAt: number[] = []; // STEP 0b diag: ms wall-clock when each sentence's TTS audio finished synthesizing
      let tokenBuf    = "";   // filtered text waiting to be split into sentences
      let fullReply   = "";   // raw LLM output (may include <think> blocks)

      // ── Reasoning-block filter (shared with pipeline.ts) ──────────────────
      // Drops <think>/<thinking>/<reasoning> blocks token-by-token, hardened
      // against tags split across token boundaries.
      let filterThinkToken = makeThinkFilter();
      // One-step output guard: suppress any second question (and everything
      // after) so a multi-step dump is truncated at the first natural yield point.
      let stepGuard = makeFlowStepGuard();

      // ── Function-tag filter: strips <function=NAME>…</function> from TTS ──
      // Mirrors makeFunctionTagFilter() in pipeline.ts but inlined for webcall.
      let inFnTag = false;
      let fnBuf = "";

      function filterFnToken(token: string): string {
        fnBuf += token;
        let out = "";
        while (fnBuf.length > 0) {
          if (inFnTag) {
            const closeIdx = fnBuf.indexOf("</function>");
            if (closeIdx !== -1) {
              inFnTag = false;
              fnBuf = fnBuf.slice(closeIdx + "</function>".length);
            } else {
              const tail = Math.max(0, fnBuf.length - "</function>".length + 1);
              fnBuf = fnBuf.slice(tail);
              break;
            }
          } else {
            const openIdx = fnBuf.indexOf("<function=");
            if (openIdx !== -1) {
              out += fnBuf.slice(0, openIdx);
              const relGt = fnBuf.indexOf(">", openIdx);
              if (relGt !== -1) {
                if (fnBuf[relGt - 1] === "/") {
                  fnBuf = fnBuf.slice(relGt + 1);
                } else {
                  inFnTag = true;
                  fnBuf = fnBuf.slice(relGt + 1);
                }
              } else {
                fnBuf = fnBuf.slice(openIdx);
                break;
              }
            } else {
              const tail = Math.max(0, fnBuf.length - "<function=".length + 1);
              out += fnBuf.slice(0, tail);
              fnBuf = fnBuf.slice(tail);
              break;
            }
          }
        }
        return out;
      }
      // ── Markup-tag filter: strips <emotion …>/</emotion>/<break …/> from TTS ──
      // Mirrors makeMarkupTagFilter() in pipeline.ts but inlined for webcall.
      // Keeps the speakable text between the tags; buffers partial tags split
      // across streaming chunks; collapses double spaces left behind.
      const MARKUP_STRIP_PREFIXES = ["<emotion", "</emotion", "<break"];
      let markupBuf = "";
      let markupPrevSpace = false;

      function filterMarkupToken(token: string): string {
        markupBuf += token;
        let raw = "";
        while (markupBuf.length > 0) {
          const lt = markupBuf.indexOf("<");
          if (lt === -1) {
            raw += markupBuf;
            markupBuf = "";
            break;
          }
          raw += markupBuf.slice(0, lt);
          markupBuf = markupBuf.slice(lt);
          const lower = markupBuf.toLowerCase();
          let matched = false;
          let partial = false;
          for (const p of MARKUP_STRIP_PREFIXES) {
            if (lower.startsWith(p)) { matched = true; break; }
            if (p.startsWith(lower)) { partial = true; }
          }
          if (matched) {
            const gt = markupBuf.indexOf(">");
            if (gt === -1) break;
            markupBuf = markupBuf.slice(gt + 1);
          } else if (partial) {
            break;
          } else {
            raw += "<";
            markupBuf = markupBuf.slice(1);
          }
        }
        let out = "";
        for (const ch of raw) {
          if (ch === " ") {
            if (markupPrevSpace) continue;
            markupPrevSpace = true;
            out += ch;
          } else {
            markupPrevSpace = false;
            out += ch;
          }
        }
        return out;
      }
      // ── Bracket filter: drops long [instruction…] blocks from TTS ────────
      // Mirrors makeBracketFilter() in pipeline.ts but inlined for webcall.
      // Prevents the LLM from leaking system-prompt instructions verbatim when
      // it wraps them in square brackets (e.g. "[Varsha's persona instructions: …]").
      // Short spans (< 120 chars) like "[WHO]" or "[TamilNadu]" are kept intact.
      const BRACKET_DISCARD_LEN_WC = 120;
      let inBracketBlock = false;
      let bracketOuterBuf = "";
      let bracketContent = "";

      function filterBracketToken(token: string): string {
        bracketOuterBuf += token;
        let out = "";
        while (bracketOuterBuf.length > 0) {
          if (inBracketBlock) {
            const closeIdx = bracketOuterBuf.indexOf("]");
            if (closeIdx !== -1) {
              bracketContent += bracketOuterBuf.slice(0, closeIdx);
              bracketOuterBuf = bracketOuterBuf.slice(closeIdx + 1);
              inBracketBlock = false;
              if (bracketContent.length < BRACKET_DISCARD_LEN_WC) out += "[" + bracketContent + "]";
              bracketContent = "";
            } else {
              bracketContent += bracketOuterBuf; bracketOuterBuf = "";
              if (bracketContent.length > 800) bracketContent = bracketContent.slice(-20);
              break;
            }
          } else {
            const openIdx = bracketOuterBuf.indexOf("[");
            if (openIdx !== -1) {
              out += bracketOuterBuf.slice(0, openIdx);
              bracketOuterBuf = bracketOuterBuf.slice(openIdx + 1);
              inBracketBlock = true; bracketContent = "";
            } else {
              out += bracketOuterBuf; bracketOuterBuf = ""; break;
            }
          }
        }
        return out;
      }
      // ──────────────────────────────────────────────────────────────────────
      /**
       * Normalize LLM text for TTS so abbreviations are not spelled letter-by-letter.
       *
       * Problems this solves:
       *   "T. Nagar"  → TTS reads "T N A G A R" (treats dot as abbreviation marker)
       *   "AMD", "STT" → TTS spells out each letter
       *
       * Fixes:
       *   1. Strip period from single-letter abbreviations: "T. " → "T "
       *      (common in Indian place names: T. Nagar, R.K. Salai, M.G. Road)
       *   2. Lowercase isolated ALL-CAPS words 2–5 chars so TTS reads them as
       *      a word instead of spelling each letter: "AMD" → "amd"
       */
      function normalizeTtsText(raw: string): string {
        // "T. Nagar" → "T Nagar", "R.K. Salai" → "R K Salai"
        let out = raw.replace(/\b([A-Z])\.\s*/g, "$1 ");
        // "AMD" → "amd", "STT" → "stt" (2-5 consecutive uppercase letters standing alone)
        out = out.replace(/\b([A-Z]{2,5})\b/g, (m) => m.toLowerCase());
        // collapse any double-spaces introduced by the above
        return out.replace(/  +/g, " ").trim();
      }

      function queueSentence(text: string) {
        const t = normalizeTtsText(text);
        if (!t) return;
        if (_llmStreamActive && _tLlmFirstClause === null) {
          _tLlmFirstClause = performance.now();
        }
        ttsCharactersTotal += t.length;
        const ttsReqStart = Date.now();
        logExecution("TTS", "request", {
          provider: agent.ttsProvider,
          requestPayload: { text: t },
          turnNumber: _curTurnIdx,
          status: "info",
        });
        // Kick off synthesis immediately so it runs in parallel with LLM streaming.
        // If synthesizeStream is available, use it to collect the full audio via
        // HTTP streaming (potentially faster than waiting for the full response).
        // Either way, the job resolves to a complete Buffer — played from memory
        // with no per-chunk network jitter.
        const _jobIdx = sentenceJobs.length; // STEP 0b diag: stable index for this sentence's synth-done stamp
        if (tts.synthesizeStream) {
          // ── True-streaming path ────────────────────────────────────────────
          // Cartesia (and any provider with synthesizeStream) delivers the first
          // PCM byte in ~80-150ms.  We pipe chunks directly into an async queue
          // so the playback loop can start sending audio to the browser the
          // moment the first chunk arrives — no full-buffer wait.
          const chunkQueue: Buffer[] = [];
          let totalBytes = 0;
          let synthFinished = false;
          let wakeup: (() => void) | null = null;
          let firstByteMs: number | null = null; // ms from request to first PCM byte (Cartesia TTFB)

          const synthDone = tts.synthesizeStream!(
            t,
            (c) => {
              if (firstByteMs === null) firstByteMs = Date.now() - ttsReqStart;
              if (_tTtsFirstByte === null) _tTtsFirstByte = performance.now();
              totalBytes += c.length;
              chunkQueue.push(c);
              if (wakeup) { const r = wakeup; wakeup = null; r(); }
            },
            () => {
              sentenceSynthDoneAt[_jobIdx] = Date.now();
              logger.info({ callId, sentenceText: t, audioBytes: totalBytes }, "TTS sentence synthesized");
              logExecution("TTS", "response", {
                provider: agent.ttsProvider,
                // latencyMs = time to LAST byte (full synthesis); firstByteMs = Cartesia TTFB (~40-90ms + network)
                responsePayload: { audioBytes: totalBytes, textLength: t.length, firstByteMs: firstByteMs ?? null },
                latencyMs: Date.now() - ttsReqStart,
                turnNumber: _curTurnIdx,
                durationMs: Date.now() - ttsReqStart,
                status: "success",
              });
              synthFinished = true;
              if (wakeup) { const r = wakeup; wakeup = null; r(); }
            },
          );
          synthDone.catch(() => {
            synthFinished = true;
            if (wakeup) { const r = wakeup; wakeup = null; r(); }
          });

          const readChunks = async function* (): AsyncGenerator<Buffer> {
            while (true) {
              while (chunkQueue.length > 0) yield chunkQueue.shift()!;
              if (synthFinished) break;
              await new Promise<void>((r) => { wakeup = r; });
            }
          };

          sentenceJobs.push({ readChunks, done: synthDone });
        } else {
          // ── Buffered fallback (providers without synthesizeStream) ─────────
          const job: Promise<Buffer> = tts.synthesize(t).then(({ audio }) => {
            sentenceSynthDoneAt[_jobIdx] = Date.now();
            logger.info({ callId, sentenceText: t, audioBytes: audio.length }, "TTS sentence synthesized");
            logExecution("TTS", "response", {
              provider: agent.ttsProvider,
              responsePayload: { audioBytes: audio.length, textLength: t.length },
              latencyMs: Date.now() - ttsReqStart,
              turnNumber: _curTurnIdx,
              durationMs: Date.now() - ttsReqStart,
              status: "success",
            });
            return withTailSilence(audio);
          });
          job.catch(() => {});
          sentenceJobs.push(job);
        }
        sentenceTexts.push(t);
      }

      // Build per-turn system prompt with datetime + language + gender injected
      let systemPromptForTurn = systemPrompt;
      const agentTimezone = (agentCfg["timezone"] as string | undefined) || "Asia/Kolkata";
      const dtInjection = buildDatetimeInjection(agentTimezone);
      // Language guard placed at BOTH top (highest LLM attention) and bottom (recency).
      // Prevents Gemini/GPT from drifting to English when confused by an unfamiliar name.
      const LANG_NAMES: Record<string, string> = {
        "hi-IN": "Hindi", "ta-IN": "Tamil", "te-IN": "Telugu", "kn-IN": "Kannada",
        "ml-IN": "Malayalam", "mr-IN": "Marathi", "bn-IN": "Bengali", "gu-IN": "Gujarati",
        "pa-IN": "Punjabi", "or-IN": "Odia", "ur-IN": "Urdu",
        "en-IN": "English", "en-US": "English", "en-GB": "English",
        "fr-FR": "French", "de-DE": "German", "es-ES": "Spanish", "pt-BR": "Portuguese",
        "it-IT": "Italian", "ja-JP": "Japanese", "ko-KR": "Korean", "zh-CN": "Chinese",
        "ar-EG": "Arabic", "ru-RU": "Russian",
      };
      let wcLangGuard = "";
      if (currentLangWc) {
        const langName = LANG_NAMES[currentLangWc] ?? currentLangWc;
        wcLangGuard =
          `[LANGUAGE — ABSOLUTE RULE] You MUST respond ONLY in ${langName}. ` +
          `This applies to EVERY reply without exception — including when you are confused, ` +
          `do not understand a word, encounter an unfamiliar name, or the caller speaks in another language. ` +
          `Never switch to English or any other language under any circumstances.`;
      }
      systemPromptForTurn = wcLangGuard
        ? `${wcLangGuard}\n\n${dtInjection}\n\n${systemPromptForTurn}\n\n${wcLangGuard}`
        : `${dtInjection}\n\n${systemPromptForTurn}`;

      // Auto-switch to English: when enabled, allow the agent to move to English mid-call on request.
      if (agentCfg["autoSwitchToEnglish"] === true) {
        systemPromptForTurn += `\n\nIf the caller asks you to speak in English, switch immediately and continue in English.`;
      }

      const detectedGender = genderDetector?.gender ?? null;
      if (detectedGender === "male") {
        systemPromptForTurn += `\n\n[CALLER GENDER] The caller has been identified as male. Always address them respectfully as "${maleSal}" when appropriate (e.g. "Yes, ${maleSal}", "Of course, ${maleSal}"). Never use "${femaleSal}".`;
      } else if (detectedGender === "female") {
        systemPromptForTurn += `\n\n[CALLER GENDER] The caller has been identified as female. Always address them respectfully as "${femaleSal}" when appropriate (e.g. "Yes, ${femaleSal}", "Of course, ${femaleSal}"). Never use "${maleSal}".`;
      } else if (neutralSal) {
        systemPromptForTurn += `\n\n[CALLER GENDER] Gender could not be determined. Use "${neutralSal}" as a neutral salutation when appropriate.`;
      }

      // ── Substitute {caller_salutation} placeholder ────────────────────────
      // The initial variable-resolution pass deliberately skips this placeholder
      // so it can be filled in here, after gender detection has resolved.
      {
        const rawSal = detectedGender === "male" ? maleSal
          : detectedGender === "female" ? femaleSal
          : neutralSal;
        const resolvedSal = (rawSal === "(skip)" || !rawSal) ? "" : rawSal;
        if (resolvedSal) {
          systemPromptForTurn = systemPromptForTurn
            .replace(/\{\{caller_salutation\}\}/g, resolvedSal)
            .replace(/\{caller_salutation\}/g, resolvedSal);
        } else {
          systemPromptForTurn = systemPromptForTurn
            .replace(/\s*\{\{caller_salutation\}\}\s*/g, " ")
            .replace(/\s*\{caller_salutation\}\s*/g, " ");
        }
        logger.info({ callId, resolvedSalutation: resolvedSal || "(empty)", detectedGender }, "Webcall: caller_salutation resolved");
      }

      // Callback scheduling hint — only inject when callback detection is enabled
      // (avoids bloating every LLM request for agents that never use callbacks)
      const callbackDetectionEnabled = (agentCfg["callbackDetectionEnabled"] as boolean | undefined) ?? true;
      if (callbackDetectionEnabled) {
        systemPromptForTurn += `\n\n[CALLBACK SCHEDULING] If the user asks you to call them back after a delay (e.g. "call me back in 10 minutes", "remind me in an hour"), you MUST agree and confirm the request. Say something like "Sure, I'll call you back in X minutes." Do NOT say you are unable to schedule callbacks or make outbound calls — the platform will automatically schedule and deliver the callback. Simply confirm the time and end the conversation naturally.`;
      }

      // ── Build tool definitions for this agent ─────────────────────────────
      const agentTools = (agent.tools ?? []) as unknown as import("../types.js").AgentTool[];
      // Parsed End Call Phrases (raw comma-separated string → trimmed list),
      // used to resolve the spoken goodbye for LLM-driven end-calls below.
      const endCallPhraseList = agent.endCallPhrases
        ? agent.endCallPhrases.split(",").map((s: string) => s.trim()).filter(Boolean)
        : [];

      // Inject scheduling tool usage guide when the agent has cancel/reschedule/list-bookings tools
      const hasSchedulingNav = agentTools.some(
        (t) => t.type === "native_cancel" || t.type === "native_reschedule" || t.type === "native_list_bookings",
      );
      if (hasSchedulingNav) {
        const listTool = agentTools.find((t) => t.type === "native_list_bookings");
        const checkTool = agentTools.find((t) => t.type === "native_check_availability");
        const cancelTool = agentTools.find((t) => t.type === "native_cancel");
        const rescheduleTool = agentTools.find((t) => t.type === "native_reschedule");
        const listName = listTool?.name ?? "get_bookings";
        const checkName = checkTool?.name ?? "check_availability";
        const navDefaultTz = (listTool as any)?.timezone ?? (cancelTool as any)?.timezone ?? (rescheduleTool as any)?.timezone ?? (checkTool as any)?.timezone ?? "Asia/Kolkata";
        systemPromptForTurn += [
          "",
          "",
          "[SCHEDULING TOOL GUIDE]",
          "State machine for cancel/reschedule:",
          `1. ALWAYS call "${listName}" (not "${checkName}") to look up their existing appointment by name. Never call "${checkName}" for this purpose.`,
          `2. Always pass timezone="${navDefaultTz}" into every scheduling tool call. NEVER ask the caller what timezone they are in — default silently to "${navDefaultTz}" unless the caller explicitly asks about a different timezone.`,
          `3. If "${listName}" returns an empty result, say: "There are no upcoming bookings under your name."`,
          `4. If all returned bookings are in the past, say: "Your previous appointment has already passed — I can only reschedule upcoming ones. Would you like to book a new one?"`,
          `5. Once a booking is identified for rescheduling: call "${checkName}" for the SAME DATE as the existing booking unless the caller explicitly states a different date. Use the booking's existing date as preferred_date.`,
          `6. After the caller confirms a new slot, call the reschedule tool. Once reschedule_confirmed is returned, the context is cleared.`,
          `IMPORTANT: NEVER invent or guess slot times. You MUST call "${checkName}" before offering any available times to the caller. Only relay times that you received from a tool result.`,
        ].join("\n");

        // Inject active reschedule context so the LLM defaults to the correct date
        if (activeRescheduleBooking) {
          systemPromptForTurn += buildRescheduleContextBlock(activeRescheduleBooking);
        }
      }

      // Inject booking/availability guide when the agent has a native_booking or native_check_availability tool
      const hasBookingTool = agentTools.some((t) => t.type === "native_booking");
      const hasCheckAvailabilityTool = agentTools.some((t) => t.type === "native_check_availability");
      if (hasBookingTool || hasCheckAvailabilityTool) {
        const bookTool = agentTools.find((t) => t.type === "native_booking");
        const checkTool = agentTools.find((t) => t.type === "native_check_availability");
        const bookName = bookTool?.name ?? "book_appointment";
        const checkName = checkTool?.name ?? "check_availability";
        // Use the tool's configured default timezone; fall back to Asia/Kolkata
        const calDefaultTz = (bookTool as any)?.timezone ?? (checkTool as any)?.timezone ?? "Asia/Kolkata";
        const lines = [
          "",
          "",
          "[BOOKING TOOL GUIDE]",
          `CRITICAL: NEVER invent, guess, or assume any available slot times. You MUST call "${checkName}" before telling the caller any available times. Only relay times you received directly from a "${checkName}" tool result.`,
          `TIMEZONE RULE: The calendar is configured for timezone "${calDefaultTz}". Always pass timezone="${calDefaultTz}" in every tool call. NEVER ask the caller what timezone they are in — default silently to "${calDefaultTz}" unless the caller explicitly asks about a different timezone, in which case use that IANA timezone string.`,
        ];
        if (hasCheckAvailabilityTool) {
          lines.push(
            `"${checkName}" ONLY checks available slots — it does NOT create a booking.`,
            `"${checkName}" returns one of three result types:`,
            `  • requested_slot_available — the exact time the caller asked for is open. Tell the caller the time is available, then immediately ask for their full name and email and call "${bookName}" with the ISO string from the 'slot' field verbatim as preferred_date.`,
            `  • requested_slot_unavailable — the requested time is not open. Tell the caller and read out the slots from the 'alternatives' field. Once the caller picks one, collect their name and email and call "${bookName}" with the chosen ISO string verbatim as preferred_date.`,
            `  • available_slots — a general list of upcoming slots. Each entry in 'next' is an ISO 8601 string followed by a human label in parentheses. Present them to the caller. After the caller picks one, collect name and email and call "${bookName}" with the ISO string verbatim as preferred_date.`,
            `Always pass ISO strings to "${bookName}" exactly as returned — never reformat or convert them.`,
          );
        }
        if (hasBookingTool) {
          lines.push(
            `Before calling "${bookName}", you MUST collect the caller's full name and email address. Ask for them if not yet provided.`,
            `NEVER tell the caller their appointment is confirmed or scheduled unless you have received a booking_confirmed: result from "${bookName}".`,
            `Do NOT say "Your appointment has been scheduled" or any equivalent phrase before "${bookName}" returns a booking_confirmed: result.`,
            `When "${bookName}" returns booking_pending: — the booking was received but NOT confirmed. Tell the caller ONLY: "Your appointment request has been received and is pending confirmation — we'll follow up to confirm it." Do NOT say it is booked, scheduled, or confirmed. NEVER mention internal reasons like "Google Calendar", "calendar event creation failed", or any technical system error to the caller — just say it is pending confirmation.`,
            `When "${bookName}" returns booking_failed: — the booking could not be created. Tell the caller the booking could not be completed and ask them to try again or call back. Do NOT mention technical errors or system details.`,
          );
        }
        systemPromptForTurn += lines.join("\n");
      }

      const toolDefs = buildToolDefs(agentTools);
      // schedule_callback is always available so the LLM knows about it
      toolDefs.push({
        name: "schedule_callback",
        description: "Schedule a callback call for this caller. Call this when the caller asks to be called back later.",
        parameters: {
          type: "object" as const,
          properties: {
            scheduled_at: { type: "string", description: "ISO 8601 datetime to call back. Omit to default to 1 hour from now." },
            notes: { type: "string", description: "Brief note about why the callback was requested." },
          },
        },
      });
      let triggeredToolName: string | null = null;
      let triggeredToolArgs: Record<string, unknown> = {};

      // P1-I: Start Speaking Plan — content-based delay before triggering LLM
      if (startSpeakingPlanCfg && !interrupted) {
        const lastChar = userText.trimEnd().slice(-1);
        let spDelay = 0;
        if (/[.?!।]/.test(lastChar)) {
          spDelay = Math.round((startSpeakingPlanCfg.onPunctuationSeconds ?? 0) * 1000);
        } else if (/[0-9]/.test(lastChar)) {
          spDelay = Math.round((startSpeakingPlanCfg.onNumberSeconds ?? 0) * 1000);
        } else {
          spDelay = Math.round((startSpeakingPlanCfg.onNoPunctuationSeconds ?? 0) * 1000);
        }
        spDelay += Math.round((startSpeakingPlanCfg.waitSeconds ?? 0) * 1000);
        if (spDelay > 0 && !interrupted) {
          await new Promise<void>((r) => setTimeout(r, spDelay));
        }
      }

      // ── Multi-step tool calling loop ───────────────────────────────────────
      // Tool definitions stay attached on every turn so the agent can chain
      // multiple tools in a single user turn — e.g. check_availability →
      // book_appointment → end_call — instead of only executing the first one.
      // A hard iteration cap prevents runaway loops; once reached we run one
      // final turn with tools detached so the agent simply narrates and stops.
      const MAX_TOOL_ITERATIONS = 5;
      let toolIterations = 0;
      let attachTools = true;

      while (true) {
      sentenceJobs = [];
      sentenceTexts = [];
      // ── Backchanneling: queue a filler phrase before LLM warms up ─────────
      // Only on the first tool iteration so we don't repeat after tool calls.
      if (toolIterations === 0 && agent.backchannelingEnabled && !interrupted) {
        const freq = (agent.backchannelingFrequency ?? 0.6) as number;
        if (Math.random() < freq) {
          // Strict, language-based fillers only — no cross-language fallback.
          const fillerLang = agent.asrLanguage ?? agent.language;
          const phrasePool = getBackchannelFillers(fillerLang);
          if (phrasePool.length > 0) {
            const phrase = phrasePool[Math.floor(Math.random() * phrasePool.length)]!;
            logger.info(
              {
                callId,
                fillerType: "backchannel",
                language: fillerLang,
                backchannelingEnabled: agent.backchannelingEnabled,
                fillerListLength: phrasePool.length,
                selectedFiller: phrase,
                ttsText: phrase,
              },
              "Webcall: backchannel filler selected (language-aware)",
            );
            queueSentence(phrase);
          } else {
            logger.info(
              {
                callId,
                fillerType: "backchannel",
                language: fillerLang,
                backchannelingEnabled: agent.backchannelingEnabled,
                fillerListLength: 0,
              },
              "Webcall: backchannel filler skipped — no filler set for language",
            );
          }
        }
      }
      tokenBuf = "";
      fullReply = "";
      filterThinkToken = makeThinkFilter();
      stepGuard = makeFlowStepGuard();
      inFnTag = false;
      fnBuf = "";
      markupBuf = "";
      markupPrevSpace = false;
      triggeredToolName = null;
      triggeredToolArgs = {};

      // ── Keepalive ping — prevents Replit proxy from closing the WS while the
      // LLM is "thinking" (some providers, e.g. sarvam-30b, have 15–20 s TTFT).
      // Without this the proxy kills the connection before the first token arrives.
      const llmKeepalive = setInterval(() => {
        if (closed || ws.readyState !== ws.OPEN) return;
        try { ws.ping(); } catch { /* ignore */ }
      }, 8_000);

      // Refresh [ACTIVE RESCHEDULE CONTEXT] per iteration in case list_bookings set it
      // during a previous tool iteration in the same user turn (the initial systemPromptForTurn
      // was built before those tool results arrived, so it may lack the context block).
      let iterSystemPrompt = systemPromptForTurn;
      if (hasSchedulingNav && activeRescheduleBooking && !iterSystemPrompt.includes("[ACTIVE RESCHEDULE CONTEXT]")) {
        iterSystemPrompt += buildRescheduleContextBlock(activeRescheduleBooking);
      }

      // Per-turn language reminder: append a compact note to the last user turn
      // in the history copy sent to the LLM. Sits immediately before generation —
      // the strongest possible enforcement against mid-conversation English drift.
      let historyForLlm = history as ConversationTurn[];
      if (wcLangGuard && toolIterations === 0 && history.length > 0) {
        const lastTurn = history[history.length - 1]!;
        if (lastTurn.role === "user") {
          const langName = LANG_NAMES[currentLangWc ?? ""] ?? currentLangWc ?? "";
          historyForLlm = [
            ...history.slice(0, -1),
            { ...lastTurn, content: `${lastTurn.content}\n\n[Reminder: reply in ${langName} only]` },
          ];
        }
      }
      // Per-turn conversation-discipline reminder — mirrors pipeline.ts. Appended
      // to the last user turn (highest LLM attention, just before generation) so
      // one-step delivery / wait-for-response / resume-after-objection survive
      // long prompts. Only on the first tool iteration so it isn't re-stacked.
      if (toolIterations === 0 && historyForLlm.length > 0) {
        const lastTurn = historyForLlm[historyForLlm.length - 1]!;
        if (lastTurn.role === "user") {
          historyForLlm = [
            ...historyForLlm.slice(0, -1),
            { ...lastTurn, content: `${lastTurn.content}\n\n${CONVERSATION_DISCIPLINE_TURN_REMINDER}` },
          ];
        }
      }
      // Cap input tokens: keep only the last 12 entries (6 exchange pairs).
      // Beyond that, LLM input grows unboundedly — call-63 showed 4k→8k→13k→18k tokens
      // in 4 turns, pushing LLM latency toward 2s+ by turn 8. Earlier context is
      // already in the system prompt's caller memory/facts section.
      const MAX_HISTORY_ENTRIES = 8; // 4 exchange pairs — caps LLM input at ~18k tokens
      if (historyForLlm.length > MAX_HISTORY_ENTRIES) {
        historyForLlm = historyForLlm.slice(-MAX_HISTORY_ENTRIES);
      }

      const llmStartMs = Date.now();
      logExecution("LLM", "request", {
        provider: agent.llmProvider,
        requestPayload: {
          model: (agent as any).llmModel ?? "default",
          systemPromptPreview: iterSystemPrompt.substring(0, 800),
          historyLength: history.length,
          tools: attachTools ? toolDefs.map((t: any) => t.function?.name ?? t.name).filter(Boolean) : [],
        },
        turnNumber: _curTurnIdx,
        status: "info",
      });

      try {
       await llm.chat(
        historyForLlm,
        iterSystemPrompt,
        (token) => {
          if (_tLlmFirstToken === null) {
            _tLlmFirstToken = performance.now(); _llmStreamActive = true;
            logExecution("LLM", "system", {
              provider: agent.llmProvider,
              status: "info",
              turnNumber: _curTurnIdx,
              durationMs: Date.now() - llmStartMs,
              metadata: { event: "First Token Received", ttftMs: Date.now() - llmStartMs },
            });
          }
          fullReply += token;                         // keep raw (for cleaning later)
          const afterThink = filterThinkToken(token); // strip <think>…</think>
          if (!afterThink) return;                    // token was entirely inside a think block
          const afterFn = filterFnToken(afterThink);  // strip <function=…> inline tags from TTS
          if (!afterFn) return;
          const filtered = filterMarkupToken(afterFn); // strip <emotion>/<break> markup from TTS
          if (!filtered) return;
          const afterBrackets = filterBracketToken(filtered); // drop long [instruction…] leaks
          if (!afterBrackets) return;
          tokenBuf += afterBrackets;
          send({ type: "token", text: afterBrackets });
          const [sentences, rest] = extractSentences(tokenBuf, ttsMinSentenceChars);
          for (const s of sentences) {
            const g = stepGuard.push(s);
            if (g) queueSentence(g);
          }
          tokenBuf = rest;
        },
        (full) => { fullReply = full; },
        attachTools && toolDefs.length > 0
          ? {
              tools: toolDefs,
              onToolCall: (name, args) => {
                triggeredToolName = name;
                triggeredToolArgs = args;
              },
              onUsage: (u) => { llmInputTokensTotal += u.inputTokens; llmOutputTokensTotal += u.outputTokens; },
            }
          : { onUsage: (u: import("../types.js").LLMUsage) => { llmInputTokensTotal += u.inputTokens; llmOutputTokensTotal += u.outputTokens; } },
      );
      } catch (llmErr) {
        clearInterval(llmKeepalive);
        // P0-B: LLM fallback — retry with fallback adapter if no tokens were produced
        const fallbackProvider = (agent as any).llmFallbackProvider as string | null | undefined;
        const fallbackModel = (agent as any).llmFallbackModel as string | null | undefined;
        if (_tLlmFirstToken === null && fallbackProvider) {
          const fallbackKey = providerKeys.get(fallbackProvider.toLowerCase());
          if (fallbackKey) {
            logger.warn({ callId, err: llmErr, fallbackProvider }, "Webcall: primary LLM failed (no tokens) — retrying with fallback");
            logWarningEvent(logExecution, EXEC_COMPONENTS.LLM, "LLM Retry", ["llm_retry"], {
              provider: fallbackProvider,
              retryCount: 1,
              detail: {
                event: "LLM Retry",
                fromProvider: agent.llmProvider,
                toProvider: fallbackProvider,
                error: toReadableError(llmErr, "LLM error"),
              },
            });
            tokenBuf = "";
            fullReply = "";
            filterThinkToken = makeThinkFilter(); stepGuard = makeFlowStepGuard();
            inFnTag = false; fnBuf = "";
            markupBuf = ""; markupPrevSpace = false;
            inBracketBlock = false; bracketOuterBuf = ""; bracketContent = "";
            try {
              const fallbackLlm = createLLMAdapter(fallbackProvider, fallbackKey, fallbackModel ?? null);
              await fallbackLlm.chat(
                history,
                iterSystemPrompt,
                (token: string) => {
                  if (_tLlmFirstToken === null) _tLlmFirstToken = performance.now();
                  fullReply += token;
                  const afterThink = filterThinkToken(token);
                  if (!afterThink) return;
                  const afterFn = filterFnToken(afterThink);
                  if (!afterFn) return;
                  const filtered = filterMarkupToken(afterFn);
                  if (!filtered) return;
                  const afterBrackets = filterBracketToken(filtered);
                  if (!afterBrackets) return;
                  tokenBuf += afterBrackets;
                  send({ type: "token", text: afterBrackets });
                  const [sentences, remainder] = extractSentences(tokenBuf, ttsMinSentenceChars);
                  for (const s of sentences) {
                    const g = stepGuard.push(s);
                    if (g) queueSentence(g);
                  }
                  tokenBuf = remainder;
                },
                (full: string) => { fullReply = full; },
                { onUsage: (u: import("../types.js").LLMUsage) => { llmInputTokensTotal += u.inputTokens; llmOutputTokensTotal += u.outputTokens; } },
              );
              logger.info({ callId }, "Webcall: fallback LLM succeeded");
            } catch (fallbackErr) {
              const reason = toReadableError(fallbackErr, "Fallback LLM error");
              logger.error({ callId, err: fallbackErr }, reason);
              send({ type: "error", message: reason });
              speaking = false; speakingEndedAt = Date.now(); processing = false;
              if (!closed) void hangup("error", reason);
              return;
            }
          } else {
            const reason = toReadableError(llmErr, "LLM error (no fallback key)");
            logger.error({ callId, err: llmErr }, reason);
            send({ type: "error", message: reason });
            speaking = false; speakingEndedAt = Date.now(); processing = false;
            if (!closed) void hangup("error", reason);
            return;
          }
        } else {
          const reason = toReadableError(llmErr, "LLM error");
          logger.error({ callId, err: llmErr }, reason);
          logExecution("LLM", "response", {
            provider: agent.llmProvider,
            status: "error",
            latencyMs: Date.now() - llmStartMs,
            turnNumber: _curTurnIdx,
            durationMs: Date.now() - llmStartMs,
            errorMessage: reason,
            metadata: { error: reason },
          });
          send({ type: "error", message: reason });
          speaking = false;
          speakingEndedAt = Date.now();
          processing = false;
          if (!closed) void hangup("error", reason);
          return;
        }
      }
      clearInterval(llmKeepalive);
      logExecution("LLM", "response", {
        provider: agent.llmProvider,
        responsePayload: {
          text: stripReasoningBlocks(fullReply).replace(/<function[\s\S]*?>/g, "").trim().substring(0, 1500),
        },
        latencyMs: Date.now() - llmStartMs,
        turnNumber: _curTurnIdx,
        durationMs: Date.now() - llmStartMs,
        status: "success",
        metadata: {
          inputTokens: llmInputTokensTotal,
          outputTokens: llmOutputTokensTotal,
          model: (agent as any).llmModel ?? "default",
        },
      });

      // The LLM token stream occasionally ends a few words early while fullReply
      // (set by the onComplete callback) has the complete text.  Re-run
      // extractSentences on the full clean reply to get the definitive last
      // segment, and use it instead of the potentially-truncated tokenBuf.
      {
        const cleanForFlush = stripReasoningBlocks(fullReply)
          .replace(/<function=\w+[^>]*>[\s\S]*?<\/function>/g, "")
          .replace(/<function=\w+[^>]*\/>/g, "")
          .replace(/<function=\w+[^>]*>/g, "")
          .replace(/<\/?emotion[^>]*>/gi, "")
          .replace(/<break[^>]*\/?>/gi, "")
          .replace(/\[[\s\S]{120,}?\]/g, "")
          .replace(/[^\S\r\n]{2,}/g, " ")
          .trim();
        const [allSentences, trueRemainder] = extractSentences(cleanForFlush, ttsMinSentenceChars);
        const trimmedTB = tokenBuf.trim();
        // Guard: if tokenBuf is a TRUNCATED PREFIX of the last complete sentence
        // in the full reply (e.g. the LLM's final streaming token "சார்?" arrived
        // only in onComplete and never in any onToken call), use the full sentence
        // from cleanForFlush instead of the partial tokenBuf — preventing the
        // tail-word drop confirmed in the call-62 log where the flush queued
        // "...பாக்குறீங்க" while the LLM text had "...பாக்குறீங்க சார்?".
        const lastFullSentence = allSentences.length > 0 ? allSentences[allSentences.length - 1]! : "";
        // Prefer the complete final sentence from cleanForFlush over the
        // potentially-truncated tokenBuf whenever:
        //   (a) tokenBuf is non-empty — something is still waiting to be sent
        //   (b) the full sentence is at least as long as tokenBuf — so we never
        //       truncate (if tokenBuf is somehow longer, fall through to it)
        //   (c) the full sentence was not already queued in this turn
        // This handles both the exact-prefix case (LLM adapter drops trailing "?"
        // from onToken) and near-prefix cases where incremental filter transforms
        // (spaces around <break> tags, etc.) cause a strict startsWith to miss.
        const useLastFullSentence =
          trimmedTB.length > 0 &&
          lastFullSentence.length >= trimmedTB.length &&
          !sentenceTexts.includes(lastFullSentence);
        const flushText = useLastFullSentence
          ? lastFullSentence
          : (trueRemainder.trim().length > trimmedTB.length ? trueRemainder : tokenBuf);
        const flushGuarded = stepGuard.push(flushText);
        if (flushGuarded.trim()) queueSentence(flushGuarded);
      }

      // ── Tool call handling ─────────────────────────────────────────────────
      if (triggeredToolName) {
        // Push the assistant's tool-invocation turn to history
        const assistantToolContent = stripReasoningBlocks(fullReply)
          .replace(/<function=\w+[^>]*>[\s\S]*?<\/function>/g, "")
          .replace(/<function=\w+[^>]*\/>/g, "")
          .replace(/<function=\w+[^>]*>/g, "")
          .replace(/<\/?emotion[^>]*>/gi, "")
          .replace(/<break[^>]*\/?>/gi, "")
          .replace(/\[[\s\S]{120,}?\]/g, "")
          .replace(/[^\S\r\n]{2,}/g, " ")
          .trim()
          || `[calling tool: ${triggeredToolName}]`;
        history.push({ role: "assistant", content: assistantToolContent });

        // Telephony-only tools are not available on web calls — record a
        // result and keep looping so the agent can recover or finish naturally.
        if (triggeredToolName === "call_transfer" || triggeredToolName === "send_sms") {
          logger.warn({ callId, triggeredToolName }, "Webcall: skipping telephony-only tool (no-op)");
          history.push({ role: "user", content: `[Tool result for ${triggeredToolName}]: not available on web calls` });
          toolIterations++;
          if (toolIterations >= MAX_TOOL_ITERATIONS) attachTools = false;
          continue;
        }

        // Handle built-in end_call
        const matchedTriggeredTool = matchToolByName(agentTools, triggeredToolName);
        if (triggeredToolName === "end_call" || matchedTriggeredTool?.type === "end_call") {
          const endTool = matchedTriggeredTool?.type === "end_call" ? matchedTriggeredTool : undefined;
          // Always speak a closing line — fall back through the configured End
          // Call Phrase then a sensible default so the call never drops silently
          // — and record it to the transcript.
          const goodbye = resolveGoodbyeMessage(
            endTool && endTool.type === "end_call" ? endTool.goodbyeMessage : undefined,
            endCallPhraseList,
          );
          history.push({ role: "assistant", content: goodbye });
          send({ type: "transcript", speaker: "agent", text: goodbye });
          await speakFinalUtterance(goodbye);
          if (!closed) void hangup("normal");
          processing = false;
          return;
        }

        // Execute the tool via the shared executor
        let toolResult: string | undefined;
        let toolHadError = false;
        const toolStartMs = Date.now();
        logExecution("Tool", "request", {
          requestPayload: { tool: triggeredToolName, args: triggeredToolArgs },
          turnNumber: _curTurnIdx,
          status: "info",
        });
        logToolExecutionStarted(logExecution, { tool: triggeredToolName, turnNumber: _curTurnIdx });
        let _toolExecStart = Date.now();
        try {
          const tool = matchToolByName(agentTools, triggeredToolName);
          if (!tool) {
            if (triggeredToolName === "schedule_callback") {
              // Browser webcall — acknowledge the callback request without DB insert
              toolResult = "Callback noted. I'll make sure someone follows up with you.";
            } else {
              logger.warn({ callId, triggeredToolName }, "Webcall: LLM called unknown tool — ignoring");
            }
          } else if (tool.type === "native_booking") {
            toolResult = await executeNativeBooking(callId, agentId, tool, triggeredToolArgs);
          } else if (tool.type === "native_check_availability") {
            logger.info({
              callId,
              selected_booking_id: activeRescheduleBooking?.bookingId ?? null,
              selected_booking_date: activeRescheduleBooking?.isoDate ?? null,
              selected_booking_time: activeRescheduleBooking?.timeLabel ?? null,
              resolved_requested_datetime: triggeredToolArgs["preferred_date"] ?? null,
            }, "Webcall: executeNativeCheckAvailability invoked");
            toolResult = await executeNativeCheckAvailability(callId, agentId, tool, triggeredToolArgs);
          } else if (tool.type === "native_reschedule") {
            if (!activeRescheduleBooking) {
              const bid = parseBookingIdArg(triggeredToolArgs["booking_id"]);
              if (bid) {
                const found = pendingListedBookings.find((b) => b.bookingId === bid);
                if (found) { activeRescheduleBooking = found; logger.info({ callId, ...found }, "Webcall: activeRescheduleBooking inferred from reschedule booking_id arg"); }
              }
            }
            logger.info({
              callId,
              selected_booking_id: activeRescheduleBooking?.bookingId ?? null,
              selected_booking_date: activeRescheduleBooking?.isoDate ?? null,
              selected_booking_time: activeRescheduleBooking?.timeLabel ?? null,
              resolved_requested_datetime: triggeredToolArgs["preferred_date"] ?? triggeredToolArgs["new_time"] ?? null,
            }, "Webcall: executeNativeReschedule invoked");
            toolResult = await executeNativeReschedule(callId, agentId, tool, triggeredToolArgs);
            if (toolResult?.includes("reschedule_confirmed")) {
              logger.info({ callId }, "Webcall: reschedule confirmed — clearing activeRescheduleBooking");
              activeRescheduleBooking = null;
              pendingListedBookings = [];
            }
          } else if (tool.type === "native_cancel") {
            if (!activeRescheduleBooking) {
              const bid = parseBookingIdArg(triggeredToolArgs["booking_id"]);
              if (bid) {
                const found = pendingListedBookings.find((b) => b.bookingId === bid);
                if (found) { activeRescheduleBooking = found; logger.info({ callId, ...found }, "Webcall: activeRescheduleBooking inferred from cancel booking_id arg"); }
              }
            }
            toolResult = await executeNativeCancel(callId, agentId, tool, triggeredToolArgs);
            if (toolResult?.includes("cancel_confirmed")) {
              logger.info({ callId }, "Webcall: cancel confirmed — clearing activeRescheduleBooking");
              activeRescheduleBooking = null;
              pendingListedBookings = [];
            }
          } else if (tool.type === "native_list_bookings") {
            toolResult = await executeNativeListBookings(callId, agentId, tool, triggeredToolArgs);
            activeRescheduleBooking = null;
            pendingListedBookings = parseAllListedBookings(toolResult ?? "");
            if (pendingListedBookings.length === 1) {
              activeRescheduleBooking = pendingListedBookings[0]!;
              logger.info({ callId, ...activeRescheduleBooking }, "Webcall: activeRescheduleBooking set from list_bookings result (count=1)");
            } else if (pendingListedBookings.length > 1) {
              logger.info({ callId, count: pendingListedBookings.length }, "Webcall: multiple bookings listed — activeRescheduleBooking deferred");
            }
          } else if (tool.type === "webhook") {
            toolResult = await executeWebhookTool(callId, tool, triggeredToolArgs);
          } else {
            logger.warn({ callId, toolType: tool.type }, "Webcall: unhandled tool type — ignoring");
          }
        } catch (toolErr) {
          logger.error({ callId, err: toolErr, triggeredToolName }, "Webcall: tool execution error");
          toolHadError = true;
          const _err = toolErr instanceof Error ? toolErr.message : String(toolErr);
          logExecution("Tool", "system", {
            status: "error",
            durationMs: Date.now() - _toolExecStart,
            turnNumber: _curTurnIdx,
            errorMessage: _err,
            metadata: { event: "Execution Completed", error: _err, failureReason: _err },
          });
          logExecution("Tool", "response", {
            requestPayload: { tool: triggeredToolName },
            responsePayload: { error: _err },
            latencyMs: Date.now() - toolStartMs,
            turnNumber: _curTurnIdx,
            durationMs: Date.now() - toolStartMs,
            errorMessage: _err,
            status: "error",
          });
          toolResult = "error: tool execution failed";
        }

        if (!toolHadError) {
          logExecution("Tool", "system", {
            status: "success",
            durationMs: Date.now() - _toolExecStart,
            turnNumber: _curTurnIdx,
            metadata: { event: "Execution Completed", result: (toolResult ?? "unavailable").substring(0, 800) },
          });
          logExecution("Tool", "response", {
            requestPayload: { tool: triggeredToolName },
            responsePayload: { result: (toolResult ?? "unavailable").substring(0, 800) },
            latencyMs: Date.now() - toolStartMs,
            turnNumber: _curTurnIdx,
            durationMs: Date.now() - toolStartMs,
            status: "success",
          });
        }
        // Record the tool result so the next turn can speak or act on it.
        // (Same marker pattern as pipeline.ts continueWithToolResult — also
        // surfaces in the dashboard "Tool Calls" panel via the transcript.)
        history.push({ role: "user", content: `[Tool result for ${triggeredToolName}]: ${toolResult ?? "unavailable"}` });

        // Loop again with tools still attached so the agent can chain another
        // tool (e.g. book_appointment after check_availability) or narrate the
        // result. The cap forces a final tools-detached narration turn.
        toolIterations++;
        if (toolIterations >= MAX_TOOL_ITERATIONS) {
          logger.warn({ callId, toolIterations }, "Webcall: max tool iterations reached — forcing final narration");
          attachTools = false;
        }
        continue;
      }

      // ── Normal (non-tool) TTS playback path ───────────────────────────────

      // Clean the stored reply — strip think blocks and inline function tags
      const cleanReply = stripReasoningBlocks(fullReply)
        .replace(/<function=\w+[^>]*>[\s\S]*?<\/function>/g, "")
        .replace(/<function=\w+[^>]*\/>/g, "")
        .replace(/<function=\w+[^>]*>/g, "")
        .replace(/<\/?emotion[^>]*>/gi, "")
        .replace(/<break[^>]*\/?>/gi, "")
        .replace(/\[[\s\S]{120,}?\]/g, "")
        .replace(/[^\S\r\n]{2,}/g, " ")
        .trim();

      // Keep stored history/transcript in sync with what was actually SPOKEN: if
      // the one-step guard truncated this turn, store only the spoken portion so
      // the agent resumes from the dropped step next turn instead of skipping it.
      const spokenReply = stepGuard.truncated() ? truncateToSingleStep(cleanReply).text : cleanReply;

      if (!cleanReply || sentenceJobs.length === 0) {
        // ── Tag-only response: LLM emitted a function tag with no spoken text ──
        // cleanReply is empty, so we can't play TTS. But the tag still needs to
        // execute — handle it here before returning, otherwise it's silently dropped.
        const inlineFnMatch =
          /<function=(\w+)[^>]*>([\s\S]*?)<\/function>/.exec(fullReply) ??
          /<function=(\w+)[^>]*\s*\/>/.exec(fullReply) ??
          /<function=(\w+)[^>]*>/.exec(fullReply);
        if (inlineFnMatch) {
          const fnName = (inlineFnMatch[1] ?? "").trim();
          if (fnName) {
            logger.info({ callId, fnName }, "Webcall: tag-only inline function detected — executing before early return");
            const fnBody = (inlineFnMatch[2] ?? "").trim();
            let fnArgs: Record<string, unknown> = {};
            if (fnBody && fnBody !== "{}") {
              try { fnArgs = JSON.parse(fnBody) as Record<string, unknown>; } catch { /* ignore */ }
            }

            history.push({ role: "assistant", content: `[calling tool: ${fnName}]` });

            const matchedFnTool = matchToolByName(agentTools, fnName);
            if (fnName === "end_call" || matchedFnTool?.type === "end_call") {
              const endTool = matchedFnTool?.type === "end_call" ? matchedFnTool : undefined;
              const goodbye = resolveGoodbyeMessage(
                endTool && endTool.type === "end_call" ? endTool.goodbyeMessage : undefined,
                endCallPhraseList,
              );
              history.push({ role: "assistant", content: goodbye });
              send({ type: "transcript", speaker: "agent", text: goodbye });
              await speakFinalUtterance(goodbye);
              if (!closed) void hangup("normal");
              processing = false;
              return;
            }

            let inlineFnResult: string | undefined;
            if (fnName === "schedule_callback") {
              inlineFnResult = "Callback noted. I'll make sure someone follows up with you.";
            } else try {
              const tool = matchToolByName(agentTools, fnName);
              if (tool) {
                if (tool.type === "native_booking") {
                  inlineFnResult = await executeNativeBooking(callId, agentId, tool, fnArgs);
                } else if (tool.type === "native_check_availability") {
                  logger.info({
                    callId,
                    selected_booking_id: activeRescheduleBooking?.bookingId ?? null,
                    selected_booking_date: activeRescheduleBooking?.isoDate ?? null,
                    selected_booking_time: activeRescheduleBooking?.timeLabel ?? null,
                    resolved_requested_datetime: fnArgs["preferred_date"] ?? null,
                  }, "Webcall (tag-only): executeNativeCheckAvailability invoked");
                  inlineFnResult = await executeNativeCheckAvailability(callId, agentId, tool, fnArgs);
                } else if (tool.type === "native_reschedule") {
                  if (!activeRescheduleBooking) {
                    const bid = parseBookingIdArg(fnArgs["booking_id"]);
                    if (bid) { const f = pendingListedBookings.find((b) => b.bookingId === bid); if (f) { activeRescheduleBooking = f; } }
                  }
                  logger.info({
                    callId,
                    selected_booking_id: activeRescheduleBooking?.bookingId ?? null,
                    selected_booking_date: activeRescheduleBooking?.isoDate ?? null,
                    selected_booking_time: activeRescheduleBooking?.timeLabel ?? null,
                    resolved_requested_datetime: fnArgs["preferred_date"] ?? fnArgs["new_time"] ?? null,
                  }, "Webcall (tag-only): executeNativeReschedule invoked");
                  inlineFnResult = await executeNativeReschedule(callId, agentId, tool, fnArgs);
                  if (inlineFnResult?.includes("reschedule_confirmed")) { activeRescheduleBooking = null; pendingListedBookings = []; }
                } else if (tool.type === "native_cancel") {
                  if (!activeRescheduleBooking) {
                    const bid = parseBookingIdArg(fnArgs["booking_id"]);
                    if (bid) { const f = pendingListedBookings.find((b) => b.bookingId === bid); if (f) { activeRescheduleBooking = f; } }
                  }
                  inlineFnResult = await executeNativeCancel(callId, agentId, tool, fnArgs);
                  if (inlineFnResult?.includes("cancel_confirmed")) { activeRescheduleBooking = null; pendingListedBookings = []; }
                } else if (tool.type === "native_list_bookings") {
                  inlineFnResult = await executeNativeListBookings(callId, agentId, tool, fnArgs);
                  activeRescheduleBooking = null;
                  pendingListedBookings = parseAllListedBookings(inlineFnResult ?? "");
                  if (pendingListedBookings.length === 1) { activeRescheduleBooking = pendingListedBookings[0]!; logger.info({ callId, ...activeRescheduleBooking }, "Webcall (tag-only): activeRescheduleBooking set"); }
                } else if (tool.type === "webhook") {
                  inlineFnResult = await executeWebhookTool(callId, tool, fnArgs);
                }
              }
            } catch (toolErr) {
              logger.error({ callId, err: toolErr, fnName }, "Webcall: tag-only inline function execution error");
              inlineFnResult = "error: tool execution failed";
            }

            if (inlineFnResult !== undefined) {
              history.push({ role: "user", content: `[Tool result for ${fnName}]: ${inlineFnResult}` });
              toolIterations++;
              if (toolIterations >= MAX_TOOL_ITERATIONS) attachTools = false;
              continue;
            }
          }
        }
        sendStatus("listening");
        processing = false;
        return;
      }

      history.push({ role: "assistant", content: spokenReply });
      sendStatus("speaking");
      speaking = true;
      speakingStartedAt = Date.now();
      const _turnPbStart = Date.now();
      logPlaybackEvent(logExecution, "Playback Started", { provider: agent.ttsProvider, turnNumber: _curTurnIdx });
      // Arm the start echo-grace for the gap before the first sentence's audio
      // streams; it is re-armed per sentence inside the playback loop below.
      echoGraceUntil = Date.now() + echoGraceMs;

      // Drop any audio that accumulated while the LLM was generating.
      // Without this, speech spoken during the "thinking" phase would be
      // replayed as a new user turn after the agent finishes speaking —
      // causing the agent to answer a question the user already forgot they asked.
      if (audioChunks.length > 0) {
        logger.info({ callId, droppedChunks: audioChunks.length }, "Dropping pre-TTS buffered audio (thinking phase)");
        audioChunks.splice(0);
      }
      clearStreamingFallback();
      bargeInFrames = 0;
      bargeInLowEnergyFrames = 0;

      // 3. Pipelined sentence playback — synthesis ran in parallel with LLM
      // streaming, so each job is likely already resolved by now.
      let transcriptSent = false;
      let lastPlayedIndex = -1; // STEP 0b diag: highest sentence index whose audio fully streamed
      let _totalAudioBytes = 0; // accumulated audio bytes across all sentences for duration
      logger.info({ callId, evt: "sentences_queued", sentenceCount: sentenceTexts.length, sentenceTexts }, "STEP 0b sentences_queued: full per-turn TTS job list (does the final clause appear?)");

      for (let i = 0; i < sentenceJobs.length; i++) {
        if (closed || interrupted) break;
        // Incremental delay: pause before each sentence (after the first) to give
        // the agent a more deliberate, natural pacing between sentences.
        if (i > 0 && incrementalDelayMs > 0 && !interrupted && !closed) {
          await new Promise<void>(r => setTimeout(r, incrementalDelayMs));
        }

        if (!transcriptSent) {
          send({ type: "transcript", speaker: "agent", text: spokenReply });
          transcriptSent = true;
        }
        send({ type: "sentence_start", index: i, text: sentenceTexts[i] ?? "" });
        // Record each sentence in the echo-detection buffer the moment we begin playing it.
        // stripSsml+normalizeIndic ensures SSML markup (e.g. <break>, <prosody>) and Unicode
        // variations don't prevent token matching against STT output later.
        if (sentenceTexts[i]) recentAgentText.push({ text: stripSsml(normalizeIndic(sentenceTexts[i]!)), at: Date.now() });

        const jobEntry = sentenceJobs[i]!;

        if ("readChunks" in jobEntry) {
          // ── True-streaming path ─────────────────────────────────────────────
          // Pipe PCM chunks directly to the browser as they arrive from the TTS
          // provider. First audio byte reaches the browser in ~150ms after the
          // TTS request fires — no full-buffer wait.
          //
          // echoGrace: estimate sentence playback duration from char count so the
          // grace covers the FULL sentence. ~70 ms/char covers Tamil/Indic and
          // Latin at typical TTS speech rate (observed: 56-char Tamil sentence ≈
          // 3600 ms = 64 ms/char). Without this, a 700 ms start-grace expires
          // while multi-second TTS audio is still playing; the agent's own voice
          // echoing back through an imperfect browser AEC then exceeds the energy
          // threshold and fires a false barge-in (root cause of the "9-second gap"
          // / "say it twice" issue seen in call-411 turn 3→4).
          //
          // Semantic interrupts ("stop", "wait", Tamil equivalents) still bypass
          // this gate. Callers can also barge-in between sentences once the grace
          // from the previous sentence has expired.
          {
            const estimatedSentenceMs = Math.round((sentenceTexts[i]?.length ?? 30) * 70);
            echoGraceUntil = Date.now() + estimatedSentenceMs + echoGraceMs;
          }
          let frameBuf = Buffer.alloc(0);
          let bytesSent = 0;
          try {
            for await (const raw of jobEntry.readChunks()) {
              if (closed || interrupted) break;
              frameBuf = Buffer.concat([frameBuf, raw]);
              while (frameBuf.length >= AUDIO_CHUNK_BYTES) {
                if (closed || interrupted) break;
                const frame = frameBuf.subarray(0, AUDIO_CHUNK_BYTES);
                frameBuf = frameBuf.subarray(AUDIO_CHUNK_BYTES);
                bytesSent += AUDIO_CHUNK_BYTES;
                _totalAudioBytes += AUDIO_CHUNK_BYTES;
                // Do NOT re-arm echo grace per frame: the per-sentence start grace
                // (armed above) + the tail grace (armed after playback) bound the
                // self-echo window. Re-arming on every 40 ms frame kept it active
                // for the entire sentence and suppressed both barge-in detectors,
                // so a caller could not interrupt a long reply. Mid-sentence
                // self-echo is rejected by the energy RMS threshold + STT
                // word-count gate.
                recording.addAgentChunk(frame);
                sendSpeechAudio(frame);
                await new Promise<void>(r => setTimeout(r, 40));
              }
            }
          } catch (ttsErr) {
            const reason = toReadableError(ttsErr, "TTS error");
            logger.error({ callId, err: ttsErr }, reason);
            send({ type: "error", message: reason });
            logPlaybackEvent(logExecution, "Playback Cancelled", {
              provider: agent.ttsProvider,
              turnNumber: _curTurnIdx,
              playbackDurationMs: Date.now() - _turnPbStart,
              stopReason: "tts_error",
            });
            speaking = false; speakingEndedAt = Date.now(); processing = false;
            if (!closed) void hangup("error", reason);
            return;
          }
          // Flush any sub-frame remainder (pad to full frame with silence)
          if (!interrupted && !closed && frameBuf.length > 0) {
            const padded = Buffer.alloc(AUDIO_CHUNK_BYTES);
            frameBuf.copy(padded);
            recording.addAgentChunk(padded);
            sendSpeechAudio(padded);
            _totalAudioBytes += frameBuf.length;
            await new Promise<void>(r => setTimeout(r, 40));
          }
          // Append per-sentence tail silence (same as withTailSilence on buffered path)
          if (!interrupted && !closed) {
            const tsSilenceBytes = Math.round((TTS_TAIL_SILENCE_MS / 1000) * 16000) * 2;
            const tsFrames = Math.ceil(tsSilenceBytes / AUDIO_CHUNK_BYTES);
            const tsFrame = Buffer.alloc(AUDIO_CHUNK_BYTES);
            for (let s = 0; s < tsFrames && !interrupted && !closed; s++) {
              recording.addAgentChunk(tsFrame);
              sendSpeechAudio(tsFrame);
              _totalAudioBytes += AUDIO_CHUNK_BYTES;
              await new Promise<void>(r => setTimeout(r, 40));
            }
          }
        } else {
          // ── Buffered fallback (providers without synthesizeStream) ──────────
          let pcmOut: Buffer;
          try {
            pcmOut = await jobEntry;
          } catch (ttsErr) {
            const reason = toReadableError(ttsErr, "TTS error");
            logger.error({ callId, err: ttsErr }, reason);
            send({ type: "error", message: reason });
            logPlaybackEvent(logExecution, "Playback Cancelled", {
              provider: agent.ttsProvider,
              turnNumber: _curTurnIdx,
              playbackDurationMs: Date.now() - _turnPbStart,
              stopReason: "tts_error",
            });
            speaking = false; speakingEndedAt = Date.now(); processing = false;
            if (!closed) void hangup("error", reason);
            return;
          }
          if (interrupted || closed) break;

          // Arm echo grace for the full sentence duration (exact, from PCM byte count)
          // so the agent's own voice echoing back through an imperfect browser AEC
          // cannot fire a false energy barge-in while audio is still playing.
          {
            const sentenceDurationMs = Math.round((pcmOut.length / 2 / 16000) * 1000);
            echoGraceUntil = Date.now() + sentenceDurationMs + echoGraceMs;
          }

          for (let j = 0; j < pcmOut.length; j += AUDIO_CHUNK_BYTES) {
            if (closed || interrupted) break;
            const chunk = pcmOut.slice(j, j + AUDIO_CHUNK_BYTES);
            recording.addAgentChunk(chunk);
            sendSpeechAudio(chunk);
            _totalAudioBytes += Math.min(AUDIO_CHUNK_BYTES, pcmOut.length - j);
            await new Promise<void>(r => setTimeout(r, 40));
          }
        }

        if (!interrupted && !closed) lastPlayedIndex = i; // STEP 0b diag: this sentence fully streamed
      }
      logger.info({ callId, evt: "playback_done", lastPlayedIndex, totalSentences: sentenceJobs.length, interrupted, closed }, "STEP 0b playback_done: did the loop reach the final sentence, or break early (barge-in/close)?");

      // Tail silence: send real PCM silence frames so the browser's AudioContext
      // queues them AFTER the last word. A passive wait alone doesn't help —
      // the client's Web Audio API schedules buffers independently and has
      // already reached the end of the queue while "today?" is mid-play.
      // Sending silence frames extends the scheduled timeline past the last
      // word, ensuring it plays to completion before the queue empties.
      if (!interrupted && !closed) {
        // Hold the echo-grace window through the ENTIRE tail-silence drain plus an
        // echo-decay margin. The per-sentence grace above was computed from
        // server-side send timing only; the client plays (and echoes) the final
        // word LATER than we sent it (AudioContext buffering lag + network
        // round-trip). Without this, the echo of the last word can arrive after
        // grace expires and trip a false barge-in that flushes it on the client.
        echoGraceUntil = Math.max(
          echoGraceUntil,
          Date.now() + AUDIO_TAIL_SILENCE_MS + WEB_TAIL_ECHO_MARGIN_MS,
        );
        const silenceChunk = Buffer.alloc(AUDIO_CHUNK_BYTES, 0);
        const silenceFrames = Math.ceil(AUDIO_TAIL_SILENCE_MS / 40);
        for (let s = 0; s < silenceFrames && !interrupted && !closed; s++) {
          sendAudio(silenceChunk);
          _totalAudioBytes += AUDIO_CHUNK_BYTES;
          await new Promise<void>(r => setTimeout(r, 40));
        }
      }

      const _turnPbEvent: PlaybackEvent = closed
        ? "Playback Cancelled"
        : interrupted
          ? "Playback Interrupted"
          : "Playback Completed";
      const _audioDurationMs = Math.round((_totalAudioBytes / 2 / 16000) * 1000);
      logPlaybackEvent(logExecution, _turnPbEvent, {
        provider: agent.ttsProvider,
        turnNumber: _curTurnIdx,
        playbackDurationMs: Date.now() - _turnPbStart,
        audioDurationMs: _audioDurationMs,
        stopReason: closed ? "call_closed" : interrupted ? "barge_in" : "completed",
      });
      speaking = false;
      speakingEndedAt = Date.now();

      if (interrupted) {
        // Barge-in: immediately process whatever the user said
        pendingShortUtterance = null; // barge-in supersedes any queued short utterance
        logger.info({ callId }, "Barge-in detected — processing user interruption");
        if (audioChunks.length > 0) void process();
      } else if (!closed) {
        // No barge-in — discard any frames that accumulated in audioChunks during
        // barge-in detection (user spoke during the agent's turn but didn't interrupt).
        // Without this, those frames would be replayed as a new user turn immediately
        // after the agent finishes, making the agent answer speech it already "heard".
        if (audioChunks.length > 0) {
          logger.info({ callId, dropped: audioChunks.length }, "Discarding during-speech audio (no barge-in triggered)");
          audioChunks.splice(0);
        }
        clearStreamingFallback();
        // Replay any short utterance that was said during the agent's speech but was
        // too short to trigger a barge-in. Process it now as the user's actual turn.
        // Echo check at replay time (NOT at save time): lastLoudFrameAt is only updated
        // in the !speaking audio branch, so it reflects real post-speech caller frames
        // here. At save time (during agent speech) it would have been stale.
        if (pendingShortUtterance) {
          const queued = pendingShortUtterance;
          pendingShortUtterance = null;
          if (isAgentEcho(queued)) {
            logger.info({ callId, text: queued, msSinceLastChunk: Date.now() - lastChunkSentAt }, "Webcall: dropping queued short utterance — content echo at replay time");
          } else {
            logger.info({ callId, text: queued }, "Webcall: replaying queued short utterance as user turn");
            streamingTranscriptPending = queued;
            void process();
          }
        }
        // STEP 0b diag: natural turn-end ordering of (a) final-sentence TTS done,
        // (b) last audio frame handed to ws.send, (c) flip to "listening" — plus the
        // WS send buffer still pending at the flip. bufferedAmount > 0 here means the
        // tail frames were queued but not yet written to the client socket when we
        // told the client to stop playing (server-side backpressure on the tail).
        {
          const _finalIdx = sentenceJobs.length - 1;
          logger.info({
            callId,
            evt: "tail_diag",
            finalSentenceTtsDoneAt_a: sentenceSynthDoneAt[_finalIdx] ?? null,
            lastAudioFrameSentAt_b: lastChunkSentAt || null,
            listenFlipAt_c: Date.now(),
            wsBufferedAmountAtFlip: ws.bufferedAmount,
            msSinceLastAudioSend: lastChunkSentAt > 0 ? Date.now() - lastChunkSentAt : null,
            sentenceCount: sentenceJobs.length,
          }, "STEP 0b tail_diag: (a) final TTS done / (b) last frame sent / (c) listening flip + WS buffered bytes");
        }
        sendStatus("listening");
      }

      // ── Inline function-tag execution (safety net for LLMs that emit <function=X> as text) ──
      // If the LLM embedded a function tag in text instead of using the tool API, the
      // streaming filter already stripped it from TTS. Execute it now so the action fires.
      {
        const inlineFnMatch =
          /<function=(\w+)[^>]*>([\s\S]*?)<\/function>/.exec(fullReply) ??
          /<function=(\w+)[^>]*\s*\/>/.exec(fullReply) ??
          /<function=(\w+)[^>]*>/.exec(fullReply);
        if (inlineFnMatch) {
          const fnName = (inlineFnMatch[1] ?? "").trim();
          if (fnName) {
            logger.info({ callId, fnName }, "Webcall: inline function tag detected — executing after response");
            const fnBody = (inlineFnMatch[2] ?? "").trim();
            let fnArgs: Record<string, unknown> = {};
            if (fnBody && fnBody !== "{}") {
              try { fnArgs = JSON.parse(fnBody) as Record<string, unknown>; } catch { /* ignore */ }
            }

            // Mirror the native tool-call path: push assistant turn, run tool, loop
            history.push({ role: "assistant", content: cleanReply || `[calling tool: ${fnName}]` });

            // Built-in end_call
            const matchedFnTool = matchToolByName(agentTools, fnName);
            if (fnName === "end_call" || matchedFnTool?.type === "end_call") {
              const endTool = matchedFnTool?.type === "end_call" ? matchedFnTool : undefined;
              const goodbye = resolveGoodbyeMessage(
                endTool && endTool.type === "end_call" ? endTool.goodbyeMessage : undefined,
                endCallPhraseList,
              );
              history.push({ role: "assistant", content: goodbye });
              send({ type: "transcript", speaker: "agent", text: goodbye });
              await speakFinalUtterance(goodbye);
              if (!closed) void hangup("normal");
              processing = false;
              return;
            }

            // Route through the shared executor
            let inlineFnResult: string | undefined;
            if (fnName === "schedule_callback") {
              inlineFnResult = "Callback noted. I'll make sure someone follows up with you.";
            } else try {
              const tool = matchToolByName(agentTools, fnName);
              if (tool) {
                if (tool.type === "native_booking") {
                  inlineFnResult = await executeNativeBooking(callId, agentId, tool, fnArgs);
                } else if (tool.type === "native_check_availability") {
                  logger.info({
                    callId,
                    selected_booking_id: activeRescheduleBooking?.bookingId ?? null,
                    selected_booking_date: activeRescheduleBooking?.isoDate ?? null,
                    selected_booking_time: activeRescheduleBooking?.timeLabel ?? null,
                    resolved_requested_datetime: fnArgs["preferred_date"] ?? null,
                  }, "Webcall (inline-fn): executeNativeCheckAvailability invoked");
                  inlineFnResult = await executeNativeCheckAvailability(callId, agentId, tool, fnArgs);
                } else if (tool.type === "native_reschedule") {
                  if (!activeRescheduleBooking) {
                    const bid = parseBookingIdArg(fnArgs["booking_id"]);
                    if (bid) { const f = pendingListedBookings.find((b) => b.bookingId === bid); if (f) { activeRescheduleBooking = f; } }
                  }
                  logger.info({
                    callId,
                    selected_booking_id: activeRescheduleBooking?.bookingId ?? null,
                    selected_booking_date: activeRescheduleBooking?.isoDate ?? null,
                    selected_booking_time: activeRescheduleBooking?.timeLabel ?? null,
                    resolved_requested_datetime: fnArgs["preferred_date"] ?? fnArgs["new_time"] ?? null,
                  }, "Webcall (inline-fn): executeNativeReschedule invoked");
                  inlineFnResult = await executeNativeReschedule(callId, agentId, tool, fnArgs);
                  if (inlineFnResult?.includes("reschedule_confirmed")) { activeRescheduleBooking = null; pendingListedBookings = []; }
                } else if (tool.type === "native_cancel") {
                  if (!activeRescheduleBooking) {
                    const bid = parseBookingIdArg(fnArgs["booking_id"]);
                    if (bid) { const f = pendingListedBookings.find((b) => b.bookingId === bid); if (f) { activeRescheduleBooking = f; } }
                  }
                  inlineFnResult = await executeNativeCancel(callId, agentId, tool, fnArgs);
                  if (inlineFnResult?.includes("cancel_confirmed")) { activeRescheduleBooking = null; pendingListedBookings = []; }
                } else if (tool.type === "native_list_bookings") {
                  inlineFnResult = await executeNativeListBookings(callId, agentId, tool, fnArgs);
                  activeRescheduleBooking = null;
                  pendingListedBookings = parseAllListedBookings(inlineFnResult ?? "");
                  if (pendingListedBookings.length === 1) { activeRescheduleBooking = pendingListedBookings[0]!; logger.info({ callId, ...activeRescheduleBooking }, "Webcall (inline-fn): activeRescheduleBooking set"); }
                } else if (tool.type === "webhook") {
                  inlineFnResult = await executeWebhookTool(callId, tool, fnArgs);
                }
              }
            } catch (toolErr) {
              logger.error({ callId, err: toolErr, fnName }, "Webcall: inline function tag execution error");
              inlineFnResult = "error: tool execution failed";
            }

            if (inlineFnResult !== undefined) {
              history.push({ role: "user", content: `[Tool result for ${fnName}]: ${inlineFnResult}` });
              toolIterations++;
              if (toolIterations >= MAX_TOOL_ITERATIONS) attachTools = false;
              continue;
            }
          }
        }
      }

      // No tool was called this turn — the agent's spoken response is done.
      // The server has finished SENDING audio bytes, but the browser still has
      // them queued for playback (Web Audio API schedules future buffers).
      // Starting the silence timer here would fire mid-playback for long responses.
      // Instead: wait for the client to send { type: "playback_ended" } once its
      // audio queue actually drains, then call resetHangupSilenceTimer().
      // A fallback fires after PLAYBACK_ENDED_FALLBACK_MS to handle old clients / crashes.
      if (playbackSilenceTimer) { clearTimeout(playbackSilenceTimer); playbackSilenceTimer = null; }
      if (agent.silenceTimeoutSeconds) {
        playbackSilenceTimer = setTimeout(() => {
          playbackSilenceTimer = null;
          logger.warn({ callId }, "Webcall: playback_ended not received within fallback window — starting silence timer");
          resetHangupSilenceTimer();
        }, PLAYBACK_ENDED_FALLBACK_MS);
      }
      // If configured, hang up immediately after the LLM finishes responding (one-shot agents).
      if (hangupAfterLlmCall && !closed) {
        logger.info({ callId }, "Webcall: hangupAfterLlmCall — ending call");
        void hangup("normal");
      }
      {
        const _tEnd = performance.now();
        const _stt_ms = _tSttFinal > 0 && _tVadFlush > 0
          ? Math.round(_tSttFinal - _tVadFlush) : null;
        const _llm_ttft_ms = _tLlmFirstToken !== null && _tSttFinal > 0
          ? Math.round(_tLlmFirstToken - _tSttFinal) : null;
        const _llm_ttft_to_clause_ms = _tLlmFirstClause !== null && _tLlmFirstToken !== null
          ? Math.round(_tLlmFirstClause - _tLlmFirstToken) : null;
        const _tts_ttfb_ms = _tTtsFirstByte !== null && _tSttFinal > 0
          ? Math.round(_tTtsFirstByte - _tSttFinal) : null;
        const _return_ms = _tFirstAudioOut !== null && _tSttFinal > 0
          ? Math.round(_tFirstAudioOut - _tSttFinal) : null;
        const _total_ms = _tVadFlush > 0 ? Math.round(_tEnd - _tVadFlush) : null;
        logger.info({
          evt:                   "turn_latency",
          path:                  "webcall",
          callId,
          turnIndex:             _curTurnIdx,
          stt_ms:                _stt_ms,
          llm_ttft_ms:           _llm_ttft_ms,
          llm_ttft_to_clause_ms: _llm_ttft_to_clause_ms,
          tts_ttfb_ms:           _tts_ttfb_ms,
          return_ms:             _return_ms,
          total_ms:              _total_ms,
          endpoint_ms:           _thisEndpointMs,
          endpoint_reason:       _thisEndpointReason,
          asrProvider:           agent.asrProvider,
          llmProvider:           agent.llmProvider,
          ttsProvider:           agent.ttsProvider,
          fillerPlayed:          _tTurnFillerPlayed,
          turn_close_reason:     _closeReason,
        }, "turn_latency");
      }
      processing = false;
      return;
      } // end multi-step tool calling loop

    } catch (err) {
      speaking = false;
      speakingEndedAt = Date.now();
      logger.error({ callId, err }, "WebCall pipeline error");
      send({ type: "error", message: String(err) });
    } finally {
      processing = false;
      // Streaming STT may have queued a transcript while we were processing this turn
      // (it fires isFinal=true but returns early because processing=true).
      // Pick it up now so the next turn starts immediately without waiting for a
      // new audio frame to arrive.
      if (!closed && streamingTranscriptPending) void process();
      else if (!closed && beganTurn) safetyNet.beginListening();
    }
  }

  function scheduleSilenceFlush() {
    if (silenceTimer || processing) return;
    // ── Adaptive endpoint window ─────────────────────────────────────────────
    const lastAgentText = [...history].reverse()
      .find(t => t.role === "assistant")?.content ?? "";
    const partialTranscript = streamingTranscriptPending ?? "";
    // audioChunks holds 16kHz PCM16: 16000 samples/s × 2 bytes = 32 bytes/ms
    const audioBufferMs = Math.round(
      audioChunks.reduce((s, b) => s + b.length, 0) / 32
    );
    const { ms, reason } = computeEndpointMs({
      lastAgentText,
      partialTranscript,
      audioBufferMs,
      baseSilenceMs: agentVadSilenceMs,
    });
    _lastEndpointMs = ms;
    _lastEndpointReason = reason;
    silenceTimer = setTimeout(() => { silenceTimer = null; void process(); }, ms);
  }

  function clearSilenceTimer() {
    if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
  }

  // ── Silence-hangup timer (separate from VAD flush timer) ─────────────────
  // Fires when the caller has been silent for silenceTimeoutSeconds. Plays the
  // inactivity message (if configured) and ends the call.
  function resetHangupSilenceTimer() {
    if (!agent.silenceTimeoutSeconds) return;
    if (hangupSilenceTimer) { clearTimeout(hangupSilenceTimer); hangupSilenceTimer = null; }
    hangupSilenceTimer = setTimeout(() => {
      hangupSilenceTimer = null;
      if (closed) return;
      logger.info({ callId }, "Webcall: silence timeout — ending call");
      void (async () => {
        if (agent.inactivityMessage && !closed) {
          await speakFinalUtterance(agent.inactivityMessage);
        }
        if (!closed) void hangup("silence_timeout");
      })();
    }, agent.silenceTimeoutSeconds * 1000);
  }

  // Speak a terminal/final utterance (goodbye, end-call line, inactivity
  // message) and fully drain its tail before the call is torn down. Mirrors the
  // per-sentence playback loop: the audio is wrapped in withTailSilence and
  // followed by AUDIO_TAIL_SILENCE_MS of real PCM silence frames so the
  // browser's AudioContext plays the final word to completion before the queue
  // empties / the WebSocket closes. Without this the goodbye is clipped because
  // hangup() flips `closed` immediately after the last audio chunk is sent.
  /**
   * Stall-backstop recovery (webcall): no usable transcript arrived before
   * STALL_BACKSTOP_MS. Speak a language-aware reprompt and re-enter Listening —
   * do NOT hang up. After STALL_MAX_REPROMPTS the safety net calls onStallGiveUp.
   * Mirrors pipeline.ts stallReprompt().
   */
  async function stallReprompt(): Promise<void> {
    if (closed || processing || speaking) {
      if (!closed) safetyNet.beginListening();
      return;
    }
    logger.info({ evt: "turn_latency", path: "webcall", callId, turn_close_reason: "stall_reprompt" }, "turn_latency");
    const text = recoveryReprompt(currentLangWc || agentLanguage);
    send({ type: "transcript", speaker: "agent", text });
    await speakFinalUtterance(text);
    if (!closed) safetyNet.beginListening();
  }

  async function speakFinalUtterance(text: string): Promise<void> {
    if (!text.trim() || closed) return;
    recentAgentText.push({ text: stripSsml(normalizeIndic(text)), at: Date.now() });
    let audio: Buffer;
    try {
      const res = await tts.synthesize(text);
      audio = withTailSilence(res.audio);
    } catch {
      return; // ignore TTS errors on terminal utterances — caller still hangs up
    }
    if (closed) return;
    ttsCharactersTotal += text.length;
    sendStatus("speaking");
    speaking = true;
    speakingStartedAt = Date.now();
    const _pbStart = Date.now();
    logPlaybackEvent(logExecution, "Playback Started", { provider: agent.ttsProvider });
    {
      const sentenceDurationMs = Math.round((audio.length / 2 / 16000) * 1000);
      echoGraceUntil = Date.now() + sentenceDurationMs + echoGraceMs;
    }
    for (let j = 0; j < audio.length; j += AUDIO_CHUNK_BYTES) {
      if (closed || interrupted) break;
      sendSpeechAudio(audio.slice(j, j + AUDIO_CHUNK_BYTES));
      await new Promise<void>((r) => setTimeout(r, 40));
    }
    // Tail-silence drain — keep the client's scheduled audio timeline fed past
    // the final word so it isn't clipped when the queue empties on hangup.
    if (!interrupted && !closed) {
      const silenceChunk = Buffer.alloc(AUDIO_CHUNK_BYTES, 0);
      const silenceFrames = Math.ceil(AUDIO_TAIL_SILENCE_MS / 40);
      for (let s = 0; s < silenceFrames && !interrupted && !closed; s++) {
        sendAudio(silenceChunk);
        await new Promise<void>((r) => setTimeout(r, 40));
      }
    }
    const _pbEvent: PlaybackEvent = closed
      ? "Playback Cancelled"
      : interrupted
        ? "Playback Interrupted"
        : "Playback Completed";
    const _audioDurationMs = Math.round((audio.length / 2 / 16000) * 1000);
    logPlaybackEvent(logExecution, _pbEvent, {
      provider: agent.ttsProvider,
      playbackDurationMs: Date.now() - _pbStart,
      audioDurationMs: _audioDurationMs,
      stopReason: closed ? "call_closed" : interrupted ? "barge_in" : "completed",
    });
    speaking = false;
    speakingEndedAt = Date.now();
  }

  // ── Ready ─────────────────────────────────────────────────────────────────
  send({ type: "ready", agentId, agentName: agent.name, callId });
  logger.info({ callId, agentId, agentName: agent.name }, "WebCall session started");

  // Declared (but not yet armed) before the opening greeting so that a greeting
  // TTS failure can call hangup() — which clears maxTimer — without hitting a
  // temporal-dead-zone ReferenceError that would crash the Node process and
  // leave the call stuck `in_progress`. The timer is armed after the greeting.
  let maxTimer: ReturnType<typeof setTimeout> | undefined;

  // ── Opening greeting ─────────────────────────────────────────────────────
  // 1. If the agent has a greetingMessage configured, play it directly (no LLM).
  // 2. Otherwise, ask the LLM to generate a contextual opening (same path as
  //    callbacks, but with a generic trigger so it works for all webcalls).
  // When firstSpeaker = "user", stay silent on connect and let the caller speak
  // first — the session keeps listening and only responds after the user speaks.
  if (!closed && agent.firstSpeaker === "user") {
    logger.info({ callId }, "First speaker = user — skipping opening greeting (webcall)");
  } else if (!closed) {
    try {
      const agentTimezone = (agentCfg["timezone"] as string | undefined) || "Asia/Kolkata";

      let greetingText = "";

      // For returning callers, prefer a memory-informed (recognition-style)
      // opening generated from the memory-injected system prompt over the static
      // scripted greeting — otherwise the agent would re-introduce itself cold.
      const isReturningCaller = (webcallProfile?.callCount ?? 0) >= 1;

      if (agent.greetingMessage && !isReturningCaller) {
        // Fast path — use configured greeting directly.
        // Substitute {caller_salutation} with neutral salutation — gender is
        // not yet known at greeting time; per-turn substitution will use the
        // real detected value for all subsequent LLM calls.
        {
          const rawSal = neutralSal;
          const resolvedSal = (rawSal === "(skip)" || !rawSal) ? "" : rawSal;
          if (resolvedSal) {
            greetingText = agent.greetingMessage
              .replace(/\{\{caller_salutation\}\}/g, resolvedSal)
              .replace(/\{caller_salutation\}/g, resolvedSal);
          } else {
            greetingText = agent.greetingMessage
              .replace(/\s*\{\{caller_salutation\}\}\s*/g, " ")
              .replace(/\s*\{caller_salutation\}\s*/g, " ");
          }
          logger.info({ callId, resolvedSalutation: resolvedSal || "(empty)" }, "Webcall: caller_salutation in greeting resolved to neutral (pre-detection)");
        }
      } else {
        // LLM-generated opening
        sendStatus("thinking");
        let greetSystemPrompt = `${buildDatetimeInjection(agentTimezone)}\n\n${systemPrompt}`;
        // Inject the same language guard that per-turn responses use, so the
        // LLM generates the greeting in the configured language (not English).
        const GREET_LANG_NAMES: Record<string, string> = {
          "hi-IN": "Hindi", "ta-IN": "Tamil", "te-IN": "Telugu", "kn-IN": "Kannada",
          "ml-IN": "Malayalam", "mr-IN": "Marathi", "bn-IN": "Bengali", "gu-IN": "Gujarati",
          "pa-IN": "Punjabi", "or-IN": "Odia", "ur-IN": "Urdu",
          "en-IN": "English", "en-US": "English", "en-GB": "English",
          "fr-FR": "French", "de-DE": "German", "es-ES": "Spanish", "pt-BR": "Portuguese",
          "it-IT": "Italian", "ja-JP": "Japanese", "ko-KR": "Korean", "zh-CN": "Chinese",
          "ar-EG": "Arabic", "ru-RU": "Russian",
        };
        const greetLangName = currentLangWc ? (GREET_LANG_NAMES[currentLangWc] ?? currentLangWc) : null;
        if (currentLangWc && greetLangName) {
          const greetLangGuard =
            `[LANGUAGE — ABSOLUTE RULE] You MUST respond ONLY in ${greetLangName}. ` +
            `This applies to EVERY reply without exception — including the opening greeting. ` +
            `Never switch to English or any other language under any circumstances.`;
          greetSystemPrompt = `${greetLangGuard}\n\n${greetSystemPrompt}\n\n${greetLangGuard}`;
        }
        // Substitute {caller_salutation} — gender not yet known at greeting time, use neutral.
        {
          const _greetRawSal = neutralSal;
          const _greetResolvedSal = (_greetRawSal === "(skip)" || !_greetRawSal) ? "" : _greetRawSal;
          if (_greetResolvedSal) {
            greetSystemPrompt = greetSystemPrompt
              .replace(/\{\{caller_salutation\}\}/g, _greetResolvedSal)
              .replace(/\{caller_salutation\}/g, _greetResolvedSal);
          } else {
            greetSystemPrompt = greetSystemPrompt
              .replace(/\s*\{\{caller_salutation\}\}\s*/g, " ")
              .replace(/\s*\{caller_salutation\}\s*/g, " ");
          }
        }
        // Include language hint in the trigger so the model doesn't default to English.
        const langHint = (greetLangName && greetLangName !== "English") ? ` — respond ONLY in ${greetLangName}` : "";
        const triggerContent = callbackId
          ? `[callback connected — please open the conversation with your greeting now${langHint}]`
          : isReturningCaller
            ? `[call connected — this is a returning caller you already know from the CALLER MEMORY block above; open by greeting them by name and referencing prior context, do NOT re-introduce yourself${langHint}]`
            : `[call connected — please greet the user and open the conversation now${langHint}]`;
        const triggerHistory: import("../types.js").ConversationTurn[] = [
          { role: "user", content: triggerContent },
        ];
        await llm.chat(
          triggerHistory,
          greetSystemPrompt,
          (token) => { greetingText += token; },
          (full)  => { greetingText = full; },
        );
        // Strip <think> blocks and any <emotion>/<break> markup that some models
        // emit — TTS must receive plain text, and the transcript must be clean.
        greetingText = stripReasoningBlocks(greetingText)
          .replace(/<\/?emotion[^>]*>/gi, "")
          .replace(/<break[^>]*\/?>/gi, "")
          .replace(/[^\S\r\n]{2,}/g, " ")
          .trim();
      }

      if (greetingText && !closed) {
        sendStatus("speaking");
        speaking = true;
        speakingStartedAt = Date.now();
        const _greetPbStart = Date.now();
        logPlaybackEvent(logExecution, "Playback Started", { provider: agent.ttsProvider, turnNumber: 0 });

        let greetAudio: Buffer;
        try {
          if (tts.synthesizeStream) {
            const chunks: Buffer[] = [];
            await tts.synthesizeStream(greetingText, (c) => chunks.push(c), () => {});
            greetAudio = withTailSilence(Buffer.concat(chunks));
          } else {
            const { audio } = await tts.synthesize(greetingText);
            greetAudio = withTailSilence(audio);
          }

          // Set echo-grace to cover the full greeting duration so the mic echo
          // of the agent's own voice doesn't trigger a false barge-in mid-greeting.
          {
            const greetDurationMs = Math.round((greetAudio.length / 2 / 16000) * 1000);
            echoGraceUntil = Date.now() + greetDurationMs + echoGraceMs;
          }

          // Send transcript before audio starts so the UI shows the text
          // while the agent is speaking, not after it finishes.
          send({ type: "transcript", speaker: "agent", text: greetingText });
          recentAgentText.push({ text: stripSsml(normalizeIndic(greetingText)), at: Date.now() });

          for (let j = 0; j < greetAudio.length; j += AUDIO_CHUNK_BYTES) {
            if (closed || interrupted) break;
            const chunk = greetAudio.slice(j, j + AUDIO_CHUNK_BYTES);
            recording.addAgentChunk(chunk);
            sendSpeechAudio(chunk);
            await new Promise<void>(r => setTimeout(r, 40));
          }
        } catch (ttsErr) {
          // Recoverable: a transient greeting-TTS failure must NOT drop the call
          // before the caller can speak. Surface the failing TTS provider and a
          // human-readable reason (no silent swallowing), then re-throw to the
          // outer greeting catch which flips the session into Listening and lets
          // the call continue via the normal turn path. Mirrors the resilient
          // telephony handling in pipeline.ts's greet() catch block.
          logger.error(
            { callId, agentId: agent.id, ttsProvider: agent.ttsProvider, err: ttsErr },
            toReadableError(ttsErr, "Greeting TTS synthesis error") +
              " — continuing call in listening state instead of dropping",
          );
          logPlaybackEvent(logExecution, "Playback Cancelled", {
            provider: agent.ttsProvider,
            turnNumber: 0,
            playbackDurationMs: Date.now() - _greetPbStart,
            stopReason: "tts_error",
          });
          throw ttsErr;
        }

        const _greetPbEvent: PlaybackEvent = closed
          ? "Playback Cancelled"
          : interrupted
            ? "Playback Interrupted"
            : "Playback Completed";
        const _greetAudioDurationMs = Math.round((greetAudio.length / 2 / 16000) * 1000);
        logPlaybackEvent(logExecution, _greetPbEvent, {
          provider: agent.ttsProvider,
          turnNumber: 0,
          playbackDurationMs: Date.now() - _greetPbStart,
          audioDurationMs: _greetAudioDurationMs,
          stopReason: closed ? "call_closed" : interrupted ? "barge_in" : "completed",
        });
        speaking = false;
        speakingEndedAt = Date.now();
        history.push({ role: "assistant", content: greetingText });

        if (!closed) {
          // Extend echo-grace through the tail drain + echo-decay margin so the
          // greeting's own echo can't trigger a false barge-in after we flip to
          // listening (mirrors the main-turn tail drain at end of speak loop).
          echoGraceUntil = Math.max(
            echoGraceUntil,
            Date.now() + AUDIO_TAIL_SILENCE_MS + WEB_TAIL_ECHO_MARGIN_MS,
          );
          // Send real PCM silence frames (not a passive wait) so the client's
          // AudioContext timeline is physically extended past the greeting's final
          // word — matching the 300 ms tail drain used by every normal turn.
          const silenceChunk = Buffer.alloc(AUDIO_CHUNK_BYTES, 0);
          const drainFrames = Math.ceil(AUDIO_TAIL_SILENCE_MS / 40);
          for (let j = 0; j < drainFrames && !closed; j++) {
            sendAudio(silenceChunk);
            await new Promise<void>(r => setTimeout(r, 40));
          }
          if (!closed) sendStatus("listening");
        }
      } else if (!closed) {
        sendStatus("listening");
      }
    } catch (greetErr) {
      logger.warn({ callId, greetErr }, "Opening greeting failed — continuing normally");
      speaking = false;
      speakingEndedAt = Date.now();
      if (!closed) sendStatus("listening");
    }
  }

  maxTimer = setTimeout(() => { void hangup("timeout"); }, (agent.maxDuration ?? 600) * 1000);

  // Entered Listening after the opening greeting — arm the stall backstop.
  if (!closed) safetyNet.beginListening();

  // ── Hangup ────────────────────────────────────────────────────────────────
  // ── Ambient noise interval (webcall) ──────────────────────────────────────
  // Start interval whenever ambient is enabled; for uploaded UUID tracks the
  // stream is initially null while loadPcmLoop() resolves asynchronously, so
  // each tick guards on ambientStream (mirroring pipeline.ts behaviour).
  if (ambientEnabled && ambientTrack) {
    ambientInterval = setInterval(() => {
      if (closed || speaking || !ambientStream) return;
      // ambient.ts produces 8kHz mulaw — decode to PCM8k then upsample to PCM16k
      const mulawChunk = ambientStream.nextMulawChunk();
      const pcm16k = upsample8to16(decodeMulaw(mulawChunk));
      if (ws.readyState === ws.OPEN) ws.send(pcm16k);
    }, 20);
  }

  async function hangup(reason = "normal", errorDetail?: unknown) {
    if (closed) return;
    closed = true;
    safetyNet.clear();
    if (streamSTT) { try { streamSTT.close(); } catch { /* best-effort */ } streamSTT = null; }
    if (ambientInterval) { clearInterval(ambientInterval); ambientInterval = null; }
    if (maxTimer) { clearTimeout(maxTimer); maxTimer = undefined; }
    clearSilenceTimer();
    if (hangupSilenceTimer) { clearTimeout(hangupSilenceTimer); hangupSilenceTimer = null; }
    if (playbackSilenceTimer) { clearTimeout(playbackSilenceTimer); playbackSilenceTimer = null; }

    const endedAt         = new Date();
    const durationSeconds = Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000);

    // ── Finalize recording (only when "Record Calls" is on) — must precede the
    // Call Ended row so its recordingStatus is accurate. recordingUrl/Error stay
    // in scope for the callsTable update below. ──────────────────────────────
    const recordingEnabled = (agentCfg["recordingEnabled"] as boolean | undefined) ?? false;
    let recordingUrl: string | null = null;
    let recordingError: string | null = null;
    let recordingStatus: "disabled" | "saved" | "failed" = "disabled";
    if (recordingEnabled) {
      logRecordingEvent(logExecution, "Recording Started");
      const result = await recording.finalize(callId).catch((err) => {
        logger.error({ callId, err }, "WebCall recording finalize threw");
        return { url: null, error: err instanceof Error ? err.message : String(err) };
      });
      recordingUrl = result.url;
      recordingError = result.error;
      if (recordingError) {
        logger.error({ callId, recordingError }, "WebCall recording finalize failed");
        recordingStatus = "failed";
        logRecordingEvent(logExecution, "Recording Failed", { error: recordingError });
      } else {
        recordingStatus = "saved";
        logRecordingEvent(logExecution, "Recording Saved", { url: recordingUrl });
        logRecordingEvent(logExecution, "Recording Uploaded", { url: recordingUrl });
      }
    }

    // Last spoken user + agent turns (skip synthetic tool markers).
    let lastUserTxt: string | null = null;
    let lastAgentTxt: string | null = null;
    for (let i = history.length - 1; i >= 0; i--) {
      const t = history[i]!;
      if (typeof t.content !== "string" || t.content.startsWith("[")) continue;
      if (lastAgentTxt === null && t.role === "assistant" && t.content) lastAgentTxt = t.content;
      if (lastUserTxt === null && t.role === "user" && t.content) lastUserTxt = t.content;
      if (lastUserTxt !== null && lastAgentTxt !== null) break;
    }

    // ── Structured Call Ended (final row) — mirrors the telephony teardown ────
    writeCallEndedLog(callId, agentId, {
      rawReason: reason,
      durationSeconds,
      turns: history.filter(t => t.role === "assistant").length,
      errorMessage: errorDetail
        ? (errorDetail instanceof Error ? errorDetail.message : String(errorDetail))
        : null,
      lastUserTranscript: lastUserTxt,
      lastAgentResponse: lastAgentTxt,
      recordingStatus,
    });
    const transcript      = history.map(t => `${t.role === "user" ? "Caller" : "Agent"}: ${t.content}`).join("\n");

    const isFailed = reason === "error" || reason === "timeout";
    let errorMessage: string | null = null;
    if (reason === "timeout") {
      errorMessage = "Call timeout";
    } else if (reason === "error") {
      if (typeof errorDetail === "string") {
        errorMessage = errorDetail;
      } else if (errorDetail instanceof Error) {
        errorMessage = `Error: ${errorDetail.message}`;
      } else if (errorDetail != null) {
        errorMessage = `Error: ${String(errorDetail)}`;
      } else {
        errorMessage = "Error";
      }
    }

    try {
      await db.update(callsTable).set({
        status: isFailed ? "failed" : "completed",
        endedAt,
        durationSeconds,
        transcript: transcript || null,
        ...(errorMessage ? { errorMessage } : {}),
        ...(recordingUrl ? { recordingUrl } : {}),
        ...(recordingError ? { recordingError } : {}),
      }).where(eq(callsTable.id, callId));

      const [ag] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
      if (ag) {
        const newSuccessful = ag.successfulCalls + 1;
        const newAvg = ag.avgDurationSeconds
          ? Math.floor((ag.avgDurationSeconds * ag.successfulCalls + durationSeconds) / newSuccessful)
          : durationSeconds;
        await db.update(agentsTable).set({ successfulCalls: newSuccessful, avgDurationSeconds: newAvg })
          .where(eq(agentsTable.id, agentId));

        // ── Record per-service usage events (STT / LLM / TTS) ────────────────
        const { recordUsage } = await import("../../services/usage/record-usage.js");
        const turnCount = history.filter(t => t.role === "assistant").length;
        const usageSuccess = turnCount > 0;
        const usageError   = usageSuccess ? null : "no_turns_completed";
        const safeDuration = Math.max(durationSeconds, 0);
        void recordUsage({
          service: "stt",
          provider: ag.asrProvider,
          model: ag.asrModel,
          userId: ag.userId ?? null,
          callId,
          audioSeconds: safeDuration,
          success: usageSuccess,
          errorMessage: usageError,
        });
        void recordUsage({
          service: "llm",
          provider: ag.llmProvider,
          model: ag.llmModel,
          userId: ag.userId ?? null,
          callId,
          inputTokens:  llmInputTokensTotal  > 0 ? llmInputTokensTotal  : Math.max(turnCount, 1) * 200,
          outputTokens: llmOutputTokensTotal > 0 ? llmOutputTokensTotal : Math.max(turnCount, 1) * 60,
          success: usageSuccess,
          errorMessage: usageError,
        });
        void recordUsage({
          service: "tts",
          provider: ag.ttsProvider,
          model: ag.ttsModel,
          userId: ag.userId ?? null,
          callId,
          characters: ttsCharactersTotal > 0 ? ttsCharactersTotal : Math.max(turnCount, 1) * 220,
          success: usageSuccess,
          errorMessage: usageError,
        });
      }

      // Deduct platform fee from wallet.
      // Mode is resolved dynamically: if user has their own provider keys → BYOP rate;
      // otherwise → managed rate (SnapServe's platform keys were in use).
      const callUserId = agent.userId ?? null;
      if (callUserId && durationSeconds > 0) {
        const billingMode      = await resolveAgentBillingMode(callUserId, agent);
        const rateCentsPerMin  = getFlatRateCentsPerMin(billingMode);
        const billableMinutes  = Math.ceil(durationSeconds / 60);
        const debitCents       = Math.round(billableMinutes * rateCentsPerMin);
        const modeLabel        = billingMode === "managed" ? "managed" : "BYOP";
        const billableLabel    = `${billableMinutes} min × $${(rateCentsPerMin / 100).toFixed(3)}/min (${modeLabel})`;

        // Persist cost on the call row so it shows up in call log detail
        await db.update(callsTable).set({ costCents: debitCents }).where(eq(callsTable.id, callId));

        const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, callUserId));
        if (user) {
          const newBalance = Math.round(Math.max(0, user.walletBalanceCents - debitCents));
          await db.update(usersTable).set({ walletBalanceCents: newBalance }).where(eq(usersTable.id, user.id));
          await db.insert(walletTransactionsTable).values({
            userId: user.id,
            type: "call_debit",
            amountCents: -debitCents,
            description: `WebCall #${callId} — ${billableLabel}`,
            status: "completed",
            callId,
          });
        }
      }
    } catch (err) {
      logger.error({ callId, err }, "Error finalising webcall");
    }

    // ── Post-call AI summary (fire-and-forget) ────────────────────────────────
    // No transcript-length gate: every completed call gets a summary when enabled.
    const summarizationEnabled = (agentCfg["summarizationEnabled"] as boolean | undefined) ?? false;
    if (summarizationEnabled) {
      void (async () => {
        try {
          const hasTranscript = !!(transcript && transcript.trim().length > 0);
          if (!hasTranscript) {
            // Empty-transcript edge case: store a short placeholder rather than failing.
            await db.update(callsTable)
              .set({ callSummary: "No conversation took place on this call, so there is nothing to summarize." })
              .where(eq(callsTable.id, callId));
            return;
          }
          const customPrompt = (agentCfg["summarizationPrompt"] as string | undefined) ?? "";
          const userContent = customPrompt
            ? `${customPrompt}\n\nTranscript:\n${transcript.slice(0, 6000)}`
            : `Summarize this call transcript as a single natural paragraph of 4 to 6 sentences. Briefly cover why the customer called, what was discussed, any important information collected, the outcome, and any follow-up or next steps (only if applicable). Write plain prose — do not use bullet points, numbered lists, or headings.\n\nTranscript:\n${transcript.slice(0, 6000)}`;
          let summary = "";
          await llm.chat(
            [{ role: "user", content: userContent }],
            "You are a call analyst. Write a concise, factual summary of the call as a single natural paragraph of 4 to 6 sentences. Do not use bullet points, numbered lists, or headings — write plain readable prose only.",
            () => {},
            (full) => { summary = full; }
          );
          if (summary) {
            await db.update(callsTable).set({ callSummary: summary }).where(eq(callsTable.id, callId));
          }
        } catch (summaryErr) {
          logger.warn({ callId, summaryErr }, "Post-call webcall summary generation failed");
        }
      })();
    }

    // ── Post-call disposition extraction (fire-and-forget) ───────────────────
    const dispositionSchema = Array.isArray(agent.dispositionSchema)
      ? (agent.dispositionSchema as Array<{ key: string; label: string; type: string; required?: boolean; options?: string[] }>)
      : [];
    if (dispositionSchema.length > 0 && transcript && transcript.length > 50) {
      void (async () => {
        try {
          const fieldList = dispositionSchema
            .map(f => `- "${f.key}" (${f.label}, type: ${f.type}${f.options?.length ? `, options: [${f.options.join(", ")}]` : ""})`)
            .join("\n");
          let raw = "";
          await llm.chat(
            [{ role: "user", content: `Transcript:\n${transcript.slice(0, 6000)}` }],
            `Extract the following disposition fields from this call transcript. Return ONLY a valid JSON object with the field keys as keys.\n\nFields:\n${fieldList}`,
            () => {},
            (full) => { raw = full; }
          );
          const jsonStr = raw.replace(/```(?:json)?\s*/gi, "").replace(/```\s*/g, "").trim();
          const result = JSON.parse(jsonStr) as Record<string, unknown>;
          if (result && typeof result === "object" && !Array.isArray(result)) {
            await db.update(callsTable).set({ dispositionResult: result as Record<string, string | number | boolean> }).where(eq(callsTable.id, callId));
            logger.info({ callId, fields: Object.keys(result) }, "Webcall: disposition extracted");
          }
        } catch (dispErr) {
          logger.warn({ callId, dispErr }, "Webcall: disposition extraction failed");
        }
      })();
    }

    // ── Post-call taxonomy disposition classification (fire-and-forget) ──────
    // Uses the agent's configured Call Disposition taxonomy (agent_dispositions)
    // and writes the result onto calls.disposition_result. No-ops when the agent
    // has no taxonomy configured. Mutually exclusive with the legacy
    // dispositionSchema path above (a given agent uses one or the other).
    disposeCall({
      agentId,
      callId,
      transcript: transcript ?? null,
      callEvents: [{ type: "duration", durationSec: durationSeconds }],
    }).catch((dispErr) => {
      logger.warn({ callId, dispErr }, "Webcall: taxonomy disposition failed");
    });

    // ── Post-call webcall memory update + callback detection (fire-and-forget) ─

    if (webcallIdentifier && history.length >= 2) {
      void updateCallerProfile({
        agentId,
        phoneNumber:      webcallIdentifier,
        history,
        llm,
        existing:         webcallProfile,
        callId,
        wasDropped:       false,
        callerNameInCall: webcallNameLatchedThisCall,
      }).catch((memErr) => {
        logger.warn({ callId, memErr }, "Post-call webcall memory update failed");
      });

      // Detect "call me back in X minutes" requests from webcall users.
      // Stores userId so the callback poller can push an SSE notification instead
      // of trying to dial a phone number.
      // Use callerUserId (the logged-in dashboard user) if provided;
      // fall back to agent.userId (agent owner) for backward compatibility.
      void detectCallbackRequest({
        agentId,
        toNumber: webcallIdentifier,
        userId: callerUserId ?? agent.userId ?? null,
        history,
        llm,
        callId,
      }).catch((cbErr) => {
        logger.warn({ callId, cbErr }, "Post-call webcall callback detection failed");
      });
    }

    send({ type: "ended", durationSeconds, reason });
    ws.close();
    logger.info({ callId, durationSeconds, reason }, "WebCall ended");
  }

  // ── Message handler ───────────────────────────────────────────────────────
  ws.on("message", (data: Buffer | string) => {
    if (closed) return;

    if (typeof data === "string") {
      try {
        const m = JSON.parse(data) as { type: string };
        if (m.type === "end") void hangup("normal");
        else if (m.type === "playback_ended") {
          // Client audio queue drained — safe to start the silence-hangup timer now.
          // Cancel the fallback timer (no longer needed) and arm the real one.
          if (playbackSilenceTimer) { clearTimeout(playbackSilenceTimer); playbackSilenceTimer = null; }
          logger.info({ callId }, "Webcall: playback_ended received — starting silence timer");
          resetHangupSilenceTimer();
        }
      }
      catch { /* ignore */ }
      return;
    }

    // Record caller audio UNCONDITIONALLY — including while the agent speaks.
    // RecordingBuffer now lays each track on a shared wall-clock timeline, so
    // capturing the caller during agent speech preserves talk-over / barge-in /
    // early-reply audio on the caller (left) channel without desyncing or
    // creating the "on and off" agent-track dropouts the old `!speaking` gate
    // was added to prevent. The barge-in/STT/gender gates below are untouched.
    recording.addCallerChunk(data as Buffer);

    // Gender detector needs 8 kHz (trained on telephony-band audio)
    const pcm8kForGender = downsample16to8(data as Buffer);
    // Same !speaking gate for gender: agent TTS echo through the mic sounds female
    // (Cartesia/ElevenLabs voice) and overwhelms the gender classifier when the
    // agent talks for long stretches, flipping "Sir" → "Ma'am".
    if (genderDetector && !speaking) genderDetector.addSpeechChunk(pcm8kForGender);
    const rms = rmsEnergy(data);

    if (speaking) {
      // Agent is speaking — use elevated threshold to ignore echo / ambient noise.
      // Require BARGE_IN_MIN_FRAMES consecutive loud frames before accepting a barge-in,
      // so a single word, cough, or background voice doesn't stop the agent mid-sentence.
      //
      // Only suppress barge-in during the START grace (browser AEC needs 500–800 ms to adapt
      // after TTS begins before it can cancel the speaker echo).
      //
      // NOTE: inEndGrace (suppressing ~600 ms after the last chunk) is intentionally NOT
      // applied here. Since chunks are sent every 40 ms, lastChunkSentAt would always be
      // within 40 ms, making inEndGrace permanently true and blocking all energy-based
      // barge-in for the entire utterance. The end grace is applied BELOW, in the
      // !speaking branch, to suppress the trailing echo of the final word from starting
      // a new user turn.
      // Allow Barge-in disabled → never interrupt via energy. Still drain the
      // silence-timer branch below by returning (agent owns the turn while speaking).
      if (!bargeInEnabled) return;
      const inStartGrace = Date.now() < echoGraceUntil;
      if (!inStartGrace && rms > bargeInRmsThreshold) {
        if (bargeInFrames === 0) bargeInFirstFrameAt = Date.now(); // start of this loud run
        bargeInFrames++;
        bargeInLowEnergyFrames = 0; // high-energy frame — reset the dip counter
        const bargeFrame = Buffer.from(data);
        audioChunks.push(bargeFrame); // accumulate speech for batch STT fallback
        streamSTT?.sendAudio(bargeFrame); // also feed streaming STT so it has the full utterance
        const durationMs     = Date.now() - bargeInFirstFrameAt;
        const interruptScore = Math.min(bargeInFrames / effectiveBargeInMinFrames, 1)
                             * Math.min(durationMs / BARGE_IN_MIN_DURATION_MS, 1);
        // Confidence gate: require both sustained energy (min frames) AND minimum
        // duration (150 ms) so brief noise bursts — cough, keyboard, background TV —
        // can't interrupt mid-sentence. interruptScore=1.0 means both conditions met.
        if (!interrupted
            && bargeInFrames >= effectiveBargeInMinFrames
            && durationMs    >= BARGE_IN_MIN_DURATION_MS) {
          interrupted = true;
          send({ type: "interrupted" }); // tell client to stop playing
          sendStatus("thinking");
          logExecution("STT", "system", {
            provider: agent.asrProvider,
            status: "info",
            turnNumber: _webcallTurnIdx,
            warningFlags: ["barge_in"],
            metadata: { event: "Barge-in Detected", reason: "energy", rms, durationMs, interruptScore: +interruptScore.toFixed(2) },
          });
          logger.info({ callId, rms, bargeInFrames, effectiveBargeInMinFrames, durationMs, interruptScore: +interruptScore.toFixed(2) }, "Barge-in triggered");
        }
      } else if (!inStartGrace) {
        // Low-energy frame while outside start grace.
        // Don't reset bargeInFrames immediately — natural speech has brief inter-syllable
        // dips. Only reset after BARGE_IN_LOW_RESET consecutive low frames (~200ms silence).
        bargeInLowEnergyFrames++;
        if (bargeInLowEnergyFrames >= BARGE_IN_LOW_RESET) {
          bargeInFrames       = 0;
          bargeInLowEnergyFrames = 0;
          bargeInFirstFrameAt = 0; // reset the duration clock
        }
      }
      // Note: frames inside start grace are completely ignored (no counter changes)
      return; // don't touch silence timer while speaking
    }
    bargeInFrames       = 0;           // agent not speaking — reset
    bargeInLowEnergyFrames = 0;
    bargeInFirstFrameAt = 0;
    // Track the last loud caller frame for isAgentEcho()'s energy tiebreaker.
    // A timestamp (not a boolean) is required: Sarvam fires onFinal after end-of-speech
    // silence, so a boolean would be overwritten to false by trailing silent frames before
    // the transcript fires. lastLoudFrameAt preserves the most recent loud-frame time across
    // the silence gap so the tiebreaker can check within the full ECHO_CONTENT_WINDOW_MS.
    //
    // Use SPEECH_RMS_THRESHOLD (400), NOT bargeInRmsThreshold (800). Post-AEC, a genuine
    // short confirmation ("சரி") can land at 600–800 RMS — below the barge-in threshold
    // but clearly above background noise. Using 800 here would blind the tiebreaker to
    // that mid-band signal, causing a genuine caller "சரி" to be dropped as echo every
    // time the agent said "சரி". The design biases toward accepting the caller (missed
    // echo → one extra turn; missed genuine → caller must repeat every turn).
    if (rms > SPEECH_RMS_THRESHOLD) lastLoudFrameAt = Date.now();

    // Streaming STT path: send all audio directly to the provider WebSocket.
    // Audio flows unconditionally — no end-grace early-return. Echo transcripts
    // arriving post-speech are filtered by isAgentEcho() (content-based), which
    // correctly lets fast genuine replies through while dropping acoustic echo.
    // We ALSO mirror speech frames into audioChunks as a backup so batch STT
    // can recover if the streaming provider fires a NoMatch / empty final.
    // The streamingFallbackTimer fires after STREAMING_BATCH_FALLBACK_MS of
    // silence; if streaming produced nothing by then, process() runs batch STT.
    // When streaming fires a valid final it cancels the timer and clears the
    // backup (see the onFinal handler above).
    if (streamSTT) {
      const chunk = Buffer.from(data);
      streamSTT.sendAudio(chunk); // always feed the streaming provider so it receives every audio frame
      if (!processing && rms > SPEECH_RMS_THRESHOLD) sendStatus("listening");
      if (rms > SPEECH_RMS_THRESHOLD) {
        audioChunks.push(chunk);
        clearStreamingFallback(); // user still speaking — reset the fallback window
        if (hangupSilenceTimer) { clearTimeout(hangupSilenceTimer); hangupSilenceTimer = null; }
      } else if (audioChunks.length > 0) {
        audioChunks.push(chunk);
        if (!streamingFallbackTimer) {
          streamingFallbackTimer = setTimeout(() => {
            streamingFallbackTimer = null;
            if (!processing && !speaking && !closed && audioChunks.length > 0 && !streamingTranscriptPending) {
              // Nudge the streaming provider to finalize its buffer before we fall back.
              streamSTT?.flush?.();
              // Give the flush a short window to return a transcript; if it does,
              // onFinal will cancel the batch fallback. Otherwise batch STT runs.
              setTimeout(() => {
                if (!processing && !speaking && !closed && audioChunks.length > 0 && !streamingTranscriptPending) {
                  logger.warn({ callId, chunks: audioChunks.length }, "Webcall: streaming STT gave no final — falling back to batch STT");
                  void process();
                } else {
                  audioChunks.splice(0);
                }
              }, 400);
            } else {
              audioChunks.splice(0); // streaming handled it or call ended — discard backup
            }
          }, STREAMING_BATCH_FALLBACK_MS);
        }
      }
      return;
    }

    // Batch STT path: local VAD accumulates speech, flushes after silence
    if (rms > SPEECH_RMS_THRESHOLD) {
      const chunk = Buffer.from(data);
      audioChunks.push(chunk);
      clearSilenceTimer();
      // Caller is speaking — reset the silence-hangup countdown
      if (hangupSilenceTimer) { clearTimeout(hangupSilenceTimer); hangupSilenceTimer = null; }
      if (!processing) sendStatus("listening");
    } else if (audioChunks.length > 0) {
      audioChunks.push(Buffer.from(data));
      scheduleSilenceFlush();
    }
  });

  ws.on("close", () => { if (!closed) hangup("disconnected").catch((err: unknown) => logger.error({ callId, err }, "WebCall WS close: hangup failed")); });
  ws.on("error", (err: unknown) => {
    logger.error({ callId, err }, "WebCall WS error");
    if (!closed) hangup("error", err).catch((e: unknown) => logger.error({ callId, err: e }, "WebCall WS error: hangup failed"));
  });
}
