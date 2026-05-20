import { db, agentsTable, callsTable, providersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { OrchestrationPipeline } from "./pipeline.js";
import { createLLMAdapter } from "./adapters/llm/index.js";
import type { AgentConfig, AgentTool, TelephonyProvider, PipelineMetrics } from "./types.js";
import { logger } from "../lib/logger.js";
import {
  saveSessionMeta,
  patchSessionMeta,
  saveConversation,
  removeSession,
} from "./sessionStore.js";
import { destroyAudioSession } from "./audioPool.js";

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
  wasTransferred: boolean;
  transferredTo: string | null;
}

const sessions = new Map<string, ActiveSession>();

export async function createSession(params: {
  agentId: number;
  telephonyProvider: TelephonyProvider;
  toNumber: string;
  fromNumber: string;
  externalCallId?: string;
  platformTelephony?: boolean;
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

  // Parse tools JSON column (null-safe, type-cast to AgentTool[])
  const tools = Array.isArray(agent.tools) ? (agent.tools as unknown as AgentTool[]) : [];

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
    inactivityMessage: agent.inactivityMessage ?? null,
    sttConfig: {
      language: agent.asrLanguage ?? null,
      backgroundDenoising: agent.asrBackgroundDenoising ?? false,
      confidenceThreshold: agent.asrConfidenceThreshold ?? 0.40,
      endOfTurnConfidence: agent.asrEndOfTurnConfidence ?? 0.70,
      endOfTurnTimeout: agent.asrEndOfTurnTimeout ?? 5000,
      keyterms: agent.asrKeyterms
        ? agent.asrKeyterms.split(",").map(s => s.trim()).filter(Boolean)
        : [],
      smartEndpointing: agent.asrSmartEndpointing ?? "off",
      autoFallback: agent.asrAutoFallback ?? false,
    },
    tools,
  };

  // ── Resolve dynamic variables in system prompt ─────────────────────────────
  // Supports {{to_number}}, {{from_number}}, {{agent_name}} in system prompt
  const dynVars: Record<string, string> = {
    to_number:   params.toNumber,
    from_number: params.fromNumber,
    agent_name:  agent.name,
  };
  agentConfig.systemPrompt = agentConfig.systemPrompt.replace(
    /\{\{(\w+)\}\}/g,
    (_, key) => (key in dynVars ? dynVars[key as keyof typeof dynVars] : `{{${key as string}}}`)
  );

  // Scope provider keys to this agent's owner; fall back to all active if agent has no userId
  const providerRows = agent.userId
    ? await db.select().from(providersTable).where(
        and(eq(providersTable.isActive, true), eq(providersTable.userId, agent.userId))
      )
    : await db.select().from(providersTable).where(eq(providersTable.isActive, true));
  const providerKeys = new Map<string, string>();
  for (const row of providerRows) {
    providerKeys.set(row.providerName.toLowerCase(), row.apiKey);
  }

  const [callRecord] = await db.insert(callsTable).values({
    agentId: params.agentId,
    status: "in_progress",
    toNumber: params.toNumber,
    fromNumber: params.fromNumber,
    metadata: JSON.stringify({
      ...(params.externalCallId ? { externalCallId: params.externalCallId } : {}),
      ...(params.platformTelephony ? { platformTelephony: true } : {}),
    }) || null,
  }).returning();

  if (!callRecord) throw new Error("Failed to create call record");

  const metricsAcc: MetricsAcc = { sttTotal: 0, llmTotal: 0, ttsTotal: 0, count: 0 };
  let wasTransferred = false;
  let transferredTo: string | null = null;

  const sessionId = `${params.telephonyProvider}-${callRecord.id}-${Date.now()}`;
  const redisTtl = (agentConfig.maxDuration ?? 600) + 600; // maxDuration + 10 min buffer

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
    onCallTransfer: (to) => {
      wasTransferred = true;
      transferredTo = to;
      logger.info({ callId: callRecord.id, transferTo: to }, "Call transfer initiated");
      void patchSessionMeta(sessionId, { wasTransferred: true, transferredTo: to }, redisTtl);
    },
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
      void patchSessionMeta(sessionId, {
        sttTotal: metricsAcc.sttTotal,
        llmTotal: metricsAcc.llmTotal,
        ttsTotal: metricsAcc.ttsTotal,
        metricsCount: metricsAcc.count,
      }, redisTtl);
    },
    onConversationUpdate: (history) => {
      void saveConversation(callRecord.id, history, redisTtl);
    },
  });

  sessions.set(sessionId, {
    callId: callRecord.id,
    pipeline,
    startedAt: new Date(),
    metricsAcc,
    get wasTransferred() { return wasTransferred; },
    get transferredTo() { return transferredTo; },
  });

  // Persist initial session metadata to Redis
  void saveSessionMeta(sessionId, {
    callId: callRecord.id,
    agentId: params.agentId,
    startedAt: new Date().toISOString(),
    wasTransferred: false,
    transferredTo: null,
    status: "active",
    sttTotal: 0,
    llmTotal: 0,
    ttsTotal: 0,
    metricsCount: 0,
  }, redisTtl);

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
  destroyAudioSession(String(session.callId));
  void patchSessionMeta(sessionId, { status: "ended" }, 3600);
  void removeSession(sessionId, session.callId);

  const endedAt = new Date();
  const durationSeconds = Math.floor((endedAt.getTime() - session.startedAt.getTime()) / 1000);
  const transcript = session.pipeline.getTranscript();

  const { metricsAcc } = session;
  const avgSttMs = metricsAcc.count > 0 ? Math.round(metricsAcc.sttTotal / metricsAcc.count) : null;
  const avgLlmMs = metricsAcc.count > 0 ? Math.round(metricsAcc.llmTotal / metricsAcc.count) : null;
  const avgTtsMs = metricsAcc.count > 0 ? Math.round(metricsAcc.ttsTotal / metricsAcc.count) : null;

  try {
    const callStatus = session.wasTransferred ? "transferred" : "completed";
    await db.update(callsTable).set({
      status: callStatus,
      endedAt,
      durationSeconds,
      transcript: transcript || null,
      sttLatencyMs: avgSttMs,
      llmLatencyMs: avgLlmMs,
      ttsFirstChunkMs: avgTtsMs,
      ...(session.wasTransferred && session.transferredTo
        ? { metadata: JSON.stringify({ transferredTo: session.transferredTo }) }
        : {}),
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

        // ── Post-call AI summary ──────────────────────────────────────────────
        if (transcript && transcript.length > 100 && ag.userId) {
          void (async () => {
            try {
              const llmProvs = await db.select().from(providersTable).where(
                and(
                  eq(providersTable.isActive, true),
                  eq(providersTable.userId, ag.userId!),
                  eq(providersTable.providerName, ag.llmProvider)
                )
              );
              const llmKey = llmProvs[0]?.apiKey;
              if (llmKey) {
                const llm = createLLMAdapter(ag.llmProvider, llmKey, ag.llmModel);
                let summary = "";
                await llm.chat(
                  [{ role: "user", content: `Summarize this call transcript in exactly 3 concise bullet points:\n\n${transcript.slice(0, 6000)}` }],
                  "You are a call analyst. Summarize the call in exactly 3 bullet points covering: main topic, key outcomes, and action items. Be brief and factual. Start each bullet with '•'.",
                  () => {},
                  (full) => { summary = full; }
                );
                if (summary) {
                  await db.update(callsTable).set({ callSummary: summary }).where(eq(callsTable.id, session.callId));
                }
              }
            } catch (summaryErr) {
              logger.warn({ sessionId, summaryErr }, "Post-call summary generation failed");
            }
          })();
        }

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
  void patchSessionMeta(sessionId, { status: "failed" }, 3600);
  void removeSession(sessionId, session.callId);

  await db.update(callsTable).set({
    status: "failed",
    endedAt: new Date(),
    errorMessage,
  }).where(eq(callsTable.id, session.callId)).catch(() => {});

  logger.error({ sessionId, errorMessage }, "Session failed");
}
