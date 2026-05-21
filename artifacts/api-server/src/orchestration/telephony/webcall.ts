import type { WebSocket } from "ws";
import { db, agentsTable, callsTable, providersTable, usersTable, walletTransactionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createSTTAdapter } from "../adapters/stt/index.js";
import { createLLMAdapter } from "../adapters/llm/index.js";
import { createTTSAdapter } from "../adapters/tts/index.js";
import { downsample16to8 } from "../audio.js";
import { detectCallerGender, applyCallerSalutation, buildGenderInstruction } from "../genderDetection.js";
import { logger } from "../../lib/logger.js";
import { RecordingBuffer } from "../recorder.js";
import type { ConversationTurn, STTConfig } from "../types.js";

// ── Tuning constants ─────────────────────────────────────────────────────────
const VAD_SILENCE_MS        = 300;
const SPEECH_RMS_THRESHOLD  = 400;    // normal VAD — user speaking (agent silent)
const BARGE_IN_RMS          = 2000;   // much higher bar while agent is speaking to avoid false barge-ins from
                                       // ambient noise, TV, nearby conversation, or mic echo bleed
const BARGE_IN_MIN_FRAMES   = 4;      // require ~160ms of sustained speech before interrupting
                                       // (4 × 40ms chunks) — prevents a single word/noise from cutting the agent
const MIN_PCM_BYTES         = 6400;   // ~200ms at 16kHz Int16
const AUDIO_CHUNK_BYTES     = 1280;   // 40ms per WS frame
const HANDOFF_SILENCE_MS    = 3000;   // sustained silence that may indicate a phone handoff
const TTS_VOLUME_GAIN       = 2.5;    // PCM amplitude multiplier for outbound TTS audio —
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

  const providerRows = await db.select().from(providersTable).where(eq(providersTable.isActive, true));
  const providerKeys = new Map<string, string>();
  for (const row of providerRows) providerKeys.set(row.providerName.toLowerCase(), row.apiKey);

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
  const tts = createTTSAdapter(agent.ttsProvider, ttsKey, agent.ttsVoice, agent.ttsModel);

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

  // ── Gender detection state ────────────────────────────────────────────────
  // Extract config from agent.agentConfig JSONB (same defaults as session.ts)
  const agentCfg = (agent.agentConfig as Record<string, unknown> | null) ?? {};
  const genderEnabled       = (agentCfg["genderDetectionEnabled"]          as boolean | undefined) ?? false;
  const genderProvider      = (agentCfg["genderDetectionProvider"]         as string  | undefined) ?? "internal";
  const maleSalutation      = (agentCfg["genderDetectionMaleSalutation"]   as string  | undefined) ?? "sir";
  const femaleSalutation    = (agentCfg["genderDetectionFemaleSalutation"] as string  | undefined) ?? "ma'am";
  const neutralSalutation   = (agentCfg["genderDetectionNeutralSalutation"] as string | undefined) ?? "";

  // We keep a mutable copy of the system prompt so gender detection can patch it in-place.
  // The original is preserved separately so we can restore it if a handoff is detected.
  const originalSystemPrompt = agent.systemPrompt ?? "";
  let systemPrompt          = originalSystemPrompt;
  let genderDetected        = false;
  let genderDetectPromise: Promise<void> | null = null;  // in-flight detection
  const genderAccum16k: Buffer[] = [];   // raw 16kHz from browser
  let genderAccumBytes      = 0;
  const GENDER_MIN_BYTES_16K = 32000;    // ~1 s @ 16kHz 16-bit

  /**
   * Reset gender detection so the next chunk of caller audio re-runs the detector.
   * Restores the original system prompt template so the placeholder can be re-patched.
   */
  function resetGenderDetection(): void {
    genderDetected       = false;
    genderDetectPromise  = null;
    genderAccum16k.length = 0;
    genderAccumBytes     = 0;
    systemPrompt         = originalSystemPrompt;
    logger.info({ callId }, "WebCall gender detection reset — possible phone handoff");
  }

  let handoffSilenceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Arm (or re-arm) the handoff-silence timer. Fires after HANDOFF_SILENCE_MS of quiet.
   *
   * NOTE: intentionally a no-op for WebCalls.  Browser sessions have no concept
   * of a mid-call phone handoff — once gender is detected for a WebCall caller
   * it should stay locked.  Silence-based resets here were causing the agent to
   * re-detect during normal post-response pauses and pick up the TTS voice instead.
   * Phrase-based handoff detection (Signal 1) is preserved for IVR-style flows.
   */
  function resetHandoffSilenceTimer(): void { /* no-op for WebCall */ }

  /** Cancel the handoff-silence timer on any incoming speech. */
  function clearHandoffSilenceTimer(): void {
    if (handoffSilenceTimer) { clearTimeout(handoffSilenceTimer); handoffSilenceTimer = null; }
  }

  /**
   * Returns the system prompt with any unresolved {caller_salutation} replaced
   * by the neutral salutation. Safe to call before gender detection completes.
   */
  function resolvedSystemPrompt(): string {
    if (!genderDetected) {
      return applyCallerSalutation(systemPrompt, neutralSalutation);
    }
    return systemPrompt;
  }

  /** Accumulate caller audio; trigger detection once we have ~1 s of speech. */
  function accumulateGenderAudio(pcm16k: Buffer): void {
    if (!genderEnabled || genderDetected || genderDetectPromise || genderAccumBytes >= GENDER_MIN_BYTES_16K) return;
    genderAccum16k.push(pcm16k);
    genderAccumBytes += pcm16k.length;
    if (genderAccumBytes >= GENDER_MIN_BYTES_16K) {
      const combined16k = Buffer.concat(genderAccum16k);
      genderAccum16k.length = 0;   // free memory
      const pcm8k = downsample16to8(combined16k);
      // Store the promise so process() can await it if it fires before detection completes
      genderDetectPromise = detectCallerGender(pcm8k, {
        provider: genderProvider,
        maleSalutation,
        femaleSalutation,
        neutralSalutation,
        providerKeys,
        callId,
      }).then((salutation) => {
        // 1. Replace {caller_salutation} placeholders in the system prompt.
        // 2. Prepend a high-priority instruction block so the LLM actively uses
        //    the salutation in its spoken output rather than just having the
        //    word buried in replaced placeholders that it might silently ignore.
        const patched = applyCallerSalutation(systemPrompt, salutation);
        systemPrompt   = buildGenderInstruction(salutation) + patched;
        genderDetected = true;
        logger.info({ callId, salutation }, "WebCall gender detection complete");
      }).catch((err: unknown) => {
        logger.warn({ callId, err }, "WebCall gender detection failed");
      }).finally(() => {
        genderDetectPromise = null;
      });
    }
  }

  // ── State ─────────────────────────────────────────────────────────────────
  const audioChunks: Buffer[] = [];
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let processing  = false;
  let speaking    = false;   // true while audio frames are being sent to client
  let speakingEndedAt = 0;  // timestamp (ms) when speaking last transitioned to false
  const SPEAKING_ECHO_GRACE_MS = 400; // skip gender accumulation for this long after agent stops
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
      const userText = await stt.transcribe(pcm, 16000);
      if (!userText?.trim()) { processing = false; return; }

      send({ type: "transcript", speaker: "user", text: userText });
      history.push({ role: "user", content: userText });

      // ── Phone-handoff phrase detection (Signal 1: transcript keyword) ──
      if (genderEnabled && genderDetected) {
        const lower = userText.toLowerCase();
        if (HANDOFF_PHRASES.some(p => lower.includes(p))) {
          logger.info({ callId, transcript: userText }, "WebCall handoff phrase — resetting gender detection");
          resetGenderDetection();
        }
      }

      // 2. Wait for any in-flight gender detection to finish before calling the LLM.
      // Without this, a short first utterance (~0.5s) can trigger process() via the
      // VAD silence timer before ~1s of audio has accumulated for detection, causing
      // the LLM to receive the neutral (empty) salutation instead of the real one.
      if (genderEnabled && !genderDetected && genderDetectPromise) {
        await genderDetectPromise;
      }

      // 3. LLM — stream tokens, queue TTS per sentence
      const sentenceJobs: Promise<Buffer>[] = [];
      let tokenBuf  = "";
      let fullReply = "";

      function queueSentence(text: string) {
        const t = text.trim();
        if (!t) return;
        const job = tts.synthesize(t);
        // Attach a no-op catch immediately so Node.js doesn't fire
        // unhandledRejection before the for-loop below awaits the job.
        // The rejection still propagates when we await in the loop.
        job.catch(() => {});
        sentenceJobs.push(job);
      }

      await llm.chat(
        history,
        resolvedSystemPrompt(),
        (token) => {
          tokenBuf  += token;
          fullReply += token;
          const [sentences, rest] = extractSentences(tokenBuf);
          for (const s of sentences) queueSentence(s);
          tokenBuf = rest;
        },
        (full) => { fullReply = full; }
      );

      if (tokenBuf.trim()) queueSentence(tokenBuf);

      if (!fullReply.trim() || sentenceJobs.length === 0) {
        sendStatus("listening");
        processing = false;
        return;
      }

      history.push({ role: "assistant", content: fullReply });
      sendStatus("speaking");
      speaking = true;

      // 3. Pipelined sentence playback — barge-in checks at every frame
      let transcriptSent = false;

      for (let i = 0; i < sentenceJobs.length; i++) {
        if (closed || interrupted) break;

        const pcmOut = await sentenceJobs[i]!;
        if (interrupted || closed) break;

        if (!transcriptSent) {
          send({ type: "transcript", speaker: "agent", text: fullReply });
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
  async function hangup(reason = "normal") {
    if (closed) return;
    closed = true;
    clearTimeout(maxTimer);
    clearSilenceTimer();
    clearHandoffSilenceTimer();

    const endedAt         = new Date();
    const durationSeconds = Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000);
    const transcript      = history.map(t => `${t.role === "user" ? "Caller" : "Agent"}: ${t.content}`).join("\n");

    try {
      // Finalize recording — upload to GCS then save the serving URL
      const recordingUrl = await recording.finalize(callId).catch((err) => {
        logger.warn({ callId, err }, "WebCall recording upload failed");
        return null;
      });

      await db.update(callsTable).set({
        status: reason === "error" ? "failed" : "completed",
        endedAt,
        durationSeconds,
        transcript: transcript || null,
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
      if (rms > BARGE_IN_RMS) {
        bargeInFrames++;
        audioChunks.push(Buffer.from(data)); // accumulate speech for next turn
        if (!interrupted && bargeInFrames >= BARGE_IN_MIN_FRAMES) {
          interrupted = true;
          send({ type: "interrupted" }); // tell client to stop playing
          sendStatus("thinking");
          logger.info({ callId, rms, bargeInFrames }, "Barge-in triggered");
        }
      } else {
        bargeInFrames = 0; // frame dropped below threshold — reset the run
      }
      return; // don't touch silence timer while speaking
    }
    bargeInFrames = 0; // agent not speaking — reset

    // Normal VAD (agent silent)
    if (rms > SPEECH_RMS_THRESHOLD) {
      const chunk = Buffer.from(data);
      audioChunks.push(chunk);
      // Skip gender accumulation during the post-speaking echo grace period.
      // When the agent stops speaking the browser may still be flushing buffered
      // TTS audio; those ~400 ms contain TTS echo at female frequencies and must
      // not contaminate the caller's pitch profile.
      if (Date.now() - speakingEndedAt > SPEAKING_ECHO_GRACE_MS) {
        accumulateGenderAudio(chunk);
      }
      clearHandoffSilenceTimer();     // speech arrived — cancel handoff timer
      clearSilenceTimer();
      if (!processing) sendStatus("listening");
    } else if (audioChunks.length > 0) {
      audioChunks.push(Buffer.from(data));
      scheduleSilenceFlush();
    } else {
      // Pure silence with no buffered speech — start handoff timer (Signal 2)
      resetHandoffSilenceTimer();
    }
  });

  ws.on("close", async () => { if (!closed) await hangup("disconnected"); });
  ws.on("error", async (err: unknown) => {
    logger.error({ callId, err }, "WebCall WS error");
    if (!closed) await hangup("error");
  });
}
