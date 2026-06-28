import { createHmac, createHash, randomBytes } from "crypto";
import { getSelfBaseUrl } from "../lib/app-domain.js";
import { db, agentsTable, callsTable, providersTable, platformSettingsTable, campaignLeadsTable, knowledgeEntriesTable, callTransfersTable, usersTable, walletTransactionsTable, bookingsTable, scheduledCallbacksTable, campaignsTable } from "@workspace/db";
import { createExecutionLogger, writeCallEndedLog, writeCallStartedLog, logRecordingEvent, EXEC_COMPONENTS } from "../services/execution-log.js";
import { getFlatRateCentsPerMin, resolveAgentBillingMode } from "../services/minute-rates.js";
import { getAttachedSourceIds, buildKnowledgeBaseBlock } from "./kb-retrieval.js";
import { decryptKey } from "../lib/crypto.js";
import { eq, and, sql, inArray } from "drizzle-orm";
import { OrchestrationPipeline } from "./pipeline.js";
import { withDbRetry } from "./db-retry.js";
import { CONVERSATION_DISCIPLINE_BLOCK } from "./conversationDiscipline.js";
import { resolvePromptVariables } from "./prompt-vars.js";
import { createLLMAdapter } from "./adapters/llm/index.js";
import type { AgentConfig, AgentTool, TelephonyProvider, SessionTransport, PipelineMetrics } from "./types.js";
import { logger } from "../lib/logger.js";
import {
  saveSessionMeta,
  patchSessionMeta,
  saveConversation,
  removeSession,
} from "./sessionStore.js";
import { destroyAudioSession } from "./audioPool.js";
import { disposeCall } from "../services/disposition.js";
import { computeOperationalOutcome, setOperationalOutcome } from "../services/operational-outcome.js";
import { appendTraiDisclosure, scanForOptOut } from "../services/trai/index.js";
import { appendDpdpDisclosure, scanAndRedactPII } from "../services/dpdp/index.js";
import { appendIrdaiAiDisclosure } from "../services/irdai/index.js";
import { scheduleNoAnswerRedial } from "../services/autoRedial.js";
import { recordCallExecution } from "./campaignCaller.js";
import {
  humanPhone,
  canonicalizeCallerKey,
  loadCallerProfile,
  loadCallerContext,
  injectCallerMemory,
  injectEnhancedMemory,
  computePersonaHash,
  updateCallerProfile,
  latchCallerName,
  latchCallerFact,
  detectCallbackRequest,
  type CallerProfile,
  type CallerContext,
} from "./callerMemory.js";


interface MetricsAcc {
  sttTotal: number;
  llmTotal: number;
  ttsTotal: number;
  count: number;
}

interface ActiveSession {
  callId: number;
  agentId: number;
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
  campaignLeadId: number | null;        // re-attached to the lead when a callback is scheduled
  // Dropped-call detection: true when pipeline triggered the end (phrase/timeout/tool)
  // false means WS just closed — i.e. call was likely dropped mid-conversation
  naturalEndTriggered: boolean;
  /** Name latched mid-call via latchCallerName (caller said "my name is X").
   *  Used to guard against LLM-extraction contamination at call-end. */
  callerNameLatchedThisCall: string | null;
  /** Agent persona fingerprint at call start — written to caller memory at
   *  call-end so future calls can detect a persona swap (whiplash guard). */
  personaHash: string;
}

const sessions = new Map<string, ActiveSession>();

export async function createSession(params: {
  agentId: number;
  telephonyProvider: SessionTransport;
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
  /** Forwards every finalized transcript line (user + agent) to the transport so a
   *  browser webcall can render a live transcript. Telephony callers omit it. */
  onTranscript?: (speaker: "user" | "agent", text: string) => void;
  /** Overrides the default audio-format derivation. When omitted, PCM output is
   *  used for Vobiz only. The browser webcall transport sets this true. */
  rawPcmOutput?: boolean;
  /** When true, the session runs in voicemail-delivery mode instead of the normal
   *  conversation pipeline: it waits for the answering machine's greeting to end
   *  (acoustic VAD cue) then speaks the agent's configured `voicemailMessage` once
   *  in full and hangs up. Used by the Vobiz AMD `leave_message` path. */
  voicemailDelivery?: boolean;
}): Promise<{ sessionId: string; callDbId: number }> {

  // Browser "Live Test" transport — labels the call record + lifecycle log so the
  // calls log can distinguish test calls, and forces PCM audio I/O.
  const isWebcall = params.telephonyProvider === "webcall";

  const [agent] = await withDbRetry("load-agent", () =>
    db.select().from(agentsTable).where(eq(agentsTable.id, params.agentId)),
  );
  if (!agent) {
    // Genuinely missing agent — fatal, not transient. Surface clearly so the
    // telephony handler logs an explicit reason instead of a bare ws.close().
    logger.error({ agentId: params.agentId }, "Session setup aborted — agent not found");
    throw new Error(`Agent ${params.agentId} not found`);
  }

  // ── Concurrent call limit (per user, hard ceiling = 15) ──────────────────
  if (agent.userId) {
    const [user] = await withDbRetry("load-user-concurrent-limit", () =>
      db
        .select({ concurrentLimit: usersTable.concurrentLimit })
        .from(usersTable)
        .where(eq(usersTable.clerkId, agent.userId!)),
    );
    const effectiveLimit = user?.concurrentLimit ?? 15;
    const activeForUser = Array.from(sessions.values()).filter(
      s => s.agentUserId === agent.userId,
    ).length;
    if (activeForUser >= effectiveLimit) {
      throw new Error(
        `Concurrent call limit reached (${effectiveLimit}). Wait for an active call to finish.`,
      );
    }
  }

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
  // True when the agent is configured to follow the caller's language mid-call
  // (any secondary language set, or explicit languageAutoDetect flag).
  const isMultilingual =
    (Array.isArray(agentCfg["secondaryLanguages"]) && (agentCfg["secondaryLanguages"] as string[]).length > 0) ||
    agentCfg["languageAutoDetect"] === true;
  {
    // Prefer asrLanguage (the language the caller actually speaks) over the
    // agent's generic language field for enforcement. This prevents the
    // "en-US" default in agent.language from overriding an explicitly-
    // configured Tamil/Hindi ASR language with an "English only" rule.
    const agentLang = agent.asrLanguage ?? agent.language;
    if (agentLang) {
      const langName = LANG_NAMES[agentLang] ?? agentLang;
      if (isMultilingual) {
        // Auto-detect mode: follow the caller's language; switch seamlessly when they do.
        effectiveSystemPrompt += `\n\n[LANGUAGE RULE] Your primary language is ${langName}. Always follow the caller's language — if they speak Tamil, reply in Tamil; if they switch to English, reply in English; if they mix languages (e.g. Hinglish), match their mix naturally. EXCEPTION — keep all proper nouns (brand names, product names, company names, people's names) EXACTLY as written in your instructions; never translate or transliterate them.`;
      } else {
        // Strict mode: single language, no switching.
        effectiveSystemPrompt += `\n\n[STRICT LANGUAGE RULE] You MUST respond ONLY in ${langName} at ALL times. Never switch to any other language under any circumstances, even if the caller speaks a different language. Always reply in ${langName} regardless of what language the caller uses. EXCEPTION — keep all proper nouns (brand names, product names, company names, and people's names) EXACTLY as written in your instructions; never translate, localize, or transliterate them, even when part of a name resembles a common ${langName} word.`;
      }
    }
  }

  // Auto-switch to English: when enabled, allow the agent to move to English mid-call on request.
  if (agentCfg["autoSwitchToEnglish"] === true) {
    effectiveSystemPrompt += `\n\nIf the caller asks you to speak in English, switch immediately and continue in English.`;
  }

  // TTS output formatting — always injected so the LLM never produces patterns that
  // cause text-to-speech to spell out letters (e.g. "T. Nagar" → T N A G A R).
  effectiveSystemPrompt += `\n\n[TTS OUTPUT RULES — MANDATORY] Your responses are spoken aloud by a TTS engine. Follow these rules strictly:
- Never use abbreviated place names with periods. Write "T Nagar" not "T. Nagar", "RK Salai" not "R.K. Salai", "MG Road" not "M.G. Road".
- Never use ALL-CAPS words or acronyms (AMD, STT, LLM etc.) — write them in lowercase or spell them out naturally.
- Never use markdown: no asterisks, hashes, bullet points, numbered lists, or underscores.
- NEVER use XML or SSML markup tags of any kind. Do NOT write <emotion>, </emotion>, <break>, <prosody>, or any similar tags — the TTS engine will speak them aloud literally as "less-than emotion greater-than".
- Use only plain conversational sentences suitable for speech.`;

  // Conversation discipline — force one-step-at-a-time delivery, turn yielding
  // on "wait for response" markers, and resume-after-objection place-keeping.
  effectiveSystemPrompt += `\n\n${CONVERSATION_DISCIPLINE_BLOCK}`;

  // P1-K: Inject regulatory compliance disclosures into the system prompt
  const complianceCfg = agentCfg["compliance"] as { irdai?: boolean; dpdp?: boolean; trai?: boolean } | undefined;
  if (complianceCfg?.dpdp) {
    effectiveSystemPrompt = appendDpdpDisclosure(effectiveSystemPrompt);
  }
  if (complianceCfg?.trai) {
    effectiveSystemPrompt = appendTraiDisclosure(effectiveSystemPrompt);
  }
  // IRDAI/RBI mandatory AI-identity disclosure. Applied last so it sits closest
  // to the conversation context (where modern LLMs weight it most strongly).
  // The insurer name is taken from the agent's IRDAI-specific config field;
  // falls back to the agent name, then a generic "the company" sentinel.
  if (complianceCfg?.irdai) {
    const irdaiInsurer = (agentCfg["irdaiInsurerName"] as string | undefined) ?? agent.name ?? null;
    effectiveSystemPrompt = appendIrdaiAiDisclosure(effectiveSystemPrompt, irdaiInsurer);
  }

  const agentConfig: AgentConfig = {
    id: agent.id,
    name: agent.name,
    systemPrompt: effectiveSystemPrompt,
    temperature: agent.temperature ?? 0.5,
    // Resolved generation params for the LLM adapter (currently Sarvam-only).
    // Use the RAW DB temperature (not the ?? 0.5 fallback) so the provider keeps
    // its own default when the agent has not explicitly set one. The remaining
    // fields live in the agent_config JSON blob; only defined values are carried.
    llmGenerationParams: {
      ...(typeof agent.temperature === "number" ? { temperature: agent.temperature } : {}),
      ...(typeof (agentCfg["llmMaxTokens"] ?? agentCfg["maxTokens"]) === "number" ? { maxTokens: (agentCfg["llmMaxTokens"] ?? agentCfg["maxTokens"]) as number } : {}),
      ...(typeof agentCfg["topP"] === "number" ? { topP: agentCfg["topP"] as number } : {}),
      // Repetition guard: OpenAI-compatible LLMs (incl. Sarvam) default these to 0,
      // which at low temperature lets the model emit byte-identical replies turn
      // after turn (call 548 looped on repeated "yes"). Apply a mild 0.3 default
      // when the agent hasn't set one; an explicit value (including 0) is honored.
      presencePenalty: typeof agentCfg["presencePenalty"] === "number" ? agentCfg["presencePenalty"] as number : 0.3,
      frequencyPenalty: typeof agentCfg["frequencyPenalty"] === "number" ? agentCfg["frequencyPenalty"] as number : 0.3,
      ...(typeof agentCfg["seed"] === "number" ? { seed: agentCfg["seed"] as number } : {}),
      ...(typeof agentCfg["stop"] === "string" || Array.isArray(agentCfg["stop"]) ? { stop: agentCfg["stop"] as string | string[] } : {}),
      ...(typeof agentCfg["wikiGrounding"] === "boolean" ? { wikiGrounding: agentCfg["wikiGrounding"] as boolean } : {}),
      ...(agentCfg["reasoningEffort"] === null || ["low", "medium", "high"].includes(agentCfg["reasoningEffort"] as string)
        ? { reasoningEffort: agentCfg["reasoningEffort"] as "low" | "medium" | "high" | null }
        : {}),
    },
    maxDuration: agent.maxDuration ?? 600,
    asrProvider: agent.asrProvider,
    asrModel: agent.asrModel,
    llmProvider: agent.llmProvider,
    llmModel: agent.llmModel,
    fallbackLlmProvider: agent.llmFallbackProvider ?? null,
    fallbackLlmModel: agent.llmFallbackModel ?? null,
    ttsProvider: agent.ttsProvider,
    ttsVoice: agent.ttsVoice,
    ttsModel: agent.ttsModel,
    telephonyProvider: agent.telephonyProvider,
    greetingMessage: agent.greetingMessage ?? null,
    firstSpeaker: agent.firstSpeaker === "user" ? "user" : "assistant",
    endCallPhrases,
    silenceTimeoutSeconds: agent.silenceTimeoutSeconds ?? null,
    // Mirror the STT language resolution (asrLanguage first) so AgentConfig.language —
    // which drives the pipeline's [LANGUAGE — ABSOLUTE RULE] block — agrees with STT,
    // the [STRICT LANGUAGE RULE], and TTS instead of contradicting them (call 548).
    language: agent.asrLanguage || agent.language || null,
    languageAutoDetect: isMultilingual,
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
      language: agent.asrLanguage || agent.language || null,
      backgroundDenoising: agent.asrBackgroundDenoising ?? false,
      confidenceThreshold: agent.asrConfidenceThreshold ?? 0.40,
      endOfTurnConfidence: agent.asrEndOfTurnConfidence ?? 0.70,
      endOfTurnTimeout: agent.asrEndOfTurnTimeout ?? 5000,
      keyterms: agent.asrKeyterms
        ? agent.asrKeyterms.split(",").map(s => s.trim()).filter(Boolean)
        : [],
      smartEndpointing: agent.asrSmartEndpointing ?? "off",
      autoFallback: agent.asrAutoFallback ?? false,
      fallbackProviders: (agent.asrFallbackProviders as Array<{ provider: string; model: string | null }> | null | undefined) ?? [],
    },
    tools,
    // P1-A: User-defined prompt variables
    promptVariables: Array.isArray(agentCfg["promptVariables"])
      ? (agentCfg["promptVariables"] as Array<{ key: string; defaultValue: string; description?: string }>)
      : [],
    // P1-B: Knowledge Base RAG
    knowledgeBaseId: agent.knowledgeBaseId ?? null,
    knowledgeSourceIds: await getAttachedSourceIds(agent.id, agent.knowledgeBaseId),
    // P1-C: Webhook HMAC secret
    webhookSecret: (agentCfg["webhookSecret"] as string | undefined) ?? null,
    // P1-D: VAD / Barge-in tuning (defaults match the hardcoded pipeline constants)
    vadSilenceMs:           (agentCfg["vadSilenceMs"]           as number  | undefined) ?? 150,
    bargeInEnabled:         (agentCfg["bargeInEnabled"]         as boolean | undefined) ?? true,
    bargeInEnergyThreshold: (agentCfg["bargeInEnergyThreshold"] as number  | undefined) ?? 1200,
    bargeInMinFrames:       (agentCfg["bargeInMinFrames"]       as number  | undefined) ?? 4,
    bargeInEchoGraceMs:     (agentCfg["bargeInEchoGraceMs"]    as number  | undefined) ?? 600,
    // P1-E: Agent timezone
    timezone: agentTimezone,
    // Call recording
    recordingEnabled:              (agentCfg["recordingEnabled"]              as boolean | undefined) ?? false,
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
    // P1-I: Start Speaking Plan
    startSpeakingPlan: (agentCfg["startSpeakingPlan"] as AgentConfig["startSpeakingPlan"]) ?? null,
    // P1-J: Stop Speaking Plan
    stopSpeakingPlan: (agentCfg["stopSpeakingPlan"] as AgentConfig["stopSpeakingPlan"]) ?? null,
    // P1-K: Compliance
    compliance: (agentCfg["compliance"] as AgentConfig["compliance"]) ?? null,
    // Token Optimization
    contextWindowTurns: agent.contextWindowTurns ?? null,
    tokenSummarizationEnabled: agent.tokenSummarizationEnabled ?? false,
    tokenSummarizationThresholdTurns: agent.tokenSummarizationThresholdTurns ?? null,
    stagedPromptEnabled: agent.stagedPromptEnabled ?? false,
    stagedPromptStages: (agent.stagedPromptStages as Array<{ name: string; content: string }> | null) ?? [],
    stagedPromptCoreIdentity: agent.stagedPromptCoreIdentity ?? null,
    // Latency tuning
    asrEndpointingSilenceMs: (agentCfg["asrEndpointingSilenceMs"] as number | undefined) ?? 100,
    llmMaxTokens: (agentCfg["llmMaxTokens"] as number | null | undefined) ?? null,
    ttsMinSentenceChars: (agentCfg["ttsMinSentenceChars"] as number | undefined) ?? 15,
  };
  // Propagate endpointing silence into STTConfig so Azure adapter picks it up
  agentConfig.sttConfig.endpointingSilenceMs = agentConfig.asrEndpointingSilenceMs;

  // ── Parallel pre-fetch: caller memory + campaign lead + knowledge base ───────
  // All three are independent DB reads — fire simultaneously to avoid sequential
  // round-trips that add 20-60 ms to call setup latency.
  // For webcall sessions fromNumber is "webcall-user-<userId>" which humanPhone()
  // rejects (not a real phone number). Use it as a stable synthetic identifier so
  // caller memory is captured per-user-id, matching the historical "webcall:user_<id>"
  // format already in the DB. Real-phone callers are unaffected.
  // canonicalizeCallerKey is the SINGLE source of truth for the memory key — the
  // same function the write path uses — so read and write can never drift again.
  // humanPhone already canonicalizes real numbers; for web calls fall back to the
  // synthetic identity, which canonicalizeCallerKey maps to "webcall:user_<id>".
  const callerPhone = canonicalizeCallerKey(
    humanPhone(params.fromNumber, params.toNumber) ??
      (params.fromNumber.startsWith("webcall-user-") ? params.fromNumber : null),
  );
  // Persona fingerprint for caller-memory whiplash detection: when the agent is
  // repurposed (e.g. real-estate → insurance), stale domain memory keyed on
  // (agentId, phone) must not bleed into the new persona. Derived from the RAW
  // system prompt, not effectiveSystemPrompt (which varies per call).
  const personaHash = computePersonaHash(agent.systemPrompt);
  let callerProfileSnapshot: CallerProfile | null = null;
  let latchedFactsMap = new Map<string, string>();
  // Tracks the name latched THIS call via latchCallerName (caller said "my name is X").
  // Kept separate from callerProfileSnapshot.name so we can detect contamination at call-end.
  let callerNameLatchedThisCall: string | null = null;

  const [callerCtxResult, campaignLeadResult, kbEntriesResult, providerRowsResult] = await Promise.all([
    // 1. Caller memory (3-layer: profile + facts + archive)
    callerPhone
      ? loadCallerContext(params.agentId, callerPhone, personaHash).catch((memErr) => {
          logger.warn({ agentId: params.agentId, callerPhone, memErr }, `Failed to load caller context — ${memErr instanceof Error ? memErr.message : String(memErr)} — continuing without memory`);
          return null;
        })
      : Promise.resolve(null),

    // 2. Campaign lead variables
    params.campaignLeadId
      ? db.select().from(campaignLeadsTable).where(eq(campaignLeadsTable.id, params.campaignLeadId))
          .then(([lead]) => lead ?? null)
          .catch((leadErr) => {
            logger.warn({ campaignLeadId: params.campaignLeadId, leadErr }, "Failed to load campaign lead — continuing without lead vars");
            return null;
          })
      : Promise.resolve(null),

    // 3. Knowledge base (all attached sources)
    agentConfig.knowledgeSourceIds.length > 0
      ? buildKnowledgeBaseBlock(agentConfig.knowledgeSourceIds).catch((kbErr) => {
          logger.warn({ agentId: params.agentId, knowledgeSourceIds: agentConfig.knowledgeSourceIds, kbErr }, "Failed to load knowledge base — continuing without it");
          return null;
        })
      : Promise.resolve(null),

    // 4. Provider API keys — independent of above, fetch in parallel
    agent.userId
      ? db.select().from(providersTable).where(
          and(eq(providersTable.isActive, true), eq(providersTable.userId, agent.userId))
        ).catch((provErr) => {
          logger.warn({ agentId: params.agentId, provErr }, "Failed to load provider keys — continuing without user keys");
          return [] as Array<typeof providersTable.$inferSelect>;
        })
      : Promise.resolve([] as Array<typeof providersTable.$inferSelect>),
  ]);

  // Apply caller memory to system prompt
  if (callerCtxResult) {
    callerProfileSnapshot = callerCtxResult.profile;
    for (const f of callerCtxResult.facts) latchedFactsMap.set(f.key, f.value);
    if (callerProfileSnapshot || callerCtxResult.facts.length > 0 || callerCtxResult.recentCalls.length > 0) {
      agentConfig.systemPrompt = injectEnhancedMemory(agentConfig.systemPrompt, callerCtxResult);
      {
        const _LNAMES: Record<string, string> = {
          "hi-IN": "Hindi", "ta-IN": "Tamil", "te-IN": "Telugu", "kn-IN": "Kannada",
          "ml-IN": "Malayalam", "mr-IN": "Marathi", "bn-IN": "Bengali", "gu-IN": "Gujarati",
          "pa-IN": "Punjabi", "or-IN": "Odia", "ur-IN": "Urdu",
          "en-IN": "English", "en-US": "English", "en-GB": "English",
          "fr-FR": "French", "de-DE": "German", "es-ES": "Spanish", "pt-BR": "Portuguese",
          "it-IT": "Italian", "ja-JP": "Japanese", "ko-KR": "Korean", "zh-CN": "Chinese",
          "ar-EG": "Arabic", "ru-RU": "Russian",
        };
        const _agentLang = agent.asrLanguage ?? agent.language;
        const _prefLang  = callerProfileSnapshot?.preferredLanguage ?? null;

        if (agentConfig.languageAutoDetect && _prefLang) {
          // Auto-detect ON + caller has a remembered language preference:
          // seed the pipeline's starting language from memory and tell the LLM to
          // continue in that language (while still following switches mid-call).
          agentConfig.initialLanguage = _prefLang;
          const _prefName = _LNAMES[_prefLang] ?? _prefLang;
          agentConfig.systemPrompt +=
            `\n\n[LANGUAGE MEMORY] This caller previously communicated in ${_prefName}. ` +
            `Start the call in ${_prefName}. Continue to follow their language if they switch mid-call.`;
          logger.info(
            { agentId: params.agentId, callerPhone, preferredLanguage: _prefLang },
            "Caller preferred language loaded from memory — seeding pipeline start language",
          );
        } else if (_agentLang) {
          // Strict mode (or no preference yet): enforce the agent's configured language.
          // Append a language-override note AFTER the memory block so the LLM
          // treats it as the final authority and doesn't drift into a prior language
          // the agent used to be configured for (e.g. Tamil → now Hindi).
          const _lname = _LNAMES[_agentLang] ?? _agentLang;
          agentConfig.systemPrompt +=
            `\n\n[CURRENT AGENT LANGUAGE — THIS SESSION] The agent is now configured for ${_lname}. ` +
            `Even if previous calls (shown in the memory above) were conducted in a different language, ` +
            `you MUST communicate exclusively in ${_lname} throughout this entire call. ` +
            `Do not switch to any other language for any reason.`;
        }
      }
      logger.info(
        { agentId: params.agentId, callerPhone, callCount: callerProfileSnapshot?.callCount ?? 0, factCount: callerCtxResult.facts.length, archiveCount: callerCtxResult.recentCalls.length },
        "Caller memory injected into system prompt"
      );
    }
  }

  // ── Resolve dynamic variables in system prompt ─────────────────────────────
  const now = new Date();
  let campaignLeadVars: Record<string, string> = {};
  if (campaignLeadResult) {
    campaignLeadVars = {
      phone:  campaignLeadResult.phone,
      name:   campaignLeadResult.name  ?? "",
      email:  campaignLeadResult.email ?? "",
      ...campaignLeadResult.leadData,
    };
    logger.info({ campaignLeadId: params.campaignLeadId, phone: campaignLeadResult.phone }, "Campaign lead vars loaded into session");
  }

  const dynVars: Record<string, string> = {
    to_number:     params.toNumber,
    from_number:   params.fromNumber,
    agent_name:    agent.name,
    caller_number: params.fromNumber,
    date: now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
    ...Object.fromEntries(agentConfig.promptVariables.map(v => [v.key, v.defaultValue])),
    ...campaignLeadVars,
    ...Object.fromEntries(Object.entries(params.customParameters ?? {}).map(([k, v]) => [k, v])),
  };

  agentConfig.systemPrompt = resolvePromptVariables(agentConfig.systemPrompt, dynVars);

  // Apply the SAME resolution to the static greeting so it addresses the caller
  // by their prompt variables (e.g. {{customer_name}} → "krithika"). Static
  // greetings skip the LLM, so without this the name is never inserted.
  // caller_salutation is deliberately preserved here and resolved later by
  // gender detection in pipeline.greet().
  if (agentConfig.greetingMessage) {
    agentConfig.greetingMessage = resolvePromptVariables(agentConfig.greetingMessage, dynVars);
  }

  // Apply knowledge base (prepended so it sits at the top of the final prompt)
  if (kbEntriesResult) {
    const kbBlock = [
      "=== KNOWLEDGE BASE ===",
      "Use the following information to answer questions accurately. Always prefer this over your general training data.",
      "",
      kbEntriesResult,
      "=== END KNOWLEDGE BASE ===",
    ].join("\n\n");
    agentConfig.systemPrompt = `${kbBlock}\n\n${agentConfig.systemPrompt}`;
    logger.info(
      { agentId: params.agentId, knowledgeSourceIds: agentConfig.knowledgeSourceIds },
      "Knowledge base injected into system prompt"
    );
  }

  // Scope provider keys to this agent's owner (fetched in parallel above).
  // Managed agents (userId=null) rely entirely on platform managed keys below.
  const providerKeys = new Map<string, string>();
  for (const row of providerRowsResult) {
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

  // Provider name → platform_settings key
  const MANAGED: Record<string, string> = {
    qwen:       "managed_qwen_key",
    groq:       "managed_qwen_key",
    google:     "managed_gemini_key",
    gemini:     "managed_gemini_key",
    deepgram:   "managed_deepgram_key",
    sarvam:     "managed_sarvam_key",
    cartesia:   "managed_cartesia_key",
    openai:     "managed_openai_key",
    azure:      "managed_azure_speech_key",
    assemblyai: "managed_assemblyai_key",
  };
  // Providers that also need an extra-config blob — key stores the region string, not JSON
  // (matches what the admin Managed Keys panel writes as managed_azure_speech_region)
  const MANAGED_EXTRA: Record<string, string> = {
    azure: "managed_azure_speech_region",
  };

  const requiredProviders = [
    agent.asrProvider?.toLowerCase(),
    agent.llmProvider?.toLowerCase(),
    agent.ttsProvider?.toLowerCase(),
  ].filter((p): p is string => !!p);

  const isManaged = agent.agentMode === "managed";

  // ── Bulk platform_settings fetch (one DB round-trip instead of N sequential) ─
  // Collect every settings key needed, then do a single IN query.
  // Managed-plan agents need the platform key for every provider; BYOP agents
  // only need it as a fallback for providers the user hasn't configured.
  const settingsKeysNeeded = new Set<string>();
  for (const providerName of requiredProviders) {
    if (MANAGED[providerName] && (isManaged || !providerKeys.has(providerName))) {
      settingsKeysNeeded.add(MANAGED[providerName]!);
    }
    if (MANAGED_EXTRA[providerName] && (isManaged || !providerKeys.has(`${providerName}:extraConfig`))) {
      settingsKeysNeeded.add(MANAGED_EXTRA[providerName]!);
    }
  }
  if (!providerKeys.has("vobiz")) {
    settingsKeysNeeded.add("managed_vobiz_auth_token");
    settingsKeysNeeded.add("managed_vobiz_auth_id");
  }

  const settingsMap = new Map<string, string>();
  if (settingsKeysNeeded.size > 0) {
    const settingsRows = await withDbRetry("load-platform-settings", () =>
      db.select().from(platformSettingsTable)
        .where(inArray(platformSettingsTable.key, [...settingsKeysNeeded])),
    );
    for (const r of settingsRows) settingsMap.set(r.key, r.value);
  }

  // Apply managed keys for required providers
  for (const providerName of requiredProviders) {
    if (MANAGED[providerName] && (isManaged || !providerKeys.has(providerName))) {
      const managed = settingsMap.get(MANAGED[providerName]!);
      if (managed) {
        providerKeys.set(providerName, managed);
        logger.info({ providerName, isManaged }, "Using platform managed key for provider");
      }
    }
    if (MANAGED_EXTRA[providerName] && (isManaged || !providerKeys.has(`${providerName}:extraConfig`))) {
      const region = settingsMap.get(MANAGED_EXTRA[providerName]!);
      if (region) {
        const existing = providerKeys.get(`${providerName}:extraConfig`);
        const cfg = existing ? JSON.parse(existing) as Record<string, string> : {};
        if (!cfg["region"]) cfg["region"] = region;
        providerKeys.set(`${providerName}:extraConfig`, JSON.stringify(cfg));
      }
    }
  }

  // VoBiz telephony managed fallback (authToken + authId stored separately)
  if (!providerKeys.has("vobiz")) {
    const authToken = settingsMap.get("managed_vobiz_auth_token");
    const authId = settingsMap.get("managed_vobiz_auth_id");
    if (authToken && authId) {
      providerKeys.set("vobiz", authToken);
      const existing = providerKeys.get("vobiz:extraConfig");
      const cfg = existing ? JSON.parse(existing) as Record<string, string> : {};
      if (!cfg["authId"]) cfg["authId"] = authId;
      providerKeys.set("vobiz:extraConfig", JSON.stringify(cfg));
      logger.info({}, "Using platform managed VoBiz credentials");
    }
  }

  // For outbound VoBiz calls the HTTP route already created an "exec_*" record.
  // Reuse it here (matched by providerCallId in its metadata) so there is only
  // one DB row per call rather than two orphan in_progress records.
  const callRecord = await (async (): Promise<typeof callsTable.$inferSelect> => {
    if (params.externalCallId) {
      const [existing] = await withDbRetry("find-existing-call-record", () =>
        db.select().from(callsTable)
          .where(and(
            sql`${callsTable.metadata}::jsonb->>'providerCallId' = ${params.externalCallId}`,
            eq(callsTable.status, "in_progress"),
          ))
          .limit(1),
      );
      if (existing) {
        await withDbRetry("update-existing-call-record", () =>
          db.update(callsTable).set({
            metadata: JSON.stringify({
              providerCallId: params.externalCallId,
              externalCallId: params.externalCallId,
              ...(params.platformTelephony ? { platformTelephony: true } : {}),
            }),
          }).where(eq(callsTable.id, existing.id)),
        );
        logger.info({ callId: existing.id, externalCallId: params.externalCallId }, "Reusing existing exec_* call record");
        return existing;
      }
    }
    const [inserted] = await withDbRetry("insert-call-record", () =>
      db.insert(callsTable).values({
        agentId: params.agentId,
        userId: agent.userId ?? null,
        status: "in_progress",
        toNumber: params.toNumber,
        fromNumber: params.fromNumber,
        metadata: JSON.stringify({
          ...(params.externalCallId ? { externalCallId: params.externalCallId } : {}),
          ...(params.platformTelephony ? { platformTelephony: true } : {}),
          ...(isWebcall ? { transport: "webcall", isTestCall: true } : {}),
        }) || null,
      }).returning(),
    );
    if (!inserted) throw new Error("Failed to create call record");
    return inserted;
  })();

  // ── Mark campaign lead as connected + record call execution row ───────────────
  if (params.campaignLeadId && campaignLeadResult) {
    void db.update(campaignLeadsTable)
      .set({ callStatus: "connected" })
      .where(eq(campaignLeadsTable.id, params.campaignLeadId))
      .catch((err) => {
        logger.warn({ campaignLeadId: params.campaignLeadId, err }, "Failed to mark campaign lead connected");
      });
    void recordCallExecution({
      leadId:        params.campaignLeadId,
      campaignId:    campaignLeadResult.campaignId,
      batchId:       campaignLeadResult.batchId ?? null,
      callId:        callRecord.id,
      attemptNumber: campaignLeadResult.callAttempts ?? 1,
    }).catch((err) => {
      logger.warn({ campaignLeadId: params.campaignLeadId, callId: callRecord.id, err }, "Failed to record call execution");
    });
  } else if (params.campaignLeadId) {
    void db.update(campaignLeadsTable)
      .set({ callStatus: "connected" })
      .where(eq(campaignLeadsTable.id, params.campaignLeadId))
      .catch((err) => {
        logger.warn({ campaignLeadId: params.campaignLeadId, err }, "Failed to mark campaign lead connected");
      });
  }

  // ── Call Started lifecycle row (enables Logs tab for telephony calls) ─────────
  writeCallStartedLog(callRecord.id, params.agentId, {
    callType: isWebcall ? "Webcall" : "Live Call",
    direction: isWebcall ? "Inbound" : (params.externalCallId ? "Outbound" : "Inbound"),
    recordingEnabled: (agentCfg["recordingEnabled"] as boolean | undefined) ?? false,
    sessionId: (() => {
      try {
        const md = JSON.parse(callRecord.metadata ?? "{}");
        return (md.externalCallId ?? md.providerCallId ?? `live-${callRecord.id}`) as string;
      } catch {
        return `live-${callRecord.id}`;
      }
    })(),
    webrtcConnected: false,
    mediaStreamStarted: true,
    agentName: agent.name ?? null,
    asrProvider: agent.asrProvider,
    llmProvider: agent.llmProvider,
    ttsProvider: agent.ttsProvider,
    ttsVoice: agent.ttsVoice ?? null,
    extra: { telephonyProvider: params.telephonyProvider },
  });

  // ── Setup-time execution-log rows (mirror the web-call timeline) ─────────────
  // Memory / VariableResolver / Knowledge are computed BEFORE the call record
  // exists (above, in the parallel pre-fetch), so they are logged here once
  // callRecord.id is available, preserving chronological order after Agent init.
  const logExec = createExecutionLogger(callRecord.id, params.agentId);

  if (callerCtxResult && (callerProfileSnapshot || callerCtxResult.facts.length > 0 || callerCtxResult.recentCalls.length > 0)) {
    logExec("Memory", "response", {
      status: "success",
      responsePayload: {
        profile: callerProfileSnapshot ? { name: callerProfileSnapshot.name, callCount: callerProfileSnapshot.callCount } : null,
        factCount: callerCtxResult.facts.length,
        facts: Object.fromEntries(callerCtxResult.facts.map((f) => [f.key, f.value])),
        recentCallsCount: callerCtxResult.recentCalls.length,
      },
    });
  }

  logExec("VariableResolver", "system", {
    status: "info",
    requestPayload: { variables: dynVars },
    responsePayload: { resolvedPromptPreview: agentConfig.systemPrompt.substring(0, 600) },
  });

  if (kbEntriesResult) {
    logExec("Knowledge", "response", {
      status: "success",
      responsePayload: {
        sourceIds: agentConfig.knowledgeSourceIds,
        injected: true,
        preview: kbEntriesResult.substring(0, 400),
      },
    });
  }

  // ── Setup: provider-init / voice / prompt events (mirror the web-call path) ──
  logExec(EXEC_COMPONENTS.STT, "system", {
    status: "info",
    metadata: { event: "Provider Initialized", provider: agent.asrProvider, language: agent.asrLanguage ?? agent.language ?? null },
  });
  logExec(EXEC_COMPONENTS.LLM, "system", {
    status: "info",
    metadata: { event: "Provider Initialized", provider: agent.llmProvider, model: agent.llmModel ?? null },
  });
  logExec(EXEC_COMPONENTS.TTS, "system", {
    status: "info",
    metadata: { event: "Provider Initialized", provider: agent.ttsProvider },
  });
  logExec(EXEC_COMPONENTS.TTS, "system", {
    status: "info",
    metadata: { event: "Voice Loaded", provider: agent.ttsProvider, voice: agent.ttsVoice ?? null },
  });
  logExec(EXEC_COMPONENTS.Agent, "system", {
    status: "info",
    metadata: {
      event: "Prompt Generated",
      promptHash: createHash("sha256").update(agentConfig.systemPrompt).digest("hex").slice(0, 12),
      promptLength: agentConfig.systemPrompt.length,
      preview: agentConfig.systemPrompt.substring(0, 200),
    },
  });

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
    campaignLeadId: params.campaignLeadId ?? null,
    onAudioOut: params.onAudioOut,
    rawPcmOutput: params.rawPcmOutput ?? (params.telephonyProvider === "vobiz"),
    voicemailDelivery: params.voicemailDelivery
      ? {
          message: (typeof agentCfg["voicemailMessage"] === "string" && (agentCfg["voicemailMessage"] as string).trim())
            ? (agentCfg["voicemailMessage"] as string)
            : "Hello, we tried to reach you. Please call us back at your earliest convenience. Thank you.",
        }
      : undefined,
    // Returning caller (>=1 prior completed call) → memory-informed recognition opening
    isReturningCaller: (callerProfileSnapshot?.callCount ?? 0) >= 1,
    onTranscript: (speaker, text) => {
      logger.debug({ callId: callRecord.id, speaker, text: text.slice(0, 80) }, "Transcript");
      // Forward to the transport (browser webcall renders a live transcript).
      params.onTranscript?.(speaker, text);
      if (speaker === "user" && callerPhone) {
        // Real-time name latch — persist immediately so the name is saved even
        // if the call drops before the post-call LLM extraction runs.
        void latchCallerName({
          agentId:      params.agentId,
          phoneNumber:  callerPhone,
          transcript:   text,
          existingName: callerProfileSnapshot?.name ?? null,
          callId:       callRecord.id,
        }).then((latched) => {
          if (latched && callerProfileSnapshot) {
            callerProfileSnapshot = { ...callerProfileSnapshot, name: latched };
          }
          if (latched) callerNameLatchedThisCall = latched;
        });
        // Real-time structured fact latch — pattern-based detection, fire-and-forget
        void latchCallerFact({
          agentId:       params.agentId,
          phoneNumber:   callerPhone,
          transcript:    text,
          callId:        callRecord.id,
          existingFacts: latchedFactsMap,
        }).then((updated) => { latchedFactsMap = updated; });
      }
    },
    onCallEnd: () => {
      naturalEndTriggered = true;
      params.onCallEnd();
    },
    onCallTransfer: async (to, operatorSummary?) => {
      const isWarm = !!operatorSummary;
      logger.info({ callId: callRecord.id, transferTo: to, warm: isWarm }, "Call transfer initiated");

      // AI-to-AI transfer: agent: prefix means transfer to another agent
      if (to.startsWith("agent:")) {
        const targetAgentId = parseInt(to.slice(6), 10);
        logger.info({ callId: callRecord.id, targetAgentId }, "Agent-to-agent transfer detected — skipping telephony redirect");
        // Future: swap pipeline to new agent; for now telephony redirect is skipped
        // so the caller stays on the line while the same agent continues.
        wasTransferred = true;
        transferredTo = to;
        void patchSessionMeta(sessionId, { wasTransferred: true, transferredTo: to }, redisTtl);
        void patchSessionMeta(sessionId, { transferType: "agent", targetAgentId }, redisTtl);
        return true;
      }

      // Execute the actual provider-level call redirect
      try {
        if (!params.externalCallId) {
          logger.warn({ callId: callRecord.id }, "Transfer: no externalCallId — cannot redirect call");
          return false;
        }
        const baseUrl = (
          process.env["WEBHOOK_BASE_URL"] ??
          getSelfBaseUrl()
        ).replace(/\/$/, "");

        // ── For warm_summary mode: persist summary + get transferId/token for whisper URL ──
        let transferId: number | undefined;
        let briefingToken: string | undefined;
        if (isWarm && agent.userId) {
          try {
            // Generate an unguessable per-transfer token used to authenticate the
            // warm-briefing-xml request (prevents sequential-ID enumeration).
            briefingToken = randomBytes(32).toString("hex");
            const [row] = await db.insert(callTransfersTable).values({
              callId:       callRecord.id,
              userId:       agent.userId,
              transferTo:   to,
              summary:      operatorSummary,
              status:       "initiated",
              briefingToken,
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
          if (isWarm && transferId && briefingToken) {
            xmlUrl = `${baseUrl}/api/webhooks/twilio/warm-transfer-xml?target=${encodeURIComponent(to)}&transferId=${transferId}&token=${encodeURIComponent(briefingToken)}`;
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
          if (isWarm && transferId && briefingToken) {
            xmlUrl = `${baseUrl}/api/webhooks/plivo/warm-transfer-xml?target=${encodeURIComponent(to)}&transferId=${transferId}&token=${encodeURIComponent(briefingToken)}`;
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
          if (isWarm && transferId && briefingToken) {
            xmlUrl = `${baseUrl}/api/webhooks/vobiz/warm-transfer-xml?target=${encodeURIComponent(to)}&transferId=${transferId}&token=${encodeURIComponent(briefingToken)}`;
          } else {
            xmlUrl = `${baseUrl}/api/webhooks/vobiz/transfer-xml?target=${encodeURIComponent(to)}`;
          }
          await transferVobizCall({ authId, authToken, callUuid: params.externalCallId, xmlUrl });
        }
        // suppress unused-import warnings for builders not used via direct call
        void buildTwilioWarmTransferTwiML; void buildPlivoWarmTransferXml; void buildVobizWarmTransferXml;

        // Mark as successfully transferred only after the provider call succeeds
        wasTransferred = true;
        transferredTo = to;
        void patchSessionMeta(sessionId, { wasTransferred: true, transferredTo: to }, redisTtl);
        return true;
      } catch (err) {
        logger.error({ callId: callRecord.id, err }, "Provider call transfer API failed");
        return false;
      }
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
    agentId: params.agentId,
    pipeline,
    startedAt: new Date(),
    metricsAcc,
    get wasTransferred() { return wasTransferred; },
    get transferredTo() { return transferredTo; },
    get naturalEndTriggered() { return naturalEndTriggered; },
    get callerProfileSnapshot() { return callerProfileSnapshot; },
    get callerNameLatchedThisCall() { return callerNameLatchedThisCall; },
    personaHash,
    callerPhone,
    agentUserId:      agent.userId ?? null,
    agentLlmProvider: agent.llmProvider,
    agentLlmModel:    agent.llmModel ?? "",
    campaignLeadId:   params.campaignLeadId ?? null,
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

  setTimeout(() => {
    logger.info(
      { sessionId, callId: callRecord.id, maxDurationSeconds: agentConfig.maxDuration, endReason: "max_duration" },
      "Session reached configured max duration — ending call",
    );
    void endSession(sessionId, "max_duration");
  }, agentConfig.maxDuration * 1000);

  logger.info({ sessionId, callId: callRecord.id, agent: agent.name }, "Session created");

  if (params.voicemailDelivery) {
    // Voicemail-delivery mode: do NOT greet/run the conversation. Listen for the
    // machine greeting to end, then speak the full message once and hang up.
    pipeline.deliverVoicemail().catch((err) => {
      logger.error({ sessionId, err }, "Voicemail delivery failed");
    });
  } else {
    pipeline.greet().catch((err) => {
      logger.error({ sessionId, err }, "Greeting failed");
    });
  }

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

export async function endSession(sessionId: string, reason?: string): Promise<void> {
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
    // Only finalize/upload when the agent has Call Recording enabled, so disabled
    // agents store nothing. Finalize happens concurrently; we await the URL before
    // writing to DB.
    const recordingEnabled = (session.pipeline as any).config?.agentConfig?.recordingEnabled === true;
    let recordingUrl: string | null = null;
    let recordingError: string | null = null;
    let recordingStatus: "disabled" | "saved" | "failed" = "disabled";
    const recLog = createExecutionLogger(session.callId, session.agentId ?? null);
    if (recordingEnabled) {
      logRecordingEvent(recLog, "Recording Started");
      const result = await session.pipeline.getRecording().finalize(session.callId)
        .catch((err) => {
          logger.error({ sessionId, callId: session.callId, err }, "Recording finalize threw");
          return { url: null, error: err instanceof Error ? err.message : String(err) };
        });
      recordingUrl = result.url;
      recordingError = result.error;
      if (recordingError) {
        logger.error({ sessionId, callId: session.callId, recordingError }, "Recording finalize failed");
        recordingStatus = "failed";
        logRecordingEvent(recLog, "Recording Failed", { error: recordingError });
      } else {
        recordingStatus = "saved";
        logRecordingEvent(recLog, "Recording Saved", { url: recordingUrl });
        logRecordingEvent(recLog, "Recording Uploaded", { url: recordingUrl });
      }
    }

    const pipelineUsage = (session.pipeline as unknown as {
      getUsageTotals?: () => { tokensSaved?: number };
    }).getUsageTotals?.() ?? null;
    const tokensSavedValue = pipelineUsage?.tokensSaved ?? 0;

    await db.update(callsTable).set({
      status: callStatus,
      endedAt,
      durationSeconds,
      transcript: transcript || null,
      sttLatencyMs: avgSttMs,
      llmLatencyMs: avgLlmMs,
      ttsFirstChunkMs: avgTtsMs,
      ...(tokensSavedValue > 0 ? { tokensSaved: tokensSavedValue } : {}),
      ...(recordingUrl ? { recordingUrl } : {}),
      ...(recordingError ? { recordingError } : {}),
      ...(session.wasTransferred && session.transferredTo
        ? { metadata: JSON.stringify({ transferredTo: session.transferredTo }) }
        : {}),
    }).where(eq(callsTable.id, session.callId));

    // ── Mark campaign lead terminal (drains the active Connected count) ──────────
    if (session.campaignLeadId) {
      const terminalLeadStatus = session.wasTransferred ? "transferred" : "completed";
      void db.update(campaignLeadsTable)
        .set({ callStatus: terminalLeadStatus })
        .where(eq(campaignLeadsTable.id, session.campaignLeadId))
        .catch((err) => {
          logger.warn({ campaignLeadId: session.campaignLeadId, err }, "Failed to mark campaign lead terminal");
        });

      // ── Compute & persist operational outcome (fire-and-forget) ────────────
      // Runs shortly after the lead status is persisted above. Checks for a
      // booking created during this call (bookings.call_id = session.callId),
      // a pending callback, and max-attempts exhaustion, then writes the
      // canonical operationalOutcome so the batch workspace KPI cards update.
      void (async () => {
        try {
          const leadId = session.campaignLeadId!;

          // Booking: the native_booking tool writes bookings.call_id = callId
          const [bookingRow] = await db
            .select({ id: bookingsTable.id })
            .from(bookingsTable)
            .where(eq(bookingsTable.callId, session.callId))
            .limit(1);
          const hasBooking = !!bookingRow;

          // Pending callback scheduled for this lead during the call
          const [cbRow] = await db
            .select({ id: scheduledCallbacksTable.id })
            .from(scheduledCallbacksTable)
            .where(and(
              eq(scheduledCallbacksTable.campaignLeadId, leadId),
              eq(scheduledCallbacksTable.status, "pending"),
            ))
            .limit(1);
          const hasPendingCallback = !!cbRow;

          // Max-attempts check
          const [freshLead] = await db
            .select({ callAttempts: campaignLeadsTable.callAttempts, campaignId: campaignLeadsTable.campaignId })
            .from(campaignLeadsTable)
            .where(eq(campaignLeadsTable.id, leadId))
            .limit(1);

          let maxAttemptsReached = false;
          if (freshLead) {
            const [camp] = await db
              .select({ maxAttempts: campaignsTable.maxAttempts })
              .from(campaignsTable)
              .where(eq(campaignsTable.id, freshLead.campaignId))
              .limit(1);
            if (camp) {
              maxAttemptsReached = (freshLead.callAttempts ?? 0) >= (camp.maxAttempts ?? 1);
            }
          }

          const termStatus = session.wasTransferred ? "transferred" : "completed";
          const outcome = computeOperationalOutcome({
            callStatus:           termStatus,
            disposition:          null, // disposeCall runs async; a later taxonomy run may update this
            hasBooking,
            hasCompletedTransfer: session.wasTransferred,
            hasPendingCallback,
            maxAttemptsReached,
            isDncBlocked:         false,
          });

          if (freshLead) {
            await setOperationalOutcome(db, leadId, freshLead.campaignId, outcome);
            logger.info(
              { leadId, outcome, hasBooking, wasTransferred: session.wasTransferred, hasPendingCallback },
              "Campaign lead operational outcome set",
            );
          }
        } catch (outcomeErr) {
          logger.warn({ campaignLeadId: session.campaignLeadId, outcomeErr }, "Failed to set campaign lead operational outcome");
        }
      })();
    }

    const [call] = await db.select().from(callsTable).where(eq(callsTable.id, session.callId));
    if (call) {
      const [ag] = await db.select().from(agentsTable).where(eq(agentsTable.id, call.agentId));

      // ── TRAI post-call opt-out scan (fire-and-forget) ────────────────────────
      // When TRAI is enabled on the agent, detect caller opt-out phrases in the
      // finalized transcript and suppress the number for future calls.
      const traiEnabled = !!((ag?.agentConfig as { compliance?: { trai?: boolean } } | null)?.compliance?.trai);
      if (traiEnabled) {
        void scanForOptOut(call.agentId, session.callId, call.toNumber, transcript)
          .catch((scanErr) => {
            logger.warn({ sessionId, scanErr }, "TRAI post-call opt-out scan failed");
          });
      }

      // ── DPDP post-call PII scan (fire-and-forget) ────────────────────────────
      // When DPDP is enabled, flag whether the finalized transcript contains PII
      // for downstream analytics redaction. Never alters the transcript and never
      // blocks anything.
      const dpdpEnabled = !!((ag?.agentConfig as { compliance?: { dpdp?: boolean } } | null)?.compliance?.dpdp);
      if (dpdpEnabled) {
        void scanAndRedactPII(call.agentId, session.callId, call.toNumber, transcript)
          .catch((scanErr) => {
            logger.warn({ sessionId, scanErr }, "DPDP post-call PII scan failed");
          });
      }

      // ── Auto-redial on unexpected drop ───────────────────────────────────────
      // If the agent has autoRedial enabled and the call ended without a natural
      // goodbye (user hangup / network drop), schedule a callback.  Fires even
      // for very short calls so testing any feature works end-to-end.
      const autoRedialCfg = (ag?.agentConfig as { autoRedial?: { enabled?: boolean; delayMinutes?: number; maxAttempts?: number } } | null)?.autoRedial;
      const wasUnexpectedDrop = !session.naturalEndTriggered && !session.wasTransferred;
      if (ag && autoRedialCfg?.enabled && wasUnexpectedDrop && session.callerPhone) {
        void scheduleNoAnswerRedial({
          agentId:               ag.id,
          toNumber:              session.callerPhone,
          userId:                ag.userId ?? null,
          callId:                session.callId,
          maxAttempts:           autoRedialCfg.maxAttempts ?? 3,
          redialIntervalMinutes: autoRedialCfg.delayMinutes ?? 2,
        }).catch((rdErr) => {
          logger.warn({ sessionId, rdErr }, "Auto-redial scheduling failed");
        });
      }

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

        // ── Billing: compute costCents and debit wallet (telephony path) ──────────
        // The HTTP PATCH /calls/:id/end route handles billing for calls ended via
        // the API, but telephony sessions end via WebSocket close and never hit
        // that route.  We bill here instead — skipped if costCents is already set
        // (prevents double-debit if the route is also called).
        const sessionCallUserId = call.userId ?? ag.userId ?? null;
        if (sessionCallUserId && durationSeconds > 0 && !(call.costCents != null && call.costCents > 0)) {
          try {
            const billingMode     = await resolveAgentBillingMode(sessionCallUserId, ag);
            const rateCentsPerMin = getFlatRateCentsPerMin(billingMode);
            const billableMinutes = Math.ceil(durationSeconds / 60);
            const modeLabel       = billingMode === "managed" ? "managed" : "BYOP";
            const rateLabel       = `$${(rateCentsPerMin / 100).toFixed(3)}/min (${modeLabel})`;
            const debitCents      = Math.round(billableMinutes * rateCentsPerMin);
            if (debitCents > 0) {
              await db.update(callsTable).set({ costCents: debitCents }).where(eq(callsTable.id, session.callId));
              const [billingUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, sessionCallUserId));
              if (billingUser) {
                const newBalance = Math.max(0, billingUser.walletBalanceCents - debitCents);
                await db.update(usersTable).set({ walletBalanceCents: newBalance }).where(eq(usersTable.id, billingUser.id));
                await db.insert(walletTransactionsTable).values({
                  userId:      billingUser.id,
                  type:        "call_debit",
                  amountCents: -debitCents,
                  description: `Call #${session.callId} — ${billableMinutes} min × ${rateLabel}`,
                  status:      "completed",
                  callId:      session.callId,
                });
                logger.info({ sessionId, callId: session.callId, debitCents, billingMode }, "Call billed in endSession");
              }
            }
          } catch (billingErr) {
            logger.error({ sessionId, billingErr }, "Billing failed in endSession");
          }
        }

        // ── End-of-call execution log (structured Call Ended summary) ─────────────
        // Always the final row: explains WHY the call ended. Reason is taken from
        // the explicit `reason` arg (e.g. max-duration timer) when provided,
        // otherwise derived from the session's end flags.
        const endRawReason = reason
          ?? (session.wasTransferred ? "transfer_completed"
              : session.naturalEndTriggered ? "completed"
              : "user_hangup");
        const { lastUser: endLastUser, lastAgent: endLastAgent } = session.pipeline.getLastTurnTexts();
        writeCallEndedLog(session.callId, ag.id, {
          rawReason: endRawReason,
          durationSeconds,
          turns: metricsAcc.count,
          retryAttempted: false,
          fallbackAttempted: false,
          lastUserTranscript: endLastUser,
          lastAgentResponse: endLastAgent,
          recordingStatus,
        }, { avgSttMs, avgLlmMs, avgTtsMs });

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

          // 1. Generate call summary — always runs for every completed call.
          // Uses BYOP key when available; falls back to platform managed key (Groq).
          if (ag.userId) {
            try {
              const hasTranscript = !!(transcript && transcript.trim().length > 0);
              if (!hasTranscript) {
                // Empty-transcript edge case: store a short placeholder rather than failing.
                callSummary = "No conversation took place on this call, so there is nothing to summarize.";
                await db.update(callsTable).set({ callSummary }).where(eq(callsTable.id, session.callId));
              } else {
                const llmProvs = await db.select().from(providersTable).where(
                  and(
                    eq(providersTable.isActive, true),
                    eq(providersTable.userId, ag.userId!),
                    eq(providersTable.providerName, ag.llmProvider)
                  )
                );
                let sumLlmKey: string | null = llmProvs[0] ? decryptKey(llmProvs[0].apiKey) : null;
                let sumLlmProvider = ag.llmProvider;
                let sumLlmModel = ag.llmModel;
                // Managed plan: no BYOP key → fall back to platform managed key (Groq)
                if (!sumLlmKey) {
                  const [row] = await db.select().from(platformSettingsTable).where(eq(platformSettingsTable.key, "managed_qwen_key"));
                  sumLlmKey = row?.value?.trim() || process.env["GROQ_API_KEY"] || null;
                  if (sumLlmKey) {
                    sumLlmProvider = "groq";
                    sumLlmModel = "llama-3.3-70b-versatile";
                  }
                }
                if (sumLlmKey) {
                  const llm = createLLMAdapter(sumLlmProvider, sumLlmKey, sumLlmModel);
                  const customPrompt = (agCfgForWebhook["summarizationPrompt"] as string | undefined) ?? "";
                  const userContent = customPrompt
                    ? `${customPrompt}\n\nTranscript:\n${transcript.slice(0, 6000)}`
                    : `Summarize this call transcript as a single natural paragraph of 4 to 6 sentences. Briefly cover why the customer called, what was discussed, any important information collected, the outcome, and any follow-up or next steps (only if applicable). Write plain prose — do not use bullet points, numbered lists, or headings.\n\nTranscript:\n${transcript.slice(0, 6000)}`;
                  let summary = "";
                  await llm.chat(
                    [{ role: "user", content: userContent }],
                    "You are a call analyst. Write a concise, factual summary of the call as a single natural paragraph of 4 to 6 sentences. Do not use bullet points, numbered lists, or headings — write plain readable prose only.",
                    () => {},
                    (full) => { summary = full; }
                  );
                  if (summary) {
                    callSummary = summary;
                    await db.update(callsTable).set({ callSummary: summary }).where(eq(callsTable.id, session.callId));
                  }
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
              const llmKey = llmProvs[0] ? decryptKey(llmProvs[0].apiKey) : undefined;
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
              const evalLlmKey = evalLlmProvs[0] ? decryptKey(evalLlmProvs[0].apiKey) : undefined;
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

        // ── Post-call taxonomy disposition classification (fire-and-forget) ──────
        // Uses the agent's configured Call Disposition taxonomy (agent_dispositions)
        // and writes the result onto calls.disposition_result. No-ops when the agent
        // has no taxonomy configured. Mutually exclusive with the legacy
        // dispositionSchema extraction above (an agent uses one system or the other).
        disposeCall({
          agentId:    call.agentId,
          callId:     session.callId,
          transcript: transcript || null,
          callEvents: [{ type: "duration", durationSec: durationSeconds }],
        }).catch((dispErr) => {
          logger.warn({ sessionId, dispErr }, "Post-call taxonomy disposition failed");
        });

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
              let memLlmKey: string | null = memLlmProvs[0]?.apiKey ?? null;
              let memLlmProvider = session.agentLlmProvider;
              let memLlmModel    = session.agentLlmModel;
              // Managed plan: no BYOP key → fall back to platform managed key (Groq).
              // IMPORTANT: the managed key is a Groq API key, so we must also switch
              // the provider to "groq" and use a Groq-compatible model — otherwise
              // createLLMAdapter("openai", groqKey, ...) would fail with 401.
              if (!memLlmKey) {
                const [row] = await db.select().from(platformSettingsTable).where(eq(platformSettingsTable.key, "managed_qwen_key"));
                memLlmKey = row?.value?.trim() || process.env["GROQ_API_KEY"] || null;
                if (memLlmKey) {
                  memLlmProvider = "groq";
                  memLlmModel    = "llama-3.3-70b-versatile";
                }
              }
              if (memLlmKey) {
                const memLlm = createLLMAdapter(memLlmProvider, memLlmKey, memLlmModel);
                const history = session.pipeline.getHistory();
                await updateCallerProfile({
                  agentId:           call.agentId,
                  phoneNumber:       session.callerPhone!,
                  history,
                  llm:               memLlm,
                  existing:          session.callerProfileSnapshot,
                  callId:            session.callId,
                  wasDropped,
                  callerNameInCall:  session.callerNameLatchedThisCall,
                  personaHash:       session.personaHash ?? undefined,
                  // Persist the language the caller was using when the call ended.
                  // Only meaningful when languageAutoDetect is ON; ignored otherwise
                  // because the pipeline always ends in the agent's fixed language.
                  finalLanguage:     session.pipeline.getPreferredCallerLang() || null,
                });
                createExecutionLogger(session.callId, call.agentId)("Memory", "response", {
                  status: "success",
                  metadata: { updated: true, wasDropped },
                });
                if (!wasDropped) {
                  await detectCallbackRequest({
                    agentId:        call.agentId,
                    toNumber:       session.callerPhone!,
                    history,
                    llm:            memLlm,
                    callId:         session.callId,
                    campaignLeadId: session.campaignLeadId,
                  });
                }
              }
            } catch (memErr) {
              logger.warn({ sessionId, memErr }, `Post-call caller memory update failed — ${memErr instanceof Error ? memErr.message : String(memErr)}`);
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

  // ── Structured Call Ended (failure) ───────────────────────────────────────
  const failDurationSeconds = Math.max(0, Math.round((Date.now() - session.startedAt.getTime()) / 1000));
  const { lastUser: failLastUser, lastAgent: failLastAgent } = session.pipeline.getLastTurnTexts();
  writeCallEndedLog(session.callId, session.agentId ?? null, {
    rawReason: "failed",
    durationSeconds: failDurationSeconds,
    turns: session.metricsAcc.count,
    errorMessage,
    lastUserTranscript: failLastUser,
    lastAgentResponse: failLastAgent,
  });

  logger.error({ sessionId, errorMessage }, "Session failed");
}
