import { createHmac, createHash, randomBytes } from "crypto";
import { getSelfBaseUrl } from "../lib/app-domain.js";
import { db, agentsTable, callsTable, providersTable, platformSettingsTable, campaignLeadsTable, knowledgeEntriesTable, callTransfersTable, usersTable, walletTransactionsTable, bookingsTable, eventTypesTable, scheduledCallbacksTable, campaignsTable, executionLogsTable, squadsTable, squadRunsTable, phoneNumbersTable } from "@workspace/db";
import { createExecutionLogger, writeCallEndedLog, writeCallStartedLog, logRecordingEvent, EXEC_COMPONENTS } from "../services/execution-log.js";
import { getFlatRateCentsPerMin, resolveAgentBillingMode, resolveOwnTelephonyDiscount } from "../services/minute-rates.js";
import { resolvePartnerBilling, creditPartnerSpreadOnCall } from "../services/partner-billing.js";
import { getAttachedSourceIds, buildKnowledgeBaseBlockEx } from "./kb-retrieval.js";
import { KRUTRIM_AUTO_SUMMARY_TITLE } from "../services/kb-source-summary.js";
import { decryptKey } from "../lib/crypto.js";
import { eq, and, sql, inArray, or, gt, ne, lte, isNull } from "drizzle-orm";
import { OrchestrationPipeline } from "./pipeline.js";
import type { VoiceSession } from "./voice-session.js";
import { GeminiLivePipeline } from "./adapters/live/gemini-live-pipeline.js";
import {
  DEFAULT_GEMINI_LIVE_MODEL,
  resolveGeminiLiveThinkingLevel,
  resolveGeminiLiveVoice,
  resolveVoiceStack,
} from "./adapters/live/gemini-live-voices.js";
import { resolveSarvamSttMode } from "./adapters/stt/sarvam-mode.js";
import { isSarvamCatalogSpeaker } from "./adapters/tts/sarvam.js";
import {
  clampSarvamIncompleteHoldMs,
  clampSarvamSpeechEndFlushMs,
  resolveSarvamHighVadSensitivity,
  normalizeCallEngineAgentConfig,
  FRAGMENT_COALESCE_DEFAULTS,
} from "@workspace/db/call-engine-defaults";
import { withDbRetry } from "./db-retry.js";
import { CONVERSATION_DISCIPLINE_BLOCK } from "./conversationDiscipline.js";
import { transcriptHasFarewellEnding } from "./callFarewell.js";
import { buildLeadContextBlock, resolvePromptVariables } from "./prompt-vars.js";
import { createLLMAdapter } from "./adapters/llm/index.js";
import { resolveMicSensitivity, getMicSensitivityThresholds } from "./mic-sensitivity.js";
import { loadPcmLoop, TRACK_PARAMS } from "./ambient.js";
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
  injectCallerMemory,
  injectEnhancedMemory,
  isResumeDroppedCall,
  computePersonaHash,
  updateCallerProfile,
  latchCallerName,
  latchCallerFact,
  detectCallbackRequest,
  type CallerProfile,
  type CallerContext,
  type NameLatchTier,
} from "./callerMemory.js";
import { performSquadAgentHandoff } from "../services/squad-handoff.js";
import { completeLiveSquadRun } from "../services/squad-engine.js";


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
  parseInt(process.env["SILENCE_TIMEOUT_DEFAULT_SECONDS"] ?? "", 10) || 15;

interface MetricsAcc {
  sttTotal: number;
  llmTotal: number;
  ttsTotal: number;
  count: number;
}

interface ActiveSession {
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

  // ── Concurrent call limit (per user, hard ceiling = 10) ──────────────────
  if (agent.userId) {
    const [user] = await withDbRetry("load-user-concurrent-limit", () =>
      db
        .select({ concurrentLimit: usersTable.concurrentLimit })
        .from(usersTable)
        .where(eq(usersTable.clerkId, agent.userId!)),
    );
    const effectiveLimit = user?.concurrentLimit ?? 10;
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
  let tools = Array.isArray(agent.tools) ? (agent.tools as unknown as AgentTool[]) : [];

  // Read agentConfig JSONB for advanced settings — normalize legacy snappy Sarvam/engine
  // defaults so existing agents get patient STT without requiring a one-off DB migrate.
  const agentCfg = normalizeCallEngineAgentConfig(
    (agent.agentConfig ?? {}) as Record<string, unknown>,
  ).config;

  // AMD (voicemail) config — read once, used by both the voicemail-delivery config
  // and the acoustic-confirmation config below. Default action is "hangup" (never
  // leave a message unless explicitly configured).
  const rawAmdAction = agentCfg["voicemailAction"];
  const amdVoicemailAction: "leave_message" | "hangup" | "continue" =
    rawAmdAction === "leave_message" || rawAmdAction === "continue" ? rawAmdAction : "hangup";
  const rawAmdLeadIn = agentCfg["voicemailLeadInSeconds"];
  const amdLeadInSeconds =
    typeof rawAmdLeadIn === "number" && Number.isFinite(rawAmdLeadIn) && rawAmdLeadIn > 0 ? rawAmdLeadIn : undefined;

  // Build effective system prompt with date/time context + strict language enforcement
  const LANG_NAMES: Record<string, string> = {
    "en-US": "English", "en-GB": "English", "en-IN": "English", "en": "English",
    "hi": "Hindi", "hi-IN": "Hindi", "ta": "Tamil", "ta-IN": "Tamil",
    "te": "Telugu", "te-IN": "Telugu", "kn": "Kannada", "kn-IN": "Kannada",
    "mr": "Marathi", "mr-IN": "Marathi", "gu": "Gujarati", "gu-IN": "Gujarati",
    "bn": "Bengali", "bn-IN": "Bengali", "bn-BD": "Bengali", "ml": "Malayalam", "ml-IN": "Malayalam",
    "pa": "Punjabi", "pa-IN": "Punjabi", "ur": "Urdu", "ur-IN": "Urdu",
    "si": "Sinhala", "si-LK": "Sinhala",
    "es": "Spanish", "es-MX": "Spanish (Mexico)", "es-US": "Spanish", "fr": "French", "fr-FR": "French", "de": "German", "de-DE": "German",
    "it": "Italian", "it-IT": "Italian", "pt-BR": "Portuguese (Brazil)", "ja": "Japanese", "ja-JP": "Japanese",
    "ko": "Korean", "ko-KR": "Korean", "zh": "Mandarin Chinese", "ar": "Arabic",
    "id": "Indonesian", "id-ID": "Indonesian", "th": "Thai", "th-TH": "Thai",
    "vi": "Vietnamese", "vi-VN": "Vietnamese", "tr": "Turkish", "tr-TR": "Turkish",
    "ru": "Russian", "ru-RU": "Russian", "nl": "Dutch", "nl-NL": "Dutch",
    "pl": "Polish", "pl-PL": "Polish", "uk": "Ukrainian", "uk-UA": "Ukrainian",
    "ro": "Romanian", "ro-RO": "Romanian",
  };
  // Script directive for non-Latin languages — tells weaker models to write in
  // native Unicode script, not romanized form (Tanglish, Hinglish-script, etc.).
  const LANG_SCRIPT_DIRECTIVE: Record<string, string> = {
    "ta-IN": "CRITICAL: Write ALL Tamil words in Tamil Unicode script (e.g. வணக்கம், நன்றி, சரி). NEVER romanize Tamil into English/Latin letters. " +
      "COLLOQUIAL GRAMMAR — use everyday spoken Tamil verb forms, NOT formal/literary ones. Key contrasts: " +
      "✓ வேணும் (not வேண்டும்) | ✓ இல்ல (not இல்லை) | ✓ ஆயிடுச்சு (not ஆகிவிட்டது) | ✓ சொல்றேன் (not சொல்கிறேன்) | ✓ வர்றேன் (not வருகிறேன்) | ✓ பண்றேன் (not செய்கிறேன்) | ✓ போயிடுது (not போகிறது) | ✓ பேசிட்டு இருக்கேன் (not பேசிக்கொண்டிருக்கிறேன்) | ✓ சொல்லுங்க or சொல்லுவீங்களா (not சொல்லுங்கள்). " +
      "EXAMPLES of correct spoken Tamil: 'Sori, call cut ஆயிடுச்சு' | 'demo எப்போ வேணும்னு சொல்லுங்க' | 'நீங்க ready-ஆ இருக்கீங்களா?' | 'நான் confirm பண்றேன்' | 'OK-வா, நாளைக்கு பேசலாம்'. " +
      "NEVER use: தொடரலாமா (→ use 'continue பண்ணலாமா' or 'பேசலாம்'), முடியுமான்னு (→ use 'வேணுமா?'), நிறுத்தியதோ (→ use 'விட்டோமோ'), தேன்றேன் (→ use 'தேடுறேன்'), செய்கின்றேன் (→ use 'பண்றேன்'), வருகின்றேன் (→ use 'வர்றேன்'). " +
      "Keep 'call', 'demo', 'confirm', 'schedule', 'ok', 'ready' in English — they are everyday spoken words in Tamil. " +
      "NUMBERS, TIME & DURATION in English: Tamil speakers say these in English naturally. ALWAYS say 'ten to fifteen minutes' (not '10 முதல் 15 நிமிஷத்துல'), 'three o'clock' (not 'மூன்று மணி'), 'tomorrow morning 9' (not 'நாளைக்கு காலை 9 மணி'), 'five minutes' (not 'ஐந்து நிமிஷம்'). Digits like '10', '15', '3' and time expressions must be spoken as English words embedded in Tamil sentences. " +
      "MONEY & AMOUNTS: NEVER use the ₹ symbol — TTS reads it as formal 'ரூபாய்' which sounds unnatural. Say amounts as English words: 'ten lakhs' (not '₹10 lakhs' or 'பத்து லட்சம்'), 'five lakhs' (not '₹5 lakhs' or 'ஐந்து லட்சம்'), 'one crore' (not '₹1 crore' or 'ஒரு கோடி'). Colloquial spoken Tamil uses English for amounts naturally.",
    "ta":    "CRITICAL: Write ALL Tamil words in Tamil Unicode script (e.g. வணக்கம், நன்றி, சரி). NEVER romanize Tamil into English/Latin letters. " +
      "COLLOQUIAL GRAMMAR — use everyday spoken Tamil verb forms, NOT formal/literary ones. Key contrasts: " +
      "✓ வேணும் (not வேண்டும்) | ✓ இல்ல (not இல்லை) | ✓ ஆயிடுச்சு (not ஆகிவிட்டது) | ✓ சொல்றேன் (not சொல்கிறேன்) | ✓ வர்றேன் (not வருகிறேன்) | ✓ பண்றேன் (not செய்கிறேன்) | ✓ போயிடுது (not போகிறது) | ✓ பேசிட்டு இருக்கேன் (not பேசிக்கொண்டிருக்கிறேன்) | ✓ சொல்லுங்க or சொல்லுவீங்களா (not சொல்லுங்கள்). " +
      "EXAMPLES of correct spoken Tamil: 'Sori, call cut ஆயிடுச்சு' | 'demo எப்போ வேணும்னு சொல்லுங்க' | 'நீங்க ready-ஆ இருக்கீங்களா?' | 'நான் confirm பண்றேன்' | 'OK-வா, நாளைக்கு பேசலாம்'. " +
      "NEVER use: தொடரலாமா (→ use 'continue பண்ணலாமா' or 'பேசலாம்'), முடியுமான்னு (→ use 'வேணுமா?'), நிறுத்தியதோ (→ use 'விட்டோமோ'), தேன்றேன் (→ use 'தேடுறேன்'), செய்கின்றேன் (→ use 'பண்றேன்'), வருகின்றேன் (→ use 'வர்றேன்'). " +
      "Keep 'call', 'demo', 'confirm', 'schedule', 'ok', 'ready' in English — they are everyday spoken words in Tamil. " +
      "NUMBERS, TIME & DURATION in English: Tamil speakers say these in English naturally. ALWAYS say 'ten to fifteen minutes' (not '10 முதல் 15 நிமிஷத்துல'), 'three o'clock' (not 'மூன்று மணி'), 'tomorrow morning 9' (not 'நாளைக்கு காலை 9 மணி'), 'five minutes' (not 'ஐந்து நிமிஷம்'). Digits like '10', '15', '3' and time expressions must be spoken as English words embedded in Tamil sentences. " +
      "MONEY & AMOUNTS: NEVER use the ₹ symbol — TTS reads it as formal 'ரூபாய்' which sounds unnatural. Say amounts as English words: 'ten lakhs' (not '₹10 lakhs' or 'பத்து லட்சம்'), 'five lakhs' (not '₹5 lakhs' or 'ஐந்து லட்சம்'), 'one crore' (not '₹1 crore' or 'ஒரு கோடி'). Colloquial spoken Tamil uses English for amounts naturally.",
    "hi-IN": "CRITICAL: Write ALL Hindi words in Devanagari Unicode script (e.g. नमस्ते, धन्यवाद, ठीक है). NEVER romanize Hindi into English/Latin letters.",
    "hi":    "CRITICAL: Write ALL Hindi words in Devanagari Unicode script (e.g. नमस्ते, धन्यवाद, ठीक है). NEVER romanize Hindi into English/Latin letters.",
    "te-IN": "CRITICAL: Write ALL Telugu words in Telugu Unicode script (e.g. నమస్కారం, ధన్యవాదాలు). NEVER romanize Telugu into English/Latin letters.",
    "te":    "CRITICAL: Write ALL Telugu words in Telugu Unicode script (e.g. నమస్కారం, ధన్యవాదాలు). NEVER romanize Telugu into English/Latin letters.",
    "kn-IN": "CRITICAL: Write ALL Kannada words in Kannada Unicode script (e.g. ನಮಸ್ಕಾರ, ಧನ್ಯವಾದ). NEVER romanize Kannada into English/Latin letters.",
    "kn":    "CRITICAL: Write ALL Kannada words in Kannada Unicode script (e.g. ನಮಸ್ಕಾರ, ಧನ್ಯವಾದ). NEVER romanize Kannada into English/Latin letters.",
    "ml-IN": "CRITICAL: Write ALL Malayalam words in Malayalam Unicode script (e.g. നമസ്കാരം, നന്ദി). NEVER romanize Malayalam into English/Latin letters.",
    "ml":    "CRITICAL: Write ALL Malayalam words in Malayalam Unicode script (e.g. നമസ്കാരം, നന്ദി). NEVER romanize Malayalam into English/Latin letters.",
    "mr-IN": "CRITICAL: Write ALL Marathi words in Devanagari Unicode script (e.g. नमस्कार, धन्यवाद). NEVER romanize Marathi into English/Latin letters.",
    "mr":    "CRITICAL: Write ALL Marathi words in Devanagari Unicode script (e.g. नमस्कार, धन्यवाद). NEVER romanize Marathi into English/Latin letters.",
    "bn-IN": "CRITICAL: Write ALL Bengali words in Bengali Unicode script (e.g. নমস্কার, ধন্যবাদ). NEVER romanize Bengali into English/Latin letters.",
    "bn":    "CRITICAL: Write ALL Bengali words in Bengali Unicode script (e.g. নমস্কার, ধন্যবাদ). NEVER romanize Bengali into English/Latin letters.",
    "gu-IN": "CRITICAL: Write ALL Gujarati words in Gujarati Unicode script (e.g. નમસ્તે, આભાર). NEVER romanize Gujarati into English/Latin letters.",
    "gu":    "CRITICAL: Write ALL Gujarati words in Gujarati Unicode script (e.g. નમસ્તે, આભાર). NEVER romanize Gujarati into English/Latin letters.",
    "si-LK": "CRITICAL: Write ALL Sinhala words in Sinhala Unicode script (e.g. ආයුබෝවන්, ස්තූතියි, හරි). NEVER romanize Sinhala into English/Latin letters — writing 'ayubowan', 'stuthi', 'hari' instead of Sinhala script is WRONG.",
    "si":    "CRITICAL: Write ALL Sinhala words in Sinhala Unicode script (e.g. ආයුබෝවන්, ස්තූතියි, හරි). NEVER romanize Sinhala into English/Latin letters — writing 'ayubowan', 'stuthi', 'hari' instead of Sinhala script is WRONG.",
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

  {
    const agentLang = effectiveAgentLang;
    if (agentLang) {
      const langName = LANG_NAMES[agentLang] ?? agentLang;
      const scriptNote = LANG_SCRIPT_DIRECTIVE[agentLang] ?? "";
      if (isMultilingual) {
        // Auto-detect mode: follow the caller's language; switch seamlessly when they do.
        effectiveSystemPrompt += `\n\n[LANGUAGE RULE] Your primary language is ${langName}. Always follow the caller's language — if they speak Tamil, reply in Tamil; if they switch to English, reply in English; if they mix languages (e.g. Hinglish), match their mix naturally. REGISTER — always speak in natural, everyday colloquial spoken ${langName}, the way real people talk in casual conversation; NEVER use formal, literary, or bookish register. Mixing commonly-used English loanwords (business, finance, tech, and everyday terms) into ${langName} is normal spoken usage — keep such words in English as people naturally say them; this does NOT count as switching languages. EXCEPTION — keep all proper nouns (brand names, product names, company names, people's names) EXACTLY as written in your instructions; never translate or transliterate them.${scriptNote ? " " + scriptNote : ""}`;
      } else {
        // Strict mode: single language, no switching.
        effectiveSystemPrompt += `\n\n[STRICT LANGUAGE RULE] You MUST respond ONLY in ${langName} at ALL times. Never switch to any other language under any circumstances, even if the caller speaks a different language. Always reply in ${langName} regardless of what language the caller uses. REGISTER — always speak in natural, everyday colloquial spoken ${langName}, the way real people talk in casual conversation; NEVER use formal, literary, or bookish register. Mixing commonly-used English loanwords (business, finance, tech, and everyday terms) into your ${langName} speech is normal spoken usage — keep such words in English as people naturally say them; this does NOT count as switching languages, and "ONLY in ${langName}" does NOT mean avoiding these everyday English loanwords. EXCEPTION — keep all proper nouns (brand names, product names, company names, and people's names) EXACTLY as written in your instructions; never translate, localize, or transliterate them, even when part of a name resembles a common ${langName} word.${scriptNote ? " " + scriptNote : ""}`;
      }
    }
  }

  // Auto-switch to English: when enabled, allow the agent to move to English mid-call on request.
  if (agentCfg["autoSwitchToEnglish"] === true) {
    effectiveSystemPrompt += `\n\nIf the caller asks you to speak in English, switch immediately and continue in English.`;
  }

  // TTS output formatting — provider-aware.
  // Cartesia Sonic understands SSML-like tags and nonverbalisms; other TTS engines
  // speak them aloud literally, so we forbid them for every non-Cartesia provider.
  const isCartesiaTts = agent.ttsProvider?.toLowerCase() === "cartesia";
  if (isCartesiaTts) {
    effectiveSystemPrompt += `\n\n[TTS OUTPUT RULES — MANDATORY] Your responses are spoken aloud by Cartesia Sonic TTS. Follow these rules strictly:
- Write plain prose in full sentences. End every response with . ? or !
- Never use abbreviated place names with periods. Write "T Nagar" not "T. Nagar", "RK Salai" not "R.K. Salai", "MG Road" not "M.G. Road".
- Never use ALL-CAPS words or acronyms — write them in lowercase or spell them out naturally.
- Never use markdown: no asterisks, hashes, bullet points, numbered lists, or underscores.
- The ONLY markup allowed is the four delivery signals listed below. Every other XML or SSML tag is spoken aloud literally — never use <prosody>, <say-as>, <phoneme>, or any tag not listed here.
CARTESIA DELIVERY SIGNALS (use sparingly — plain speech is the default):
- EMOTION: Optionally place <emotion value="VALUE"/> at the very start of a sentence — never mid-sentence, never mid-word, and never more than once per sentence. Supported values: enthusiastic (genuinely good news), sympathetic (empathy for a problem), calm (reset to neutral after an emotional moment), curious (when gathering information), content (successful resolution), sad (delivering bad news). Example: "<emotion value="sympathetic"/> I completely understand that, and I'm sorry to hear that."
- LAUGHTER: Insert [laughter] at a natural moment where a brief, warm laugh fits — do not force it. Example: "That's actually a great question! [laughter] Let me check that for you."
- SPELL: Wrap confirmation codes, reference IDs, or anything that must be read character by character in <spell> tags. Example: "Your booking ID is <spell>AB12CD</spell>."
- BREAK: Use <break time="500ms"/> for a deliberate pause before an important point. Do not chain multiple break tags in a row.`;
  } else {
    effectiveSystemPrompt += `\n\n[TTS OUTPUT RULES — MANDATORY] Your responses are spoken aloud by a TTS engine. Follow these rules strictly:
- Never use abbreviated place names with periods. Write "T Nagar" not "T. Nagar", "RK Salai" not "R.K. Salai", "MG Road" not "M.G. Road".
- Never use ALL-CAPS words or acronyms (AMD, STT, LLM etc.) — write them in lowercase or spell them out naturally.
- Never use markdown: no asterisks, hashes, bullet points, numbered lists, or underscores.
- NEVER use XML or SSML markup tags of any kind. Do NOT write <emotion>, </emotion>, <break>, <prosody>, or any similar tags — the TTS engine will speak them aloud literally as "less-than emotion greater-than".
- Use only plain conversational sentences suitable for speech.`;
  }

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
  const VOICE_DEFAULT_MAX_TOKENS = Number(process.env.VOICE_DEFAULT_MAX_TOKENS ?? 200);
  // "llmMaxTokens" present-but-null is an explicit "reset to default" from the
  // dashboard/admin (the update route MERGES agentConfig, so the key persists
  // once written). Only consult the legacy "maxTokens" key when the new key is
  // entirely absent — `null ?? legacy` would silently resurrect a stale cap.
  const configuredLlmMaxTokens = "llmMaxTokens" in agentCfg
    ? agentCfg["llmMaxTokens"]
    : agentCfg["maxTokens"];

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
      maxTokens: typeof configuredLlmMaxTokens === "number"
        ? configuredLlmMaxTokens
        : VOICE_DEFAULT_MAX_TOKENS,
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
    // Fall back to a default so idle/dead-air calls self-terminate instead of
    // lingering until the stuck-call sweep. `?? ` keeps an explicit 0 (disabled)
    // and any explicit value the agent configured.
    silenceTimeoutSeconds: agent.silenceTimeoutSeconds ?? DEFAULT_SILENCE_TIMEOUT_SECONDS,
    // AgentConfig.language is the agent's SPOKEN language — it drives the
    // pipeline's [LANGUAGE — ABSOLUTE RULE] block and the TTS voice language.
    // Use the unified resolver so the language rule, TTS, and STT all agree.
    language: effectiveAgentLang,
    languageAutoDetect: isMultilingual,
    autoSwitchToEnglish: agentCfg["autoSwitchToEnglish"] === true,
    backchannelingEnabled: agent.backchannelingEnabled ?? false,
    backchannelingFrequency: agent.backchannelingFrequency ?? null,
    webhookUrl: agent.webhookUrl ?? null,
    noiseCancellationEnabled: agent.noiseCancellationEnabled ?? false,
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
    // P1-B: Knowledge Base RAG
    knowledgeBaseId: agent.knowledgeBaseId ?? null,
    knowledgeSourceIds: await getAttachedSourceIds(agent.id, agent.knowledgeBaseId),
    // P1-C: Webhook HMAC secret
    webhookSecret: (agentCfg["webhookSecret"] as string | undefined) ?? null,
    // P1-D: VAD / Barge-in tuning (defaults match the hardcoded pipeline constants)
    vadSilenceMs:           (agentCfg["vadSilenceMs"]           as number  | undefined) ?? 350,
    bargeInEnabled:         (agentCfg["bargeInEnabled"]         as boolean | undefined) ?? true,
    // bargeInEnergyThreshold's default (when not explicitly overridden) tracks
    // micSensitivity so "Low"/"High" actually move the barge-in bar, not just
    // the noise gate / VAD floor. An explicit override always wins.
    bargeInEnergyThreshold: (agentCfg["bargeInEnergyThreshold"] as number  | undefined)
      ?? getMicSensitivityThresholds(resolveMicSensitivity(agentCfg["micSensitivity"] as string | undefined)).bargeInEnergyThreshold,
    bargeInMinFrames:       (agentCfg["bargeInMinFrames"]       as number  | undefined) ?? 4,
    bargeInEchoGraceMs:     (agentCfg["bargeInEchoGraceMs"]    as number  | undefined) ?? 600,
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
    // Default 3: 2-word STT stubs ("call பண்ண", "Hello Madam" mid-cut) were
    // false-firing word-count barge-in too often on telephony. Semantic
    // interrupt keywords (stop/wait) still bypass the word count.
    wordsForInterruption: (agentCfg["wordsForInterruption"] as number | undefined) ?? 3,
    // Legacy form default was 350ms — rewrite in-memory so existing agents get
    // snappy turns without requiring a UI re-save. Intentional non-350 values keep.
    incrementalDelay: (() => {
      const v = agentCfg["incrementalDelay"];
      if (typeof v !== "number" || !Number.isFinite(v)) return 0;
      return v === 350 ? 0 : Math.max(0, Math.min(1500, Math.round(v)));
    })(),
    ttsSpeed:             (agentCfg["ttsSpeed"]             as number | undefined) ?? 1.0,
    sarvamIndicNumbers:   agentCfg["sarvamIndicNumbers"] !== false,
    // P1-H: Call lifecycle
    hangupAfterLlmCall: (agentCfg["hangupAfterLlmCall"] as boolean | undefined) ?? false,
    // P1-I: Start Speaking Plan — snappy defaults; rewrite legacy 1.5/0.5 footguns.
    startSpeakingPlan: (() => {
      const raw = agentCfg["startSpeakingPlan"] as AgentConfig["startSpeakingPlan"] | undefined;
      const plan = raw ?? {
        waitSeconds: 0,
        onPunctuationSeconds: 0.1,
        onNoPunctuationSeconds: 0.1,
        onNumberSeconds: 0.1,
      };
      return {
        waitSeconds: plan.waitSeconds ?? 0,
        onPunctuationSeconds: plan.onPunctuationSeconds ?? 0.1,
        onNoPunctuationSeconds: plan.onNoPunctuationSeconds === 1.5
          ? 0.1
          : (plan.onNoPunctuationSeconds ?? 0.1),
        onNumberSeconds: plan.onNumberSeconds === 0.5
          ? 0.1
          : (plan.onNumberSeconds ?? 0.1),
      };
    })(),
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
    asrEndpointingSilenceMs: (agentCfg["asrEndpointingSilenceMs"] as number | undefined) ?? 250,
    llmMaxTokens: (agentCfg["llmMaxTokens"] as number | null | undefined) ?? null,
    ttsMinSentenceChars: (agentCfg["ttsMinSentenceChars"] as number | undefined) ?? 18,
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
      if (typeof v !== "number" || !Number.isFinite(v)) return 400;
      return Math.max(0, Math.min(2000, Math.round(v)));
    })(),
    sarvamSttMode: (agent.asrProvider ?? "").toLowerCase() === "sarvam"
      ? resolveSarvamSttMode(
          agent.asrLanguage || agent.language || "en-IN",
          (agentCfg["sarvamSttMode"] as string | undefined) ?? null,
        )
      : ((agentCfg["sarvamSttMode"] as string | undefined) ?? null),
    sarvamHighVadSensitivity: resolveSarvamHighVadSensitivity(agentCfg["sarvamHighVadSensitivity"]),
    sarvamSpeechEndFlushMs: clampSarvamSpeechEndFlushMs(agentCfg["sarvamSpeechEndFlushMs"] as number | undefined),
    sarvamIncompleteHoldMs: clampSarvamIncompleteHoldMs(agentCfg["sarvamIncompleteHoldMs"] as number | undefined),
    kbBakedOnly: (agentCfg["kbBakedOnly"] as boolean | undefined) ?? false,
    voiceStack: resolveVoiceStack(agentCfg["voiceStack"] as string | undefined),
    geminiLive: resolveVoiceStack(agentCfg["voiceStack"] as string | undefined) === "gemini_live"
      ? {
          model: (typeof (agentCfg["geminiLive"] as Record<string, unknown> | undefined)?.["model"] === "string"
            && ((agentCfg["geminiLive"] as Record<string, unknown>)["model"] as string).trim())
            ? ((agentCfg["geminiLive"] as Record<string, unknown>)["model"] as string)
            : DEFAULT_GEMINI_LIVE_MODEL,
          voiceName: resolveGeminiLiveVoice(
            (agentCfg["geminiLive"] as Record<string, unknown> | undefined)?.["voiceName"] as string | undefined,
          ),
          thinkingLevel: resolveGeminiLiveThinkingLevel(
            (agentCfg["geminiLive"] as Record<string, unknown> | undefined)?.["thinkingLevel"] as string | undefined,
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
  const callerPhone = isWebcall
    ? canonicalizeCallerKey(params.fromNumber)
    : resolveCallerKey(callDirection, params.fromNumber, params.toNumber);
  // Persona fingerprint for caller-memory whiplash detection: when the agent is
  // repurposed (e.g. real-estate → insurance), stale domain memory keyed on
  // (agentId, phone) must not bleed into the new persona. Derived from the RAW
  // system prompt, not effectiveSystemPrompt (which varies per call).
  const personaHash = computePersonaHash(agent.systemPrompt);
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

    // 3. Knowledge base (all attached sources, fair per-source budgeting)
    agentConfig.knowledgeSourceIds.length > 0
      ? buildKnowledgeBaseBlockEx(agentConfig.knowledgeSourceIds, kbBakedMaxChars, kbExcludeTitles).catch((kbErr) => {
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
    resumeDroppedCall = isResumeDroppedCall(callerCtxResult);
    for (const f of callerCtxResult.facts) latchedFactsMap.set(f.key, f.value);

    // Override STT language from caller memory language_pref fact — only when the
    // agent is in auto-detect mode. Strict fixed-language agents must not inherit
    // a remembered preference from a prior multilingual call.
    if (agentConfig.languageAutoDetect) {
      const LANG_PREF_TO_BCP47: Record<string, string> = {
        "english": "en-IN", "hindi": "hi-IN", "tamil": "ta-IN",
        "telugu": "te-IN", "kannada": "kn-IN", "malayalam": "ml-IN",
        "marathi": "mr-IN", "bengali": "bn-IN", "gujarati": "gu-IN",
        "punjabi": "pa-IN", "odia": "or-IN", "urdu": "ur-IN",
      };
      const langPrefRaw = latchedFactsMap.get("language_pref");
      const mappedSttLang = langPrefRaw ? LANG_PREF_TO_BCP47[langPrefRaw.toLowerCase()] : undefined;
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

    if (callerProfileSnapshot || callerCtxResult.facts.length > 0 || callerCtxResult.recentCalls.length > 0) {
      agentConfig.systemPrompt = injectEnhancedMemory(agentConfig.systemPrompt, callerCtxResult, {
        suppressGenderFact: !agentConfig.genderDetectionEnabled,
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

  // ── Inject DB-backed upcoming bookings (authoritative, freshly computed) ──────
  // Caller-memory summaries store relative day-words ("tomorrow") that go stale on
  // a follow-up call. To keep the agent temporally accurate we look up this
  // caller's confirmed upcoming meetings straight from the calendar and inject the
  // ABSOLUTE date/time plus the day-word recomputed against *today*. This block is
  // appended AFTER caller memory so the LLM treats it as the final authority.
  if (!isWebcall && callerPhone) {
    try {
      const callerRawNumber = callDirection === "outbound" ? params.toNumber : params.fromNumber;
      if (callerRawNumber && agent.id) {
        const now = new Date();
        const upcoming = await db
          .select({
            slotStart: bookingsTable.slotStart,
            slotEnd: bookingsTable.slotEnd,
            status: bookingsTable.status,
            meetLink: bookingsTable.meetLink,
            eventName: eventTypesTable.name,
          })
          .from(bookingsTable)
          .innerJoin(callsTable, eq(bookingsTable.callId, callsTable.id))
          .leftJoin(eventTypesTable, eq(bookingsTable.eventTypeId, eventTypesTable.id))
          .where(
            and(
              eq(callsTable.agentId, agent.id),
              or(
                eq(callsTable.fromNumber, callerRawNumber),
                eq(callsTable.toNumber, callerRawNumber),
              ),
              gt(bookingsTable.slotStart, now),
              ne(bookingsTable.status, "cancelled"),
            ),
          )
          .orderBy(bookingsTable.slotStart)
          .limit(3);

        if (upcoming.length > 0) {
          const tz = (agentCfg["timezone"] as string | undefined) || "Asia/Kolkata";
          // Calendar-day delta between two instants in the agent's timezone.
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
          const lines = upcoming.map((b) => {
            const abs = b.slotStart.toLocaleString("en-IN", {
              weekday: "long", day: "numeric", month: "long", year: "numeric",
              hour: "numeric", minute: "2-digit", hour12: true, timeZone: tz,
            });
            const delta = dayDelta(todayYmd, ymdInTz(b.slotStart));
            const title = b.eventName ? `"${b.eventName}"` : "the meeting";
            return `- ${title} on ${abs} (that is ${relWord(delta)}).`;
          });

          agentConfig.systemPrompt +=
            `\n\n[UPCOMING BOOKINGS — LIVE FROM CALENDAR, AUTHORITATIVE]\n` +
            `Today is ${todayReadable}. This caller has the following confirmed upcoming meeting(s). ` +
            `Use these EXACT dates and times — they OVERRIDE any relative day-words ("tomorrow", "next week") ` +
            `that may appear in the caller memory above, which could be stale.\n` +
            lines.join("\n") +
            `\nWhen you refer to a meeting, say the relative day-word that is correct for TODAY ` +
            `(e.g. only say "tomorrow" if it is genuinely the next day; say "today" if it is today).`;

          logger.info(
            { agentId: params.agentId, callerPhone, bookingCount: upcoming.length },
            "Upcoming bookings injected into system prompt",
          );
        }
      }
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

  // ── Inbound Automatic Calls sheet lookup (phone → same lead row) ────────────
  // Outbound sheet dials already inject via campaign leadData. For inbound, match
  // the caller phone against the user's Automatic Calls pipelines and stash
  // pipeline/row meta on the call for hangup writeback.
  let inboundSheetVars: Record<string, string> = {};
  let inboundSheetMeta: { pipelineId: string; sheetRowIndex: number } | null = null;
  const hasOutboundSheetLead = !!(
    campaignLeadResult?.leadData as Record<string, string> | undefined
  )?.["__sheet_pipeline_id"];
  if (
    !hasOutboundSheetLead
    && callDirection === "inbound"
    && !isWebcall
    && agent.userId
    && params.fromNumber?.trim()
  ) {
    try {
      const { lookupSheetsForSession } = await import("../services/sheets-writeback.js");
      const hit = await lookupSheetsForSession(agent.userId, params.agentId, params.fromNumber);
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
    } catch (sheetLookupErr) {
      logger.warn(
        { err: sheetLookupErr, agentId: params.agentId },
        "Inbound sheet lookup failed — continuing without sheet context",
      );
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

  // Apply the SAME resolution to the static greeting so it addresses the caller
  // by their prompt variables (e.g. {{customer_name}} → "krithika"). Static
  // greetings skip the LLM, so without this the name is never inserted.
  // caller_salutation is deliberately preserved here and resolved later by
  // gender detection in pipeline.greet().
  if (agentConfig.greetingMessage) {
    agentConfig.greetingMessage = resolvePromptVariables(agentConfig.greetingMessage, dynVars);
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
      "\n\n[KB_TRUST] When relevant information is provided in your context from the knowledge base, use it directly and precisely. Do not guess or invent product details, pricing, policies, or facts that are not present in what you have been given.";
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
  ].filter((p): p is string => !!p);

  const isManaged = agent.agentMode === "managed";

  // ── Bulk platform_settings fetch (one DB round-trip instead of N sequential) ─
  // Collect every settings key needed, then do a single IN query.
  // Managed-plan agents need the platform key for every provider; BYOP agents
  // only need it as a fallback for providers the user hasn't configured.
  const settingsKeysNeeded = new Set<string>();
  settingsKeysNeeded.add("managed_gemini_key");
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
      const managed = settingsMap.get(MANAGED[providerName]!)
        ?? (providerName === "sarvam" ? (process.env["SARVAM_API_KEY"] ?? "").trim() || undefined : undefined);
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

  // Provider key alias normalization (e.g. "google" key serves "gemini_audio" and "gemini")
  const googleKey =
    providerKeys.get("google") ||
    providerKeys.get("gemini") ||
    providerKeys.get("gemini_audio") ||
    providerKeys.get("google_speech") ||
    providerKeys.get("google_stt") ||
    settingsMap.get("managed_gemini_key") ||
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
          direction: callDirection,
          ...(callerPhone ? { callerKey: callerPhone } : {}),
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
    const taskBrief = typeof meta["taskBrief"] === "string" ? meta["taskBrief"].trim() : "";
    if (taskBrief) {
      agentConfig.systemPrompt += `\n\n${taskBrief}`;
      logger.info(
        { agentId: params.agentId, callId: callRecord.id, agentTaskId: meta["agentTaskId"] ?? null },
        "Agent task brief injected into system prompt",
      );
    }
  } catch (taskBriefErr) {
    logger.warn({ err: taskBriefErr, callId: callRecord.id }, "Failed to inject agent task brief");
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
  } else {
    logExec(EXEC_COMPONENTS.STT, "system", {
      status: "info",
      metadata: {
        event: "Provider Initialized", provider: agent.asrProvider,
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
      metadata: { event: "Provider Initialized", provider: agent.ttsProvider },
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
      const { ensureLiveSquadRunForCall } = await import("../services/squad-engine.js");
      let resolvedSquadId: number | null = params.squadId ?? null;
      let phoneNumberId: number | null = null;
      let campaignId: number | null = null;

      if (params.campaignLeadId) {
        const [lead] = await db.select({
          campaignId: campaignLeadsTable.campaignId,
        }).from(campaignLeadsTable).where(eq(campaignLeadsTable.id, params.campaignLeadId)).limit(1);
        if (lead) {
          campaignId = lead.campaignId;
          const [camp] = await db.select({
            squadId: campaignsTable.squadId,
          }).from(campaignsTable).where(eq(campaignsTable.id, lead.campaignId)).limit(1);
          if (camp?.squadId) resolvedSquadId = camp.squadId;
        }
      }

      if (!resolvedSquadId && callDirection === "inbound" && params.toNumber) {
        const [pn] = await db.select({
          id: phoneNumbersTable.id,
          squadId: phoneNumbersTable.squadId,
        }).from(phoneNumbersTable)
          .where(and(
            eq(phoneNumbersTable.number, params.toNumber),
            eq(phoneNumbersTable.userId, agent.userId),
          ))
          .limit(1);
        if (pn?.squadId) {
          resolvedSquadId = pn.squadId;
          phoneNumberId = pn.id;
        }
      }

      // Membership fallback: the agent itself belongs to an active squad, so
      // any call it answers (its own number, campaign, webcall) is squad-aware
      // without extra wiring.
      if (!resolvedSquadId) {
        const { findSquadForAgent } = await import("../services/squad-teamwork.js");
        const membershipTeam = await findSquadForAgent(params.agentId, agent.userId);
        if (membershipTeam && membershipTeam.teammates.length > 0) {
          resolvedSquadId = membershipTeam.squad.id;
        }
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
          const {
            loadSquadTeam,
            buildSquadTools,
            buildSquadPromptBlock,
            buildSharedCallerFactsBlock,
            consumeFollowupContext,
          } = await import("../services/squad-teamwork.js");
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

      const transcriptSummary = live.pipeline.getTranscript().slice(-4000);
      const fromAgentId = live.agentId;
      const [runRow] = await db.select({ goal: squadRunsTable.goal })
        .from(squadRunsTable).where(eq(squadRunsTable.id, live.squadRunId)).limit(1);

      // Snapshot facts the answering/owning agent already knows about this caller
      // so the receiving agent gets structured context, not just the transcript.
      let durableFacts: Record<string, unknown> | undefined;
      if (callerPhone) {
        try {
          const { loadCallerContext } = await import("./callerMemory.js");
          const ownerId = live.memoryOwnerAgentId || fromAgentId;
          const ctx = await loadCallerContext(ownerId, callerPhone);
          if (ctx.facts.length > 0) {
            durableFacts = {};
            for (const f of ctx.facts.slice(0, 25)) {
              durableFacts[f.key] = f.value;
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
        language: live.pipeline.getPreferredCallerLang() ?? live.configuredLanguage,
        durableFacts,
        squad,
        previousPipeline: live.pipeline,
        hooks: {
          callId: callRecord.id,
          telephonyProvider: params.telephonyProvider,
          callerPhone,
          campaignLeadId: params.campaignLeadId ?? null,
          onAudioOut: params.onAudioOut,
          onCallEnd: () => {
            naturalEndTriggered = true;
            params.onCallEnd();
          },
          onBargeIn: params.onBargeIn,
          onTranscript: params.onTranscript,
          rawPcmOutput: params.rawPcmOutput,
          callDirection,
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
      live.handoffTranscriptAccum = [
        live.handoffTranscriptAccum,
        transcriptSummary,
      ].filter(Boolean).join("\n--- handoff ---\n").slice(-12000);
      live.pipeline = result.pipeline;
      live.agentId = targetAgentId;
      try {
        previous.close();
      } catch (closeErr) {
        logger.warn({ err: closeErr, callId: callRecord.id }, "Error closing previous pipeline after handoff swap");
      }

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
        let xmlUrl: string;
        if (isWarm && transferId && briefingToken) {
          xmlUrl = `${baseUrl}/api/webhooks/vobiz/warm-transfer-xml?target=${encodeURIComponent(to)}&transferId=${transferId}&token=${encodeURIComponent(briefingToken)}${callerIdQs}`;
        } else {
          xmlUrl = `${baseUrl}/api/webhooks/vobiz/transfer-xml?target=${encodeURIComponent(to)}${callerIdQs}`;
        }
        await transferVobizCall({ authId, authToken, callUuid: params.externalCallId, xmlUrl, callDirection: params.callDirection });
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

  const pipeline: VoiceSession = agentConfig.voiceStack === "gemini_live"
    ? new GeminiLivePipeline({
        callId: callRecord.id,
        agentConfig,
        providerKeys,
        telephonyProvider: params.telephonyProvider,
        callerPhone,
        campaignLeadId: params.campaignLeadId ?? null,
        onAudioOut: params.onAudioOut,
        rawPcmOutput: params.rawPcmOutput ?? (params.telephonyProvider === "vobiz"),
        onTranscript: (speaker, text) => {
          logger.debug({ callId: callRecord.id, speaker, text: text.slice(0, 80) }, "Transcript");
          params.onTranscript?.(speaker, text);
        },
        onCallEnd: () => {
          naturalEndTriggered = true;
          params.onCallEnd();
        },
        onCallTransfer: onCallTransferHandler,
        onBargeIn: params.onBargeIn,
        onConversationUpdate: (history) => {
          void saveConversation(callRecord.id, history, redisTtl);
        },
        onFatalError: (reason) => {
          void failSession(sessionId, reason);
        },
        callDirection,
        answeredAt: params.answeredAt,
      })
    : new OrchestrationPipeline({
    callId: callRecord.id,
    agentConfig,
    providerKeys,
    telephonyProvider: params.telephonyProvider,
    callerPhone,
    campaignLeadId: params.campaignLeadId ?? null,
    onAudioOut: params.onAudioOut,
    rawPcmOutput: params.rawPcmOutput ?? (params.telephonyProvider === "vobiz"),
    voicemailDelivery: (params.voicemailDelivery || ((params.amdMachineHint || params.amdArmed) && amdVoicemailAction === "leave_message"))
      ? {
          message: (typeof agentCfg["voicemailMessage"] === "string" && (agentCfg["voicemailMessage"] as string).trim())
            ? (agentCfg["voicemailMessage"] as string)
            : "Hello, we tried to reach you. Please call us back at your earliest convenience. Thank you.",
          ...(amdLeadInSeconds !== undefined ? { leadInSeconds: amdLeadInSeconds } : {}),
        }
      : undefined,
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
    returningCallerName: callerProfileSnapshot?.name ?? null,
    callDirection,
    isResumeDroppedCall: resumeDroppedCall,
    // Carrier answer time — anchors the recording clock (see SessionConfig).
    answeredAt: params.answeredAt,
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
            callerProfileSnapshot = { ...callerProfileSnapshot, name: latched.name };
          }
          if (latched) {
            callerNameLatchedThisCall = latched.name;
            callerNameLatchTier = latched.tier;
          }
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

  sessions.set(sessionId, {
    callId: callRecord.id,
    agentId: params.agentId,
    pipeline,
    externalCallId: params.externalCallId ?? null,
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
    memoryOwnerAgentId:   params.agentId,
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
    if (agentConfig.voiceStack === "gemini_live") {
      // v1: acoustic AMD / voicemail delivery stays on the classic stack only.
      pipeline.greet().catch((err) => {
        logger.error({ sessionId, err }, "Gemini Live greeting failed");
      });
    } else {
      // Acoustic AMD confirmation — armed by an (unreliable) synchronous machine
      // hint OR unconditionally for AMD-enabled VoBiz outbound calls (amdArmed;
      // the async machine_detection_url callback corroborates mid-window). Open
      // the normal stream but confirm the machine verdict acoustically BEFORE
      // greeting — only a confirmed machine enacts the voicemail action; anything
      // ambiguous falls through to a normal greeting so a live human is never harmed.
      pipeline.confirmAmdMachineThenBranch().catch((err) => {
        logger.error({ sessionId, err }, "AMD acoustic confirmation failed");
      });
    }
  } else if (params.voicemailDelivery) {
    if (agentConfig.voiceStack === "gemini_live") {
      pipeline.greet().catch((err) => {
        logger.error({ sessionId, err }, "Gemini Live greeting failed");
      });
    } else {
      // Voicemail-delivery mode: do NOT greet/run the conversation. Listen for the
      // machine greeting to end, then speak the full message once and hang up.
      pipeline.deliverVoicemail().catch((err) => {
        logger.error({ sessionId, err }, "Voicemail delivery failed");
      });
    }
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

  const squadTranscriptPreview = session.squadRunId
    ? [
        session.handoffTranscriptAccum,
        session.pipeline.getTranscript(),
      ].filter(Boolean).join("\n--- handoff ---\n").slice(0, 4000)
    : null;

  sessions.delete(sessionId);
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
  const transcript = redactTranscriptPII(session.pipeline.getTranscript());

  const { metricsAcc } = session;
  const avgSttMs = metricsAcc.count > 0 ? Math.round(metricsAcc.sttTotal / metricsAcc.count) : null;
  const avgLlmMs = metricsAcc.count > 0 ? Math.round(metricsAcc.llmTotal / metricsAcc.count) : null;
  const avgTtsMs = metricsAcc.count > 0 ? Math.round(metricsAcc.ttsTotal / metricsAcc.count) : null;

  try {
    // A confirmed-machine voicemail (message delivered or confirmed-machine hangup)
    // is a distinct terminal outcome — takes precedence over transferred/completed.
    // A call where the agent had zero turns (no STT→LLM cycle completed) and ended
    // quickly was effectively rejected or dropped before the conversation started.
    // Mark it "no_pickup" instead of "completed" so the UI and campaign stats reflect
    // the real outcome (e.g. callee rejected, line busy, VoBiz brief-connect-then-drop).
    const noTurnsDrop = metricsAcc.count === 0 && durationSeconds <= 15 && !session.wasTransferred;
    const callStatus = session.voicemailActionExecuted
      ? "voicemail"
      : session.wasTransferred
        ? "transferred"
        : noTurnsDrop
          ? "no_pickup"
          : "completed";

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

    // ── Mark campaign lead terminal (drains the active Connected count) ──────────
    if (session.campaignLeadId) {
      const leadId = session.campaignLeadId;

      // A mid-conversation drop (naturalEnd=false, not transferred, duration >15s)
      // should be retried just like a BUSY/NO_ANSWER: mark the lead "failed" and
      // let scheduleRetry decide whether attempts remain. Without this, dropped
      // campaign calls are silently marked "completed" and never retried.
      const midConvDrop =
        !session.voicemailActionExecuted &&
        !session.naturalEndTriggered &&
        !session.wasTransferred &&
        durationSeconds > 15;

      // A confirmed voicemail counts as ONE attempt and is retryable (respecting
      // Max Attempts / Retry Delay), exactly like a mid-conversation drop — NOT a
      // final terminal status on the first attempt. It only "sticks" as terminal
      // once every configured attempt has ended in voicemail (scheduleRetry then
      // returns false). This mirrors the pre-connect webhook path, which already
      // treats voicemail/machine as retryable.
      const isVoicemail = session.voicemailActionExecuted;
      const shouldRetry = midConvDrop || isVoicemail;
      const retryReason = isVoicemail ? "voicemail" : "network_drop";

      const terminalLeadStatus = isVoicemail
        ? "voicemail"
        : session.wasTransferred
          ? "transferred"
          : midConvDrop
            ? "failed"
            : "completed";

      // Single sequential flow so retry scheduling, operational-outcome
      // computation, and reconcile run in a deterministic order:
      //   update status → schedule retry → set outcome (using !retryScheduled)
      //   → refill/reconcile (which keeps the batch open while a retry is pending).
      void (async () => {
        try {
          await db.update(campaignLeadsTable)
            .set({ callStatus: terminalLeadStatus })
            .where(eq(campaignLeadsTable.id, leadId));
        } catch (err) {
          logger.warn({ campaignLeadId: leadId, err }, "Failed to mark campaign lead terminal");
          return;
        }

        // ── Schedule a retry for retryable terminal outcomes (drop / voicemail) ──
        // Uses the same path as BUSY/NO_ANSWER so the lead is redialled if
        // attempts remain. scheduleRetry returns false once attempts are
        // exhausted (or a pending retry already exists) — the terminal status
        // then "sticks".
        let retryScheduled = false;
        if (shouldRetry) {
          try {
            const [freshLead] = await db
              .select({ callAttempts: campaignLeadsTable.callAttempts, campaignId: campaignLeadsTable.campaignId, batchId: campaignLeadsTable.batchId })
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
                .then(m => m.scheduleRetry({
                  leadId,
                  campaignId:         freshLead.campaignId,
                  currentAttempts:    freshLead.callAttempts ?? 0,
                  maxAttempts,
                  retryDelayMinutes,
                  reason:             retryReason,
                }));
              logger.info(
                { campaignLeadId: leadId, durationSeconds, terminalLeadStatus, retryReason, retryScheduled },
                "Campaign call terminal — retry decision",
              );
            }
          } catch (retryErr) {
            logger.warn({ campaignLeadId: leadId, retryErr }, "Failed to schedule campaign retry");
          }
        }

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

          const outcome = computeOperationalOutcome({
            callStatus:           terminalLeadStatus,
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
              { leadId, outcome, hasBooking, wasTransferred: session.wasTransferred, hasPendingCallback, retryScheduled },
              "Campaign lead operational outcome set",
            );
          }
        } catch (outcomeErr) {
          logger.warn({ campaignLeadId: leadId, outcomeErr }, "Failed to set campaign lead operational outcome");
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
                ctxLlmModel    = "llama-3.3-70b-versatile";
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
      const autoRedialCfg = (ag?.agentConfig as { autoRedial?: { enabled?: boolean; delayMinutes?: number; maxAttempts?: number } } | null)?.autoRedial;
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
            // Partner-managed clients bill at their partner-set rate; spread is
            // credited to the partner after the debit below.
            const partnerBilling  = await resolvePartnerBilling(sessionCallUserId);
            const rateCentsPerMin = partnerBilling?.clientRateCentsPerMin
              ?? Math.max(0, getFlatRateCentsPerMin(billingMode) - await resolveOwnTelephonyDiscount(sessionCallUserId, ag));
            const modeLabel       = partnerBilling ? "partner" : billingMode === "managed" ? "managed" : "BYOP";
            const rateLabel       = `₹${(rateCentsPerMin / 100).toFixed(2)}/min (${modeLabel})`;
            const debitCents      = Math.max(1, Math.round((durationSeconds / 60) * rateCentsPerMin));
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

          // ── Google Sheets writeback (after summary/disposition) ─────────────
          // ── Google Sheets Automatic Calls writeback (pipeline only) ─────────
          import("../services/sheets-writeback.js").then(({ writeSheetAutoCallResults }) => {
            writeSheetAutoCallResults(session.callId, {
              callSummary: callSummary || null,
              dispositionResult,
            }).catch((err) => logger.warn({ sessionId, err }, "Sheets auto-call writeback failed"));
          }).catch(() => {});

          // ── WhatsApp post-call notify (custom outbound webhook → BSP template) ─
          import("../services/whatsapp/outbound.js").then(({ dispatchWhatsappCallEnded }) => {
            dispatchWhatsappCallEnded(session.callId, {
              callSummary: callSummary || null,
              dispositionResult,
            }).catch((err) => logger.warn({ sessionId, err }, "WhatsApp post-call notify failed"));
          }).catch(() => {});

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
                successEvaluation: call.successEvaluation ?? null,
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
                  personaHash:       session.personaHash ?? undefined,
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
