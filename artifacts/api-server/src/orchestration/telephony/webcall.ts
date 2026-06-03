import type { WebSocket } from "ws";
import { db, agentsTable, callsTable, scheduledCallbacksTable, providersTable, usersTable, walletTransactionsTable, platformSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createSTTAdapter } from "../adapters/stt/index.js";
import { createLLMAdapter } from "../adapters/llm/index.js";
import { createTTSAdapter } from "../adapters/tts/index.js";
import { downsample16to8 } from "../audio.js";
import { toReadableError } from "../utils.js";
import { logger } from "../../lib/logger.js";
import { RecordingBuffer } from "../recorder.js";
import type { ConversationTurn, STTConfig } from "../types.js";
import { decryptKey } from "../../lib/crypto.js";
import { loadCallerProfile, injectCallerMemory, updateCallerProfile, detectCallbackRequest } from "../callerMemory.js";
import { GenderDetector } from "../genderDetector.js";
import { buildDatetimeInjection } from "../datetimeInject.js";
import {
  buildToolDefs,
  executeNativeBooking,
  executeNativeCheckAvailability,
  executeNativeReschedule,
  executeNativeCancel,
  executeWebhookTool,
} from "../../services/tool-executor.js";

// ── Per-user concurrent call rate limit ──────────────────────────────────────
const activeCalls = new Map<string, number>();
const MAX_CONCURRENT_CALLS = 5;

// ── Tuning constants ─────────────────────────────────────────────────────────
const VAD_SILENCE_MS           = 450;   // silence window before sending audio to STT (ms)
const SPEECH_RMS_THRESHOLD     = 400;   // normal VAD — user speaking (agent silent)
const BARGE_IN_RMS             = 2000;  // much higher bar while agent is speaking to avoid false barge-ins from
                                        // ambient noise, TV, nearby conversation, or mic echo bleed
const BARGE_IN_MIN_FRAMES      = 4;     // require ~160ms of sustained speech before interrupting
                                        // (4 × 40ms chunks) — prevents a single word/noise from cutting the agent
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
): Promise<void> {
  function send(data: Record<string, unknown>) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(data));
  }
  function sendStatus(status: Status) { send({ type: "status", status }); }
  function sendAudio(pcm: Buffer) { if (ws.readyState === ws.OPEN) { ws.send(pcm); lastChunkSentAt = Date.now(); } }

  // ── Load agent + provider keys ────────────────────────────────────────────
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
  if (!agent) { send({ type: "error", message: "Agent not found" }); ws.close(); return; }

  // Balance gate — reject before any call setup if wallet is empty
  if (agent.userId) {
    const [user] = await db.select({ walletBalanceCents: usersTable.walletBalanceCents })
      .from(usersTable).where(eq(usersTable.clerkId, agent.userId));
    if (user && user.walletBalanceCents <= 0) {
      send({ type: "error", message: "Insufficient balance. Please top up your wallet to start calls." });
      ws.close();
      return;
    }
  }

  // ── Rate limit: max concurrent calls per user ─────────────────────────────
  const rateLimitKey = agent.userId ?? `agent-${agentId}`;
  const current = activeCalls.get(rateLimitKey) ?? 0;
  if (current >= MAX_CONCURRENT_CALLS) {
    send({ type: "error", message: `Too many concurrent calls (max ${MAX_CONCURRENT_CALLS}). Please wait for an active call to finish.` });
    ws.close();
    return;
  }
  activeCalls.set(rateLimitKey, current + 1);
  ws.once("close", () => {
    const n = activeCalls.get(rateLimitKey) ?? 1;
    if (n <= 1) activeCalls.delete(rateLimitKey);
    else activeCalls.set(rateLimitKey, n - 1);
  });

  const providerRows = await db.select().from(providersTable).where(eq(providersTable.isActive, true));
  const providerKeys = new Map<string, string>();
  for (const row of providerRows) providerKeys.set(row.providerName.toLowerCase(), decryptKey(row.apiKey));

  // Managed platform key fallback — same map as session.ts
  const MANAGED: Record<string, string> = {
    qwen:     "managed_qwen_key",
    google:   "managed_qwen_key",
    gemini:   "managed_qwen_key",
    deepgram: "managed_deepgram_key",
    sarvam:   "managed_sarvam_key",
    cartesia: "managed_cartesia_key",
    openai:   "managed_openai_key",
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
  }

  const sttKey = providerKeys.get(agent.asrProvider);
  const llmKey = providerKeys.get(agent.llmProvider);
  const ttsKey = providerKeys.get(agent.ttsProvider);

  if (!sttKey || !llmKey || !ttsKey) {
    send({ type: "error", message: `Missing API keys for: ${[!sttKey && agent.asrProvider, !llmKey && agent.llmProvider, !ttsKey && agent.ttsProvider].filter(Boolean).join(", ")}` });
    ws.close();
    return;
  }

  const sttConfig: STTConfig = {
    language: agent.asrLanguage ?? null,
    backgroundDenoising: agent.asrBackgroundDenoising ?? false,
    confidenceThreshold: agent.asrConfidenceThreshold ?? 0.40,
    endOfTurnConfidence: agent.asrEndOfTurnConfidence ?? 0.70,
    endOfTurnTimeout: agent.asrEndOfTurnTimeout ?? 5000,
    keyterms: agent.asrKeyterms
      ? agent.asrKeyterms.split(",").map((s) => s.trim()).filter(Boolean)
      : [],
    smartEndpointing: agent.asrSmartEndpointing ?? "off",
    autoFallback: agent.asrAutoFallback ?? false,
  };

  const stt = createSTTAdapter(agent.asrProvider, sttKey, agent.asrModel, null, sttConfig);
  const llm = createLLMAdapter(agent.llmProvider, llmKey, agent.llmModel);
  const agentLanguage = agent.language ?? null;
  const ttsExtraConfig = agent.ttsProvider === "sarvam"
    ? JSON.stringify({ language: agentLanguage ?? "en-IN" })
    : null;
  const tts = createTTSAdapter(agent.ttsProvider, ttsKey, agent.ttsVoice, agent.ttsModel, ttsExtraConfig, agentLanguage);

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

  // ── Webcall caller memory ─────────────────────────────────────────────────
  // Use "webcall:<userId>" as a stable identifier since there's no phone number.
  // This gives logged-in users the same cross-call memory that telephony callers get.
  const webcallIdentifier = agent.userId ? `webcall:${agent.userId}` : null;
  let webcallProfile: import("../callerMemory.js").CallerProfile | null = null;
  let systemPrompt = agent.generatedPrompt ?? agent.systemPrompt ?? "";

  if (webcallIdentifier) {
    try {
      webcallProfile = await loadCallerProfile(agentId, webcallIdentifier);
      if (webcallProfile) {
        systemPrompt = injectCallerMemory(systemPrompt, webcallProfile);
        logger.info({ callId, agentId, callCount: webcallProfile.callCount }, "Webcall caller memory injected");
      }
    } catch (memErr) {
      logger.warn({ callId, agentId, memErr }, "Failed to load webcall caller profile — continuing without memory");
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

  // ── Gender detection ──────────────────────────────────────────────────────
  const agentCfg = (agent.agentConfig ?? {}) as Record<string, unknown>;
  const genderEnabled = (agentCfg["genderDetectionEnabled"] as boolean | undefined) ?? true;
  const maleSal     = (agentCfg["genderDetectionMaleSalutation"]    as string | undefined) ?? "Sir";
  const femaleSal   = (agentCfg["genderDetectionFemaleSalutation"]  as string | undefined) ?? "Ma'am";
  const neutralSal  = (agentCfg["genderDetectionNeutralSalutation"] as string | undefined) ?? "";
  const genderDetector = genderEnabled ? new GenderDetector(callId, logger) : null;

  // ── State ─────────────────────────────────────────────────────────────────
  const audioChunks: Buffer[] = [];
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let processing  = false;
  let speaking        = false; // true while audio frames are being sent to client
  let speakingStartedAt = 0;  // timestamp (ms) when speaking last transitioned to true
  let speakingEndedAt = 0;    // timestamp (ms) when speaking last transitioned to false
  let lastChunkSentAt = 0;    // timestamp (ms) of the most recent TTS audio chunk sent to client
  let interrupted = false;        // barge-in flag; checked inside audio loop
  let bargeInFrames = 0;         // consecutive high-RMS frames counted while agent is speaking

  // ── Recording ─────────────────────────────────────────────────────────────
  // Stereo WAV: L=caller (16 kHz from browser), R=agent (TTS pre-amplification)
  const recording = new RecordingBuffer(16000);

  // ── Pipeline ─────────────────────────────────────────────────────────────
  async function process() {
    if (processing || audioChunks.length === 0) return;
    const pcm = Buffer.concat(audioChunks.splice(0));
    if (pcm.length < MIN_PCM_BYTES) return;

    processing  = true;
    interrupted = false;
    sendStatus("thinking");

    try {
      // 1. STT
      let userText: string | null | undefined;
      try {
        userText = await stt.transcribe(pcm, 16000);
      } catch (sttErr) {
        const reason = toReadableError(sttErr, "STT error");
        logger.error({ callId, err: sttErr }, reason);
        send({ type: "error", message: reason });
        speaking = false;
        speakingEndedAt = Date.now();
        processing = false;
        if (!closed) void hangup("error", reason);
        return;
      }
      if (!userText?.trim()) { processing = false; return; }

      send({ type: "transcript", speaker: "user", text: userText });
      history.push({ role: "user", content: userText });

      // 2. LLM — stream tokens, kick off TTS synthesis per sentence in parallel
      // Each job starts as soon as its sentence is extracted, so synthesis
      // overlaps with LLM streaming. By the time LLM finishes, sentence 1
      // audio is usually already fully collected — minimising first-audio delay.
      let sentenceJobs: Promise<Buffer>[] = [];
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
      // ──────────────────────────────────────────────────────────────────────

      function queueSentence(text: string) {
        const t = text.trim();
        if (!t) return;
        // Kick off synthesis immediately so it runs in parallel with LLM streaming.
        // If synthesizeStream is available, use it to collect the full audio via
        // HTTP streaming (potentially faster than waiting for the full response).
        // Either way, the job resolves to a complete Buffer — played from memory
        // with no per-chunk network jitter.
        let job: Promise<Buffer>;
        if (tts.synthesizeStream) {
          job = (async () => {
            const chunks: Buffer[] = [];
            await tts.synthesizeStream!(t, (c) => chunks.push(c), () => {});
            const audio = Buffer.concat(chunks);
            logger.info({ callId, sentenceText: t, audioBytes: audio.length }, "TTS sentence synthesized");
            return withTailSilence(audio);
          })();
        } else {
          job = tts.synthesize(t).then(({ audio }) => {
            logger.info({ callId, sentenceText: t, audioBytes: audio.length }, "TTS sentence synthesized");
            return withTailSilence(audio);
          });
        }
        // Attach a no-op catch immediately so Node.js doesn't fire
        // unhandledRejection before the for-loop below awaits the job.
        job.catch(() => {});
        sentenceJobs.push(job);
      }

      // Build per-turn system prompt with datetime + gender salutation injected
      let systemPromptForTurn = systemPrompt;
      const agentTimezone = (agentCfg["timezone"] as string | undefined) || "Asia/Kolkata";
      const dtInjection = buildDatetimeInjection(agentTimezone);
      systemPromptForTurn = `${dtInjection}\n\n${systemPromptForTurn}`;
      const detectedGender = genderDetector?.gender ?? null;
      if (detectedGender === "male") {
        systemPromptForTurn += `\n\n[CALLER GENDER] The caller has been identified as male. Always address them respectfully as "${maleSal}" when appropriate (e.g. "Yes, ${maleSal}", "Of course, ${maleSal}"). Never use "${femaleSal}".`;
      } else if (detectedGender === "female") {
        systemPromptForTurn += `\n\n[CALLER GENDER] The caller has been identified as female. Always address them respectfully as "${femaleSal}" when appropriate (e.g. "Yes, ${femaleSal}", "Of course, ${femaleSal}"). Never use "${maleSal}".`;
      } else if (neutralSal) {
        systemPromptForTurn += `\n\n[CALLER GENDER] Gender could not be determined. Use "${neutralSal}" as a neutral salutation when appropriate.`;
      }

      // Callback scheduling capability hint — always injected for webcalls
      systemPromptForTurn += `\n\n[CALLBACK SCHEDULING] If the user asks you to call them back after a delay (e.g. "call me back in 10 minutes", "remind me in an hour"), you MUST agree and confirm the request. Say something like "Sure, I'll call you back in X minutes." Do NOT say you are unable to schedule callbacks or make outbound calls — the platform will automatically schedule and deliver the callback. Simply confirm the time and end the conversation naturally.`;

      // ── Build tool definitions for this agent ─────────────────────────────
      const agentTools = (agent.tools ?? []) as unknown as import("../types.js").AgentTool[];
      const toolDefs = buildToolDefs(agentTools);
      let triggeredToolName: string | null = null;
      let triggeredToolArgs: Record<string, unknown> = {};

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
      tokenBuf = "";
      fullReply = "";
      inThinkBlock = false;
      thinkBuf = "";
      triggeredToolName = null;
      triggeredToolArgs = {};

      try {
       await llm.chat(
        history,
        systemPromptForTurn,
        (token) => {
          fullReply += token;                        // keep raw (for cleaning later)
          const filtered = filterThinkToken(token);  // strip <think>…</think>
          if (!filtered) return;                     // token was entirely inside a think block
          tokenBuf += filtered;
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
            }
          : undefined,
      );
      } catch (llmErr) {
        const reason = toReadableError(llmErr, "LLM error");
        logger.error({ callId, err: llmErr }, reason);
        send({ type: "error", message: reason });
        speaking = false;
        speakingEndedAt = Date.now();
        processing = false;
        if (!closed) void hangup("error", reason);
        return;
      }

      // The LLM token stream occasionally ends a few words early while fullReply
      // (set by the onComplete callback) has the complete text.  Re-run
      // extractSentences on the full clean reply to get the definitive last
      // segment, and use it instead of the potentially-truncated tokenBuf.
      {
        const cleanForFlush = fullReply.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
        const [, trueRemainder] = extractSentences(cleanForFlush);
        const flushText = trueRemainder.trim().length > tokenBuf.trim().length
          ? trueRemainder
          : tokenBuf;
        if (flushText.trim()) queueSentence(flushText);
      }

      // ── Tool call handling ─────────────────────────────────────────────────
      if (triggeredToolName) {
        // Push the assistant's tool-invocation turn to history
        const assistantToolContent = fullReply.replace(/<think>[\s\S]*?<\/think>/g, "").trim()
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
        if (triggeredToolName === "end_call") {
          const endTool = agentTools.find((t) => t.type === "end_call" && t.name === triggeredToolName);
          const goodbye = endTool && endTool.type === "end_call" ? (endTool.goodbyeMessage ?? "") : "";
          if (goodbye.trim()) {
            try {
              const { audio } = await tts.synthesize(goodbye);
              if (!closed) {
                sendStatus("speaking");
                speaking = true;
                speakingStartedAt = Date.now();
                for (let j = 0; j < audio.length; j += AUDIO_CHUNK_BYTES) {
                  if (closed || interrupted) break;
                  sendAudio(amplifyPcm(audio.slice(j, j + AUDIO_CHUNK_BYTES), TTS_VOLUME_GAIN));
                  await new Promise<void>((r) => setTimeout(r, 40));
                }
                speaking = false;
                speakingEndedAt = Date.now();
              }
            } catch { /* ignore TTS errors on goodbye */ }
          }
          if (!closed) void hangup("normal");
          processing = false;
          return;
        }

        // Execute the tool via the shared executor
        let toolResult: string | undefined;
        try {
          const tool = agentTools.find((t) => t.name === triggeredToolName);
          if (!tool) {
            logger.warn({ callId, triggeredToolName }, "Webcall: LLM called unknown tool — ignoring");
          } else if (tool.type === "native_booking") {
            toolResult = await executeNativeBooking(callId, agentId, tool, triggeredToolArgs);
          } else if (tool.type === "native_check_availability") {
            toolResult = await executeNativeCheckAvailability(callId, agentId, tool, triggeredToolArgs);
          } else if (tool.type === "native_reschedule") {
            toolResult = await executeNativeReschedule(callId, agentId, tool, triggeredToolArgs);
          } else if (tool.type === "native_cancel") {
            toolResult = await executeNativeCancel(callId, agentId, tool, triggeredToolArgs);
          } else if (tool.type === "webhook") {
            toolResult = await executeWebhookTool(callId, tool, triggeredToolArgs);
          } else {
            logger.warn({ callId, toolType: tool.type }, "Webcall: unhandled tool type — ignoring");
          }
        } catch (toolErr) {
          logger.error({ callId, err: toolErr, triggeredToolName }, "Webcall: tool execution error");
          toolResult = "error: tool execution failed";
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

      // Clean the stored reply — strip think blocks from transcript + history
      const cleanReply = fullReply.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

      if (!cleanReply || sentenceJobs.length === 0) {
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

      // 3. Pipelined sentence playback — synthesis ran in parallel with LLM
      // streaming, so each job is likely already resolved by now.
      let transcriptSent = false;

      for (let i = 0; i < sentenceJobs.length; i++) {
        if (closed || interrupted) break;

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

        for (let j = 0; j < pcmOut.length; j += AUDIO_CHUNK_BYTES) {
          if (closed || interrupted) break;
          const chunk = pcmOut.slice(j, j + AUDIO_CHUNK_BYTES);
          recording.addAgentChunk(chunk);
          sendAudio(amplifyPcm(chunk, TTS_VOLUME_GAIN));
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
        sendStatus("listening");
      }

      // No tool was called this turn — the agent's spoken response is done.
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
    }
  }

  function scheduleSilenceFlush() {
    if (silenceTimer || processing) return;
    silenceTimer = setTimeout(() => { silenceTimer = null; void process(); }, VAD_SILENCE_MS);
  }

  function clearSilenceTimer() {
    if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
  }

  // ── Ready ─────────────────────────────────────────────────────────────────
  send({ type: "ready", agentId, agentName: agent.name, callId });
  logger.info({ callId, agentId, agentName: agent.name }, "WebCall session started");

  // ── Callback opening greeting ─────────────────────────────────────────────
  // For callback calls the agent speaks FIRST. We ask the LLM to generate the
  // opening so it is (a) in the agent's configured language and (b) contextually
  // dynamic based on the prior-call summary injected into systemPrompt above.
  if (callbackId && !closed) {
    try {
      sendStatus("thinking");

      // Build the same per-turn system prompt that process() uses
      const agentTimezone = (agentCfg["timezone"] as string | undefined) || "Asia/Kolkata";
      const greetSystemPrompt = `${buildDatetimeInjection(agentTimezone)}\n\n${systemPrompt}`;

      // Synthetic trigger: tells the LLM to open the conversation now.
      // We do NOT add this to history so the real dialogue starts clean
      // with just the assistant's greeting turn.
      const triggerHistory: import("../types.js").ConversationTurn[] = [
        { role: "user", content: "[callback connected — please open the conversation with your greeting now]" },
      ];

      let greetingText = "";
      await llm.chat(
        triggerHistory,
        greetSystemPrompt,
        (token) => { greetingText += token; },
        (full) => { greetingText = full; },
      );

      // Strip any <think>…</think> blocks
      greetingText = greetingText.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

      if (greetingText && !closed) {
        sendStatus("speaking");
        speaking = true;
        speakingStartedAt = Date.now();

        // Use streaming TTS if available, otherwise one-shot
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
          sendAudio(amplifyPcm(greetAudio.slice(j, j + AUDIO_CHUNK_BYTES), TTS_VOLUME_GAIN));
          await new Promise<void>(r => setTimeout(r, 40));
        }

        speaking = false;
        speakingEndedAt = Date.now();
        // Only push the assistant turn — the synthetic trigger stays out of history
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
      logger.warn({ callId, greetErr }, "Callback opening greeting failed — continuing normally");
      speaking = false;
      speakingEndedAt = Date.now();
      if (!closed) sendStatus("listening");
    }
  } else {
    sendStatus("listening");
  }

  const maxTimer = setTimeout(() => { void hangup("timeout"); }, (agent.maxDuration ?? 600) * 1000);

  // ── Hangup ────────────────────────────────────────────────────────────────
  async function hangup(reason = "normal", errorDetail?: unknown) {
    if (closed) return;
    closed = true;
    clearTimeout(maxTimer);
    clearSilenceTimer();


    const endedAt         = new Date();
    const durationSeconds = Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000);
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
      // Finalize recording — upload to GCS then save the serving URL
      const recordingUrl = await recording.finalize(callId).catch((err) => {
        logger.warn({ callId, err }, "WebCall recording upload failed");
        return null;
      });

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
      }

      // Deduct platform fee from wallet.
      // Pricing: < 30 s → $0.015 (half rate); ≥ 30 s → ceil(seconds/60) × $0.03/min.
      const callUserId = agent.userId ?? null;
      if (callUserId && durationSeconds > 0) {
        const debitCents = Math.round(durationSeconds < 30
          ? 2                                           // $0.02 flat for short calls (integer)
          : Math.ceil(durationSeconds / 60) * 3);      // $0.03 per started minute
        const billableLabel = durationSeconds < 30
          ? "< 30 s flat"
          : `${Math.ceil(durationSeconds / 60)} min × $0.03`;
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
    logger.info({ callId, durationSeconds }, "WebCall ended");
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

    // Feed all frames to gender detector (browser sends 16 kHz → downsample to 8 kHz)
    if (genderDetector) genderDetector.addSpeechChunk(downsample16to8(data as Buffer));

    const rms = rmsEnergy(data);

    if (speaking) {
      // Agent is speaking — use elevated threshold to ignore echo / ambient noise.
      // Require BARGE_IN_MIN_FRAMES consecutive loud frames before accepting a barge-in,
      // so a single word, cough, or background voice doesn't stop the agent mid-sentence.
      //
      // Echo grace periods — suppress barge-in when:
      //   a) speaking just started (browser AEC needs 500–800 ms to adapt), OR
      //   b) within 600 ms of the last TTS chunk sent (trailing echo of the final word).
      // Without (b), the mic picks up the echo of the last word and fires a false
      // barge-in that cuts it off before the caller hears it.
      const inStartGrace = Date.now() - speakingStartedAt < BARGE_IN_ECHO_GRACE_MS;
      const inEndGrace   = lastChunkSentAt > 0 && Date.now() - lastChunkSentAt < BARGE_IN_END_GRACE_MS;
      if (!inStartGrace && !inEndGrace && rms > BARGE_IN_RMS) {
        bargeInFrames++;
        audioChunks.push(Buffer.from(data)); // accumulate speech for next turn
        if (!interrupted && bargeInFrames >= BARGE_IN_MIN_FRAMES) {
          interrupted = true;
          send({ type: "interrupted" }); // tell client to stop playing
          sendStatus("thinking");
          logger.info({ callId, rms, bargeInFrames }, "Barge-in triggered");
        }
      } else {
        bargeInFrames = 0; // frame dropped below threshold (or in grace period) — reset the run
      }
      return; // don't touch silence timer while speaking
    }
    bargeInFrames = 0; // agent not speaking — reset

    // Normal VAD (agent silent)
    if (rms > SPEECH_RMS_THRESHOLD) {
      const chunk = Buffer.from(data);
      audioChunks.push(chunk);
      clearSilenceTimer();
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
