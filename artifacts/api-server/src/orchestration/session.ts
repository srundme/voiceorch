import { db, agentsTable, callsTable, providersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { OrchestrationPipeline } from "./pipeline.js";
import type { AgentConfig, TelephonyProvider, PipelineMetrics } from "./types.js";
import { logger } from "../lib/logger.js";

interface MetricsAcc {
  sttTotal: number;
  llmTotal: number;
  ttsTotal: number;
  count: number;
}

interface ActiveSession {
  callId: number;
  pipeline: OrchestrationPipeline;
  startedAt: Date;
  metricsAcc: MetricsAcc;
}

const sessions = new Map<string, ActiveSession>();

export async function createSession(params: {
  agentId: number;
  telephonyProvider: TelephonyProvider;
  toNumber: string;
  fromNumber: string;
  externalCallId?: string;
  onAudioOut: (audio: Buffer) => void;
  onCallEnd: () => void;
  onBargeIn?: () => void;
}): Promise<{ sessionId: string; callDbId: number }> {

  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, params.agentId));
  if (!agent) throw new Error(`Agent ${params.agentId} not found`);

  // Parse comma-separated end-call phrases
  const endCallPhrases = agent.endCallPhrases
    ? agent.endCallPhrases.split(",").map(s => s.trim()).filter(Boolean)
    : [];

  const agentConfig: AgentConfig = {
    id: agent.id,
    name: agent.name,
    systemPrompt: agent.systemPrompt,
    temperature: agent.temperature ?? 0.5,
    maxDuration: agent.maxDuration ?? 600,
    asrProvider: agent.asrProvider,
    asrModel: agent.asrModel,
    llmProvider: agent.llmProvider,
    llmModel: agent.llmModel,
    ttsProvider: agent.ttsProvider,
    ttsVoice: agent.ttsVoice,
    ttsModel: agent.ttsModel,
    telephonyProvider: agent.telephonyProvider,
    greetingMessage: agent.greetingMessage ?? null,
    endCallPhrases,
    silenceTimeoutSeconds: agent.silenceTimeoutSeconds ?? null,
    language: agent.language ?? null,
    backchannelingEnabled: agent.backchannelingEnabled ?? false,
    backchannelingFrequency: agent.backchannelingFrequency ?? null,
    webhookUrl: agent.webhookUrl ?? null,
    noiseCancellationEnabled: agent.noiseCancellationEnabled ?? false,
  };

  const providerRows = await db.select().from(providersTable).where(eq(providersTable.isActive, true));
  const providerKeys = new Map<string, string>();
  for (const row of providerRows) {
    providerKeys.set(row.providerName.toLowerCase(), row.apiKey);
  }

  const [callRecord] = await db.insert(callsTable).values({
    agentId: params.agentId,
    status: "in_progress",
    toNumber: params.toNumber,
    fromNumber: params.fromNumber,
    metadata: params.externalCallId ? JSON.stringify({ externalCallId: params.externalCallId }) : null,
  }).returning();

  if (!callRecord) throw new Error("Failed to create call record");

  const metricsAcc: MetricsAcc = { sttTotal: 0, llmTotal: 0, ttsTotal: 0, count: 0 };

  const pipeline = new OrchestrationPipeline({
    callId: callRecord.id,
    agentConfig,
    providerKeys,
    telephonyProvider: params.telephonyProvider,
    onAudioOut: params.onAudioOut,
    onTranscript: (speaker, text) => {
      logger.debug({ callId: callRecord.id, speaker, text: text.slice(0, 80) }, "Transcript");
    },
    onCallEnd: params.onCallEnd,
    onBargeIn: params.onBargeIn,
    onMetrics: (m: PipelineMetrics) => {
      metricsAcc.sttTotal += m.sttLatencyMs;
      metricsAcc.llmTotal += m.llmLatencyMs;
      metricsAcc.ttsTotal += m.ttsFirstChunkMs;
      metricsAcc.count++;
      logger.info(
        { callId: callRecord.id, ...m, turnCount: metricsAcc.count },
        "Per-turn metrics"
      );
    },
  });

  const sessionId = `${params.telephonyProvider}-${callRecord.id}-${Date.now()}`;

  sessions.set(sessionId, {
    callId: callRecord.id,
    pipeline,
    startedAt: new Date(),
    metricsAcc,
  });

  setTimeout(() => { void endSession(sessionId); }, agentConfig.maxDuration * 1000);

  logger.info({ sessionId, callId: callRecord.id, agent: agent.name }, "Session created");

  pipeline.greet().catch((err) => {
    logger.error({ sessionId, err }, "Greeting failed");
  });

  return { sessionId, callDbId: callRecord.id };
}

export function getSession(sessionId: string): ActiveSession | undefined {
  return sessions.get(sessionId);
}

export function getSessionByCallId(callDbId: number): ActiveSession | undefined {
  for (const session of sessions.values()) {
    if (session.callId === callDbId) return session;
  }
  return undefined;
}

export async function endSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;

  sessions.delete(sessionId);
  session.pipeline.close();

  const endedAt = new Date();
  const durationSeconds = Math.floor((endedAt.getTime() - session.startedAt.getTime()) / 1000);
  const transcript = session.pipeline.getTranscript();

  const { metricsAcc } = session;
  const avgSttMs = metricsAcc.count > 0 ? Math.round(metricsAcc.sttTotal / metricsAcc.count) : null;
  const avgLlmMs = metricsAcc.count > 0 ? Math.round(metricsAcc.llmTotal / metricsAcc.count) : null;
  const avgTtsMs = metricsAcc.count > 0 ? Math.round(metricsAcc.ttsTotal / metricsAcc.count) : null;

  try {
    await db.update(callsTable).set({
      status: "completed",
      endedAt,
      durationSeconds,
      transcript: transcript || null,
      sttLatencyMs: avgSttMs,
      llmLatencyMs: avgLlmMs,
      ttsFirstChunkMs: avgTtsMs,
    }).where(eq(callsTable.id, session.callId));

    const [call] = await db.select().from(callsTable).where(eq(callsTable.id, session.callId));
    if (call) {
      const [ag] = await db.select().from(agentsTable).where(eq(agentsTable.id, call.agentId));
      if (ag) {
        const newSuccessful = ag.successfulCalls + 1;
        const newAvg = ag.avgDurationSeconds
          ? Math.floor((ag.avgDurationSeconds * ag.successfulCalls + durationSeconds) / newSuccessful)
          : durationSeconds;
        await db.update(agentsTable).set({
          successfulCalls: newSuccessful,
          avgDurationSeconds: newAvg,
        }).where(eq(agentsTable.id, ag.id));

        // ── Post-call webhook ─────────────────────────────────────────────────
        if (ag.webhookUrl) {
          fetch(ag.webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              callId: session.callId,
              agentId: ag.id,
              agentName: ag.name,
              status: "completed",
              durationSeconds,
              transcript,
              avgSttLatencyMs: avgSttMs,
              avgLlmLatencyMs: avgLlmMs,
              avgTtsLatencyMs: avgTtsMs,
              endedAt: endedAt.toISOString(),
            }),
          }).catch((err) => {
            logger.error({ sessionId, webhookUrl: ag.webhookUrl, err }, "Webhook delivery failed");
          });
        }
      }
    }
  } catch (err) {
    logger.error({ sessionId, err }, "Error finalizing session");
  }

  logger.info(
    { sessionId, durationSeconds, avgSttMs, avgLlmMs, avgTtsMs },
    "Session ended"
  );
}

export async function failSession(sessionId: string, errorMessage: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;

  sessions.delete(sessionId);
  session.pipeline.close();

  await db.update(callsTable).set({
    status: "failed",
    endedAt: new Date(),
    errorMessage,
  }).where(eq(callsTable.id, session.callId)).catch(() => {});

  logger.error({ sessionId, errorMessage }, "Session failed");
}
