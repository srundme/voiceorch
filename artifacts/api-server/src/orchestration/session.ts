import { createHash, randomBytes } from "crypto";
import { reserveCall, type CallLease } from "./call-admission.js";
import { assertAcceptingCalls } from "./lifecycle.js";
const callLeases = new Map<string, CallLease>();
import { getSelfBaseUrl } from "../lib/app-domain.js";
import { db, agentsTable, callsTable, providersTable, platformSettingsTable, campaignLeadsTable, leadNotesTable, knowledgeEntriesTable, callTransfersTable, usersTable, walletTransactionsTable, bookingsTable, eventTypesTable, scheduledCallbacksTable, campaignsTable, executionLogsTable, squadsTable, squadRunsTable, phoneNumbersTable } from "@workspace/db";
import { createExecutionLogger, writeCallEndedLog, writeCallStartedLog, logRecordingEvent, EXEC_COMPONENTS } from "../services/execution-log.js";
import { computeProRataDebitCents, isNonBillableCallStatus } from "../services/call-billing.js";
import { resolveAgentBillingMode, resolveOwnTelephonyDiscount, resolveBillingRateCentsPerMin } from "../services/minute-rates.js";
import { resolvePartnerBilling, creditPartnerSpreadOnCall } from "../services/partner-billing.js";
import { getAttachedSourceIds, buildKnowledgeBaseBlockEx } from "./kb-retrieval.js";
import { KRUTRIM_AUTO_SUMMARY_TITLE } from "../services/kb-source-summary.js";
import { decryptKey } from "../lib/crypto.js";
import { eq, and, sql, inArray, or, gt, ne, lte, isNull, desc } from "drizzle-orm";
import { OrchestrationPipeline } from "./pipeline.js";
import { optionalMs, optionalUnitInterval } from "./stt-tuning.js";
import { parseBackchannelPhrases } from "./backchannel.js";
import { clampSemanticTurnStopMs, resolveSemanticTurnEnabled } from "./semantic-turn-gate.js";
import type { VoiceSession } from "./voice-session.js";
import { GeminiLivePipeline } from "./adapters/live/gemini-live-pipeline.js";
import { OpenAIRealtimePipeline } from "./adapters/live/openai-realtime-pipeline.js";
import {
  DEFAULT_GEMINI_LIVE_MODEL,
  resolveGeminiLiveModel,
  resolveGeminiLiveThinkingLevel,
  resolveGeminiLiveVoice,
  resolveVoiceStack,
} from "./adapters/live/gemini-live-voices.js";
import {
  resolveOpenAIRealtimeModel,
  resolveOpenAIRealtimeVoice,
} from "./adapters/live/openai-realtime-voices.js";
import { resolveSarvamSttMode } from "./adapters/stt/sarvam-mode.js";
import { resolveRealtimeStreamType } from "./adapters/stt/sarvam-realtime.js";
import { isSarvamCatalogSpeaker } from "./adapters/tts/sarvam.js";
import {
  clampSarvamIncompleteHoldMs,
  clampSarvamSpeechEndFlushMs,
  resolveSarvamHighVadSensitivity,
  normalizeCallEngineAgentConfig,
  FRAGMENT_COALESCE_DEFAULTS,
  resolveStartSpeakingPlan,
  resolveTtsMinSentenceChars,
} from "@workspace/db/call-engine-defaults";
import { compilePromptCore, hasPromptCore } from "@workspace/db/prompt-core";
import { withDbRetry } from "./db-retry.js";
import { transcriptHasFarewellEnding } from "./callFarewell.js";
import { attachIntakeCallArtifacts } from "../lib/intake-service.js";
import {
  INTAKE_AGENT_TYPE,
  INTAKE_BACKCHANNEL_FILLERS,
  INTAKE_LOCKED_AGENT_CONFIG,
  applyAdminHostedStack,
  applyIntakePodVoice,
  intakeUsesPod,
  buildIntakeSttPrompt,
  buildIntakeSystemPrompt,
  intakeAgentTools,
  intakeCartesiaVoiceId,
} from "../lib/intake-agent.js";
import {
  findIntakeForCaller,
  intakeCallerName,
  renderIntakeGreeting,
  resolveIntakeOpenKind,
} from "../lib/intake-call-context.js";
import { shouldMarkCallVoicemail } from "../lib/voicemail-detect.js";
import { looksLikeVoicemailOutcome } from "../services/sheet-auto-calls-helpers.js";
import { capHandoffTranscript, mergeHandoffTranscript } from "./squad-transcript.js";
import { buildLeadContextBlock, buildCallContextBlock, callVariablesFromMetadata, resolvePromptVariables } from "./prompt-vars.js";
import { pickKnownBookingEmail } from "./booking-email-policy.js";
import { createLLMAdapter } from "./adapters/llm/index.js";
import { resolveMicSensitivity, resolveBargeInEnergyThreshold } from "./mic-sensitivity.js";
import { FORCE_SOFTWARE_NOISE_GATE_KEY } from "./noise-gate.js";
import { loadPcmLoop, TRACK_PARAMS } from "./ambient.js";
import type { AgentConfig, AgentTool, TelephonyProvider, SessionTransport, PipelineMetrics, SessionConfig } from "./types.js";
import { resolveSarvamEndpointingMs } from "./endpointing-settings.js";
import { logger } from "../lib/logger.js";
import { voiceCanaryBaseFields } from "./voice-canary.js";
import { hangupVobizCall, vobizAuthFromProviderKeys } from "./telephony/transfer.js";
import { MEETING_BEHAVIOR_PROMPT, parseMeetingsConfig } from "../services/meeting-runtime.js";
import {
  saveSessionMeta,
  patchSessionMeta,
  saveConversation,
  removeSession,
} from "./sessionStore.js";
import { destroyAudioSession, resetAecSession } from "./audioPool.js";
import { afterCallInstructionForAgent, disposeCall, extractFlatDispositionSchema } from "../services/disposition.js";
import { schemaFieldsNeedFill } from "../lib/disposition/normalize-fields.js";
import {
  buildCallEndedWebhookPayload,
  dispatchWebhooks,
  flatDispositionFromTaxonomy,
} from "../routes/webhook-endpoints.js";
import {
  buildAgentNotifyHeaders,
  readWebhookPayloadTemplate,
  serializeAgentWebhookBody,
} from "../lib/webhook-payload-template.js";
import { computeOperationalOutcome, setOperationalOutcome } from "../services/operational-outcome.js";
import {
  CAMPAIGN_LEAD_STATE_V2_EVENT,
  buildCampaignLeadStateV2CanaryLog,
  buildCampaignLeadStateV2Shadow,
  classifyCampaignCallEnd,
  classifyCampaignHangupLegacy,
  finalizeV2Park,
  inferExpectedDisconnect,
  isCampaignLeadStateV2Writer,
  planV2AnsweredHangup,
  resolveCallEndedReason,
  shouldLogCampaignLeadStateV2Canary,
  shouldLogCampaignLeadStateV2Shadow,
} from "../services/campaign-lead-state-v2.js";
import { applyV2AnsweredHangup, recordCallExecutionOutcome } from "../services/campaign-attempt-status.js";
import { appendTraiDisclosure, scanForOptOut } from "../services/trai/index.js";
import { appendDpdpDisclosure, scanAndRedactPII } from "../services/dpdp/index.js";
import { appendIrdaiAiDisclosure } from "../services/irdai/index.js";
import { appendGuardrails, redactTranscriptPII } from "../services/guardrails.js";
import { phonesMatch } from "../services/google-sheets-helpers.js";
import { resolveBillableDurationSeconds } from "./billable-duration.js";
import { scheduleNetworkDropCallback } from "../services/autoRedial.js";
import { refillCampaignForLead } from "../services/batchScheduler.js";
import { resolveRetryConfig } from "../services/retryEngine.js";
import { recordCallExecution } from "./campaignCaller.js";
import {
  resolveCallerKey,
  type CallDirection,
  canonicalizeCallerKey,
  loadCallerProfile,
  loadCallerContext,
  findCallerPhoneByEmail,
  injectCallerMemory,
  injectEnhancedMemory,
  isResumeDroppedCall,
  computeAgentPersonaHash,
  updateCallerProfile,
  latchCallerName,
  callerNameCollidesWithAgent,
  latchCallerFact,
  detectCallbackRequest,
  type CallerProfile,
  type CallerContext,
  type NameLatchTier,
} from "./callerMemory.js";
import { buildOpeningLanguageRule, mapLanguagePrefToBcp47 } from "./call-direction-rules.js";
import { performSquadAgentHandoff } from "../services/squad-handoff.js";
import { completeLiveSquadRun, ensureLiveSquadRunForCall } from "../services/squad-engine.js";
import {
  resolveSquadMemoryOwnerAgentId,
  findSquadForAgent,
  loadSquadTeam,
  buildSquadTools,
  buildSquadPromptBlock,
  buildSharedCallerFactsBlock,
  consumeFollowupContext,
} from "../services/squad-teamwork.js";
import { lookupSheetsForSession } from "../services/sheets-writeback.js";


/**
 * Fallback silence/inactivity timeout (seconds) applied when an agent has no
 * `silenceTimeoutSeconds` configured. Without this, dead-air calls (voicemail,
 * an idle open webcall tab, or a phone call whose hangup event never arrives)
 * never self-terminate and linger until the 30-minute stuck-call sweep force-
 * closes them — producing fake long-duration calls. The silence watchdog first
 * re-prompts ("are you still there?") and only hangs up after a second window,
 * so the effective time before hangup is roughly double this value.
 *
 * An agent may still explicitly disable the timeout by setting it to 0.
 * Override the default via SILENCE_TIMEOUT_DEFAULT_SECONDS.
 */
const DEFAULT_SILENCE_TIMEOUT_SECONDS =
  parseInt(process.env["SILENCE_TIMEOUT_DEFAULT_SECONDS"] ?? "", 10) || 30;

interface MetricsAcc {
  sttTotal: number;
  llmTotal: number;
  ttsTotal: number;
  count: number;
}

interface ActiveSession {
  sessionId: string;
  callId: number;
  agentId: number;
  pipeline: VoiceSession;
  /** Provider-side call id (VoBiz answer-webhook CallUUID / Twilio CallSid / …)
   *  when known at session creation. Lets async provider callbacks (e.g. the
   *  VoBiz machine_detection_url AMD verdict) find the LIVE session directly. */
  externalCallId: string | null;
  startedAt: Date;
  metricsAcc: MetricsAcc;
  wasTransferred: boolean;
  transferredTo: string | null;
  /** Voice stack running this session. */
  voiceStack: AgentConfig["voiceStack"];
  /** Bumped when playAudio is moved onto a newer VoBiz WebSocket. */
  mediaEpoch: number;
  retargetAudioOut(send: (audio: Buffer) => void): number;
  /** Imperatively mark/unmark the call as transferred from OUTSIDE createSession
   *  (e.g. the manual POST /calls/:id/transfer path via triggerTransfer). Sets the
   *  in-memory closure flag the vobiz.ts WS-close guard reads synchronously. Pass
   *  null to reset on a failed transfer. */
  setTransferred(to: string | null): void;
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
  /** True when an outbound call was acoustically confirmed as a machine AND the
   *  configured voicemail action executed (message delivered or confirmed-machine
   *  hangup). Drives the distinct "voicemail" call/lead outcome in endSession. */
  voicemailActionExecuted: boolean;
  /** When this call was itself spawned from a scheduled callback, the callback's reason
   *  (e.g. "network_drop"). Prevents re-scheduling another callback when a retry call
   *  itself drops — enforces the single-retry-only invariant. */
  sourceCallbackReason: string | null;
  /** Name latched mid-call via latchCallerName (caller said "my name is X").
   *  Used to guard against LLM-extraction contamination at call-end. */
  callerNameLatchedThisCall: string | null;
  /** Trust tier of that latch: "A" = explicit self-intro (overrides a
   *  conflicting LLM-extracted name at call-end), "B" = ambiguous "I am X"
   *  (defers to LLM extraction at call-end). */
  callerNameLatchTier: NameLatchTier | null;
  /** Agent persona fingerprint at call start — written to caller memory at
   *  call-end so future calls can detect a persona swap (whiplash guard). */
  personaHash: string;
  /** Effective STT/agent language resolved at session start (BCP-47 or the agent
   *  language). Fallback source for the calls.primary_language analytics column
   *  when the pipeline didn't detect a caller language mid-call. */
  configuredLanguage: string | null;
  /** Active Agent Squad live run, when this call is part of a squad. */
  squadRunId: number | null;
  squadId: number | null;
  /**
   * Agent that "owns" caller memory for this call. Pinned to the agent that
   * answered (entry), so mid-call handoffs don't fragment facts across
   * teammate agentIds. Falls back to the answering agentId when not in a squad.
   */
  memoryOwnerAgentId: number;
  /** Transcript segments from earlier agents, accumulated across handoffs. */
  handoffTranscriptAccum: string;
}

const sessions = new Map<string, ActiveSession>();

export async function createSession(params: {
  agentId: number;
  telephonyProvider: SessionTransport;
  toNumber: string;
  fromNumber: string;
  externalCallId?: string;
  /** Carrier answer/bridge time (epoch ms) captured at the telephony answer
   *  webhook. Anchors BOTH the call duration clock (session.startedAt) and the
   *  recording timeline so the gap between carrier answer and media-stream
   *  connect is included in the reported duration and padded as leading silence
   *  in the recording. Omitted for webcall (no carrier answer gap) — falls back
   *  to session-creation time. */
  answeredAt?: number;
  /** Saved opener already playing on the phone socket. See SessionConfig.preplayedOpening. */
  preplayedOpening?: SessionConfig["preplayedOpening"];
  /** Opaque per-call correlation token minted at outbound dial time (calls.ts) and
   *  threaded through the answer webhook → WS handler. When set, the pre-created
   *  outbound exec_* call record is matched by `metadata.corrToken` and updated in
   *  place with the live `externalCallId` (the VoBiz CallUUID) — avoiding a duplicate
   *  in_progress record and giving /Call/{uuid}/Transfer/ the id it requires. */
  corrToken?: string;
  platformTelephony?: boolean;
  /** Call direction — picks the human side for the caller-memory key. Inbound keys
   *  off `fromNumber` (the caller); outbound keys off `toNumber` (the dialed party,
   *  since `fromNumber` is our shared platform number). Defaults to "inbound" when
   *  omitted. Ignored for webcall, which uses a synthetic per-user key. */
  callDirection?: CallDirection;
  /** Inbound call parameters (e.g. Vobiz customParameters) merged into prompt variable resolution */
  customParameters?: Record<string, string>;
  /** Campaign lead ID — if set, lead data is merged into prompt variable resolution */
  campaignLeadId?: number;
  onAudioOut: (audio: Buffer) => void;
  awaitPlaybackReceipt?: SessionConfig["awaitPlaybackReceipt"];
  onCallEnd: () => void;
  onBargeIn?: () => void;
  /** Forwards every finalized transcript line (user + agent) to the transport so a
   *  browser webcall can render a live transcript. Telephony callers omit it. */
  onTranscript?: (speaker: "user" | "agent", text: string) => void;
  /** Non-fatal provider failure (e.g. TTS rejecting every sentence) — the call
   *  stays up; the transport can surface the reason to the tester. */
  onProviderIssue?: (component: "tts", message: string) => void;
  /** Overrides the default audio-format derivation. When omitted, PCM output is
   *  used for Vobiz only. The browser webcall transport sets this true. */
  rawPcmOutput?: boolean;
  /** 16000 for browser webcall clients that negotiated HD audio; default 8000. */
  rawPcmOutputRate?: 8000 | 16000;
  /**
   * Meeting bot: contact phone for caller memory when passMemory is on.
   * Does not change the call-log fromNumber (still meetbot-*).
   */
  meetingMemoryPhone?: string;
  /** Prior call id whose summary is injected when passCallContext is on. */
  meetingSourceCallId?: number;
  /** Meet/Zoom/Teams URL for this bot session (rejoin tool + prompt). */
  meetingUrl?: string;
  /** Meeting roster id (from meet-bot token mid). */
  meetMid?: string;
  /** Full meet-bot token for presentation page URL construction. */
  meetBotToken?: string;
  /** Booking attendee email for memory lookup when phone is unknown. */
  meetingMemoryEmail?: string;
  /** Snapshot from meet-bot token; default true when omitted. */
  passMemory?: boolean;
  passCallContext?: boolean;
  /** When true, the session runs in voicemail-delivery mode instead of the normal
   *  conversation pipeline: it waits for the answering machine's greeting to end
   *  (acoustic VAD cue) then speaks the agent's configured `voicemailMessage` once
   *  in full and hangs up. Used by the Vobiz AMD `leave_message` path. */
  voicemailDelivery?: boolean;
  /** When true, the answer webhook reported an UNRELIABLE provider "machine" hint
   *  (VoBiz synchronous AMD). The session opens the normal media stream but runs a
   *  short acoustic confirmation window BEFORE greeting: only an acoustically-confirmed
   *  machine enacts the configured voicemailAction; anything ambiguous falls through to
   *  a normal greeting so a live human is never harmed. See confirmAmdMachineThenBranch. */
  amdMachineHint?: boolean;
  /** When true, AMD is enabled for this VoBiz outbound call and acoustic
   *  confirmation must be armed UNCONDITIONALLY — per VoBiz docs the real verdict
   *  arrives via the ASYNC machine_detection_url callback (not the answer webhook),
   *  which feeds the live pipeline mid-window via onExternalAmdSignal(). Works
   *  with or without a synchronous machine hint. */
  amdArmed?: boolean;
  /** When this call was spawned by a scheduled callback, the callback's reason string
   *  (e.g. "network_drop"). Stored in session state and used in endSession to prevent
   *  a dropped retry call from scheduling yet another callback (single-retry invariant). */
  sourceCallbackReason?: string;
  /** When this call was spawned by a scheduled callback, the row ID of that callback.
   *  After the call record is created, this ID is used to write back `triggeredCallId`
   *  so users can navigate directly to the triggered call from the Callbacks page. */
  scheduledCallbackId?: number;
  /** Context snapshot from the previous call, generated after a network drop.
   *  When present, injected into the system prompt so the agent resumes naturally
   *  instead of treating the callback as a cold start. */
  resumeContext?: {
    summary: string;
    extractedFacts?: string[];
    completedSteps?: string[];
    pendingSteps?: string[];
    lastAgentMessage?: string;
    lastCustomerMessage?: string;
    toolResults?: string[];
  };
  /** When this call belongs to an Agent Squad live run. */
  squadRunId?: number;
  squadId?: number;
}): Promise<{ sessionId: string; callDbId: number }> {
  assertAcceptingCalls();
  const createSessionStartMs = Date.now();

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

  // Reserve before asynchronous setup: shared across all server replicas.
  let effectiveLimit = 10;
  if (agent.userId) {
    const [user] = await withDbRetry("load-user-concurrent-limit", () =>
      db
        .select({ concurrentLimit: usersTable.concurrentLimit })
        .from(usersTable)
        .where(eq(usersTable.clerkId, agent.userId!)),
    );
    effectiveLimit = user?.concurrentLimit ?? 10;
  }
  let admittedSessionId: string | undefined;
  const identity = params.corrToken ?? (params.campaignLeadId ? `lead:${params.campaignLeadId}` : params.externalCallId) ?? randomBytes(16).toString("hex");
  const lease = await reserveCall(agent.userId ?? `agent:${agent.id}`, `${params.telephonyProvider}:${identity}`, effectiveLimit, () => {
    if (admittedSessionId) void endSession(admittedSessionId, "ownership_lost");
  });
  const ownedAudioOut = (audio: Buffer) => {
    try { lease.assertOwned(); } catch { return; }
    mediaOut.send(audio);
  };
  let mediaEpoch = 1;
  const mediaOut = { send: params.onAudioOut };
  try {

  // Independent reads overlap memory-owner/context loading. Attach rejection
  // handlers immediately so an early failure cannot become unhandled.
  const providerRowsPromise = agent.userId
    ? db.select().from(providersTable).where(
        and(eq(providersTable.isActive, true), eq(providersTable.userId, agent.userId))
      ).catch((provErr) => {
        logger.warn({ agentId: params.agentId, provErr }, "Failed to load provider keys — continuing without user keys");
        return [] as Array<typeof providersTable.$inferSelect>;
      })
    : Promise.resolve([] as Array<typeof providersTable.$inferSelect>);

  // Fire attached KB source IDs query immediately so DB latency overlaps with prompt building
  const knowledgeSourceIdsPromise = getAttachedSourceIds(agent.id, agent.knowledgeBaseId).catch(() => [] as number[]);

  // Parse comma-separated end-call phrases
  const endCallPhrases = agent.endCallPhrases
    ? agent.endCallPhrases.split(",").map(s => s.trim()).filter(Boolean)
    : [];

  // A renamed or stripped Irfan row still has to run the intake form.
  if (agent.agentType !== INTAKE_AGENT_TYPE && /^irfan\b/i.test(agent.name ?? "")) {
    agent.agentType = INTAKE_AGENT_TYPE;
    void db.update(agentsTable).set({ agentType: INTAKE_AGENT_TYPE }).where(eq(agentsTable.id, agent.id)).catch((err) => {
      logger.warn({ err, agentId: agent.id }, "intake: could not restore agent type");
    });
  }

  // Irfan talks. He does not fill a form. Drop any saved intake tools on the row.
  let tools = Array.isArray(agent.tools) ? (agent.tools as unknown as AgentTool[]) : [];
  if (agent.agentType === INTAKE_AGENT_TYPE) {
    const hadForm = tools.some((tool) => tool.type.startsWith("intake_"));
    tools = intakeAgentTools();
    if (hadForm) {
      void db.update(agentsTable).set({
        tools: intakeAgentTools() as unknown as Record<string, unknown>[],
        systemPrompt: buildIntakeSystemPrompt(agent.name),
      }).where(eq(agentsTable.id, agent.id)).catch((err) => {
        logger.warn({ err, agentId: agent.id }, "intake: could not drop form tools");
      });
    }
  }

  // Read agentConfig JSONB for advanced settings — normalize legacy snappy Sarvam/engine
  // defaults so existing agents get patient STT without requiring a one-off DB migrate.
  const agentCfg = normalizeCallEngineAgentConfig(
    (agent.agentConfig ?? {}) as Record<string, unknown>,
  ).config;
  // Overlay after normalize so a stale intake row cannot keep Fast barge / VAD.
  // A call placed from admin stays on Sarvam + Cartesia. Other intake calls
  // still use the GPU pod when that address is configured.
  let adminHostedCall = false;
  if (agent.agentType === INTAKE_AGENT_TYPE && params.corrToken) {
    try {
      const [dial] = await db
        .select({ metadata: callsTable.metadata })
        .from(callsTable)
        .where(sql`${callsTable.metadata}::jsonb->>'corrToken' = ${params.corrToken}`)
        .limit(1);
      const meta = dial?.metadata ? JSON.parse(dial.metadata) as { source?: string } : {};
      adminHostedCall = meta.source === "admin_intake_outbound";
    } catch (err) {
      logger.warn({ err, agentId: agent.id }, "intake: could not read admin dial metadata");
    }
  }
  if (agent.agentType === INTAKE_AGENT_TYPE) {
    Object.assign(agentCfg, INTAKE_LOCKED_AGENT_CONFIG);
    if (adminHostedCall) applyAdminHostedStack(agent);
    else if (intakeUsesPod()) applyIntakePodVoice(agent);
    if (agent.ttsProvider === "cartesia") {
      agent.ttsVoice = intakeCartesiaVoiceId(agent.ttsVoice);
    }
  }

  // AMD (voicemail) config — read once, used by both the voicemail-delivery config
  // and the acoustic-confirmation config below. Default action is "hangup" (never
  // leave a message unless explicitly configured).
  const rawAmdAction = agentCfg["voicemailAction"];
  const amdVoicemailAction: "leave_message" | "hangup" | "continue" =
    rawAmdAction === "leave_message" || rawAmdAction === "continue" ? rawAmdAction : "hangup";
  const rawAmdLeadIn = agentCfg["voicemailLeadInSeconds"];
  const amdLeadInSeconds =
    typeof rawAmdLeadIn === "number" && Number.isFinite(rawAmdLeadIn) && rawAmdLeadIn > 0 ? rawAmdLeadIn : undefined;

  // Talk / prompt owns language and TTS style. Platform only adds clock + memory later.
  const agentTimezone = (agentCfg["timezone"] as string | undefined) || "Asia/Kolkata";
  const nowForCtx = new Date();
  const dateCtxParts = nowForCtx.toLocaleDateString("en-IN", {
    weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: agentTimezone,
  });
  const timeCtxParts = nowForCtx.toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", timeZone: agentTimezone,
  });
  let effectiveSystemPrompt = agent.generatedPrompt ?? agent.systemPrompt;
  const scriptMode = (agentCfg["scriptMode"] as string | undefined) ?? "structured";
  // Free-text agents: ignore Identity / Flow / stages — Call script only (call 28884).
  if (
    scriptMode !== "free_text"
    && agent.agentType !== INTAKE_AGENT_TYPE
    && hasPromptCore(agentCfg["promptCore"])
  ) {
    effectiveSystemPrompt = compilePromptCore({
      core: agentCfg["promptCore"],
      fallbackPrompt: effectiveSystemPrompt,
      agentName: agent.name,
      agentLanguage: agent.language,
    });
    logger.info(
      { agentId: params.agentId, compiledChars: effectiveSystemPrompt.length },
      "Compiled structured prompt core",
    );
  } else if (scriptMode === "free_text") {
    logger.info({ agentId: params.agentId }, "Using free-text call script (prompt core skipped)");
  }
  if (agent.agentType === INTAKE_AGENT_TYPE) {
    // Rebuild from the live template so a rename (Irfan vs Meera) is spoken on
    // the next call without waiting for a save, and so existing agents pick up
    // the returning-call / callback instructions.
    effectiveSystemPrompt = buildIntakeSystemPrompt(agent.name);
  }
  // Meeting bots: meeting prompt replaces the call prompt when set.
  // Date/time + memory/context blocks still append below.
  const isMeetBotSession =
    typeof params.fromNumber === "string" && params.fromNumber.startsWith("meetbot-");
  const meetingsCfg = parseMeetingsConfig(agentCfg);
  if (isMeetBotSession) {
    const meetingPrompt = meetingsCfg.meetingPrompt.trim();
    if (meetingPrompt) {
      effectiveSystemPrompt = meetingPrompt;
      logger.info({ agentId: params.agentId }, "Using meeting prompt for meet-bot session");
    }
    effectiveSystemPrompt += `\n\n${MEETING_BEHAVIOR_PROMPT}`;
    if (typeof params.meetingUrl === "string" && params.meetingUrl.trim()) {
      effectiveSystemPrompt +=
        `\n\n[CURRENT MEETING LINK] ${params.meetingUrl.trim()}\n` +
        `Use this URL with schedule_meet_rejoin when participants ask you to rejoin later.`;
    }
    if (meetingsCfg.presentationUrl) {
      effectiveSystemPrompt +=
        `\n\n[PRESENTATION DECK] ${meetingsCfg.presentationUrl}\n` +
        (meetingsCfg.presentationAutoStart
          ? `Screenshare may already be active — use next_slide / previous_slide / goto_slide / stop_presentation as needed.`
          : `Call start_presentation when asked to share slides (url optional).`);
    }
    if (typeof params.meetingMemoryEmail === "string" && params.meetingMemoryEmail.trim()) {
      effectiveSystemPrompt +=
        `\n\n[BOOKING ATTENDEE EMAIL] ${params.meetingMemoryEmail.trim()}\n` +
        `Prefer matching this person in the room by name/email when relevant.`;
    }
  }
  effectiveSystemPrompt += `\n\n[DATE/TIME CONTEXT] Today is ${dateCtxParts}. Current time is ${timeCtxParts} (${agentTimezone}).`;
  // True when the agent is configured to follow the caller's language mid-call
  // (any secondary language set, or explicit languageAutoDetect flag).
  const isMultilingual =
    (Array.isArray(agentCfg["secondaryLanguages"]) && (agentCfg["secondaryLanguages"] as string[]).length > 0) ||
    agentCfg["languageAutoDetect"] === true;

  // Resolve the agent's effective conversation language from its two fields.
  //   • `language`     — the main Transcriber "Language" dropdown (primary control)
  //   • `asrLanguage`  — an optional ASR-only override ("leave blank to use Language")
  // A NON-English value in either field is an explicit, intentional choice, since
  // English is the default in BOTH the edit form (en-US) and the "from scratch"
  // flow (en-IN). So a non-English value wins over an English value in the other
  // field. This fixes two mirror-image bugs that both surfaced as "agent replies
  // in English despite a Tamil selection":
  //   • scratch flow:  language="ta-IN", asrLanguage="en-IN"  → ta-IN
  //   • legacy config: language="en-US", asrLanguage="ta-IN"  → ta-IN
  // When both are English, both non-English, or only one is set, the main
  // `language` field wins (falling back to asrLanguage only if language is empty).
  const effectiveAgentLang: string | null = (() => {
    const L = (agent.language ?? "").trim();
    const A = (agent.asrLanguage ?? "").trim();
    const isEn = (x: string) => x.toLowerCase().startsWith("en");
    if (L && A) {
      if (isEn(L) && !isEn(A)) return A;
      if (!isEn(L) && isEn(A)) return L;
      return L;
    }
    return L || A || null;
  })();

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

  // Security & identity guardrails (prompt-injection resistance, no leaking of
  // internal instructions/tools, consistent "are you AI?" handling). Appended
  // after compliance disclosures so its identity rule defers to any mandatory
  // AI disclosure (IRDAI/RBI) added above.
  effectiveSystemPrompt = appendGuardrails(effectiveSystemPrompt, agent.name);

  // 80 was too tight for Tamil/Hinglish — call 2643 hit the cap mid-sentence
  // twice (outputTokens≈91 on "…அதுக்கு ஒரு fifteen" / "…இப்போ demo-க்கு");
  // 160 still clipped occasionally (Indic scripts run 2-4× English tokens/word),
  // so the voice default is now 200. This is a protective cap, not a target —
  // typical turns end naturally at 30-80 tokens, so raising it does not slow
  // normal replies; it only stops long ones being cut mid-sentence.
  // Voice default max tokens. Sarvam thinking is OFF by default for live calls
  // (reasoning leaks into spoken audio). Keep a healthy spoken-content budget.
  const isSarvamLlm = (agent.llmProvider ?? "").toLowerCase() === "sarvam";
  const VOICE_DEFAULT_MAX_TOKENS = Number(
    process.env.VOICE_DEFAULT_MAX_TOKENS ?? (isSarvamLlm ? 500 : 200),
  );
  // "llmMaxTokens" present-but-null is an explicit "reset to default" from the
  // dashboard/admin (the update route MERGES agentConfig, so the key persists
  // once written). Only consult the legacy "maxTokens" key when the new key is
  // entirely absent — `null ?? legacy` would silently resurrect a stale cap.
  const configuredLlmMaxTokens = "llmMaxTokens" in agentCfg
    ? agentCfg["llmMaxTokens"]
    : agentCfg["maxTokens"];
  // Builder used to persist 200 as the form default. That clips Indic Sarvam
  // replies; treat the old factory cap as "unset" so voice uses 500.
  const resolvedMaxTokens = typeof configuredLlmMaxTokens === "number"
    ? (isSarvamLlm && configuredLlmMaxTokens === 200 ? VOICE_DEFAULT_MAX_TOKENS : configuredLlmMaxTokens)
    : VOICE_DEFAULT_MAX_TOKENS;
  const groqGemmaWithTools =
    (agent.llmProvider ?? "").toLowerCase() === "groq"
    && (agent.llmModel ?? "").trim() === "gemma2-9b-it"
    && tools.length > 0;
  if (groqGemmaWithTools) {
    logger.warn(
      { agentId: agent.id, toolCount: tools.length },
      "Groq gemma2-9b-it cannot call tools — routing this call to llama-3.1-8b-instant",
    );
  }

  const voiceStack = resolveVoiceStack(agentCfg["voiceStack"] as string | undefined);

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
      maxTokens: resolvedMaxTokens,
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
      // Voice: thinking OFF unless the agent explicitly opts into medium/high.
      // Historical default "low" streamed English CoT into TTS (call 5646).
      // Treat stored "low" the same as off for live calls; null disables.
      ...(agentCfg["reasoningEffort"] === "medium" || agentCfg["reasoningEffort"] === "high"
        ? { reasoningEffort: agentCfg["reasoningEffort"] as "medium" | "high" }
        : isSarvamLlm
          ? { reasoningEffort: null }
          : {}),
    },
    // Meet bots use meeting-specific length/silence (Builder → Meetings), not
    // phone maxDuration / silenceTimeoutSeconds — waiting for late joiners is normal.
    maxDuration: isMeetBotSession
      ? meetingsCfg.maxDurationSeconds
      : (agent.maxDuration ?? 600),
    asrProvider: agent.asrProvider,
    asrModel: agent.asrModel,
    llmProvider: agent.llmProvider,
    llmModel: groqGemmaWithTools ? "llama-3.1-8b-instant" : agent.llmModel,
    fallbackLlmProvider: agent.llmFallbackProvider ?? null,
    fallbackLlmModel: agent.llmFallbackModel ?? null,
    ttsProvider: agent.ttsProvider,
    ttsVoice: agent.ttsVoice,
    ttsModel: agent.ttsModel,
    telephonyProvider: agent.telephonyProvider,
    greetingMessage: agent.greetingMessage ?? null,
    scriptMode: agentCfg["scriptMode"] === "free_text" ? "free_text" : "structured",
    firstSpeaker: agent.firstSpeaker === "user" ? "user" : "assistant",
    endCallPhrases,
    // Fall back to a default so idle/dead-air calls self-terminate instead of
    // lingering until the stuck-call sweep. `?? ` keeps an explicit 0 (disabled)
    // and any explicit value the agent configured. Meet bots: longer patience or off.
    silenceTimeoutSeconds: isMeetBotSession
      ? (meetingsCfg.silenceHangupEnabled ? meetingsCfg.silenceTimeoutSeconds : 0)
      : (agent.silenceTimeoutSeconds ?? DEFAULT_SILENCE_TIMEOUT_SECONDS),
    ...(isMeetBotSession ? { isMeetingSession: true } : {}),
    // AgentConfig.language is the agent's SPOKEN language — it drives the
    // pipeline's [LANGUAGE — ABSOLUTE RULE] block and the TTS voice language.
    // Use the unified resolver so the language rule, TTS, and STT all agree.
    language: effectiveAgentLang,
    languageAutoDetect: isMultilingual,
    autoSwitchToEnglish: agentCfg["autoSwitchToEnglish"] === true,
    backchannelingEnabled: agent.agentType === INTAKE_AGENT_TYPE
      || agent.backchannelingEnabled !== false,
    backchannelingFrequency: agent.agentType === INTAKE_AGENT_TYPE
      ? 1
      : (agent.backchannelingFrequency ?? null),
    backchannelFillers: agent.agentType === INTAKE_AGENT_TYPE
      ? [...INTAKE_BACKCHANNEL_FILLERS]
      : parseBackchannelPhrases(agent.backchannelPhrases),
    webhookUrl: agent.webhookUrl ?? null,
    noiseCancellationEnabled: agent.agentType === INTAKE_AGENT_TYPE
      || agent.noiseCancellationEnabled === true,
    forceSoftwareNoiseGate: agentCfg[FORCE_SOFTWARE_NOISE_GATE_KEY] === true,
    ambientNoiseEnabled: (agentCfg["ambientNoiseEnabled"] as boolean | undefined) ?? false,
    ambientNoiseTrack: (agentCfg["ambientNoiseTrack"] as string | undefined) ?? null,
    ambientNoiseVolume: (() => {
      const v = agentCfg["ambientNoiseVolume"];
      if (typeof v !== "number" || !Number.isFinite(v)) return 1.0;
      return Math.max(0, Math.min(1, v));
    })(),
    inactivityMessage: agent.inactivityMessage ?? null,
    guardrailRoutes: (agentCfg["guardrailRoutes"] as Array<{ name: string; scoreThreshold: number; utterances: string; response: string }> | undefined) ?? [],
    ivrEnabled: (agentCfg["ivrEnabled"] as boolean | undefined) ?? false,
    ivrGreeting: (agentCfg["ivrGreeting"] as string | undefined) ?? null,
    ivrOptions: (agentCfg["ivrOptions"] as Array<{ digit: string; label: string; targetAgentId?: number }> | undefined) ?? [],
    sttConfig: {
      // STT recognizes the same language the agent speaks. Using the unified
      // resolver (instead of raw asrLanguage-first) means a stale/mismatched
      // asrLanguage:"en-IN" no longer forces English recognition of a Tamil call.
      language: effectiveAgentLang,
      backgroundDenoising: agent.asrBackgroundDenoising ?? false,
      confidenceThreshold: agent.asrConfidenceThreshold ?? 0.40,
      endOfTurnConfidence: agent.asrEndOfTurnConfidence ?? 0.70,
      // Prefer Latency Tuning UI (asrEndpointingSilenceMs). The asrEndOfTurnTimeout
      // column is admin-only and historically defaulted to 5000 — that alone added
      // up to 2s of Deepgram endpointing dead air when the UI knob was ignored.
      endOfTurnTimeout: (() => {
        const fromUi = agentCfg["asrEndpointingSilenceMs"];
        if (typeof fromUi === "number" && Number.isFinite(fromUi) && fromUi > 0) {
          return Math.max(50, Math.min(5000, Math.round(fromUi)));
        }
        if (typeof agent.asrEndOfTurnTimeout === "number" && agent.asrEndOfTurnTimeout > 0) {
          return Math.max(50, Math.min(30000, Math.round(agent.asrEndOfTurnTimeout)));
        }
        return 400;
      })(),
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
    // P1-B: Knowledge Base RAG (resolved asynchronously in parallel pre-fetch below)
    knowledgeBaseId: agent.knowledgeBaseId ?? null,
    knowledgeSourceIds: [],
    // P1-C: Webhook HMAC secret
    webhookSecret: (agentCfg["webhookSecret"] as string | undefined) ?? null,
    // P1-D: VAD / Barge-in tuning (defaults match the hardcoded pipeline constants)
    vadSilenceMs:           (agentCfg["vadSilenceMs"]           as number  | undefined) ?? 0,
    bargeInEnabled:         (agentCfg["bargeInEnabled"]         as boolean | undefined) ?? true,
    // Mic Sensitivity is not in Builder — all calls use Low. Legacy saved
    // bargeInEnergyThreshold=1200 (Normal form default) is rewritten to Low's
    // 1800 so existing agents pick it up without a UI re-save (call 5718).
    bargeInEnergyThreshold: resolveBargeInEnergyThreshold(agentCfg["bargeInEnergyThreshold"]),
    bargeInMinFrames:       (agentCfg["bargeInMinFrames"]       as number  | undefined) ?? 4,
    // Empirical PSTN soft-guard window (VoBiz/Twilio). AEC3 handles linear
    // echo; residual policy still uses bargeInEchoGraceMs / PARTIAL_BARGE_MIN_PLAY_MS.
    bargeInEchoGraceMs:     0,
    micSensitivity:         resolveMicSensitivity(agentCfg["micSensitivity"] as string | undefined),
    // P1-E: Agent timezone
    timezone: agentTimezone,
    // Call recording
    recordingEnabled:              (agentCfg["recordingEnabled"]              as boolean | undefined) ?? false,
    // P1-F: Caller gender detection
    // Default OFF when the field is absent — matches the dashboard/admin UI
    // display default (?? false). Older agents without the field behave as OFF.
    genderDetectionEnabled:        (agentCfg["genderDetectionEnabled"]        as boolean | undefined) ?? false,
    genderDetectionMaleSalutation: (agentCfg["genderDetectionMaleSalutation"] as string  | undefined) ?? "Sir",
    genderDetectionFemaleSalutation: (agentCfg["genderDetectionFemaleSalutation"] as string | undefined) ?? "Ma'am",
    genderDetectionNeutralSalutation: (agentCfg["genderDetectionNeutralSalutation"] as string | undefined) ?? "",
    // Voice Memory — default OFF (opt-in). Remembers voiceprints + mid-call handoff.
    voiceMemoryEnabled:            (agentCfg["voiceMemoryEnabled"]            as boolean | undefined) ?? false,
    // P1-G: Engine — interruption & pacing
    // Barge only when the STT final has this many words (Bolna number_of_words).
    wordsForInterruption: (typeof agentCfg["wordsForInterruption"] === "number"
      && agentCfg["wordsForInterruption"] > 0)
      ? agentCfg["wordsForInterruption"]
      : 3,
    // Post-utterance WAIT before TTS. Always 0 — saved 350/500/900 values
    // added ~1s of dead air every turn (call 20737).
    incrementalDelay: 0,
    ttsSpeed:             (agentCfg["ttsSpeed"]             as number | undefined) ?? 1.0,
    sarvamIndicNumbers:   agentCfg["sarvamIndicNumbers"] !== false,
    // P1-H: Call lifecycle
    hangupAfterLlmCall: (agentCfg["hangupAfterLlmCall"] as boolean | undefined) ?? false,
    // P1-I: Start Speaking Plan — trust STT final (0); rewrite platform 0.1/1.5/0.5 waits.
    startSpeakingPlan: resolveStartSpeakingPlan(
      agentCfg["startSpeakingPlan"] as AgentConfig["startSpeakingPlan"] | undefined,
    ),
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
    asrEndpointingSilenceMs: (agentCfg["asrEndpointingSilenceMs"] as number | undefined) ?? 500,
    llmMaxTokens: (agentCfg["llmMaxTokens"] as number | null | undefined) ?? null,
    ttsMinSentenceChars: resolveTtsMinSentenceChars(
      agentCfg["ttsMinSentenceChars"] as number | undefined,
    ),
    fragmentCoalesceListeningMs: (() => {
      const v = agentCfg["fragmentCoalesceListeningMs"];
      if (typeof v !== "number" || !Number.isFinite(v)) return FRAGMENT_COALESCE_DEFAULTS.listeningMs;
      return Math.max(0, Math.min(2000, Math.round(v)));
    })(),
    fragmentCoalescePlayingMs: (() => {
      const v = agentCfg["fragmentCoalescePlayingMs"];
      if (typeof v !== "number" || !Number.isFinite(v)) return FRAGMENT_COALESCE_DEFAULTS.playingMs;
      return Math.max(0, Math.min(3000, Math.round(v)));
    })(),
    telephonyTailDrainMs: (() => {
      const v = agentCfg["telephonyTailDrainMs"];
      if (typeof v !== "number" || !Number.isFinite(v)) return 0;
      const ms = Math.max(0, Math.min(2000, Math.round(v)));
      return ms === 400 || ms === 80 ? 0 : ms;
    })(),
    sarvamSttMode: (agent.asrProvider ?? "").toLowerCase() === "sarvam"
      ? resolveSarvamSttMode(
          agent.asrLanguage || agent.language || "en-IN",
          (agentCfg["sarvamSttMode"] as string | undefined) ?? null,
        )
      : ((agentCfg["sarvamSttMode"] as string | undefined) ?? null),
    sarvamSttStreamType: resolveRealtimeStreamType(agentCfg["sarvamSttStreamType"]),
    sarvamSttPrompt: agent.agentType === INTAKE_AGENT_TYPE
      ? buildIntakeSttPrompt()
      : (typeof agentCfg["sarvamSttPrompt"] === "string"
        ? (agentCfg["sarvamSttPrompt"] as string)
        : null),
    sarvamHighVadSensitivity: resolveSarvamHighVadSensitivity(agentCfg["sarvamHighVadSensitivity"]),
    sarvamSpeechEndFlushMs: clampSarvamSpeechEndFlushMs(agentCfg["sarvamSpeechEndFlushMs"] as number | undefined),
    sarvamIncompleteHoldMs: clampSarvamIncompleteHoldMs(agentCfg["sarvamIncompleteHoldMs"] as number | undefined),
    // Wall-clock VAD windows; the adapter converts them to frames at the live
    // sample rate. Null means "leave the provider default alone".
    sarvamFirstTurnMinSpeechMs: optionalMs(agentCfg["sarvamFirstTurnMinSpeechMs"]),
    sarvamEndOfSpeechSilenceMs: resolveSarvamEndpointingMs(agentCfg),
    sarvamVadThreshold: optionalUnitInterval(agentCfg["sarvamVadThreshold"]),
    semanticTurnDetection: false,
    semanticTurnStopMs: clampSemanticTurnStopMs(agentCfg["semanticTurnStopMs"]),
    kbBakedOnly: (agentCfg["kbBakedOnly"] as boolean | undefined) ?? false,
    voiceStack,
    geminiLive: voiceStack === "gemini_live"
      ? {
          model: resolveGeminiLiveModel(
            (agentCfg["geminiLive"] as Record<string, unknown> | undefined)?.["model"] as string | undefined,
          ),
          voiceName: resolveGeminiLiveVoice(
            (agentCfg["geminiLive"] as Record<string, unknown> | undefined)?.["voiceName"] as string | undefined,
          ),
          thinkingLevel: resolveGeminiLiveThinkingLevel(
            (agentCfg["geminiLive"] as Record<string, unknown> | undefined)?.["thinkingLevel"] as string | undefined,
          ),
        }
      : null,
    openaiRealtime: voiceStack === "openai_realtime"
      ? {
          model: resolveOpenAIRealtimeModel(
            (agentCfg["openaiRealtime"] as Record<string, unknown> | undefined)?.["model"] as string | undefined,
          ),
          voiceName: resolveOpenAIRealtimeVoice(
            (agentCfg["openaiRealtime"] as Record<string, unknown> | undefined)?.["voiceName"] as string | undefined,
          ),
        }
      : null,
  };
  // Propagate endpointing silence into STTConfig so Azure adapter picks it up
  agentConfig.sttConfig.endpointingSilenceMs = agentConfig.asrEndpointingSilenceMs;

  // ── Parallel pre-fetch: caller memory + campaign lead + knowledge base ───────
  // All three are independent DB reads — fire simultaneously to avoid sequential
  // round-trips that add 20-60 ms to call setup latency.
  // Resolve the caller-memory key. canonicalizeCallerKey / resolveCallerKey are the
  // SINGLE source of truth for the memory key — the same functions the write path
  // uses — so read and write can never drift again.
  // - Webcall: fromNumber is "webcall-user-<userId>"; canonicalizeCallerKey maps it
  //   to the synthetic "webcall:user_<id>" so memory is captured per-user-id.
  // - Telephony: pick the HUMAN side by direction. Inbound keys off the caller
  //   (fromNumber); outbound keys off the dialed party (toNumber) — never the
  //   shared platform fromNumber, which would collapse every outbound caller onto
  //   one key. Placeholder/sentinel + missing numbers resolve to null (cold start).
  const callDirection: CallDirection = params.callDirection ?? "inbound";
  // Meeting bots normally key off meetbot-<mid> (no personal memory). When
  // Meeting passMemory + memoryPhone are set (e.g. booking auto-join),
  // load contact memory under that phone while the call log stays on meetbot-*.
  let callerPhone = isWebcall
    ? canonicalizeCallerKey(params.fromNumber)
    : resolveCallerKey(callDirection, params.fromNumber, params.toNumber);
  if (
    isMeetBotSession &&
    params.passMemory !== false &&
    typeof params.meetingMemoryPhone === "string" &&
    params.meetingMemoryPhone.trim()
  ) {
    callerPhone = canonicalizeCallerKey(params.meetingMemoryPhone.trim());
  } else if (isMeetBotSession && params.passMemory === false) {
    callerPhone = null;
  }
  // Persona fingerprint for caller-memory whiplash detection: when the agent is
  // repurposed (e.g. real-estate → insurance), stale domain memory keyed on
  // (agentId, phone) must not bleed into the new persona. Identity (name/role/
  // company) when promptCore is set; otherwise the RAW system prompt — never
  // effectiveSystemPrompt (which varies per call with date/KB/memory).
  const personaHash = computeAgentPersonaHash({
    systemPrompt: agent.systemPrompt,
    promptCore: agentCfg["promptCore"],
  });
  let callerProfileSnapshot: CallerProfile | null = null;
  let resumeDroppedCall = false;
  let latchedFactsMap = new Map<string, string>();
  // Tracks the name latched THIS call via latchCallerName (caller said "my name is X").
  // Kept separate from callerProfileSnapshot.name so we can detect contamination at call-end.
  let callerNameLatchedThisCall: string | null = null;
  // Trust tier of that latch ("A" = explicit self-intro, "B" = ambiguous "I am X").
  // Threaded to updateCallerProfile so only Tier A latches override a
  // conflicting LLM-extracted name at call-end.
  let callerNameLatchTier: NameLatchTier | null = null;

  // KB size cap (latency): cap the baked full-KB block appended to the static
  // system prompt. The full document is largely redundant with the live
  // per-turn KB retrieval (retrieveKbContextMulti in pipeline.ts, which still
  // injects the relevant slice every turn regardless of this cap), so a large
  // baked block mostly just bloats the cached prefix and per-turn input
  // tokens / TTFT.
  //
  // Default is provider-scoped: `google` agents get 8000 chars (only very
  // large KBs are trimmed — Gemini context caching absorbs the prefix);
  // everyone else gets 4000 (reduces prefill cost for small/fast models).
  // The KB_INJECT_MAX_CHARS env var, when set (any value, including 0 to
  // disable capping), overrides the default for ALL providers.
  //
  // The cap is passed INTO buildKnowledgeBaseBlockEx so the budget is split
  // FAIRLY across all attached sources (with rollover) — a post-hoc slice of
  // the joined block would let source 1 consume the whole budget and starve
  // source 2 (call 2159).
  const KB_INJECT_DEFAULT_GEMINI_CHARS = 8000;
  const KB_INJECT_DEFAULT_ALL_CHARS = 4000;
  const kbMaxEnv = process.env["KB_INJECT_MAX_CHARS"];
  const kbMaxCharsRaw =
    kbMaxEnv !== undefined && kbMaxEnv.trim() !== ""
      ? Number.parseInt(kbMaxEnv, 10)
      : agent.llmProvider?.toLowerCase() === "google"
        ? KB_INJECT_DEFAULT_GEMINI_CHARS
        : KB_INJECT_DEFAULT_ALL_CHARS;
  const kbBakedMaxChars =
    Number.isFinite(kbMaxCharsRaw) && kbMaxCharsRaw > 0 ? kbMaxCharsRaw : undefined;
  // The Krutrim auto-summary entry (kb-source-summary.ts) is generated
  // per-SOURCE, but a source can be shared with non-Krutrim agents. Keep it
  // out of every other provider's baked block so behavior for non-Krutrim
  // agents is completely unchanged.
  const kbExcludeTitles =
    agent.llmProvider?.toLowerCase() === "krutrim" ? undefined : [KRUTRIM_AUTO_SUMMARY_TITLE];

  // Squad-shared memory: members of one squad read/write ONE caller record
  // (keyed under the squad's canonical owner agent) so every teammate
  // recognizes the caller. Solo agents: owner = self (unchanged behavior).
  let memoryOwnerAgentId = params.agentId;
  try {
    memoryOwnerAgentId = await resolveSquadMemoryOwnerAgentId(params.agentId, agent.userId, params.squadId ?? null);
  } catch { /* non-fatal — fall back to own agentId */ }
  // Booking attendee email → existing caller memory (email fact → phone key).
  if (
    isMeetBotSession &&
    params.passMemory !== false &&
    !callerPhone &&
    typeof params.meetingMemoryEmail === "string" &&
    params.meetingMemoryEmail.trim()
  ) {
    try {
      const byEmail = await findCallerPhoneByEmail(
        memoryOwnerAgentId,
        params.meetingMemoryEmail.trim(),
      );
      if (byEmail) {
        callerPhone = byEmail;
        logger.info(
          { agentId: params.agentId, email: params.meetingMemoryEmail.trim() },
          "Meet-bot memory resolved via attendee email",
        );
      }
    } catch (err) {
      logger.warn({ err }, "Meet-bot email memory lookup failed");
    }
  }
  // Persona-swap invalidation compares the answering agent's prompt hash; with
  // a shared owner record + different member prompts it would false-fire and
  // wipe squad memory on every member alternation — disable it when shared.
  const memoryPersonaHash = memoryOwnerAgentId === params.agentId ? personaHash : undefined;

  const [
    callerCtxResult,
    campaignLeadResult,
    kbEntriesResult,
    providerRowsResult,
    upcomingBookingsResult,
    inboundSheetLookupResult,
    priorIntakeResult,
    afterCallInstruction,
  ] = await Promise.all([
    // 1. Caller memory (3-layer: profile + facts + archive)
    callerPhone
      ? loadCallerContext(memoryOwnerAgentId, callerPhone, memoryPersonaHash).catch((memErr) => {
          logger.warn({ agentId: params.agentId, callerPhone, memErr }, `Failed to load caller context — ${memErr instanceof Error ? memErr.message : String(memErr)} — continuing without memory`);
          return null;
        })
      : Promise.resolve(null),

    // 2. Campaign lead variables + recent operator notes
    params.campaignLeadId
      ? db.select().from(campaignLeadsTable).where(eq(campaignLeadsTable.id, params.campaignLeadId))
          .then(async ([lead]) => {
            if (!lead) return null;
            const notes = await db.select({ body: leadNotesTable.body })
              .from(leadNotesTable)
              .where(eq(leadNotesTable.leadId, lead.id))
              .orderBy(desc(leadNotesTable.createdAt))
              .limit(5)
              .catch((noteErr) => {
                logger.warn({ campaignLeadId: params.campaignLeadId, noteErr }, "Failed to load lead notes — continuing without them");
                return [] as Array<{ body: string }>;
              });
            return { ...lead, recentNotes: notes.map((n) => n.body).filter((b) => b?.trim()) };
          })
          .catch((leadErr) => {
            logger.warn({ campaignLeadId: params.campaignLeadId, leadErr }, "Failed to load campaign lead — continuing without lead vars");
            return null;
          })
      : Promise.resolve(null),

    // 3. Knowledge base (pre-fetched source IDs + fair per-source budgeting)
    (async () => {
      const sourceIds = await knowledgeSourceIdsPromise;
      agentConfig.knowledgeSourceIds = sourceIds;
      if (sourceIds.length === 0) return null;
      return buildKnowledgeBaseBlockEx(sourceIds, kbBakedMaxChars, kbExcludeTitles).catch((kbErr) => {
        logger.warn({ agentId: params.agentId, knowledgeSourceIds: sourceIds, kbErr }, "Failed to load knowledge base — continuing without it");
        return null;
      });
    })(),

    // 4. Provider API keys — independent of above, fetch in parallel
    providerRowsPromise,

    // 5. Upcoming bookings (pre-fetched in parallel). Meet bots use the contact
    // phone / source call — not meetbot-* synthetic numbers.
    ((!isWebcall || isMeetBotSession) && callerPhone)
      ? (async () => {
          const callerRawNumber = isMeetBotSession
            ? (params.meetingMemoryPhone?.trim() || null)
            : (callDirection === "outbound" ? params.toNumber : params.fromNumber);
          if (!agent.id) return [];
          const now = new Date();
          const sourceCallId =
            isMeetBotSession && typeof params.meetingSourceCallId === "number" && params.meetingSourceCallId > 0
              ? params.meetingSourceCallId
              : null;
          if (!callerRawNumber && !sourceCallId) return [];
          return db
            .select({
              slotStart: bookingsTable.slotStart,
              slotEnd: bookingsTable.slotEnd,
              status: bookingsTable.status,
              meetLink: bookingsTable.meetLink,
              eventName: eventTypesTable.name,
              bookingId: bookingsTable.id,
            })
            .from(bookingsTable)
            .innerJoin(callsTable, eq(bookingsTable.callId, callsTable.id))
            .leftJoin(eventTypesTable, eq(bookingsTable.eventTypeId, eventTypesTable.id))
            .where(
              and(
                eq(callsTable.agentId, agent.id),
                or(
                  ...(callerRawNumber
                    ? [
                        eq(callsTable.fromNumber, callerRawNumber),
                        eq(callsTable.toNumber, callerRawNumber),
                      ]
                    : []),
                  ...(sourceCallId ? [eq(bookingsTable.callId, sourceCallId)] : []),
                ),
                gt(bookingsTable.slotStart, now),
                ne(bookingsTable.status, "cancelled"),
              ),
            )
            .orderBy(bookingsTable.slotStart)
            .limit(3)
            .catch(() => []);
        })()
      : Promise.resolve([]),

    // 6. Inbound Automatic Calls sheet lookup (pre-fetched in parallel)
    (callDirection === "inbound" && !isWebcall && agent.userId && params.fromNumber?.trim())
      ? Promise.race([
          lookupSheetsForSession(agent.userId, params.agentId, params.fromNumber).catch(() => null),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
        ])
      : Promise.resolve(null),

    // 7. Prior candidate intake for this number — returning-call opener + form resume
    agent.agentType === INTAKE_AGENT_TYPE && callerPhone
      ? findIntakeForCaller({ agentId: params.agentId, phone: callerPhone }).catch((err) => {
          logger.warn({ agentId: params.agentId, err }, "intake: prior-form lookup failed");
          return null;
        })
      : Promise.resolve(null),

    agent.agentType === INTAKE_AGENT_TYPE
      ? Promise.resolve(null)
      : afterCallInstructionForAgent(agent.id).catch((err) => {
          logger.warn({ agentId: agent.id, err }, "after-call instruction lookup failed");
          return null;
        }),
  ]);

  // Apply caller memory to system prompt
  if (callerCtxResult) {
    callerProfileSnapshot = callerCtxResult.profile;
    resumeDroppedCall = isResumeDroppedCall(callerCtxResult);
    for (const f of callerCtxResult.facts) latchedFactsMap.set(f.key, f.value);

    // Override STT language from caller memory language_pref fact — only when the
    // agent is in auto-detect mode. Strict fixed-language agents must not inherit
    // a remembered preference from a prior multilingual call.
    if (agentConfig.languageAutoDetect) {
      const langPrefRaw = latchedFactsMap.get("language_pref");
      const mappedSttLang = mapLanguagePrefToBcp47(langPrefRaw);
      if (mappedSttLang && mappedSttLang !== agentConfig.sttConfig.language) {
        const prevSttLang = agentConfig.sttConfig.language;
        agentConfig.sttConfig.language = mappedSttLang;
        agentConfig.language = mappedSttLang;
        // Also patch the in-memory profile so the language-injection block below
        // seeds initialLanguage from the fact-based preference rather than the
        // DB-stored preferredLanguage (which reflects old calls in the wrong language).
        if (callerProfileSnapshot) {
          callerProfileSnapshot = { ...callerProfileSnapshot, preferredLanguage: mappedSttLang };
        }
        logger.info(
          { agentId: params.agentId, callerPhone, langPref: langPrefRaw, from: prevSttLang, to: mappedSttLang },
          "STT language overridden from caller memory language_pref",
        );
        if ((agent.asrProvider ?? "").toLowerCase() === "sarvam") {
          agentConfig.sarvamSttMode = resolveSarvamSttMode(
            mappedSttLang,
            (agentCfg["sarvamSttMode"] as string | undefined) ?? null,
          );
        }
      }
    }

    if (
      agent.agentType !== INTAKE_AGENT_TYPE
      && (callerProfileSnapshot || callerCtxResult.facts.length > 0 || callerCtxResult.recentCalls.length > 0)
    ) {
      agentConfig.systemPrompt = injectEnhancedMemory(agentConfig.systemPrompt, callerCtxResult, {
        suppressGenderFact: !agentConfig.genderDetectionEnabled,
        agentName: agent.name,
      });
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

  agentConfig.systemPrompt += `\n\n${buildOpeningLanguageRule({
    memoryLanguagePref:
      latchedFactsMap.get("language_pref")
      ?? callerProfileSnapshot?.preferredLanguage
      ?? null,
    agentLanguage: effectiveAgentLang,
    languageAutoDetect: agentConfig.languageAutoDetect === true,
  })}`;

  // ── Inject DB-backed upcoming bookings (pre-fetched in parallel) ─────────────
  // Meet bots: also inject upcoming bookings when we have a contact phone so
  // the agent can reschedule without guessing booking ids.
  if ((!isWebcall || isMeetBotSession) && callerPhone && upcomingBookingsResult && upcomingBookingsResult.length > 0) {
    try {
      const tz = (agentCfg["timezone"] as string | undefined) || "Asia/Kolkata";
      const now = new Date();
      const ymdInTz = (d: Date): string => d.toLocaleDateString("en-CA", { timeZone: tz }); // YYYY-MM-DD
      const dayDelta = (from: string, to: string): number => {
        const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
        const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
        return Math.round((b - a) / 86_400_000);
      };
      const todayYmd = ymdInTz(now);
      const relWord = (delta: number): string =>
        delta === 0 ? "today" : delta === 1 ? "tomorrow" : delta < 0 ? `${Math.abs(delta)} day(s) ago` : `in ${delta} days`;

      const todayReadable = now.toLocaleDateString("en-IN", {
        weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: tz,
      });
      const lines = upcomingBookingsResult.map((b) => {
        const abs = b.slotStart.toLocaleString("en-IN", {
          weekday: "long", day: "numeric", month: "long", year: "numeric",
          hour: "numeric", minute: "2-digit", hour12: true, timeZone: tz,
        });
        const delta = dayDelta(todayYmd, ymdInTz(b.slotStart));
        const title = b.eventName ? `"${b.eventName}"` : "the meeting";
        const idPart = "bookingId" in b && typeof (b as { bookingId?: number }).bookingId === "number"
          ? ` booking_id=${(b as { bookingId: number }).bookingId}`
          : "";
        const linkPart = b.meetLink ? ` meet_link=${b.meetLink}` : "";
        return `- ${title} on ${abs} (that is ${relWord(delta)}).${idPart}${linkPart}`;
      });

      agentConfig.systemPrompt +=
        `\n\n[UPCOMING BOOKINGS — LIVE FROM CALENDAR, AUTHORITATIVE]\n` +
        `Today is ${todayReadable}. This caller has the following confirmed upcoming meeting(s). ` +
        `Use these EXACT dates and times — they OVERRIDE any relative day-words ("tomorrow", "next week") ` +
        `that may appear in the caller memory above, which could be stale.\n` +
        lines.join("\n") +
        `\nWhen you refer to a meeting, say the relative day-word that is correct for TODAY ` +
        `(e.g. only say "tomorrow" if it is genuinely the next day; say "today" if it is today).` +
        (isMeetBotSession
          ? `\nTo move a meeting, call reschedule with the booking_id above. A SnapServe agent will auto-join the new slot when a Meet link exists.`
          : "");

      logger.info(
        { agentId: params.agentId, callerPhone, bookingCount: upcomingBookingsResult.length },
        "Upcoming bookings injected into system prompt",
      );
    } catch (bookingErr) {
      logger.warn(
        { agentId: params.agentId, callerPhone, bookingErr },
        "Failed to load upcoming bookings — continuing without booking context",
      );
    }
  }

  // ── Inject prior-call resume context (network-drop callback) ─────────────────
  if (params.resumeContext) {
    const rc = params.resumeContext;
    const sections: string[] = ["=== PREVIOUS CALL CONTEXT ==="];
    sections.push(`Summary: ${rc.summary}`);
    if (rc.extractedFacts?.length) {
      sections.push(`Customer facts already collected:\n${rc.extractedFacts.map(f => `- ${f}`).join("\n")}`);
    }
    if (rc.completedSteps?.length) {
      sections.push(`Steps already completed:\n${rc.completedSteps.map(s => `- ${s}`).join("\n")}`);
    }
    if (rc.pendingSteps?.length) {
      sections.push(`Steps still pending (start from the first one):\n${rc.pendingSteps.map(s => `- ${s}`).join("\n")}`);
    }
    if (rc.lastAgentMessage) {
      sections.push(`Last thing the agent said: "${rc.lastAgentMessage}"`);
    }
    if (rc.lastCustomerMessage) {
      sections.push(`Last thing the customer said: "${rc.lastCustomerMessage}"`);
    }
    if (rc.toolResults?.length) {
      sections.push(`=== TOOL STATE (do NOT re-execute these) ===\n${rc.toolResults.map(t => `- ${t}`).join("\n")}`);
    }
    sections.push(
      `=== RESUME DIRECTIVE ===\n` +
      `The caller was disconnected mid-call. If YOU speak the first opening line of THIS call, ` +
      `open warmly and briefly acknowledge the drop once, then wait for them to confirm. ` +
      `If an opening greeting was already spoken, do NOT mention any cut/drop/lost call — just continue. ` +
      `Once they are back, resume from where it left off without saying "pick up from where we left off". ` +
      `NEVER re-ask for information already listed in Customer facts. ` +
      `NEVER repeat steps already marked as completed. ` +
      `NEVER re-execute tools listed in TOOL STATE.`
    );
    agentConfig.systemPrompt += `\n\n${sections.join("\n\n")}`;
    logger.info({ agentId: params.agentId }, "Resume context injected into system prompt for network-drop callback");
  }

  // Meeting bot: inject prior phone-call summary when
  // passCallContext is on and the launch token carried a sourceCallId.
  if (
    isMeetBotSession &&
    params.passCallContext !== false &&
    typeof params.meetingSourceCallId === "number" &&
    params.meetingSourceCallId > 0
  ) {
    try {
      const [prior] = await db
        .select({
          callSummary: callsTable.callSummary,
          transcript: callsTable.transcript,
        })
        .from(callsTable)
        .where(eq(callsTable.id, params.meetingSourceCallId))
        .limit(1);
      const summary =
        (prior?.callSummary && prior.callSummary.trim()) ||
        (prior?.transcript
          ? prior.transcript.trim().slice(0, 1200) + (prior.transcript.length > 1200 ? "…" : "")
          : "");
      if (summary) {
        agentConfig.systemPrompt +=
          `\n\n=== PRIOR CALL CONTEXT (for this meeting) ===\n` +
          `This meeting follows a phone call with the same person.\n` +
          `Summary / notes:\n${summary}\n` +
          `Use this to continue the conversation — do not re-ask for facts already covered unless confirming.`;
        logger.info(
          { agentId: params.agentId, sourceCallId: params.meetingSourceCallId },
          "Prior call context injected into meet-bot prompt",
        );
      }
    } catch (ctxErr) {
      logger.warn(
        { agentId: params.agentId, sourceCallId: params.meetingSourceCallId, ctxErr },
        "Failed to load prior call context for meet-bot",
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
    // Sheet / lead name aliases for {{customer_name}} / {{caller_name}}
    if (campaignLeadVars.name?.trim()) {
      if (!campaignLeadVars["customer_name"]) campaignLeadVars["customer_name"] = campaignLeadVars.name;
      if (!campaignLeadVars["caller_name"]) campaignLeadVars["caller_name"] = campaignLeadVars.name;
    }
    const recentNotes = (campaignLeadResult as { recentNotes?: string[] }).recentNotes;
    if (Array.isArray(recentNotes) && recentNotes.length > 0 && !campaignLeadVars["operator_notes"]) {
      campaignLeadVars["operator_notes"] = recentNotes.join(" | ");
    }
    logger.info({ campaignLeadId: params.campaignLeadId, phone: campaignLeadResult.phone }, "Campaign lead vars loaded into session");

    // ── Inject lead context block into system prompt ──────────────────────────
    // Must happen BEFORE resolvePromptVariables so any {{variable}} placeholders
    // inside the block itself are also resolved.
    const leadContextBlock = buildLeadContextBlock(campaignLeadVars);
    if (leadContextBlock) {
      const isSheetLead = !!(campaignLeadResult.leadData as Record<string, string> | undefined)?.["__sheet_pipeline_id"];
      const labeled = isSheetLead
        ? leadContextBlock.replace("=== LEAD CONTEXT ===", "=== SHEET LOOKUP ===")
        : leadContextBlock;
      agentConfig.systemPrompt = `${labeled}\n\n${agentConfig.systemPrompt}`;
      const fieldCount = Object.entries(campaignLeadVars).filter(
        ([, v]) => v && v.trim()
      ).length;
      logger.info(
        { agentId: params.agentId, campaignLeadId: params.campaignLeadId, fieldCount, isSheetLead },
        "Campaign lead context injected into system prompt",
      );
    }
  }

  // ── Inbound Automatic Calls sheet lookup (pre-fetched in parallel) ──────────
  let inboundSheetVars: Record<string, string> = {};
  let inboundSheetMeta: { pipelineId: string; sheetRowIndex: number } | null = null;
  if (inboundSheetLookupResult) {
    const hit = inboundSheetLookupResult;
    if (hit.pipelineId && hit.sheetRowIndex != null) {
      inboundSheetMeta = { pipelineId: hit.pipelineId, sheetRowIndex: hit.sheetRowIndex };
      inboundSheetVars = { ...hit.vars };
      // Strip internal keys from prompt vars
      delete inboundSheetVars["__sheet_pipeline_id"];
      delete inboundSheetVars["__sheet_row_index"];
      if (inboundSheetVars.name?.trim()) {
        if (!inboundSheetVars["customer_name"]) inboundSheetVars["customer_name"] = inboundSheetVars.name;
        if (!inboundSheetVars["caller_name"]) inboundSheetVars["caller_name"] = inboundSheetVars.name;
      }
      const sheetBlock = buildLeadContextBlock(inboundSheetVars);
      if (sheetBlock) {
        const labeled = sheetBlock.replace("=== LEAD CONTEXT ===", "=== SHEET LOOKUP ===");
        agentConfig.systemPrompt = `${labeled}\n\n${agentConfig.systemPrompt}`;
        logger.info(
          {
            agentId: params.agentId,
            pipelineId: hit.pipelineId,
            sheetRowIndex: hit.sheetRowIndex,
            fieldCount: Object.keys(inboundSheetVars).length,
          },
          "Inbound sheet lookup injected into system prompt",
        );
      }
    } else if (Object.keys(hit.vars).length > 0) {
      // Legacy binding lookup (no pipeline writeback meta)
      inboundSheetVars = hit.vars;
      const sheetBlock = buildLeadContextBlock(inboundSheetVars);
      if (sheetBlock) {
        const labeled = sheetBlock.replace("=== LEAD CONTEXT ===", "=== SHEET LOOKUP ===");
        agentConfig.systemPrompt = `${labeled}\n\n${agentConfig.systemPrompt}`;
      }
    }
  }

  const dynVars: Record<string, string> = {
    to_number:     params.toNumber,
    from_number:   params.fromNumber,
    agent_name:    agent.name,
    caller_number: params.fromNumber,
    date: now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
    ...Object.fromEntries(agentConfig.promptVariables.map(v => [v.key, v.defaultValue])),
    ...campaignLeadVars,
    ...inboundSheetVars,
    ...Object.fromEntries(Object.entries(params.customParameters ?? {}).map(([k, v]) => [k, v])),
  };

  agentConfig.systemPrompt = resolvePromptVariables(agentConfig.systemPrompt, dynVars);
  agentConfig.knownAttendeeEmail = pickKnownBookingEmail(dynVars, agentConfig.systemPrompt);

  // Apply the SAME resolution to the static greeting so it addresses the caller
  // by their prompt variables (e.g. {{customer_name}} → "krithika"). Static
  // greetings skip the LLM, so without this the name is never inserted.
  // caller_salutation is deliberately preserved here and resolved later by
  // gender detection in pipeline.greet().
  if (agentConfig.greetingMessage) {
    agentConfig.greetingMessage = resolvePromptVariables(agentConfig.greetingMessage, dynVars);
  }

  if (agent.agentType === INTAKE_AGENT_TYPE) {
    const prior = priorIntakeResult;
    const kind = resolveIntakeOpenKind({
      hasPriorIntake: Boolean(prior),
      sourceCallbackReason: params.sourceCallbackReason,
      isResumeDroppedCall: resumeDroppedCall || params.sourceCallbackReason === "network_drop",
    });
    const callerName = prior
      ? intakeCallerName(prior)
      : (callerProfileSnapshot?.name ?? dynVars["caller_name"] ?? dynVars["name"] ?? null);
    agentConfig.greetingMessage = renderIntakeGreeting({
      kind,
      agentName: agent.name,
      callerName,
    });
    logger.info(
      {
        agentId: params.agentId,
        kind,
        callerName,
        priorToken: prior?.publicToken ?? null,
        spokenName: agent.name,
      },
      "intake: opening line chosen for this call",
    );
  }

  // Apply knowledge base (appended AFTER the system prompt so agent-specific
  // instructions keep positional precedence — reference material must never
  // read as if it overrides the agent's configured behavior above it).
  if (kbEntriesResult && kbEntriesResult.text) {
    // Char capping (KB_INJECT_MAX_CHARS / provider defaults) happened INSIDE
    // buildKnowledgeBaseBlockEx with fair per-source budgeting — see
    // kbBakedMaxChars above. Log the allocation so multi-source starvation is
    // visible without re-deriving char counts by hand.
    if (kbEntriesResult.truncated) {
      logger.info(
        {
          agentId: params.agentId,
          kbMaxChars: kbBakedMaxChars ?? null,
          injectedChars: kbEntriesResult.text.length,
          contributingSourceIds: kbEntriesResult.contributingSourceIds,
          perSource: kbEntriesResult.perSource,
        },
        "Knowledge base block capped (fair per-source budget)",
      );
    }
    const kbInjectText = kbEntriesResult.text;
    const kbBlock = [
      "=== KNOWLEDGE BASE (reference material) ===",
      "The following is reference knowledge base content. If any detail here conflicts with instructions already given above in the system prompt, the system prompt takes precedence — do not override agent-specific configuration with this reference material.",
      "Use the following information to answer questions accurately, and prefer it over your general training data for topics the system prompt does not already define.",
      "",
      kbInjectText,
      "=== END KNOWLEDGE BASE ===",
    ].join("\n\n");
    // Appended (not prepended): the agent's own instructions stay first in the
    // prompt. NOTE for Gemini context caching (google.ts): the cached prefix is
    // captured in pipeline.ts as buildCacheBase() from this SAME final
    // systemPrompt string, so appending here keeps the cache base byte-identical
    // between the warm and per-turn paths — safe either way.
    agentConfig.systemPrompt = `${agentConfig.systemPrompt}\n\n${kbBlock}`;
    logger.info(
      { agentId: params.agentId, knowledgeSourceIds: agentConfig.knowledgeSourceIds },
      "Knowledge base injected into system prompt"
    );
  }

  // Auto-inject KB trust instruction whenever a knowledge base is attached.
  // Users don't add this themselves — we do it for them so weaker models don't
  // ignore the per-turn retrieved context or hallucinate over it.
  // Only appended if the system prompt doesn't already contain the marker.
  if (
    agentConfig.knowledgeSourceIds.length > 0 &&
    !agentConfig.systemPrompt.includes("[KB_TRUST]")
  ) {
    agentConfig.systemPrompt +=
      "\n\n[KB_TRUST] When relevant information is provided in your context from the knowledge base, answer from those facts. Speak like a person on a phone: one short sentence, not a readout of the whole entry. Do not guess or invent product details, pricing, policies, or facts that are not present. If they ask where you are calling from, say the company and the city or area only. Do not read the street, landmark, pincode, phone, email, or office hours unless they ask for that exact detail.";
  }

  if (afterCallInstruction) {
    agentConfig.systemPrompt += `\n\n${afterCallInstruction}`;
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
    qwen:          "managed_qwen_key",
    groq:          "managed_qwen_key",
    google:        "managed_gemini_key",
    gemini:        "managed_gemini_key",
    gemini_audio:  "managed_gemini_key",
    google_speech: "managed_gemini_key",
    google_stt:    "managed_gemini_key",
    deepgram:      "managed_deepgram_key",
    sarvam:        "managed_sarvam_key",
    cartesia:      "managed_cartesia_key",
    openai:        "managed_openai_key",
    azure:         "managed_azure_speech_key",
    assemblyai:    "managed_assemblyai_key",
    together:      "managed_together_key",
    openrouter:    "managed_openrouter_key",
    krutrim:       "managed_krutrim_key",
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
    ...(agentConfig.voiceStack === "gemini_live" ? ["google"] : []),
    ...(agentConfig.voiceStack === "openai_realtime" ? ["openai"] : []),
  ].filter((p): p is string => !!p);

  // Null / missing agentMode must behave as managed (DB default). Only explicit
  // "byop" uses the owner's provider rows. Intake demos always pin platform Sarvam
  // so Admin → Managed Keys actually reaches the live call.
  const isManaged = (agent.agentMode ?? "managed") !== "byop";
  const pinPlatformSarvam = isManaged || agent.agentType === INTAKE_AGENT_TYPE;

  // ── Bulk platform_settings fetch (one DB round-trip instead of N sequential) ─
  // Collect every settings key needed, then do a single IN query.
  // Managed-plan agents need the platform key for every provider; BYOP agents
  // only need it as a fallback for providers the user hasn't configured.
  const settingsKeysNeeded = new Set<string>();
  settingsKeysNeeded.add("managed_gemini_key");
  settingsKeysNeeded.add("managed_gemini_keys");
  if (pinPlatformSarvam && requiredProviders.includes("sarvam")) {
    settingsKeysNeeded.add("managed_sarvam_key");
  }
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

  const { parseGeminiKeyList, pickGeminiKeyFromList } = await import("../lib/gemini-key-pool.js");
  const pickedGeminiKey = pickGeminiKeyFromList(parseGeminiKeyList(
    settingsMap.get("managed_gemini_key"),
    settingsMap.get("managed_gemini_keys"),
    process.env["GEMINI_API_KEY"] ?? process.env["GOOGLE_API_KEY"],
  ));

  // Apply managed keys for required providers
  for (const providerName of requiredProviders) {
    if (providerName === "sarvam" && pinPlatformSarvam) {
      const managed = (settingsMap.get("managed_sarvam_key") ?? process.env["SARVAM_API_KEY"] ?? "").trim();
      if (managed) {
        providerKeys.set("sarvam", managed);
        logger.info(
          { providerName, isManaged, pinPlatformSarvam, keyLast4: managed.slice(-4) },
          "Using platform managed key for provider",
        );
      }
      continue;
    }
    if (MANAGED[providerName] && (isManaged || !providerKeys.has(providerName))) {
      const usesGeminiPool = MANAGED[providerName] === "managed_gemini_key";
      const managed = (usesGeminiPool ? pickedGeminiKey : settingsMap.get(MANAGED[providerName]!))
        ?? (providerName === "sarvam" ? (process.env["SARVAM_API_KEY"] ?? "").trim() || undefined : undefined);
      if (managed) {
        providerKeys.set(providerName, managed);
        logger.info({ providerName, isManaged, keyLast4: managed.slice(-4) }, "Using platform managed key for provider");
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

  // Sarvam Creative Studio clones are scoped to the API subscription that created
  // them. Managed agents normally use the platform Sarvam key, which cannot see a
  // user's personal clone — prefer the agent owner's BYOP Sarvam key for non-catalog speakers.
  if (
    agent.ttsProvider?.toLowerCase() === "sarvam"
    && agent.ttsVoice
    && !isSarvamCatalogSpeaker(agent.ttsVoice)
  ) {
    const ownerSarvam = providerRowsResult.find(
      (r) => r.providerName.toLowerCase() === "sarvam",
    );
    if (ownerSarvam) {
      providerKeys.set("sarvam", decryptKey(ownerSarvam.apiKey));
      logger.info(
        { speaker: agent.ttsVoice, agentId: params.agentId },
        "Using owner Sarvam API key for cloned speaker",
      );
    } else {
      logger.warn(
        { speaker: agent.ttsVoice, agentId: params.agentId },
        "Non-catalog Sarvam speaker without owner API key — TTS will fail until Providers → Sarvam key is added",
      );
    }
  }

  // The pod has no third-party key. A placeholder satisfies the pipeline check.
  if (
    intakeUsesPod()
    && (
      agent.asrProvider?.toLowerCase() === "irfan_pod"
      || agent.llmProvider?.toLowerCase() === "irfan_pod"
      || agent.ttsProvider?.toLowerCase() === "irfan_pod"
    )
  ) {
    providerKeys.set("irfan_pod", "pod");
  }

  // Provider key alias normalization (e.g. "google" key serves "gemini_audio" and "gemini")
  const googleKey =
    providerKeys.get("google") ||
    providerKeys.get("gemini") ||
    providerKeys.get("gemini_audio") ||
    providerKeys.get("google_speech") ||
    providerKeys.get("google_stt") ||
    pickedGeminiKey ||
    process.env["GEMINI_API_KEY"] ||
    process.env["GOOGLE_API_KEY"];
  if (googleKey) {
    if (!providerKeys.has("google")) providerKeys.set("google", googleKey);
    if (!providerKeys.has("gemini")) providerKeys.set("gemini", googleKey);
    if (!providerKeys.has("gemini_audio")) providerKeys.set("gemini_audio", googleKey);
    if (!providerKeys.has("google_speech")) providerKeys.set("google_speech", googleKey);
    if (!providerKeys.has("google_stt")) providerKeys.set("google_stt", googleKey);
  }

  // For outbound VoBiz calls the HTTP route (calls.ts) already created an "exec_*"
  // record at dial time. Reuse it here so there is exactly one DB row per call
  // rather than two orphan in_progress records.
  //
  // Matching priority:
  //   1. corrToken — the opaque token minted at dial and threaded through the
  //      answer webhook → WS handler. This is the ONLY reliable link for VoBiz:
  //      the dial response returns a request_uuid, never the live CallUUID, so a
  //      providerCallId === externalCallId match would never fire for VoBiz.
  //   2. providerCallId === externalCallId — legacy path for providers (Twilio/
  //      Plivo) whose dial response IS the live call id.
  // On match we MERGE the existing metadata so dial-time fields (requestUuid,
  // corrToken, provider) survive, and write the live externalCallId (the VoBiz
  // CallUUID) over BOTH providerCallId and externalCallId — that is the id the
  // /Call/{uuid}/Transfer/ endpoint requires.
  const callRecord = await (async (): Promise<typeof callsTable.$inferSelect> => {
    let existing: typeof callsTable.$inferSelect | undefined;
    if (params.corrToken) {
      [existing] = await withDbRetry("find-existing-call-record-corr", () =>
        db.select().from(callsTable)
          .where(and(
            sql`${callsTable.metadata}::jsonb->>'corrToken' = ${params.corrToken}`,
            inArray(callsTable.status, ["ringing", "in_progress"]),
          ))
          .limit(1),
      );
    }
    if (!existing && params.externalCallId) {
      [existing] = await withDbRetry("find-existing-call-record", () =>
        db.select().from(callsTable)
          .where(and(
            sql`${callsTable.metadata}::jsonb->>'providerCallId' = ${params.externalCallId}`,
            inArray(callsTable.status, ["ringing", "in_progress"]),
          ))
          .limit(1),
      );
    }
    if (existing) {
      let prevMeta: Record<string, unknown> = {};
      try { prevMeta = existing.metadata ? JSON.parse(existing.metadata) as Record<string, unknown> : {}; }
      catch { prevMeta = {}; }
      await withDbRetry("update-existing-call-record", () =>
        db.update(callsTable).set({
          status: "in_progress",
          metadata: JSON.stringify({
            ...prevMeta,
            ...(params.externalCallId ? { providerCallId: params.externalCallId, externalCallId: params.externalCallId } : {}),
            ...(params.platformTelephony ? { platformTelephony: true } : {}),
            direction: callDirection,
            ...(callerPhone ? { callerKey: callerPhone } : {}),
            ...(inboundSheetMeta
              ? {
                  __sheet_pipeline_id: inboundSheetMeta.pipelineId,
                  __sheet_row_index: inboundSheetMeta.sheetRowIndex,
                }
              : {}),
          }),
        }).where(eq(callsTable.id, existing.id)),
      );
      logger.info({ callId: existing.id, externalCallId: params.externalCallId ?? null, corrToken: params.corrToken ?? null, matchedBy: params.corrToken && prevMeta["corrToken"] === params.corrToken ? "corrToken" : "providerCallId" }, "Reusing existing exec_* call record");
      return existing;
    }
    const [inserted] = await withDbRetry("insert-call-record", () =>
      db.insert(callsTable).values({
        agentId: params.agentId,
        userId: agent.userId ?? null,
        status: "in_progress",
        toNumber: params.toNumber,
        fromNumber: params.fromNumber,
        executionId: `exec_${randomBytes(4).toString("hex")}`,
        metadata: JSON.stringify({
          ...(params.externalCallId ? { externalCallId: params.externalCallId } : {}),
          ...(params.platformTelephony ? { platformTelephony: true } : {}),
          ...(isWebcall ? { transport: "webcall", isTestCall: true } : {}),
          ...(isMeetBotSession ? { transport: "meetbot", isTestCall: true } : {}),
          direction: callDirection,
          ...(callerPhone ? { callerKey: callerPhone } : {}),
          ...(isMeetBotSession && typeof params.meetingSourceCallId === "number"
            ? { meetingSourceCallId: params.meetingSourceCallId }
            : {}),
          ...(isMeetBotSession && params.meetingMemoryPhone
            ? { meetingMemoryPhone: params.meetingMemoryPhone.trim() }
            : {}),
          ...(isMeetBotSession && params.meetingUrl
            ? { meetUrl: params.meetingUrl.trim() }
            : {}),
          ...(inboundSheetMeta
            ? {
                __sheet_pipeline_id: inboundSheetMeta.pipelineId,
                __sheet_row_index: inboundSheetMeta.sheetRowIndex,
              }
            : {}),
        }) || null,
      }).returning(),
    );
    if (!inserted) throw new Error("Failed to create call record");
    return inserted;
  })();

  // ── Inject Agent Task brief into system prompt (from dial-time metadata) ────
  try {
    const meta = callRecord.metadata ? JSON.parse(callRecord.metadata) as Record<string, unknown> : {};
    const callVars = callVariablesFromMetadata(meta);
    if (Object.keys(callVars).length > 0) {
      const patientName = (callVars["patient_name"] ?? callVars["name"] ?? "").trim();
      if (patientName) {
        if (!callVars["name"]) callVars["name"] = patientName;
        if (!callVars["customer_name"]) callVars["customer_name"] = patientName;
        if (!callVars["caller_name"]) callVars["caller_name"] = patientName;
      }
      Object.assign(dynVars, callVars);
      const callBlock = buildCallContextBlock(callVars);
      if (callBlock) {
        agentConfig.systemPrompt = `${callBlock}\n\n${agentConfig.systemPrompt}`;
      }
      agentConfig.systemPrompt = resolvePromptVariables(agentConfig.systemPrompt, dynVars);
      agentConfig.knownAttendeeEmail = pickKnownBookingEmail(dynVars, agentConfig.systemPrompt);
      if (agentConfig.greetingMessage) {
        agentConfig.greetingMessage = resolvePromptVariables(agentConfig.greetingMessage, dynVars);
      }
      logger.info(
        { agentId: params.agentId, callId: callRecord.id, variableKeys: Object.keys(callVars) },
        "Per-call API variables injected into system prompt",
      );
    }
    const taskBrief = typeof meta["taskBrief"] === "string" ? meta["taskBrief"].trim() : "";
    if (taskBrief) {
      agentConfig.systemPrompt += `\n\n${taskBrief}`;
      logger.info(
        { agentId: params.agentId, callId: callRecord.id, agentTaskId: meta["agentTaskId"] ?? null },
        "Agent task brief injected into system prompt",
      );
    }
  } catch (taskBriefErr) {
    logger.warn({ err: taskBriefErr, callId: callRecord.id }, "Failed to inject dial-time prompt context");
  }

  // ── Write back triggeredCallId on the scheduled callback row ─────────────────
  if (params.scheduledCallbackId) {
    void db.update(scheduledCallbacksTable)
      .set({ triggeredCallId: callRecord.id })
      .where(eq(scheduledCallbacksTable.id, params.scheduledCallbackId))
      .catch((err) => {
        logger.warn({ scheduledCallbackId: params.scheduledCallbackId, callId: callRecord.id, err }, "Failed to write back triggeredCallId on callback row");
      });
  }

  // ── Mark campaign lead as connected + record call execution row ───────────────
  if (params.campaignLeadId && campaignLeadResult) {
    void db.update(campaignLeadsTable)
      .set({ callStatus: "connected", answeredEver: true, lastAttemptStatus: "answered" })
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
      .set({ callStatus: "connected", answeredEver: true, lastAttemptStatus: "answered" })
      .where(eq(campaignLeadsTable.id, params.campaignLeadId))
      .catch((err) => {
        logger.warn({ campaignLeadId: params.campaignLeadId, err }, "Failed to mark campaign lead connected");
      });
  }

  // ── Call Started lifecycle row (enables Logs tab for telephony calls) ─────────
  writeCallStartedLog(callRecord.id, params.agentId, {
    callType: isWebcall ? "Webcall" : "Live Call",
    direction: isWebcall ? "Inbound" : (callDirection === "outbound" ? "Outbound" : "Inbound"),
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
    extra: {
      telephonyProvider: params.telephonyProvider,
      setupElapsedMs: Date.now() - createSessionStartMs,
      deployedCommit: process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? null,
      backchannelingEnabled: agent.agentType === INTAKE_AGENT_TYPE
        || agent.backchannelingEnabled !== false,
    },
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

  if (kbEntriesResult && kbEntriesResult.text) {
    logExec("Knowledge", "response", {
      status: "success",
      responsePayload: {
        sourceIds: agentConfig.knowledgeSourceIds,
        injected: true,
        contributingSourceIds: kbEntriesResult.contributingSourceIds,
        truncated: kbEntriesResult.truncated,
        perSource: kbEntriesResult.perSource,
        injectedChars: kbEntriesResult.text.length,
        preview: kbEntriesResult.text.substring(0, 400),
      },
    });
  }

  // ── Setup: provider-init / voice / prompt events (mirror the web-call path) ──
  if (agentConfig.voiceStack === "gemini_live") {
    logExec(EXEC_COMPONENTS.Agent, "system", {
      status: "info",
      metadata: {
        event: "Provider Initialized",
        provider: "gemini_live",
        model: agentConfig.geminiLive?.model ?? DEFAULT_GEMINI_LIVE_MODEL,
        voice: agentConfig.geminiLive?.voiceName ?? null,
      },
    });
  } else if (agentConfig.voiceStack === "openai_realtime") {
    logExec(EXEC_COMPONENTS.Agent, "system", {
      status: "info",
      metadata: {
        event: "Provider Initialized",
        provider: "openai_realtime",
        model: agentConfig.openaiRealtime?.model ?? resolveOpenAIRealtimeModel(null),
        voice: agentConfig.openaiRealtime?.voiceName ?? null,
      },
    });
  } else {
    logExec(EXEC_COMPONENTS.STT, "system", {
      status: "info",
      metadata: {
        event: "Provider Initialized", provider: agent.asrProvider,
        model: agent.asrModel ?? null,
        // Use the effective language from agentConfig — may differ from agent.asrLanguage
        // when caller memory language_pref overrode it at session start.
        language: agentConfig.language ?? agent.asrLanguage ?? agent.language ?? null,
        ...(agentConfig.language &&
            agentConfig.language !== (agent.asrLanguage ?? agent.language)
          ? { languageOverriddenFromMemory: true, originalLanguage: agent.asrLanguage ?? agent.language ?? null }
          : {}),
      },
    });
    logExec(EXEC_COMPONENTS.LLM, "system", {
      status: "info",
      metadata: { event: "Provider Initialized", provider: agent.llmProvider, model: agent.llmModel ?? null },
    });
    logExec(EXEC_COMPONENTS.TTS, "system", {
      status: "info",
      metadata: { event: "Provider Initialized", provider: agent.ttsProvider, model: agent.ttsModel ?? null },
    });
    logExec(EXEC_COMPONENTS.TTS, "system", {
      status: "info",
      metadata: { event: "Voice Loaded", provider: agent.ttsProvider, voice: agent.ttsVoice ?? null },
    });
  }
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
  // Becomes true ONLY when an outbound call was acoustically confirmed as a machine
  // AND the configured voicemail action executed (message delivered or confirmed-machine
  // hangup). Drives the distinct "voicemail" call/lead outcome in endSession.
  let voicemailActionExecuted = false;

  const sessionId = `${params.telephonyProvider}-${callRecord.id}-${Date.now()}`;
  const redisTtl = (agentConfig.maxDuration ?? 600) + 600; // maxDuration + 10 min buffer

  // Warm uploaded ambient PCM in the background — never block first audio.
  // Call 2638: await loadPcmLoop here cost ~1.8s of opening silence.
  {
    const ambTrack = agentConfig.ambientNoiseEnabled ? agentConfig.ambientNoiseTrack : null;
    if (ambTrack && !Object.prototype.hasOwnProperty.call(TRACK_PARAMS, ambTrack)) {
      void loadPcmLoop(ambTrack).catch((ambErr) => {
        logger.warn({ callId: callRecord.id, soundId: ambTrack, err: ambErr }, "Ambient preload failed — pipeline will retry");
      });
    }
  }

  // ── Agent Squad live-run attach (inbound phone / campaign) ─────────────────
  let attachedSquadRunId: number | null = params.squadRunId ?? null;
  let attachedSquadId: number | null = params.squadId ?? null;
  if (!attachedSquadRunId && agent.userId) {
    try {
      let resolvedSquadId: number | null = params.squadId ?? null;
      let phoneNumberId: number | null = null;
      let campaignId: number | null = null;

      const [leadRes, pnRes, membershipTeam] = await Promise.all([
        params.campaignLeadId
          ? db.select({ campaignId: campaignLeadsTable.campaignId })
              .from(campaignLeadsTable)
              .where(eq(campaignLeadsTable.id, params.campaignLeadId))
              .limit(1)
              .then(([r]) => r ?? null)
              .catch(() => null)
          : Promise.resolve(null),

        (!resolvedSquadId && callDirection === "inbound" && params.toNumber)
          ? db.select({ id: phoneNumbersTable.id, squadId: phoneNumbersTable.squadId })
              .from(phoneNumbersTable)
              .where(and(eq(phoneNumbersTable.number, params.toNumber), eq(phoneNumbersTable.userId, agent.userId)))
              .limit(1)
              .then(([r]) => r ?? null)
              .catch(() => null)
          : Promise.resolve(null),

        (!resolvedSquadId)
          ? findSquadForAgent(params.agentId, agent.userId).catch(() => null)
          : Promise.resolve(null),
      ]);

      if (leadRes) {
        campaignId = leadRes.campaignId;
        const [camp] = await db.select({ squadId: campaignsTable.squadId })
          .from(campaignsTable)
          .where(eq(campaignsTable.id, leadRes.campaignId))
          .limit(1);
        if (camp?.squadId) resolvedSquadId = camp.squadId;
      }

      if (!resolvedSquadId && pnRes?.squadId) {
        resolvedSquadId = pnRes.squadId;
        phoneNumberId = pnRes.id;
      }

      if (!resolvedSquadId && membershipTeam && membershipTeam.teammates.length > 0) {
        resolvedSquadId = membershipTeam.squad.id;
      }

      if (resolvedSquadId) {
        const linked = await ensureLiveSquadRunForCall({
          squadId: resolvedSquadId,
          userId: agent.userId,
          callId: callRecord.id,
          entryAgentId: params.agentId,
          triggeredBy: params.campaignLeadId ? "campaign" : "inbound",
          campaignId,
          campaignLeadId: params.campaignLeadId ?? null,
          phoneNumberId,
          goal: "Live squad call",
        });
        if (linked) {
          attachedSquadRunId = linked.runId;
          attachedSquadId = resolvedSquadId;
          logger.info(
            { callId: callRecord.id, squadId: resolvedSquadId, runId: linked.runId },
            "Attached live squad run to call",
          );

          // Teamwork: auto-inject handoff/follow-up tools, teammate roster,
          // shared caller notes, and any pending follow-up task context.
          const team = await loadSquadTeam(resolvedSquadId, params.agentId);
          if (team && team.teammates.length > 0) {
            const injectedTools = buildSquadTools(team, agentConfig.tools);
            if (injectedTools.length > 0) {
              agentConfig.tools = [...agentConfig.tools, ...injectedTools];
            }
            const [sharedFacts, followupCtx] = await Promise.all([
              buildSharedCallerFactsBlock(team, callerPhone, params.agentId),
              consumeFollowupContext(params.agentId, callerPhone),
            ]);
            const squadBlocks = [buildSquadPromptBlock(team), sharedFacts, followupCtx]
              .filter(Boolean).join("\n\n");
            if (squadBlocks) {
              agentConfig.systemPrompt = `${agentConfig.systemPrompt}\n\n${squadBlocks}`;
            }
          }
        }
      }
    } catch (squadErr) {
      logger.warn({ err: squadErr, callId: callRecord.id }, "Failed to attach squad run — call continues without squad");
    }
  }

  const onCallTransferHandler = async (to: string, operatorSummary?: string): Promise<boolean> => {
    const isWarm = !!operatorSummary;
    logger.info({ callId: callRecord.id, transferTo: to, warm: isWarm }, "Call transfer initiated");

    // AI-to-AI transfer: agent: prefix means transfer to another squad member
    if (to.startsWith("agent:")) {
      const targetAgentId = parseInt(to.slice(6), 10);
      const live = sessions.get(sessionId);
      if (!live?.squadRunId || !live.squadId || !Number.isFinite(targetAgentId)) {
        logger.warn({ callId: callRecord.id, targetAgentId }, "Agent-to-agent transfer refused — no active squad run");
        logExec(EXEC_COMPONENTS.Tool, "system", {
          status: "error",
          metadata: {
            event:   "Transfer Failed",
            reason:  "agent_transfer_no_squad",
            target:  to,
            message: "Agent-to-agent transfer requires an active Squad run",
          },
        });
        return false;
      }

      const [squad] = await db.select().from(squadsTable).where(eq(squadsTable.id, live.squadId)).limit(1);
      if (!squad) {
        logger.warn({ callId: callRecord.id, squadId: live.squadId }, "Squad missing for handoff");
        return false;
      }

      const priorTranscript = live.pipeline.getTranscript();
      const transcriptSummary = priorTranscript.slice(-4000);
      const fromAgentId = live.agentId;
      const [runRow] = await db.select({ goal: squadRunsTable.goal })
        .from(squadRunsTable).where(eq(squadRunsTable.id, live.squadRunId)).limit(1);

      // Snapshot facts the answering/owning agent already knows about this caller
      // so the receiving agent gets structured context, not just the transcript.
      let durableFacts: Record<string, unknown> | undefined;
      if (callerPhone) {
        try {
          const ownerId = live.memoryOwnerAgentId || fromAgentId;
          const ctx = await loadCallerContext(ownerId, callerPhone);
          if (ctx.facts.length > 0) {
            durableFacts = {};
            for (const f of ctx.facts.slice(0, 25)) {
              durableFacts[f.key] = f.value;
            }
            const livePref = live.pipeline.getLiveHandoffLanguage();
            if (livePref) {
              durableFacts["language_pref"] = livePref;
            }
          }
        } catch (factErr) {
          logger.warn({ err: factErr, callId: callRecord.id }, "Failed to load durable facts for handoff");
        }
      }

      const result = await performSquadAgentHandoff({
        squadId: live.squadId,
        runId: live.squadRunId,
        fromAgentId,
        toAgentId: targetAgentId,
        reason: operatorSummary?.trim() || "Specialist handoff",
        goal: runRow?.goal ?? "Live squad call",
        transcriptSummary,
        language: live.pipeline.getLiveHandoffLanguage() || live.configuredLanguage || null,
        durableFacts,
        squad,
        previousPipeline: live.pipeline,
        hooks: {
          awaitPlaybackReceipt: params.awaitPlaybackReceipt,
          callId: callRecord.id,
          telephonyProvider: params.telephonyProvider,
          callerPhone,
          campaignLeadId: params.campaignLeadId ?? null,
          onAudioOut: ownedAudioOut,
          onCallEnd: () => {
            triggerNaturalEnd();
          },
          onBargeIn: params.onBargeIn,
          onTranscript: params.onTranscript,
          rawPcmOutput: params.rawPcmOutput,
          rawPcmOutputRate: params.rawPcmOutputRate,
          callDirection,
          memoryOwnerAgentId: live.memoryOwnerAgentId,
        },
      });

      if (!result) {
        logExec(EXEC_COMPONENTS.Tool, "system", {
          status: "error",
          metadata: {
            event:   "Transfer Failed",
            reason:  "squad_handoff_failed",
            target:  to,
            message: "Squad handoff failed; continuing with current agent",
          },
        });
        return false;
      }

      // Swap pointer first, THEN close the previous pipeline so inbound audio
      // never lands on a closed instance and a failed close can't orphan the call.
      const previous = result.previousPipeline;
      live.handoffTranscriptAccum = capHandoffTranscript(
        mergeHandoffTranscript(live.handoffTranscriptAccum, priorTranscript),
      );
      live.pipeline = result.pipeline;
      live.agentId = targetAgentId;
      try {
        previous.close();
      } catch (closeErr) {
        logger.warn({ err: closeErr, callId: callRecord.id }, "Error closing previous pipeline after handoff swap");
      }
      // Receiving pipeline was never greet()'d — firstSpeaker=user + silent
      // stock lines left the caller in dead air after the swap.
      result.pipeline.greet().catch((err) => {
        logger.error({ err, callId: callRecord.id }, "Squad handoff: receiving agent greet failed");
      });

      logExec(EXEC_COMPONENTS.Tool, "system", {
        status: "success",
        metadata: {
          event:  "Squad Handoff",
          target: to,
          fromMember: "swapped",
          toMemberId: result.toMemberId,
        },
      });

      // Record the handoff as a squad task (audit trail visible in the UI).
      void import("../services/squad-teamwork.js")
        .then(({ recordHandoffTask }) => recordHandoffTask({
          squadId: live.squadId!,
          userId: squad.userId,
          fromAgentId,
          toAgentId: targetAgentId,
          callId: callRecord.id,
          callerPhone,
          reason: operatorSummary?.trim() || "Specialist handoff",
          contextSummary: transcriptSummary,
        }))
        .catch((err) => logger.warn({ err, callId: callRecord.id }, "Handoff task record failed"));
      return true;
    }

    // Execute the actual provider-level call redirect
    try {
      if (!params.externalCallId) {
        logger.warn({ callId: callRecord.id }, "Transfer: no externalCallId — cannot redirect call");
        logExec(EXEC_COMPONENTS.Tool, "system", {
          status: "error",
          metadata: {
            event:   "Transfer Failed",
            reason:  "no_call_uuid",
            message: "Transfer unavailable: provider call UUID not yet assigned (call not fully connected)",
          },
        });
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
        vobizMergeRoom,
      } = await import("./telephony/transfer.js");
      const tprov = params.telephonyProvider;

      logExec(EXEC_COMPONENTS.Tool, "system", {
        status: "info",
        metadata: {
          event:    "Transfer Started",
          provider: tprov ?? "unknown",
          target:   to,
          mode:     isWarm ? "warm" : "cold",
          callUuid: params.externalCallId,
        },
      });

      // Set the transfer flag BEFORE calling the provider API. Providers (esp.
      // VoBiz) send the media-stream "stop" / close the WS *during* the transfer
      // API call, which fires onCallEnd → ws.close(). If wasTransferred were still
      // false at that moment, we'd send a close frame that VoBiz treats as a
      // hang-up, aborting the in-flight transfer. Reset to false in the catch
      // block below if the transfer API call fails.
      wasTransferred = true;
      transferredTo = to;
      void patchSessionMeta(sessionId, { wasTransferred: true, transferredTo: to }, redisTtl);

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
        // VoBiz needs a callerId on the <Dial> to the human agent — it must be a
        // VoBiz-provisioned number on the account (our platform number), NOT the
        // customer. Outbound: fromNumber is the platform number; inbound:
        // toNumber is the platform number.
        const callerId = params.callDirection === "outbound" ? params.fromNumber : params.toNumber;
        const callerIdQs = callerId ? `&callerId=${encodeURIComponent(callerId)}` : "";
        if (isWarm && transferId && briefingToken) {
          // 3-way merge: customer waits in a conference, sales is dialed into the
          // same room, then conference Speak plays the AI briefing to everyone.
          // Stream cannot stay in the conference (Conference XML replaces Stream).
          const { dialVobiz } = await import("./telephony/dial.js");
          const room = vobizMergeRoom(callRecord.id, transferId);
          const qs = `transferId=${encodeURIComponent(String(transferId))}&token=${encodeURIComponent(briefingToken)}`;
          const customerXml = `${baseUrl}/api/webhooks/vobiz/merge-customer-xml?${qs}`;
          const salesAnswer = `${baseUrl}/api/webhooks/vobiz/merge-sales-xml?${qs}`;
          const salesHangup = `${baseUrl}/api/webhooks/vobiz/merge-sales-hangup?${qs}&customerUuid=${encodeURIComponent(params.externalCallId)}`;
          if (!callerId?.trim()) {
            throw new Error("VoBiz merge transfer needs a platform caller ID");
          }
          await db.update(callTransfersTable).set({
            providerTransferId: `vobiz-merge:${room}:${params.externalCallId}`,
          }).where(eq(callTransfersTable.id, transferId));
          await transferVobizCall({
            authId, authToken, callUuid: params.externalCallId, xmlUrl: customerXml, callDirection: params.callDirection,
          });
          await dialVobiz({
            authId,
            authToken,
            fromNumber: callerId,
            toNumber: to,
            answerUrl: salesAnswer,
            hangupUrl: salesHangup,
            maxDurationSeconds: 3600,
          });
          logExec(EXEC_COMPONENTS.Tool, "system", {
            status: "info",
            metadata: { event: "Merge Conference Started", room, target: to },
          });
        } else {
          const xmlUrl = `${baseUrl}/api/webhooks/vobiz/transfer-xml?target=${encodeURIComponent(to)}${callerIdQs}`;
          await transferVobizCall({ authId, authToken, callUuid: params.externalCallId, xmlUrl, callDirection: params.callDirection });
        }
      } else {
        // Unknown / unsupported telephony provider. We optimistically set
        // wasTransferred=true before the provider branch (to win the WS-close race),
        // so undo it here and report failure instead of silently ending the call in
        // dead air.
        wasTransferred = false;
        transferredTo = null;
        void patchSessionMeta(sessionId, { wasTransferred: false, transferredTo: null }, redisTtl);
        logger.warn({ callId: callRecord.id, provider: tprov ?? "unknown" }, "Transfer: unsupported telephony provider — cannot redirect (call continues)");
        logExec(EXEC_COMPONENTS.Tool, "system", {
          status: "error",
          metadata: {
            event:    "Transfer Failed",
            reason:   "unsupported_provider",
            provider: tprov ?? "unknown",
            target:   to,
          },
        });
        return false;
      }
      // suppress unused-import warnings for builders not used via direct call
      void buildTwilioWarmTransferTwiML; void buildPlivoWarmTransferXml; void buildVobizWarmTransferXml;

      // wasTransferred / transferredTo were already set BEFORE the provider call
      // (see comment above) to win the WS-close race. Nothing to set here.
      // Cold (and warm-fallback) transfers never hit the warm insert above — still
      // log call_transfers so History → Transfers and campaign sync see the handoff.
      if (!transferId && agent.userId) {
        try {
          await db.insert(callTransfersTable).values({
            callId:     callRecord.id,
            userId:     agent.userId,
            transferTo: to,
            summary:    operatorSummary ?? null,
            status:     "initiated",
          });
        } catch (err) {
          logger.warn({ callId: callRecord.id, err }, "Transfer: failed to log call_transfers row");
        }
      }
      logExec(EXEC_COMPONENTS.Tool, "system", {
        status: "success",
        metadata: {
          event:    "Transfer Completed",
          provider: tprov ?? "unknown",
          target:   to,
          mode:     isWarm ? "warm" : "cold",
          callUuid: params.externalCallId,
        },
      });
      return true;
    } catch (err) {
      // Transfer failed — undo the optimistic flag set before the provider call
      // so normal call-end (ws.close) proceeds and the call isn't left hanging
      // with a dead AI stream.
      wasTransferred = false;
      transferredTo = null;
      void patchSessionMeta(sessionId, { wasTransferred: false, transferredTo: null }, redisTtl);
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error({ callId: callRecord.id, err }, "Provider call transfer API failed");
      logExec(EXEC_COMPONENTS.Tool, "system", {
        status: "error",
        metadata: {
          event:    "Transfer Failed",
          reason:   "provider_api_error",
          provider: params.telephonyProvider ?? "unknown",
          callUuid: params.externalCallId ?? null,
          message:  errMsg,
        },
      });
      return false;
    }
  };

  const hangupCarrierIfAgentEnded = (): void => {
    if (wasTransferred) return;
    if (params.telephonyProvider !== "vobiz") return;
    const callUuid = params.externalCallId?.trim();
    if (!callUuid) return;
    const creds = vobizAuthFromProviderKeys(providerKeys);
    if (!creds) {
      logger.warn({ callId: callRecord.id, callUuid }, "Vobiz hangup skipped — missing credentials");
      return;
    }
    void hangupVobizCall({ ...creds, callUuid }).catch((err) => {
      logger.warn({ err, callId: callRecord.id, callUuid }, "Vobiz hangup after agent end_call failed");
    });
  };
  const triggerNaturalEnd = (): void => {
    naturalEndTriggered = true;
    hangupCarrierIfAgentEnded();
    params.onCallEnd();
  };

  const LivePipeline = agentConfig.voiceStack === "openai_realtime" ? OpenAIRealtimePipeline : GeminiLivePipeline;
  const pipeline: VoiceSession = agentConfig.voiceStack === "gemini_live" || agentConfig.voiceStack === "openai_realtime"
    ? new LivePipeline({
        callId: callRecord.id,
        agentConfig,
        providerKeys,
        telephonyProvider: params.telephonyProvider,
        callerPhone,
        bookingLineageCallId:
          isMeetBotSession && typeof params.meetingSourceCallId === "number" && params.meetingSourceCallId > 0
            ? params.meetingSourceCallId
            : null,
        currentMeetUrl: isMeetBotSession && params.meetingUrl ? params.meetingUrl.trim() : null,
        meetMid: isMeetBotSession && params.meetMid ? params.meetMid : null,
        meetBotToken: isMeetBotSession && params.meetBotToken ? params.meetBotToken : null,
        presentationDefaultUrl:
          isMeetBotSession && meetingsCfg.presentationUrl ? meetingsCfg.presentationUrl : null,
        meetingMuteWhenIdle: isMeetBotSession ? meetingsCfg.muteWhenIdle : false,
        memoryOwnerAgentId,
        campaignLeadId: params.campaignLeadId ?? null,
        onAudioOut: ownedAudioOut,
        rawPcmOutput: params.rawPcmOutput ?? (params.telephonyProvider === "vobiz"),
        rawPcmOutputRate: params.rawPcmOutputRate,
        getMediaEpoch: () => mediaEpoch,
        canaryRoute: sessionId,
        onTranscript: (speaker, text) => {
          logger.debug({ callId: callRecord.id, speaker, text: text.slice(0, 80) }, "Transcript");
          params.onTranscript?.(speaker, text);
        },
        onCallEnd: () => {
          triggerNaturalEnd();
        },
        onCallTransfer: onCallTransferHandler,
        onBargeIn: params.onBargeIn,
        onConversationUpdate: (history) => {
          void saveConversation(callRecord.id, history, redisTtl);
        },
        onFatalError: (reason) => {
          void failSession(sessionId, reason);
        },
        voicemailDelivery: (params.voicemailDelivery || ((params.amdMachineHint || params.amdArmed) && amdVoicemailAction === "leave_message"))
          ? {
              message: (typeof agentCfg["voicemailMessage"] === "string" && (agentCfg["voicemailMessage"] as string).trim())
                ? (agentCfg["voicemailMessage"] as string)
                : "Hello, we tried to reach you. Please call us back at your earliest convenience. Thank you.",
              ...(amdLeadInSeconds !== undefined ? { leadInSeconds: amdLeadInSeconds } : {}),
            }
          : undefined,
        voicemailPolicy: {
          action: amdVoicemailAction,
          message: (typeof agentCfg["voicemailMessage"] === "string" && (agentCfg["voicemailMessage"] as string).trim())
            ? (agentCfg["voicemailMessage"] as string)
            : "Hello, we tried to reach you. Please call us back at your earliest convenience. Thank you.",
          ...(amdLeadInSeconds !== undefined ? { leadInSeconds: amdLeadInSeconds } : {}),
        },
        amdConfirm: (params.amdMachineHint || params.amdArmed)
          ? {
              action: amdVoicemailAction,
              hint: !!params.amdMachineHint,
              ...(amdLeadInSeconds !== undefined ? { leadInSeconds: amdLeadInSeconds } : {}),
            }
          : undefined,
        onAmdResult: (result) => {
          void withDbRetry("persist-amd-result", () =>
            db.update(callsTable).set({ amdResult: result }).where(eq(callsTable.id, callRecord.id)),
          ).catch((err) => logger.error({ callId: callRecord.id, err }, "Failed to persist AMD result"));
        },
        onVoicemailAction: () => { voicemailActionExecuted = true; },
        callDirection,
        answeredAt: params.answeredAt,
      })
    : new OrchestrationPipeline({
    callId: callRecord.id,
    sessionCreatedAtMs: createSessionStartMs,
    agentConfig,
    providerKeys,
    telephonyProvider: params.telephonyProvider,
    callerPhone,
    bookingLineageCallId:
      isMeetBotSession && typeof params.meetingSourceCallId === "number" && params.meetingSourceCallId > 0
        ? params.meetingSourceCallId
        : null,
    currentMeetUrl: isMeetBotSession && params.meetingUrl ? params.meetingUrl.trim() : null,
    meetMid: isMeetBotSession && params.meetMid ? params.meetMid : null,
    meetBotToken: isMeetBotSession && params.meetBotToken ? params.meetBotToken : null,
    presentationDefaultUrl:
      isMeetBotSession && meetingsCfg.presentationUrl ? meetingsCfg.presentationUrl : null,
    meetingMuteWhenIdle: isMeetBotSession ? meetingsCfg.muteWhenIdle : false,
    memoryOwnerAgentId,
    campaignLeadId: params.campaignLeadId ?? null,
    onAudioOut: ownedAudioOut,
    awaitPlaybackReceipt: params.awaitPlaybackReceipt,
    rawPcmOutput: params.rawPcmOutput ?? (params.telephonyProvider === "vobiz"),
    rawPcmOutputRate: params.rawPcmOutputRate,
    getMediaEpoch: () => mediaEpoch,
    canaryRoute: sessionId,
    voicemailDelivery: (params.voicemailDelivery || ((params.amdMachineHint || params.amdArmed) && amdVoicemailAction === "leave_message"))
      ? {
          message: (typeof agentCfg["voicemailMessage"] === "string" && (agentCfg["voicemailMessage"] as string).trim())
            ? (agentCfg["voicemailMessage"] as string)
            : "Hello, we tried to reach you. Please call us back at your earliest convenience. Thank you.",
          ...(amdLeadInSeconds !== undefined ? { leadInSeconds: amdLeadInSeconds } : {}),
        }
      : undefined,
    // Always expose the configured After-the-call voicemail policy so mid-call
    // transcript detection can leave a message when acoustic AMD misses.
    voicemailPolicy: {
      action: amdVoicemailAction,
      message: (typeof agentCfg["voicemailMessage"] === "string" && (agentCfg["voicemailMessage"] as string).trim())
        ? (agentCfg["voicemailMessage"] as string)
        : "Hello, we tried to reach you. Please call us back at your earliest convenience. Thank you.",
      ...(amdLeadInSeconds !== undefined ? { leadInSeconds: amdLeadInSeconds } : {}),
    },
    // Acoustic AMD confirmation: armed either by a synchronous machine hint
    // (legacy path) or UNCONDITIONALLY for AMD-enabled VoBiz outbound calls
    // (amdArmed — the real verdict arrives via the async machine_detection_url
    // callback and corroborates the acoustic analysis mid-window). The pipeline
    // holds the greeting and confirms acoustically before enacting.
    amdConfirm: (params.amdMachineHint || params.amdArmed)
      ? {
          action: amdVoicemailAction,
          hint: !!params.amdMachineHint,
          ...(amdLeadInSeconds !== undefined ? { leadInSeconds: amdLeadInSeconds } : {}),
        }
      : undefined,
    // Persist the acoustically-confirmed AMD verdict (not the raw untrusted flag).
    onAmdResult: (result) => {
      void withDbRetry("persist-amd-result", () =>
        db.update(callsTable).set({ amdResult: result }).where(eq(callsTable.id, callRecord.id)),
      ).catch((err) => logger.error({ callId: callRecord.id, err }, "Failed to persist AMD result"));
    },
    // Confirmed-machine voicemail action executed (message delivered or hangup) →
    // record a distinct "voicemail" outcome instead of "completed" in endSession.
    onVoicemailAction: () => { voicemailActionExecuted = true; },
    // Returning caller (>=1 prior completed call) → instant name opener (no greeting LLM).
    isReturningCaller: (callerProfileSnapshot?.callCount ?? 0) >= 1,
    returningCallerName: callerNameCollidesWithAgent(callerProfileSnapshot?.name, agent.name)
      ? null
      : (callerProfileSnapshot?.name ?? null),
    callerMemoryLanguage:
      latchedFactsMap.get("language_pref")
      ?? callerProfileSnapshot?.preferredLanguage
      ?? null,
    callDirection,
    isResumeDroppedCall: resumeDroppedCall,
    // Carrier answer time — anchors the recording clock (see SessionConfig).
    answeredAt: params.answeredAt,
    preplayedOpening: params.preplayedOpening,
    onTranscript: (speaker, text) => {
      logger.debug({ callId: callRecord.id, speaker, text: text.slice(0, 80) }, "Transcript");
      // Forward to the transport (browser webcall renders a live transcript).
      params.onTranscript?.(speaker, text);
      if (speaker === "user" && callerPhone) {
        // Real-time name latch — persist immediately so the name is saved even
        // if the call drops before the post-call LLM extraction runs.
        void latchCallerName({
          agentId:      memoryOwnerAgentId,
          phoneNumber:  callerPhone,
          transcript:   text,
          existingName: callerProfileSnapshot?.name ?? null,
          callId:       callRecord.id,
          agentName:    agent.name,
        }).then((latched) => {
          if (latched && callerProfileSnapshot) {
            callerProfileSnapshot = { ...callerProfileSnapshot, name: latched.name };
          }
          if (latched) {
            callerNameLatchedThisCall = latched.name;
            callerNameLatchTier = latched.tier;
          }
        });
        // Real-time structured fact latch — pattern-based detection, fire-and-forget
        void latchCallerFact({
          agentId:       memoryOwnerAgentId,
          phoneNumber:   callerPhone,
          transcript:    text,
          callId:        callRecord.id,
          existingFacts: latchedFactsMap,
        }).then((updated) => { latchedFactsMap = updated; });
      }
    },
    onCallEnd: () => {
      triggerNaturalEnd();
    },
    onCallTransfer: onCallTransferHandler,
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
    onProviderIssue: params.onProviderIssue,
  });

  try { assertAcceptingCalls(); lease.assertOwned(); }
  catch (err) { pipeline.close(); throw err; }
  admittedSessionId = sessionId;
  callLeases.set(sessionId, lease);
  sessions.set(sessionId, {
    sessionId,
    callId: callRecord.id,
    agentId: params.agentId,
    pipeline,
    externalCallId: params.externalCallId ?? null,
    voiceStack: agentConfig.voiceStack,
    get mediaEpoch() { return mediaEpoch; },
    retargetAudioOut(send: (audio: Buffer) => void) {
      mediaEpoch += 1;
      mediaOut.send = send;
      const canaryMeta = {
        mediaEpoch,
        carrier: params.telephonyProvider,
        route: sessionId,
      };
      // Applies canary meta + recreates AEC (no separate setAudioCanaryMeta).
      resetAecSession(String(callRecord.id), canaryMeta);
      logger.info(
        {
          ...voiceCanaryBaseFields({
            callId: callRecord.id,
            mediaEpoch,
            carrier: params.telephonyProvider,
            route: sessionId,
          }),
          event: "voice_canary_media_epoch_reset",
        },
        "voice_canary_media_epoch_reset",
      );
      return mediaEpoch;
    },
    // Anchor the duration clock to the carrier answer time when known, so the
    // gap between carrier answer and media-stream connect/session creation is
    // counted. Falls back to now for webcall (no carrier answer gap).
    startedAt: params.answeredAt ? new Date(params.answeredAt) : new Date(),
    metricsAcc,
    get wasTransferred() { return wasTransferred; },
    get transferredTo() { return transferredTo; },
    setTransferred(to: string | null) { wasTransferred = to !== null; transferredTo = to; },
    get naturalEndTriggered() { return naturalEndTriggered; },
    get voicemailActionExecuted() { return voicemailActionExecuted; },
    get callerProfileSnapshot() { return callerProfileSnapshot; },
    get callerNameLatchedThisCall() { return callerNameLatchedThisCall; },
    get callerNameLatchTier() { return callerNameLatchTier; },
    personaHash,
    configuredLanguage: agentConfig.language ?? null,
    callerPhone,
    agentUserId:          agent.userId ?? null,
    agentLlmProvider:     agent.llmProvider,
    agentLlmModel:        agent.llmModel ?? "",
    campaignLeadId:       params.campaignLeadId ?? null,
    sourceCallbackReason: params.sourceCallbackReason ?? null,
    squadRunId:           attachedSquadRunId,
    squadId:              attachedSquadId,
    memoryOwnerAgentId,
    handoffTranscriptAccum: "",
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
    void (async () => {
      logger.info(
        { sessionId, callId: callRecord.id, maxDurationSeconds: agentConfig.maxDuration, endReason: "max_duration" },
        "Session reached configured max duration — ending call",
      );
      // Graceful teardown: if the agent is speaking, let the current sentence
      // finish (bounded by MAX_DURATION_GRACE_MS) before closing the pipeline, so
      // the caller never hears speech cut off mid-word. Idle calls end at once.
      const graceMs = Math.min(
        15_000,
        Math.max(0, Number(process.env["MAX_DURATION_GRACE_MS"]) || 5000),
      );
      const s = sessions.get(sessionId);
      if (s) {
        try {
          await s.pipeline.finishSpeakingForMaxDuration(graceMs);
        } catch (err) {
          logger.warn({ sessionId, callId: callRecord.id, err }, "Max-duration graceful drain failed — closing anyway");
        }
      }
      await endSession(sessionId, "max_duration");
    })();
  }, agentConfig.maxDuration * 1000);

  logger.info({ sessionId, callId: callRecord.id, agent: agent.name }, "Session created");

  if (params.amdMachineHint || params.amdArmed) {
      // Live: machine hint/callback enacts hangup or leave_message; no hint → greet.
      // Classic: acoustic window before enacting.
      pipeline.confirmAmdMachineThenBranch().catch((err) => {
        logger.error({ sessionId, err }, "AMD acoustic confirmation failed");
      });
  } else if (params.voicemailDelivery) {
      // Voicemail-delivery mode: do NOT greet/run the conversation.
      pipeline.deliverVoicemail().catch((err) => {
        logger.error({ sessionId, err }, "Voicemail delivery failed");
      });
  } else {
    pipeline.greet().catch((err) => {
      logger.error({ sessionId, err }, "Greeting failed");
    });
  }

  return { sessionId, callDbId: callRecord.id };
  } finally {
    if (!admittedSessionId || !sessions.has(admittedSessionId)) await lease.release();
  }
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

/** Find an in-progress session by caller phone (for WhatsApp image attach). */
export function findActiveSessionByPhone(
  phone: string,
  agentId?: number,
): ActiveSession | undefined {
  for (const session of sessions.values()) {
    if (agentId != null && session.agentId !== agentId) continue;
    if (session.callerPhone && phonesMatch(session.callerPhone, phone)) return session;
  }
  return undefined;
}

/** Find the LIVE session by its provider-side call id (e.g. the VoBiz answer-webhook
 *  CallUUID). Used by async provider callbacks — notably the VoBiz
 *  machine_detection_url AMD verdict — to feed the running pipeline directly. */
export function getSessionByExternalCallId(externalCallId: string): ActiveSession | undefined {
  if (!externalCallId) return undefined;
  for (const session of sessions.values()) {
    if (session.externalCallId === externalCallId) return session;
  }
  return undefined;
}

/** Second VoBiz media WS for the same campaign dial (two CallUUIDs). */
export function getSessionByCampaignLeadId(campaignLeadId: number): ActiveSession | undefined {
  if (!Number.isFinite(campaignLeadId)) return undefined;
  for (const session of sessions.values()) {
    if (session.campaignLeadId === campaignLeadId) return session;
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

  // Mark session as transferred BEFORE the provider call. VoBiz sends the
  // media-stream "stop" / closes the WS *during* the transfer REST call, which
  // fires onCallEnd → ws.close(). The guard in vobiz.ts reads the in-memory flag
  // via getSession()?.wasTransferred, so it must be set synchronously here (Redis
  // meta alone is not read by that guard). Reset on failure so a dropped transfer
  // still ends the call normally instead of hanging with a dead AI stream.
  const markTransferred = (to: string | null): void => {
    if (!sessionId) return;
    const session = sessions.get(sessionId);
    if (!session) return;
    session.setTransferred(to);
    void patchSessionMeta(sessionId, { wasTransferred: to !== null, transferredTo: to },
      (session.pipeline as any).config?.agentConfig?.maxDuration ?? 600 + 600);
  };
  markTransferred(target);

  // Execute VoBiz transfer
  try {
    await transferVobizCall({
      authId: vobizAuthId,
      authToken: vobizAuthToken,
      callUuid: externalCallId,
      xmlUrl: xmlCallbackUrl,
    });
  } catch (err) {
    markTransferred(null);
    throw err;
  }

  return true;
}

export async function endSession(sessionId: string, reason?: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;

  const fullTranscript = mergeHandoffTranscript(
    session.handoffTranscriptAccum,
    session.pipeline.getTranscript(),
  );
  const squadTranscriptPreview = session.squadRunId
    ? fullTranscript.slice(0, 4000)
    : null;

  sessions.delete(sessionId);
  const lease = callLeases.get(sessionId);
  callLeases.delete(sessionId);
  void lease?.release();
  session.pipeline.close();
  destroyAudioSession(String(session.callId));
  void patchSessionMeta(sessionId, { status: "ended" }, 3600);
  void removeSession(sessionId, session.callId);

  if (session.squadRunId) {
    void completeLiveSquadRun({
      runId: session.squadRunId,
      summary: squadTranscriptPreview,
    }).catch((err) => {
      logger.warn({ err, runId: session.squadRunId }, "Failed to complete live squad run");
    });
  }

  const endedAt = new Date();
  // Clamp to non-negative: startedAt is anchored to the carrier answer time,
  // which (after ingress validation) can be up to a few seconds in the future
  // for a very short call, so guard the subtraction against a negative result.
  const wallClockSeconds = Math.max(0, Math.floor((endedAt.getTime() - session.startedAt.getTime()) / 1000));
  // Bill conversation time, not idle keepalive until maxDuration. Recording /
  // last media omit VoBiz silence frames, so a 2-minute talk that lingered to
  // the 8-minute max must charge ~2 minutes (ceil), not ₹40 for 8.
  const recording = session.pipeline.getRecording();
  const durationSeconds = resolveBillableDurationSeconds({
    wallClockSeconds,
    startedAtMs: session.startedAt.getTime(),
    lastMediaAtMs: session.pipeline.getLastMediaAtMs(),
    recordingSeconds: recording.getCapturedDurationSeconds() || null,
  });
  if (wallClockSeconds - durationSeconds >= 30) {
    logger.warn(
      {
        sessionId,
        callId: session.callId,
        wallClockSeconds,
        billableSeconds: durationSeconds,
        endReason: reason ?? session.pipeline.endReasonHint ?? null,
        recordingSeconds: recording.getCapturedDurationSeconds(),
        lastMediaAtMs: session.pipeline.getLastMediaAtMs(),
      },
      "Billable duration shorter than wall-clock — idle tail not charged",
    );
  }
  // Redact high-risk secrets (card numbers, PAN, Aadhaar, CVV/OTP/PIN) before
  // the transcript is persisted or sent to webhooks/summaries. Phone/email are
  // intentionally preserved — they are legitimate lead-capture data.
  const transcript = redactTranscriptPII(fullTranscript);

  const { metricsAcc } = session;
  const avgSttMs = metricsAcc.count > 0 ? Math.round(metricsAcc.sttTotal / metricsAcc.count) : null;
  const avgLlmMs = metricsAcc.count > 0 ? Math.round(metricsAcc.llmTotal / metricsAcc.count) : null;
  const avgTtsMs = metricsAcc.count > 0 ? Math.round(metricsAcc.ttsTotal / metricsAcc.count) : null;

  try {
    // Voicemail status: AMD action executed, OR amdResult=machine, OR transcript
    // clearly shows a VM greeting (call 14439: STT heard "Voice mail..." and the
    // agent said "reached the voicemail" but status stayed Completed).
    let amdResultAtEnd: string | null = null;
    try {
      const [amdRow] = await db
        .select({ amdResult: callsTable.amdResult })
        .from(callsTable)
        .where(eq(callsTable.id, session.callId))
        .limit(1);
      amdResultAtEnd = amdRow?.amdResult ?? null;
    } catch { /* non-critical */ }

    const markedVoicemail = shouldMarkCallVoicemail({
      voicemailActionExecuted: session.voicemailActionExecuted,
      amdResult: amdResultAtEnd,
      transcript,
    });
    const noTurnsDrop = metricsAcc.count === 0 && durationSeconds <= 15 && !session.wasTransferred;
    // Silent agent with a real caller (or long idle with zero turns) must not look
    // like a successful conversation — History used to show completed + no error.
    const agentAudioSec = recording.getAgentCapturedSeconds();
    const callerAudioSec = recording.getCallerCapturedSeconds();
    const callerInTranscript = /\bCaller:\s*\S/.test(transcript);
    const agentInTranscript = /\bAgent:\s*\S/.test(transcript);
    const silentAgentFailure =
      !markedVoicemail
      && !session.wasTransferred
      && agentAudioSec < 0.25
      && !agentInTranscript
      && (callerInTranscript || callerAudioSec >= 0.4)
      && durationSeconds > 3;
    let callStatus = markedVoicemail
      ? "voicemail"
      : session.wasTransferred
        ? "transferred"
        : silentAgentFailure
          ? "failed"
          : noTurnsDrop
            ? "no_pickup"
            : "completed";
    const silentErrorMessage = silentAgentFailure ? "no_agent_audio" : null;
    if (silentAgentFailure) {
      logger.warn(
        {
          sessionId,
          callId: session.callId,
          durationSeconds,
          agentAudioSec,
          callerAudioSec,
          turnCount: metricsAcc.count,
        },
        "endSession: marking failed — caller present but no agent audio",
      );
    }
    if (markedVoicemail && !session.voicemailActionExecuted) {
      logger.info(
        {
          sessionId,
          callId: session.callId,
          amdResult: amdResultAtEnd,
          viaTranscript: shouldMarkCallVoicemail({
            voicemailActionExecuted: false,
            amdResult: null,
            transcript,
          }),
        },
        "endSession: marking call voicemail from AMD/transcript (action not latched)",
      );
    }

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
      // Race the finalize against a 60 s timeout so a hung DB insert (e.g. pool
      // exhaustion when multiple calls end simultaneously) never blocks the
      // db.update(status:"completed") below — which is what leaves calls stuck
      // "in_progress" indefinitely.
      const finalizeProm = session.pipeline.getRecording().finalize(session.callId);
      const timeoutProm  = new Promise<{ url: null; error: string }>((resolve) =>
        setTimeout(() => resolve({ url: null, error: "Recording finalize timed out after 60 s" }), 60_000),
      );
      const result = await Promise.race([finalizeProm, timeoutProm])
        .catch((err) => {
          logger.error({ sessionId, callId: session.callId, err }, "Recording finalize threw");
          return { url: null as null, error: err instanceof Error ? err.message : String(err) };
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

    // Check if a booking was completed during this call (native_booking tool writes bookings.call_id)
    let bookingCompletedThisCall = false;
    try {
      const [bookingRow] = await db
        .select({ id: bookingsTable.id })
        .from(bookingsTable)
        .where(eq(bookingsTable.callId, session.callId))
        .limit(1);
      bookingCompletedThisCall = !!bookingRow;
    } catch { /* non-critical — default to false */ }

    // Closing-statement signal: if the final portion of the transcript contains
    // typical farewell language from the agent (cross-language), treat as completed
    // even when the transport closed without the pipeline explicitly calling end_call.
    const closingPhrases = ["thank you", "goodbye", "bye", "have a great", "have a nice", "take care",
      "talk soon", "speak soon", "wish you good health", "धन्यवाद", "अलविदा", "नमस्ते", "நன்றி", "நல்வாழ்த்துக்கள்", "பாய்"];
    const lastChunk = (transcript ?? "").slice(-600).toLowerCase();
    const hasClosingSignal = metricsAcc.count > 0 && closingPhrases.some(p => lastChunk.includes(p));
    const conversationCompleted = session.naturalEndTriggered || session.wasTransferred || bookingCompletedThisCall || hasClosingSignal;

    // Board / Product-Moat analytics (forward-only). primaryLanguage = the caller
    // language the pipeline settled on, else the agent's configured language.
    // memoryRecognized = a returning caller (>=1 prior call) whose cross-call
    // memory was loaded at session start.
    const primaryLanguage = session.pipeline.getPreferredCallerLang() || session.configuredLanguage || null;
    const memoryRecognized = (session.callerProfileSnapshot?.callCount ?? 0) >= 1;

    let transferMetaPatch: { metadata: string } | Record<string, never> = {};
    if (session.wasTransferred && session.transferredTo) {
      try {
        const [existingCall] = await db
          .select({ metadata: callsTable.metadata })
          .from(callsTable)
          .where(eq(callsTable.id, session.callId))
          .limit(1);
        let prevMeta: Record<string, unknown> = {};
        try {
          prevMeta = existingCall?.metadata
            ? JSON.parse(existingCall.metadata) as Record<string, unknown>
            : {};
        } catch { /* ignore */ }
        transferMetaPatch = {
          metadata: JSON.stringify({
            ...prevMeta,
            transferredTo: session.transferredTo,
          }),
        };
      } catch {
        transferMetaPatch = {
          metadata: JSON.stringify({ transferredTo: session.transferredTo }),
        };
      }
    }

    await db.update(callsTable).set({
      status: callStatus,
      endedAt,
      durationSeconds,
      transcript: transcript || null,
      ...(silentErrorMessage ? { errorMessage: silentErrorMessage } : {}),
      sttLatencyMs: avgSttMs,
      llmLatencyMs: avgLlmMs,
      ttsFirstChunkMs: avgTtsMs,
      conversationCompleted,
      primaryLanguage,
      memoryRecognized,
      ...(tokensSavedValue > 0 ? { tokensSaved: tokensSavedValue } : {}),
      ...(recordingUrl ? { recordingUrl } : {}),
      ...(recordingError ? { recordingError } : {}),
      ...transferMetaPatch,
    }).where(eq(callsTable.id, session.callId));

    // Top up the candidate profile with the recording and transcript. Both only
    // exist now, so the profile written mid-call carries nulls for them. No-op
    // for every agent that is not running an intake form.
    void attachIntakeCallArtifacts({
      callId: session.callId,
      recordingUrl,
      transcript: transcript || null,
      durationSeconds,
    });

    // ── Mark campaign lead terminal (drains the active Connected count) ──────────
    if (session.campaignLeadId) {
      const leadId = session.campaignLeadId;

      // Park answered hangups with classifyCampaignCallEnd — never mark a real
      // conversation Failed just because duration>15 and naturalEnd was false
      // (legacy midConvDrop inflated Failed KPIs; audit: ~81% of Failed had
      // completed call duration). Genuine media drops still retry.
      const isVoicemail = markedVoicemail || callStatus === "voicemail";

      // Single sequential flow so retry scheduling, operational-outcome
      // computation, and reconcile run in a deterministic order:
      //   update status → schedule retry → set outcome (using !retryScheduled)
      //   → refill/reconcile (which keeps the batch open while a retry is pending).
      void (async () => {
        const { lastUser: hangupLastUser } = session.pipeline.getLastTurnTexts();
        const callEndedReason = resolveCallEndedReason({
          reason,
          wasTransferred: session.wasTransferred,
          endReasonHint: session.pipeline.endReasonHint,
          naturalEndTriggered: session.naturalEndTriggered,
          turnCount: metricsAcc.count,
          durationSeconds,
          direction: "outbound",
        });
        const expectedDisconnect = inferExpectedDisconnect(callEndedReason);
        let answeredEver = true;
        let existingDisposition: string | null = null;
        let previousCallStatus: string | null = "connected";
        let campaignId: number | null = null;
        let batchId: number | null = null;
        let callAttempts = 0;
        try {
          const [leadRow] = await db
            .select({
              answeredEver: campaignLeadsTable.answeredEver,
              disposition: campaignLeadsTable.disposition,
              callStatus: campaignLeadsTable.callStatus,
              campaignId: campaignLeadsTable.campaignId,
              batchId: campaignLeadsTable.batchId,
              callAttempts: campaignLeadsTable.callAttempts,
            })
            .from(campaignLeadsTable)
            .where(eq(campaignLeadsTable.id, leadId))
            .limit(1);
          answeredEver = true;
          existingDisposition = leadRow?.disposition ?? null;
          previousCallStatus = leadRow?.callStatus ?? "connected";
          campaignId = leadRow?.campaignId ?? null;
          batchId = leadRow?.batchId ?? null;
          callAttempts = leadRow?.callAttempts ?? 0;
        } catch {
          /* classify still proceeds with session defaults */
        }

        const v2Classification = classifyCampaignCallEnd({
          naturalEndTriggered: session.naturalEndTriggered,
          wasTransferred: session.wasTransferred,
          conversationCompleted,
          transcriptHasFarewellEnding: transcriptHasFarewellEnding(transcript),
          endReasonHint: session.pipeline.endReasonHint,
          callEndedReason,
          expectedDisconnect,
          turnCount: metricsAcc.count,
          durationSeconds,
          isVoicemail,
          waitingForReply: session.pipeline.endReasonHint === "media_disconnect",
          disposition: existingDisposition,
          lastUserTranscript: hangupLastUser,
        });
        const legacyHangup = classifyCampaignHangupLegacy({
          isVoicemail,
          naturalEndTriggered: session.naturalEndTriggered,
          wasTransferred: session.wasTransferred,
          durationSeconds,
        });

        if (shouldLogCampaignLeadStateV2Shadow()) {
          logger.info(
            {
              event: "campaign_lead_state_v2_shadow",
              campaignLeadId: leadId,
              campaignId,
              callId: session.callId,
              ...buildCampaignLeadStateV2Shadow({
                answeredEver,
                classification: v2Classification,
                legacy: legacyHangup,
                endReasonHint: session.pipeline.endReasonHint,
                callEndedReason,
                expectedDisconnect,
                durationSeconds,
                turnCount: metricsAcc.count,
                conversationCompleted,
                naturalEndTriggered: session.naturalEndTriggered,
              }),
            },
            "Campaign lead state V2 shadow comparison",
          );
        }

        const v2Writer = isCampaignLeadStateV2Writer(campaignId);
        let retryScheduled = false;
        let retryId: number | null = null;
        let retryReasonUsed: string | null = v2Classification.proposedRetryReason;
        let parkedStatus = v2Classification.proposedLeadStatus;
        let lastAttemptStatus = v2Classification.lastAttemptStatus;

        if (v2Writer) {
          try {
            const [camp] = campaignId
              ? await db
                  .select({ maxAttempts: campaignsTable.maxAttempts, retryDelayMinutes: campaignsTable.retryDelayMinutes })
                  .from(campaignsTable)
                  .where(eq(campaignsTable.id, campaignId))
                  .limit(1)
              : [undefined];
            const { maxAttempts, retryDelayMinutes } = await resolveRetryConfig(batchId, camp ?? null);
            const applied = await applyV2AnsweredHangup({
              leadId,
              campaignId: campaignId ?? 0,
              callId: session.callId,
              currentAttempts: callAttempts,
              maxAttempts,
              retryDelayMinutes,
              classification: v2Classification,
            });
            parkedStatus = applied.finalCallStatus;
            lastAttemptStatus = applied.lastAttemptStatus;
            retryScheduled = applied.retryScheduled;
            retryId = applied.retryId;
            retryReasonUsed = applied.retryReason;
          } catch (err) {
            logger.warn({ campaignLeadId: leadId, err }, "Failed to apply V2 answered hangup");
            return;
          }
        } else {
          // Default path: same classifier as V2 for park/retry (no midConvDrop).
          const plan = planV2AnsweredHangup({
            answeredEver: true,
            classification: v2Classification,
          });
          try {
            if (plan.wantsRetry && plan.retryReason) {
              const [freshLead] = await db
                .select({
                  callAttempts: campaignLeadsTable.callAttempts,
                  campaignId: campaignLeadsTable.campaignId,
                  batchId: campaignLeadsTable.batchId,
                })
                .from(campaignLeadsTable)
                .where(eq(campaignLeadsTable.id, leadId))
                .limit(1);
              if (freshLead) {
                const [camp] = await db
                  .select({ maxAttempts: campaignsTable.maxAttempts, retryDelayMinutes: campaignsTable.retryDelayMinutes })
                  .from(campaignsTable)
                  .where(eq(campaignsTable.id, freshLead.campaignId))
                  .limit(1);
                const { maxAttempts, retryDelayMinutes } = await resolveRetryConfig(freshLead.batchId, camp);
                retryScheduled = await import("../services/retryEngine.js")
                  .then((m) => m.scheduleRetry({
                    leadId,
                    campaignId: freshLead.campaignId,
                    currentAttempts: freshLead.callAttempts ?? 0,
                    maxAttempts,
                    retryDelayMinutes,
                    reason: plan.retryReason!,
                  }));
              }
            }
            const finalized = finalizeV2Park({ plan, retryOk: retryScheduled });
            parkedStatus = finalized.callStatus;
            lastAttemptStatus = finalized.lastAttemptStatus;
            retryReasonUsed = plan.retryReason;
            await db.update(campaignLeadsTable)
              .set({
                callStatus: parkedStatus,
                lastAttemptStatus,
              })
              .where(eq(campaignLeadsTable.id, leadId));
            logger.info(
              {
                campaignLeadId: leadId,
                durationSeconds,
                parkedStatus,
                lastAttemptStatus,
                retryReason: retryReasonUsed,
                retryScheduled,
                classifierClass: v2Classification.class,
              },
              "Campaign call terminal — classifier park",
            );
          } catch (err) {
            logger.warn({ campaignLeadId: leadId, err }, "Failed to mark campaign lead terminal");
            return;
          }

          void recordCallExecutionOutcome(session.callId, lastAttemptStatus)
            .catch((err) => {
              logger.warn({ campaignLeadId: leadId, callId: session.callId, err }, "Failed to record call execution outcome");
            });
        }

        let operationalOutcome: string | null = null;
        // ── Compute & persist operational outcome ─────────────────────────────
        // Checks for a booking created during this call (bookings.call_id =
        // session.callId), a pending callback, and max-attempts exhaustion, then
        // writes the canonical operationalOutcome so the batch workspace KPI
        // cards update.
        try {
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

          // Max-attempts check — resolve from the lead's batch (Execution Rules),
          // falling back to the campaign-level default only when unset.
          const [freshLead] = await db
            .select({
              callAttempts: campaignLeadsTable.callAttempts,
              campaignId:   campaignLeadsTable.campaignId,
              batchId:      campaignLeadsTable.batchId,
            })
            .from(campaignLeadsTable)
            .where(eq(campaignLeadsTable.id, leadId))
            .limit(1);

          let maxAttemptsReached = false;
          if (isVoicemail) {
            // A voicemail with a scheduled retry stays pending; the outcome only
            // finalizes once the last configured attempt also ends in voicemail
            // (no retry scheduled) — same pattern as the webhook terminal path.
            maxAttemptsReached = !retryScheduled;
          } else if (freshLead) {
            const [camp] = await db
              .select({ maxAttempts: campaignsTable.maxAttempts, retryDelayMinutes: campaignsTable.retryDelayMinutes })
              .from(campaignsTable)
              .where(eq(campaignsTable.id, freshLead.campaignId))
              .limit(1);
            if (camp) {
              const { maxAttempts } = await resolveRetryConfig(freshLead.batchId, camp);
              maxAttemptsReached = (freshLead.callAttempts ?? 0) >= maxAttempts;
            }
          }

          const outcomeCallStatus = parkedStatus;
          const outcome = computeOperationalOutcome({
            callStatus:           outcomeCallStatus,
            disposition:          v2Writer ? existingDisposition : null,
            hasBooking,
            hasCompletedTransfer: session.wasTransferred,
            hasPendingCallback,
            maxAttemptsReached,
            isDncBlocked:         false,
          });

          if (v2Writer && outcome === "failed") {
            operationalOutcome = "pending";
          } else {
            operationalOutcome = outcome;
            if (freshLead) {
              await setOperationalOutcome(db, leadId, freshLead.campaignId, outcome);
              logger.info(
                { leadId, outcome, hasBooking, wasTransferred: session.wasTransferred, hasPendingCallback, retryScheduled },
                "Campaign lead operational outcome set",
              );
            }
          }
        } catch (outcomeErr) {
          logger.warn({ campaignLeadId: leadId, outcomeErr }, "Failed to set campaign lead operational outcome");
        }

        if (shouldLogCampaignLeadStateV2Canary(campaignId)) {
          logger.info(
            buildCampaignLeadStateV2CanaryLog({
              campaignId,
              leadId,
              callId: session.callId,
              answeredEver: true,
              classifierClass: v2Classification.class,
              endReason: callEndedReason,
              expectedDisconnect,
              previousCallStatus,
              finalCallStatus: parkedStatus,
              lastAttemptStatus,
              retryScheduled,
              retryReason: retryReasonUsed,
              retryId,
              retryCancelledAfterDisposition: false,
              disposition: existingDisposition,
              operationalOutcome,
              attempts: callAttempts,
            }),
            CAMPAIGN_LEAD_STATE_V2_EVENT,
          );
        }

        // Rolling concurrency + reconcile: this call freed a slot, so top the
        // campaign back up to its limit rather than waiting for the next 60 s
        // poll. Runs AFTER retry scheduling so a pending call_retries row
        // correctly keeps the batch/campaign open. Fire-and-forget.
        void refillCampaignForLead(leadId);
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

      // ── Resume context generation (fire-and-forget, every non-trivial call) ────
      // Runs after every call with a meaningful transcript (not just drops) so the
      // context is stored and ready if a network-drop callback fires.
      // Campaign calls are excluded — they manage their own retry context.
      const isCampaignCall  = !!session.campaignLeadId;
      if (ag && transcript && transcript.length > 100 && !isCampaignCall) {
        void (async () => {
          try {
            const ctxLlmProvs = await db.select().from(providersTable).where(
              and(
                eq(providersTable.isActive, true),
                ...(session.agentUserId ? [eq(providersTable.userId, session.agentUserId)] : []),
                eq(providersTable.providerName, session.agentLlmProvider),
              ),
            );
            // Decrypt BYOP provider key — same as all other post-call LLM paths
            let ctxLlmKey: string | null = ctxLlmProvs[0] ? decryptKey(ctxLlmProvs[0].apiKey) : null;
            let ctxLlmProvider = session.agentLlmProvider;
            let ctxLlmModel    = session.agentLlmModel;
            if (!ctxLlmKey) {
              const [row] = await db.select().from(platformSettingsTable).where(eq(platformSettingsTable.key, "managed_qwen_key"));
              ctxLlmKey = row?.value?.trim() || process.env["GROQ_API_KEY"] || null;
              if (ctxLlmKey) {
                ctxLlmProvider = "groq";
                ctxLlmModel    = "llama-3.1-70b-versatile";
              }
            }
            if (!ctxLlmKey) return;

            // Read persisted tool execution log from DB so toolResults is based on
            // actual execution history, not inferred from transcript text alone.
            const toolExecRows = await db
              .select({
                metadata: executionLogsTable.metadata,
                responsePayload: executionLogsTable.responsePayload,
              })
              .from(executionLogsTable)
              .where(
                and(
                  eq(executionLogsTable.callId, session.callId),
                  eq(executionLogsTable.component, "Tool"),
                  eq(executionLogsTable.direction, "response"),
                ),
              )
              .orderBy(executionLogsTable.ts);
            const toolLogLines = toolExecRows.map((r) => {
              const m = r.metadata as Record<string, unknown> | null;
              const toolName  = (m?.["tool"] as string | undefined) ?? "unknown_tool";
              const toolResult = (m?.["result"] as string | undefined)
                ?? JSON.stringify(r.responsePayload ?? {}).slice(0, 300);
              return `${toolName}: ${toolResult}`;
            });
            const toolLogBlock = toolLogLines.length > 0
              ? `\n\nTool execution log (EXACT results — use these verbatim for toolResults):\n${toolLogLines.join("\n")}`
              : "";

            const ctxLlm = createLLMAdapter(ctxLlmProvider, ctxLlmKey, ctxLlmModel);
            // Freeze relative dates: this snapshot is reused on a later callback, so
            // "tomorrow" must be captured as an absolute date or the callback agent
            // will restate the wrong day.
            const rcToday = new Date().toLocaleString("en-IN", {
              weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Kolkata",
            });
            const ctxUserContent =
              `The following is a transcript of a voice call that took place on ${rcToday}. ` +
              `Extract a complete context snapshot so the agent can continue naturally if it needs to call back. ` +
              `When the transcript mentions relative dates or times ("tomorrow", "next Monday", "in two days"), ` +
              `convert them to absolute calendar dates in the summary and extractedFacts so they stay accurate on a later call.\n\n` +
              `Transcript:\n${transcript.slice(-4000)}${toolLogBlock}\n\n` +
              `Respond ONLY with a JSON object (no markdown, no explanation) with these exact keys:\n` +
              `{"summary":"<2-3 sentence summary of the whole call>",` +
              `"extractedFacts":["<fact about the customer: name, date, preference, etc.>"],` +
              `"completedSteps":["<step that was fully completed>"],` +
              `"pendingSteps":["<step that was not yet completed, in order>"],` +
              `"lastAgentMessage":"<verbatim or paraphrased last thing the agent said>",` +
              `"lastCustomerMessage":"<verbatim or paraphrased last thing the customer said>",` +
              `"toolResults":["<exact tool name: exact result from tool execution log above>"]}`
            let jsonStr = "";
            await ctxLlm.chat(
              [{ role: "user", content: ctxUserContent }],
              "You are a call analyst. Extract a context snapshot from a voice call transcript as a JSON object. Respond only with valid JSON, no markdown, no explanation.",
              () => {},
              (full) => { jsonStr = full; },
            );
            const stripped = jsonStr.trim().replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
            const parsed = JSON.parse(stripped) as {
              summary: string;
              extractedFacts: string[];
              completedSteps: string[];
              pendingSteps: string[];
              lastAgentMessage: string;
              lastCustomerMessage: string;
              toolResults: string[];
            };
            if (parsed?.summary) {
              await db.update(callsTable).set({ resumeContext: parsed }).where(eq(callsTable.id, session.callId));
              logger.info({ sessionId }, "Resume context generated and stored");
            }
          } catch (ctxErr) {
            logger.warn({ sessionId, ctxErr }, "Resume context generation failed — callback will proceed without prior context");
          }
        })();
      }

      // ── Network-drop detection + auto-callback ────────────────────────────────
      // When autoRedial is enabled, the call dropped unexpectedly, it's a real PSTN
      // call, schedule an immediate single-attempt network-drop callback.
      // SINGLE-RETRY INVARIANT: if this call was itself a network-drop callback retry
      // (sourceCallbackReason === "network_drop"), never schedule another — prevents
      // an infinite redial chain when the retry call also drops.
      //
      // FAREWELL / COMPLETED GUARD: suppress auto-redial when the caller said
      // goodbye (incl. Tamil பாய்), the agent already delivered a closing line,
      // or naturalEnd/end_call fired — those are successful ends, not drops.
      const storedRedial = (ag?.agentConfig as { autoRedial?: { enabled?: boolean; delayMinutes?: number; maxAttempts?: number } } | null)?.autoRedial;
      const autoRedialCfg = storedRedial?.enabled
        ? storedRedial
        : ag?.agentType === INTAKE_AGENT_TYPE
          ? { enabled: true, maxAttempts: 3, delayMinutes: 2 }
          : storedRedial;
      const wasUnexpectedDrop = !session.naturalEndTriggered && !session.wasTransferred && !conversationCompleted;
      const isRealPhoneCall = session.callerPhone && !session.callerPhone.startsWith("webcall:");
      const isNetworkDropRetry = session.sourceCallbackReason === "network_drop";
      const hasFarewellEnding = transcriptHasFarewellEnding(transcript);
      const hasConversationContent = metricsAcc.count > 0;
      if (ag && autoRedialCfg?.enabled && wasUnexpectedDrop && !hasFarewellEnding && hasConversationContent && isRealPhoneCall && !isCampaignCall && !isNetworkDropRetry) {
        void scheduleNetworkDropCallback({
          agentId:  ag.id,
          toNumber: session.callerPhone!,
          userId:   ag.userId ?? null,
          callId:   session.callId,
        }).catch((rdErr) => {
          logger.warn({ sessionId, rdErr }, "Network-drop callback scheduling failed");
        });
      } else if (ag && autoRedialCfg?.enabled && !session.naturalEndTriggered && !session.wasTransferred && isRealPhoneCall && !isCampaignCall && !isNetworkDropRetry) {
        const tail = transcript.slice(-100);
        if (conversationCompleted) {
          logger.info({ sessionId, tail }, "Network-drop suppressed: conversation already completed (closing signal)");
        } else if (hasFarewellEnding) {
          logger.info({ sessionId, tail }, "Network-drop suppressed: farewell detected in transcript tail");
        } else if (!hasConversationContent) {
          logger.info({ sessionId }, "Network-drop suppressed: zero-turn drop (no conversation content)");
        }
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

        if (session.pipeline instanceof OpenAIRealtimePipeline) {
          // Speech-to-speech: one model bills audio+text tokens, plus the
          // caller-transcription model. No separate STT/TTS provider exists.
          const rt = session.pipeline.getRealtimeUsage();
          void recordUsage({
            service: "llm",
            provider: "openai_realtime",
            model: rt.model,
            userId: ag.userId ?? null,
            callId: call.id,
            inputTokens: rt.inputTokens,
            outputTokens: rt.outputTokens,
            success,
            errorMessage,
            metadata: {
              callSeconds: safeDuration,
              inputAudioTokens: rt.inputAudioTokens,
              inputTextTokens: rt.inputTextTokens,
              inputCachedTokens: rt.inputCachedTokens,
              outputAudioTokens: rt.outputAudioTokens,
              outputTextTokens: rt.outputTextTokens,
              responses: rt.responses,
            },
          });
          void recordUsage({
            service: "stt",
            provider: "openai",
            model: rt.transcribeModel,
            userId: ag.userId ?? null,
            callId: call.id,
            inputTokens: rt.transcribeInputTokens,
            outputTokens: rt.transcribeOutputTokens,
            success,
            errorMessage,
          });
        } else {
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
        // no_pickup / busy / failed: never charge a full minute (or anything) —
        // common for short webcalls that never start a turn.
        if (
          sessionCallUserId &&
          durationSeconds > 0 &&
          !isNonBillableCallStatus(callStatus) &&
          !(call.costCents != null && call.costCents > 0)
        ) {
          try {
            const billingMode     = await resolveAgentBillingMode(sessionCallUserId, ag);
            // Partner-managed clients bill at their partner-set rate; spread is
            // credited to the partner after the debit below.
            const partnerBilling  = await resolvePartnerBilling(sessionCallUserId);
            const rateCentsPerMin = partnerBilling?.clientRateCentsPerMin
              ?? Math.max(0, (await resolveBillingRateCentsPerMin(billingMode)) - await resolveOwnTelephonyDiscount(sessionCallUserId, ag));
            const modeLabel       = partnerBilling ? "partner" : billingMode === "managed" ? "managed" : "BYOP";
            const rateLabel       = `₹${(rateCentsPerMin / 100).toFixed(2)}/min (${modeLabel})`;
            const debitCents      = computeProRataDebitCents(durationSeconds, rateCentsPerMin);
            if (debitCents > 0) {
              // Atomic billing claim: flip costCents from unset→set in ONE
              // conditional UPDATE — only the winner debits + credits (the
              // HTTP PATCH /calls/:id/end route can race this WS-close path;
              // the pre-read costCents check alone lets both paths bill).
              const claimed = await db.update(callsTable)
                .set({ costCents: debitCents })
                .where(and(
                  eq(callsTable.id, session.callId),
                  or(isNull(callsTable.costCents), lte(callsTable.costCents, 0)),
                ))
                .returning({ id: callsTable.id });
              if (claimed.length === 0) {
                logger.info({ sessionId, callId: session.callId }, "Billing already claimed by another end path — skipping debit");
              }
              const [billingUser] = claimed.length > 0
                ? await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.clerkId, sessionCallUserId))
                : [];
              if (billingUser) {
                // Atomic in-DB decrement (GREATEST clamps at 0) so two calls debiting the
                // same wallet concurrently never overwrite each other's write (lost update).
                await db.update(usersTable)
                  .set({ walletBalanceCents: sql`GREATEST(0, ${usersTable.walletBalanceCents} - ${debitCents})` })
                  .where(eq(usersTable.id, billingUser.id));
                await db.insert(walletTransactionsTable).values({
                  userId:      billingUser.id,
                  type:        "call_debit",
                  amountCents: -debitCents,
                  description: `Call #${session.callId} — ${durationSeconds}s @ ${rateLabel}`,
                  status:      "completed",
                  callId:      session.callId,
                });
                logger.info({ sessionId, callId: session.callId, debitCents, billingMode }, "Call billed in endSession");

                // Partner spread — credit the client's partner with (client rate − base rate).
                if (partnerBilling) {
                  try {
                    const spreadCents = await creditPartnerSpreadOnCall({
                      partner: partnerBilling,
                      callId: session.callId,
                      durationSeconds,
                      debitCents,
                    });
                    if (spreadCents > 0) {
                      logger.info({ sessionId, callId: session.callId, partnerId: partnerBilling.partnerId, spreadCents }, "Partner spread credited in endSession");
                    }
                  } catch (spreadErr) {
                    logger.error({ sessionId, spreadErr, callId: session.callId, partnerId: partnerBilling.partnerId }, "Partner spread credit failed in endSession");
                  }
                }
              }
            }
          } catch (billingErr) {
            logger.error({ sessionId, billingErr }, "Billing failed in endSession");
          }
        }

        // ── End-of-call execution log (structured Call Ended summary) ─────────────
        // Always the final row: explains WHY the call ended. Reason is taken from
        // the explicit `reason` arg (e.g. max-duration timer) when provided, then
        // the pipeline's endReasonHint (e.g. silence timeout — the pipeline fires
        // onCallEnd without a reason arg, so without the hint a silence-timeout
        // hangup would be mislabeled "Conversation completed"), otherwise derived
        // from the session's end flags.
        const endRawReason = (() => {
          const raw = reason
            ?? (session.wasTransferred ? "transfer_completed"
                : session.pipeline.endReasonHint ? session.pipeline.endReasonHint
                : session.naturalEndTriggered ? "completed"
                : "user_hangup");
          // Outbound dropped with zero turns after a short opener is almost never
          // a deliberate callee hangup — VoBiz closed the media bridge (4010).
          let direction = "inbound";
          try {
            const md = call.metadata ? JSON.parse(call.metadata) as Record<string, unknown> : {};
            if (typeof md["direction"] === "string") direction = md["direction"];
          } catch { /* ignore */ }
          if (
            raw === "user_hangup"
            && metricsAcc.count === 0
            && durationSeconds > 0
            && durationSeconds < 45
            && direction === "outbound"
          ) {
            return "early_media_drop";
          }
          return raw;
        })();
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
          let successEvaluation: string | null = null;

          // 1. Generate call summary when the agent has Auto Summarization on.
          // Uses BYOP key when available; falls back to platform managed key (Groq).
          const rawSum = agCfgForWebhook["summarizationEnabled"];
          const summarizationEnabled = rawSum === true || rawSum === "true" || rawSum === 1 || rawSum === "1";
          if (summarizationEnabled) {
            try {
              const hasTranscript = !!(transcript && transcript.trim().length > 0);
              if (!hasTranscript) {
                // Empty-transcript edge case: store a short placeholder rather than failing.
                callSummary = "No conversation took place on this call, so there is nothing to summarize.";
                await db.update(callsTable).set({ callSummary }).where(eq(callsTable.id, session.callId));
              } else {
                let sumLlmKey: string | null = null;
                let sumLlmProvider = ag.llmProvider;
                let sumLlmModel = ag.llmModel;

                if (ag.userId) {
                  const llmProvs = await db.select().from(providersTable).where(
                    and(
                      eq(providersTable.isActive, true),
                      eq(providersTable.userId, ag.userId),
                      eq(providersTable.providerName, ag.llmProvider)
                    )
                  );
                  if (llmProvs[0]) {
                    sumLlmKey = decryptKey(llmProvs[0].apiKey);
                  }
                }
                // Managed plan: no BYOP key → fall back to Admin Panel managed keys
                // Priority: (1) BYOP key, (2) admin managed_sarvam_key (Sarvam-105B / GLM 5.2), (3) admin managed_groq_key, (4) env GROQ_API_KEY
                let fallbackGroqKey: string | null = null;
                if (!sumLlmKey) {
                  const platformRows = await db
                    .select()
                    .from(platformSettingsTable)
                    .where(inArray(platformSettingsTable.key, ["managed_sarvam_key", "managed_groq_key", "managed_qwen_key"]));
                  const byKey = Object.fromEntries(platformRows.map((r) => [r.key, r.value?.trim() || ""]));

                  const sarvamKey = byKey["managed_sarvam_key"] || process.env["SARVAM_API_KEY"] || null;
                  fallbackGroqKey = byKey["managed_groq_key"] || byKey["managed_qwen_key"] || process.env["GROQ_API_KEY"] || null;

                  if (sarvamKey) {
                    sumLlmProvider = "sarvam";
                    sumLlmKey = sarvamKey;
                    sumLlmModel = "sarvam-105b";
                  } else if (fallbackGroqKey) {
                    sumLlmProvider = "groq";
                    sumLlmKey = fallbackGroqKey;
                    sumLlmModel = "llama-3.1-70b-versatile";
                  }
                }
                if (sumLlmKey) {
                  const customPrompt = (agCfgForWebhook["summarizationPrompt"] as string | undefined) ?? "";
                  // Freeze relative dates to absolute ones. This summary is replayed
                  // as cross-call memory on future calls; a bare "tomorrow" written
                  // today would still read as "tomorrow" next week and make the
                  // follow-up agent misstate the meeting date.
                  const sumTz = (agCfgForWebhook["timezone"] as string | undefined) || "Asia/Kolkata";
                  const sumToday = new Date().toLocaleString("en-IN", {
                    weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: sumTz,
                  });
                  const dateRule =
                    `This call took place on ${sumToday}. When the transcript mentions relative dates or ` +
                    `times ("tomorrow", "next Monday", "in two days", "this evening"), convert them to ` +
                    `absolute calendar dates in your summary (e.g. "on Saturday, 19 July 2026") so it stays ` +
                    `accurate when read on a later call. Never keep bare relative day-words.`;
                  const baseInstruction = customPrompt
                    ? customPrompt
                    : `Summarize this call transcript as a single natural paragraph of 4 to 6 sentences. Briefly cover why the customer called, what was discussed, any important information collected, the outcome, and any follow-up or next steps (only if applicable). Write plain prose — do not use bullet points, numbered lists, or headings.`;
                  const userContent = `${baseInstruction}\n\n${dateRule}\n\nTranscript:\n${transcript.slice(0, 6000)}`;
                  let summary = "";

                  // Try primary model (BYOP, or Sarvam-105B, or Groq Llama 3.3)
                  try {
                    const llm = createLLMAdapter(sumLlmProvider, sumLlmKey, sumLlmModel);
                    await llm.chat(
                      [{ role: "user", content: userContent }],
                      "You are a call analyst. Write a concise, factual summary of the call as a single natural paragraph of 4 to 6 sentences. Do not use bullet points, numbered lists, or headings — write plain readable prose only.",
                      () => {},
                      (full) => { summary = full; }
                    );
                  } catch (primaryErr) {
                    logger.warn({ sessionId, agentId: ag.id, provider: sumLlmProvider, model: sumLlmModel, primaryErr }, "Primary summary model failed");
                  }

                  // Fallback 1: If Sarvam-105B produced no output, try Sarvam GLM 5.2
                  if (!summary && sumLlmProvider === "sarvam" && sumLlmKey) {
                    try {
                      logger.info({ sessionId, agentId: ag.id }, "Retrying summary with Sarvam GLM 5.2 (glm5.2)...");
                      const glmLlm = createLLMAdapter("sarvam", sumLlmKey, "glm5.2");
                      await glmLlm.chat(
                        [{ role: "user", content: userContent }],
                        "You are a call analyst. Write a concise, factual summary of the call as a single natural paragraph of 4 to 6 sentences. Do not use bullet points, numbered lists, or headings — write plain readable prose only.",
                        () => {},
                        (full) => { summary = full; }
                      );
                    } catch (glmErr) {
                      logger.warn({ sessionId, agentId: ag.id, glmErr }, "Sarvam GLM 5.2 summary fallback failed");
                    }
                  }

                  // Fallback 2: If Sarvam models produced no output, try Groq fallback key if available
                  if (!summary && fallbackGroqKey && sumLlmProvider !== "groq") {
                    try {
                      logger.info({ sessionId, agentId: ag.id }, "Retrying summary with Groq (llama-3.1-70b-versatile)...");
                      const groqLlm = createLLMAdapter("groq", fallbackGroqKey, "llama-3.1-70b-versatile");
                      await groqLlm.chat(
                        [{ role: "user", content: userContent }],
                        "You are a call analyst. Write a concise, factual summary of the call as a single natural paragraph of 4 to 6 sentences. Do not use bullet points, numbered lists, or headings — write plain readable prose only.",
                        () => {},
                        (full) => { summary = full; }
                      );
                    } catch (groqErr) {
                      logger.warn({ sessionId, agentId: ag.id, groqErr }, "Groq summary fallback failed");
                    }
                  }

                  if (summary) {
                    callSummary = summary;
                    await db.update(callsTable).set({ callSummary: summary }).where(eq(callsTable.id, session.callId));
                  } else {
                    logger.warn({ sessionId, agentId: ag.id }, "Post-call summary: All LLM models returned empty response, callSummary not saved");
                  }
                } else {
                  // summarizationEnabled is true but no LLM key found — log so admins can diagnose.
                  logger.warn(
                    { sessionId, agentId: ag.id, llmProvider: ag.llmProvider },
                    "Post-call summary skipped: no LLM key available (no BYOP key for provider and no platform managed key). " +
                    "Set managed_sarvam_key, managed_groq_key, or SARVAM_API_KEY / GROQ_API_KEY env var."
                  );
                }
              }
            } catch (summaryErr) {
              logger.warn({ sessionId, summaryErr }, "Post-call summary generation failed");
            }
          }

          // 2. Extract disposition BEFORE webhooks.
          // Prefer Builder taxonomy (agent_dispositions) — that path owns Outcomes +
          // Data to collect (WhatsApp etc.). Legacy agents.dispositionSchema only runs
          // when no taxonomy config exists; otherwise it would skip WhatsApp fill.
          try {
            const taxResult = await disposeCall({
              agentId: call.agentId,
              callId: session.callId,
              transcript: transcript || null,
              callEvents: [{ type: "duration", durationSec: durationSeconds }],
              callStartedAt: call.createdAt ?? null,
              calledNumber: call.toNumber ?? null,
            });
            dispositionResult = flatDispositionFromTaxonomy(taxResult);
            if (dispositionResult) {
              logger.info(
                {
                  sessionId,
                  primary: dispositionResult["primary"],
                  sub: dispositionResult["sub"],
                  whatsapp: dispositionResult["whatsapp_number"] ?? null,
                },
                "Taxonomy disposition ready for webhook",
              );
              // Disposition may detect voicemail after status was already written.
              if (
                callStatus !== "voicemail"
                && looksLikeVoicemailOutcome(
                  `${dispositionResult["primary"] ?? ""}: ${dispositionResult["sub"] ?? ""}`,
                  dispositionResult,
                  amdResultAtEnd,
                )
              ) {
                callStatus = "voicemail";
                await db.update(callsTable)
                  .set({ status: "voicemail" })
                  .where(eq(callsTable.id, session.callId));
                logger.info(
                  { sessionId, callId: session.callId, sub: dispositionResult["sub"] },
                  "endSession: upgraded call status to voicemail from disposition",
                );
              }
            }
          } catch (dispErr) {
            logger.warn({ sessionId, dispErr }, "Post-call taxonomy disposition failed");
          }

          if (schemaFieldsNeedFill(dispositionResult, dispositionSchema)) {
            try {
              dispositionResult = await extractFlatDispositionSchema({
                agentId: call.agentId,
                callId: session.callId,
                transcript,
                schema: dispositionSchema,
                existing: dispositionResult,
              });
            } catch (dispErr) {
              logger.warn({ sessionId, dispErr }, "Post-call disposition schema extraction failed");
            }
          }

          // 2b. Campaign conversation intelligence (sentiment / intent / topics).
          // Universal signals for the campaign analytics board — runs after
          // disposition so we can pass dispositionResult as a hint. Non-campaign
          // calls are skipped inside analyzeCallIntelligence.
          if (session.campaignLeadId && transcript && transcript.trim().length >= 20) {
            void import("../services/analyze-call-intelligence.js").then(({ analyzeCallIntelligence }) =>
              analyzeCallIntelligence({
                callId: session.callId,
                leadId: session.campaignLeadId,
                transcript,
                callSummary: callSummary || null,
                dispositionResult,
              }),
            ).catch((intelErr) => {
              logger.warn({ sessionId, intelErr }, "Post-call intelligence analysis failed");
            });
          }

          // 2c. Inbound call → campaign matching ("who called us back?").
          // Campaign dials carry campaignLeadId; anything else inbound from a
          // known lead number gets linked into the campaign Incoming tab.
          if (
            !session.campaignLeadId &&
            ag.userId &&
            call.fromNumber &&
            !call.fromNumber.startsWith("webcall") &&
            !call.toNumber.startsWith("webcall")
          ) {
            let inboundDir = "inbound";
            try {
              const md = call.metadata ? JSON.parse(call.metadata) as Record<string, unknown> : {};
              if (typeof md["direction"] === "string") inboundDir = md["direction"];
            } catch { /* ignore */ }
            if (inboundDir === "inbound") {
              try {
                const { matchInboundCallToCampaigns } = await import("../services/incoming-call-match.js");
                await matchInboundCallToCampaigns({
                  callId: session.callId,
                  userId: ag.userId,
                  callerPhone: call.fromNumber,
                });
              } catch (matchErr) {
                logger.warn({ sessionId, matchErr }, "Inbound campaign match failed");
              }
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
              let evalLlmKey: string | null = evalLlmProvs[0] ? decryptKey(evalLlmProvs[0].apiKey) : null;
              let evalProvider = ag.llmProvider;
              let evalModel = ag.llmModel;
              if (!evalLlmKey) {
                const [row] = await db.select().from(platformSettingsTable).where(eq(platformSettingsTable.key, "managed_qwen_key"));
                evalLlmKey = row?.value?.trim() || process.env["GROQ_API_KEY"] || null;
                if (evalLlmKey) {
                  evalProvider = "groq";
                  evalModel = "llama-3.1-70b-versatile";
                }
              }
              if (evalLlmKey) {
                const evalLlm = createLLMAdapter(evalProvider, evalLlmKey, evalModel);
                let evalRaw = "";
                await evalLlm.chat(
                  [{ role: "user", content: `Success criteria: ${successCriteria}\n\nCall transcript:\n${transcript.slice(0, 6000)}\n\nDid this call meet the success criteria? Reply with PASS or FAIL on the first line, then one sentence of explanation.` }],
                  "You evaluate whether a voice call met predefined success criteria. Be objective and concise. Start your response with PASS or FAIL.",
                  () => {},
                  (full) => { evalRaw = full; }
                );
                if (evalRaw.trim()) {
                  successEvaluation = evalRaw.trim();
                  await db.update(callsTable).set({ successEvaluation }).where(eq(callsTable.id, session.callId));
                  logger.info({ sessionId, verdict: successEvaluation.slice(0, 60) }, "Post-call success evaluation complete");
                }
              }
            } catch (evalErr) {
              logger.warn({ sessionId, evalErr }, "Post-call success evaluation failed");
            }
          }

          // Re-read call for billing/metadata fields written earlier in endSession.
          const [freshCall] = await db.select().from(callsTable).where(eq(callsTable.id, session.callId)).limit(1);
          const webhookPayload = buildCallEndedWebhookPayload({
            callId: session.callId,
            executionId: freshCall?.executionId ?? call.executionId ?? null,
            agentId: ag.id,
            agentName: ag.name,
            status: callStatus,
            fromNumber: call.fromNumber,
            toNumber: call.toNumber,
            durationSeconds,
            costCents: freshCall?.costCents ?? call.costCents ?? null,
            transcript: transcript || null,
            callSummary: callSummary || freshCall?.callSummary || null,
            dispositionResult:
              dispositionResult
              ?? (freshCall?.dispositionResult as Record<string, unknown> | null)
              ?? null,
            successEvaluation: successEvaluation ?? freshCall?.successEvaluation ?? null,
            recordingUrl: recordingUrl ?? freshCall?.recordingUrl ?? null,
            recordingError: freshCall?.recordingError ?? call.recordingError ?? null,
            amdResult: freshCall?.amdResult ?? call.amdResult ?? null,
            transferType: freshCall?.transferType ?? call.transferType ?? null,
            transferTarget: freshCall?.transferTarget ?? call.transferTarget ?? null,
            campaignLeadId: session.campaignLeadId ?? null,
            conversationCompleted: freshCall?.conversationCompleted ?? call.conversationCompleted ?? null,
            primaryLanguage: freshCall?.primaryLanguage ?? call.primaryLanguage ?? null,
            memoryRecognized: freshCall?.memoryRecognized ?? call.memoryRecognized ?? null,
            errorMessage: freshCall?.errorMessage ?? call.errorMessage ?? null,
            tokensSaved: freshCall?.tokensSaved ?? call.tokensSaved ?? null,
            avgSttLatencyMs: avgSttMs,
            avgLlmLatencyMs: avgLlmMs,
            avgTtsLatencyMs: avgTtsMs,
            createdAt: freshCall?.createdAt ?? call.createdAt ?? null,
            endedAt,
            metadata: freshCall?.metadata ?? call.metadata ?? null,
          });

          // 4. Agent webhook URL (Settings → Post-call notify) — default or custom JSON
          if (ag.webhookUrl) {
            const serialized = serializeAgentWebhookBody(
              readWebhookPayloadTemplate(agCfgForWebhook),
              webhookPayload,
            );
            if (serialized.error) {
              logger.warn(
                { sessionId, error: serialized.error },
                "Post-call notify template invalid — sending default payload",
              );
            }
            const headers = buildAgentNotifyHeaders(serialized.bodyStr, serialized.mode, webhookSecret);
            fetch(ag.webhookUrl, { method: "POST", headers, body: serialized.bodyStr }).catch((err) => {
              logger.error({ sessionId, webhookUrl: ag.webhookUrl, err }, "Webhook delivery failed");
            });
          }

          // Workspace webhook endpoints (/app/webhooks) — same full payload
          const webhookUserId = ag.userId ?? call.userId ?? null;
          if (webhookUserId) {
            dispatchWebhooks(webhookUserId, "call.completed", webhookPayload).catch((err) => {
              logger.warn({ sessionId, err }, "Workspace webhook dispatch failed");
            });
          }

          // ── Stamp lead disposition + meaning-map operational outcome ────────
          if (session.campaignLeadId && dispositionResult) {
            try {
              const { applyCampaignDispositionOutcome } = await import("../services/campaign-disposition-outcome.js");
              await applyCampaignDispositionOutcome({
                campaignLeadId: session.campaignLeadId!,
                agentId: call.agentId,
                callId: session.callId,
                dispositionResult,
                callStatus,
                wasTransferred: session.wasTransferred,
              });
            } catch (err) {
              logger.warn({ sessionId, err }, "Campaign disposition outcome failed");
            }
          }

          // ── Campaign lead transfer (disposition-gated webhook / Sheets) ─────
          if (session.campaignLeadId) {
            import("../services/campaign-lead-transfer.js").then(({ maybeTransferCampaignLead }) => {
              maybeTransferCampaignLead({
                callId: session.callId,
                campaignLeadId: session.campaignLeadId,
                dispositionResult,
                callSummary: callSummary || null,
              }).catch((err) => logger.warn({ sessionId, err }, "Campaign lead transfer failed"));
            }).catch(() => {});
          }

          // ── Google Sheets writeback (after summary/disposition) ─────────────
          // ── Google Sheets Automatic Calls writeback (pipeline only) ─────────
          import("../services/sheets-writeback.js").then(({ writeSheetAutoCallResults }) => {
            writeSheetAutoCallResults(session.callId, {
              callSummary: callSummary || null,
              dispositionResult,
            }).catch((err) => logger.warn({ sessionId, err }, "Sheets auto-call writeback failed"));
          }).catch(() => {});

          // ── After-call messaging (agent-owned) + legacy campaign webhooks ───
          // Agent after-call rules own WhatsApp/email. Campaign branches only fire
          // legacy webhooks. Legacy always-on WhatsApp runs when agent has no rules.
          import("../services/agent-after-call-messages.js").then(({ maybeRunAgentAfterCallMessages }) => {
            maybeRunAgentAfterCallMessages({
              callId: session.callId,
              agentId: ag.id,
              campaignLeadId: session.campaignLeadId,
              dispositionResult,
              callSummary: callSummary || null,
            }).then((agentMsg) => {
              if (!agentMsg.configured) {
                import("../services/whatsapp/outbound.js").then(({ dispatchWhatsappCallEnded }) => {
                  dispatchWhatsappCallEnded(session.callId, {
                    callSummary: callSummary || null,
                    dispositionResult,
                  }).catch((err) => logger.warn({ sessionId, err }, "WhatsApp post-call notify failed"));
                }).catch(() => {});
              }
            }).catch((err) => logger.warn({ sessionId, err }, "Agent after-call messages failed"));
          }).catch(() => {});

          import("../services/campaign-after-call.js").then(({ maybeRunAfterCallBranches }) => {
            maybeRunAfterCallBranches({
              callId: session.callId,
              campaignLeadId: session.campaignLeadId,
              dispositionResult,
              callSummary: callSummary || null,
            }).catch((err) => logger.warn({ sessionId, err }, "After-call webhook branches failed"));
          }).catch(() => {});

          // ── Flows: "inbound / missed call" trigger ──────────────────────────
          if (
            !session.campaignLeadId &&
            ag.userId &&
            call.fromNumber &&
            !call.fromNumber.startsWith("webcall") &&
            !call.toNumber.startsWith("webcall")
          ) {
            let flowDir = "inbound";
            try {
              const md = call.metadata ? JSON.parse(call.metadata) as Record<string, unknown> : {};
              if (typeof md["direction"] === "string") flowDir = md["direction"];
            } catch { /* ignore */ }
            if (flowDir === "inbound") {
              import("../services/flow-triggers.js").then(({ fireCallEndedFlows }) => {
                fireCallEndedFlows({
                  userId: ag.userId!,
                  agentId: ag.id,
                  callId: session.callId,
                  phone: call.fromNumber!,
                  missed: metricsAcc.count === 0,
                  status: callStatus,
                  durationSeconds,
                  summary: callSummary || "",
                  disposition: dispositionResult ?? {},
                  transcript: transcript || "",
                }).catch((err) => logger.warn({ sessionId, err }, "Flow call-ended trigger failed"));
              }).catch(() => {});
            }
          }

          // ── Zelto call monitoring (fire-and-forget) ─────────────────────────
          // Placed inside this IIFE so callSummary, dispositionResult, avgSttMs
          // etc. are all in scope. No-ops when no Zelto key is configured.
          import("../services/zelto.js").then(({ pushCallToZelto }) => {
            const startedAt = durationSeconds
              ? new Date(endedAt.getTime() - durationSeconds * 1000).toISOString()
              : undefined;
            pushCallToZelto({
              callId:             session.callId,
              agentId:            ag.id,
              agentName:          ag.name,
              status:             callStatus,
              direction:          (call as any).direction ?? "inbound",
              fromNumber:         call.fromNumber ?? null,
              toNumber:           call.toNumber ?? null,
              durationSeconds,
              startedAt,
              endedAt:            endedAt.toISOString(),
              transcript:         transcript || null,
              callSummary:        callSummary || null,
              dispositionResult,
              avgSttLatencyMs:    avgSttMs,
              avgLlmLatencyMs:    avgLlmMs,
              avgTtsLatencyMs:    avgTtsMs,
            }).catch((err) => logger.warn({ sessionId, err }, "Zelto push failed (session)"));
          }).catch(() => {});

          // ── Agent Task completion hook ──────────────────────────────────────
          try {
            const md = call.metadata ? JSON.parse(call.metadata) as Record<string, unknown> : {};
            const agentTaskId = typeof md["agentTaskId"] === "number" ? md["agentTaskId"] : Number(md["agentTaskId"]);
            if (Number.isFinite(agentTaskId) && agentTaskId > 0) {
              const { onAgentTaskCallEnded } = await import("../services/task-orchestrator.js");
              await onAgentTaskCallEnded({
                callId: session.callId,
                agentTaskId,
                summary: callSummary || null,
                disposition: dispositionResult,
                amdResult: call.amdResult ?? null,
                successEvaluation: successEvaluation ?? call.successEvaluation ?? null,
              });
            }
          } catch (taskEndErr) {
            logger.warn({ sessionId, err: taskEndErr }, "Agent task call-end hook failed");
          }

          // ── Squad make_call step resume ─────────────────────────────────────
          if (session.campaignLeadId) {
            try {
              const { onSquadCampaignCallEnded } = await import("../services/squad-engine.js");
              await onSquadCampaignCallEnded({
                leadId: session.campaignLeadId,
                callId: session.callId,
                summary: callSummary || null,
                disposition: typeof dispositionResult === "string"
                  ? dispositionResult
                  : (dispositionResult ? JSON.stringify(dispositionResult) : null),
              });
            } catch (squadEndErr) {
              logger.warn({ sessionId, err: squadEndErr }, "Squad campaign call-end hook failed");
            }
          }
        })();

        // ── Post-call caller memory update + callback detection (fire-and-forget) ──
        if (session.callerPhone && transcript && transcript.length > 50) {
          const endHint = session.pipeline.endReasonHint;
          // Only treat true mid-conversation dropouts as resume-cut (call 2626
          // greeter “கால் கட் ஆயிடுச்சு” after a long hangup-after-question).
          const wasDropped =
            !session.naturalEndTriggered &&
            !session.wasTransferred &&
            durationSeconds > 20 &&
            durationSeconds < 180 &&
            endHint !== "media_disconnect" &&
            endHint !== "silence_timeout" &&
            endHint !== "inactivity" &&
            endHint !== "max_duration";

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
              let memLlmKey: string | null = memLlmProvs[0] ? decryptKey(memLlmProvs[0].apiKey) : null;
              let memLlmProvider = session.agentLlmProvider;
              let memLlmModel    = session.agentLlmModel;
              // Managed plan: no BYOP key → fall back to platform Sarvam (same as
              // post-call summary). Must switch provider+model with the key —
              // createLLMAdapter("openai", sarvamKey, ...) would 401.
              if (!memLlmKey) {
                const [row] = await db.select().from(platformSettingsTable).where(eq(platformSettingsTable.key, "managed_sarvam_key"));
                memLlmKey = row?.value?.trim() || process.env["SARVAM_API_KEY"] || null;
                if (memLlmKey) {
                  memLlmProvider = "sarvam";
                  memLlmModel    = "sarvam-105b";
                }
              }
              if (memLlmKey) {
                const memLlm = createLLMAdapter(memLlmProvider, memLlmKey, memLlmModel);
                // Strip call-screening-bot exchanges (screener prompt + our
                // scripted reply) before memory extraction — they are operational
                // boilerplate, not caller facts, and must never pollute the
                // caller's durable profile/summary.
                const rawHistory = session.pipeline.getHistory();
                const history = rawHistory.filter((t, i) => {
                  if (t.role === "user" && t.content?.startsWith("[call screening bot]")) return false;
                  const prev = rawHistory[i - 1];
                  if (
                    t.role === "assistant" &&
                    prev?.role === "user" &&
                    prev.content?.startsWith("[call screening bot]")
                  ) return false;
                  return true;
                });
                // Pin writes to the agent that answered the call so mid-call
                // handoffs don't scatter facts across teammate agentIds.
                const memoryAgentId = session.memoryOwnerAgentId || call.agentId;
                await updateCallerProfile({
                  agentId:           memoryAgentId,
                  phoneNumber:       session.callerPhone!,
                  history,
                  llm:               memLlm,
                  existing:          session.callerProfileSnapshot,
                  callId:            session.callId,
                  wasDropped,
                  durationSeconds,
                  callerNameInCall:  session.callerNameLatchedThisCall,
                  callerNameLatchTier: session.callerNameLatchTier,
                  agentName: ag?.name ?? null,
                  // Persona-swap invalidation only for solo agents — with a
                  // squad-shared owner record, member prompt hashes differ and
                  // would false-fire the swap wipe on every alternation.
                  personaHash:       memoryAgentId === call.agentId ? (session.personaHash ?? undefined) : undefined,
                  // Persist the language the caller was using when the call ended.
                  // Only meaningful when languageAutoDetect is ON; ignored otherwise
                  // because the pipeline always ends in the agent's fixed language.
                  finalLanguage:     session.pipeline.getPreferredCallerLang() || null,
                  // Explicit mid-call language request ("Speak in Tamil") — ground
                  // truth for the language_pref fact so the NEXT call greets the
                  // caller in the requested language. Null for strict-mode agents.
                  explicitLanguageRequest: session.pipeline.getExplicitLangRequestForMemory(),
                });
                createExecutionLogger(session.callId, memoryAgentId)("Memory", "response", {
                  status: "success",
                  // wasDropped = call ended without naturalEndTriggered (user hung up
                  // mid-conversation) — memory is STILL saved; only callback-request
                  // detection is skipped for short/dropped calls.
                  metadata: { updated: true, wasDropped, callbackDetectionSkipped: wasDropped, durationSeconds, memoryAgentId },
                });
                if (!wasDropped) {
                  await detectCallbackRequest({
                    agentId:        memoryAgentId,
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
  const lease = callLeases.get(sessionId);
  callLeases.delete(sessionId);
  void lease?.release();
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
