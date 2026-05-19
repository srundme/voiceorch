import type { WebSocket } from "ws";
import { db, agentsTable, callsTable, providersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createSTTAdapter } from "../adapters/stt/index.js";
import { createLLMAdapter } from "../adapters/llm/index.js";
import { createTTSAdapter } from "../adapters/tts/index.js";
import { logger } from "../../lib/logger.js";
import type { ConversationTurn, STTConfig } from "../types.js";

// ── Tuning constants ─────────────────────────────────────────────────────────
const VAD_SILENCE_MS       = 300;
const SPEECH_RMS_THRESHOLD = 400;   // normal VAD threshold
const BARGE_IN_RMS         = 600;   // higher threshold while agent is speaking (avoids echo false-positives)
const MIN_PCM_BYTES        = 6400;  // ~200ms at 16kHz Int16
const AUDIO_CHUNK_BYTES    = 1280;  // 40ms per WS frame

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

  // ── State ─────────────────────────────────────────────────────────────────
  const audioChunks: Buffer[] = [];
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let processing  = false;
  let speaking    = false;   // true while audio frames are being sent to client
  let interrupted = false;   // barge-in flag; checked inside audio loop

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

      // 2. LLM — stream tokens, queue TTS per sentence
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
        agent.systemPrompt,
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
          sendAudio(pcmOut.slice(j, j + AUDIO_CHUNK_BYTES));
          await new Promise(r => setTimeout(r, 40));
        }
      }

      speaking = false;

      if (interrupted) {
        // Barge-in: immediately process whatever the user said
        logger.info({ callId }, "Barge-in detected — processing user interruption");
        if (audioChunks.length > 0) void process();
      } else if (!closed) {
        sendStatus("listening");
      }

    } catch (err) {
      speaking = false;
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

    const endedAt         = new Date();
    const durationSeconds = Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000);
    const transcript      = history.map(t => `${t.role === "user" ? "Caller" : "Agent"}: ${t.content}`).join("\n");

    try {
      await db.update(callsTable).set({
        status: reason === "timeout" || reason === "normal" ? "completed" : "failed",
        endedAt,
        durationSeconds,
        transcript: transcript || null,
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

    const rms = rmsEnergy(data);

    if (speaking) {
      // Agent is speaking — use elevated threshold to ignore echo
      if (rms > BARGE_IN_RMS) {
        audioChunks.push(Buffer.from(data)); // buffer user speech for next turn
        if (!interrupted) {
          interrupted = true;
          send({ type: "interrupted" }); // tell client to stop playing
          sendStatus("thinking");
          logger.info({ callId, rms }, "Barge-in triggered");
        }
      }
      return; // don't touch silence timer while speaking
    }

    // Normal VAD (agent silent)
    if (rms > SPEECH_RMS_THRESHOLD) {
      audioChunks.push(Buffer.from(data));
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
    if (!closed) await hangup("error");
  });
}
