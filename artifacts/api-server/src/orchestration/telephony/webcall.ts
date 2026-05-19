import type { WebSocket } from "ws";
import { db, agentsTable, callsTable, providersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createSTTAdapter } from "../adapters/stt/index.js";
import { createLLMAdapter } from "../adapters/llm/index.js";
import { createTTSAdapter } from "../adapters/tts/index.js";
import { logger } from "../../lib/logger.js";
import type { ConversationTurn } from "../types.js";

const VAD_SILENCE_MS = 600;
const SPEECH_RMS_THRESHOLD = 400;   // Int16 RMS threshold
const MIN_PCM_BYTES = 6400;         // ~200ms at 16kHz Int16

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

type Status = "idle" | "listening" | "thinking" | "speaking";

/**
 * WebCall WebSocket handler
 *
 * Protocol:
 *   Client → Server:  Binary frames of Int16LE PCM at 16kHz (raw mic audio)
 *   Client → Server:  JSON {"type":"end"} to hang up
 *   Server → Client:  JSON {"type":"ready"|"status"|"transcript"|"error"|"ended", ...}
 *   Server → Client:  Binary frames of Int16LE PCM at 16kHz (TTS audio)
 */
export async function handleWebCallWebSocket(
  ws: WebSocket,
  agentId: number
): Promise<void> {
  function send(data: Record<string, unknown>) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(data));
  }
  function sendStatus(status: Status) {
    send({ type: "status", status });
  }
  function sendAudio(pcm: Buffer) {
    if (ws.readyState === ws.OPEN) ws.send(pcm);
  }

  // ── Load agent + provider keys ──────────────────────────────────────────────
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
  if (!agent) {
    send({ type: "error", message: "Agent not found" });
    ws.close();
    return;
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

  const stt = createSTTAdapter(agent.asrProvider, sttKey, agent.asrModel, null);
  const llm = createLLMAdapter(agent.llmProvider, llmKey, agent.llmModel);
  const tts = createTTSAdapter(agent.ttsProvider, ttsKey, agent.ttsVoice);

  // ── Create call DB record ────────────────────────────────────────────────────
  const [callRecord] = await db.insert(callsTable).values({
    agentId,
    status: "in_progress",
    toNumber: "webcall",
    fromNumber: "browser",
    metadata: JSON.stringify({ channel: "webcall" }),
  }).returning();

  if (!callRecord) {
    send({ type: "error", message: "Failed to create call record" });
    ws.close();
    return;
  }

  const callId = callRecord.id;
  const startedAt = new Date();
  const history: ConversationTurn[] = [];
  let closed = false;

  // ── Audio buffering + VAD ────────────────────────────────────────────────────
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
      // STT
      const transcript = await stt.transcribe(pcm, 16000);
      if (!transcript?.trim()) { processing = false; return; }

      send({ type: "transcript", speaker: "user", text: transcript });
      history.push({ role: "user", content: transcript });

      // LLM
      let reply = "";
      await llm.chat(history, agent.systemPrompt, (tok) => { reply += tok; }, async (full) => { reply = full; });
      history.push({ role: "assistant", content: reply });

      // TTS — synthesize fully before showing transcript so text and audio
      // arrive at the client at the same time (no "text before voice" gap)
      sendStatus("speaking");
      const pcmOut = await tts.synthesize(reply);

      // Send transcript and first audio chunk together
      send({ type: "transcript", speaker: "agent", text: reply });

      // Stream in 640-byte chunks (20ms of Int16 at 16kHz)
      const CHUNK = 640;
      for (let i = 0; i < pcmOut.length; i += CHUNK) {
        if (closed) break;
        sendAudio(pcmOut.slice(i, i + CHUNK));
        await new Promise(r => setTimeout(r, 20));
      }

      sendStatus("listening");
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
    silenceTimer = setTimeout(() => {
      silenceTimer = null;
      void process();
    }, VAD_SILENCE_MS);
  }

  function clearSilenceTimer() {
    if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
  }

  // ── Ready ────────────────────────────────────────────────────────────────────
  send({ type: "ready", agentId, agentName: agent.name, callId });
  sendStatus("listening");
  logger.info({ callId, agentId, agentName: agent.name }, "WebCall session started");

  // Max duration auto-end
  const maxTimer = setTimeout(() => { void hangup("timeout"); }, (agent.maxDuration ?? 600) * 1000);

  async function hangup(reason = "normal") {
    if (closed) return;
    closed = true;
    clearTimeout(maxTimer);
    clearSilenceTimer();

    const endedAt = new Date();
    const durationSeconds = Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000);
    const transcript = history.map(t => `${t.role === "user" ? "Caller" : "Agent"}: ${t.content}`).join("\n");

    try {
      await db.update(callsTable).set({
        status: reason === "timeout" || reason === "normal" ? "completed" : "failed",
        endedAt,
        durationSeconds,
        transcript: transcript || null,
      }).where(eq(callsTable.id, callId));

      // Update agent stats
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
      logger.error({ callId, err }, "Error finalizing webcall");
    }

    send({ type: "ended", durationSeconds, reason });
    ws.close();
    logger.info({ callId, durationSeconds }, "WebCall ended");
  }

  // ── Message handler ──────────────────────────────────────────────────────────
  ws.on("message", (data: Buffer | string) => {
    if (closed) return;

    if (typeof data === "string") {
      try {
        const msg = JSON.parse(data) as { type: string };
        if (msg.type === "end") void hangup("normal");
      } catch { /* ignore */ }
      return;
    }

    // Binary: Int16LE PCM at 16kHz
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

  ws.on("close", async () => {
    if (!closed) await hangup("disconnected");
  });

  ws.on("error", async (err: unknown) => {
    logger.error({ callId, err }, "WebCall WS error");
    if (!closed) await hangup("error");
  });
}
