import { createHmac } from "crypto";
import { db, agentsTable, callsTable, providersTable, platformSettingsTable, campaignLeadsTable, knowledgeEntriesTable, callTransfersTable } from "@workspace/db";
import { decryptKey } from "../lib/crypto.js";
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
  /** Inbound call parameters (e.g. Vobiz customParameters) merged into prompt variable resolution */
  customParameters?: Record<string, string>;
  /** Campaign lead ID — if set, lead data is merged into prompt variable resolution */
  campaignLeadId?: number;
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

  // Build effective system prompt with date/time context + strict language enforcement
  const LANG_NAMES: Record<string, string> = {
    "en-US": "English", "en-GB": "English", "en-IN": "English", "en": "English",
    "hi": "Hindi", "ta": "Tamil", "ta-IN": "Tamil",
    "te": "Telugu", "te-IN": "Telugu", "kn": "Kannada", "kn-IN": "Kannada",
    "mr": "Marathi", "mr-IN": "Marathi", "gu": "Gujarati", "gu-IN": "Gujarati",
    "bn": "Bengali", "bn-IN": "Bengali", "ml": "Malayalam", "ml-IN": "Malayalam",
    "es": "Spanish", "es-MX": "Spanish (Mexico)", "fr": "French", "de": "German",
    "it": "Italian", "pt-BR": "Portuguese (Brazil)", "ja": "Japanese",
    "ko": "Korean", "zh": "Mandarin Chinese", "ar": "Arabic",
  };
  const agentTimezone = (agentCfg["timezone"] as string | undefined) || "Asia/Kolkata";
  const nowForCtx = new Date();
  const dateCtxParts = nowForCtx.toLocaleDateString("en-IN", {
    weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: agentTimezone,
  });
  const timeCtxParts = nowForCtx.toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", timeZone: agentTimezone,
  });
  let effectiveSystemPrompt = agent.generatedPrompt ?? agent.systemPrompt;
  effectiveSystemPrompt += `\n\n[DATE/TIME CONTEXT] Today is ${dateCtxParts}. Current time is ${timeCtxParts} (${agentTimezone}).`;
  if (agent.language) {
    const langName = LANG_NAMES[agent.language] ?? agent.language;
    effectiveSystemPrompt += `\n\n[STRICT LANGUAGE RULE] You MUST respond ONLY in ${langName} at ALL times. Never switch to any other language under any circumstances, even if the caller speaks a different language. Always reply in ${langName} regardless of what language the caller uses.`;
  }

  const agentConfig: AgentConfig = {
    id: agent.id,
    name: agent.name,
    systemPrompt: effectiveSystemPrompt,
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
    ambientNoiseEnabled: (agentCfg["ambientNoiseEnabled"] as boolean | undefined) ?? false,
    ambientNoiseTrack: (agentCfg["ambientNoiseTrack"] as string | undefined) ?? null,
    inactivityMessage: agent.inactivityMessage ?? null,
    guardrailRoutes: (agentCfg["guardrailRoutes"] as Array<{ name: string; scoreThreshold: number; utterances: string; response: string }> | undefined) ?? [],
    ivrEnabled: (agentCfg["ivrEnabled"] as boolean | undefined) ?? false,
    ivrGreeting: (agentCfg["ivrGreeting"] as string | undefined) ?? null,
    ivrOptions: (agentCfg["ivrOptions"] as Array<{ digit: string; label: string; targetAgentId?: number }> | undefined) ?? [],
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
    // P1-A: User-defined prompt variables
    promptVariables: Array.isArray(agentCfg["promptVariables"])
      ? (agentCfg["promptVariables"] as Array<{ key: string; defaultValue: string; description?: string }>)
      : [],
    // P1-B: Knowledge Base RAG
    knowledgeBaseId: agent.knowledgeBaseId ?? null,
    // P1-C: Webhook HMAC secret
    webhookSecret: (agentCfg["webhookSecret"] as string | undefined) ?? null,
    // P1-D: VAD / Barge-in tuning (defaults match the hardcoded pipeline constants)
    vadSilenceMs:           (agentCfg["vadSilenceMs"]           as number  | undefined) ?? 250,
    bargeInEnabled:         (agentCfg["bargeInEnabled"]         as boolean | undefined) ?? true,
    bargeInEnergyThreshold: (agentCfg["bargeInEnergyThreshold"] as number  | undefined) ?? 1200,
    bargeInMinFrames:       (agentCfg["bargeInMinFrames"]       as number  | undefined) ?? 4,
    bargeInEchoGraceMs:     (agentCfg["bargeInEchoGraceMs"]    as number  | undefined) ?? 600,
    // P1-E: Agent timezone
    timezone: agentTimezone,
    // P1-F: Caller gender detection
    genderDetectionEnabled:        (agentCfg["genderDetectionEnabled"]        as boolean | undefined) ?? true,
    genderDetectionMaleSalutation: (agentCfg["genderDetectionMaleSalutation"] as string  | undefined) ?? "Sir",
    genderDetectionFemaleSalutation: (agentCfg["genderDetectionFemaleSalutation"] as string | undefined) ?? "Ma'am",
    genderDetectionNeutralSalutation: (agentCfg["genderDetectionNeutralSalutation"] as string | undefined) ?? "",
    // P1-G: Engine — interruption & pacing
    wordsForInterruption: (agentCfg["wordsForInterruption"] as number | undefined) ?? 2,
    incrementalDelay:     (agentCfg["incrementalDelay"]     as number | undefined) ?? 0,
    // P1-H: Call lifecycle
    hangupAfterLlmCall: (agentCfg["hangupAfterLlmCall"] as boolean | undefined) ?? false,
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
  // Priority order (lowest → highest): system defaults < agent promptVariables < inbound customParameters
  const now = new Date();
  // Load campaign lead data if a campaignLeadId was supplied
  let campaignLeadVars: Record<string, string> = {};
  if (params.campaignLeadId) {
    try {
      const [lead] = await db.select().from(campaignLeadsTable).where(eq(campaignLeadsTable.id, params.campaignLeadId));
      if (lead) {
        campaignLeadVars = {
          phone:  lead.phone,
          name:   lead.name  ?? "",
          email:  lead.email ?? "",
          ...lead.leadData,
        };
        logger.info({ campaignLeadId: params.campaignLeadId, phone: lead.phone }, "Campaign lead vars loaded into session");
      }
    } catch (leadErr) {
      logger.warn({ campaignLeadId: params.campaignLeadId, leadErr }, "Failed to load campaign lead — continuing without lead vars");
    }
  }

  const dynVars: Record<string, string> = {
    // System-provided built-in variables
    to_number:     params.toNumber,
    from_number:   params.fromNumber,
    agent_name:    agent.name,
    caller_number: params.fromNumber,
    date: now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
    // P1-A: Agent-level prompt variable defaults (user-defined in agent config)
    ...Object.fromEntries(agentConfig.promptVariables.map(v => [v.key, v.defaultValue])),
    // Campaign lead data overrides agent defaults
    ...campaignLeadVars,
    // P1-A: Inbound call parameters override everything (e.g. Vobiz customParameters)
    ...Object.fromEntries(Object.entries(params.customParameters ?? {}).map(([k, v]) => [k, v])),
  };

  // Replace both {{var}} and {var} — but skip {caller_salutation} (runtime only)
  const resolveVar = (key: string, fullMatch: string): string => {
    if (key === "caller_salutation") return fullMatch;   // deferred to pipeline
    return key in dynVars ? dynVars[key]! : fullMatch;
  };

  agentConfig.systemPrompt = agentConfig.systemPrompt
    .replace(/\{\{(\w+)\}\}/g, (m, k: string) => resolveVar(k, m))
    .replace(/\{(\w+)\}/g,     (m, k: string) => resolveVar(k, m));

  // ── Knowledge base injection ─────────────────────────────────────────────
  if (agent.knowledgeBaseId) {
    try {
      const entries = await db
        .select()
        .from(knowledgeEntriesTable)
        .where(eq(knowledgeEntriesTable.sourceId, agent.knowledgeBaseId))
        .limit(100);
      if (entries.length > 0) {
        const kbBlock = [
          "=== KNOWLEDGE BASE ===",
          "Use the following information to answer questions accurately. Always prefer this over your general training data.",
          "",
          ...entries.map((e: { title: string | null; content: string }) => e.title ? `[${e.title}]\n${e.content}` : e.content),
          "=== END KNOWLEDGE BASE ===",
        ].join("\n\n");
        agentConfig.systemPrompt = `${kbBlock}\n\n${agentConfig.systemPrompt}`;
        logger.info(
          { agentId: params.agentId, knowledgeBaseId: agent.knowledgeBaseId, entryCount: entries.length },
          "Knowledge base injected into system prompt"
        );
      }
    } catch (kbErr) {
      logger.warn({ agentId: params.agentId, knowledgeBaseId: agent.knowledgeBaseId, kbErr }, "Failed to load knowledge base — continuing without it");
    }
  }

  // Scope provider keys to this agent's owner; fall back to all active if agent has no userId
  const providerRows = agent.userId
    ? await db.select().from(providersTable).where(
        and(eq(providersTable.isActive, true), eq(providersTable.userId, agent.userId))
      )
    : await db.select().from(providersTable).where(eq(providersTable.isActive, true));
  const providerKeys = new Map<string, string>();
  for (const row of providerRows) {
    providerKeys.set(row.providerName.toLowerCase(), decryptKey(row.apiKey));
    if (row.extraConfig) providerKeys.set(`${row.providerName.toLowerCase()}:extraConfig`, row.extraConfig);
  }

  // ── Managed-key fallback ────────────────────────────────────────────────────
  // If the agent owner hasn't configured a key for a required provider, fall
  // back to the platform-level managed keys set by the admin.  This enables the
  // "Managed" mode: the platform operator's keys serve all users transparently.
  async function getPlatformSetting(key: string): Promise<string | null> {
    const [row] = await db.select().from(platformSettingsTable).where(eq(platformSettingsTable.key, key));
    return row?.value ?? null;
  }

  // Provider name → platform_settings key.
  // Google/Gemini are intentionally omitted: their API requires a dedicated
  // Google Cloud API key; mapping them to managed_qwen_key (Groq) is wrong.
  const MANAGED: Record<string, string> = {
    qwen:     "managed_qwen_key",
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
        const managed = await getPlatformSetting(MANAGED[providerName]!);
        if (managed) {
          providerKeys.set(providerName, managed);
          logger.info({ providerName, isManaged }, "Using platform managed key for provider");
        }
      }
    }
  }

  // Vobiz telephony managed fallback (authToken + authId stored separately)
  if (!providerKeys.has("vobiz")) {
    const [authToken, authId] = await Promise.all([
      getPlatformSetting("managed_vobiz_auth_token"),
      getPlatformSetting("managed_vobiz_auth_id"),
    ]);
    if (authToken && authId) {
      providerKeys.set("vobiz", authToken);
      // Preserve any existing extraConfig (e.g. fromNumber) — set authId only
      const existing = providerKeys.get("vobiz:extraConfig");
      const cfg = existing ? JSON.parse(existing) as Record<string, string> : {};
      if (!cfg["authId"]) cfg["authId"] = authId;
      providerKeys.set("vobiz:extraConfig", JSON.stringify(cfg));
      logger.info({}, "Using platform managed VoBiz credentials");
    }
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
    callerPhone,
    onAudioOut: params.onAudioOut,
    rawPcmOutput: params.telephonyProvider === "vobiz",
    onTranscript: (speaker, text) => {
      logger.debug({ callId: callRecord.id, speaker, text: text.slice(0, 80) }, "Transcript");
    },
    onCallEnd: () => {
      naturalEndTriggered = true;
      params.onCallEnd();
    },
    onCallTransfer: (to, operatorSummary?) => {
      wasTransferred = true;
      transferredTo = to;
      const isWarm = !!operatorSummary;
      logger.info({ callId: callRecord.id, transferTo: to, warm: isWarm }, "Call transfer initiated");
      void patchSessionMeta(sessionId, { wasTransferred: true, transferredTo: to }, redisTtl);

      // Execute the actual provider-level call redirect
      void (async () => {
        try {
          if (!params.externalCallId) {
            logger.warn({ callId: callRecord.id }, "Transfer: no externalCallId — cannot redirect call");
            return;
          }
          const domains = process.env["REPLIT_DOMAINS"];
          const baseUrl = domains
            ? `https://${domains.split(",")[0]!.trim()}`
            : `http://localhost:${process.env["PORT"] ?? "8080"}`;

          // ── For warm_summary mode: persist summary + get transferId for whisper URL ──
          let transferId: number | undefined;
          if (isWarm && agent.userId) {
            try {
              const [row] = await db.insert(callTransfersTable).values({
                callId:   callRecord.id,
                userId:   agent.userId,
                transferTo: to,
                summary:  operatorSummary,
                status:   "initiated",
              }).returning({ id: callTransfersTable.id });
              transferId = row?.id;
              logger.info({ callId: callRecord.id, transferId }, "Warm transfer: DB record created");
            } catch (err) {
              logger.error({ callId: callRecord.id, err }, "Warm transfer: failed to persist summary — falling back to cold");
            }
          }

          const {
            transferTwilioCall, buildTwilioWarmTransferTwiML,
            transferPlivoCall,  buildPlivoWarmTransferXml,
            transferVobizCall,  buildVobizWarmTransferXml,
          } = await import("./telephony/transfer.js");
          const tprov = params.telephonyProvider;

          if (tprov === "twilio") {
            const authToken = providerKeys.get("twilio") ?? "";
            const extra = providerKeys.get("twilio:extraConfig");
            const cfg = extra ? (JSON.parse(extra) as Record<string, string>) : {};
            const accountSid = cfg["accountSid"] ?? "";
            let xmlUrl: string;
            if (isWarm && transferId) {
              xmlUrl = `${baseUrl}/api/webhooks/twilio/warm-transfer-xml?target=${encodeURIComponent(to)}&transferId=${transferId}`;
            } else {
              xmlUrl = `${baseUrl}/api/webhooks/twilio/transfer-xml?target=${encodeURIComponent(to)}`;
            }
            await transferTwilioCall({ accountSid, authToken, callSid: params.externalCallId, xmlUrl });
          } else if (tprov === "plivo") {
            const authToken = providerKeys.get("plivo") ?? "";
            const extra = providerKeys.get("plivo:extraConfig");
            const cfg = extra ? (JSON.parse(extra) as Record<string, string>) : {};
            const authId = cfg["authId"] ?? "";
            let xmlUrl: string;
            if (isWarm && transferId) {
              xmlUrl = `${baseUrl}/api/webhooks/plivo/warm-transfer-xml?target=${encodeURIComponent(to)}&transferId=${transferId}`;
            } else {
              xmlUrl = `${baseUrl}/api/webhooks/plivo/transfer-xml?target=${encodeURIComponent(to)}`;
            }
            await transferPlivoCall({ authId, authToken, callUuid: params.externalCallId, xmlUrl });
          } else if (tprov === "vobiz") {
            const authToken = providerKeys.get("vobiz") ?? "";
            const extra = providerKeys.get("vobiz:extraConfig");
            const cfg = extra ? (JSON.parse(extra) as Record<string, string>) : {};
            const authId = cfg["authId"] ?? "";
            let xmlUrl: string;
            if (isWarm && transferId) {
              xmlUrl = `${baseUrl}/api/webhooks/vobiz/warm-transfer-xml?target=${encodeURIComponent(to)}&transferId=${transferId}`;
            } else {
              xmlUrl = `${baseUrl}/api/webhooks/vobiz/transfer-xml?target=${encodeURIComponent(to)}`;
            }
            await transferVobizCall({ authId, authToken, callUuid: params.externalCallId, xmlUrl });
          }
          // suppress unused-import warnings for builders not used via direct call
          void buildPlivoWarmTransferXml; void buildVobizWarmTransferXml;
        } catch (err) {
          logger.error({ callId: callRecord.id, err }, "Provider call transfer API failed");
        }
      })();
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
    onFatalError: (reason) => {
      void failSession(sessionId, reason);
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

/**
 * P2-A: Trigger a call transfer on an active session.
 * - "cold": immediately redirects via VoBiz REST API
 * - "warm": speaks a handoff message first, then redirects
 * Returns true if transfer was initiated, false if session not found.
 */
export async function triggerTransfer(
  callDbId: number,
  type: "warm" | "cold",
  target: string,
  warmMessage: string,
  xmlCallbackUrl: string,
  vobizAuthId: string,
  vobizAuthToken: string,
): Promise<boolean> {
  const { transferVobizCall } = await import("./telephony/transfer.js");

  // Find the active session
  let sessionId: string | null = null;
  let externalCallId: string | null = null;
  for (const [sid, s] of sessions.entries()) {
    if (s.callId === callDbId) {
      sessionId = sid;
      break;
    }
  }

  // Get the external call UUID from the call record metadata
  const [callRow] = await db.select({ metadata: callsTable.metadata })
    .from(callsTable).where(eq(callsTable.id, callDbId));
  if (callRow?.metadata) {
    try {
      const meta = JSON.parse(callRow.metadata) as Record<string, unknown>;
      externalCallId = (meta["externalCallId"] ?? meta["providerCallId"]) as string | null ?? null;
    } catch { /* ok */ }
  }

  if (!externalCallId) {
    logger.warn({ callDbId }, "Transfer: no external call ID found in call metadata");
    return false;
  }

  // Warm transfer: speak handoff message via pipeline before redirecting
  if (type === "warm" && sessionId) {
    const session = sessions.get(sessionId);
    if (session) {
      try {
        await session.pipeline.speakRaw(warmMessage);
      } catch (err) {
        logger.warn({ sessionId, err }, "Transfer: warm handoff TTS failed — proceeding with cold redirect");
      }
    }
  }

  // Execute VoBiz transfer
  await transferVobizCall({
    authId: vobizAuthId,
    authToken: vobizAuthToken,
    callUuid: externalCallId,
    xmlUrl: xmlCallbackUrl,
  });

  // Mark session as transferred
  if (sessionId) {
    const session = sessions.get(sessionId);
    if (session) {
      void patchSessionMeta(sessionId, { wasTransferred: true, transferredTo: target },
        (session.pipeline as any).config?.agentConfig?.maxDuration ?? 600 + 600);
    }
  }

  return true;
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
      // ── Record per-service usage events (STT / LLM / TTS) ────────────────────
      if (ag) {
        const { recordUsage } = await import("../services/usage/record-usage.js");
        const turns = metricsAcc.count;
        // A connected call that produced zero turns indicates a pipeline failure
        // (STT never produced text, LLM never replied, or TTS never spoke).
        // Always emit one event per service so error_spike/provider_down alerting
        // sees real failures even when no turns succeeded.
        const success = turns > 0;
        const errorMessage = success ? null : "no_turns_completed";
        const safeDuration = Math.max(durationSeconds, 0);
        // Prefer real token/char totals tallied during the call when the pipeline
        // exposes them; fall back to a turn-count estimate so per-event cost stays
        // monotonic until every provider adapter reports real metrics.
        const pipelineAny = session.pipeline as unknown as {
          getUsageTotals?: () => { llmInputTokens?: number; llmOutputTokens?: number; ttsCharacters?: number };
        };
        const llmUsage = pipelineAny.getUsageTotals?.() ?? null;
        const ttsChars = llmUsage?.ttsCharacters ?? Math.max(turns, 1) * 220;
        const inputTokens = llmUsage?.llmInputTokens ?? Math.max(turns, 1) * 200;
        const outputTokens = llmUsage?.llmOutputTokens ?? Math.max(turns, 1) * 60;

        void recordUsage({
          service: "stt",
          provider: ag.asrProvider,
          model: ag.asrModel,
          userId: ag.userId ?? null,
          callId: call.id,
          audioSeconds: safeDuration,
          latencyMs: avgSttMs,
          success,
          errorMessage,
        });
        void recordUsage({
          service: "llm",
          provider: ag.llmProvider,
          model: ag.llmModel,
          userId: ag.userId ?? null,
          callId: call.id,
          inputTokens,
          outputTokens,
          latencyMs: avgLlmMs,
          success,
          errorMessage,
        });
        void recordUsage({
          service: "tts",
          provider: ag.ttsProvider,
          model: ag.ttsModel,
          userId: ag.userId ?? null,
          callId: call.id,
          characters: ttsChars,
          latencyMs: avgTtsMs,
          success,
          errorMessage,
        });
      }
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

        // ── Post-call AI summary + disposition + webhook (sequential, one async block) ──
        // Running them in sequence ensures the webhook payload includes the final
        // callSummary and dispositionResult produced by the LLM in this same block.
        const dispositionSchema = Array.isArray(ag.dispositionSchema)
          ? (ag.dispositionSchema as Array<{ key: string; label: string; type: string; required?: boolean; options?: string[] }>)
          : [];
        const agCfgForWebhook = (ag.agentConfig ?? {}) as Record<string, unknown>;
        const webhookSecret = agCfgForWebhook["webhookSecret"] as string | undefined;

        void (async () => {
          let callSummary = "";
          let dispositionResult: Record<string, unknown> | null = null;

          // 1. Generate call summary (only when agent has summarization enabled)
          const summarizationEnabled = (agCfgForWebhook["summarizationEnabled"] as boolean | undefined) ?? false;
          if (summarizationEnabled && transcript && transcript.length > 100 && ag.userId) {
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
                const customPrompt = (agCfgForWebhook["summarizationPrompt"] as string | undefined) ?? "";
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
                  callSummary = summary;
                  await db.update(callsTable).set({ callSummary: summary }).where(eq(callsTable.id, session.callId));
                }
              }
            } catch (summaryErr) {
              logger.warn({ sessionId, summaryErr }, "Post-call summary generation failed");
            }
          }

          // 2. Extract disposition
          if (dispositionSchema.length > 0 && transcript && transcript.length > 50 && ag.userId) {
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
                      dispositionResult = result as Record<string, unknown>;
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
          }

          // 3. Evaluate call success against agent's success criteria (if configured)
          const agentCfgForEval = (ag.agentConfig ?? {}) as Record<string, unknown>;
          const successCriteria = agentCfgForEval["successCriteria"] as string | undefined;
          if (successCriteria?.trim() && transcript && transcript.length > 50 && ag.userId) {
            try {
              const evalLlmProvs = await db.select().from(providersTable).where(
                and(
                  eq(providersTable.isActive, true),
                  eq(providersTable.userId, ag.userId!),
                  eq(providersTable.providerName, ag.llmProvider)
                )
              );
              const evalLlmKey = evalLlmProvs[0]?.apiKey;
              if (evalLlmKey) {
                const evalLlm = createLLMAdapter(ag.llmProvider, evalLlmKey, ag.llmModel);
                let evalRaw = "";
                await evalLlm.chat(
                  [{ role: "user", content: `Success criteria: ${successCriteria}\n\nCall transcript:\n${transcript.slice(0, 6000)}\n\nDid this call meet the success criteria? Reply with PASS or FAIL on the first line, then one sentence of explanation.` }],
                  "You evaluate whether a voice call met predefined success criteria. Be objective and concise. Start your response with PASS or FAIL.",
                  () => {},
                  (full) => { evalRaw = full; }
                );
                if (evalRaw.trim()) {
                  await db.update(callsTable).set({ successEvaluation: evalRaw.trim() }).where(eq(callsTable.id, session.callId));
                  logger.info({ sessionId, verdict: evalRaw.trim().slice(0, 60) }, "Post-call success evaluation complete");
                }
              }
            } catch (evalErr) {
              logger.warn({ sessionId, evalErr }, "Post-call success evaluation failed");
            }
          }

          // 4. Fire webhook with complete enriched payload
          if (ag.webhookUrl) {
            const webhookPayload = {
              callId:           session.callId,
              agentId:          ag.id,
              agentName:        ag.name,
              status:           callStatus,
              fromNumber:       call.fromNumber,
              toNumber:         call.toNumber,
              durationSeconds,
              transcript:       transcript || null,
              callSummary:      callSummary || null,
              dispositionResult,
              recordingUrl:     recordingUrl ?? null,
              avgSttLatencyMs:  avgSttMs,
              avgLlmLatencyMs:  avgLlmMs,
              avgTtsLatencyMs:  avgTtsMs,
              endedAt:          endedAt.toISOString(),
            };
            const bodyStr = JSON.stringify(webhookPayload);
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (webhookSecret) {
              headers["X-VoiceOrch-Signature"] =
                "sha256=" + createHmac("sha256", webhookSecret).update(bodyStr, "utf8").digest("hex");
            }
            fetch(ag.webhookUrl, { method: "POST", headers, body: bodyStr }).catch((err) => {
              logger.error({ sessionId, webhookUrl: ag.webhookUrl, err }, "Webhook delivery failed");
            });
          }
        })();

        // ── Post-call caller memory update + callback detection (fire-and-forget) ──
        if (session.callerPhone && transcript && transcript.length > 50) {
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
                await updateCallerProfile({
                  agentId:     call.agentId,
                  phoneNumber: session.callerPhone!,
                  history,
                  llm:         memLlm,
                  existing:    session.callerProfileSnapshot,
                  callId:      session.callId,
                  wasDropped,
                });
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
