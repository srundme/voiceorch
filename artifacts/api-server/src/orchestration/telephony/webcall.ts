import type { WebSocket } from "ws";
import { db, agentsTable, callsTable, providersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createSTTAdapter } from "../adapters/stt/index.js";
import { createLLMAdapter } from "../adapters/llm/index.js";
import { createTTSAdapter } from "../adapters/tts/index.js";
import { logger } from "../../lib/logger.js";
import type { ConversationTurn } from "../types.js";

// ── Tuning constants ─────────────────────────────────────────────────────────
const VAD_SILENCE_MS      = 300;  // was 600ms — shorter silence window
const SPEECH_RMS_THRESHOLD = 400; // Int16 RMS
const MIN_PCM_BYTES        = 6400; // ~200ms at 16kHz Int16
const AUDIO_CHUNK_BYTES    = 1280; // 40ms per WS frame (was 640/20ms)

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Compute RMS energy from Int16LE PCM buffer */
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
 * Extract complete sentences from a token buffer.
 * Returns [completeSentences[], remainingBuffer].
 * Splits on .!? followed by whitespace.
 */
function extractSentences(buf: string): [string[], string] {
  const parts = buf.split(/(?<=[.!?])\s+/);
  if (parts.length <= 1) return [[], buf];
  const complete = parts.slice(0, -1).map(s => s.trim()).filter(Boolean);
  const rest = parts[parts.length - 1] ?? "";
  return [complete, rest];
}

type Status = "idle" | "listening" | "thinking" | "speaking";

/**
 * WebCall WebSocket handler — low-latency browser voice pipeline.
 *
 * Latency optimisations:
 *   1. Shorter VAD silence window (300ms instead of 600ms)
 *   2. Sentence-level pipelined TTS: synthesise sentence N+1 in the
 *      background while playing sentence N, so first audio arrives as
 *      soon as the first sentence of the LLM response is ready — not
 *      after the whole reply is synthesised.
 *   3. Larger WS audio frames (40ms) to reduce per-frame overhead.
 *
 * Protocol (unchanged):
 *   Client → Server  Binary Int16LE PCM at 16kHz
 *   Client → Server  JSON {"type":"end"}
 *   Server → Client  JSON {"type":"ready"|"status"|"transcript"|"error"|"ended", ...}
 *   Server → Client  Binary Int16LE PCM at 16kHz
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

  const stt = createSTTAdapter(agent.asrProvider, sttKey, agent.asrModel, null);
  const llm = createLLMAdapter(agent.llmProvider, llmKey, agent.llmModel);
  const tts = createTTSAdapter(agent.ttsProvider, ttsKey, agent.ttsVoice);

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
  let closed = false;

  // ── Audio buffering + VAD ─────────────────────────────────────────────────
  const audioChunks: Buffer[] = [];
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let processing = false;

  async function process() {
    if (processing || audioChunks.length === 0) return;
    const pcm = Buffer.concat(audioChunks.splice(0));
    if (pcm.length < MIN_PCM_BYTES) return;

    processing = true;
    sendStatus("thinking");

    try {
      // ── 1. STT ──────────────────────────────────────────────────────────
      const userText = await stt.transcribe(pcm, 16000);
      if (!userText?.trim()) { processing = false; return; }

      send({ type: "transcript", speaker: "user", text: userText });
      history.push({ role: "user", content: userText });

      // ── 2. LLM — stream tokens, kick off TTS per sentence ───────────────
      //
      // sentenceJobs holds TTS synthesis Promises in order.
      // Each Promise is started the moment a complete sentence is detected
      // in the token stream, so synthesis of sentence N+1 runs concurrently
      // with audio playback of sentence N.
      const sentenceJobs: Promise<Buffer>[] = [];
      let tokenBuf  = "";
      let fullReply = "";

      function queueSentence(text: string) {
        const t = text.trim();
        if (t) sentenceJobs.push(tts.synthesize(t));
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

      // Flush anything left in the buffer after LLM finishes
      if (tokenBuf.trim()) queueSentence(tokenBuf);

      if (!fullReply.trim() || sentenceJobs.length === 0) {
        processing = false;
        sendStatus("listening");
        return;
      }

      history.push({ role: "assistant", content: fullReply });
      sendStatus("speaking");

      // ── 3. Pipelined playback ────────────────────────────────────────────
      //
      // Await each job in sequence.  By the time job[0] resolves and we
      // finish playing it, job[1] has been running in the background and
      // is likely already resolved — so the gap between sentences is near zero.
      let transcriptSent = false;

      for (let i = 0; i < sentenceJobs.length; i++) {
        if (closed) break;

        const pcmOut = await sentenceJobs[i]!;

        // Show transcript at the moment first audio is ready
        if (!transcriptSent) {
          send({ type: "transcript", speaker: "agent", text: fullReply });
          transcriptSent = true;
        }

        // Stream audio in 40ms frames
        for (let j = 0; j < pcmOut.length; j += AUDIO_CHUNK_BYTES) {
          if (closed) break;
          sendAudio(pcmOut.slice(j, j + AUDIO_CHUNK_BYTES));
          await new Promise(r => setTimeout(r, 40));
        }
      }

      if (!closed) sendStatus("listening");

    } catch (err) {
      logger.error({ callId, err }, "WebCall pipeline error");
      send({ type: "error", message: String(err) });
    } finally {
      processing = false;
      if (audioChunks.length > 0) void process();
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

    const endedAt        = new Date();
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
