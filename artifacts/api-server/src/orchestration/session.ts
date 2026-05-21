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
import {
  humanPhone,
  loadCallerProfile,
  injectCallerMemory,
  updateCallerProfile,
  detectCallbackRequest,
  type CallerProfile,
} from "./callerMemory.js";

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
  // Cross-call memory
  callerPhone: string | null;           // human's phone number (null for webcall/unknown)
  callerProfileSnapshot: CallerProfile | null;  // profile at call start (for callCount delta)
  agentUserId: string | null;           // needed to scope LLM key in endSession
  agentLlmProvider: string;
  agentLlmModel: string;
  // Dropped-call detection: true when pipeline triggered the end (phrase/timeout/tool)
  // false means WS just closed — i.e. call was likely dropped mid-conversation
  naturalEndTriggered: boolean;
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

  // Read agentConfig JSONB for advanced settings
  const agentCfg = (agent.agentConfig ?? {}) as Record<string, unknown>;

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
    // Gender Detection (from agentConfig JSONB)
    genderDetectionEnabled:          (agentCfg["genderDetectionEnabled"]          as boolean | undefined) ?? false,
    genderDetectionProvider:         (agentCfg["genderDetectionProvider"]         as string  | undefined) ?? "internal",
    genderDetectionMaleSalutation:   (agentCfg["genderDetectionMaleSalutation"]   as string  | undefined) ?? "sir",
    genderDetectionFemaleSalutation: (agentCfg["genderDetectionFemaleSalutation"] as string  | undefined) ?? "ma'am",
    genderDetectionNeutralSalutation:(agentCfg["genderDetectionNeutralSalutation"] as string  | undefined) ?? "",
  };

  // ── Cross-call caller memory ────────────────────────────────────────────────
  const callerPhone = humanPhone(params.fromNumber, params.toNumber);
  let callerProfileSnapshot: CallerProfile | null = null;
  if (callerPhone) {
    try {
      callerProfileSnapshot = await loadCallerProfile(params.agentId, callerPhone);
      if (callerProfileSnapshot) {
        agentConfig.systemPrompt = injectCallerMemory(agentConfig.systemPrompt, callerProfileSnapshot);
        logger.info(
          { agentId: params.agentId, callerPhone, callCount: callerProfileSnapshot.callCount },
          "Caller memory injected into system prompt"
        );
      }
    } catch (memErr) {
      logger.warn({ agentId: params.agentId, callerPhone, memErr }, "Failed to load caller profile — continuing without memory");
    }
  }

  // ── Resolve dynamic variables in system prompt ─────────────────────────────
  // Supports both {{var}} and {var} syntax.
  // {caller_salutation} is intentionally left unresolved here — the pipeline
  // resolves it at runtime after detecting the caller's gender from audio.
  const now = new Date();
  const dynVars: Record<string, string> = {
    // double-brace legacy names
    to_number:   params.toNumber,
    from_number: params.fromNumber,
    agent_name:  agent.name,
    // single-brace chip names
    caller_number: params.fromNumber,
    date: now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
  };

  // Replace both {{var}} and {var} — but skip {caller_salutation} (runtime only)
  const resolveVar = (key: string, fullMatch: string): string => {
    if (key === "caller_salutation") return fullMatch;   // deferred to pipeline
    return key in dynVars ? dynVars[key]! : fullMatch;
  };

  agentConfig.systemPrompt = agentConfig.systemPrompt
    .replace(/\{\{(\w+)\}\}/g, (m, k: string) => resolveVar(k, m))
    .replace(/\{(\w+)\}/g,     (m, k: string) => resolveVar(k, m));

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
  // Becomes true when the pipeline deliberately ends the call (phrase/silence/tool/max-duration)
  // Remains false if the WS just closes unexpectedly → dropped call
  let naturalEndTriggered = false;

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
    onCallEnd: () => {
      naturalEndTriggered = true;
      params.onCallEnd();
    },
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
    get naturalEndTriggered() { return naturalEndTriggered; },
    callerPhone,
    callerProfileSnapshot,
    agentUserId:      agent.userId ?? null,
    agentLlmProvider: agent.llmProvider,
    agentLlmModel:    agent.llmModel ?? "",
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

export function getAllSessions(): Array<{ sessionId: string; callId: number; startedAt: Date }> {
  return Array.from(sessions.entries()).map(([sessionId, session]) => ({
    sessionId,
    callId: session.callId,
    startedAt: session.startedAt,
  }));
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

    // ── Upload call recording (async, non-blocking) ──────────────────────────
    // Finalize happens concurrently; we await the URL before writing to DB.
    const recordingUrl = await session.pipeline.getRecording().finalize(session.callId)
      .catch((err) => {
        logger.warn({ sessionId, err }, "Recording finalization failed");
        return null;
      });

    await db.update(callsTable).set({
      status: callStatus,
      endedAt,
      durationSeconds,
      transcript: transcript || null,
      sttLatencyMs: avgSttMs,
      llmLatencyMs: avgLlmMs,
      ttsFirstChunkMs: avgTtsMs,
      ...(recordingUrl ? { recordingUrl } : {}),
      ...(session.wasTransferred && session.transferredTo
        ? { metadata: JSON.stringify({ transferredTo: session.transferredTo }) }
        : {}),
    }).where(eq(callsTable.id, session.callId));

    const [call] = await db.select().from(callsTable).where(eq(callsTable.id, session.callId));
    if (call) {
      const [ag] = await db.select().from(agentsTable).where(eq(agentsTable.id, call.agentId));
      if (ag) {
        const prevCount    = ag.successfulCalls;
        const newSuccessful = prevCount + 1;

        // Rolling average for duration
        const newAvg = ag.avgDurationSeconds
          ? Math.floor((ag.avgDurationSeconds * prevCount + durationSeconds) / newSuccessful)
          : durationSeconds;

        // Rolling averages for per-turn latency (only update when this call
        // had at least one metered turn, i.e. avgSttMs / avgLlmMs / avgTtsMs
        // are not null)
        const rollingLatency = (oldVal: number | null, newVal: number | null): number | null => {
          if (newVal == null) return oldVal;          // no data this call — keep existing avg
          if (oldVal == null) return newVal;          // first data point
          return Math.round((oldVal * prevCount + newVal) / newSuccessful);
        };

        await db.update(agentsTable).set({
          successfulCalls:    newSuccessful,
          avgDurationSeconds: newAvg,
          avgSttLatencyMs:    rollingLatency(ag.avgSttLatencyMs,     avgSttMs),
          avgLlmLatencyMs:    rollingLatency(ag.avgLlmLatencyMs,     avgLlmMs),
          avgTtsFirstChunkMs: rollingLatency(ag.avgTtsFirstChunkMs,  avgTtsMs),
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

        // ── Post-call caller memory update + callback detection ──────────────
        if (session.callerPhone && transcript && transcript.length > 50) {
          // A call is "dropped" if the WS just closed without the pipeline
          // deliberately ending it (end-call phrase, silence timeout, tool, max-duration).
          // Only flag it for short-ish calls (< 20 min) — very long calls
          // that max out aren't really "dropped".
          const wasDropped =
            !session.naturalEndTriggered &&
            !session.wasTransferred &&
            durationSeconds > 15 &&
            durationSeconds < 1200;

          void (async () => {
            try {
              const memLlmProvs = await db.select().from(providersTable).where(
                and(
                  eq(providersTable.isActive, true),
                  ...(session.agentUserId
                    ? [eq(providersTable.userId, session.agentUserId)]
                    : []),
                  eq(providersTable.providerName, session.agentLlmProvider),
                ),
              );
              const memLlmKey = memLlmProvs[0]?.apiKey;
              if (memLlmKey) {
                const memLlm = createLLMAdapter(session.agentLlmProvider, memLlmKey, session.agentLlmModel);
                const history = session.pipeline.getHistory();
                // Update caller profile (with dropped-call flag)
                await updateCallerProfile({
                  agentId:     call.agentId,
                  phoneNumber: session.callerPhone!,
                  history,
                  llm:         memLlm,
                  existing:    session.callerProfileSnapshot,
                  callId:      session.callId,
                  wasDropped,
                });
                // Detect "call me back in X min" and schedule callback if found
                if (!wasDropped) {
                  await detectCallbackRequest({
                    agentId:  call.agentId,
                    toNumber: session.callerPhone!,
                    history,
                    llm:      memLlm,
                    callId:   session.callId,
                  });
                }
              }
            } catch (memErr) {
              logger.warn({ sessionId, memErr }, "Post-call caller memory update failed");
            }
          })();
        }

        // ── Post-call disposition extraction ─────────────────────────────────
        const dispositionSchema = Array.isArray(ag.dispositionSchema)
          ? (ag.dispositionSchema as Array<{ key: string; label: string; type: string; required?: boolean; options?: string[] }>)
          : [];
        if (dispositionSchema.length > 0 && transcript && transcript.length > 50 && ag.userId) {
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
                const fieldList = dispositionSchema
                  .map(f => `- "${f.key}" (${f.label}, type: ${f.type}${f.options?.length ? `, options: [${f.options.join(", ")}]` : ""})`)
                  .join("\n");
                let raw = "";
                await llm.chat(
                  [{ role: "user", content: `Based on this call transcript, extract the following disposition fields and return valid JSON only (no markdown, no commentary):\n\nFields:\n${fieldList}\n\nTranscript:\n${transcript.slice(0, 8000)}` }],
                  "You extract structured data from call transcripts. Return only a flat JSON object with the specified keys. For boolean fields use true/false. For number fields use numbers. For choice fields use only the specified option values. If a field cannot be determined, use null.",
                  () => {},
                  (full) => { raw = full; }
                );
                if (raw) {
                  try {
                    const jsonStr = raw.replace(/```(?:json)?\s*/gi, "").replace(/```\s*/g, "").trim();
                    const result = JSON.parse(jsonStr);
                    if (result && typeof result === "object" && !Array.isArray(result)) {
                      await db.update(callsTable).set({ dispositionResult: result }).where(eq(callsTable.id, session.callId));
                    }
                  } catch {
                    logger.warn({ sessionId }, "Disposition JSON parse failed");
                  }
                }
              }
            } catch (dispErr) {
              logger.warn({ sessionId, dispErr }, "Post-call disposition extraction failed");
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
