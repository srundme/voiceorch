import { db, agentsTable, callsTable, providersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { OrchestrationPipeline } from "./pipeline.js";
import type { AgentConfig, TelephonyProvider } from "./types.js";
import { logger } from "../lib/logger.js";

interface ActiveSession {
  callId: number;
  pipeline: OrchestrationPipeline;
  startedAt: Date;
  transcript: string;
}

// In-memory session registry  
const sessions = new Map<string, ActiveSession>();

export async function createSession(params: {
  agentId: number;
  telephonyProvider: TelephonyProvider;
  toNumber: string;
  fromNumber: string;
  externalCallId?: string; // Twilio CallSid, Plivo CallUUID, etc.
  onAudioOut: (audio: Buffer) => void;
  onCallEnd: () => void;
}): Promise<{ sessionId: string; callDbId: number }> {

  // Load agent config from DB
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, params.agentId));
  if (!agent) throw new Error(`Agent ${params.agentId} not found`);

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
    telephonyProvider: agent.telephonyProvider,
  };

  // Load all provider API keys
  const providerRows = await db.select().from(providersTable).where(eq(providersTable.isActive, true));
  const providerKeys = new Map<string, string>();
  for (const row of providerRows) {
    providerKeys.set(row.providerName.toLowerCase(), row.apiKey);
  }

  // Create call record in DB
  const [callRecord] = await db.insert(callsTable).values({
    agentId: params.agentId,
    status: "in_progress",
    toNumber: params.toNumber,
    fromNumber: params.fromNumber,
    metadata: params.externalCallId ? JSON.stringify({ externalCallId: params.externalCallId }) : null,
  }).returning();

  if (!callRecord) throw new Error("Failed to create call record");

  let fullTranscript = "";

  const pipeline = new OrchestrationPipeline({
    callId: callRecord.id,
    agentConfig,
    providerKeys,
    telephonyProvider: params.telephonyProvider,
    onAudioOut: params.onAudioOut,
    onTranscript: (speaker, text) => {
      fullTranscript += `${speaker === "user" ? "Caller" : "Agent"}: ${text}\n`;
    },
    onCallEnd: params.onCallEnd,
  });

  const sessionId = `${params.telephonyProvider}-${callRecord.id}-${Date.now()}`;

  sessions.set(sessionId, {
    callId: callRecord.id,
    pipeline,
    startedAt: new Date(),
    transcript: fullTranscript,
  });

  // Auto-end after maxDuration
  setTimeout(() => {
    void endSession(sessionId);
  }, agentConfig.maxDuration * 1000);

  logger.info({ sessionId, callId: callRecord.id, agent: agent.name }, "Session created");

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

  try {
    await db.update(callsTable).set({
      status: "completed",
      endedAt,
      durationSeconds,
      transcript: transcript || null,
    }).where(eq(callsTable.id, session.callId));

    // Update agent stats
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
      }
    }
  } catch (err) {
    logger.error({ sessionId, err }, "Error finalizing session");
  }

  logger.info({ sessionId, durationSeconds }, "Session ended");
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
