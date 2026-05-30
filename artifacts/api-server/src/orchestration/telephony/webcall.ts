import type { WebSocket } from "ws";
import { db, agentsTable, callsTable, providersTable, usersTable, walletTransactionsTable, platformSettingsTable } from "@workspace/db";
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
import { loadCallerProfile, injectCallerMemory, updateCallerProfile } from "../callerMemory.js";

// ── Per-user concurrent call rate limit ──────────────────────────────────────
const activeCalls = new Map<string, number>();
const MAX_CONCURRENT_CALLS = 5;

// ── Tuning constants ─────────────────────────────────────────────────────────
const VAD_SILENCE_MS           = 700;   // raised from 300ms — prevents splitting mid-sentence pauses into separate turns
const SPEECH_RMS_THRESHOLD     = 400;   // normal VAD — user speaking (agent silent)
const BARGE_IN_RMS             = 2000;  // much higher bar while agent is speaking to avoid false barge-ins from
                                        // ambient noise, TV, nearby conversation, or mic echo bleed
const BARGE_IN_MIN_FRAMES      = 4;     // require ~160ms of sustained speech before interrupting
                                        // (4 × 40ms chunks) — prevents a single word/noise from cutting the agent
const BARGE_IN_ECHO_GRACE_MS   = 1000; // suppress barge-in for this long after each TTS turn begins —
                                        // browser echo cancellation needs ~500–800 ms to adapt; without this the
                                        // mic echo of the agent's own voice triggers false barge-ins that cut off
                                        // the last word(s) of every response
const AUDIO_TAIL_SILENCE_MS    = 250;  // extra wait after the last chunk so the client's audio buffer drains
                                        // before the server signals "listening" (prevents last-word cutoff)
const MIN_PCM_BYTES            = 6400; // ~200ms at 16kHz Int16
const AUDIO_CHUNK_BYTES        = 1280; // 40ms per WS frame
const HANDOFF_SILENCE_MS       = 3000; // sustained silence that may indicate a phone handoff
const TTS_VOLUME_GAIN          = 2.5;  // PCM amplitude multiplier for outbound TTS audio —
                                        // most TTS providers output at ~40% of full scale; this brings
                                        // the perceived loudness up to a comfortable level

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
  agentId: number
): Promise<void> {
  function send(data: Record<string, unknown>) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(data));
  }
  function sendStatus(status: Status) { send({ type: "status", status }); }
  function sendAudio(pcm: Buffer) { if (ws.readyState === ws.OPEN) ws.send(pcm); }

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
    google:   "managed_gemini_key",
    deepgram: "managed_deepgram_key",
    sarvam:   "managed_sarvam_key",
    cartesia:  "managed_cartesia_key",
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

  // ── State ─────────────────────────────────────────────────────────────────
  const audioChunks: Buffer[] = [];
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let processing  = false;
  let speaking        = false; // true while audio frames are being sent to client
  let speakingStartedAt = 0;  // timestamp (ms) when speaking last transitioned to true
  let speakingEndedAt = 0;    // timestamp (ms) when speaking last transitioned to false
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

      // 2. LLM — stream tokens, queue TTS per sentence
      const sentenceJobs: Promise<Buffer>[] = [];
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
        // synthesize() now returns { audio, characters }; extract just the audio for playback.
        const job = tts.synthesize(t).then(({ audio }) => audio);
        // Attach a no-op catch immediately so Node.js doesn't fire
        // unhandledRejection before the for-loop below awaits the job.
        // The rejection still propagates when we await in the loop.
        job.catch(() => {});
        sentenceJobs.push(job);
      }

      try {
       await llm.chat(
        history,
        systemPrompt,
        (token) => {
          fullReply += token;                        // keep raw (for cleaning later)
          const filtered = filterThinkToken(token);  // strip <think>…</think>
          if (!filtered) return;                     // token was entirely inside a think block
          tokenBuf += filtered;
          const [sentences, rest] = extractSentences(tokenBuf);
          for (const s of sentences) queueSentence(s);
          tokenBuf = rest;
        },
        (full) => { fullReply = full; }
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

      if (tokenBuf.trim()) queueSentence(tokenBuf);

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

      // 3. Pipelined sentence playback — barge-in checks at every frame
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
          recording.addAgentChunk(chunk);  // record pre-amplification for natural levels
          sendAudio(amplifyPcm(chunk, TTS_VOLUME_GAIN));
          await new Promise(r => setTimeout(r, 40));
        }
      }

      // Tail silence: give the client's audio buffer time to drain before
      // transitioning. Without this, the server sends "status: listening" while
      // the last few chunks are still in the browser's audio queue, and any
      // subsequent state change can cause the browser to drop the end of the
      // last word.
      if (!interrupted && !closed) {
        await new Promise(r => setTimeout(r, AUDIO_TAIL_SILENCE_MS));
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
  sendStatus("listening");
  logger.info({ callId, agentId, agentName: agent.name }, "WebCall session started");

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

    // ── Post-call webcall memory update (fire-and-forget) ────────────────────
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

    // Record every frame from the caller's microphone (captures full timeline
    // including silence, maintaining alignment with the agent track)
    recording.addCallerChunk(data as Buffer);

    const rms = rmsEnergy(data);

    if (speaking) {
      // Agent is speaking — use elevated threshold to ignore echo / ambient noise.
      // Require BARGE_IN_MIN_FRAMES consecutive loud frames before accepting a barge-in,
      // so a single word, cough, or background voice doesn't stop the agent mid-sentence.
      //
      // Echo grace period: suppress barge-in for BARGE_IN_ECHO_GRACE_MS after speaking
      // begins. Browser echo cancellation needs ~500–800 ms to adapt; without this the
      // mic picks up the agent's own TTS audio and fires a false barge-in, cutting off
      // the last word(s) of every response.
      const inEchoGrace = Date.now() - speakingStartedAt < BARGE_IN_ECHO_GRACE_MS;
      if (!inEchoGrace && rms > BARGE_IN_RMS) {
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
