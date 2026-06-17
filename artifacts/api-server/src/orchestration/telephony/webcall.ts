import { performance } from "perf_hooks";
import { computeEndpointMs } from "../endpointing.js";
import { checkTranscriptQuality, pickClarificationPhrase, isSemanticInterrupt } from "../transcriptQuality.js";
import type { WebSocket } from "ws";
import { db, agentsTable, callsTable, callEventsTable, executionLogsTable, scheduledCallbacksTable, providersTable, usersTable, walletTransactionsTable, platformSettingsTable, knowledgeEntriesTable } from "@workspace/db";
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
import { loadCallerContext, injectEnhancedMemory, updateCallerProfile, latchCallerName, latchCallerFact, detectCallbackRequest } from "../callerMemory.js";

import { GenderDetector } from "../genderDetector.js";
import { GenderDetectorML } from "../genderDetectorML.js";
import { GenderDetectorMLv2 } from "../genderDetectorMLv2.js";
import { buildDatetimeInjection } from "../datetimeInject.js";
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

// ── Per-user concurrent call rate limit ──────────────────────────────────────
const activeCalls = new Map<string, number>();
const DEFAULT_CONCURRENT_LIMIT = 15; // default when user row has no value

// ── Tuning constants ─────────────────────────────────────────────────────────
const VAD_SILENCE_MS           = 200;   // silence window before sending audio to STT (ms)
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
const BARGE_IN_END_GRACE_MS    = 600;  // suppress barge-in for 600ms after the last TTS chunk — prevents mic echo
                                        // of the final word triggering a false barge-in and cutting it off
const AUDIO_TAIL_SILENCE_MS    = 300;  // extra wait after the last chunk so the client's audio buffer drains
                                        // before the server signals "listening" (prevents last-word cutoff)
const TTS_TAIL_SILENCE_MS      = 150;  // PCM silence appended to every TTS buffer so the last word isn't clipped
                                        // by the client's AudioContext reaching the end of its scheduled queue
const MIN_PCM_BYTES            = 3200; // ~100ms at 16kHz Int16 — minimum speech before processing
const AUDIO_CHUNK_BYTES        = 1280; // 40ms per WS frame
const HANDOFF_SILENCE_MS       = 3000; // sustained silence that may indicate a phone handoff
const TTS_VOLUME_GAIN          = 1.5;  // PCM amplitude multiplier — reduced from 2.5 to prevent hard-clipping distortion

const BACKCHANNEL_PHRASES = [
  "I see.", "Got it.", "Okay.", "Mm-hmm.", "Sure.", "I understand.", "Go on.",
];

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

function extractSentences(buf: string): [string[], string] {
  const parts = buf.split(/(?<=[.!?])\s+/);
  if (parts.length <= 1) return [[], buf];
  const complete = parts.slice(0, -1).map(s => s.trim()).filter(Boolean);
  return [complete, parts[parts.length - 1] ?? ""];
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
  const isMultilingualWc = (agentCfgWc["isMultilingual"] as boolean | undefined) ?? false;
  const multilingualLanguagesWc = (agentCfgWc["multilingualLanguages"] as string[] | undefined) ?? [];

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
    // Multilingual: pass all configured languages as Azure LID candidates
    ...(isMultilingualWc && multilingualLanguagesWc.length > 0
      ? { candidateLanguages: multilingualLanguagesWc }
      : {}),
  };

  const sttExtraConfig = providerKeys.get(`${agent.asrProvider?.toLowerCase()}:extraConfig`) ?? null;
  const stt = createSTTAdapter(agent.asrProvider, sttKey, agent.asrModel, sttExtraConfig, sttConfig);
  const llm = createLLMAdapter(agent.llmProvider, llmKey, agent.llmModel);

  // ── Streaming STT (saaras:v3, Deepgram) ─────────────────────────────────
  // Initialised below, after the call record exists and callId is known.
  let streamSTT: StreamSTT | null = null;
  // Transcript received from streaming STT WebSocket — consumed by process()
  let streamingTranscriptPending: string | null = null;
  // When multilingual is OFF, prefer asrLanguage over language for TTS —
  // setting the Transcriber to kn-IN signals intent for the whole agent to run
  // in Kannada, not just ASR. When multilingual is ON, language hot-swaps via
  // setLanguage() so we use the primary agent.language as the initial locale.
  const agentLanguage = (!isMultilingualWc && agent.asrLanguage)
    ? agent.asrLanguage
    : (agent.language ?? null);
  const ttsExtraConfig = agent.ttsProvider === "sarvam"
    ? JSON.stringify({ language: agentLanguage ?? "en-IN" })
    : null;
  const tts = createTTSAdapter(agent.ttsProvider, ttsKey, agent.ttsVoice, agent.ttsModel, ttsExtraConfig, agentLanguage);

  // Multilingual: tracks the current detected language for TTS hot-swap.
  // Initialised from agentLanguage so the per-turn LLM language injection
  // fires from turn 1 even in non-multilingual mode (e.g. kn-IN from start).
  let currentLangWc: string = agentLanguage ?? "";

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

  // ── Per-call execution logger (fire-and-forget, never blocks the call) ────
  function logExecution(
    component: string,
    direction: "request" | "response" | "system",
    opts: {
      provider?: string;
      status?: "success" | "error" | "info";
      latencyMs?: number;
      requestPayload?: Record<string, unknown>;
      responsePayload?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    } = {}
  ) {
    void db.insert(executionLogsTable).values({
      callId, agentId,
      component, direction,
      provider: opts.provider ?? null,
      status: opts.status ?? "info",
      latencyMs: opts.latencyMs ?? null,
      requestPayload: opts.requestPayload ?? null,
      responsePayload: opts.responsePayload ?? null,
      metadata: opts.metadata ?? null,
    }).catch(() => {});
  }

  logExecution("Agent", "system", {
    requestPayload: {
      agentId,
      agentName: agent.name,
      asrProvider: agent.asrProvider,
      llmProvider: agent.llmProvider,
      ttsProvider: agent.ttsProvider,
      ttsVoice: agent.ttsVoice ?? null,
    },
    status: "info",
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
        (text, isFinal, detectedLanguage) => {
          if (!isFinal || !text.trim() || closed) return;
          // Multilingual: hot-swap TTS language when Azure LID detects a switch
          if (detectedLanguage && isMultilingualWc && detectedLanguage !== currentLangWc) {
            currentLangWc = detectedLanguage;
            if (typeof (tts as unknown as { setLanguage?: (l: string) => void }).setLanguage === "function") {
              (tts as unknown as { setLanguage: (l: string) => void }).setLanguage(detectedLanguage);
            }
            logger.info({ callId, lang: detectedLanguage }, "Webcall multilingual: language switched mid-call");
          }
          // Barge-in: if agent is speaking, only interrupt if the transcript
          // meets the same wordsForInterruption gate as energy-based barge-in.
          // This prevents a faint background speaker (distant person) producing
          // a short 1-word Sarvam/Deepgram transcript from cutting the agent off.
          if (speaking) {
            // P0-C: Semantic barge-in — keywords bypass the word-count gate
            const semanticOverride = isSemanticInterrupt(text);
            const wc = text.trim().split(/\s+/).length;
            if (!semanticOverride && wc < wordsForInterruption) {
              logger.info({ callId, text, wc, wordsForInterruption }, "Webcall: ignoring short STT transcript during speaking");
              return;
            }
            interrupted = true;
            send({ type: "interrupted" });
            sendStatus("thinking");
            logger.info({ callId, wc, semanticOverride }, "Webcall: barge-in via streaming STT");
          } else if (speakingEndedAt > 0 && Date.now() - speakingEndedAt < BARGE_IN_END_GRACE_MS) {
            // Transcript arrived after speaking ended but within the end-grace window.
            // It was produced from frames fed to the STT provider *during* barge-in detection
            // (agent was still speaking, threshold not reached). Replaying this as a new user
            // turn would make the agent answer speech that overlapped with its own output.
            logger.info({ callId, msSinceEnd: Date.now() - speakingEndedAt }, "Webcall: discarding post-speech transcript (leftover from barge-in detection)");
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
                    if (!isFinal || !text.trim() || closed) return;
                    if (speaking) {
                      const wc = text.trim().split(/\s+/).length;
                      if (wc < wordsForInterruption) {
                        logger.info({ callId, text, wc, wordsForInterruption }, "Webcall: ignoring short transcript (fallback STT)");
                        return;
                      }
                      interrupted = true;
                      send({ type: "interrupted" });
                      sendStatus("thinking");
                      logger.info({ callId, wc }, "Webcall: barge-in via fallback streaming STT");
                    } else if (speakingEndedAt > 0 && Date.now() - speakingEndedAt < BARGE_IN_END_GRACE_MS) {
                      logger.info({ callId, msSinceEnd: Date.now() - speakingEndedAt }, "Webcall: discarding post-speech transcript (fallback STT)");
                      return;
                    }
                    if (processing) { streamingTranscriptPending = text; return; }
                    streamingTranscriptPending = text;
                    void process();
                  },
                  () => { streamSTT = null; },
                );
                logger.info({ callId, provider: fb.provider }, "Webcall: streaming STT fallback reconnected");
                break;
              } catch (fbInitErr) {
                logger.warn({ callId, provider: fb.provider, err: fbInitErr }, "Webcall: streaming STT fallback init failed");
              }
            }
          }
        },
      );
      logger.info({ callId, provider: agent.asrProvider }, "Webcall: streaming STT initialised");
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
  let webcallLatchedFacts = new Map<string, string>();
  let systemPrompt = agent.generatedPrompt ?? agent.systemPrompt ?? "";

  if (webcallIdentifier) {
    try {
      const webcallCtx = await loadCallerContext(agentId, webcallIdentifier);
      webcallProfile = webcallCtx.profile;
      for (const f of webcallCtx.facts) webcallLatchedFacts.set(f.key, f.value);
      if (webcallProfile || webcallCtx.facts.length > 0 || webcallCtx.recentCalls.length > 0) {
        systemPrompt = injectEnhancedMemory(systemPrompt, webcallCtx, { isMultilingual: isMultilingualWc });
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
  const incrementalDelayMs = (agentCfg["incrementalDelay"] as number | undefined) ?? 0;
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
  let processing  = false;
  let speaking        = false; // true while audio frames are being sent to client
  let speakingStartedAt = 0;  // timestamp (ms) when speaking last transitioned to true
  let speakingEndedAt = 0;    // timestamp (ms) when speaking last transitioned to false
  let lastChunkSentAt = 0;    // timestamp (ms) of the most recent TTS audio chunk sent to client
  let interrupted = false;          // barge-in flag; checked inside audio loop
  let bargeInFrames = 0;           // high-RMS frames accumulated while agent is speaking
  let bargeInLowEnergyFrames = 0;  // consecutive LOW-energy frames since the last high-energy frame
  // bargeInFrames is NOT reset on a single low-energy frame — natural speech has brief
  // inter-syllable dips. Only reset after BARGE_IN_LOW_RESET consecutive low frames.
  const BARGE_IN_LOW_RESET = 5;    // ~200ms of silence resets the barge-in run

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
      if (!userText?.trim()) { processing = false; return; }

      // P0-A: Garbled transcript recovery — catch noise/garbage before it reaches the LLM
      {
        const { isGarbled, reason: garbledReason } = checkTranscriptQuality(userText);
        if (isGarbled) {
          const clarification = pickClarificationPhrase();
          logger.warn({ callId, transcript: userText, garbledReason }, "Webcall: garbled transcript — responding with clarification");
          history.push({ role: "assistant", content: clarification });
          send({ type: "transcript", speaker: "agent", text: clarification });
          try {
            const { audio } = await tts.synthesize(clarification);
            if (!closed) {
              sendStatus("speaking");
              speaking = true;
              speakingStartedAt = Date.now();
              for (let _ci = 0; _ci < audio.length; _ci += 3200) {
                if (closed || interrupted) break;
                sendSpeechAudio(audio.slice(_ci, _ci + 3200));
                await new Promise<void>((r) => setTimeout(r, 20));
              }
              speaking = false;
              speakingEndedAt = Date.now();
            }
          } catch { /* ignore TTS errors on clarification */ }
          processing = false;
          return;
        }
      }

      logExecution("STT", "response", {
        provider: agent.asrProvider,
        responsePayload: { transcript: userText },
        status: "success",
      });
      send({ type: "transcript", speaker: "user", text: userText });
      history.push({ role: "user", content: userText });

      // Real-time name + fact latch — fire-and-forget, never blocks the agent turn
      if (webcallIdentifier) {
        void latchCallerName({ agentId, phoneNumber: webcallIdentifier, transcript: userText, existingName: webcallProfile?.name ?? null, callId }).then((latched) => {
          if (latched && webcallProfile) webcallProfile = { ...webcallProfile, name: latched };
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
            try {
              const { audio } = await tts.synthesize(goodbyeText);
              if (!closed) {
                sendStatus("speaking");
                speaking = true;
                speakingStartedAt = Date.now();
                for (let j = 0; j < audio.length; j += AUDIO_CHUNK_BYTES) {
                  if (closed || interrupted) break;
                  sendSpeechAudio(audio.slice(j, j + AUDIO_CHUNK_BYTES));
                  await new Promise<void>((r) => setTimeout(r, 40));
                }
                speaking = false;
                speakingEndedAt = Date.now();
              }
            } catch { /* ignore TTS errors on goodbye */ }
            if (!closed) void hangup("normal");
            return;
          }
        }
      }

      // 2. LLM — stream tokens, kick off TTS synthesis per sentence in parallel
      // Each job starts as soon as its sentence is extracted, so synthesis
      // overlaps with LLM streaming. By the time LLM finishes, sentence 1
      // audio is usually already fully collected — minimising first-audio delay.
      let sentenceJobs: Promise<Buffer>[] = [];
      let sentenceTexts: string[] = [];  // parallel to sentenceJobs — canonical text per sentence for UI highlighting
      let tokenBuf  = "";   // filtered text waiting to be split into sentences
      let fullReply = "";   // raw LLM output (may include <think> blocks)

      // ── Think-block filter (same as pipeline.ts) ──────────────────────────
      let inThinkBlock = false;
      let thinkBuf = "";

      function filterThinkToken(token: string): string {
        thinkBuf += token;
        let out = "";
        while (thinkBuf.length > 0) {
          if (inThinkBlock) {
            const closeIdx = thinkBuf.indexOf("</think>");
            if (closeIdx !== -1) {
              inThinkBlock = false;
              thinkBuf = thinkBuf.slice(closeIdx + "</think>".length);
            } else {
              const tail = Math.max(0, thinkBuf.length - "</think>".length + 1);
              thinkBuf = thinkBuf.slice(tail);
              break;
            }
          } else {
            const openIdx = thinkBuf.indexOf("<think>");
            if (openIdx !== -1) {
              out += thinkBuf.slice(0, openIdx);
              inThinkBlock = true;
              thinkBuf = thinkBuf.slice(openIdx + "<think>".length);
            } else {
              const tail = Math.max(0, thinkBuf.length - "<think>".length + 1);
              out += thinkBuf.slice(0, tail);
              thinkBuf = thinkBuf.slice(tail);
              break;
            }
          }
        }
        return out;
      }

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
      // ──────────────────────────────────────────────────────────────────────

      function queueSentence(text: string) {
        const t = text.trim();
        if (!t) return;
        if (_llmStreamActive && _tLlmFirstClause === null) {
          _tLlmFirstClause = performance.now();
        }
        ttsCharactersTotal += t.length;
        const ttsReqStart = Date.now();
        logExecution("TTS", "request", {
          provider: agent.ttsProvider,
          requestPayload: { text: t },
          status: "info",
        });
        // Kick off synthesis immediately so it runs in parallel with LLM streaming.
        // If synthesizeStream is available, use it to collect the full audio via
        // HTTP streaming (potentially faster than waiting for the full response).
        // Either way, the job resolves to a complete Buffer — played from memory
        // with no per-chunk network jitter.
        let job: Promise<Buffer>;
        if (tts.synthesizeStream) {
          job = (async () => {
            const chunks: Buffer[] = [];
            await tts.synthesizeStream!(t, (c) => {
              if (_tTtsFirstByte === null) _tTtsFirstByte = performance.now();
              chunks.push(c);
            }, () => {});
            const audio = Buffer.concat(chunks);
            logger.info({ callId, sentenceText: t, audioBytes: audio.length }, "TTS sentence synthesized");
            logExecution("TTS", "response", {
              provider: agent.ttsProvider,
              responsePayload: { audioBytes: audio.length, textLength: t.length },
              latencyMs: Date.now() - ttsReqStart,
              status: "success",
            });
            return withTailSilence(audio);
          })();
        } else {
          job = tts.synthesize(t).then(({ audio }) => {
            logger.info({ callId, sentenceText: t, audioBytes: audio.length }, "TTS sentence synthesized");
            logExecution("TTS", "response", {
              provider: agent.ttsProvider,
              responsePayload: { audioBytes: audio.length, textLength: t.length },
              latencyMs: Date.now() - ttsReqStart,
              status: "success",
            });
            return withTailSilence(audio);
          });
        }
        // Attach a no-op catch immediately so Node.js doesn't fire
        // unhandledRejection before the for-loop below awaits the job.
        job.catch(() => {});
        sentenceJobs.push(job);
        sentenceTexts.push(t);
      }

      // Build per-turn system prompt with datetime + language + gender injected
      let systemPromptForTurn = systemPrompt;
      const agentTimezone = (agentCfg["timezone"] as string | undefined) || "Asia/Kolkata";
      const dtInjection = buildDatetimeInjection(agentTimezone);
      systemPromptForTurn = `${dtInjection}\n\n${systemPromptForTurn}`;
      // Tell the LLM which language to reply in for this turn.
      // Fires in both multilingual mode (Azure LID detected switch) and
      // non-multilingual mode (seeded from agentLanguage at call start).
      if (currentLangWc) {
        const LANG_NAMES: Record<string, string> = {
          "hi-IN": "Hindi", "ta-IN": "Tamil", "te-IN": "Telugu", "kn-IN": "Kannada",
          "ml-IN": "Malayalam", "mr-IN": "Marathi", "bn-IN": "Bengali", "gu-IN": "Gujarati",
          "pa-IN": "Punjabi", "or-IN": "Odia", "ur-IN": "Urdu",
          "en-IN": "English", "en-US": "English", "en-GB": "English",
          "fr-FR": "French", "de-DE": "German", "es-ES": "Spanish", "pt-BR": "Portuguese",
          "it-IT": "Italian", "ja-JP": "Japanese", "ko-KR": "Korean", "zh-CN": "Chinese",
          "ar-EG": "Arabic", "ru-RU": "Russian",
        };
        const langName = LANG_NAMES[currentLangWc] ?? currentLangWc;
        if (isMultilingualWc) {
          systemPromptForTurn += `\n\n[ACTIVE LANGUAGE] The caller is currently speaking ${langName}. Respond ONLY in ${langName} for this reply.`;
        } else {
          systemPromptForTurn += `\n\n[LANGUAGE — NON-NEGOTIABLE] This agent is configured for ${langName} ONLY. You MUST respond in ${langName} regardless of any stored language_pref in caller memory or inferred language from the conversation. Do NOT switch to any other language under any circumstances.`;
        }
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
        const listName = listTool?.name ?? "get_bookings";
        const checkName = checkTool?.name ?? "check_availability";
        systemPromptForTurn += [
          "",
          "",
          "[SCHEDULING TOOL GUIDE]",
          "State machine for cancel/reschedule:",
          `1. ALWAYS call "${listName}" (not "${checkName}") to look up their existing appointment by name. Never call "${checkName}" for this purpose.`,
          `2. Always pass the caller's stated timezone into every scheduling tool call (e.g. timezone="Asia/Kolkata"). Default to "Asia/Kolkata" if not stated.`,
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
        const lines = [
          "",
          "",
          "[BOOKING TOOL GUIDE]",
          `CRITICAL: NEVER invent, guess, or assume any available slot times. You MUST call "${checkName}" before telling the caller any available times. Only relay times you received directly from a "${checkName}" tool result.`,
        ];
        if (hasCheckAvailabilityTool) {
          lines.push(`"${checkName}" ONLY checks available slots — it does NOT create a booking.`);
        }
        if (hasBookingTool) {
          lines.push(
            `Before calling "${bookName}", you MUST collect the caller's full name and email address. Ask for them if not yet provided.`,
            `NEVER tell the caller their appointment is confirmed or scheduled unless you have received a booking_confirmed: result from "${bookName}".`,
            `Do NOT say "Your appointment has been scheduled" or any equivalent phrase before "${bookName}" returns a booking_confirmed: result.`,
          );
        }
        systemPromptForTurn += lines.join("\n");
      }

      const toolDefs = buildToolDefs(agentTools);
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
        const freq = (agent.backchannelingFrequency ?? 0.3) as number;
        if (Math.random() < freq) {
          const customPhrases = agent.backchannelPhrases
            ? agent.backchannelPhrases.split(",").map(s => s.trim()).filter(Boolean)
            : [];
          const phrasePool = customPhrases.length > 0 ? customPhrases : BACKCHANNEL_PHRASES;
          const phrase = phrasePool[Math.floor(Math.random() * phrasePool.length)]!;
          queueSentence(phrase);
        }
      }
      tokenBuf = "";
      fullReply = "";
      inThinkBlock = false;
      thinkBuf = "";
      inFnTag = false;
      fnBuf = "";
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

      const llmStartMs = Date.now();
      logExecution("LLM", "request", {
        provider: agent.llmProvider,
        requestPayload: {
          model: (agent as any).llmModel ?? "default",
          systemPromptPreview: iterSystemPrompt.substring(0, 800),
          historyLength: history.length,
          tools: attachTools ? toolDefs.map((t: any) => t.function?.name ?? t.name).filter(Boolean) : [],
        },
        status: "info",
      });

      try {
       await llm.chat(
        history,
        iterSystemPrompt,
        (token) => {
          if (_tLlmFirstToken === null) { _tLlmFirstToken = performance.now(); _llmStreamActive = true; }
          fullReply += token;                         // keep raw (for cleaning later)
          const afterThink = filterThinkToken(token); // strip <think>…</think>
          if (!afterThink) return;                    // token was entirely inside a think block
          const filtered = filterFnToken(afterThink); // strip <function=…> inline tags from TTS
          if (!filtered) return;
          tokenBuf += filtered;
          send({ type: "token", text: filtered });
          const [sentences, rest] = extractSentences(tokenBuf);
          for (const s of sentences) queueSentence(s);
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
            tokenBuf = "";
            fullReply = "";
            inThinkBlock = false; thinkBuf = "";
            inFnTag = false; fnBuf = "";
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
                  tokenBuf += afterFn;
                  send({ type: "token", text: afterFn });
                  const [sentences, remainder] = extractSentences(tokenBuf);
                  for (const s of sentences) queueSentence(s);
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
          text: fullReply.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/<function[\s\S]*?>/g, "").trim().substring(0, 1500),
        },
        latencyMs: Date.now() - llmStartMs,
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
        const cleanForFlush = fullReply
          .replace(/<think>[\s\S]*?<\/think>/g, "")
          .replace(/<function=\w+[^>]*>[\s\S]*?<\/function>/g, "")
          .replace(/<function=\w+[^>]*\/>/g, "")
          .replace(/<function=\w+[^>]*>/g, "")
          .trim();
        const [, trueRemainder] = extractSentences(cleanForFlush);
        const flushText = trueRemainder.trim().length > tokenBuf.trim().length
          ? trueRemainder
          : tokenBuf;
        if (flushText.trim()) queueSentence(flushText);
      }

      // ── Tool call handling ─────────────────────────────────────────────────
      if (triggeredToolName) {
        // Push the assistant's tool-invocation turn to history
        const assistantToolContent = fullReply
          .replace(/<think>[\s\S]*?<\/think>/g, "")
          .replace(/<function=\w+[^>]*>[\s\S]*?<\/function>/g, "")
          .replace(/<function=\w+[^>]*\/>/g, "")
          .replace(/<function=\w+[^>]*>/g, "")
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
          try {
            const { audio } = await tts.synthesize(goodbye);
            if (!closed) {
              sendStatus("speaking");
              speaking = true;
              speakingStartedAt = Date.now();
              for (let j = 0; j < audio.length; j += AUDIO_CHUNK_BYTES) {
                if (closed || interrupted) break;
                sendSpeechAudio(audio.slice(j, j + AUDIO_CHUNK_BYTES));
                await new Promise<void>((r) => setTimeout(r, 40));
              }
              speaking = false;
              speakingEndedAt = Date.now();
            }
          } catch { /* ignore TTS errors on goodbye */ }
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
          status: "info",
        });
        try {
          const tool = matchToolByName(agentTools, triggeredToolName);
          if (!tool) {
            logger.warn({ callId, triggeredToolName }, "Webcall: LLM called unknown tool — ignoring");
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
          logExecution("Tool", "response", {
            requestPayload: { tool: triggeredToolName },
            responsePayload: { error: toolErr instanceof Error ? toolErr.message : String(toolErr) },
            latencyMs: Date.now() - toolStartMs,
            status: "error",
          });
          toolResult = "error: tool execution failed";
        }

        if (!toolHadError) {
          logExecution("Tool", "response", {
            requestPayload: { tool: triggeredToolName },
            responsePayload: { result: (toolResult ?? "unavailable").substring(0, 800) },
            latencyMs: Date.now() - toolStartMs,
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
      const cleanReply = fullReply
        .replace(/<think>[\s\S]*?<\/think>/g, "")
        .replace(/<function=\w+[^>]*>[\s\S]*?<\/function>/g, "")
        .replace(/<function=\w+[^>]*\/>/g, "")
        .replace(/<function=\w+[^>]*>/g, "")
        .trim();

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
              try {
                const { audio } = await tts.synthesize(goodbye);
                if (!closed) {
                  for (let j = 0; j < audio.length; j += AUDIO_CHUNK_BYTES) {
                    if (closed || interrupted) break;
                    sendSpeechAudio(audio.slice(j, j + AUDIO_CHUNK_BYTES));
                    await new Promise<void>((r) => setTimeout(r, 40));
                  }
                }
              } catch { /* ignore */ }
              if (!closed) void hangup("normal");
              processing = false;
              return;
            }

            let inlineFnResult: string | undefined;
            try {
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

      history.push({ role: "assistant", content: cleanReply });
      sendStatus("speaking");
      speaking = true;
      speakingStartedAt = Date.now();

      // Drop any audio that accumulated while the LLM was generating.
      // Without this, speech spoken during the "thinking" phase would be
      // replayed as a new user turn after the agent finishes speaking —
      // causing the agent to answer a question the user already forgot they asked.
      if (audioChunks.length > 0) {
        logger.info({ callId, droppedChunks: audioChunks.length }, "Dropping pre-TTS buffered audio (thinking phase)");
        audioChunks.splice(0);
      }
      bargeInFrames = 0;
      bargeInLowEnergyFrames = 0;

      // 3. Pipelined sentence playback — synthesis ran in parallel with LLM
      // streaming, so each job is likely already resolved by now.
      let transcriptSent = false;

      for (let i = 0; i < sentenceJobs.length; i++) {
        if (closed || interrupted) break;
        // Incremental delay: pause before each sentence (after the first) to give
        // the agent a more deliberate, natural pacing between sentences.
        if (i > 0 && incrementalDelayMs > 0 && !interrupted && !closed) {
          await new Promise<void>(r => setTimeout(r, incrementalDelayMs));
        }

        let pcmOut: Buffer;
        try {
          pcmOut = await sentenceJobs[i]!;
        } catch (ttsErr) {
          const reason = toReadableError(ttsErr, "TTS error");
          logger.error({ callId, err: ttsErr }, reason);
          send({ type: "error", message: reason });
          speaking = false;
          speakingEndedAt = Date.now();
          processing = false;
          if (!closed) void hangup("error", reason);
          return;
        }
        if (interrupted || closed) break;

        if (!transcriptSent) {
          send({ type: "transcript", speaker: "agent", text: cleanReply });
          transcriptSent = true;
        }
        // Signal which sentence is now playing so the UI can highlight it
        send({ type: "sentence_start", index: i, text: sentenceTexts[i] ?? "" });

        for (let j = 0; j < pcmOut.length; j += AUDIO_CHUNK_BYTES) {
          if (closed || interrupted) break;
          const chunk = pcmOut.slice(j, j + AUDIO_CHUNK_BYTES);
          recording.addAgentChunk(chunk);
          sendSpeechAudio(chunk);
          await new Promise<void>(r => setTimeout(r, 40));
        }
      }

      // Tail silence: send real PCM silence frames so the browser's AudioContext
      // queues them AFTER the last word. A passive wait alone doesn't help —
      // the client's Web Audio API schedules buffers independently and has
      // already reached the end of the queue while "today?" is mid-play.
      // Sending silence frames extends the scheduled timeline past the last
      // word, ensuring it plays to completion before the queue empties.
      if (!interrupted && !closed) {
        const silenceChunk = Buffer.alloc(AUDIO_CHUNK_BYTES, 0);
        const silenceFrames = Math.ceil(AUDIO_TAIL_SILENCE_MS / 40);
        for (let s = 0; s < silenceFrames && !interrupted && !closed; s++) {
          sendAudio(silenceChunk);
          await new Promise<void>(r => setTimeout(r, 40));
        }
      }

      speaking = false;
      speakingEndedAt = Date.now();

      if (interrupted) {
        // Barge-in: immediately process whatever the user said
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
              try {
                const { audio } = await tts.synthesize(goodbye);
                if (!closed) {
                  for (let j = 0; j < audio.length; j += AUDIO_CHUNK_BYTES) {
                    if (closed || interrupted) break;
                    sendSpeechAudio(audio.slice(j, j + AUDIO_CHUNK_BYTES));
                    await new Promise<void>((r) => setTimeout(r, 40));
                  }
                }
              } catch { /* ignore */ }
              if (!closed) void hangup("normal");
              processing = false;
              return;
            }

            // Route through the shared executor
            let inlineFnResult: string | undefined;
            try {
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
      // Start the silence-hangup countdown (webcall equivalent of pipeline's resetHangupTimer).
      resetHangupSilenceTimer();
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
          try {
            const { audio } = await tts.synthesize(agent.inactivityMessage);
            for (let j = 0; j < audio.length; j += AUDIO_CHUNK_BYTES) {
              if (closed) break;
              sendSpeechAudio(audio.slice(j, j + AUDIO_CHUNK_BYTES));
              await new Promise<void>((r) => setTimeout(r, 40));
            }
          } catch { /* ignore — still hang up */ }
        }
        if (!closed) void hangup("silence_timeout");
      })();
    }, agent.silenceTimeoutSeconds * 1000);
  }

  // ── Ready ─────────────────────────────────────────────────────────────────
  send({ type: "ready", agentId, agentName: agent.name, callId });
  logger.info({ callId, agentId, agentName: agent.name }, "WebCall session started");

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
        const triggerContent = callbackId
          ? "[callback connected — please open the conversation with your greeting now]"
          : isReturningCaller
            ? "[call connected — this is a returning caller you already know from the CALLER MEMORY block above; open by greeting them by name and referencing prior context, do NOT re-introduce yourself]"
            : "[call connected — please greet the user and open the conversation now]";
        const triggerHistory: import("../types.js").ConversationTurn[] = [
          { role: "user", content: triggerContent },
        ];
        await llm.chat(
          triggerHistory,
          greetSystemPrompt,
          (token) => { greetingText += token; },
          (full)  => { greetingText = full; },
        );
        greetingText = greetingText.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      }

      if (greetingText && !closed) {
        sendStatus("speaking");
        speaking = true;
        speakingStartedAt = Date.now();

        let greetAudio: Buffer;
        if (tts.synthesizeStream) {
          const chunks: Buffer[] = [];
          await tts.synthesizeStream(greetingText, (c) => chunks.push(c), () => {});
          greetAudio = withTailSilence(Buffer.concat(chunks));
        } else {
          const { audio } = await tts.synthesize(greetingText);
          greetAudio = withTailSilence(audio);
        }

        for (let j = 0; j < greetAudio.length; j += AUDIO_CHUNK_BYTES) {
          if (closed || interrupted) break;
          sendSpeechAudio(greetAudio.slice(j, j + AUDIO_CHUNK_BYTES));
          await new Promise<void>(r => setTimeout(r, 40));
        }

        speaking = false;
        speakingEndedAt = Date.now();
        history.push({ role: "assistant", content: greetingText });
        send({ type: "transcript", speaker: "agent", text: greetingText });

        if (!closed) {
          const drainFrames = Math.ceil(AUDIO_TAIL_SILENCE_MS / 40);
          for (let j = 0; j < drainFrames; j++) {
            if (closed) break;
            await new Promise<void>(r => setTimeout(r, 40));
          }
          sendStatus("listening");
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

  const maxTimer = setTimeout(() => { void hangup("timeout"); }, (agent.maxDuration ?? 600) * 1000);

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
    if (streamSTT) { try { streamSTT.close(); } catch { /* best-effort */ } streamSTT = null; }
    if (ambientInterval) { clearInterval(ambientInterval); ambientInterval = null; }
    clearTimeout(maxTimer);
    clearSilenceTimer();
    if (hangupSilenceTimer) { clearTimeout(hangupSilenceTimer); hangupSilenceTimer = null; }

    const endedAt         = new Date();
    const durationSeconds = Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000);
    logExecution("Agent", "system", {
      requestPayload: {
        event: "call.end",
        reason,
        durationSeconds,
        turns: history.filter(t => t.role === "assistant").length,
        ...(errorDetail ? { error: errorDetail instanceof Error ? errorDetail.message : String(errorDetail) } : {}),
      },
      status: reason === "error" ? "error" : "info",
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
      // Finalize recording — only when the "Record Calls" toggle is on
      const recordingEnabled = (agentCfg["recordingEnabled"] as boolean | undefined) ?? false;
      const recordingUrl = recordingEnabled
        ? await recording.finalize(callId).catch((err) => {
            logger.warn({ callId, err }, "WebCall recording upload failed");
            return null;
          })
        : null;

      await db.update(callsTable).set({
        status: isFailed ? "failed" : "completed",
        endedAt,
        durationSeconds,
        transcript: transcript || null,
        ...(errorMessage ? { errorMessage } : {}),
        ...(recordingUrl ? { recordingUrl } : {}),
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
      // Pricing: < 30 s → $0.02 flat; ≥ 30 s → ceil(seconds/60) × $0.03/min.
      const callUserId = agent.userId ?? null;
      if (callUserId && durationSeconds > 0) {
        const debitCents = Math.round(durationSeconds < 30
          ? 2                                           // $0.02 flat for short calls (integer)
          : Math.ceil(durationSeconds / 60) * 3);      // $0.03 per started minute
        const billableLabel = durationSeconds < 30
          ? "< 30 s flat"
          : `${Math.ceil(durationSeconds / 60)} min × $0.03`;

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
    const summarizationEnabled = (agentCfg["summarizationEnabled"] as boolean | undefined) ?? false;
    if (summarizationEnabled && transcript && transcript.length > 100) {
      void (async () => {
        try {
          const customPrompt = (agentCfg["summarizationPrompt"] as string | undefined) ?? "";
          const userContent = customPrompt
            ? `${customPrompt}\n\nTranscript:\n${transcript.slice(0, 6000)}`
            : `Summarize this call transcript in exactly 3 concise bullet points:\n\n${transcript.slice(0, 6000)}`;
          let summary = "";
          await llm.chat(
            [{ role: "user", content: userContent }],
            "You are a call analyst. Summarize the call concisely and factually. Start each bullet with '•'.",
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
        phoneNumber: webcallIdentifier,
        history,
        llm,
        existing: webcallProfile,
        callId,
        wasDropped: false,
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
      try { const m = JSON.parse(data) as { type: string }; if (m.type === "end") void hangup("normal"); }
      catch { /* ignore */ }
      return;
    }

    // Record caller audio only when the agent is NOT speaking.
    // When the agent is speaking, the agent-chunk loop already pads the caller
    // track with silence (same length as each TTS chunk), so both tracks stay
    // perfectly aligned without this call. Adding caller frames here *during*
    // agent speech would interleave silence blocks into the agent track every
    // time a mic frame arrives — causing the "on and off" dropouts heard in
    // call recordings.
    if (!speaking) recording.addCallerChunk(data as Buffer);

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
      const inStartGrace = Date.now() - speakingStartedAt < BARGE_IN_ECHO_GRACE_MS;
      if (!inStartGrace && rms > BARGE_IN_RMS) {
        bargeInFrames++;
        bargeInLowEnergyFrames = 0; // high-energy frame — reset the dip counter
        const bargeFrame = Buffer.from(data);
        audioChunks.push(bargeFrame); // accumulate speech for batch STT fallback
        streamSTT?.sendAudio(bargeFrame); // also feed streaming STT so it has the full utterance
        if (!interrupted && bargeInFrames >= effectiveBargeInMinFrames) {
          interrupted = true;
          send({ type: "interrupted" }); // tell client to stop playing
          sendStatus("thinking");
          logger.info({ callId, rms, bargeInFrames, effectiveBargeInMinFrames }, "Barge-in triggered");
        }
      } else if (!inStartGrace) {
        // Low-energy frame while outside start grace.
        // Don't reset bargeInFrames immediately — natural speech has brief inter-syllable
        // dips. Only reset after BARGE_IN_LOW_RESET consecutive low frames (~200ms silence).
        bargeInLowEnergyFrames++;
        if (bargeInLowEnergyFrames >= BARGE_IN_LOW_RESET) {
          bargeInFrames = 0;
          bargeInLowEnergyFrames = 0;
        }
      }
      // Note: frames inside start grace are completely ignored (no counter changes)
      return; // don't touch silence timer while speaking
    }
    bargeInFrames = 0;           // agent not speaking — reset
    bargeInLowEnergyFrames = 0;

    // End grace: suppress new-turn detection for BARGE_IN_END_GRACE_MS after the last
    // TTS chunk was sent. This prevents the trailing echo of the agent's final word
    // (still playing in the browser speaker) from being picked up by the mic and
    // immediately firing a new user turn before the caller has a chance to speak.
    const inEndGrace = lastChunkSentAt > 0 && Date.now() - lastChunkSentAt < BARGE_IN_END_GRACE_MS;
    if (inEndGrace) return;

    // Streaming STT path: send all audio directly to the provider WebSocket —
    // no local VAD accumulation needed (provider handles endpointing server-side).
    if (streamSTT) {
      streamSTT.sendAudio(Buffer.from(data));
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

  ws.on("close", async () => { if (!closed) await hangup("disconnected"); });
  ws.on("error", async (err: unknown) => {
    logger.error({ callId, err }, "WebCall WS error");
    if (!closed) await hangup("error", err);
  });
}
