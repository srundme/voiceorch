import * as agnost from "agnostai";
import { GenderDetector } from "./genderDetector.js";
import { GenderDetectorML } from "./genderDetectorML.js";
import { GenderDetectorMLv2 } from "./genderDetectorMLv2.js";
import { GenderDetectorChained } from "./genderDetectorChained.js";
import { SpeakerVerifier, type VoiceMemoryEvent } from "./speakerVerifier.js";
import { SCREENING_PICKUP_NOTE } from "./callScreening.js";
import { buildDatetimeInjection } from "./datetimeInject.js";
import { resolveAutoDetectLanguage } from "./language-filler-guard.js";
import { CONVERSATION_DISCIPLINE_BLOCK, CONVERSATION_DISCIPLINE_TURN_REMINDER, buildAntiRepeatNudge, makeFlowStepGuard, truncateToSingleStep, VOICE_MAX_SENTENCES_PER_TURN } from "./conversationDiscipline.js";
import { isCallerFarewellUtterance as isCallerFarewellUtteranceShared } from "./callFarewell.js";
import { shouldSwitchSttLang } from "./stt-language-switch.js";
import { EAGER_PARTIAL_STABLE_MS, isEagerCommitReady, isSpeculativeHit } from "./eager-stt.js";
import type { SttFinalMetadata } from "./adapters/stt/base.js";
import { makeThinkFilter, stripReasoningBlocks, stripJsonMessageWrapper } from "./reasoningFilter.js";
import { createSTTAdapter } from "./adapters/stt/index.js";
import { resolveSarvamSttMode } from "./adapters/stt/sarvam-mode.js";
import { toReadableError, envInt, parseJsonObject } from "./utils.js";
import { createLLMAdapter } from "./adapters/llm/index.js";
import { createTTSAdapter } from "./adapters/tts/index.js";
import { CartesiaTTS } from "./adapters/tts/cartesia.js";
import { encodeMulaw, upsample8to16, downsample16to8, decodeMulaw, hasSpeechEnergy, frameRms } from "./audio.js";
import { resolveMicSensitivity, getMicSensitivityThresholds, type MicSensitivityThresholds } from "./mic-sensitivity.js";
import { AmbientNoiseStream, FileAmbientNoiseStream, TRACK_PARAMS, loadPcmLoop, peekCachedPcmLoop, AMBIENT_LEVELS } from "./ambient.js";
import { DtmfDetector } from "./dtmf.js";
import { processAudioIn, processRawPcm8kIn, destroyAudioSession } from "./audioPool.js";
import { RecordingBuffer, WEBCALL_GAP_RESYNC_MS } from "./recorder.js";
import type { AudioProcessResult } from "./audioPool.js";
import type { AgentConfig, AgentTool, ConversationTurn, LLMAdapter, LLMUsage, SessionConfig, StreamSTT, STTConfig, ToolDefinition } from "./types.js";
import { resolveGoodbyeMessage } from "./types.js";
import type { VoiceSession } from "./voice-session.js";
import { retrieveKbContext, retrieveKbContextMultiEx, resolveKbTurnBudgetMs, type KbRetrievalResult } from "./kb-retrieval.js";
import { KRUTRIM_AUTO_SUMMARY_TITLE } from "../services/kb-source-summary.js";
import { getBackchannelFillers, pickBackchannelFiller, rememberFillerPhrase, type BackchannelFillerOptions } from "./backchannel.js";
import { ConversationHistory } from "./conversation-history.js";
import { performance } from "perf_hooks";
import {
  computeEndpointMs,
  TurnSafetyNet,
  SilenceWatchdog,
  recoveryReprompt,
  speakerHandoffChallenge,
  inactivityReprompt,
  inactivityFarewell,
  neutralGreeting,
  buildInstantReturningGreeting,
  AFFIRMATIONS,
  STALL_BACKSTOP_MS,
  OUTBOUND_POST_GREETING_STALL_MS,
  RESUME_DROP_POST_GREETING_STALL_MS,
  isAffirmationOnlyUtterance,
  type TurnCloseReason,
} from "./endpointing.js";
import { checkTranscriptQuality, pickClarificationPhrase, isSemanticInterrupt, isAccidentalInterruptPhrase, shouldHoldFragmentForCoalesce, isUltraShortNoiseFragment, isCallerAudioDifficulty, isFalseInterruptionScrap, isTopicClarificationAsk, isBackchannelOnlyUtterance, normalizeSttPhonetics } from "./transcriptQuality.js";
import { buildInterruptionHint, joinHeardSentences, resolveSpokenForHistory, estimateHeardPrefix, composeHeardWithMid } from "./bargeHeard.js";
import { getCachedFillerPcm, setCachedFillerPcm } from "./fillerPcmCache.js";
import { FILLER_SEQUENCE_ID, InterruptionManager } from "./interruption-manager.js";
import { logger } from "../lib/logger.js";
import { format, addMinutes } from "date-fns";
import { toZonedTime, formatInTimeZone } from "date-fns-tz";
import { db, bookingsTable, eventTypesTable, schedulingCalendarsTable, agentsTable, platformSettingsTable } from "@workspace/db";
import { scheduleCallbackRequested } from "../services/autoRedial.js";
import { resolveCallbackTime } from "../lib/tz-datetime.js";
import { eq, and, or, sql } from "drizzle-orm";
import { getAvailableSlots } from "../services/scheduling/slot-engine.js";
import type { TimeSlot } from "../services/scheduling/slot-engine.js";
import { buildSlotLockKey } from "../services/scheduling/lock.js";
import { sendBookingCreatedEmail, sendBookingCancelledEmail, sendBookingRescheduledEmail } from "../services/scheduling/notifications.js";
import { dispatchSchedulingWebhooks } from "../routes/scheduling/webhooks.js";
import {
  writeExecutionLog,
  logPlaybackEvent,
  logRecordingEvent,
  logToolExecutionStarted,
  logWarningEvent,
  EXEC_COMPONENTS,
  type ExecDirection,
  type ExecLogOpts,
  type ExecLogFn,
  type PlaybackEvent,
} from "../services/execution-log.js";
import {
  buildToolDefs,
  matchToolByName,
  sanitizeToolName,
  executeNativeBooking as sharedExecuteNativeBooking,
  executeNativeCheckAvailability as sharedExecuteNativeCheckAvailability,
  executeNativeListBookings as sharedExecuteNativeListBookings,
  executeNativeReschedule as sharedExecuteNativeReschedule,
  executeNativeCancel as sharedExecuteNativeCancel,
  executeWebhookTool as sharedExecuteWebhookTool,
  executeSendEmail as sharedExecuteSendEmail,
  executeSendWhatsapp as sharedExecuteSendWhatsapp,
  parsePreferredDate,
  writeTransferLeadDb,
} from "../services/tool-executor.js";

/** Built-in tool always injected into the LLM tool list (telephony calls only). */
const SCHEDULE_CALLBACK_TOOL_DEF: ToolDefinition = {
  name: "schedule_callback",
  description: "Schedule a callback call for this caller. ONLY call this when the caller EXPLICITLY and UNAMBIGUOUSLY asks to be called back — e.g. 'call me back', 'call me later', 'please call me at 3pm', 'I'm busy now, call tomorrow'. Do NOT trigger this tool if the caller is confused, skeptical, negative, or gave a vague/unclear response. The intent to receive a callback must be clear and deliberate. If uncertain whether the caller actually wants a callback, ask them directly first.",
  parameters: {
    type: "object",
    properties: {
      scheduled_at: {
        type: "string",
        description: "Local wall-clock datetime to call back, in the BUSINESS timezone shown in your [CURRENT DATE & TIME] context. Resolve any relative phrasing ('tomorrow', 'this evening', 'in two hours', 'next Monday 10am') against that current date/time and output an absolute ISO 8601 value WITHOUT a timezone suffix (e.g. '2026-06-23T15:00:00'). Omit only if no time was mentioned — defaults to 1 hour from now.",
      },
      notes: {
        type: "string",
        description: "Brief note capturing why the callback was requested, in the caller's words.",
      },
    },
  },
};

const VAD_SILENCE_MS          = 150;    // default silence window before STT flush (per-agent tunable via vadSilenceMs)
const MIN_SPEECH_BYTES        = 3200;   // ~200ms @ 8kHz PCM — skip noise bursts shorter than this
const CHUNK_SIZE_MULAW        = 160;    // 20ms @ 8kHz mulaw for paced batch playback
const VAD_THRESHOLD           = 100;    // RMS threshold for speech detection
const STREAM_ACCUM_BYTES      = 640;    // 20ms of 16kHz PCM before forwarding a TTS stream chunk
// TTS jitter buffer (see drainSentenceJob): runway of audio to queue before
// starting/resuming the paced send pump, so momentary provider-stream hiccups
// don't become audible mid-sentence gaps. Caps bound the added latency.
const TTS_PREBUFFER_MS     = Math.max(0, Number(process.env.TTS_PREBUFFER_MS ?? 300));
const TTS_PREBUFFER_CAP_MS = Math.max(TTS_PREBUFFER_MS, Number(process.env.TTS_PREBUFFER_CAP_MS ?? 600));
const TTS_REBUFFER_MS      = Math.max(0, Number(process.env.TTS_REBUFFER_MS ?? 160));
const TTS_REBUFFER_CAP_MS  = Math.max(TTS_REBUFFER_MS, Number(process.env.TTS_REBUFFER_CAP_MS ?? 400));
const HANDOFF_SILENCE_MS      = 3000;   // sustained silence that may indicate a phone handoff
const FILLER_THRESHOLD_MS     = 350;    // play a filler phrase if LLM has not returned a first
                                        // token within this window (and backchannel didn't fire)
const DEAD_AIR_FILLER_CANCEL_MS = 500; // skip dead-air filler playback if LLM first token
                                        // arrives within this window after filler was enqueued
const FRAGMENT_COALESCE_MS_DEFAULT = 1000;  // fallback when agentConfig omits playing coalesce — keep in sync with FRAGMENT_COALESCE_DEFAULTS.playingMs (lib/db)
/** Listening-side hold for ack fragments ("Yes Ma'am") — was 150ms; call 4856
 *  flushed before the caller finished "…how are you?" → zigzag replies. */
const FRAGMENT_COALESCE_LISTENING_MS_DEFAULT = 250;
const VAD_FLUSH_BACKSTOP_MS   = 2000;   // speech_start with no interim/final/speech_end for this long → one-shot STT flush (lost-turn anomaly)
const VAD_FLUSH_COOLDOWN_MS   = 5000;   // min interval between backstop flushes — keeps the flush strictly anomaly-only
const LLM_TTFT_FALLBACK_MS    = Number(process.env.LLM_TTFT_FALLBACK_MS ?? 1200); // abort slow primary LLM
const LLM_SLOW_TTFT_MS        = Number(process.env.LLM_SLOW_TTFT_MS ?? 1200);     // warn in execution logs
const TTS_STREAM_TIMEOUT_MS   = 8000;   // abort TTS streaming fetch if no data within 8 s —
                                         // prevents a hung Cartesia/ElevenLabs connection from
                                         // silencing the call until Vobiz times out and drops it
const BARGE_IN_ENERGY_THRESHOLD = 1200; // Much higher than normal VAD (300) — only intentional,
                                         // loud caller speech should interrupt the agent.
                                         // Prevents phone echo, background TV, or ambient
                                         // conversation from cutting the AI off mid-sentence.
const BARGE_IN_ECHO_GRACE_MS  = 600;    // Suppress barge-in for 600 ms after playback starts —
                                         // gives audio time to reach the caller before we start
                                         // counting any returning echo as a real interruption.
const BARGE_IN_MIN_FRAMES     = 3;      // Absolute floor on barge-in frames (~60 ms) so a single
                                         // loud frame can't cut the agent off, even when a Stop
                                         // Speaking Plan configures very low sensitivity.
const BARGE_IN_TELEPHONY_ACTIVE_TTS_ENERGY_FLOOR = 1200; // COLD-START fallback only. On a no-AEC carrier
                                         // the agent's own TTS echoes back with real energy WHILE it is
                                         // playing, so a naive low threshold (e.g. the user's 200, which is
                                         // even below the ~300 VAD speech-gate) self-triggers on the echo.
                                         // A single FIXED number is wrong, though: the echo level is
                                         // line-specific. We now MEASURE the echo floor per call (see
                                         // playbackEchoFloor) and set the bar to echoFloor × margin. This
                                         // constant is used only before enough echo has been observed.
const TELEPHONY_TAIL_DRAIN_MS_DEFAULT = 400; // fallback when agentConfig omits tail drain
// ── Adaptive (self-calibrating) energy barge-in for the streaming-STT carrier path ──
// The barge-in bar during active TTS = max(configuredThreshold, measuredEchoFloor × MARGIN),
// clamped to [configured, MAX]. This lets a NORMAL-volume caller interrupt on a quiet line
// (echoFloor low → bar near the configured threshold) while still rejecting a LOUD echo on a
// bad line (echoFloor high → bar rises above it) — with no magic fixed number to guess.
const BARGE_IN_ADAPTIVE_ECHO_MARGIN = Number(process.env.BARGE_IN_ADAPTIVE_ECHO_MARGIN ?? 1.6); // bar = echoFloor × this
const BARGE_IN_ADAPTIVE_MAX_THRESHOLD = Number(process.env.BARGE_IN_ADAPTIVE_MAX_THRESHOLD ?? 2500); // ceiling on the echo-derived boost so a loud caller can always break through
// Asymmetric EMA for the echo-floor estimate: rise SLOWLY (a brief loud sample barely
// nudges the floor) but fall FAST (once the line quiets the floor recovers, so any
// momentary over-estimate self-heals within a few frames rather than desensitising the
// detector for the rest of the call).
const BARGE_IN_ECHO_FLOOR_RISE_ALPHA = Number(process.env.BARGE_IN_ECHO_FLOOR_RISE_ALPHA ?? 0.05);
const BARGE_IN_ECHO_FLOOR_FALL_ALPHA = Number(process.env.BARGE_IN_ECHO_FLOOR_FALL_ALPHA ?? 0.3);
// The echo floor is sampled ONLY in this short window right after a line starts playing.
// Human reaction time to decide to talk over THIS specific line is >~300 ms, so these
// first frames are almost certainly pure returning echo — NOT the caller. Sampling only
// here is what stops a caller who barges in early from poisoning the floor against
// themselves (the failure mode a full-grace-window EMA would cause).
const BARGE_IN_ECHO_CALIBRATION_MS = Number(process.env.BARGE_IN_ECHO_CALIBRATION_MS ?? 250);
// Require this many echo samples before the learned floor is trusted; until then the
// conservative cold-start fallback is used so returning echo can't self-trigger while
// the estimate is still empty (≈ one sentence's calibration window to warm up).
const BARGE_IN_ECHO_FLOOR_MIN_SAMPLES = Number(process.env.BARGE_IN_ECHO_FLOOR_MIN_SAMPLES ?? 10);
const BARGE_IN_STREAMING_MIN_FRAMES = Number(process.env.BARGE_IN_STREAMING_MIN_FRAMES ?? 10); // ~200 ms of sustained above-bar speech to fire (streaming path)
/** Floor for telephony energy barge-in — agents with bargeInEnergyThreshold=300 (VAD floor) false-trigger constantly. */
const BARGE_IN_TELEPHONY_MIN_ENERGY = Number(process.env.BARGE_IN_TELEPHONY_MIN_ENERGY ?? 800);
// Browser webcall: the browser's hardware/OS AEC already cancels the agent's own TTS before the
// audio reaches the pipeline, so the telephony anti-echo bar (1200) is unnecessary and too high
// for a typical browser mic. Use a lower threshold so a normal speaking volume can interrupt.
// Env-tunable; a user-configured bargeInEnergyThreshold BELOW this value is still honoured.
const BARGE_IN_WEBCALL_AEC_THRESHOLD = Number(process.env.BARGE_IN_WEBCALL_AEC_THRESHOLD ?? 400);
// ── Content-based self-echo rejection (carrier echo on the Live Call path) ─────
// On the Vobiz telephony path the carrier echoes the agent's own TTS back to us
// AFTER the time-based echo-grace windows expire, so STT finalizes it as a
// phantom caller turn (call 772: echoed "Hello" + greeting words tripped a false
// barge-in that killed the greeting). These tune the content-match guard that
// recognizes the agent's own words coming back.
const SELF_ECHO_TAIL_MS       = 2000;  // how long after a line's estimated end its carrier
                                        // echo can still return and be matched as self-echo
const SELF_ECHO_MIN_OVERLAP   = 0.6;   // fraction of transcript tokens that must appear in
                                        // recent agent speech to classify it as our own echo
const CARRIER_ECHO_LATENCY_MS = 1500;  // margin added to the greeting echo-hold to cover the
                                        // round-trip carrier echo latency (observed ~777 ms)
// Tail drain duration comes from agentConfig.telephonyTailDrainMs (Latency Tuning UI).
// ── Voicemail-delivery (Vobiz AMD leave_message) tunables ──────────────────────
// When the answer webhook detects a machine, we open the media stream and listen
// to the machine's outgoing greeting. The message is spoken once the greeting ends
// (sustained silence ≈ the record beep) so the recipient's machine records it in
// full. Env-overridable to tune against real recordings.
const VOICEMAIL_GREETING_END_SILENCE_MS =
  Number(process.env["VOICEMAIL_GREETING_END_SILENCE_MS"]) || 800;  // silence after speech = end-of-greeting
const VOICEMAIL_MAX_WAIT_MS =
  Number(process.env["VOICEMAIL_MAX_WAIT_MS"]) || 12000;            // fallback: speak anyway after this long
const VOICEMAIL_GREETING_ENERGY_THRESHOLD = 300;                    // RMS bar for "machine is speaking its greeting"

// ── Acoustic AMD confirmation (VoBiz unreliable machine-hint) ────────────────
// When the answer webhook reports a "machine" hint we NEVER enact the voicemail
// action outright (VoBiz false-positives on live humans). Instead we open the
// media stream and confirm acoustically first. All thresholds bias strongly
// toward "human": ambiguity, silence, or a short utterance resolve to human.
const AMD_CONFIRM_WINDOW_MS =                                       // hard cap: resolve human after this long
  Number(process.env["AMD_CONFIRM_WINDOW_MS"]) || 1200;
const AMD_CONTINUOUS_GREETING_MS =                                  // continuous speech run that CONFIRMS a machine
  Number(process.env["AMD_CONTINUOUS_GREETING_MS"]) || 2500;
const AMD_SPEECH_GAP_MS =                                           // silence gap that ends a continuous speech run
  Number(process.env["AMD_SPEECH_GAP_MS"]) || 300;
const AMD_HUMAN_PAUSE_MS =                                          // pause after a SHORT utterance ("hello?") → human
  Number(process.env["AMD_HUMAN_PAUSE_MS"]) || 400;
const AMD_NO_SPEECH_HUMAN_MS =                                      // no greeting heard at all by this point → human
  Number(process.env["AMD_NO_SPEECH_HUMAN_MS"]) || 250;
const AMD_CONFIRM_ENERGY_THRESHOLD =                               // RMS bar for "someone is speaking" during confirm
  Number(process.env["AMD_CONFIRM_ENERGY_THRESHOLD"]) || VOICEMAIL_GREETING_ENERGY_THRESHOLD;
// External (async provider callback) AMD corroboration — VoBiz delivers its
// verdict via the machine_detection_url callback mid-window. A "machine"
// callback is NOT blindly trusted: it lowers the continuous-speech bar to this
// reduced threshold (still requiring real acoustic corroboration) …
const AMD_EXTERNAL_MACHINE_CONTINUOUS_MS =
  Number(process.env["AMD_EXTERNAL_MACHINE_CONTINUOUS_MS"]) || 2000;
// … and extends the hard confirmation cap by this much (once), giving the
// acoustics time to corroborate a callback that arrives late in the window.
const AMD_EXTERNAL_MACHINE_EXTEND_MS =
  Number(process.env["AMD_EXTERNAL_MACHINE_EXTEND_MS"]) || 2000;
const KB_CONTEXT_RACE_MS      = 300;    // Max time the turn waits for KB-context retrieval before
                                         // starting the LLM. If the prefetch is slower than this, the
                                         // turn proceeds with whatever context resolved (possibly none)
                                         // so first-token time stays low; the late prefetch is discarded.
                                         // Must exceed the INNER live-vs-prefetch budget
                                         // (KB_TURN_RETRIEVAL_BUDGET_MS, default 200) so the prefetch
                                         // fallback actually has time to surface before this outer
                                         // race abandons KB context entirely.
// Char cap for the speech-start full-dump PREFETCH (fallback context only).
// Pinned entries sort first in the dump, so a curated summary survives the cut.
const KB_PREFETCH_MAX_CHARS   = 8000;

/**
 * True when a transcript contains at least one letter but NO Latin letters —
 * e.g. pure Tamil/Devanagari speech. PostgreSQL FTS uses the 'english' config,
 * which can't stem/tokenize such text, so FTS is wasted latency + rank noise
 * there and retrieval should go vector-only. Code-mixed text (any Latin word
 * present) keeps FTS.
 */
/**
 * Returns true when an LLM-streamed sentence is a pure acknowledgment word or
 * short phrase (e.g. "சரி.", "சரிங்க.", "okay.", "Got it.") that carries no
 * information and would double the filler already spoken this turn.
 * Conservative list — only exact single-word/short-phrase acks that the LLM
 * typically emits as openers in Tamil/English conversations.
 */
function isLlmLeadingAck(sentence: string): boolean {
  const t = sentence
    .trim()
    .toLowerCase()
    .replace(/[.!?,\s]+$/g, "") // strip trailing punctuation/whitespace
    .trim();
  // Keep this list minimal and exact — only phrases that convey zero new
  // information when a filler word of the same type was already spoken.
  const ACK_WORDS = new Set([
    // Tamil
    "சரி", "சரிங்க", "சரிங்கம்", "ஆமா", "ஆம்", "நல்லது",
    // English
    "okay", "ok", "got it", "i see", "sure", "right", "alright",
    "understood", "great", "perfect", "mm-hmm", "mhm", "mmhm", "yes", "yeah",
    // Hindi (occasional)
    "हाँ", "अच्छा", "ठीक है",
    // Telugu/Kannada/Malayalam common acks
    "సరే", "ಸರಿ", "ശരി",
  ]);
  return ACK_WORDS.has(t);
}

function isPureNonLatinQuery(q: string): boolean {
  return /\p{L}/u.test(q) && !/[A-Za-z]/.test(q);
}

/** BCP-47 locale → display name used in LLM language-switch instructions. */
const LANG_DISPLAY_NAMES: Record<string, string> = {
  "hi-IN": "Hindi", "ta-IN": "Tamil", "te-IN": "Telugu", "kn-IN": "Kannada",
  "ml-IN": "Malayalam", "mr-IN": "Marathi", "bn-IN": "Bengali", "gu-IN": "Gujarati",
  "pa-IN": "Punjabi", "or-IN": "Odia", "ur-IN": "Urdu",
  "en-IN": "English", "en-US": "English", "en-GB": "English",
  "fr-FR": "French", "de-DE": "German", "es-ES": "Spanish", "pt-BR": "Portuguese",
  "it-IT": "Italian", "ja-JP": "Japanese", "ko-KR": "Korean", "zh-CN": "Chinese",
  "ar-EG": "Arabic", "ru-RU": "Russian",
  "si-LK": "Sinhala", "si": "Sinhala",
};

/**
 * For non-Latin-script languages, append an explicit directive telling the LLM
 * to write in the native Unicode script — NOT in romanized/transliterated form.
 * Weaker models (e.g. Qwen on Krutrim) default to Tanglish, Hinglish-script, etc.
 * when the language rule only says "Respond in Tamil/Hindi/…".
 */
const LANG_SCRIPT_DIRECTIVE: Record<string, string> = {
  "ta-IN": "CRITICAL: Write ALL Tamil words in Tamil Unicode script (e.g. வணக்கம், நன்றி, சரி). NEVER romanize Tamil into English/Latin letters — writing 'vanakkam', 'nandri', 'seri' instead of Tamil script is WRONG. " +
    "COLLOQUIAL GRAMMAR — use everyday spoken Tamil verb forms, NOT formal/literary ones. Key contrasts: " +
    "✓ வேணும் (not வேண்டும்) | ✓ இல்ல (not இல்லை) | ✓ ஆயிடுச்சு (not ஆகிவிட்டது) | ✓ சொல்றேன் (not சொல்கிறேன்) | ✓ வர்றேன் (not வருகிறேன்) | ✓ பண்றேன் (not செய்கிறேன்) | ✓ போயிடுது (not போகிறது) | ✓ பேசிட்டு இருக்கேன் (not பேசிக்கொண்டிருக்கிறேன்) | ✓ சொல்லுங்க or சொல்லுவீங்களா (not சொல்லுங்கள்). " +
    "EXAMPLES of correct spoken Tamil: 'Sori, call cut ஆயிடுச்சு' | 'demo எப்போ வேணும்னு சொல்லுங்க' | 'நீங்க ready-ஆ இருக்கீங்களா?' | 'நான் confirm பண்றேன்' | 'OK-வா, நாளைக்கு பேசலாம்'. " +
    "NEVER use: தொடரலாமா (→ use 'continue பண்ணலாமா' or 'பேசலாம்'), முடியுமான்னு (→ use 'வேணுமா?'), நிறுத்தியதோ (→ use 'நின்னோ' or 'விட்டோமோ'), தேன்றேன் (→ use 'தேடுறேன்'), செய்கின்றேன் (→ use 'பண்றேன்'), வருகின்றேன் (→ use 'வர்றேன்'). " +
    "Keep 'call', 'demo', 'confirm', 'schedule', 'ok', 'ready' in English — they are everyday spoken words in Tamil. " +
    "NUMBERS, TIME & DURATION in English: Tamil speakers say these in English naturally. ALWAYS say 'ten to fifteen minutes' (not '10 முதல் 15 நிமிஷத்துல'), 'three o'clock' (not 'மூன்று மணி'), 'tomorrow morning 9' (not 'நாளைக்கு காலை 9 மணி'), 'five minutes' (not 'ஐந்து நிமிஷம்'). Digits like '10', '15', '3' and time expressions must be spoken as English words embedded in Tamil sentences.",
  "hi-IN": "CRITICAL: Write ALL Hindi words in Devanagari Unicode script (e.g. नमस्ते, धन्यवाद, ठीक है). NEVER romanize Hindi into English/Latin letters — writing 'namaste', 'shukriya' instead of Devanagari is WRONG.",
  "te-IN": "CRITICAL: Write ALL Telugu words in Telugu Unicode script (e.g. నమస్కారం, ధన్యవాదాలు). NEVER romanize Telugu into English/Latin letters.",
  "kn-IN": "CRITICAL: Write ALL Kannada words in Kannada Unicode script (e.g. ನಮಸ್ಕಾರ, ಧನ್ಯವಾದ). NEVER romanize Kannada into English/Latin letters.",
  "ml-IN": "CRITICAL: Write ALL Malayalam words in Malayalam Unicode script (e.g. നമസ്കാരം, നന്ദി). NEVER romanize Malayalam into English/Latin letters.",
  "mr-IN": "CRITICAL: Write ALL Marathi words in Devanagari Unicode script (e.g. नमस्कार, धन्यवाद). NEVER romanize Marathi into English/Latin letters.",
  "bn-IN": "CRITICAL: Write ALL Bengali words in Bengali Unicode script (e.g. নমস্কার, ধন্যবাদ). NEVER romanize Bengali into English/Latin letters.",
  "gu-IN": "CRITICAL: Write ALL Gujarati words in Gujarati Unicode script (e.g. નમસ્તે, આભાર). NEVER romanize Gujarati into English/Latin letters.",
  "pa-IN": "CRITICAL: Write ALL Punjabi words in Gurmukhi Unicode script (e.g. ਸਤ ਸ੍ਰੀ ਅਕਾਲ, ਧੰਨਵਾਦ). NEVER romanize Punjabi into English/Latin letters.",
  "or-IN": "CRITICAL: Write ALL Odia words in Odia Unicode script (e.g. ନମସ୍କାର, ଧନ୍ୟବାଦ). NEVER romanize Odia into English/Latin letters.",
  "ur-IN": "CRITICAL: Write ALL Urdu words in Urdu/Nastaliq Unicode script (e.g. سلام, شکریہ). NEVER romanize Urdu into English/Latin letters.",
  "si-LK": "CRITICAL: Write ALL Sinhala words in Sinhala Unicode script (e.g. ආයුබෝවන්, ස්තූතියි, හරි). NEVER romanize Sinhala into English/Latin letters — writing 'ayubowan', 'stuthi', 'hari' instead of Sinhala script is WRONG.",
  "si":    "CRITICAL: Write ALL Sinhala words in Sinhala Unicode script (e.g. ආයුබෝවන්, ස්තූතියි, හරි). NEVER romanize Sinhala into English/Latin letters — writing 'ayubowan', 'stuthi', 'hari' instead of Sinhala script is WRONG.",
};

const GREETING_ECHO_HOLD_CAP_MS = 3000;  // Hard cap on greetingEchoHoldUntil so the
                                          // caller can barge in within ~3s of the greeting
                                          // start even if the estimated greeting is long —
                                          // never lock the caller out of interrupting.

/**
 * One-shot note marking the opening-only caller-memory / resume directives as
 * already satisfied. Appended to the volatile per-turn tail of the system prompt
 * once the opener (greeting) exists in conversation history, so the LLM does not
 * re-deliver the recognition/drop-acknowledgment the greeting already spoke.
 * Deliberately preserves the persistent rules (NAME PRIORITY, DO NOT RE-ASK).
 */
const OPENING_ALREADY_DELIVERED_NOTE =
  "[OPENING ALREADY DELIVERED — OVERRIDES RESUME/DROP ACK] The opening line of this call has ALREADY been spoken " +
  "(it is the first assistant message in the conversation). This OVERRIDES any RESUME / LAST CALL DROPPED / " +
  "\"acknowledge the interruption\" instruction above. Do NOT greet again, do NOT re-introduce yourself, do NOT " +
  "re-state that you remember them or summarize the previous call unprompted, and do NOT apologize for or " +
  "mention a dropped/cut/lost call. Forbidden unless the caller just said it RIGHT NOW: கால் கட், कॉल कट, " +
  "\"call cut\", \"call dropped\", \"got cut off\", \"ஆயிடுச்சு\" about the call. Simply respond to the " +
  "caller's latest message and move the conversation forward. " +
  "The NAME PRIORITY rule and the DO NOT RE-ASK KNOWN INFORMATION rule above remain in force for the " +
  "entire call — keep using known details instead of re-asking, and switch names if the caller states their own.";

/** Soft mid-call handoff — new voice on the same phone; do not hang up. */
const SPEAKER_HANDOFF_SUPPRESS_NOTE =
  "[SPEAKER CHANGE DETECTED] The person speaking now may not be the original caller " +
  "(phone may have been handed to someone else). Do NOT use the previous caller's name, " +
  "Sir/Ma'am salutation, or CALLER MEMORY facts for them until the new speaker confirms who they are. " +
  "Treat the current speaker as a new person on this line. Do not hang up.";

/** Injected after we already forced a spoken "who am I speaking with?" line. */
const SPEAKER_HANDOFF_AFTER_CHALLENGE_NOTE =
  SPEAKER_HANDOFF_SUPPRESS_NOTE +
  " You already asked who you are speaking with. Wait for their answer; do not re-ask and " +
  "do not continue treating them as the previous caller.";

const SPEAKER_HANDOFF_CHALLENGE_NOTE =
  SPEAKER_HANDOFF_SUPPRESS_NOTE +
  " Ask one short polite question about who you are speaking with now, then continue normally.";

/** Voice matched a known person who previously called from a different number. */
const VOICE_LINKED_PHONE_NOTE =
  "[VOICE MEMORY] This caller's voice closely matches someone this agent spoke with before on a " +
  "different phone number. Treat them as possibly the same person — you may gently recognize them if " +
  "it feels natural, but confirm name/details if unsure. This is a soft signal, not identity verification.";

const VOICE_LINK_ACK_NOTE =
  "[RECOGNIZE THE CALLER — THIS REPLY] You have just recognized this caller from a previous " +
  "conversation (see VOICE-MATCHED CALLER MEMORY above). In THIS reply, briefly and warmly " +
  "acknowledge that you remember speaking with them before — naturally, in one short phrase " +
  "woven into your answer (e.g. mention their name or something from the last conversation). " +
  "Never mention phone numbers, voice matching, or how you recognized them. Do this once only.";

/**
 * Build a COMPACT system prompt for the greeting-only LLM call. Returning callers were
 * triggering a greeting generated against the full ~31k-token system prompt, adding
 * seconds of latency (and cost) before the first word. The opening line only needs the
 * caller-memory block (so it can greet a returning caller by name/context) plus a
 * language + one-sentence-length instruction — nothing else.
 *
 * Outbound scripts often put the spoken opener under IDENTITY / CALL FLOW / GREETING
 * while greetingMessage stays a stub ("Hello"). Include those so the greeting LLM
 * can deliver the real pitch instead of a one-word opener that leaves dead air.
 */
/** True when the static greeting is a one-word stub that should not open outbound calls. */
function isStubGreeting(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (t.length < 12) return true;
  return /^(hi|hello|hey|hi there|hello there)[!.,\s]*$/i.test(t);
}

/**
 * Prompts up to this size skip section-clipping entirely and greet from the
 * FULL system prompt. The clipped compact prompt repeatedly starved the
 * greeting LLM of context (invented company call 5198; ignored caller memory
 * call 5246; translated "Fortune Trade Fairs" into an astrologer persona call
 * 5250). Full-prompt correctness beats the few hundred ms the clip saves;
 * clipping remains only for very large prompts (e.g. huge baked KB blocks).
 */
const GREETING_FULL_PROMPT_MAX_CHARS = 12_000;

function buildCompactGreetingPrompt(fullSystemPrompt: string, language: string, resumeDropped = false): string {
  const memoryMatch = fullSystemPrompt.match(
    /=== CALLER MEMORY[\s\S]*?={20,}/,
  );
  const memoryBlock = memoryMatch?.[0] ?? "";
  // Section clips. The lazy terminator-anchored patterns fail entirely when a
  // prompt uses plain-text headings with no ===/---/[ boundary markers (call
  // 5198: both clips came back empty → the greeting LLM had NO identity and
  // hallucinated a fictional company). Each clip therefore falls back to a
  // greedy hard-capped grab, and if we STILL have nothing, we take the top of
  // the prompt body — identity is almost always written first.
  // 1600-char cap: real IDENTITY sections routinely run past 800 chars, and the
  // old 800 cap silently truncated opening rules written at the section's tail
  // (call 5246: the "hello already spoken / acknowledge returning caller" rules
  // were cut off → greeting re-greeted with வணக்கம் and ignored caller memory).
  const identityMatch = fullSystemPrompt.match(/\bIDENTITY\b[\s\S]{0,1600}?(?=\n---|\nCALL FLOW|\nGREETING|\n===|$)/i)
    ?? fullSystemPrompt.match(/\bIDENTITY\b[\s\S]{0,1600}/i);
  const callFlowMatch = fullSystemPrompt.match(/\bCALL FLOW\b[\s\S]{0,2200}?(?=\n===|\n\[|$)/i)
    ?? fullSystemPrompt.match(/\bGREETING\b[\s\S]{0,1800}?(?=\n===|\n\[|$)/i)
    ?? fullSystemPrompt.match(/\bCALL FLOW\b[\s\S]{0,2200}/i);
  let scriptBlock = [identityMatch?.[0], callFlowMatch?.[0]].filter(Boolean).join("\n\n");
  if (!scriptBlock) {
    // No recognizable sections at all — use the start of the prompt (after any
    // caller-memory prefix) so the opener at least knows who it works for.
    const body = memoryBlock ? fullSystemPrompt.slice(fullSystemPrompt.indexOf(memoryBlock) + memoryBlock.length) : fullSystemPrompt;
    scriptBlock = body.trim().slice(0, 1500);
  }
  const langName = LANG_DISPLAY_NAMES[language] ?? language;
  const isEnglish = language.startsWith("en");
  // For non-English target languages, mirror the colloquial REGISTER + proper-noun
  // rule that buildLangGuard applies to every normal turn. Without it the greeting
  // LLM defaults to a formal/literary/bookish register for the very first spoken
  // line while the rest of the conversation stays colloquial. English openers stay
  // plain English (buildLangGuard likewise adds no register rule for English).
  const languageInstruction = isEnglish
    ? `[LANGUAGE] Respond ONLY in ${langName}.`
    : `[LANGUAGE] Respond ONLY in ${langName}. ` +
      `REGISTER — speak in natural, everyday colloquial spoken ${langName}, the way real people talk in casual conversation; ` +
      `NEVER use formal, literary, or bookish register. Mixing commonly-used English loanwords (business, finance, tech, and everyday terms) ` +
      `into ${langName} is normal spoken usage — keep such words in English as people naturally say them; this does NOT count as switching languages. ` +
      `EXCEPTION — proper nouns: keep all brand names, product names, company names, and people's names ` +
      `EXACTLY as written in your instructions; never translate or transliterate them.`;
  const openingLengthRule = resumeDropped
    ? "[OPENING — RESUME AFTER DROP] The previous call with this caller dropped mid-conversation. " +
      "Speak 1–2 short colloquial sentences only: (1) briefly acknowledge the call got cut/dropped " +
      "(natural phrasing in the caller's language — do NOT greet by name, do NOT say வணக்கம்/hello " +
      "as if starting fresh), (2) immediately continue from LAST EXCHANGES BEFORE THE CALL DROPPED " +
      "in CALLER MEMORY above — pick up the same topic mid-thread. Do NOT re-introduce yourself, " +
      "your company, or restart the sales pitch from the beginning."
    : scriptBlock
      ? "[OPENING] Speak the GREETING / opening from CALL FLOW above as a single uninterrupted turn. " +
        "Use the caller's company/contact name when present. Do not replace the scripted pitch with a one-word Hello."
      : "[OPENING LENGTH] Your opening line must be ONE short, natural sentence — a brief greeting only. Do not list services, ask multiple questions, or explain anything yet; wait for the caller to respond.";
  const antiInventionRule =
    "[NEVER INVENT] Use ONLY the company name, brand names, and facts written in the instructions above. " +
    "If no company name is given above, greet WITHOUT naming any company — NEVER make up a company, product, or service.";
  const returningCallerRule = memoryBlock && !resumeDropped
    ? "[RETURNING CALLER] If the CALLER MEMORY above contains actual facts about this caller (not just an empty template), " +
      "this is a repeat conversation: briefly acknowledge it naturally in ONE short clause and skip the first-time welcome. " +
      "Reference ONLY facts explicitly written in the memory — never invent or infer details."
    : "";
  if (fullSystemPrompt.length <= GREETING_FULL_PROMPT_MAX_CHARS) {
    // Full-prompt greeting: the model sees exactly what it sees on every
    // later turn, so the opener can no longer contradict the conversation.
    const fullOpeningRule = resumeDropped
      ? openingLengthRule // resume-after-drop instructions apply unchanged
      : "[OPENING] Produce ONLY your first spoken line of this call, following the opening/greeting " +
        "instructions in your prompt above. Keep it short and natural — do not continue past the opener.";
    return [
      fullSystemPrompt,
      languageInstruction,
      fullOpeningRule,
      returningCallerRule,
      antiInventionRule,
    ].filter(Boolean).join("\n\n");
  }
  const parts = [
    memoryBlock,
    scriptBlock,
    languageInstruction,
    openingLengthRule,
    returningCallerRule,
    antiInventionRule,
  ].filter(Boolean);
  return parts.join("\n\n");
}

/**
 * Detect the dominant BCP-47 language from the Unicode script of a transcript.
 * Used as a fallback when the STT provider does not return a language code.
 * Sarvam saaras:v3 now forwards `language_code` via `coalesceLang` in the adapter,
 * so for Sarvam calls `lang` is non-null and this function is only consulted when
 * the provider returns no LID (older models, non-Sarvam providers).
 * This drives per-turn language injection when `languageAutoDetect` is ON.
 *
 * Priority: Tamil > Devanagari (Hindi) > Malayalam > Telugu > Kannada > Bengali >
 *           Gujarati > Gurmukhi (Punjabi) > Odia > Latin-only (English) > null.
 *
 * Mixed scripts: the Indic script with the most characters wins among Indic scripts.
 * Latin (English) only wins when the transcript contains zero Indic characters — any
 * presence of Tamil/Devanagari/etc. script outweighs any amount of Latin text, because
 * callers frequently mix romanized words ("Anna", "insurance") into Indic-script speech.
 */
function detectScriptLanguage(text: string): string | null {
  let tamil = 0, devanagari = 0, malayalam = 0, telugu = 0, kannada = 0;
  let bengali = 0, gujarati = 0, gurmukhi = 0, odia = 0, sinhala = 0, latin = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x0B80 && cp <= 0x0BFF) tamil++;
    else if (cp >= 0x0900 && cp <= 0x097F) devanagari++;
    else if (cp >= 0x0D00 && cp <= 0x0D7F) malayalam++;
    else if (cp >= 0x0D80 && cp <= 0x0DFF) sinhala++;
    else if (cp >= 0x0C00 && cp <= 0x0C7F) telugu++;
    else if (cp >= 0x0C80 && cp <= 0x0CFF) kannada++;
    else if (cp >= 0x0980 && cp <= 0x09FF) bengali++;
    else if (cp >= 0x0A80 && cp <= 0x0AFF) gujarati++;
    else if (cp >= 0x0A00 && cp <= 0x0A7F) gurmukhi++;
    else if (cp >= 0x0B00 && cp <= 0x0B7F) odia++;
    else if ((cp >= 0x0041 && cp <= 0x005A) || (cp >= 0x0061 && cp <= 0x007A)) latin++;
  }
  // If ANY Indic script characters are present, Latin cannot win.
  // Rationale: callers often mix romanized words ("Anna", "insurance") into an
  // otherwise Indic-script utterance. A single Tamil/Devanagari/etc. character is
  // stronger evidence of language than any number of shared-Latin words.
  // English (Latin-only) is returned only when the transcript contains zero Indic chars.
  const indicTotal = tamil + devanagari + malayalam + telugu + kannada +
                     bengali + gujarati + gurmukhi + odia + sinhala;
  const effectiveLatin = indicTotal > 0 ? 0 : latin;
  const scores: Array<[number, string]> = [
    [tamil,         "ta-IN"],
    [devanagari,    "hi-IN"],
    [malayalam,     "ml-IN"],
    [sinhala,       "si-LK"],
    [telugu,        "te-IN"],
    [kannada,       "kn-IN"],
    [bengali,       "bn-IN"],
    [gujarati,      "gu-IN"],
    [gurmukhi,      "pa-IN"],
    [odia,          "or-IN"],
    [effectiveLatin,"en-IN"],
  ];
  const best = scores.reduce((a, b) => (b[0] > a[0] ? b : a));
  // Only return a result if at least 1 non-whitespace non-punctuation character matches.
  return best[0] > 0 ? best[1] : null;
}

/** Transcript phrases that strongly suggest the caller is handing the phone to someone else. */
const HANDOFF_PHRASES = [
  // English
  "talk to her", "talk to my wife", "talk to my sister", "talk to my mother",
  "here she is", "pass the phone", "give the phone to", "let her talk",
  "let her speak", "she will talk", "she wants to talk",
  "i'll pass", "passing you", "passing the phone",
  // Hindi-romanized
  "baat karo", "usse baat", "use de do", "phone de do",
  "le lo phone", "in se baat",
];

// ── Global token-optimization kill switch (cached 30 s to avoid per-turn DB hits) ──
const TOKEN_OPT_KEY = "token_optimization_enabled";
const TOKEN_OPT_CACHE_TTL_MS = 30_000;
let _tokenOptEnabled = true;
let _tokenOptCacheExpiry = 0;
async function fetchTokenOptEnabled(): Promise<boolean> {
  if (Date.now() < _tokenOptCacheExpiry) return _tokenOptEnabled;
  try {
    const [row] = await db
      .select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, TOKEN_OPT_KEY));
    _tokenOptEnabled = row?.value !== "false";
  } catch {
    _tokenOptEnabled = true;
  }
  _tokenOptCacheExpiry = Date.now() + TOKEN_OPT_CACHE_TTL_MS;
  return _tokenOptEnabled;
}

/**
 * True for transient/momentary LLM provider errors that are worth retrying on
 * the SAME provider before falling back or failing the call. Covers HTTP 429 /
 * 5xx and common network faults. Providers (Google/OpenAI/etc.) surface these
 * as "503 Service Unavailable", "high demand", "overloaded", "try again later",
 * rate limits, or socket/DNS/timeout errors — all typically resolved by a quick
 * retry. Deterministic 4xx (bad request, auth, quota-exhausted) are NOT retried.
 */
function isRetryableLlmError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  if (!msg) return false;
  if (/\b(429|500|502|503|504)\b/.test(msg)) return true;
  return (
    msg.includes("service unavailable") ||
    msg.includes("high demand") ||
    msg.includes("overloaded") ||
    msg.includes("try again") ||
    msg.includes("temporarily") ||
    msg.includes("rate limit") ||
    msg.includes("too many requests") ||
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("enotfound") ||
    msg.includes("eai_again") ||
    msg.includes("socket hang up") ||
    msg.includes("fetch failed") ||
    msg.includes("network error")
  );
}

/**
 * A single sentence's TTS synthesis, decoupled from its playback. Created by
 * startSentenceSynthesis (network fetch + byte-alignment only, safe to run
 * ahead of time) and consumed by drainSentenceJob (recording/ambient/wire
 * encoding/pacing, which must run in strict playback order). See
 * startSentenceSynthesis's doc comment for why this split exists.
 */
type TtsSentenceJob = {
  text: string;
  turnNumber: number;
  /** Bolna sequence_id — stale frames from invalidated turns are BLOCKed. */
  sequenceId: number;
  /** True if this.tts.synthesizeStream was used (vs the one-shot synthesize()). */
  streaming: boolean;
  /** Streaming path: 4-byte-aligned pcm16k blocks awaiting drain-time processing. */
  pcmQueue: Buffer[];
  /** True once the TTS request has fully settled (success, error, or abort). */
  synthDone: boolean;
  synthError: unknown;
  /** Set once synthDone; total audio duration computed from received bytes. */
  audioDurationMs: number | undefined;
  /** Non-streaming path: the full synthesized PCM buffer, once synthDone. */
  nonStreamAudio: Buffer | null;
  /** Resolves once synthDone is true. */
  ready: Promise<void>;
};

export class OrchestrationPipeline implements VoiceSession {
  private config: SessionConfig;
  private readonly callDirection: "inbound" | "outbound";
  private readonly isResumeDroppedCall: boolean;
  private agent: AgentConfig;
  private stt: ReturnType<typeof createSTTAdapter>;
  private llm: ReturnType<typeof createLLMAdapter>;
  private fallbackLlm: ReturnType<typeof createLLMAdapter> | null = null;
  private tts: ReturnType<typeof createTTSAdapter>;

  private audioBuffer: Buffer[] = [];
  // Parallel buffer of TRUE (never downsampled) 16kHz mic audio, populated only
  // for sources that hand us native 16k (webcall — see onRawPcm8kIn). Mirrors
  // audioBuffer's push/reset points 1:1. Used in flushAndProcess so batch STT
  // gets real high-frequency content instead of upsample8to16(pcm8k), which is
  // just linear interpolation of an already 4kHz-Nyquist-limited signal and
  // cannot recover the fricative energy ("v", "z", "s") lost at the 8k step.
  private audioBufferNative16k: Buffer[] = [];
  // FIFO of native 16k chunks awaiting pairing with the audio worker's async
  // result in handleProcessedAudio. Safe because processRawPcm8kIn resolves in
  // strict per-call order (see audioPool.ts worker routing).
  private nativePcm16kQueue: Buffer[] = [];
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  // Per-agent silence-hangup watchdog (call 1915): replaces the raw
  // silenceHangupTimer. Fed by transcripts (reset) AND raw caller speech
  // energy on BOTH the streaming and batch STT paths (onSpeechEnergy), so a
  // quiet streaming STT session can no longer let the timer fire mid-speech.
  // Speaks an in-language "are you there?" check-in before giving up.
  private silenceWatchdog: SilenceWatchdog | null = null;
  /**
   * Raw reason for the session teardown, read by session.ts when onCallEnd is
   * fired without an explicit reason (e.g. silence timeout), so the Call Ended
   * summary shows "Silence timeout" instead of "Conversation completed".
   */
  public endReasonHint: string | null = null;
  private isProcessing = false;
  /**
   * Set to true the moment executeCallTransfer begins (before the provider API
   * call). Prevents any queued STT transcript — caller speech during the transfer
   * hold window — from spawning a new LLM turn and a duplicate transfer API call.
   * Defense-in-depth alongside the this.closed guard on the pendingTranscriptQueue
   * drain: the closed flag is set by onCallEnd which fires AFTER the provider API
   * resolves, so there is a brief window where closed=false but the transfer is
   * already in progress.
   */
  private transferInitiated = false;

  // Barge-in state
  private isPlaying = false;
  /** Lost-turn backstop: one-shot force-flush timer armed on VAD speech_start (calls 4831/4833). */
  private _vadFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private _lastVadFlushAt = 0;
  /** Unheard remainder of a reply cut by barge-in — resumed if the "interruption" turns out to be a scrap (call 4839 dead-air). */
  private _bargedReplyRemainder: string | null = null;
  private _bargedReplyAt = 0;
  /**
   * True only while playSentence() is actively sending TTS bytes to the carrier.
   * Distinct from isPlaying (which stays true for the entire turn, including the
   * inter-sentence wait for the next LLM token).  The ambientInterval uses THIS
   * flag so ambient audio plays during the silence gap between sentences instead
   * of leaving the line completely dead while the LLM produces its next chunk.
   */
  private isSendingTtsAudio = false;
  /**
   * Wall-clock timestamp (ms) of the last REAL TTS/greeting audio frame written
   * to the carrier via onAudioOut. The ambientInterval watchdog uses this to
   * detect a dead outbound channel: whenever no real audio frame has gone out
   * for KEEPALIVE_FILL_GAP_MS, it fills the gap with ambient (or VoBiz keepalive
   * zeros) EVEN while a sentence is nominally "in progress" — covering the TTS
   * first-byte wait and any mid-stream stall where the drain queue empties.
   * Without this, the pump is paused (isSendingTtsAudio=true) AND the drain sits
   * idle (queue empty), so agent voice and ambient go dead together, and a gap
   * past ~2 s makes VoBiz drop the call (hangup 4010).
   */
  private lastTtsFrameAt = 0;
  private bargeInRequested = false;
  private bargeInCallback: (() => void) | null;
  // Require N consecutive speech frames before triggering barge-in to avoid
  // ambient noise / single-word false positives stopping the agent mid-sentence.
  private bargeInSpeechFrames = 0;
  // Consecutive below-threshold frames counter — used to delay bargeInSpeechFrames
  // reset so brief inter-syllable dips don't kill an accumulating barge-in run.
  private bargeInLowEnergyFrames = 0;
  // Running word count accumulated across streaming STT callbacks for the
  // current user turn. Reset at the start of each new agent turn so it does
  // not bleed across turns.
  // Timestamp (ms) when the current sentence started playing. Used by the
  // streaming STT path to apply a per-sentence 600 ms echo grace instead of
  // the extended `bargeInHoldUntil` that protects the batch STT path.
  private bargeInSentenceStartAt: number = 0;
  private streamingBargeInWordCount = 0;
  // Echo grace period: timestamp (ms) until which barge-in is suppressed after
  // playback starts.  Vobiz / Twilio route a small amount of our own TTS audio
  // back to us as "caller audio" (sidetone / echo).  Without this hold, the
  // echo triggers barge-in within 200 ms and the caller never hears anything.
  private bargeInHoldUntil = 0;
  // Greeting-specific echo hold (Live Call / carrier path only): suppresses
  // streaming-STT (and energy) barge-in for the FULL greeting duration + carrier
  // echo latency so the agent's opening line cannot be interrupted or re-triggered
  // by its own returning echo, even at a 1-word interruption threshold. Expires
  // before the first listen, so it can never block a real caller barge-in later.
  private greetingEchoHoldUntil = 0;
  // Self-calibrating echo floor (RMS) for the streaming-STT energy barge-in path.
  // A rolling EMA of the inbound frame RMS measured WHILE the agent is playing but
  // NOT (yet) accumulating a barge-in — i.e. it tracks the carrier's returning-echo
  // level for THIS line. The active-TTS barge-in bar is derived from it, so a
  // normal-volume caller can interrupt on a quiet line without a magic fixed floor.
  private playbackEchoFloor = 0;
  // Count of echo samples fed into playbackEchoFloor. The learned floor is only trusted
  // once this reaches BARGE_IN_ECHO_FLOOR_MIN_SAMPLES; before that the conservative
  // cold-start fallback bar is used so returning echo can't self-trigger on frame 1.
  private playbackEchoFloorSamples = 0;
  // Throttle for the periodic "energy barge-in monitor" diagnostic log line.
  private lastEnergyMonitorLogAt = 0;
  // Rolling record of text the agent recently synthesized (oldest first), with the
  // time it was dispatched and its estimated playback end. The streaming-STT path
  // uses this to recognize the agent's OWN words echoing back via the carrier
  // (content-based self-echo rejection — additive to the time-window tail-echo
  // guard). Entries expire so stale agent speech can't suppress later caller input.
  private recentAgentSpeech: Array<{ tokens: Set<string>; estEndAt: number }> = [];
  // Voicemail-delivery mode (Vobiz AMD leave_message). When set, the conversation
  // pipeline is bypassed: inbound audio only drives greeting-end detection and
  // deliverVoicemail() speaks the configured message once the machine's greeting ends.
  private readonly voicemailDelivery: { message: string; postSilenceMarginMs?: number; maxWaitMs?: number; leadInSeconds?: number } | null;
  private vmHeardSpeech = false;   // true once the machine's greeting has been heard
  private vmLastSpeechAt = 0;      // ms timestamp of the last energetic (greeting) frame
  // True only while deliverVoicemail() is actively listening/speaking. Gates the
  // voicemail-listening branch in onRawPcm8kIn so merely HAVING voicemailDelivery
  // config (set for the leave_message acoustic-confirm path) does not divert the
  // STT feed when confirmation resolves to a live human and we greet normally.
  private vmDelivering = false;
  // True while the AMD confirmation loop or the voicemail-delivery wait/lead-in
  // loops are pumping their OWN 20 ms silence frames (VoBiz voicemail path only).
  // The ambient/keepalive watchdog interval MUST stay silent while this is set:
  // two senders emitting frames on the same 20 ms cadence double the carrier-side
  // frame rate and produce the chopped "helicopter" artifact on the delivered
  // voicemail. Cleared before voicemail playback (playSentence) starts so the
  // watchdog's first-byte/stall gap-fill still guards playback against the VoBiz
  // ~2 s inactivity drop (hangup 4010). Never set on normal conversation calls.
  private amdVmManualPumpActive = false;
  private ambientSuppressedLogged = false; // one-shot proof log for sender exclusivity
  private amdPostResolveEventLogged = false; // one-shot assertion log (should never fire)
  // Acoustic AMD confirmation (VoBiz unreliable machine-hint). When set, the
  // pipeline runs confirmAmdMachineThenBranch() instead of greeting immediately.
  private readonly amdConfirm: { action: "leave_message" | "hangup" | "continue"; hint?: boolean; leadInSeconds?: number } | null;
  private amdConfirming = false;   // true only during the confirmation window
  private amdHeardSpeech = false;  // true once ANY speech energy is heard during confirm
  private amdRunStartAt = 0;       // start (ms) of the current continuous speech run; 0 = in silence
  private amdLastSpeechAt = 0;     // ms timestamp of the last energetic frame during confirm
  private amdMaxContinuousMs = 0;  // longest continuous speech run observed during confirm
  // External AMD verdict from the async provider callback (VoBiz
  // machine_detection_url → /webhooks/vobiz/amd → onExternalAmdSignal). Read by
  // the confirmation loop: "human" resolves human immediately; "machine" lowers
  // the continuous-speech bar (still requiring acoustic corroboration) and
  // extends the window once. Null until a callback arrives.
  private amdExternalVerdict: "machine" | "human" | null = null;
  private amdExternalSource: string | null = null;
  // Single-resolution latch: set once confirmAmdMachineThenBranch() resolves its
  // verdict. Late/duplicate external callbacks after this are logged + ignored.
  private amdResolved = false;
  // Greeting LLM prewarm launched during the AMD confirmation window (outbound dead-air fix).
  private _greetingPrewarm: Promise<string> | null = null;

  // P1-D: Per-agent VAD / barge-in settings (set from agent config in constructor)
  private readonly vadSilenceMs: number;
  private readonly bargeInEnabled: boolean;
  private readonly bargeInEnergyThreshold: number;
  private readonly bargeInMinFrames: number;
  private readonly bargeInEchoGraceMs: number;
  // Mic Sensitivity — resolved gate ratio / VAD floor / barge-in defaults (mic-sensitivity.ts)
  private readonly micThresholds: MicSensitivityThresholds;
  // True when an explicit Stop Speaking Plan is configured. When set, the
  // plan-derived bargeInMinFrames is authoritative and the non-UI
  // wordsForInterruption×20 floor must NOT override the configured sensitivity.
  private readonly stopSpeakingPlanConfigured: boolean;

  // Sample rate actually fed to the STT adapter for this call — 8000 for
  // telephony (native PSTN rate, avoids the lossy linear-interpolation
  // upsample) or 16000 for webcall (native mic rate). See STTConfig.nativeSampleRate.
  private readonly sttSampleRate: 8000 | 16000;

  // Streaming STT (Deepgram live transcription)
  private streamSTT: StreamSTT | null = null;
  /** Queue of streaming STT final transcripts that arrived while a turn is still processing. */
  private pendingTranscriptQueue: Array<{ text: string; emittedAt: number; closeReason: TurnCloseReason }> = [];
  private streamSTTReconnectAttempts = 0;
  private streamSTTReconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Turn safety net — guards the "Listening…" hang (partials but no final, or no
  // usable transcript at all). See TurnSafetyNet in endpointing.ts.
  private safetyNet!: TurnSafetyNet;
  // Reason the current turn closed — read by the turn_latency log line.
  private _turnCloseReason: TurnCloseReason = "stt_final";
  /** True when this turn reused speculative/eager LLM prefill (Bolna Flux analogue). */
  private _eagerLlmHitThisTurn = false;

  // KB prefetch — fired on the first speech frame of a new utterance so the
  // result is ready by the time STT finishes and processTurn() starts.
  // Consumed (set to null) at the top of processTurn() to avoid stale reuse.
  private kbPrefetchPromise: Promise<KbRetrievalResult | null> | null = null;
  // Tracks whether we are currently inside an active speech segment for the
  // streaming STT path (where there is no audioBuffer to check against).
  private inSpeechSegment = false;

  // Metrics
  private firstAudioSentAt: number | null = null;
  // Carrier answer/bridge time (epoch ms) from the answer webhook, when known.
  // Used only for the once-per-call answer→first-audio gap diagnostic.
  private answeredAtMs: number | null = null;
  /** When the pipeline object was constructed (≈ session setup done). */
  private pipelineCreatedAtMs = 0;
  private answerGapLogged = false;
  // Count of filler phrases played due to slow LLM response (>800 ms to first token)
  private fillerPlayedCount = 0;
  // Recent backchannel/dead-air fillers — avoid repeating the last few phrases.
  private recentFillerPhrases: string[] = [];
  /** @deprecated use recentFillerPhrases — kept for any legacy log readers */
  private get lastFillerPhrase(): string | null {
    return this.recentFillerPhrases[this.recentFillerPhrases.length - 1] ?? null;
  }

  // ── Per-turn latency instrumentation (monotonic via performance.now()) ─────
  private turnIndex = 0;
  /** Mirror of the in-flight turn index, readable from non-turn-scoped methods
   *  (handleToolCall, playSentence) so their execution-log rows carry turnNumber. */
  private _activeTurnIndex = 0;
  private _tTurnVadFlush        = 0;   // when VAD silence window closed → audio sent to STT
  private _tTurnSttFinal        = 0;   // when STT returned the final transcript
  private _tTurnLlmFirstToken:  number | null = null; // first LLM token received
  private _tTurnLlmFirstClause: number | null = null; // first complete clause flushed to TTS queue
  private _tTurnTtsFirstByte:   number | null = null; // first TTS audio chunk from provider
  private _tTurnFirstAudioOut:  number | null = null; // first audio chunk written to onAudioOut
  // Adaptive endpoint: set by scheduleSilenceFlush(), captured+reset in processTurn()
  private _lastEndpointMs: number | null = null;
  private _lastEndpointReason = "";
  // Azure STT endpointing metadata — set in streaming callback, consumed in processTurn
  private _pendingSttMeta: { endDetectToFinalMs?: number; lastPartialToFinalMs?: number; detectedLang?: string } | null = null;
  /** STT-provider language code for the current in-flight transcript (forwarded to handleStreamingTranscript). */
  private _pendingSttLang: string | null = null;
  private _fillerPlayedThisTurn = false;
  /** Short English fragment held for merge with the next STT final. */
  private _fragmentCoalesce: { text: string; timer: ReturnType<typeof setTimeout> } | null = null;
  /** When set, skip dead-air filler jobs still in the play queue. */
  private _skipPendingFillerPlayback = false;
  private _deadAirFillerEnqueuedAt: number | null = null;
  // ── Language-confusion recovery (Task 4) ──────────────────────────────────
  // Counts consecutive turns where the filler guard held the current language
  // (caller spoke a short English phrase in a non-English conversation). When
  // this reaches ≥ 2 the LLM has likely been stuck in a "I'm speaking in Tamil
  // / do you want another language?" loop. The next turn injects a recovery
  // system note so the LLM resumes the call flow instead of re-starting it.
  private _consecutiveHeldFillerTurns = 0;
  private _recoveryNoteInjected = false;

  // Usage accumulators — updated on every LLM call and every TTS synthesis.
  // Exposed via getUsageTotals() so session.ts can pass real values to recordUsage().
  private llmInputTokensTotal = 0;
  private llmOutputTokensTotal = 0;
  private ttsCharactersTotal = 0;
  // True once any LLM adapter returned real token counts.  Stays false for
  // providers that don't expose usage (e.g. Sarvam) so session.ts can fall back
  // to its turn-count heuristic for LLM tokens while still using exact TTS chars.
  private hasRealLlmUsage = false;

  // Token Optimization — tracks savings from context trimming
  private baselineInputTokensEstimate = 0; // what full-history would have cost
  private currentStageIndex = 0;           // for staged prompt layer

  // Recording — stereo WAV of both sides (caller=L, agent=R). Gap threshold is
  // set in the constructor: webcall caller frames arrive every ~128 ms, above
  // the 120 ms telephony default (see WEBCALL_GAP_RESYNC_MS in recorder.ts).
  private recording: RecordingBuffer;

  private conversationHistory = new ConversationHistory();
  private closed = false;

  // ── Meeting speaker identification (Recall bot calls) ─────────────────────
  // Driven externally by services/meet-roster.ts via the public setters below.
  // All three degrade to no-ops on non-meeting calls (never set).
  private meetingRosterLine: string | null = null;
  private meetingSpeakerName: string | null = null;
  private pendingMeetingNotes: string[] = [];

  // ── Bolna-parity: conversation-quality metrics ────────────────────────────
  /** Total characters spoken by the agent across all turns (proxy for speak time). */
  private _agentSpeakCharsTotal = 0;
  /** Total characters received from caller across all turns (proxy for listen time). */
  private _callerSpeakCharsTotal = 0;
  /** Characters spoken by agent in the current turn (reset each turn). */
  private _agentSpeakCharsThisTurn = 0;
  /** Longest uninterrupted agent turn by character count (largest monologue). */
  private _longestAgentMonologueChars = 0;
  /** Number of barge-in events fired this call. */
  private _bargeInFiredCount = 0;
  /** Number of barge-ins that were fully recovered (agent completed its next reply). */
  private _bargeInRecoveryCount = 0;
  /** Whether the immediately-preceding agent turn was interrupted by a barge-in. */
  private _lastTurnWasBargedIn = false;
  /**
   * After the agent asks a question, short caller replies ("yes ma'am", "okay okay",
   * "go on") must never be swallowed by self-echo — they are the expected next turn.
   */
  private expectingShortReplyUntil = 0;

  /**
   * Set when the configured max-call-duration timer fires while the agent is
   * mid-playback. The active playTask loop finishes the CURRENT sentence, then
   * breaks BEFORE starting a new one (instead of the old hard `close()` that
   * clipped the agent mid-word). Bounded by a grace cap in the caller, so the
   * call can never run drastically past its configured limit.
   */
  private endAfterCurrentSentence = false;

  // Reschedule context — set when list_bookings returns exactly one booking,
  // cleared when reschedule_confirmed or cancel_confirmed is received.
  private activeRescheduleBooking: { bookingId: number; isoDate: string; timeLabel: string; eventName: string } | null = null;
  // All bookings returned by the most recent list_bookings call (used to infer
  // which booking the caller selected when count > 1 and reschedule/cancel fires).
  private pendingListedBookings: Array<{ bookingId: number; isoDate: string; timeLabel: string; eventName: string }> = [];

  // Ambient noise
  private ambientStream: AmbientNoiseStream | FileAmbientNoiseStream | null = null;
  private ambientInterval: ReturnType<typeof setInterval> | null = null;
  private ambientFirstChunkLogged = false;

  // IVR / DTMF
  private dtmfDetector: DtmfDetector | null = null;
  private dtmfResolver: ((digit: string | null) => void) | null = null;
  private dtmfTimeoutId: ReturnType<typeof setTimeout> | null = null;

  // Gender detection — fires once per call using early caller speech
  private genderDetector: GenderDetector | GenderDetectorML | GenderDetectorMLv2 | GenderDetectorChained;
  /** Explicit mid-call caller correction ("call me sir, not ma'am"). When set it
   *  overrides the detected gender for the rest of the call and is itself sticky —
   *  only another explicit correction can change it. */
  private salutationCorrection: "male" | "female" | null = null;
  /** True only when the agent's system prompt actually contains {caller_salutation}.
   *  When false we never instantiate a detector or call the gender service. */
  private readonly genderSalutationInPrompt: boolean = false;
  /** Detection is "armed" only after the agent greeting has been delivered, so the
   *  detector samples the caller's INTRODUCTION turn — not the greeting echo or any
   *  stray pre-greeting audio. Until armed, caller audio is not fed to the detector. */
  private genderDetectionArmed = false;

  /** Voice Memory (opt-in) — mid-call handoff + cross-number voice linking. */
  private speakerVerifier: SpeakerVerifier | null = null;
  private pendingSpeakerChallenge = false;
  /** True after we forced a spoken handoff challenge for the current handoff. */
  private speakerChallengeSpoken = false;
  private speakingSpeakerHandoffChallenge = false;
  /** While true, suppress in-flight LLM TTS so the forced handoff ask can take the floor. */
  private skipAgentPlaybackForHandoff = false;
  /**
   * True while playing system lines (stall “can't hear”, silence check-in, inactivity
   * farewell, forced Voice Memory challenge). Word-count interim barge must NOT cut
   * these — only semantic stop-words / clear caller speech cancel (call 2626 cascade).
   */
  private systemPlaybackActive = false;
  /** Last time we observed caller speech energy or a non-empty STT partial/final. */
  private lastCallerActivityAt = 0;
  private voiceHandoffActive = false;
  private voiceLinkedFromPhone: string | null = null;
  private pendingVoiceLinkNote = false;
  /** One-shot: proactively acknowledge the recognized caller on the first turn
   *  after voice-matched memory is injected. */
  private pendingVoiceLinkAck = false;
  /**
   * Compact caller-memory block loaded from the phone number the caller's
   * VOICE matched (they are calling from a new number). Injected into the
   * volatile per-turn tail every turn so the agent can serve them with their
   * existing history. Cleared on speaker handoff.
   */
  private voiceLinkedMemoryBlock: string | null = null;
  /**
   * Call-screening bot state (outbound only). "idle" → screener detected &
   * answered → "responded" → real human picks up → "done" (one-shot restart
   * note injected). See callScreening.ts.
   */
  private screeningState: "idle" | "responded" | "done" = "idle";
  private readonly screeningWindowStart = Date.now();
  private pendingScreeningPickupNote = false;
  /** Caller said they cannot hear the agent — next LLM turn must resume, not ask கேக்குதா. */
  private pendingAudioDifficultyNote = false;
  /** Caller asked to clarify the last topic (often mid-cut STT like "about the Kala Fit"). */
  private pendingTopicClarificationNote = false;

  // Tracks the current call language for per-turn LLM language injection.
  // Seeded from the agent's primary language at construction so turn 1 already
  // has a baseline. Updated each turn via script detection when languageAutoDetect=true.
  private currentLang: string = "";
  // When the caller switches language mid-call, capture {from, to} here so
  // processTurn() can annotate the user's history entry with a note that the
  // transcript was captured while ASR was still locked to the old language.
  // Consumed (set to null) at the conversationHistory push in processTurn().
  private _langSwitchThisTurn: { from: string; to: string } | null = null;
  /** Last non-English language the caller spoke this call.
   *  We save THIS (not currentLang) as the caller's preferredLanguage so that
   *  an English "thanks, bye" at call-end doesn't overwrite their regional
   *  language preference. Falls back to currentLang only if the caller spoke
   *  nothing but English the whole call. */
  private lastNonEnglishLang: string = "";
  /** Consecutive-detection guard for passive STT language switching.
   *  We only call switchStreamSTTLanguage once the SAME non-English language
   *  is detected in 2 consecutive transcripts, preventing a single stray
   *  Telugu/Hindi glyph in a Sarvam en-IN transcript from switching the STT
   *  socket away from the correct language. */
  private _pendingSttSwitchLang: string = "";
  private _pendingSttSwitchCount: number = 0;
  /** Sticky language the caller EXPLICITLY requested (e.g. "speak in English").
   *  Once set it overrides per-turn script auto-detection so a single Indic-script
   *  utterance can't silently drag the agent back to its default language; only
   *  another explicit request changes it. null = follow script auto-detection. */
  private requestedLangLatch: string | null = null;
  /** Language the live streaming-STT session was last switched to via an
   *  explicit caller request (loop guard for switchStreamSTTLanguage). */
  private streamSTTLang: string | null = null;
  /** Language last applied to TTS via setLanguage (Cartesia/Sarvam). Prevents
   *  reconnect-loop spam and keeps TTS in sync with currentLang mid-call. */
  private ttsLang: string | null = null;
  /** Consecutive-detection guard for mid-call language flips (same idea as STT).
   *  A single stray STT language_code / script mis-detect must not thrash TTS
   *  (calls 4852/4853: ta↔hi↔bn within one call). Explicit latch bypasses this. */
  private _pendingLangConfirm: string = "";
  private _pendingLangConfirmCount: number = 0;

  // Repetition guard (call 548): the last spoken assistant line + how many times
  // in a row the model has repeated itself. Used by the per-turn anti-repeat nudge
  // to quote the previous line and forbid a verbatim repeat, escalating if stuck.
  private lastAssistantSpokenRaw = "";
  private consecutiveRepeats = 0;
  // Interruption hint (inspired by Bolna): tracks sentences fully played this agent turn.
  // On barge-in these are captured into _interruptionHint; injected into the next
  // processTurn()'s historyForLlm so the LLM knows what the caller already heard and
  // can continue naturally without repeating already-delivered content.
  private _currentTurnPlayedSentences: string[] = [];
  private _interruptionHint: string | null = null;
  /** Text of the sentence currently draining via playJob — used when barge-in cuts mid-sentence. */
  private _activePlaybackText: string | null = null;
  /** Wall-clock when current sentence drain started — for mid-sentence heard estimate. */
  private _activePlaybackStartedAt: number | null = null;
  // ── Speculative / eager LLM prefill state ────────────────────────────────
  // Populated by _launchSpeculativeLlm() at semantic barge-in; consumed (or
  // aborted) in processTurn() before the LLM retry loop runs.
  private _specLlmState: {
    partial: string;
    /** `this.currentLang` snapshot at launch. If the final transcript triggers
     *  a language switch, the prefill's langGuard is stale (built for the old
     *  language) and replaying it answers the caller in the WRONG language
     *  (call 4814: Tamil caller got an English reply on turn 1). */
    langAtLaunch: string;
    storedTokens: string[];
    storedFullText: string;
    storedUsage?: LLMUsage;
    storedToolCall?: { name: string; args: Record<string, unknown> };
    done: boolean;
    aborted: boolean;
    /** Reassign to redirect ongoing stream tokens to the real onToken. */
    tokenSink: (t: string) => void;
    completedPromise: Promise<void>;
  } | null = null;
  /** Bolna-parity interruption manager (sequence ids + grace gating). */
  private interruptionMgr: InterruptionManager;
  /** Sequence id for the in-flight agent reply turn. */
  private activeAgentSequenceId = 0;
  /** Active TTS fetch abort controllers — aborted on barge-in teardown. */
  private readonly activeTtsAborts = new Set<AbortController>();
  /** Eager LLM: last partial text + stability timer (Flux EagerEndOfTurn analogue). */
  private eagerPartialText = "";
  private eagerPartialTimer: ReturnType<typeof setTimeout> | null = null;
  /** Normalize a reply for repeat comparison: lowercase, strip terminal
   *  punctuation (incl. Devanagari danda), collapse whitespace. */
  private normalizeForRepeat = (s: string): string =>
    s.toLowerCase().replace(/[.,!?;:।…]/g, "").replace(/\s+/g, " ").trim();

  /** Update the repetition guard after the agent speaks. A verbatim (normalized)
   *  match against the previous reply increments consecutiveRepeats so the next
   *  turn's nudge escalates; anything new resets it. Always records the raw line. */
  private trackRepeat(spoken: string): void {
    const norm     = this.normalizeForRepeat(spoken);
    const prevNorm = this.normalizeForRepeat(this.lastAssistantSpokenRaw);
    if (norm && norm === prevNorm) {
      this.consecutiveRepeats++;
      logger.warn(
        { callId: this.config.callId, consecutiveRepeats: this.consecutiveRepeats, line: spoken.slice(0, 80) },
        "Pipeline: agent repeated its previous reply verbatim — escalating anti-repeat nudge",
      );
    } else {
      this.consecutiveRepeats = 0;
    }
    this.lastAssistantSpokenRaw = spoken;
  }

  /**
   * Heard agent text for history / barge.
   * With includeActiveEstimate, append ms-based prefix of the in-flight sentence
   * (Bolna mark-accurate analogue without telco marks).
   */
  private getHeardAgentText(opts?: { includeActiveEstimate?: boolean }): string {
    const completed = joinHeardSentences(this._currentTurnPlayedSentences);
    if (!opts?.includeActiveEstimate) return completed;
    const mid = this._activePlaybackText?.trim();
    if (!mid || this._activePlaybackStartedAt == null) return completed;
    const elapsed = Date.now() - this._activePlaybackStartedAt;
    const prefix = estimateHeardPrefix(mid, elapsed);
    return composeHeardWithMid(completed, prefix);
  }

  /** Called at every barge-in fire point. Hint = completed + estimated mid prefix. */
  private captureInterruptionHint(): void {
    if (this._interruptionHint) return; // already captured (multiple simultaneous events)
    const played = this.getHeardAgentText({ includeActiveEstimate: true });
    const wasMidSentence = Boolean(this._activePlaybackText?.trim());
    this._interruptionHint = buildInterruptionHint(played, wasMidSentence);
  }

  /**
   * After barge: keep history aligned with heard-only agent text (incl. mid estimate).
   * Tool-call assistant rows keep toolCalls and only replace spoken content.
   */
  private trimHistoryToHeardOnBarge(): void {
    const heard = this.getHeardAgentText({ includeActiveEstimate: true });
    const msgs = this.conversationHistory.messages;
    let lastUserIdx = -1;
    let lastAsstIdx = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (lastUserIdx === -1 && msgs[i]!.role === "user") lastUserIdx = i;
      if (lastAsstIdx === -1 && msgs[i]!.role === "assistant") lastAsstIdx = i;
      if (lastUserIdx !== -1 && lastAsstIdx !== -1) break;
    }
    if (lastAsstIdx < 0) return;
    // Assistant for this turn is after the latest user, OR greeting (no user yet).
    if (lastUserIdx >= 0 && lastAsstIdx < lastUserIdx) return;

    const lastAsst = msgs[lastAsstIdx]!;
    if (lastAsst.toolCalls?.length) {
      // Preserve tool_calls scaffold; only rewrite spoken content (may be empty).
      this.conversationHistory.replaceLastAssistant(heard);
      if (heard) this.lastAssistantSpokenRaw = heard;
      return;
    }
    if (heard) {
      this.conversationHistory.replaceLastAssistant(heard);
      this.lastAssistantSpokenRaw = heard;
    } else {
      this.conversationHistory.popUnheardResponses(1);
    }
  }

  /**
   * Clear sticky barge-in / interruption WAIT so system lines (stall reprompt,
   * silence check-in, inactivity farewell) can actually emit audio. Without this,
   * a prior barge-in with no follow-up processTurn leaves bargeInRequested=true
   * and playJob no-ops → audioBytes:0 / audio_gated → silent hangup.
   */
  private prepareSystemPlayback(): void {
    this.bargeInRequested = false;
    this.skipAgentPlaybackForHandoff = false;
    this.bargeInSpeechFrames = 0;
    this.streamingBargeInWordCount = 0;
    this.interruptionMgr.onUserSpeechEnd();
    this.systemPlaybackActive = true;
  }

  /**
   * Soft-cancel system TTS when the caller starts speaking over “can't hear” /
   * check-in / VM challenge — without sticky bargeInRequested (which audio_gates
   * the next LLM turn).
   */
  private cancelSystemPlaybackForCallerSpeech(partial?: string): void {
    if (!this.systemPlaybackActive) return;
    this.systemPlaybackActive = false;
    for (const ac of this.activeTtsAborts) {
      try { ac.abort(); } catch { /* noop */ }
    }
    this.activeTtsAborts.clear();
    this.bargeInCallback?.();
    this.isPlaying = false;
    this.streamingBargeInWordCount = 0;
    this.lastCallerActivityAt = Date.now();
    logger.info(
      { callId: this.config.callId, partial: partial?.slice(0, 80) ?? null },
      "Cancelled system TTS — caller speech detected (Bolna-style)",
    );
  }

  private clearFragmentCoalesce(): void {
    if (this._fragmentCoalesce) {
      clearTimeout(this._fragmentCoalesce.timer);
      this._fragmentCoalesce = null;
    }
  }

  private fragmentCoalesceHoldMs(): number {
    return (this.isPlaying || this.isSendingTtsAudio)
      ? (this.agent.fragmentCoalescePlayingMs ?? FRAGMENT_COALESCE_MS_DEFAULT)
      : (this.agent.fragmentCoalesceListeningMs ?? FRAGMENT_COALESCE_LISTENING_MS_DEFAULT);
  }

  /** Hold / re-arm a short STT fragment so a follow-up final can merge. */
  private armFragmentCoalesce(text: string, holdMs?: number): void {
    const ms = holdMs ?? this.fragmentCoalesceHoldMs();
    if (ms <= 0) return;
    if (this._fragmentCoalesce) clearTimeout(this._fragmentCoalesce.timer);
    this._fragmentCoalesce = {
      text,
      timer: setTimeout(() => this.flushFragmentCoalesce(), ms),
    };
  }

  private flushFragmentCoalesce(): void {
    const pending = this._fragmentCoalesce?.text;
    this._fragmentCoalesce = null;
    if (!pending || this.closed) return;
    // Call 4856: coalesce timer fired between "Yes Ma'am" and "how are you?" —
    // caller VAD had already restarted. Defer until speech_end.
    if (this.interruptionMgr.isCalleeSpeaking()) {
      logger.info(
        { callId: this.config.callId, fragment: pending.slice(0, 80) },
        "STT fragment coalesce deferred — caller still speaking",
      );
      this.armFragmentCoalesce(pending);
      return;
    }
    if (
      (this.isPlaying || this.isSendingTtsAudio)
      && isBackchannelOnlyUtterance(pending)
    ) {
      this.logDiscardedTranscript(pending, "backchannel_during_playback");
      logger.info(
        { callId: this.config.callId, fragment: pending.slice(0, 80) },
        "Held ack fragment dropped — agent speaking at coalesce-timer fire",
      );
      return;
    }
    void this.handleStreamingTranscript(pending, Date.now(), "coalesced_fragment");
  }

  private isEnglishStrictAckMode(): boolean {
    return this.requestedLangLatch === "en-IN" || this.requestedLangLatch === "en-US";
  }

  private backchannelFillerOpts(callerTranscript?: string | null): BackchannelFillerOptions {
    const lastUserTurn = [...this.conversationHistory.messages].reverse().find((t) => t.role === "user");
    return {
      englishStrictAck: this.isEnglishStrictAckMode(),
      callerTranscript: callerTranscript || lastUserTurn?.content || null,
    };
  }

  /** Skip dead-air filler still in the play queue when LLM responds immediately after. */
  private onLlmFirstTokenReceived(): void {
    if (
      this._deadAirFillerEnqueuedAt !== null
      && Date.now() - this._deadAirFillerEnqueuedAt < DEAD_AIR_FILLER_CANCEL_MS
    ) {
      this._skipPendingFillerPlayback = true;
      for (const ac of this.activeTtsAborts) {
        try { ac.abort(); } catch { /* noop */ }
      }
      this.activeTtsAborts.clear();
      logger.info(
        { callId: this.config.callId, msSinceFiller: Date.now() - this._deadAirFillerEnqueuedAt },
        "Dead-air filler skipped — LLM first token arrived within cancel window",
      );
    }
    this._deadAirFillerEnqueuedAt = null;
  }

  /**
   * Bolna-style natural barge teardown:
   * 1) invalidate sequence + set barge flag (drain loops stop)
   * 2) telephony clearAudio FIRST (sharp mute)
   * 3) abort TTS / LLM / eager
   * 4) heard-only hint + history trim
   * 5) optional speculative LLM on caller partial
   */
  private triggerBargeIn(
    trigger: string,
    partial?: string,
    opts?: { speculative?: boolean; energyDetails?: Record<string, unknown> },
  ): void {
    if (this.bargeInRequested) return;
    const invalidatedSeq = this.interruptionMgr.invalidateCurrentTurn();
    this.bargeInRequested = true;
    this._bargeInFiredCount++;
    this._lastTurnWasBargedIn = true;
    // Sharp mute before abort teardown — clear carrier buffer ASAP.
    this.bargeInCallback?.();
    for (const ac of this.activeTtsAborts) {
      try { ac.abort(); } catch { /* noop */ }
    }
    this.activeTtsAborts.clear();
    this.llm.cancelInFlight?.();
    if (this._specLlmState) {
      this._specLlmState.aborted = true;
      this._specLlmState = null;
    }
    this.clearEagerPartialTimer();
    this.captureInterruptionHint();
    const heard = this.getHeardAgentText({ includeActiveEstimate: true });
    this.trimHistoryToHeardOnBarge();
    if (opts?.speculative !== false && partial?.trim()) {
      this._launchSpeculativeLlm(partial);
    }
    this.logExec("Agent", "system", {
      status: "info",
      turnNumber: this._activeTurnIndex,
      warningFlags: ["barge_in"],
      metadata: {
        event: "Barge-in Detected",
        trigger,
        sequenceInvalidated: invalidatedSeq,
        heardPreview: heard.slice(0, 80) || null,
        transcriptPreview: partial?.slice(0, 80) ?? null,
        ...opts?.energyDetails,
      },
    });
  }

  private clearEagerPartialTimer(): void {
    if (this.eagerPartialTimer) {
      clearTimeout(this.eagerPartialTimer);
      this.eagerPartialTimer = null;
    }
    this.eagerPartialText = "";
  }

  /** Schedule eager LLM when a partial stabilizes (Bolna Flux EagerEndOfTurn analogue). */
  private scheduleEagerLlm(partial: string): void {
    if (this.isPlaying || this.isSendingTtsAudio || this.closed || this.isProcessing) return;
    if (this._specLlmState) return;
    // Turn 1 allowed: the greeting response is the most latency-sensitive turn.
    // Speculative output is validated against the final transcript before use.
    this.eagerPartialText = partial;
    if (this.eagerPartialTimer) clearTimeout(this.eagerPartialTimer);
    this.eagerPartialTimer = setTimeout(() => {
      this.eagerPartialTimer = null;
      if (this.eagerPartialText !== partial) return;
      if (!isEagerCommitReady(partial)) return;
      if (this.isPlaying || this.isProcessing || this.closed || this._specLlmState) return;
      this.launchEagerLlmFromPartial(partial, "stable_partial");
    }, EAGER_PARTIAL_STABLE_MS);
  }

  /** Sarvam VAD speech_end — launch speculative LLM before coalesced final arrives. */
  private handleSttSpeechEnd(): void {
    if (this.closed || this.isPlaying || this.isSendingTtsAudio || this.isProcessing) return;
    if (this._specLlmState) return;
    // Turn 1 allowed (see scheduleEagerLlm).
    const text = this.streamSTT?.getPendingTranscript?.()?.trim() ?? this.eagerPartialText.trim();
    if (!text) return;
    this.clearEagerPartialTimer();
    if (!isEagerCommitReady(text, { speechEnd: true })) return;
    this.launchEagerLlmFromPartial(text, "speech_end");
  }

  /** Bolna TurnResumed analogue — caller resumed before final; discard speculative work. */
  private handleSttSpeechResumed(): void {
    if (this.isPlaying || this.bargeInRequested) return;
    this.clearEagerPartialTimer();
    // Still holding an ack fragment — caller kept talking; extend the merge window
    // so we don't flush "Yes Ma'am" before "how are you?" (call 4856 zigzag).
    if (this._fragmentCoalesce) {
      const held = this._fragmentCoalesce.text;
      this.armFragmentCoalesce(held);
      logger.info(
        { callId: this.config.callId, fragment: held.slice(0, 80) },
        "STT fragment coalesce extended — caller resumed speaking",
      );
      return;
    }
    if (this._specLlmState && !this.isProcessing) {
      this._specLlmState.aborted = true;
      this._specLlmState = null;
      this.logExec("LLM", "system", {
        status: "info",
        turnNumber: this._activeTurnIndex,
        metadata: { event: "Eager LLM Cancelled", reason: "speech_resumed" },
      });
      logger.info({ callId: this.config.callId }, "Eager LLM cancelled — caller resumed speaking");
    }
  }

  private maybeLaunchEagerOnPartial(text: string, metadata?: SttFinalMetadata): void {
    if (!text.trim() || this.isPlaying || this.isProcessing || this.closed || this._specLlmState) return;
    if (!this.conversationHistory.some((t) => t.role === "assistant")) return;
    const speechEnd = metadata?.speechEndReceived === true;
    if (speechEnd && isEagerCommitReady(text, { speechEnd: true })) {
      this.clearEagerPartialTimer();
      this.launchEagerLlmFromPartial(text, "speech_end_partial");
      return;
    }
    this.scheduleEagerLlm(text);
  }

  private launchEagerLlmFromPartial(partial: string, source: string): void {
    if (this._specLlmState || this.closed || this.isProcessing) return;
    this._launchSpeculativeLlm(partial);
    this.logExec("LLM", "system", {
      status: "info",
      turnNumber: this._activeTurnIndex,
      metadata: {
        event: "Eager LLM Launched",
        source,
        partial: partial.slice(0, 80),
        stableMs: source === "stable_partial" ? EAGER_PARTIAL_STABLE_MS : 0,
      },
    });
    logger.info(
      { callId: this.config.callId, source, partial: partial.slice(0, 80) },
      "Eager LLM prefill launched",
    );
  }

  private wireStreamSttCallbacks(): void {
    if (!this.streamSTT) return;
    this.streamSTT.onSpeechEnd = () => {
      // Timing instrumentation: records when the STT provider's server-side VAD
      // declared end-of-speech, so exec logs expose the caller-silence→VAD gap.
      this.clearVadFlushBackstop();
      this.logExec("STT", "system", {
        status: "info",
        turnNumber: this._activeTurnIndex,
        metadata: { event: "VAD Speech End" },
      });
      this.handleSttSpeechEnd();
    };
    this.streamSTT.onSpeechStart = () => {
      this.logExec("STT", "system", {
        status: "info",
        turnNumber: this._activeTurnIndex,
        metadata: { event: "VAD Speech Start" },
      });
      this.armVadFlushBackstop();
      // Carrier echo of our own TTS often trips Sarvam VAD. Marking calleeSpeaking
      // during agent playback with no transcript evidence gates outbound audio
      // (WAIT) and aborts drain mid-sentence with a fake "Playback Completed"
      // (calls 4852/4853). Real barge-in still works via energy + streaming STT
      // word evidence; once words arrive we mark speaking normally.
      const agentAudioLive = this.isPlaying || this.isSendingTtsAudio;
      if (!(agentAudioLive && this.streamingBargeInWordCount === 0)) {
        this.interruptionMgr.onUserSpeechStart();
      }
      this.handleSttSpeechResumed();
    };
  }

  // ── Lost-turn backstop (calls 4831/4833) ────────────────────────────────────
  // Sarvam occasionally emits VAD speech_start but then NO interim, NO final and
  // NO speech_end — the caller's utterance is silently lost until the 10s stall
  // reprompt. Backstop: if nothing arrives within VAD_FLUSH_BACKSTOP_MS of
  // speech_start, send ONE flush() to force Sarvam to finalize its buffer.
  //
  // This deliberately narrows the adapter's "pipeline never calls flush()"
  // invariant (calls-772→1320 regression class = flush racing Sarvam's VAD on
  // NORMAL turns). Here flush fires only when Sarvam has been silent for 2s+
  // after its own speech_start — i.e. only in the anomaly, never racing a live
  // turn — and is rate-limited to one shot per VAD_FLUSH_COOLDOWN_MS.
  private clearVadFlushBackstop(): void {
    if (this._vadFlushTimer) {
      clearTimeout(this._vadFlushTimer);
      this._vadFlushTimer = null;
    }
  }

  private armVadFlushBackstop(): void {
    this.clearVadFlushBackstop();
    if (this.closed) return;
    this._vadFlushTimer = setTimeout(() => {
      this._vadFlushTimer = null;
      if (this.closed || this.isProcessing || this.isPlaying || this.isSendingTtsAudio) return;
      const now = Date.now();
      if (now - this._lastVadFlushAt < VAD_FLUSH_COOLDOWN_MS) return;
      if (!this.streamSTT?.flush) return;
      this._lastVadFlushAt = now;
      logger.warn(
        { callId: this.config.callId },
        "Lost-turn backstop: VAD speech_start with no interim/final/speech_end — forcing STT flush",
      );
      this.logExec("STT", "system", {
        status: "info",
        turnNumber: this._activeTurnIndex,
        warningFlags: ["lost_turn_force_flush"],
        metadata: { event: "Lost-Turn Force Flush", holdMs: VAD_FLUSH_BACKSTOP_MS },
      });
      try {
        this.streamSTT.flush();
      } catch (err) {
        logger.warn({ callId: this.config.callId, err }, "Lost-turn backstop flush failed");
      }
    }, VAD_FLUSH_BACKSTOP_MS);
  }

  /** Poll until post-utterance WAIT clears or timeout (Bolna incremental_delay grace). */
  private async waitForAudioEmit(sequenceId: number, maxMs = 1200): Promise<boolean> {
    const deadline = Date.now() + maxMs;
    while (!this.closed && !this.bargeInRequested) {
      if (this.canEmitAudio(sequenceId)) return true;
      if (Date.now() >= deadline) return false;
      await new Promise<void>((r) => setTimeout(r, 25));
    }
    return false;
  }

  private canEmitAudio(sequenceId: number): boolean {
    const status = this.interruptionMgr.getAudioSendStatus(
      sequenceId,
      this.conversationHistory.length,
    );
    return status === "SEND" && this.interruptionMgr.isValidSequence(sequenceId);
  }

  /** Track telemetry mark ACKs from telephony carriers for frame-level barge-in alignment. */
  onAudioMarkAck(markName: string): void {
    logger.debug(
      { callId: this.config.callId, markName },
      "Telephony carrier audio mark ACK received",
    );
  }

  /**
   * Launch a speculative / eager LLM call using the barge-in partial text.
   * Tokens are buffered into `_specLlmState.storedTokens` (via a redirectable
   * `tokenSink`).  processTurn() checks the state before its own llm.chat
   * call: if the final transcript is a "hit", it drains the buffer and
   * redirects the live stream; on a miss it aborts and runs normally.
   *
   * Fires only on SEMANTIC barge-in triggers — those carry meaningful partial
   * text.  Skipped on energy / word-count triggers (no reliable text) and on
   * the first agent turn (no conversation history yet).
   */
  private _launchSpeculativeLlm(partialText: string): void {
    // Only one speculative call per turn; don't start if session is closing.
    if (this._specLlmState || this.closed) return;
    // Need at least one prior assistant turn so the history has context.
    if (!this.conversationHistory.some(t => t.role === "assistant")) return;

    const history: ConversationTurn[] = [
      ...this.conversationHistory.messages,
      { role: "user", content: partialText },
    ];
    // Use the same stable base as the Gemini context-cache warm: langGuard +
    // systemPrompt + langGuard + salutation substitution.  No per-turn KB or
    // datetime — close enough for short semantic replies and avoids the extra
    // processTurn assembly work at this (pre-final) point.
    const systemPrompt = this.buildCacheBase(this.effectiveGender());

    let resolveCompletion!: () => void;
    const completedPromise = new Promise<void>(r => { resolveCompletion = r; });

    const state = {
      partial: partialText,
      langAtLaunch: this.currentLang,
      storedTokens: [] as string[],
      storedFullText: "",
      storedUsage: undefined as LLMUsage | undefined,
      storedToolCall: undefined as { name: string; args: Record<string, unknown> } | undefined,
      done: false,
      aborted: false,
      tokenSink: (t: string) => state.storedTokens.push(t),
      completedPromise,
    };

    const run = async () => {
      try {
        await this.llm.chat(
          history,
          systemPrompt,
          (t) => { if (!state.aborted) state.tokenSink(t); },
          (ft, u) => {
            if (!state.aborted) {
              state.storedFullText = ft;
              if (u) state.storedUsage = u;
            }
            state.done = true;
            resolveCompletion();
          },
          {
            onToolCall: (name, args) => {
              if (!state.aborted) state.storedToolCall = { name, args };
              // Tool-call turns also complete the stream.
              state.done = true;
              resolveCompletion();
            },
            onUsage: (u) => { if (!state.aborted) state.storedUsage = u; },
            // Prevent stateful adapters (e.g. OpenAI Responses API) from
            // advancing their previousResponseId on a speculative call.
            // A spec miss must not corrupt the real turn's conversation context.
            speculative: true,
          },
        );
      } catch {
        // Swallow errors — the real processTurn will retry normally on a miss.
        resolveCompletion();
      }
    };
    void run();
    this._specLlmState = state;
    logger.info(
      { callId: this.config.callId, partial: partialText.slice(0, 80) },
      "Speculative LLM prefill launched",
    );
  }

  /** Record a line the agent is about to synthesize so the streaming-STT path can
   *  recognize its own words echoing back via the carrier. Prunes entries whose
   *  echo window has fully closed so stale agent speech can't suppress later
   *  legitimate caller input. */
  private recordAgentSpeech(text: string): void {
    const norm = this.normalizeForRepeat(text);
    if (!norm) return;
    const tokens = new Set(norm.split(" ").filter(Boolean));
    if (tokens.size === 0) return;
    const now = Date.now();
    const estEndAt = now + Math.round(text.length * 70); // ~70 ms/char (Indic + Latin)
    this.recentAgentSpeech = this.recentAgentSpeech.filter(
      (e) => now <= e.estEndAt + SELF_ECHO_TAIL_MS,
    );
    this.recentAgentSpeech.push({ tokens, estEndAt });
    // Hard cap so a very long call can't grow this unbounded.
    if (this.recentAgentSpeech.length > 12) {
      this.recentAgentSpeech = this.recentAgentSpeech.slice(-12);
    }
    // Agent just asked something — next 8s of short replies are presumed real.
    if (/[?？]\s*$/.test(text.trim())) {
      this.expectingShortReplyUntil = Math.max(
        this.expectingShortReplyUntil,
        estEndAt + 8_000,
      );
    }
  }

  /** True when a streaming-STT transcript closely matches text the agent recently
   *  spoke AND arrived within a plausible carrier-echo window of it — i.e. it is
   *  the agent's own audio returning, not the caller. Tolerant of STT noise via
   *  token overlap (not exact match). Conservative by design: requires high overlap
   *  so a caller genuinely repeating a word or two is NOT suppressed, and only
   *  matches inside the echo window so the same words later count as real input. */
  private isSelfEcho(transcript: string): boolean {
    if (this.recentAgentSpeech.length === 0) return false;
    const norm = this.normalizeForRepeat(transcript);
    if (!norm) return false;
    const tokens = norm.split(" ").filter(Boolean);
    if (tokens.length === 0) return false;
    // Genuine short replies ("yes", "okay okay", "yes madam", …) must never be
    // discarded as echo of the agent saying "okay?" / "right?" at turn end —
    // that bug ate "yes I have two minutes" style answers and looked like the
    // caller hung up when the call actually stalled listening.
    if (tokens.length === 1 && AFFIRMATIONS.has(tokens[0]!)) return false;
    if (isAffirmationOnlyUtterance(tokens)) return false;
    if (Date.now() < this.expectingShortReplyUntil && tokens.length <= 8) {
      // Agent just asked a question — prefer accepting short replies over
      // echo-suppression (carrier echo of our own "?" rarely becomes a multi-word
      // affirmation). Exact long overlaps still get suppressed below.
      if (tokens.length <= 4) return false;
    }
    const now = Date.now();
    for (const entry of this.recentAgentSpeech) {
      if (now > entry.estEndAt + SELF_ECHO_TAIL_MS) continue;
      let matched = 0;
      for (const t of tokens) if (entry.tokens.has(t)) matched++;
      // For very short transcripts (1-2 tokens) a ratio alone is too easy to
      // saturate by chance overlap with common words — additionally require at
      // least 2 matched tokens UNLESS the transcript itself has only 1 token, in
      // which case require an exact single-token match against the agent's LAST
      // spoken word (true echo bleeds in at the tail of our own audio, not from
      // the middle of the sentence).
      if (tokens.length <= 2) {
        if (tokens.length === 1) {
          const lastToken = entry.tokens.size > 0 ? [...entry.tokens].at(-1) : undefined;
          if (lastToken !== tokens[0]) continue;
        } else if (matched < 2) {
          continue;
        }
      }
      if (matched / tokens.length >= SELF_ECHO_MIN_OVERLAP) return true;
    }
    return false;
  }

  /**
   * Call-log visibility for echo-guard discards (call 2039): whenever a final
   * transcript is thrown away by the tail-echo window or the content self-echo
   * guard, write a warning row to the call execution log (component STT) with
   * the discarded text, the guard that fired, and timing context — so a lost
   * caller word is diagnosable from the dashboard Logs tab alone. Purely
   * additive telemetry; fire-and-forget, never affects call flow.
   */
  private logDiscardedTranscript(
    transcript: string,
    guard:
      | "tail_echo_guard"
      | "self_echo_content_guard"
      | "ultra_short_fragment"
      | "false_interruption_scrap"
      | "transfer_in_progress"
      | "fragment_coalesce_hold"
      | "backchannel_during_playback",
  ): void {
    const now = Date.now();
    const reasonByGuard: Record<typeof guard, string> = {
      tail_echo_guard: "post-playback tail-echo window (content matched agent speech)",
      self_echo_content_guard: "content matched agent's own recent speech (self-echo)",
      ultra_short_fragment: "ultra-short STT noise stub — waiting for more speech",
      false_interruption_scrap: "post-barge scrap under interrupt-word threshold",
      transfer_in_progress: "transfer already in progress",
      fragment_coalesce_hold: "short fragment held briefly for coalesce (not a drop)",
      backchannel_during_playback: "held ack fragment dropped — agent speaking at coalesce-timer fire (true backchannel)",
    };
    this.logExec(EXEC_COMPONENTS.STT, "system", {
      status: "info",
      provider: this.agent.asrProvider,
      turnNumber: this._activeTurnIndex,
      warningFlags: guard === "fragment_coalesce_hold" ? ["transcript_held"] : ["transcript_discarded"],
      metadata: {
        event: guard === "fragment_coalesce_hold" ? "Transcript Held" : "Transcript Discarded",
        reason: reasonByGuard[guard],
        guard,
        discardedText: transcript.slice(0, 300),
        isPlaying: this.isPlaying,
        msLeftInEchoWindow: Math.max(0, this.bargeInHoldUntil - now),
      },
    });
  }

  // The Krutrim auto-summary entry (kb-source-summary.ts) is generated
  // per-SOURCE, but a source can be attached to multiple agents across
  // providers. Exclude it from every non-Krutrim agent's per-turn KB
  // retrieval so their behavior is completely unchanged.
  private krutrimSummaryExcludeTitles(): string[] | undefined {
    return this.agent.llmProvider?.toLowerCase() === "krutrim" ? undefined : [KRUTRIM_AUTO_SUMMARY_TITLE];
  }

  constructor(config: SessionConfig) {
    this.config = config;
    this.callDirection = config.callDirection ?? "inbound";
    this.isResumeDroppedCall = config.isResumeDroppedCall === true;
    this.agent = config.agentConfig;
    this.recording = new RecordingBuffer(
      8000,
      config.telephonyProvider === "webcall" ? WEBCALL_GAP_RESYNC_MS : undefined,
    );
    // Anchor the recording clock to the carrier answer time (when known) so the
    // gap between carrier answer and the first media frame is padded as leading
    // silence — the recording then lines up with what the caller heard live.
    if (config.answeredAt) {
      this.answeredAtMs = config.answeredAt;
      this.recording.anchorStart(config.answeredAt);
    }
    this.pipelineCreatedAtMs = Date.now();
    this.voicemailDelivery = config.voicemailDelivery ?? null;
    this.amdConfirm = config.amdConfirm ?? null;
    this.bargeInCallback = config.onBargeIn ?? null;
    // P1-D: Per-agent VAD / barge-in tuning
    this.vadSilenceMs           = config.agentConfig.vadSilenceMs;
    this.bargeInEnabled         = config.agentConfig.bargeInEnabled;
    this.bargeInEnergyThreshold = config.agentConfig.bargeInEnergyThreshold;
    this.bargeInMinFrames       = config.agentConfig.bargeInMinFrames;
    this.bargeInEchoGraceMs     = config.agentConfig.bargeInEchoGraceMs;
    // Agents often store bargeInEnergyThreshold=200–300 (VAD floor). That is far
    // too low for interruption and caused call-2620 style 60 ms false cuts.
    // Raise the stored bar on telephony so the configured value cannot undercut
    // the floor (effectiveThreshold still has adaptive cold-start on top).
    if (config.telephonyProvider !== "webcall"
      && this.bargeInEnergyThreshold < BARGE_IN_TELEPHONY_MIN_ENERGY) {
      logger.warn(
        {
          callId: config.callId,
          configured: this.bargeInEnergyThreshold,
          flooredTo: BARGE_IN_TELEPHONY_MIN_ENERGY,
        },
        "bargeInEnergyThreshold below telephony floor — raising (VAD values must not drive barge-in)",
      );
      this.bargeInEnergyThreshold = BARGE_IN_TELEPHONY_MIN_ENERGY;
    }
    // Mic Sensitivity — one lever that scales the noise gate ratio, the
    // hasSpeechEnergy() VAD floor, and (when not already overridden by an
    // explicit bargeInEnergyThreshold) the barge-in bars. See mic-sensitivity.ts.
    // "normal" keeps the webcall AEC cap on the env-tunable knob exactly as
    // before micSensitivity existed; only "low"/"high" scale it.
    const resolvedSensitivity = resolveMicSensitivity(config.agentConfig.micSensitivity);
    this.micThresholds = resolvedSensitivity === "normal"
      ? { ...getMicSensitivityThresholds("normal"), webcallAecThreshold: BARGE_IN_WEBCALL_AEC_THRESHOLD }
      : getMicSensitivityThresholds(resolvedSensitivity);
    // P1-J: Stop Speaking Plan overrides barge-in params when configured
    this.stopSpeakingPlanConfigured = !!config.agentConfig.stopSpeakingPlan;
    if (config.agentConfig.stopSpeakingPlan) {
      const sp = config.agentConfig.stopSpeakingPlan;
      // numWords: 1 word ≈ 20 frames at 20ms/frame (150wpm = 2.5wps ≈ 0.4s/word = 20 frames)
      const framesFromWords = sp.numWords > 0 ? Math.round(sp.numWords * 20) : 0;
      // voiceSeconds: caller must speak this long before barge-in fires
      const framesFromTime = sp.voiceSeconds > 0 ? Math.round(sp.voiceSeconds * 50) : 0; // 50 frames/s at 20ms
      const combinedFrames = Math.max(framesFromWords, framesFromTime);
      if (combinedFrames > 0) this.bargeInMinFrames = combinedFrames;
      if (sp.backOffSeconds >= 0) this.bargeInEchoGraceMs = Math.round(sp.backOffSeconds * 1000);
    }
    this.interruptionMgr = new InterruptionManager({
      incrementalDelayMs: config.agentConfig.incrementalDelay ?? 0,
      wordsForInterruption: config.agentConfig.wordsForInterruption ?? 3,
    });
    // Detection only makes sense when {caller_salutation} is actually in the prompt —
    // otherwise there is nothing to fill in and we must NOT call the gender service.
    this.genderSalutationInPrompt =
      /\{\{caller_salutation\}\}|\{caller_salutation\}/.test(this.agent.systemPrompt ?? "");
    if (config.agentConfig.genderDetectionEnabled && this.genderSalutationInPrompt) {
      // wav2vec2-primary ordered fallback chain (wav2vec2 → autocorrelation →
      // pitch). The per-agent genderDetectionProvider config is retained for
      // backward compatibility but no longer selects a single model — the chain
      // always tries wav2vec2 first and falls through on timeout / low confidence.
      this.genderDetector = new GenderDetectorChained(config.callId);
      logger.info(
        { callId: config.callId, provider: "chained", configuredProvider: config.agentConfig.genderDetectionProvider ?? "(default)" },
        "Gender detection enabled (toggle on + {caller_salutation} present) — wav2vec2-primary fallback chain; will arm after greeting to sample caller intro",
      );
    } else {
      this.genderDetector = null as unknown as GenderDetector;
      if (config.agentConfig.genderDetectionEnabled && !this.genderSalutationInPrompt) {
        logger.info(
          { callId: config.callId },
          "Gender detection toggle ON but {caller_salutation} is absent from the system prompt — skipping all gender-service calls for this call",
        );
      }
    }

    // Voice Memory — opt-in; requires gender-service speaker endpoints.
    if (config.agentConfig.voiceMemoryEnabled) {
      this.speakerVerifier = new SpeakerVerifier({
        callId: config.callId,
        // Squad-shared: voiceprints live under the squad's memory owner so
        // any member recognizes the caller's voice.
        agentId: config.memoryOwnerAgentId ?? config.agentConfig.id,
        phoneNumber: config.callerPhone ?? null,
        onEvent: (ev) => this.onVoiceMemoryEvent(ev),
      });
      logger.info(
        { callId: config.callId, agentId: config.agentConfig.id },
        "Voice Memory enabled — will enroll/verify caller voice this call",
      );
      this.logExec("VoiceMemory", "response", {
        status: "info",
        metadata: { note: "Voice Memory enabled for this agent — caller voiceprint will be enrolled/verified after the greeting" },
      });
    }

    const keys = config.providerKeys;

    const sttKey =
      keys.get(this.agent.asrProvider) ||
      (["gemini_audio", "google", "gemini"].includes(this.agent.asrProvider.toLowerCase())
        ? keys.get("google") || process.env["GEMINI_API_KEY"] || process.env["GOOGLE_API_KEY"]
        : undefined);
    if (!sttKey) throw new Error(`No API key found for STT provider: ${this.agent.asrProvider}`);

    const llmKey = keys.get(this.agent.llmProvider);
    if (!llmKey) throw new Error(`No API key found for LLM provider: ${this.agent.llmProvider}`);

    const ttsKey = keys.get(this.agent.ttsProvider);
    if (!ttsKey) throw new Error(`No API key found for TTS provider: ${this.agent.ttsProvider}`);

    // Sarvam telephony calls: stream/send native 8kHz PSTN audio instead of the
    // naive linear-interpolation upsample to 16000 (see STTConfig.nativeSampleRate).
    // Webcall's native mic rate is already 16kHz, so it keeps the default.
    const isTelephonySarvam =
      this.agent.asrProvider.toLowerCase() === "sarvam" && config.telephonyProvider !== "webcall";
    this.sttSampleRate = isTelephonySarvam ? 8000 : 16000;
    const sttCfg: STTConfig = isTelephonySarvam
      ? { ...this.agent.sttConfig, nativeSampleRate: 8000 }
      : this.agent.sttConfig;

    const providerExtraConfig = keys.get(`${this.agent.asrProvider}:extraConfig`) ?? null;
    const sttExtraConfig = this.agent.asrProvider === "sarvam"
      ? JSON.stringify({
          ...parseJsonObject(providerExtraConfig),
          mode: resolveSarvamSttMode(sttCfg.language, this.agent.sarvamSttMode),
          highVadSensitivity: this.agent.sarvamHighVadSensitivity,
          speechEndFlushMs: this.agent.sarvamSpeechEndFlushMs,
          incompleteHoldMs: this.agent.sarvamIncompleteHoldMs,
        })
      : providerExtraConfig;
    this.stt = createSTTAdapter(
      this.agent.asrProvider, sttKey, this.agent.asrModel,
      sttExtraConfig,
      sttCfg
    );
    this.llm = createLLMAdapter(this.agent.llmProvider, llmKey, this.agent.llmModel, undefined, this.agent.llmGenerationParams, config.callId);

    // Seed currentLang for per-turn LLM language injection.
    const agentLanguage = this.agent.language ?? null;
    const seedLang = this.agent.languageAutoDetect
      ? (this.agent.initialLanguage ?? null)   // returning-caller preference only
      : agentLanguage;                          // strict mode: always lock from config
    if (seedLang) this.currentLang = seedLang;

    // Launch greeting LLM prewarm IMMEDIATELY after LLM adapter creation so the 1-3s LLM round-trip
    // gets maximum overlap with fallback LLM init, TTS setup, and noise cancellation.
    if (!this.amdConfirm && this.greetingWillNeedLlm()) {
      const preLang = this.currentLang || this.agent.sttConfig.language || this.agent.language || "en-IN";
      this._greetingPrewarm = this.generateGreetingLlmText(this.isResumeDroppedCall, preLang).catch(() => "");
      logger.info({ callId: config.callId }, "Greeting LLM prewarm started (constructor entry)");
    }

    // P0-B: Initialise fallback LLM adapter if the agent has one configured and the key is available
    if (this.agent.fallbackLlmProvider) {
      const fallbackKey = keys.get(this.agent.fallbackLlmProvider);
      if (fallbackKey) {
        this.fallbackLlm = createLLMAdapter(this.agent.fallbackLlmProvider, fallbackKey, this.agent.fallbackLlmModel ?? null, undefined, this.agent.llmGenerationParams, config.callId);
        logger.info({ callId: config.callId, fallbackProvider: this.agent.fallbackLlmProvider }, "Fallback LLM adapter initialised");
      }
    }

    const ttsLanguage = this.currentLang || agentLanguage;
    const ttsExtraConfig = this.agent.ttsProvider === "sarvam"
      ? JSON.stringify({
          language: ttsLanguage ?? "en-IN",
          enable_preprocessing: this.agent.sarvamIndicNumbers !== false,
        })
      : (keys.get(`${this.agent.ttsProvider}:extraConfig`) ?? null);
    this.tts = createTTSAdapter(
      this.agent.ttsProvider, ttsKey, this.agent.ttsVoice, this.agent.ttsModel,
      ttsExtraConfig, ttsLanguage, this.agent.ttsSpeed
    );
    if (ttsLanguage) this.ttsLang = ttsLanguage;
    // Pre-warm any persistent TTS connections (e.g. Cartesia / Sarvam WebSocket) with a bounded 500ms wait.
    if (this.tts.warmup) {
      void Promise.race([
        Promise.resolve(this.tts.warmup()),
        new Promise<void>((resolve) => setTimeout(resolve, 500)),
      ]).catch(() => { /* ignore warmup error */ });
    }

    if (this.agent.noiseCancellationEnabled) {
      // VoBiz denoises at the carrier layer (always on, no API knob) and the
      // browser runs AEC/NS for webcall — on those paths the transport passes
      // noiseCancel=false to onRawPcm8kIn and our software gate never runs.
      const upstreamNc = config.telephonyProvider === "vobiz" && process.env["VOBIZ_FORCE_SOFTWARE_NC"] !== "1"
        ? "vobiz-carrier"
        : config.telephonyProvider === "webcall" ? "browser-aec" : null;
      if (upstreamNc) {
        logger.info({ callId: config.callId, upstreamNc }, "Noise cancellation handled upstream — software gate bypassed");
      } else {
        logger.info({ callId: config.callId }, "Noise cancellation enabled (audio worker pool)");
      }
    }

    // Ambient noise — start looping silence-fill interval
    if (this.agent.ambientNoiseEnabled && this.agent.ambientNoiseTrack) {
      const track = this.agent.ambientNoiseTrack;
      // One structured per-call line so ambient health is observable in prod
      // logs: which track, built-in vs uploaded, transport encoding, provider,
      // and the mix levels actually applied. A future regression (wrong levels,
      // ambient silently off) is visible from this single line.
      const ambientType = Object.prototype.hasOwnProperty.call(TRACK_PARAMS, track) ? "builtin" : "uploaded";
      const ambientVolumeScale = Math.max(0, Math.min(1,
        typeof this.agent.ambientNoiseVolume === "number" && Number.isFinite(this.agent.ambientNoiseVolume)
          ? this.agent.ambientNoiseVolume
          : 1.0,
      ));
      logger.info(
        {
          callId: config.callId,
          track,
          ambientType,
          encoding: config.rawPcmOutput ? `pcm16-${(config.rawPcmOutputRate ?? 8000) / 1000}k` : "mulaw-8k",
          telephonyProvider: config.telephonyProvider,
          volumeScale: ambientVolumeScale,
          levels: {
            ...AMBIENT_LEVELS,
            silenceVol: AMBIENT_LEVELS.silenceVol * ambientVolumeScale,
            speechVol: AMBIENT_LEVELS.speechVol * ambientVolumeScale,
          },
        },
        "Ambient noise enabled",
      );
      if (ambientType === "builtin") {
        // Built-in procedural track — synchronous
        this.ambientStream = new AmbientNoiseStream(track, ambientVolumeScale);
      } else {
        // Uploaded sound — use in-process cache if warm; otherwise load async.
        // Call 2636: DB load after connect made BG noise inaudible for ~6s.
        const cached = peekCachedPcmLoop(track);
        if (cached) {
          this.ambientStream = new FileAmbientNoiseStream(cached, ambientVolumeScale);
          logger.info({ callId: config.callId, soundId: track, bytes: cached.length }, "Ambient noise: cache hit at connect");
        } else {
          loadPcmLoop(track)
            .then((pcmBuffer) => {
              if (!this.closed) {
                this.ambientStream = new FileAmbientNoiseStream(pcmBuffer, ambientVolumeScale);
                logger.info({ callId: config.callId, soundId: track, bytes: pcmBuffer.length }, "Ambient noise: uploaded PCM loop ready");
              }
            })
            .catch((err) => {
              logger.error({ callId: config.callId, soundId: track, err }, "Ambient noise: failed to load PCM loop — ambient disabled for this call");
            });
        }
      }
    }

    // Ambient noise / VoBiz keepalive interval — runs every 20 ms while the
    // agent is not actively streaming TTS audio.
    //
    // Two cases:
    //   1. ambientStream loaded → send ambient audio (built-in or uploaded).
    //   2. No ambient stream + VoBiz telephony → send PCM-zero silence to
    //      keep the VoBiz audio bridge alive.  VoBiz drops the call if the
    //      bridge receives no audio data for ~2 s even with keepCallAlive=true.
    //      Without this, calls where the caller pauses >2 s before replying
    //      disconnect with hangup code 4010 "End Of XML Instructions".
    //
    // isSendingTtsAudio=true means playSentence() is actively streaming bytes
    // to the carrier — skip here to avoid two concurrent senders on the same
    // WebSocket.  NOT gated on isPlaying so audio continues during the
    // inter-sentence gap in playTask (while waiting for the next LLM token).
    {
      const KEEPALIVE_FRAME_MS      = 20;
      const VOBIZ_SILENCE_SAMPLES   = (8000 * KEEPALIVE_FRAME_MS) / 1000; // 160 @ 8 kHz
      const vobizSilenceFrame       = Buffer.alloc(VOBIZ_SILENCE_SAMPLES * 2, 0); // PCM16-LE zeros
      const KEEPALIVE_FILL_GAP_MS   = 500; // watchdog: only fill a GENUINE mid-sentence stall
      // 500 ms, not 60 ms: at 60 ms the pump fired on ordinary streaming jitter / burst
      // delivery (a streaming TTS provider does NOT hand us a frame every 20 ms — chunks
      // arrive in bursts and the drain queue drains them), so it interleaved silence/
      // ambient frames INTO live speech and produced a chopping "helicopter" artifact on
      // the carrier. A real TTS underrun that risks VoBiz's ~2 s inactivity drop (hangup
      // 4010) lasts far longer than jitter, so 500 ms only kicks in for a true stall while
      // staying comfortably below the 2 s drop. Between-sentence gaps are still filled
      // immediately via the !isSendingTtsAudio branch, and the first-byte/greeting dead
      // air is still covered because lastTtsFrameAt starts at 0 (gap ≫ threshold).
      this.ambientInterval = setInterval(() => {
        // Send a fill frame when the agent is not actively streaming TTS
        // (!isSendingTtsAudio → the between-sentences gap), OR when a sentence is
        // nominally in progress but NO real audio frame has gone out for
        // KEEPALIVE_FILL_GAP_MS — i.e. the TTS first-byte wait or a mid-stream
        // stall where the drain queue empties. Without this second clause the
        // pump is paused AND the drain sits idle, so agent voice and ambient go
        // dead together and VoBiz drops the call after ~2 s (hangup 4010).
        // During healthy streaming a real frame lands every ~20 ms, so the gap
        // stays under the threshold and the pump skips (no double-send).
        // Sender exclusivity (VoBiz voicemail path): while the AMD-confirmation
        // or voicemail-delivery wait loops pump their own 20 ms silence frames,
        // this watchdog must NOT also send — two senders on the same cadence
        // double the frame rate and produce the "helicopter" chop on the
        // delivered voicemail. Channel continuity is preserved because the
        // manual pump sends a frame every 20 ms for the entire time this flag
        // is set. Normal calls never set the flag, so behavior is unchanged.
        if (this.amdVmManualPumpActive) {
          if (!this.ambientSuppressedLogged) {
            this.ambientSuppressedLogged = true;
            logger.info(
              { callId: this.config.callId },
              "Keepalive watchdog suppressed — AMD/voicemail manual frame pump is the sole sender",
            );
          }
          return;
        }
        const gapMs = Date.now() - this.lastTtsFrameAt;
        if (!this.closed && (!this.isSendingTtsAudio || gapMs >= KEEPALIVE_FILL_GAP_MS)) {
          if (this.ambientStream) {
            // Emit the encoding the call actually consumes: raw 8 kHz PCM for
            // web calls (rawPcmOutput), mulaw for telephony. Sending mulaw bytes
            // into a raw-PCM stream makes the browser reinterpret them as PCM16
            // and play garbled static during silence gaps.
            const chunk = this.config.rawPcmOutput
              ? (this.pcmOutRate() === 16000
                  ? upsample8to16(this.ambientStream.nextPcmChunk())
                  : this.ambientStream.nextPcmChunk())
              : this.ambientStream.nextMulawChunk();
            this.config.onAudioOut(chunk);
            // Prove (once per call) that ambient audio actually went out on the
            // wire — distinguishes "enabled but never emitted" from a genuine
            // carrier-level audibility issue when debugging from prod logs.
            if (!this.ambientFirstChunkLogged) {
              this.ambientFirstChunkLogged = true;
              logger.info(
                { callId: this.config.callId, bytes: chunk.length, encoding: this.config.rawPcmOutput ? `pcm16-${this.pcmOutRate() / 1000}k` : "mulaw-8k" },
                "Ambient noise: first silence chunk emitted to caller",
              );
            }
          } else if (this.config.telephonyProvider === "vobiz") {
            // No ambient stream — send PCM zeros to keep the VoBiz audio
            // bridge alive during listening (prevents 4010 hangup on pauses).
            this.config.onAudioOut(vobizSilenceFrame);
          }
        }
      }, KEEPALIVE_FRAME_MS);
    }

    // Turn safety net — two timers guarding the "Listening…" hang.
    const stallBackstopMs = this.isResumeDroppedCall
      ? RESUME_DROP_POST_GREETING_STALL_MS
      : this.callDirection === "outbound"
        ? OUTBOUND_POST_GREETING_STALL_MS
        : STALL_BACKSTOP_MS;
    this.safetyNet = new TurnSafetyNet({
      stallBackstopMs,
      onForceFinalize: (transcript) => {
        if (this.closed) return;
        logger.warn(
          { callId: this.config.callId, chars: transcript.length },
          "Safety net: force-finalizing stuck turn from best partial",
        );
        logWarningEvent(this.logFn, EXEC_COMPONENTS.STT, "STT Timeout", ["stt_timeout"], {
          turnNumber: this._activeTurnIndex,
          provider: this.agent.asrProvider,
          detail: { reason: "force-finalized stuck turn from best partial" },
        });
        void this.handleStreamingTranscript(transcript, Date.now(), "force_finalized");
      },
      onStallReprompt: () => {
        if (!this.closed) void this.stallReprompt();
      },
      onStallGiveUp: () => {
        if (this.closed) return;
        logger.warn({ callId: this.config.callId }, "Safety net: stall reprompts exhausted — ending call");
        void this.playInactivityMessageAndEnd();
      },
    });

    logger.info({ callId: config.callId, agent: this.agent.name }, "Pipeline initialized");

    // Start live streaming STT if the adapter supports it (e.g. Deepgram)
    if (this.stt.transcribeStream) {
      this.initStreamingSTT();
    }

    // Start silence hangup timer if configured
    this.resetHangupTimer();
  }

  // ── Streaming STT ───────────────────────────────────────────────────────────

  private initStreamingSTT(): void {
    if (!this.stt.transcribeStream) return;
    try {
      this.streamSTT = this.stt.transcribeStream(
        (text, isFinal, lang, metadata) => {
          if (this.closed) return;
          // Any transcript activity (interim or final) proves Sarvam is alive —
          // disarm the lost-turn force-flush backstop.
          if (text.trim()) this.clearVadFlushBackstop();
          // Non-empty interim → drive the force-finalize timer, but ONLY while we
          // are actually listening (not during agent playback, where partials are
          // barge-in candidates handled separately). Don't process yet.
            if (!isFinal) {
            if (!this.isPlaying && text.trim()) {
              this.lastCallerActivityAt = Date.now();
              this.safetyNet.onPartial(text);
              this.resetHangupTimer();
              this.maybeLaunchEagerOnPartial(text, metadata ?? undefined);
            }
            // Soft-cancel system “can't hear” / check-in when caller speech arrives.
            if (this.systemPlaybackActive && this.isPlaying && text.trim().length >= 4) {
              this.cancelSystemPlaybackForCallerSpeech(text);
            }
            // P0-C: Semantic barge-in on interims — detect caller interruption
            // immediately during playback, before the STT provider finalizes.
            // Reuses the same isSemanticInterrupt / bargeInRequested / bargeInCallback
            // machinery as the final-transcript path; only responsiveness improves.
            if (
              this.bargeInEnabled &&
              this.isPlaying &&
              !this.bargeInRequested &&
              text.trim()
            ) {
              // During system recovery TTS, only stop-words force a full barge —
              // word-count interim was cutting “can't hear” mid-apology (call 2626).
              if (this.systemPlaybackActive) {
                if (isSemanticInterrupt(text) || isAccidentalInterruptPhrase(text)) {
                  this.systemPlaybackActive = false;
                  this.triggerBargeIn("semantic_interim_system", text);
                }
                return;
              }
              // Bolna: interrupt on interim when word count exceeds threshold OR
              // the phrase is an accidental-interrupt / semantic stop cue.
              // Energy alone is secondary — Sarvam may not finalize during talk-over,
              // but it DOES emit interims once the caller overpowers carrier echo.
              if (isSemanticInterrupt(text) || isAccidentalInterruptPhrase(text)) {
                this.triggerBargeIn("semantic_interim", text);
                logger.info(
                  { callId: this.config.callId, text: text.slice(0, 80) },
                  "Semantic barge-in triggered (streaming STT interim)",
                );
              } else if (isBackchannelOnlyUtterance(text)) {
                // Pure acks during agent speech are not interruptions — caller is
                // often about to continue (call 2967: "சரி" then the real question).
              } else {
                const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
                // Bolna accumulates interim word length across partials for the turn
                this.streamingBargeInWordCount = Math.max(
                  this.streamingBargeInWordCount,
                  wordCount,
                );
                // Indic langs pack meaning into fewer whitespace tokens — also
                // require a grapheme / char floor so short fragments don't barge.
                const charCount = [...text.trim()].length;
                const planNumWords = this.agent.stopSpeakingPlan?.numWords;
                const threshold = (planNumWords && planNumWords > 0)
                  ? planNumWords
                  : this.interruptionMgr.getWordsForInterruption();
                const langPrefix = (this.currentLang || this.agent.language || "en").split(/[-_]/)[0]?.toLowerCase();
                const isIndic = ["ta", "hi", "te", "kn", "ml", "mr", "bn", "gu"].includes(langPrefix ?? "");
                const minChars = isIndic ? 14 : 8;
                if (
                  threshold > 0
                  && this.streamingBargeInWordCount >= threshold
                  && charCount >= minChars
                ) {
                  // Path A: launch speculative LLM from substantive barge partial
                  // (energy-only barge stays non-speculative — see energy path).
                  this.triggerBargeIn("word_count_interim", text, { speculative: true });
                  logger.info(
                    {
                      callId: this.config.callId,
                      words: this.streamingBargeInWordCount,
                      threshold,
                      charCount,
                      text: text.slice(0, 80),
                    },
                    "Barge-in detected (streaming STT interim word-count — Bolna parity)",
                  );
                }
              }
            }
            return;
          }
          if (!text.trim()) return;
          this.lastCallerActivityAt = Date.now();
          this.streamSTTReconnectAttempts = 0; // reset backoff on successful transcript
          this.resetHangupTimer();
          // NB: safetyNet.onFinal() and language auto-detection are DEFERRED to
          // handleStreamingTranscript so a transcript discarded by the echo guards
          // does NOT clear the stall backstop or drive language switching.
          this._pendingSttLang = lang ?? null;
          // Fold detected language into meta so it appears in the STT DB call-log
          // responsePayload (alongside endDetectToFinalMs / mergedSegments etc.).
          this._pendingSttMeta = lang
            ? { ...(metadata ?? {}), detectedLang: lang }
            : (metadata ?? null);
          void this.handleStreamingTranscript(text, Date.now());
        },
        () => {
          // Stream closed — attempt reconnect unless the call is already over
          if (this.closed) return;
          this.streamSTT = null;
          const MAX_ATTEMPTS = 5;
          if (this.streamSTTReconnectAttempts >= MAX_ATTEMPTS) {
            logger.warn({ callId: this.config.callId }, "Streaming STT: max reconnect attempts reached — falling back to batch STT");
            // Surface this failure in the call exec log so it's visible in the
            // dashboard — a missing or invalid API key is the most common cause.
            logWarningEvent(this.logFn, EXEC_COMPONENTS.STT, "Provider Failed", ["provider_error"], {
              provider: this.agent.asrProvider,
              detail: {
                reason: "Streaming STT permanently disconnected — falling back to batch STT. Check your API key and (for Azure) confirm the region matches your Speech resource.",
                reconnectAttempts: this.streamSTTReconnectAttempts,
              },
            });
            return;
          }
          const backoffMs = Math.min(1000 * 2 ** this.streamSTTReconnectAttempts, 16000);
          this.streamSTTReconnectAttempts++;
          logger.warn(
            { callId: this.config.callId, attempt: this.streamSTTReconnectAttempts, backoffMs },
            "Streaming STT disconnected — scheduling reconnect"
          );
          logWarningEvent(this.logFn, EXEC_COMPONENTS.STT, "Provider Reconnected", ["provider_reconnect"], {
            provider: this.agent.asrProvider,
            retryCount: this.streamSTTReconnectAttempts,
            detail: { reason: "streaming STT disconnected — reconnecting", backoffMs },
          });
          this.streamSTTReconnectTimer = setTimeout(() => {
            if (!this.closed) this.initStreamingSTT();
          }, backoffMs);
        }
      );
      this.wireStreamSttCallbacks();
      logger.info({ callId: this.config.callId, provider: this.agent.asrProvider }, "Streaming STT initialized");
      // Re-apply a latched explicit language request after a full stream
      // re-init (reconnect path) — the fresh adapter stream starts on the
      // call-start language, not the requested one.
      if (this.requestedLangLatch) {
        // Re-apply on reconnect for both auto-detect AND strict-mode agents —
        // strict mode can now latch and switch the STT socket (fix #4), so a
        // mid-call Sarvam reconnect must restore the requested language on both paths.
        this.streamSTTLang = null;
        this.maybeSwitchStreamingSttLang(this.requestedLangLatch, true);
      }
    } catch (err) {
      logger.error(
        { callId: this.config.callId, agentId: this.agent.id, provider: this.agent.asrProvider, err },
        toReadableError(err, `Streaming STT init failed (${this.agent.asrProvider}) — falling back to batch`),
      );
    }
  }

  /**
   * Called by the streaming STT callback when a final transcript arrives.
   * Handles barge-in detection and queuing if a turn is already in progress.
   */
  private async handleStreamingTranscript(rawTranscript: string, sttEmittedAt = Date.now(), closeReason: TurnCloseReason = "stt_final"): Promise<void> {
    let transcript = normalizeSttPhonetics(rawTranscript);
    this._turnCloseReason = closeReason;
    const _tStreamNow = performance.now();
    // For Azure streaming, use lastPartialToFinalMs to back-compute when the caller
    // stopped speaking — this gives a meaningful stt_ms in the turn_latency log.
    if (this._pendingSttMeta?.lastPartialToFinalMs) {
      this._tTurnVadFlush = _tStreamNow - this._pendingSttMeta.lastPartialToFinalMs;
    } else {
      this._tTurnVadFlush = _tStreamNow;
    }
    this._tTurnSttFinal = _tStreamNow;
    const sttToProcessMs = Date.now() - sttEmittedAt;
    logger.info(
      { callId: this.config.callId, sttToProcessMs, queued: this.isProcessing },
      "Streaming STT transcript received"
    );
    // A final transcript marks the end of the current speech segment — reset the
    // flag so the NEXT utterance triggers a fresh KB prefetch.
    this.inSpeechSegment = false;

    // Tail-echo guard: a final transcript arriving shortly after the agent
    // stopped speaking — when we did NOT detect a genuine barge-in — used to be
    // discarded on TIME ALONE, which silently ate genuine one-word replies
    // ("yes", "okay") spoken a beat after the agent's line ended (call 2039).
    // The guard is now CONTENT-AWARE: inside the window (the echo grace re-armed
    // at the end of playback via armTailEchoGrace(), mirroring the web path's
    // end grace) we discard only when the transcript actually matches the
    // agent's own recent speech (isSelfEcho token-overlap check — which itself
    // exempts single-word AFFIRMATIONS, so a caller's quick "yes" passes).
    // A true echo of our own closing words still matches and is dropped, so
    // echo protection is preserved (calls 772/1320 must not regress).
    if (!this.isPlaying && !this.bargeInRequested && Date.now() < this.bargeInHoldUntil) {
      if (!isSemanticInterrupt(transcript) && this.isSelfEcho(transcript)) {
        this.streamingBargeInWordCount = 0;
        logger.info({ callId: this.config.callId, transcript }, "Streaming STT: discarding post-playback echo transcript");
        this.logDiscardedTranscript(transcript, "tail_echo_guard");
        // Discarded as echo — stay cleanly in Listening (re-arm stall, drop any
        // stale best-partial) rather than leaving the turn in limbo.
        this.safetyNet.beginListening();
        return;
      }
      // Inside the tail-echo window but the content does NOT match our own
      // speech — genuine caller input (e.g. a fast one-word reply). Let it
      // proceed as a real turn.
      logger.info(
        { callId: this.config.callId, transcript, msLeftInWindow: this.bargeInHoldUntil - Date.now() },
        "Streaming STT: transcript inside tail-echo window accepted (no self-echo content match)"
      );
    }

    // Content-based self-echo guard (additive to the time-window tail-echo guard
    // above). On the Live Call path the carrier echoes our own TTS back AFTER the
    // time windows expire, so a purely time-based guard misses it. If this
    // transcript closely matches what the agent just spoke (token overlap, tolerant
    // of STT noise) and arrived within a plausible echo window, it is our own audio
    // returning — discard it so it neither starts a phantom turn nor fires a false
    // barge-in. Semantic interrupts ("stop"/"wait") are exempt: our own audio never
    // utters them, so they must always be allowed to interrupt.
    if (!isSemanticInterrupt(transcript) && this.isSelfEcho(transcript)) {
      this.streamingBargeInWordCount = 0;
      logger.info({ callId: this.config.callId, transcript }, "Streaming STT: discarding self-echo transcript (content match)");
      this.logDiscardedTranscript(transcript, "self_echo_content_guard");
      // Mirror the tail-echo guard: when not playing we're in a listening turn, so
      // re-arm the stall backstop and drop any stale best-partial. While the agent
      // is still speaking the safety net is dormant — leave it untouched.
      if (!this.isPlaying) this.safetyNet.beginListening();
      return;
    }

    if (this.bargeInEnabled && this.isPlaying && !this.bargeInRequested) {
      // P0-C: Semantic barge-in — certain keywords ("stop", "wait", …) bypass
      // BOTH the word-count gate AND the echo grace: our own audio never utters
      // them, so they are always a genuine caller interruption.
      if (isSemanticInterrupt(transcript)) {
        this.triggerBargeIn("semantic", transcript);
        logger.info({ callId: this.config.callId, transcript }, "Semantic barge-in triggered (streaming STT)");
      } else if (isBackchannelOnlyUtterance(transcript)) {
        // Pure ack finals must not cut TTS — often a lead-in to more speech.
        logger.info(
          { callId: this.config.callId, transcript: transcript.slice(0, 80) },
          "Streaming STT: barge-in suppressed for backchannel-only transcript",
        );
      } else if (
        Date.now() < this.bargeInSentenceStartAt + this.bargeInEchoGraceMs ||
        Date.now() < this.greetingEchoHoldUntil
      ) {
        // Per-sentence 600 ms echo grace — suppress non-semantic barge-in while our own
        // freshly started audio may still be echoing back. This uses the *sentence start*
        // timestamp (not the extended bargeInHoldUntil which protects the batch STT
        // path) so that the streaming STT path (webcall) can interrupt mid-sentence after
        // the initial 600 ms window expires. The greetingEchoHoldUntil clause additionally
        // protects the FULL greeting (carrier path only) — the 600 ms grace is too short
        // for the carrier echo of a multi-second opening line (call 772).
        logger.info({ callId: this.config.callId }, "Streaming STT: barge-in suppressed during echo grace");
      } else {
        // Accumulate word count across streaming callbacks for this user turn and
        // only fire barge-in once the wordsForInterruption threshold is reached,
        // matching the behaviour of the energy-based path in batch STT mode.
        const wordCount = transcript.trim().split(/\s+/).filter(Boolean).length;
        this.streamingBargeInWordCount += wordCount;
        // Prefer the configured Stop Speaking Plan Min Words (UI-exposed) over the
        // non-UI wordsForInterruption default so lowering/raising Min Words actually
        // drives streaming-STT barge-in. Fall back to wordsForInterruption when no
        // plan numWords is set.
        const planNumWords = this.agent.stopSpeakingPlan?.numWords;
        const threshold = (planNumWords && planNumWords > 0)
          ? planNumWords
          : this.interruptionMgr.getWordsForInterruption();
        // Char floor (parity with the interim path): Indic packs meaning into few
        // whitespace tokens, so a single short word ("இங்கிலீஷ்ல", call 4834) must
        // not cut the agent — background speakers routinely produce these.
        const charCount = [...transcript.trim()].length;
        const langPrefix = (this.currentLang || this.agent.language || "en").split(/[-_]/)[0]?.toLowerCase();
        const isIndic = ["ta", "hi", "te", "kn", "ml", "mr", "bn", "gu"].includes(langPrefix ?? "");
        const minChars = isIndic ? 14 : 8;
        if (this.streamingBargeInWordCount >= threshold && charCount >= minChars) {
          this.triggerBargeIn("word_count", transcript, { speculative: true });
          logger.info(
            { callId: this.config.callId, words: this.streamingBargeInWordCount, threshold, charCount },
            "Barge-in detected (streaming STT)",
          );
        } else if (this.streamingBargeInWordCount >= threshold) {
          logger.info(
            { callId: this.config.callId, charCount, minChars, transcript: transcript.slice(0, 60) },
            "Barge-in suppressed — final under char floor (likely background/short ack)",
          );
        }
      }
    } else if (!this.isPlaying) {
      // Agent is not currently playing — keep the accumulator at zero so the
      // next agent speaking turn always begins with a clean slate.  This is the
      // true agent-turn boundary: barge-in detection only makes sense while the
      // agent is speaking, and the very first callback that arrives while
      // isPlaying=true will therefore always start from 0.
      this.streamingBargeInWordCount = 0;
    }

    // Transfer in-flight guard (defense-in-depth). transferInitiated is set at
    // the very top of executeCallTransfer — BEFORE the provider API call and
    // before onCallEnd sets this.closed. This closes the brief race window where
    // the caller speaks "Connect" during the TTS hold window, the transcript
    // arrives while isProcessing=true (turn 7), lands in pendingTranscriptQueue,
    // and then drains AFTER the transfer completes but before this.closed=true.
    if (this.transferInitiated) {
      logger.info(
        { callId: this.config.callId, transcript },
        "Streaming STT: discarding transcript — transfer already in progress",
      );
      this.logDiscardedTranscript(transcript, "transfer_in_progress");
      return;
    }

    // Language auto-detection — runs AFTER all discard guards so echoed transcripts
    // can never drive language switching or increment the consecutive-detection counter.
    {
      // Sarvam saaras:v3 now forwards language_code via coalesceLang; other providers
      // may leave this null. Fall back to Unicode-script detection on the text.
      // Normalize Sarvam's non-standard Odia code (od-IN → or-IN) so that
      // LANG_DISPLAY_NAMES lookups and the consecutive-detection guard resolve
      // correctly (od-IN vs or-IN would never match → guard never fires → oscillation).
      let sttLang = this._pendingSttLang;
      this._pendingSttLang = null; // consume — prevent stale value leaking into force-finalize / queue-drain paths
      if (sttLang === "od-IN") sttLang = "or-IN";
      if (sttLang && !LANG_DISPLAY_NAMES[sttLang]) sttLang = null; // unknown code — fall through to script detection

      if (this.agent.languageAutoDetect) {
        let detected = sttLang ?? detectScriptLanguage(transcript);
        // Explicit language request (e.g. "speak in English", "Hindi me baat
        // karo") LATCHES the caller's chosen output language so it STICKS for
        // the rest of the call. Without the latch, the very next Indic-script
        // utterance flips currentLang back via script detection and the agent
        // reverts — the caller asks for English, gets one English reply, then
        // is dragged back to Hindi (prod call 1022). The latch only changes on
        // another explicit request, never via passive script detection.
        const requested = detectExplicitLanguageRequest(transcript);
        if (requested) {
          if (requested !== this.requestedLangLatch) {
            logger.info(
              { callId: this.config.callId, requested, text: transcript.slice(0, 60) },
              "Auto-detect: explicit language request latched",
            );
          }
          this.requestedLangLatch = requested;
          this._pendingLangConfirm = "";
          this._pendingLangConfirmCount = 0;
          // Explicit requests (including English) hot-swap STT immediately so
          // the stream transcribes in the requested script (call 1881 fix).
          this.maybeSwitchStreamingSttLang(requested, true);
        }
        // A latched explicit request overrides per-turn script detection.
        // Otherwise, a short Latin-only filler/backchannel ("okay", "thank
        // you", "haan ok") must NOT flip an established non-English
        // conversation to English — only a real English utterance (3+ content
        // words outside the filler stoplist) switches passively. First-turn
        // English (no non-English currentLang yet) passes through unchanged.
        const resolved = resolveAutoDetectLanguage({
          detected,
          latchedLang: this.requestedLangLatch,
          currentLang: this.currentLang,
          text: transcript,
        });
        if (resolved.heldFiller) {
          logger.info(
            { callId: this.config.callId, heldLang: this.currentLang, text: transcript.slice(0, 60) },
            "Auto-detect: English filler/backchannel — holding current language",
          );
          // Task 4: count consecutive held-filler turns so the recovery
          // message can be injected when ≥ 2 such turns accumulate.
          this._consecutiveHeldFillerTurns++;
        } else {
          this._consecutiveHeldFillerTurns = 0;
        }
        detected = resolved.lang;
        if (detected) {
          const explicitLatch = !!requested && requested === detected;
          const coldStart = !this.currentLang;
          let commitLang = coldStart || explicitLatch || detected === this.currentLang;
          if (!commitLang) {
            if (detected === this._pendingLangConfirm) {
              this._pendingLangConfirmCount++;
            } else {
              this._pendingLangConfirm = detected;
              this._pendingLangConfirmCount = 1;
            }
            // Require 2 consecutive agreeing finals before flipping mid-call.
            commitLang = this._pendingLangConfirmCount >= 2;
            if (!commitLang) {
              logger.info(
                {
                  callId: this.config.callId,
                  held: this.currentLang,
                  pending: detected,
                  count: this._pendingLangConfirmCount,
                  text: transcript.slice(0, 60),
                },
                "Auto-detect: language flip held pending consecutive confirmation",
              );
            }
          }
          if (commitLang) {
            this._pendingLangConfirm = "";
            this._pendingLangConfirmCount = 0;
            if (detected !== this.currentLang) {
              logger.info(
                { callId: this.config.callId, from: this.currentLang, to: detected, text: transcript.slice(0, 60) },
                "Auto-detect: caller language switch detected",
              );
              // Capture the switch so processTurn() can annotate the history entry.
              // Only set when there is a real prior language (not first-turn cold-start).
              if (this.currentLang) {
                this._langSwitchThisTurn = { from: this.currentLang, to: detected };
              }
            }
            this.currentLang = detected;
            this.syncTtsLanguage(detected);
            if (!detected.startsWith("en-")) {
              this.lastNonEnglishLang = detected;
              // Non-English STT switch (immediate on turn 1 so old script doesn't mangled new language).
              if (!this.requestedLangLatch?.startsWith("en-")) {
                this.maybeSwitchStreamingSttLang(detected, true);
              }
            } else {
              // English STT hot-swap: keep ASR aligned when caller converses in English.
              const enTarget = this.requestedLangLatch?.startsWith("en-")
                ? this.requestedLangLatch
                : detected;
              if (this.requestedLangLatch?.startsWith("en-")) {
                this.maybeSwitchStreamingSttLang(enTarget, true);
              } else if (this.agent.autoSwitchToEnglish) {
                this.maybeSwitchStreamingSttLang(enTarget);
              }
            }
          }
        }
      } else {
        // Strict single-language mode — still honor an EXPLICIT caller request
        // to switch language. Without this, the caller saying "speak in English"
        // is silently ignored because languageAutoDetect=false skips the latch
        // entirely and the ABSOLUTE RULE stays locked forever.
        // autoSwitchToEnglish being false/absent is intentional — it controls
        // whether English is the default fallback, NOT whether explicit requests
        // are respected. A caller who explicitly says "speak English" must always
        // be heard, regardless of agent config.
        const requested = detectExplicitLanguageRequest(transcript);
        if (requested) {
          if (requested !== this.requestedLangLatch) {
            const requestedName = LANG_DISPLAY_NAMES[requested] ?? requested;
            logger.info(
              { callId: this.config.callId, requested, text: transcript.slice(0, 60) },
              `Strict mode: caller requested ${requestedName} — latching (overrides ABSOLUTE RULE this call)`,
            );
          }
          this.requestedLangLatch = requested;
          this._pendingLangConfirm = "";
          this._pendingLangConfirmCount = 0;
          this.currentLang = requested;
          this.syncTtsLanguage(requested);
          this.maybeSwitchStreamingSttLang(requested, true);
        }
      }
    }

    const coalesceLang = this.currentLang || this.agent.sttConfig.language;
    if (
      closeReason !== "coalesced_fragment"
      && shouldHoldFragmentForCoalesce(transcript, { expectedLang: coalesceLang })
    ) {
      if (this._fragmentCoalesce) {
        clearTimeout(this._fragmentCoalesce.timer);
        transcript = `${this._fragmentCoalesce.text} ${transcript}`.trim();
        this._fragmentCoalesce = null;
        logger.info(
          { callId: this.config.callId, merged: transcript.slice(0, 120) },
          "STT fragment coalesced with follow-up final",
        );
      } else {
        // Hold duration is context-dependent:
        //   • Agent currently speaking → the "okay/சரி" is a true backchannel;
        //     hold the full window so a follow-up final can merge.
        //   • Agent silent (caller's turn) → "Okay." is very likely the caller's
        //     actual ANSWER to the agent's question. Holding 2s here reads as
        //     dead air on every short reply (call-4831 "Okay." turn), so release
        //     after a short merge window instead.
        const holdMs = this.fragmentCoalesceHoldMs();
        if (holdMs > 0) {
          this.armFragmentCoalesce(transcript, holdMs);
          logger.info(
            { callId: this.config.callId, fragment: transcript.slice(0, 80), holdMs },
            "STT fragment coalesce hold — awaiting follow-up final",
          );
          this.logDiscardedTranscript(transcript, "fragment_coalesce_hold");
          this.safetyNet.onFinal();
          this.clearEagerPartialTimer();
          // Drop any speculative LLM started on the filler-only partial — the
          // coalesced follow-up (or flush) will launch a fresh turn.
          if (this._specLlmState && !this.isProcessing) {
            this._specLlmState.aborted = true;
            this._specLlmState = null;
          }
          this.interruptionMgr.onUserSpeechEnd();
          if (!this.closed) this.safetyNet.beginListening();
          return;
        }
        // holdMs === 0: coalesce disabled via Latency Tuning UI — fall through.
      }
    } else if (this._fragmentCoalesce) {
      // Complete follow-up arrived while a fragment was held — merge, don't drop.
      clearTimeout(this._fragmentCoalesce.timer);
      transcript = `${this._fragmentCoalesce.text} ${transcript}`.trim();
      this._fragmentCoalesce = null;
      logger.info(
        { callId: this.config.callId, merged: transcript.slice(0, 120) },
        "STT fragment coalesced with complete follow-up final",
      );
    } else {
      this.clearFragmentCoalesce();
    }

    // Bolna parity: ignore false-interruption scraps after energy barge-in so we
    // don't start an LLM turn on "சொல்லுங்க" / half-cuts that only appeared because
    // TTS was cut mid-sentence. Accidental short finals while the agent was speaking
    // are dropped in Bolna (`≤ number_of_words_for_interruption` ⇒ continue loop).
    {
      const wordsThreshold = this.interruptionMgr.getWordsForInterruption();
      if (
        (this._lastTurnWasBargedIn || this.bargeInRequested)
        && !isSemanticInterrupt(transcript)
        && isFalseInterruptionScrap(transcript, wordsThreshold)
      ) {
        logger.info(
          { callId: this.config.callId, transcript: transcript.slice(0, 80), wordsThreshold },
          "False interruption — ignoring scrap transcript",
        );
        this.logDiscardedTranscript(transcript, "false_interruption_scrap");
        this.prepareSystemPlayback();
        // Drop only this barge-linked scrap. Leaving the flag sticky used to
        // swallow every later short reply until the caller spoke 4+ words
        // (call 2632 felt like “STT only hears 3+ words”).
        this._lastTurnWasBargedIn = false;
        this.streamingBargeInWordCount = 0;
        this.safetyNet.onFinal();
        this.clearEagerPartialTimer();
        this.interruptionMgr.onUserSpeechEnd();
        // Call 4839: a false (energy/echo) barge cut the reply mid-sentence AND
        // the caller transcript was a scrap → both sides silent for 17s until
        // the caller asked "are you there?". Resume the unheard remainder.
        const remainder = this._bargedReplyRemainder;
        if (
          remainder
          && Date.now() - this._bargedReplyAt < 15_000
          && !this.isPlaying && !this.isProcessing && !this.closed
        ) {
          this._bargedReplyRemainder = null;
          void this.resumeBargedReply(remainder);
          return;
        }
        if (!this.closed) this.safetyNet.beginListening();
        return;
      }
    }

    // A real caller turn is being accepted — any pending barged-reply remainder
    // is now stale (the caller moved the conversation on); never resume it.
    this._bargedReplyRemainder = null;

    // Outbound call-screening bots (iPhone / Google Call Screen): detect the
    // screener's prompt early, answer it with one short sentence, and when the
    // real human then picks up, restart the conversation via a one-shot note.
    if (this.callDirection === "outbound" && this.screeningState !== "done") {
      const swallowed = await this.maybeHandleCallScreening(transcript);
      if (swallowed) {
        this.safetyNet.onFinal();
        this.clearEagerPartialTimer();
        this.interruptionMgr.onUserSpeechEnd();
        if (!this.closed) this.safetyNet.beginListening();
        return;
      }
    }

    if (isCallerAudioDifficulty(transcript)) {
      this.pendingAudioDifficultyNote = true;
    }
    if (isTopicClarificationAsk(transcript)) {
      this.pendingTopicClarificationNote = true;
    }

    // Accepted as a real turn — clear the safety timers now (deferred from the STT
    // callback so the discarded/echo transcripts above can't suppress the stall).
    this.safetyNet.onFinal();
    this.clearEagerPartialTimer();
    this.interruptionMgr.onUserSpeechEnd();
    if (this.isProcessing) {
      this.pendingTranscriptQueue.push({ text: transcript, emittedAt: sttEmittedAt, closeReason });
      return;
    }

    this.isProcessing = true;
    try {
      await this.processTurn(transcript, 0);
    } catch (err) {
      logger.error({ callId: this.config.callId, err }, "Turn error (streaming STT)");
    } finally {
      this.isProcessing = false;
      if (!this.speakingSpeakerHandoffChallenge) {
        this.skipAgentPlaybackForHandoff = false;
      }
      // If the call ended (transfer or end_call) while this turn was processing,
      // do NOT drain the pending queue — those transcripts must be discarded.
      if (this.closed) return;
      const next = this.pendingTranscriptQueue.shift();
      if (next) {
        void this.handleStreamingTranscript(next.text, next.emittedAt, next.closeReason);
      } else if (!this.closed) {
        // Turn fully done — re-enter Listening and re-arm the stall backstop.
        this.safetyNet.beginListening();
      }
    }
  }

  /**
   * Stall-backstop recovery: no usable transcript arrived before STALL_BACKSTOP_MS.
   * Speak a language-aware reprompt and re-enter Listening (do NOT hang up — on
   * outbound calls a hangup is a lost lead). After STALL_MAX_REPROMPTS the safety
   * net calls onStallGiveUp instead, which ends the call via the inactivity path.
   */
  /**
   * Record the unheard tail of a reply that was cut by barge-in, so that if the
   * "interruption" turns out to be a discarded scrap (false energy/echo barge)
   * we can resume speaking instead of leaving dead air (call 4839: 17s silence).
   */
  private captureBargedRemainder(spokenResponse: string, baseSpokenResponse: string): void {
    if (!this.bargeInRequested || !baseSpokenResponse) return;
    let remainder = baseSpokenResponse.startsWith(spokenResponse)
      ? baseSpokenResponse.slice(spokenResponse.length).trim()
      : baseSpokenResponse.trim();
    if (!remainder) return;
    // Call 4856: barge before any paced audio left spokenResponse empty → we
    // "resumed" the entire line from the start (glitchy double-speak). Only
    // keep a true unheard *tail* after meaningful progress into the reply.
    const spokenLen = spokenResponse.trim().length;
    const minSpoken = Math.min(24, Math.max(12, Math.floor(baseSpokenResponse.length * 0.12)));
    if (spokenLen < minSpoken) return;
    if (remainder.length > 400) remainder = remainder.slice(0, 400);
    this._bargedReplyRemainder = remainder;
    this._bargedReplyAt = Date.now();
  }

  /** Speak the unheard remainder of a falsely-barged reply (system-playback style). */
  private async resumeBargedReply(text: string): Promise<void> {
    if (this.closed || this.isProcessing || this.isPlaying) return;
    logger.info(
      { callId: this.config.callId, chars: text.length },
      "False barge-in — resuming cut-off reply",
    );
    this.logExec("Agent", "system", {
      status: "info",
      turnNumber: this._activeTurnIndex,
      metadata: { event: "Barged Reply Resumed", chars: text.length, preview: text.slice(0, 80) },
    });
    this.firstAudioSentAt = null;
    this.bargeInHoldUntil = Date.now() + this.bargeInEchoGraceMs;
    this.isPlaying = true;
    try {
      await this.playSentence(text);
    } catch (err) {
      logger.error({ callId: this.config.callId, err }, "Barged-reply resume playback error");
    } finally {
      this.isPlaying = false;
      this.systemPlaybackActive = false;
      this.armTailEchoGrace();
    }
    await this.drainPlaybackTail();
    if (!this.closed) {
      this.conversationHistory.appendAssistant(text);
      this.config.onTranscript("agent", text);
      this.config.onConversationUpdate?.(this.conversationHistory.messages);
      this.safetyNet.beginListening();
      this.resetHangupTimer();
    }
  }

  private async stallReprompt(): Promise<void> {
    if (this.closed || this.isProcessing || this.isPlaying) {
      // Activity resumed between expiry and handling — just re-arm.
      if (!this.closed) this.safetyNet.beginListening();
      return;
    }
    // Caller energy pulsed recently (VAD before STT) — don't say "can't hear".
    if (this.lastCallerActivityAt > 0 && Date.now() - this.lastCallerActivityAt < 2500) {
      logger.info(
        { callId: this.config.callId, msSinceActivity: Date.now() - this.lastCallerActivityAt },
        "Stall reprompt skipped — recent caller activity",
      );
      if (!this.closed) this.safetyNet.beginListening();
      return;
    }
    this.prepareSystemPlayback();
    logger.info(
      { evt: "turn_latency", path: "pipeline", callId: this.config.callId, turn_close_reason: "stall_reprompt" },
      "turn_latency",
    );
    logWarningEvent(this.logFn, EXEC_COMPONENTS.STT, "Silence Reprompt", ["silence_reprompt"], {
      turnNumber: this._activeTurnIndex,
      detail: { reason: "no usable transcript — prompting caller again" },
    });
    const text = recoveryReprompt(this.currentLang || this.agent.language);
    this.firstAudioSentAt = null;
    this.bargeInHoldUntil = Date.now() + this.bargeInEchoGraceMs;
    this.isPlaying = true;
    try {
      await this.playSentence(text);
    } catch (err) {
      logger.error({ callId: this.config.callId, err }, "Stall reprompt playback error");
    } finally {
      this.isPlaying = false;
      this.systemPlaybackActive = false;
      this.armTailEchoGrace();
    }
    // Drain the carrier's jitter buffer so the reprompt's final word plays out
    // before we re-enter Listening and arm the stall backstop again.
    await this.drainPlaybackTail();
    // Reset turn state and re-enter Listening.
    this.audioBuffer = [];
    this.audioBufferNative16k = [];
    this.pendingTranscriptQueue = [];
    if (!this.closed) {
      this.safetyNet.beginListening();
      // Reset the per-agent silence-hangup timer so the caller gets a full
      // silenceTimeoutSeconds window to respond AFTER the reprompt, not just
      // whatever is left from the previous turn's audio timestamp.
      this.resetHangupTimer();
    }
  }

  // ── Audio input ─────────────────────────────────────────────────────────────

  /** Incoming mulaw from Twilio / Plivo — offloads decode + noise-cancel + VAD to worker thread */
  onAudioIn(mulawChunk: Buffer): void {
    if (this.closed) return;
    const callId = String(this.config.callId);
    const pcm8k = decodeMulaw(mulawChunk);
    // Record raw caller audio (before noise cancellation)
    this.recording.addCallerChunk(pcm8k);
    // Voice-intelligence tap — runs outside the main audio pipeline
    this.config.callerAudioTap?.(pcm8k);
    processAudioIn(callId, mulawChunk, this.agent.noiseCancellationEnabled, this.micThresholds.gateRatio, this.micThresholds.vadThreshold)
      .then((result) => this.handleProcessedAudio(result))
      .catch((err) => logger.error({ callId: this.config.callId, err }, "Audio worker error (mulaw)"));
  }

  /**
   * Incoming raw LINEAR16 PCM @ 8 kHz — offloads noise-cancel + VAD to worker thread.
   *
   * Used by VoBiz telephony and webcall.  Pass `noiseCancel = false` for sources
   * that have already had noise suppression applied (e.g. browser WebRTC), so
   * the server-side gate does not zero out quiet-but-valid speech.
   */
  onRawPcm8kIn(pcm8k: Buffer, noiseCancel?: boolean, nativePcm16k?: Buffer): void {
    if (this.closed) return;
    const callId = String(this.config.callId);
    // Record raw caller audio (before noise cancellation)
    this.recording.addCallerChunk(pcm8k);
    // Voice-intelligence tap — runs outside the main audio pipeline
    this.config.callerAudioTap?.(pcm8k);
    // Acoustic AMD confirmation window: inbound audio is used ONLY to distinguish a
    // machine greeting (long continuous monologue) from a live human ("hello?" then a
    // pause). Skip the STT / conversation path entirely while confirming; the verdict
    // is resolved in confirmAmdMachineThenBranch(), which then greets or delivers.
    if (this.amdConfirming) {
      // Assertion: confirmation-phase events must never fire once the AMD
      // verdict is resolved (amdConfirming is cleared before any branch —
      // greeting or voicemail playback — begins). If this ever logs, a
      // confirmation listener leaked past resolution.
      if (this.amdResolved) {
        if (!this.amdPostResolveEventLogged) {
          this.amdPostResolveEventLogged = true;
          logger.warn(
            { callId: this.config.callId, agentId: this.agent.id },
            "AMD confirmation event fired AFTER resolution — ignoring (listener leak, should never happen)",
          );
        }
        return;
      }
      const now = Date.now();
      if (hasSpeechEnergy(pcm8k, AMD_CONFIRM_ENERGY_THRESHOLD)) {
        this.amdHeardSpeech = true;
        if (this.amdRunStartAt === 0) this.amdRunStartAt = now;
        this.amdLastSpeechAt = now;
        this.amdMaxContinuousMs = Math.max(this.amdMaxContinuousMs, now - this.amdRunStartAt);
      } else if (this.amdRunStartAt !== 0 && (now - this.amdLastSpeechAt) >= AMD_SPEECH_GAP_MS) {
        // Silence gap long enough to end the current continuous speech run.
        this.amdRunStartAt = 0;
      }
      return;
    }
    // Voicemail-delivery mode: inbound audio is the answering machine's outgoing
    // greeting, NOT a conversation. Drive greeting-end detection only and skip the
    // STT / conversation path entirely (no streamSTT is ever opened).
    if (this.vmDelivering) {
      if (hasSpeechEnergy(pcm8k, VOICEMAIL_GREETING_ENERGY_THRESHOLD)) {
        this.vmHeardSpeech = true;
        this.vmLastSpeechAt = Date.now();
      }
      return;
    }
    // Caller-supplied `noiseCancel` wins when present; fall back to agent setting.
    const nc = noiseCancel !== undefined ? noiseCancel : this.agent.noiseCancellationEnabled;
    // Queue the caller's TRUE 16k audio (before it was downsampled to 8k for
    // this call) so handleProcessedAudio can use it for STT instead of the
    // worker's upsample8to16 reconstruction, which cannot recover frequency
    // content already destroyed by the 8k step. See field doc for why this
    // matters ("VoBiz" → "Bobby" mishearing on webcall). Queued here (not
    // earlier) so it only enters the FIFO on the same code path that will
    // consume it in handleProcessedAudio — the AMD/voicemail branches above
    // return before processing and must never leave it stranded in the queue.
    if (nativePcm16k) this.nativePcm16kQueue.push(nativePcm16k);
    processRawPcm8kIn(callId, pcm8k, nc, this.micThresholds.gateRatio, this.micThresholds.vadThreshold)
      .then((result) => this.handleProcessedAudio(result))
      .catch((err) => logger.error({ callId: this.config.callId, err }, "Audio worker error (pcm8k)"));
  }

  /** Returns the recording buffer so the caller (session.ts) can finalize it at call end. */
  getRecording(): RecordingBuffer {
    return this.recording;
  }

  /**
   * Last meaningful media time for billing: max of real caller activity, real
   * TTS frame out, and recording track writes. Ignores VoBiz keepalive zeros
   * (those never touch lastTtsFrameAt / the recording buffer).
   */
  getLastMediaAtMs(): number | null {
    const fromRec = this.recording.getLastWriteAtMs();
    const candidates = [this.lastCallerActivityAt, this.lastTtsFrameAt, fromRec ?? 0].filter((t) => t > 0);
    if (candidates.length === 0) return null;
    return Math.max(...candidates);
  }

  /**
   * Marks the first outbound audio chunk of a turn. On the very first outbound
   * chunk of the whole call it also logs the carrier answer → first-audio gap
   * (the dead-air latency the caller hears before the greeting), once per call,
   * so the answer→media-connect delay can be measured from logs.
   */
  private markFirstAudioSent(): void {
    if (this.firstAudioSentAt) return;
    this.firstAudioSentAt = Date.now();
    if (!this.answerGapLogged && this.answeredAtMs) {
      this.answerGapLogged = true;
      // Split the caller-perceived dead air into its two phases:
      //  setupMs    = carrier answer → pipeline ready (XML roundtrip + WS
      //               connect + start event + createSession DB work)
      //  pipelineMs = pipeline ready → first outbound audio frame (AMD window,
      //               greeting LLM/TTS, prebuffer)
      const setupMs = this.pipelineCreatedAtMs - this.answeredAtMs;
      const pipelineMs = this.firstAudioSentAt - this.pipelineCreatedAtMs;
      logger.info(
        {
          callId: this.config.callId,
          answeredAt: this.answeredAtMs,
          firstAudioSentAt: this.firstAudioSentAt,
          answerToFirstAudioMs: this.firstAudioSentAt - this.answeredAtMs,
          setupMs,
          pipelineMs,
        },
        "Answer→first-audio gap (carrier answer to first outbound audio)",
      );
      // Also surface the breakdown in the downloadable call execution log so
      // dead-air reports can be diagnosed from an exported call log alone.
      this.logExec("Agent", "system", {
        status: "info",
        turnNumber: 0,
        metadata: {
          event: "Answer → First Audio breakdown",
          answerToFirstAudioMs: this.firstAudioSentAt - this.answeredAtMs,
          setupMs,
          pipelineMs,
        },
      });
    }
  }

  /**
   * Energy-based barge-in detector shared by the batch-STT VAD path and the
   * streaming-STT path. Counts consecutive caller frames whose RMS energy clears
   * the (provider-aware) barge-in threshold and fires bargeInCallback() once the
   * configured min-frames floor is reached.
   *
   * Why the streaming path needs this: streaming STT (Sarvam/Deepgram/Azure)
   * previously returned from handleProcessedAudio() BEFORE the batch energy block,
   * so barge-in could only fire via a transcript (semantic-interim keyword or a
   * final-transcript word-count). On telephony with Sarvam the caller talking
   * OVER the agent rarely yields a timely final (Sarvam finalizes on endpointing,
   * which doesn't occur while the caller keeps talking), so ordinary interruptions
   * ("actually…", "I have a question") never fired. This gives the streaming path a
   * transcript-independent, energy-driven interrupt that matches the batch path.
   *
   * @param respectHoldUntil batch passes true (its bargeInHoldUntil is extended
   *   through the whole estimated sentence, which is fine for VAD-gated batch STT).
   *   Streaming passes false: the extended bargeInHoldUntil would suppress it for
   *   the ENTIRE sentence and re-preserve the bug, so streaming relies only on the
   *   per-sentence echo grace (bargeInSentenceStartAt + bargeInEchoGraceMs) and the
   *   greeting hold — mirroring the streaming transcript barge-in path.
   */
  private tryEnergyBargeIn(
    pcm8k: Buffer,
    hasSpeech: boolean,
    source: "energy" | "streaming_energy",
    respectHoldUntil: boolean,
  ): void {
    if (!hasSpeech) {
      // genuine VAD silence — reset the accumulator
      this.bargeInSpeechFrames = 0;
      this.bargeInLowEnergyFrames = 0;
      return;
    }
    if (!this.bargeInEnabled || !this.isPlaying || this.bargeInRequested) return;
    // Never energy-barge system recovery / identity lines — word_count was doing
    // that via interim; energy would recreate the call-2626 cascade.
    if (this.systemPlaybackActive) return;

    // Streaming-STT carrier path (webcall has AEC; the batch path keeps its own
    // extended-hold protection). Only here do we measure RMS / self-calibrate.
    const streamingCarrier = !respectHoldUntil && this.config.telephonyProvider !== "webcall";
    const currentRms = streamingCarrier ? frameRms(pcm8k) : 0;
    // The adaptive anti-echo bar applies ONLY while we are ACTIVELY sending TTS — that
    // is the only time the carrier is echoing our audio back. Between sentences there is
    // no echo, so the configured Energy Threshold is honoured unchanged (a caller
    // speaking into a gap must interrupt at their normal level, not an echo-inflated one).
    const useAdaptive = streamingCarrier && this.isSendingTtsAudio;
    // Webcall path: browser AEC cancels agent echo before it reaches us.
    // Used to apply a lower threshold and enable the streaming frame-count cap.
    const isWebcallStreaming = !respectHoldUntil && this.config.telephonyProvider === "webcall";

    const now = Date.now();
    // 600ms per-sentence start grace protects initial spoken words from self-echo false cuts.
    const startGraceMs = Math.max(600, this.bargeInEchoGraceMs);
    if (
      now < this.greetingEchoHoldUntil ||
      now < this.bargeInSentenceStartAt + startGraceMs ||
      (respectHoldUntil && now < this.bargeInHoldUntil)
    ) {
      if (useAdaptive && now <= this.bargeInSentenceStartAt + BARGE_IN_ECHO_CALIBRATION_MS) {
        this.updateEchoFloor(currentRms);
      }
      this.bargeInSpeechFrames = 0;
      return;
    }

    let effectiveThreshold = this.bargeInEnergyThreshold;
    if (useAdaptive) {
      const floorReady = this.playbackEchoFloorSamples >= BARGE_IN_ECHO_FLOOR_MIN_SAMPLES;
      const echoBar = floorReady
        ? this.playbackEchoFloor * BARGE_IN_ADAPTIVE_ECHO_MARGIN
        : BARGE_IN_TELEPHONY_ACTIVE_TTS_ENERGY_FLOOR;
      effectiveThreshold = Math.max(
        this.bargeInEnergyThreshold,
        Math.min(echoBar, BARGE_IN_ADAPTIVE_MAX_THRESHOLD),
      );
    }
    const webcallAecThreshold = this.micThresholds.webcallAecThreshold;
    if (isWebcallStreaming && effectiveThreshold > webcallAecThreshold) {
      effectiveThreshold = webcallAecThreshold;
    }
    if (streamingCarrier) {
      effectiveThreshold = Math.max(effectiveThreshold, BARGE_IN_TELEPHONY_MIN_ENERGY);
    }

    if (useAdaptive && now - this.lastEnergyMonitorLogAt >= 700) {
      this.lastEnergyMonitorLogAt = now;
      logger.info(
        {
          callId: this.config.callId, currentRms: Math.round(currentRms),
          echoFloor: Math.round(this.playbackEchoFloor),
          effectiveThreshold: Math.round(effectiveThreshold),
          configuredThreshold: this.bargeInEnergyThreshold, frames: this.bargeInSpeechFrames,
        },
        "energy barge-in monitor",
      );
    }
    if (isWebcallStreaming && now - this.lastEnergyMonitorLogAt >= 700) {
      this.lastEnergyMonitorLogAt = now;
      logger.info(
        {
          callId: this.config.callId, currentRms: Math.round(frameRms(pcm8k)),
          effectiveThreshold: Math.round(effectiveThreshold),
          configuredThreshold: this.bargeInEnergyThreshold, frames: this.bargeInSpeechFrames,
        },
        "webcall energy barge-in monitor",
      );
    }

    const aboveBar = useAdaptive
      ? currentRms > effectiveThreshold
      : hasSpeechEnergy(pcm8k, effectiveThreshold);

    if (aboveBar) {
      this.bargeInSpeechFrames++;
      // ~15 frames (300 ms @ 20ms/frame) of sustained caller speech energy required.
      // Filters out brief mic clicks/breaths while reacting promptly to human interruptions.
      let effectiveMinFrames = Math.max(15, BARGE_IN_STREAMING_MIN_FRAMES);
      if (this.bargeInSpeechFrames >= effectiveMinFrames) {
        this.triggerBargeIn(source, undefined, {
          speculative: false,
          energyDetails: {
            frames: this.bargeInSpeechFrames,
            effectiveMinFrames,
            effectiveThreshold,
            configuredThreshold: this.bargeInEnergyThreshold,
            echoFloor: Math.round(this.playbackEchoFloor),
            currentRms: Math.round(isWebcallStreaming ? frameRms(pcm8k) : currentRms),
          },
        });
        this.audioBuffer = [];
        this.audioBufferNative16k = [];
        logger.info(
          {
            callId: this.config.callId, source, frames: this.bargeInSpeechFrames,
            effectiveMinFrames, effectiveThreshold, configuredThreshold: this.bargeInEnergyThreshold,
            echoFloor: Math.round(this.playbackEchoFloor),
            currentRms: Math.round(isWebcallStreaming ? frameRms(pcm8k) : currentRms),
          },
          "Barge-in detected (energy)",
        );
      }
      this.bargeInLowEnergyFrames = 0;
    } else {
      // Don't reset immediately on a single below-threshold frame — brief
      // inter-syllable pauses would otherwise kill an accumulating run. Only reset
      // after 5 consecutive low-energy frames (~100 ms). NOTE: we deliberately do NOT
      // feed below-bar frames into the echo floor here. Because a normal caller can be
      // BELOW the bar (that is the very bug we are fixing), treating below-bar frames as
      // "echo" would let the caller's own voice raise the floor against themselves. The
      // floor is learned ONLY from the caller-silent post-start calibration window.
      this.bargeInLowEnergyFrames++;
      if (this.bargeInLowEnergyFrames >= 5) {
        this.bargeInSpeechFrames = 0;
        this.bargeInLowEnergyFrames = 0;
      }
    }
  }

  /**
   * Asymmetric EMA of the carrier's returning-echo RMS, sampled only during the brief
   * caller-silent window right after each line starts (see the caller in tryEnergyBargeIn).
   * Rises slowly and falls fast so a stray loud sample barely nudges the floor while a
   * genuine drop in echo level recovers quickly. Seeds on the first sample and counts
   * samples so the derived bar isn't trusted until the estimate is warm.
   */
  private updateEchoFloor(rms: number): void {
    if (rms <= 0) return;
    this.playbackEchoFloorSamples++;
    if (this.playbackEchoFloor <= 0) {
      this.playbackEchoFloor = rms;
      return;
    }
    const alpha = rms > this.playbackEchoFloor
      ? BARGE_IN_ECHO_FLOOR_RISE_ALPHA
      : BARGE_IN_ECHO_FLOOR_FALL_ALPHA;
    this.playbackEchoFloor = this.playbackEchoFloor * (1 - alpha) + rms * alpha;
  }

  /** Handles pre-processed audio returned by the audio worker pool. */
  private handleProcessedAudio({ pcm8k, pcm16k, hasSpeech }: AudioProcessResult): void {
    if (this.closed) return;
    // Prefer the TRUE native 16k chunk queued in onRawPcm8kIn (webcall) over
    // the worker's upsample8to16(pcm8k) reconstruction, which cannot recover
    // frequency content already lost when the source was downsampled to 8k.
    // FIFO order matches 1:1 because processRawPcm8kIn resolves strictly in
    // per-call order. Telephony never queues a native chunk, so pcm16k (the
    // worker's reconstruction) is used unchanged there, as before.
    const effectivePcm16k = this.nativePcm16kQueue.length > 0
      ? this.nativePcm16kQueue.shift()!
      : pcm16k;

    // ── IVR DTMF detection ──
    // Run on every incoming frame when an IVR interaction is active.
    // Independent of speech/silence — DTMF tones are recognisable even during
    // concurrent ambient audio.
    if (this.dtmfDetector && this.dtmfResolver) {
      const digit = this.dtmfDetector.feed(pcm8k);
      if (digit !== null) {
        const resolve = this.dtmfResolver;
        this.dtmfResolver = null;
        if (this.dtmfTimeoutId) { clearTimeout(this.dtmfTimeoutId); this.dtmfTimeoutId = null; }
        resolve(digit);
      }
    }

    // Streaming STT path: feed all audio directly to Deepgram — no local VAD needed
    if (this.streamSTT) {
      // Feed all frames (not just speech) — librosa pyin handles silence gracefully.
      // Only after the greeting is delivered (armed) so we sample the caller's intro,
      // not the greeting echo or stray pre-greeting audio.
      if (this.genderDetectionArmed) this.genderDetector?.addSpeechChunk(pcm8k);
      // Never enroll/verify on TTS echo (carrier has no AEC) — pause during agent
      // speech + post-playback echo grace so Voice Memory only sees the caller.
      this.speakerVerifier?.setSamplingPaused(
        this.isPlaying || this.isSendingTtsAudio || Date.now() < this.bargeInHoldUntil,
      );
      this.speakerVerifier?.addSpeechChunk(pcm8k, hasSpeech);

      // ── Input-level self-echo gate (Live Call / carrier path only) ─────────────
      // Root fix for the greeting-startup delay: on the carrier path there is no
      // acoustic echo cancellation, so our own TTS is echoed back and, if fed to the
      // recognizer, gets transcribed as a phantom caller turn that restarts/interrupts
      // the greeting (call 772).
      //
      // INPUT-LEVEL SELF-ECHO GATE REMOVED (barge-in regression, calls 772→1320):
      // We no longer drop below-threshold frames here. Gating the STT INPUT feed during
      // agent speech starved Sarvam of caller audio for the whole reply, so only a shout
      // could interrupt — normal-volume barge-in was impossible. Carrier echo is filtered
      // on the TRANSCRIPT side instead: the content-based isSelfEcho() guard + the
      // post-playback tail-echo time guard in handleStreamingTranscript() discard any
      // transcript that matches the agent's own recent speech (call 772 protection
      // preserved), while genuine caller words always reach the recognizer and can
      // interrupt at normal volume.

      // KB prefetch: fire on the first frame of a new speech segment so the lookup
      // runs during the utterance rather than after STT resolves.
      if (!this.inSpeechSegment && !this.isProcessing && this.agent.knowledgeSourceIds.length > 0) {
        this.inSpeechSegment = true;
        // dumpMaxChars: the prefetch is a FALLBACK context (used only when live
        // retrieval misses/errors) — cap it at 8k so a huge KB can't blow up the
        // turn prompt. Pinned entries sort first, so a curated summary survives.
        this.kbPrefetchPromise = retrieveKbContextMultiEx(this.agent.knowledgeSourceIds, "", undefined, { dumpMaxChars: KB_PREFETCH_MAX_CHARS, excludeTitles: this.krutrimSummaryExcludeTitles() })
          .catch((err) => {
            logger.warn({ callId: this.config.callId, err }, "KB prefetch (streaming STT) failed");
            return null;
          });
      }
      // Energy-based barge-in for the streaming path (transcript-independent).
      // respectHoldUntil=false: the extended bargeInHoldUntil spans the whole
      // sentence and would re-preserve the "can't interrupt Sarvam" bug, so we
      // rely only on the per-sentence echo grace + greeting hold (see helper).
      this.tryEnergyBargeIn(pcm8k, hasSpeech, "streaming_energy", /* respectHoldUntil */ false);
      // Raw caller speech energy keeps the silence-hangup watchdog alive even
      // when streaming STT goes quiet mid-speech (no partials/finals — call
      // 1915 dropped the caller mid-sentence). Gated on the agent not speaking
      // so continuous carrier echo of our TTS cannot keep an abandoned call alive
      // forever. Exception: when we just asked a question, count overlapping
      // caller energy too (callers often answer before our last word ends).
      if (
        hasSpeech
        && (
          (!this.isPlaying && !this.isSendingTtsAudio)
          || Date.now() < this.expectingShortReplyUntil
        )
      ) {
        this.lastCallerActivityAt = Date.now();
        this.silenceWatchdog?.onSpeechEnergy();
        // Push stall back when caller is vocalizing but Sarvam hasn't emitted a partial yet.
        if (!this.isPlaying && !this.isProcessing) {
          this.safetyNet.onActivityPulse();
        }
      }
      // Soft-cancel system TTS on caller energy (before STT catches up).
      if (hasSpeech && this.systemPlaybackActive && this.isPlaying) {
        this.cancelSystemPlaybackForCallerSpeech();
      }
      // ── INVARIANT — DO NOT GATE OR FLUSH THIS FEED (calls 772→1320) ─────────
      // Every caller frame reaches the streaming-STT socket unconditionally. The
      // local energy VAD above is advisory-only (barge-in / silence watchdog /
      // safety net) — it must never gate this send and never call
      // streamSTT.flush(). Gating the feed during agent playback once starved
      // Sarvam's server VAD (no partials during talk-over → barge-in impossible):
      // the calls-772→1320 regression. The STT provider owns end-of-speech;
      // client code never finalizes turns.
      //
      // Send native 8kHz telephony audio directly when the adapter is configured
      // for it (Sarvam) instead of the linear-interpolation upsample to 16k —
      // avoids manufacturing samples on already-lossy phone audio (see sttSampleRate).
      this.streamSTT.sendAudio(this.sttSampleRate === 8000 ? pcm8k : effectivePcm16k);
      return;
    }

    // Feed all frames to the gender detector (fires async once after 2 s of audio, then no-ops).
    // Gated on armed so detection samples the caller's intro turn, not the greeting.
    if (this.genderDetectionArmed) this.genderDetector?.addSpeechChunk(pcm8k);
    this.speakerVerifier?.setSamplingPaused(
      this.isPlaying || this.isSendingTtsAudio || Date.now() < this.bargeInHoldUntil,
    );
    this.speakerVerifier?.addSpeechChunk(pcm8k, hasSpeech);

    // Batch STT path with local VAD + barge-in detection
    if (hasSpeech) this.silenceWatchdog?.onSpeechEnergy();
    // respectHoldUntil=true: the batch path is VAD-gated and its extended
    // bargeInHoldUntil (spanning the whole estimated sentence) is intentional here.
    this.tryEnergyBargeIn(pcm8k, hasSpeech, "energy", /* respectHoldUntil */ true);

    if (this.isProcessing) return;

    if (hasSpeech) {
      // KB prefetch: fire on the very first speech frame of a new utterance so
      // the lookup runs while the user is still speaking + during the silence
      // wait + during STT — well before processTurn() needs the result.
      if (this.audioBuffer.length === 0 && this.agent.knowledgeSourceIds.length > 0) {
        // Same 8k fallback cap as the streaming-STT prefetch above.
        this.kbPrefetchPromise = retrieveKbContextMultiEx(this.agent.knowledgeSourceIds, "", undefined, { dumpMaxChars: KB_PREFETCH_MAX_CHARS, excludeTitles: this.krutrimSummaryExcludeTitles() })
          .catch((err) => {
            logger.warn({ callId: this.config.callId, err }, "KB prefetch (batch STT) failed");
            return null;
          });
      }
      this.audioBuffer.push(pcm8k);
      this.audioBufferNative16k.push(effectivePcm16k);
      this.resetSilenceTimer();
    } else if (this.audioBuffer.length > 0) {
      this.audioBuffer.push(pcm8k);
      this.audioBufferNative16k.push(effectivePcm16k);
      this.scheduleSilenceFlush();
    }
  }

  // ── Greeting ────────────────────────────────────────────────────────────────

  /**
   * The effective caller gender used for salutation rendering: an explicit
   * mid-call caller correction wins over the model-detected gender, otherwise
   * the locked/last detection result is used (null until detection resolves).
   */
  private effectiveGender(): "male" | "female" | null {
    return this.salutationCorrection ?? this.genderDetector?.gender ?? null;
  }

  /** Map an effective gender to the agent's configured salutation, or "" (neutral/skip). */
  private salutationFor(gender: "male" | "female" | null): string {
    const raw = gender === "male"
      ? this.agent.genderDetectionMaleSalutation
      : gender === "female"
        ? this.agent.genderDetectionFemaleSalutation
        : (this.agent.genderDetectionNeutralSalutation ?? "");
    return (raw === "(skip)" || !raw) ? "" : raw;
  }

  /**
   * Replace every `{{caller_salutation}}` / `{caller_salutation}` placeholder in
   * `text` with `sal`. When `sal` is empty the placeholder (and its surrounding
   * whitespace) is collapsed to a single space so a raw token can never surface.
   */
  private substituteSalutation(text: string, sal: string): string {
    if (sal) {
      return text
        .replace(/\{\{caller_salutation\}\}/g, sal)
        .replace(/\{caller_salutation\}/g, sal);
    }
    return text
      .replace(/\s*\{\{caller_salutation\}\}\s*/g, " ")
      .replace(/\s*\{caller_salutation\}\s*/g, " ");
  }

  /**
   * Detect an EXPLICIT mid-call caller correction of how they wish to be
   * addressed (e.g. "call me sir, not ma'am", "I'm a woman", "address me as
   * madam", Tamil "ma'am illa", Hindi "ma'am nahi"). Returns "male" | "female"
   * when a clear correction is found, else null. This is intentionally
   * conservative — only unambiguous self-described gender / salutation
   * statements match, so normal mentions of "sir"/"ma'am" do not trip it.
   *
   * Covers English + romanized-Hindi PREFIX-negation phrasings ("not ma'am")
   * AND Indic POSTFIX-negation word order (Tamil/Hindi negate AFTER the word:
   * "ma'am illa", "sir nahi", "ma'am mat", "sir vendaam"), since the latter is
   * how the Tamil/Hinglish callers these agents serve actually object. The
   * per-turn LLM directive also carries an explicit-correction exception so a
   * phrasing missed here is still honored by the model.
   *
   * An objection to a salutation maps to the OPPOSITE gender ("not ma'am" →
   * male, "not sir" → female).
   */
  private detectSalutationCorrection(transcript: string): "male" | "female" | null {
    const t = transcript.toLowerCase();
    // Phrasings that assert the caller is male / wants "sir".
    const maleRe = /\b(call me sir|address me as sir|i am a man|i'?m a man|i am male|i'?m male|i'?m not a woman|i am not a woman|not ma'?am|main (?:ek )?aadmi|mujhe sir)\b/;
    // Phrasings that assert the caller is female / wants "ma'am" / "madam".
    const femaleRe = /\b(call me ma'?am|call me madam|address me as ma'?am|address me as madam|i am a woman|i'?m a woman|i am female|i'?m female|i'?m not a man|i am not a man|not sir|main (?:ek )?aurat|mujhe ma'?am|mujhe madam)\b/;

    // ── Indic postfix-negation corrections (negation AFTER the word) ─────────
    // Tamil "ma'am illa"/"sir illa" (illa/illai = "not"), Hindi "ma'am nahi"/
    // "ma'am mat" (nahi/nahin = "not", mat = "don't"), Tamil "ma'am vendaam"
    // ("don't want"). The negator can arrive romanized OR in native script
    // (இல்ல/இல்லை, நில்ல, வேண்டாம், नहीं/नही, मत). A single short filler word
    // between the salutation and the negator is tolerated (e.g. Tamil
    // "naan vandhu ma'am illa"). The romanized negators carry a trailing
    // (?![a-z]) so partial-word collisions like "illadhu" don't match.
    const NEG = "(?:illai?|nahin?|mat|vend?aam|இல்ல(?:ை)?|நில்ல|வேண்டா(?:ம்)?|नहीं|नही|मत)(?![a-z])";
    const GAP = "(?:\\s+\\S{1,10})?\\s+";
    const maamPostfix = new RegExp(`(?:ma'?am|mam|madam|मैम|मैडम)${GAP}${NEG}`);
    const sirPostfix = new RegExp(`(?:sir|saar|சார்|सर|सर्)${GAP}${NEG}`);

    // Explicit postfix-negation wins first — it is the stronger signal and
    // disambiguates phrasings like Hindi "mujhe ma'am mat bolo" ("don't call me
    // ma'am" → male), which would otherwise match the "call me ma'am" prefix.
    if (maamPostfix.test(t)) return "male";
    if (sirPostfix.test(t)) return "female";
    if (femaleRe.test(t)) return "female";
    if (maleRe.test(t)) return "male";
    return null;
  }

  /**
   * Arm gender detection so the detector begins sampling caller audio. Called once
   * the agent greeting has been delivered (or immediately when the caller speaks
   * first), so the sampled audio is the caller's INTRODUCTION turn rather than the
   * greeting echo or stray pre-greeting audio. Idempotent and a no-op when no
   * detector is active (toggle off or {caller_salutation} absent).
   */
  private armGenderDetection(): void {
    if (!this.genderDetectionArmed && this.genderDetector) {
      this.genderDetectionArmed = true;
      logger.info(
        { callId: this.config.callId, provider: this.agent.genderDetectionProvider ?? "librosa" },
        "Gender detection ARMED — now sampling the caller's intro turn",
      );
    }
    // Voice Memory arms on the same post-greeting moment as gender, even if
    // gender detection is off / missing {caller_salutation}.
    this.speakerVerifier?.arm();
  }

  /**
   * Voice Memory callbacks — mid-call handoff + cross-number link notes.
   * Soft signals only; never hang up or treat as KYC.
   */
  private onVoiceMemoryEvent(ev: VoiceMemoryEvent): void {
    if (ev.type === "enrolled") {
      if (ev.linkedFromPhone) {
        this.voiceLinkedFromPhone = ev.linkedFromPhone;
        this.pendingVoiceLinkNote = true;
        logger.info(
          {
            callId: this.config.callId,
            personKey: ev.personKey,
            linkedFromPhone: ev.linkedFromPhone,
            score: ev.score,
          },
          "Voice Memory: same voice matched across phone numbers",
        );
        // Hand the matched person's memory to the live conversation ASAP:
        // load the OLD number's caller memory and inject it from the next
        // turn onward, so the agent serves them with their existing history
        // even though this number has none.
        void this.loadVoiceLinkedMemory(ev.linkedFromPhone);
      }
      return;
    }

    if (ev.type === "handoff") {
      this.voiceHandoffActive = true;
      this.pendingSpeakerChallenge = true;
      this.speakerChallengeSpoken = false;
      this.salutationCorrection = null;
      this.pendingVoiceLinkNote = false;
      // A different person is now on the line — the voice-matched memory
      // belongs to the previous speaker and must not leak to the new one.
      this.voiceLinkedMemoryBlock = null;
      this.pendingVoiceLinkAck = false;
      // Unlock gender so the new speaker can be re-detected.
      const gd = this.genderDetector as GenderDetectorChained | null;
      if (gd && typeof gd.resetForNewSpeaker === "function") {
        gd.resetForNewSpeaker();
      }
      this.speakerVerifier?.resetForNewSpeaker();
      logger.info(
        { callId: this.config.callId, similarity: ev.similarity },
        "Voice Memory: mid-call speaker handoff — gender unlocked, challenge pending",
      );
      // Defer identity challenge if we are mid system recovery or just heard the caller —
      // forced "who is speaking?" over “can't hear” / schedule offer killed call 2626.
      if (this.systemPlaybackActive || (this.lastCallerActivityAt > 0 && Date.now() - this.lastCallerActivityAt < 2000)) {
        logger.info(
          { callId: this.config.callId },
          "Voice Memory: deferring handoff challenge (system playback / recent caller speech)",
        );
        return;
      }
      void this.speakSpeakerHandoffChallenge();
    }
  }

  /**
   * Outbound call-screening handling. Returns true when the transcript was the
   * screening bot itself and must be swallowed (never sent to the LLM as a
   * caller turn). Returns false to let the transcript flow as a normal turn —
   * including the real human's pickup, which additionally arms a one-shot
   * "start over" prompt note.
   */
  private async maybeHandleCallScreening(transcript: string): Promise<boolean> {
    const { detectScreeningPrompt, buildScreeningResponse, CALL_SCREENING_WINDOW_MS } =
      await import("./callScreening.js");

    if (this.screeningState === "idle") {
      if (Date.now() - this.screeningWindowStart > CALL_SCREENING_WINDOW_MS) {
        this.screeningState = "done"; // window over — never engage mid-call
        return false;
      }
      if (!detectScreeningPrompt(transcript)) return false;

      this.screeningState = "responded";
      const response = buildScreeningResponse({
        explicit: (this.agent as unknown as Record<string, unknown>)["screeningResponse"] as
          | string
          | undefined,
        agentName: this.agent.name,
        greetingMessage: this.agent.greetingMessage,
      });
      logger.info(
        { callId: this.config.callId, transcript: transcript.slice(0, 120), response: response.slice(0, 160) },
        "Call screening bot detected — answering screener, then waiting for the real person",
      );
      logWarningEvent(this.logFn, EXEC_COMPONENTS.STT, "Call Screening Detected", ["call_screening"], {
        turnNumber: this._activeTurnIndex,
        detail: { screenerPrompt: transcript.slice(0, 160), response: response.slice(0, 160) },
      });
      // Keep the screening exchange in history so the LLM has full context if
      // it ever surfaces, but it is NOT a caller turn (no LLM invocation).
      // The "[call screening bot]" prefix marks these turns for exclusion from
      // durable caller-memory extraction (see screeningFreeHistory()).
      this.conversationHistory.appendUser(`[call screening bot] ${transcript}`);
      this.conversationHistory.appendAssistant(response);

      // Speak the single screening reply, then go quiet (screeners reject
      // callers who keep talking). Mirrors silenceCheckIn's system playback.
      // If the greeting is still playing when the screener is detected, wait
      // (bounded) for it to finish — the reply must be delivered exactly once,
      // never silently skipped.
      if (!this.closed && this.isPlaying) {
        const waitDeadline = Date.now() + 10_000;
        while (this.isPlaying && !this.closed && Date.now() < waitDeadline) {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      if (!this.closed && !this.isPlaying) {
        this.prepareSystemPlayback();
        this.bargeInHoldUntil = Date.now() + this.bargeInEchoGraceMs;
        this.isPlaying = true;
        try {
          await this.playSentence(response);
        } catch (err) {
          logger.error({ callId: this.config.callId, err }, "Screening response playback error");
        } finally {
          this.isPlaying = false;
          this.systemPlaybackActive = false;
          this.armTailEchoGrace();
        }
        await this.drainPlaybackTail();
      }
      return true; // swallow the screener transcript
    }

    // state === "responded": the next accepted transcript.
    if (detectScreeningPrompt(transcript)) {
      // Screener speaking again (relaying / confirming). Stay quiet — we
      // already stated our reason; repeating gets calls rejected.
      logger.info(
        { callId: this.config.callId, transcript: transcript.slice(0, 120) },
        "Call screening bot spoke again — staying quiet",
      );
      this.conversationHistory.appendUser(`[call screening bot] ${transcript}`);
      return true;
    }

    // A non-screener utterance after we answered the screener = the real
    // person picked up. Restart the conversation from the top.
    this.screeningState = "done";
    this.pendingScreeningPickupNote = true;
    logger.info(
      { callId: this.config.callId, transcript: transcript.slice(0, 120) },
      "Real person picked up after call screening — restarting conversation with fresh greeting",
    );
    return false; // flows into processTurn as a normal caller turn
  }

  /**
   * Load caller memory saved under the voice-matched OLD phone number and
   * build a compact block for per-turn injection. Best-effort, non-blocking —
   * a failure just means the agent keeps the soft link note without history.
   */
  private async loadVoiceLinkedMemory(linkedPhone: string): Promise<void> {
    try {
      const { loadCallerContext } = await import("./callerMemory.js");
      const ctx = await loadCallerContext(this.config.memoryOwnerAgentId ?? this.config.agentConfig.id, linkedPhone);
      if (this.closed || this.voiceHandoffActive) return;

      const lines: string[] = [];
      const name = ctx.profile?.name ?? ctx.facts.find((f) => f.key === "name")?.value ?? null;
      if (name) lines.push(`Name: ${name}`);
      const summary = ctx.recentCalls.find((c) => c.summary)?.summary ?? ctx.profile?.summary ?? null;
      if (summary) lines.push(`Previous call summary: ${String(summary).trim()}`);
      for (const f of ctx.facts.slice(0, 15)) {
        if (f.key === "name" || f.key === "language_pref" || f.confidence < 0.5) continue;
        lines.push(`- ${f.key}: ${f.value}`);
      }
      if (!lines.length) {
        this.logExec("VoiceMemory", "system", {
          status: "info",
          metadata: {
            note: "Voice-matched number has no usable caller memory — nothing to inject",
            linkedPhone,
          },
        });
        return;
      }

      this.pendingVoiceLinkAck = true;
      this.voiceLinkedMemoryBlock =
        "=== VOICE-MATCHED CALLER MEMORY ===\n" +
        "This caller is calling from a NEW number, but their voice matches a known caller. " +
        "Their history from the previous number is below — use it naturally (do not re-ask known " +
        "details), but confirm identity before revealing anything sensitive. Dates/relative words " +
        "below are from PAST calls — recompute against the current date before speaking them.\n" +
        lines.join("\n");
      logger.info(
        { callId: this.config.callId, facts: lines.length, hasSummary: !!summary },
        "Voice Memory: linked-number caller memory loaded and injected for next turns",
      );
      this.logExec("VoiceMemory", "system", {
        status: "success",
        metadata: {
          note: "Voice-matched caller memory injected into upcoming turns",
          linkedPhone,
          factLines: lines.length,
          hasSummary: !!summary,
          hasName: !!name,
        },
      });
    } catch (err) {
      logger.warn(
        { callId: this.config.callId, err },
        "Voice Memory: failed to load linked-number caller memory",
      );
      this.logExec("VoiceMemory", "system", {
        status: "error",
        metadata: {
          note: "Failed to load voice-matched caller memory",
          linkedPhone,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  /**
   * Interrupt any in-flight agent speech and ask who is on the line.
   * Soft prompt notes alone are often ignored when CALLER MEMORY / history
   * still name the previous person.
   */
  private async speakSpeakerHandoffChallenge(): Promise<void> {
    if (this.closed || this.speakingSpeakerHandoffChallenge || this.speakerChallengeSpoken) return;
    this.speakingSpeakerHandoffChallenge = true;
    this.skipAgentPlaybackForHandoff = true;
    try {
      // Cut in-flight TTS without a long mute. The old 2s busy-wait with
      // bargeInRequested=true left callers in blank silence (call 2620 report).
      if (this.isPlaying || this.isSendingTtsAudio) {
        this.interruptionMgr.invalidateCurrentTurn();
        for (const ac of this.activeTtsAborts) {
          try { ac.abort(); } catch { /* noop */ }
        }
        this.activeTtsAborts.clear();
        this.bargeInCallback?.(); // clearAudio on carrier
        this.bargeInRequested = true;
        const deadline = Date.now() + 350;
        while ((this.isSendingTtsAudio || this.isPlaying) && Date.now() < deadline && !this.closed) {
          await new Promise((r) => setTimeout(r, 20));
        }
        this.prepareSystemPlayback();
      }

      if (this.closed) return;

      const text = speakerHandoffChallenge(this.currentLang || this.agent.language);
      this.pendingSpeakerChallenge = false;
      this.speakerChallengeSpoken = true;
      this.conversationHistory.appendAssistant(text);
      this.config.onTranscript("agent", text);
      this.config.onConversationUpdate?.(this.conversationHistory.messages);
      logger.info(
        { callId: this.config.callId, text },
        "Voice Memory: speaking forced handoff challenge",
      );

      // Allow this challenge through the handoff skip gate.
      this.skipAgentPlaybackForHandoff = false;
      this.bargeInHoldUntil = Date.now() + this.bargeInEchoGraceMs;
      this.isPlaying = true;
      try {
        await this.playSentence(text);
      } finally {
        this.isPlaying = false;
        this.systemPlaybackActive = false;
        this.armTailEchoGrace();
      }
      await this.drainPlaybackTail();
    } catch (err) {
      logger.warn({ callId: this.config.callId, err }, "Voice Memory: forced handoff challenge failed");
      // Fall back to LLM soft challenge on the next turn.
      if (!this.speakerChallengeSpoken) this.pendingSpeakerChallenge = true;
    } finally {
      this.speakingSpeakerHandoffChallenge = false;
      this.systemPlaybackActive = false;
      if (!this.isProcessing) {
        this.skipAgentPlaybackForHandoff = false;
      }
    }
  }

  /**
   * Build the per-turn language guard block from current instance state
   * (currentLang + auto-detect / latch / auto-switch flags). Extracted so the
   * greeting-time cache warm (buildCacheBase) and the per-turn prompt assembly
   * share ONE source of truth — the cached prefix must match the turn prefix
   * byte-for-byte or the Gemini CachedContent is not reused.
   */
  private buildLangGuard(): string {
    let langGuard = "";
    if (this.currentLang) {
      const langName = LANG_DISPLAY_NAMES[this.currentLang] ?? this.currentLang;
      if (this.agent.languageAutoDetect) {
        if (this.requestedLangLatch === "en-IN") {
          // English gets a stronger OVERRIDE guard because many system prompts instruct
          // the agent to speak Hinglish/Hindi by default. When the caller explicitly
          // switches to English we must tell the LLM to supersede that instruction.
          // Only an EXPLICIT latched request gets this override — a transcript that
          // merely happens to be in Latin script (script-detected English, no latch)
          // must NOT claim "the caller has requested English"; it falls through to
          // the softer follow-the-caller rule below (call 1881: "Speak in Tamil."
          // in Latin script falsely triggered this and flipped the agent to English).
          langGuard =
            `[LANGUAGE RULE — OVERRIDE] The caller is now speaking English and has requested English. ` +
            `Respond in clear, plain English ONLY for this entire response. ` +
            `IMPORTANT: Ignore any instruction in your system prompt that says to speak in Hinglish, Hindi, ` +
            `or any other language — the caller has explicitly asked for English. ` +
            `Do not mix Hindi or regional words into your reply. ` +
            `EXCEPTION — proper nouns: keep all brand names, product names, company names, and people's names ` +
            `EXACTLY as written in your instructions; never translate or transliterate them.`;
        } else if (this.requestedLangLatch) {
          // A latched explicit NON-English request (e.g. "Speak in Tamil") gets the
          // same strength of override so it supersedes system prompts that instruct
          // Hindi/Hinglish — mirroring the English override above.
          const reqName = LANG_DISPLAY_NAMES[this.requestedLangLatch] ?? this.requestedLangLatch;
          langGuard =
            `LANGUAGE OVERRIDE: The caller has explicitly asked you to speak ${reqName}. ` +
            `Respond ONLY in ${reqName} for this entire response, and keep responding in ${reqName} ` +
            `unless the caller explicitly asks for another language. ` +
            `IMPORTANT: Ignore any instruction in your system prompt that says to speak in Hindi, Hinglish, ` +
            `English, or any other language — the caller has explicitly asked for ${reqName}. ` +
            `REGISTER — speak in natural, everyday colloquial spoken ${reqName}, the way real people talk in casual conversation; ` +
            `NEVER use formal, literary, or bookish register. Mixing commonly-used English loanwords (business, finance, tech, and everyday terms) ` +
            `into ${reqName} is normal spoken usage — keep such words in English as people naturally say them; this does NOT count as switching languages. ` +
            `EXCEPTION — proper nouns: keep all brand names, product names, company names, and people's names ` +
            `EXACTLY as written in your instructions; never translate or transliterate them.`;
        } else {
          langGuard =
            `LANGUAGE DIRECTIVE: The caller is currently speaking in ${langName}. ` +
            `Respond in ${langName}. If the caller switches to a different language (Tamil, Hindi, English, etc.), ` +
            `immediately switch your response to match their new language. ` +
            `If they mix languages (e.g. Hinglish or Tamil+English), match their mix naturally. ` +
            `IMPORTANT — borrowed English words and fillers from the caller ("okay", "ok", "thank you", "yes", "no", "right", "fine") ` +
            `are completely normal in Indian speech and are NOT a language switch; do NOT switch to English because of them. ` +
            `Only switch to English when the caller clearly converses in full English sentences or explicitly asks for English. ` +
            `REGISTER — speak in natural, everyday colloquial spoken ${langName}, the way real people talk in casual conversation; ` +
            `NEVER use formal, literary, or bookish register. Mixing commonly-used English loanwords (business, finance, tech, and everyday terms) ` +
            `into ${langName} is normal spoken usage — keep such words in English as people naturally say them; this does NOT count as switching languages. ` +
            `EXCEPTION — proper nouns: keep all brand names, product names, company names, and people's names ` +
            `EXACTLY as written in your instructions; never translate or transliterate them.`;
        }
      } else if (this.requestedLangLatch === "en-IN" || (this.agent.autoSwitchToEnglish && this.currentLang === "en-IN")) {
        // Strict single-language mode, but the caller explicitly asked for English and
        // the operator enabled auto-switch-to-English. Override the ABSOLUTE RULE for
        // this reply so the agent actually answers in English instead of staying locked
        // to its base language.
        langGuard =
          `LANGUAGE OVERRIDE: The caller has explicitly requested English. ` +
          `Respond in clear, plain English ONLY for this entire response. ` +
          `IMPORTANT: Ignore any STRICT/ABSOLUTE LANGUAGE RULE in your system prompt that tells you to speak ` +
          `Tamil, Hindi, Hinglish, or any other language — the caller has asked for English. ` +
          `Do not mix other languages into your reply. ` +
          `EXCEPTION — proper nouns: keep all brand names, product names, company names, and people's names ` +
          `EXACTLY as written in your instructions; never translate or transliterate them.`;
      } else if (this.requestedLangLatch && this.requestedLangLatch !== "en-IN") {
        // Strict mode, but caller explicitly requested a different Indic language (e.g. Tamil → Telugu).
        const requestedName = LANG_DISPLAY_NAMES[this.requestedLangLatch] ?? this.requestedLangLatch;
        langGuard =
          `LANGUAGE OVERRIDE: The caller has explicitly requested ${requestedName}. ` +
          `Respond in ${requestedName} ONLY for this entire response. ` +
          `IMPORTANT: Ignore any STRICT/ABSOLUTE LANGUAGE RULE in your system prompt that tells you to speak ` +
          `a different language — the caller has asked for ${requestedName}. ` +
          `REGISTER — speak in natural, everyday colloquial spoken ${requestedName}. ` +
          `EXCEPTION — proper nouns: keep all brand names, product names, company names, and people's names ` +
          `EXACTLY as written in your instructions; never translate or transliterate them.`;
      } else {
        langGuard =
          `LANGUAGE ABSOLUTE RULE: You MUST respond ONLY in ${langName}. ` +
          `This applies to EVERY reply without exception — including when you are confused, ` +
          `do not understand a word, encounter an unfamiliar name, or the caller speaks in another language. ` +
          `Never switch to English or any other language under any circumstances. ` +
          `REGISTER — speak in natural, everyday colloquial spoken ${langName}, the way real people talk in casual conversation; ` +
          `NEVER use formal, literary, or bookish register. Mixing commonly-used English loanwords (business, finance, tech, and everyday terms) ` +
          `into your ${langName} speech is normal spoken usage — keep such words in English as people naturally say them; ` +
          `this does NOT count as switching languages, and "ONLY in ${langName}" does NOT mean avoiding these everyday English loanwords. ` +
          `EXCEPTION — proper nouns: keep all brand names, product names, company names, and people's names EXACTLY as written in your instructions above. ` +
          `Never translate, localize, or transliterate them, even when part of a name resembles a common ${langName} word.`;
      }
    }

    // Append Unicode script directive for non-Latin languages so weaker models
    // write actual script characters instead of romanizing (Tanglish, Hinglish-script, etc.).
    if (langGuard) {
      const effectiveLang = (this.requestedLangLatch && this.requestedLangLatch !== "en-IN" && this.requestedLangLatch !== "en-US")
        ? this.requestedLangLatch
        : (this.currentLang ?? "");
      const scriptNote = LANG_SCRIPT_DIRECTIVE[effectiveLang];
      if (scriptNote) langGuard += " " + scriptNote;

      // Constrain LLM-generated acknowledgment fillers — models otherwise larden
      // every reply with a translated "got it" / "I see" / "oh I see" style opener,
      // which sounds scripted and repetitive over a whole call (Tamil especially:
      // only "seri" sounds natural, and even that should be used sparingly).
      // Task 5b: exactly two permitted tokens, language-matched; all others forbidden.
      const allowedFiller = effectiveLang.startsWith("ta") ? `"சரி" (seri)` : effectiveLang.startsWith("si") ? `"හරි" (hari)` : `"Okay"`;
      langGuard +=
        ` ACKNOWLEDGMENT FILLERS: The ONLY permitted acknowledgment/filler token is ${allowedFiller}. ` +
        `Do NOT use "Sure", "Got it", "I see", "Oh I see", "Mm-hmm", "Right", "Understood", "Great", ` +
        `or ANY other acknowledgment phrase — in any language. ` +
        `Most replies must have NO filler at all. Never open two consecutive replies with a filler.`;
    }

    return langGuard;
  }

  /**
   * The static cacheable prefix for Gemini explicit context caching: the same
   * `langGuard + base systemPrompt + langGuard` wrap that processTurn() computes
   * before appending any per-turn volatile content. Used to warm the Gemini
   * CachedContent during the greeting so turn 1 can already reuse it. Must stay
   * in lock-step with the wrap in processTurn().
   */
  private buildCacheBase(detectedGender: "male" | "female" | null): string {
    const langGuard = this.buildLangGuard();
    const base = this.agent.systemPrompt;
    const wrapped = langGuard ? `${langGuard}\n\n${base}\n\n${langGuard}` : base;
    // Resolve {caller_salutation} the SAME way processTurn() does so the warmed
    // prefix matches the per-turn prefix byte-for-byte (see cacheEligible()).
    // At greeting time gender is not yet detected → neutral salutation, which
    // matches turn 1; once gender locks the per-turn base changes and the adapter
    // re-warms (only that one turn misses).
    return this.substituteSalutation(wrapped, this.salutationFor(detectedGender));
  }

  /**
   * Wait briefly for uploaded ambient PCM so the keepalive interval can mix
   * noise from connect — not after greeting TTS has already started (call 2636).
   */
  private async ensureAmbientReady(timeoutMs: number): Promise<void> {
    if (this.ambientStream || !this.agent.ambientNoiseEnabled || !this.agent.ambientNoiseTrack) return;
    const track = this.agent.ambientNoiseTrack;
    if (Object.prototype.hasOwnProperty.call(TRACK_PARAMS, track)) return;
    const volumeScale = Math.max(0, Math.min(1,
      typeof this.agent.ambientNoiseVolume === "number" && Number.isFinite(this.agent.ambientNoiseVolume)
        ? this.agent.ambientNoiseVolume
        : 1.0,
    ));
    try {
      const pcm = await Promise.race([
        loadPcmLoop(track),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("ambient_timeout")), timeoutMs);
        }),
      ]);
      if (!this.closed && !this.ambientStream) {
        this.ambientStream = new FileAmbientNoiseStream(pcm, volumeScale);
        logger.info(
          { callId: this.config.callId, soundId: track, bytes: pcm.length },
          "Ambient noise: ready before greeting",
        );
      }
    } catch {
      // Async constructor load may still complete; do not block the opener.
    }
  }

  /**
   * Cold-caller LLM opener, extracted from greet() so the AMD confirmation
   * window can prewarm it in parallel. Never throws — falls back internally.
   */
  private async generateGreetingLlmText(resumeDropped: boolean, greetLang: string): Promise<string> {
    let greeting = "";
        const greetingTrigger: import("./types.js").ConversationTurn[] = [];
        try {
          const greetingSystemPrompt = this.substituteSalutation(
            buildCompactGreetingPrompt(
              this.agent.systemPrompt,
              greetLang,
              resumeDropped,
            ),
            this.salutationFor(null),
          );
          const _greetLlmStartAt = Date.now();
          this.logExec("LLM", "request", {
            provider: this.agent.llmProvider,
            status: "info",
            turnNumber: 0,
            requestPayload: { purpose: "greeting", promptChars: greetingSystemPrompt.length },
          });
          await this.llm.chat(
            greetingTrigger, greetingSystemPrompt,
            (token) => { greeting += token; },
            (full) => { greeting = full; },
            {
              onUsage: (usage) => {
                this.hasRealLlmUsage = true;
                this.llmInputTokensTotal += usage.inputTokens;
                this.llmOutputTokensTotal += usage.outputTokens;
              },
            }
          );
          const greetingLlmMs = Date.now() - _greetLlmStartAt;
          logger.info(
            { callId: this.config.callId, greetingLlmMs, promptChars: greetingSystemPrompt.length },
            "Greeting LLM completed",
          );
          this.logExec("LLM", "response", {
            provider: this.agent.llmProvider,
            status: "success",
            turnNumber: 0,
            latencyMs: greetingLlmMs,
            responsePayload: { purpose: "greeting", text: greeting.slice(0, 200) },
          });
        } catch (llmErr) {
          // Recoverable: a transient greeting-LLM failure must NOT drop the call
          // before the agent speaks. Fall back to the configured static greeting
          // if present, otherwise a minimal neutral opener, and continue the call.
          const reason = toReadableError(llmErr, "Greeting LLM error");
          // Prefer a real static greeting; never fall back to outbound stubs
          // ("Hello") — that recreates the dead-air / media-drop failure mode.
          let fallback = (this.agent.greetingMessage ?? "").trim();
          if (this.callDirection === "outbound" && isStubGreeting(fallback)) {
            fallback = "";
          }
          fallback = fallback || neutralGreeting(this.agent.language);
          logger.error(
            { callId: this.config.callId, agentId: this.agent.id, provider: this.agent.llmProvider, err: llmErr },
            `${reason} — falling back to a safe spoken opener instead of dropping the call`,
          );
          this.logExec("LLM", "response", {
            provider: this.agent.llmProvider,
            status: "error",
            turnNumber: 0,
            responsePayload: { purpose: "greeting", error: reason, fallback: fallback.slice(0, 120) },
          });
          greeting = fallback;
        }
    return greeting;
  }

  /** Predicts whether greet() will need the greeting LLM (mirrors its gating). */
  private greetingWillNeedLlm(): boolean {
    if (this.agent.firstSpeaker === "user") return false;
    if (this.config.isReturningCaller === true && !this.isResumeDroppedCall && this.callDirection !== "outbound") return false;
    const greetLang = this.currentLang || this.agent.sttConfig.language || this.agent.language || "en-IN";
    let greeting = this.isResumeDroppedCall ? "" : (this.agent.greetingMessage ?? "");
    if (this.callDirection === "outbound" && isStubGreeting(greeting)) greeting = "";
    if (greeting.trim() && !greetLang.toLowerCase().startsWith("en") && !/[\u0900-\u0DFF]/.test(greeting)) greeting = "";
    return !greeting.trim();
  }

  async greet(): Promise<void> {
    if (this.closed) return;
    // Prefer ambient ready before first speech so BG noise isn't silent for seconds
    // after connect (call 2636 — uploaded PCM arrived ~6s late).
    await this.ensureAmbientReady(0);
    // ── Gemini context-cache warm (best-effort, non-blocking) ────────────────
    // Fire-and-forget: register the static system-prompt prefix as a Gemini
    // CachedContent while the greeting plays, so the caller's first real turn
    // can already be served from cache. Honoured only by the Google adapter
    // (no-op elsewhere). Skipped for staged-prompt agents — their per-turn
    // prompt is REPLACED, so the warmed base would never match a turn prefix
    // (wasted create). A base/lang mismatch is harmless: the turn's own
    // ensureCache re-warms and only turn 1 misses.
    if (
      this.agent.llmProvider === "google" &&
      typeof this.llm.warmContextCache === "function" &&
      !(this.agent.stagedPromptEnabled && this.agent.stagedPromptStages.length > 0)
    ) {
      try {
        const warmTools = buildToolDefs(this.agent.tools);
        warmTools.push(SCHEDULE_CALLBACK_TOOL_DEF);
        void this.llm.warmContextCache(this.buildCacheBase(null), warmTools);
      } catch (err) {
        logger.debug({ callId: this.config.callId, err }, "Gemini cache warm (greeting) skipped");
      }
    }
    // "User speaks first" — stay silent on connect; the session listens for
    // caller audio and only responds after the user speaks.
    if (this.agent.firstSpeaker === "user") {
      logger.info({ callId: this.config.callId }, "First speaker = user — skipping opening greeting");
      // No greeting to wait for — the caller's first turn IS their intro, so arm now.
      this.armGenderDetection();
      return;
    }
    this.isProcessing = true;
    try {
      // IVR pre-filter: play menu, collect a digit, then fall through to normal greeting
      if (this.agent.ivrEnabled && this.agent.ivrGreeting) {
        const transferred = await this.runIvr();
        if (transferred || this.closed) return; // call was routed away — do not greet
      }

      // Returning callers (normal): instant name opener — no greeting LLM
      // (call 2636: ~3.1s silence waiting on Gemini). Resume-after-drop callbacks
      // skip the instant opener and use the greeting LLM + CALLER MEMORY /
      // LAST EXCHANGES so the model acknowledges the cut and continues mid-thread
      // (call 2683) — never a hardcoded cut-call phrase.
      const isReturningCaller = this.config.isReturningCaller === true;
      const resumeDropped = this.isResumeDroppedCall;
      // Outbound (campaign / sheet / WhatsApp dial) must use the agent greeting /
      // LLM opener — never the inbound "Hi! How are you?" returning-caller shortcut
      // (call 3419: QuickBooks Betty pitch skipped for a prior callCount ≥ 1).
      const useInstantReturning =
        isReturningCaller && !resumeDropped && this.callDirection !== "outbound";
      const greetLang =
        this.currentLang || this.agent.sttConfig.language || this.agent.language || "en-IN";
      let greeting = useInstantReturning
        ? buildInstantReturningGreeting(this.config.returningCallerName, greetLang)
        : (resumeDropped ? "" : (this.agent.greetingMessage ?? ""));

      // Stub static greetings ("Hello", "Hi!") on outbound leave the real pitch
      // trapped in the system prompt CALL FLOW — the callee hears one word then
      // silence and the carrier often drops the media WS (mislabeled hangup).
      if (
        !useInstantReturning
        && !resumeDropped
        && this.callDirection === "outbound"
        && isStubGreeting(greeting)
      ) {
        logger.info(
          { callId: this.config.callId, stub: greeting.slice(0, 40) },
          "Pipeline: outbound stub greeting — generating opener from system prompt instead",
        );
        greeting = "";
      }

      // Language-aware greeting: a non-English agent whose static welcome message
      // is still plain English (e.g. the builder default "Hello! How can I help
      // you today?") would otherwise open the call in English and anchor the
      // entire conversation to English — the model sees its own English opener in
      // history and keeps replying in English despite the language rule. When the
      // target language is non-English (an Indic language) and the saved greeting
      // contains NO Indic-script characters, drop it so the empty-greeting path
      // below asks the LLM for a natural, localized opener instead. Greetings the
      // operator actually wrote in the target script (\u0900-\u0DFF) — and all
      // English agents — are left untouched.
      if (
        !useInstantReturning &&
        greeting.trim() &&
        !greetLang.toLowerCase().startsWith("en") &&
        !/[\u0900-\u0DFF]/.test(greeting)
      ) {
        logger.info(
          { callId: this.config.callId, greetLang },
          "Pipeline: static greeting is not in the agent's language — generating a localized opener instead",
        );
        greeting = "";
      }

      let greetingEmotions: string[] | undefined;

      // Substitute {caller_salutation} in the greeting with the neutral salutation —
      // gender detection has not fired yet at greeting time.
      if (greeting) {
        const resolvedSal = this.salutationFor(null);
        greeting = this.substituteSalutation(greeting, resolvedSal);
        logger.info(
          {
            callId: this.config.callId,
            resolvedSalutation: resolvedSal || "(empty)",
            instantReturning: useInstantReturning,
            resumeDropped,
          },
          "Pipeline: greeting prepared",
        );
      }

      if (!greeting.trim()) {
        // Cold-caller path with empty static greeting: ask the LLM for a short opener.
        // The AMD confirmation window may have prewarmed this in parallel (outbound
        // dead-air fix: AMD window + greeting LLM used to stack serially).
        if (this._greetingPrewarm) {
          greeting = await this._greetingPrewarm;
          this._greetingPrewarm = null;
        } else {
          greeting = await this.generateGreetingLlmText(resumeDropped, greetLang);
        }
        if (this.closed) return;
        // Strip <think> reasoning blocks and markup. For Cartesia, extract the
        // leading <emotion> tag first so it can be forwarded to the voice controls
        // while TTS receives clean text (all other TTS engines ignore the emotion).
        const _strippedGreeting = stripReasoningBlocks(greeting).trim();
        const { emotion: _greetingEmotion, text: _greetingNoEmotion } = extractEmotionTag(_strippedGreeting);
        greetingEmotions = _greetingEmotion ? mapEmotionToCartesia(_greetingEmotion) : undefined;
        if (_greetingEmotion && greetingEmotions) {
          logger.info(
            { callId: this.config.callId, evt: "emotion_applied", emotion: _greetingEmotion, emotions: greetingEmotions, textSnippet: _greetingNoEmotion.slice(0, 80) },
            "Emotion tag forwarded to TTS",
          );
        }
        greeting = stripJsonMessageWrapper(
          _greetingNoEmotion
            .replace(/<\/?emotion[^>]*>/gi, "")
            .replace(/<break[^>]*\/?>/gi, "")
            .replace(/[^\S\r\n]{2,}/g, " ")
            .trim(),
        );
        if (resumeDropped && greeting.trim()) {
          this.logExec("Agent", "system", {
            status: "info",
            turnNumber: 0,
            metadata: {
              event: "Resume Drop Greeting",
              language: greetLang,
              text: greeting.slice(0, 160),
            },
          });
        }
      } else if (useInstantReturning) {
        this.logExec("Agent", "system", {
          status: "info",
          turnNumber: 0,
          metadata: {
            event: "Instant Returning Greeting",
            name: this.config.returningCallerName ?? null,
            language: greetLang,
            text: greeting.slice(0, 120),
          },
        });
      }

      if (!greeting.trim() || this.closed) return;
      logger.info({ callId: this.config.callId, greeting: greeting.slice(0, 80) }, "Sending greeting");
      this.firstAudioSentAt = null;
      this.bargeInHoldUntil = Date.now() + this.bargeInEchoGraceMs;
      // Live Call (carrier) path: protect the FULL greeting from streaming-STT and
      // energy self-echo. The per-sentence 600 ms grace is far too short for the
      // carrier echo of a multi-second opening line (call 772: echo at +777 ms
      // tripped a 1-word barge-in and killed the greeting). Web calls have browser
      // AEC and must keep mid-greeting interruptibility, so this is telephony-only.
      if (this.config.telephonyProvider !== "webcall") {
        const estGreetMs = Math.round(greeting.length * 70);
        // Cap the hold so a long estimated greeting can't lock the caller out of
        // barging in for more than ~3s after the greeting starts.
        this.greetingEchoHoldUntil = Date.now() + Math.min(
          estGreetMs + CARRIER_ECHO_LATENCY_MS,
          GREETING_ECHO_HOLD_CAP_MS,
        );
      }
      this._currentTurnPlayedSentences = [];
      this.isPlaying = true;
      const bootLatencyMs = Date.now() - (this.config.sessionCreatedAtMs ?? Date.now());
      logger.info(
        { callId: this.config.callId, bootLatencyMs, greetingLen: greeting.length },
        "Call pipeline boot complete — playing opening greeting",
      );
      this.logExec("Pipeline", "system", {
        status: "info",
        metadata: { bootLatencyMs, greetingLen: greeting.length },
      });
      try {
        await this.playTextAsSentences(greeting, greetingEmotions);
      } finally {
        this.isPlaying = false;
        this.armTailEchoGrace();
      }
      // Heard-only: never fall back to full greeting text after a barge mid-open.
      const heardGreeting = this.getHeardAgentText();
      if (heardGreeting) {
        this.conversationHistory.appendAssistant(heardGreeting);
        this.lastAssistantSpokenRaw = heardGreeting;
        this.config.onTranscript("agent", heardGreeting);
        this.config.onConversationUpdate?.(this.conversationHistory.messages);
      }
      // Drain the carrier's jitter buffer so the greeting's final word plays out
      // fully before we arm the stall backstop and enter Listening.
      await this.drainPlaybackTail();
      // First entry into Listening — arm the stall backstop.
      if (!this.closed) {
        this.safetyNet.beginListening();
        // So a VoBiz media WS drop while we wait for the first reply is labeled
        // media_disconnect instead of false "Caller hung up" (calls 3429/3432).
        this.expectingShortReplyUntil = Math.max(
          this.expectingShortReplyUntil,
          Date.now() + 60_000,
        );
      }
    } catch (err) {
      // Greeting TTS synthesis / playback failed. Surface the TTS provider and a
      // human-readable reason so the failing dependency is identifiable, but do
      // NOT fail the session — the call stays up and listening so the caller can
      // speak (and the agent can respond via the normal turn path).
      const greetReason = toReadableError(err, "Greeting playback/TTS error");
      logger.error(
        { callId: this.config.callId, agentId: this.agent.id, ttsProvider: this.agent.ttsProvider, err },
        greetReason,
      );
      this.reportTtsFailure(greetReason, { where: "greeting" });
      if (!this.closed) this.safetyNet.beginListening();
    } finally {
      this.isProcessing = false;
      // Greeting has been delivered (or failed) — the next caller audio is their
      // intro turn. Arm detection now so we sample THAT, not the greeting echo.
      this.armGenderDetection();
    }
  }

  // ── Voicemail delivery (Vobiz AMD leave_message) ──────────────────────────────

  /**
   * Voicemail-delivery mode entry point — used INSTEAD of greet() when the answer
   * webhook detected an answering machine and the agent's voicemailAction is
   * "leave_message". The conversation pipeline is NOT run.
   *
   * Flow:
   *   1. Stream comfort-noise silence to Vobiz while we listen (Vobiz drops the call
   *      after ~2 s of no outbound audio, so we MUST keep emitting frames).
   *   2. Detect end-of-greeting acoustically: once the machine's greeting has been
   *      heard (inbound VAD energy), wait for a sustained silence gap (≈ the record
   *      beep) before speaking. A maxWait fallback fires if no greeting/end is heard
   *      (e.g. a silent or beep-only machine) so the message is never dropped.
   *   3. Speak the configured message ONCE in full, drain the carrier's playout
   *      buffer so the final words aren't clipped, then hang up.
   *
   * This replaces the old blind-timer XML (`<Wait>`+`<Speak>`) that overlapped the
   * greeting and only recorded the message tail.
   */
  /**
   * Acoustic AMD confirmation — used INSTEAD of greet() when the answer webhook
   * reported an UNRELIABLE "machine" hint (VoBiz synchronous AMD false-positives on
   * live humans). The media stream is already open; we NEVER enact the voicemail
   * action on the raw hint. Instead we hold the greeting briefly and confirm the
   * verdict from the inbound speech-energy pattern, biasing strongly toward human:
   *
   *   - MACHINE: a single continuous speech run reaches AMD_CONTINUOUS_GREETING_MS
   *     (a voicemail greeting is a long monologue).
   *   - HUMAN: a short utterance ("hello?") followed by a pause, OR no greeting heard
   *     at all shortly after answer, OR the confirmation window elapses ambiguously.
   *
   * Only a confirmed machine enacts `action` (leave_message / hangup / continue). The
   * confirmed verdict — not the raw flag — is persisted via onAmdResult.
   */
  /**
   * Feed an EXTERNAL AMD verdict (async provider callback — VoBiz
   * machine_detection_url → /webhooks/vobiz/amd) into the acoustic confirmation
   * window. Single-resolution semantics: signals arriving after the window has
   * resolved (or when no confirmation was armed) are logged and ignored.
   * A "human" signal resolves human immediately; a "machine" signal is a
   * corroborating input only — it lowers the continuous-speech bar and extends
   * the window, but acoustic evidence still decides.
   */
  onExternalAmdSignal(verdict: "machine" | "human", source: string): void {
    if (this.closed || !this.amdConfirm || this.amdResolved) {
      logger.info(
        {
          callId: this.config.callId, agentId: this.agent.id, verdict, source,
          closed: this.closed, armed: !!this.amdConfirm, resolved: this.amdResolved,
          priorExternalVerdict: this.amdExternalVerdict,
        },
        "External AMD signal ignored (late/duplicate or confirmation not armed)",
      );
      return;
    }
    if (this.amdExternalVerdict !== null) {
      logger.info(
        { callId: this.config.callId, agentId: this.agent.id, verdict, source, priorExternalVerdict: this.amdExternalVerdict },
        "External AMD signal ignored (duplicate — first signal wins)",
      );
      return;
    }
    this.amdExternalVerdict = verdict;
    this.amdExternalSource = source;
    logger.info(
      { callId: this.config.callId, agentId: this.agent.id, verdict, source, confirming: this.amdConfirming },
      "External AMD signal accepted — feeding acoustic confirmation window",
    );
  }

  /** Sample rate of the raw-PCM output leg (8000 unless a webcall client
   *  negotiated HD 16k). Only meaningful when rawPcmOutput is true. */
  private pcmOutRate(): number {
    return this.config.rawPcmOutput ? (this.config.rawPcmOutputRate ?? 8000) : 8000;
  }

  async confirmAmdMachineThenBranch(): Promise<void> {
    if (this.closed) return;
    const action = this.amdConfirm?.action ?? "hangup";

    // 20 ms comfort-noise frame keeps the Vobiz bridge alive while we listen silently.
    const FRAME_MS    = 20;
    const FRAME_BYTES = this.config.rawPcmOutput ? FRAME_MS * (this.pcmOutRate() / 1000) * 2 : FRAME_MS * 8;
    const silenceFrame = Buffer.alloc(FRAME_BYTES, 0);

    this.amdConfirming = true;
    // This loop is now the SOLE frame sender — silence the keepalive watchdog
    // so two pumps never interleave on the same socket (helicopter chop).
    this.amdVmManualPumpActive = true;
    // Outbound dead-air fix: the greeting LLM (1–3s) used to start only AFTER
    // this confirmation window (1.2–3.2s). Prewarm it in parallel; greet()
    // consumes the promise. Wasted only when the verdict is machine + hangup.
    if (this.greetingWillNeedLlm()) {
      const preLang = this.currentLang || this.agent.sttConfig.language || this.agent.language || "en-IN";
      this._greetingPrewarm = this.generateGreetingLlmText(this.isResumeDroppedCall, preLang).catch(() => "");
      logger.info({ callId: this.config.callId }, "AMD confirm: greeting LLM prewarm started in parallel");
    }
    const startedAt = Date.now();
    logger.info(
      {
        callId: this.config.callId, agentId: this.agent.id, action,
        windowMs: AMD_CONFIRM_WINDOW_MS, hint: this.amdConfirm?.hint ?? false,
      },
      this.amdConfirm?.hint
        ? "AMD acoustic confirmation: machine hint received — holding greeting to confirm before enacting"
        : "AMD acoustic confirmation: armed unconditionally (AMD enabled, async callback pending) — holding greeting to confirm",
    );

    let verdict: "human" | "machine" = "human";
    let signal = "window-elapsed";
    let nextTick = Date.now() + FRAME_MS;
    // Window may be extended ONCE when an external "machine" callback arrives,
    // giving the acoustics time to corroborate a late verdict.
    let windowMs = AMD_CONFIRM_WINDOW_MS;
    let windowExtended = false;
    while (!this.closed) {
      this.config.onAudioOut(silenceFrame);
      const now = Date.now();
      const elapsed = now - startedAt;
      const sinceSpeech = this.amdLastSpeechAt ? now - this.amdLastSpeechAt : Infinity;
      // External async callback said HUMAN → trust it, greet immediately.
      if (this.amdExternalVerdict === "human") {
        verdict = "human"; signal = `external-human:${this.amdExternalSource}`; break;
      }
      // External "machine" pending: extend the hard cap once and lower the
      // continuous-speech bar — but still require acoustic corroboration.
      if (this.amdExternalVerdict === "machine" && !windowExtended) {
        windowExtended = true;
        windowMs = elapsed + AMD_EXTERNAL_MACHINE_EXTEND_MS > AMD_CONFIRM_WINDOW_MS
          ? elapsed + AMD_EXTERNAL_MACHINE_EXTEND_MS
          : AMD_CONFIRM_WINDOW_MS;
      }
      const continuousBarMs = this.amdExternalVerdict === "machine"
        ? Math.min(AMD_CONTINUOUS_GREETING_MS, AMD_EXTERNAL_MACHINE_CONTINUOUS_MS)
        : AMD_CONTINUOUS_GREETING_MS;
      // Machine: sustained continuous greeting monologue.
      if (this.amdMaxContinuousMs >= continuousBarMs) {
        verdict = "machine";
        signal = this.amdExternalVerdict === "machine"
          ? "continuous-greeting+external-machine" : "continuous-greeting";
        break;
      }
      // Human: short utterance ("hello?") then a pause, with no long run so far.
      // Skipped while an external "machine" verdict is pending corroboration —
      // some voicemail greetings start with a short phrase + pause.
      if (this.amdExternalVerdict !== "machine"
          && this.amdHeardSpeech && this.amdRunStartAt === 0
          && this.amdMaxContinuousMs < AMD_CONTINUOUS_GREETING_MS
          && sinceSpeech >= AMD_HUMAN_PAUSE_MS) {
        verdict = "human"; signal = "short-utterance-pause"; break;
      }
      // Human: no greeting heard at all shortly after answer (a machine greets at once).
      // Also skipped while an external "machine" verdict awaits corroboration.
      if (this.amdExternalVerdict !== "machine"
          && !this.amdHeardSpeech && elapsed >= AMD_NO_SPEECH_HUMAN_MS) {
        verdict = "human"; signal = "no-speech"; break;
      }
      // Ambiguous by the hard cap → human (bias toward not harming a live caller).
      if (elapsed >= windowMs) {
        verdict = "human"; signal = windowExtended ? "window-elapsed-extended" : "window-elapsed"; break;
      }
      const delay = Math.max(0, nextTick - now);
      nextTick += FRAME_MS;
      await new Promise<void>((r) => setTimeout(r, delay));
    }

    this.amdConfirming = false;
    // Hand the channel back to the watchdog until the next manual pump (the
    // voicemail wait loop re-takes it; greet() uses the normal watchdog path).
    this.amdVmManualPumpActive = false;
    this.amdResolved = true; // single resolution — later external callbacks are ignored
    if (this.closed) return;

    logger.info(
      {
        callId: this.config.callId, agentId: this.agent.id,
        verdict, signal, action,
        hint: this.amdConfirm?.hint ?? false,
        externalVerdict: this.amdExternalVerdict,
        externalSource: this.amdExternalSource,
        waitedMs: Date.now() - startedAt,
        heardSpeech: this.amdHeardSpeech,
        maxContinuousMs: this.amdMaxContinuousMs,
      },
      verdict === "machine"
        ? "AMD acoustic confirmation: MACHINE confirmed — enacting voicemail action"
        : "AMD acoustic confirmation: HUMAN — proceeding with normal greeting (machine hint rejected)",
    );

    // Persist the acoustically-confirmed verdict (never the raw provider flag).
    try { this.config.onAmdResult?.(verdict); } catch { /* best-effort */ }

    if (verdict === "machine") {
      if (action === "leave_message" && this.voicemailDelivery) {
        await this.deliverVoicemail();
      } else if (action === "continue") {
        await this.greet();
      } else {
        // "hangup" (default) or leave_message with no message configured.
        // Confirmed machine + hangup executed → distinct voicemail outcome.
        try { this.config.onVoicemailAction?.(); } catch { /* best-effort */ }
        this.config.onCallEnd();
      }
      return;
    }
    // Human (or ambiguous) → normal conversation.
    await this.greet();
  }

  async deliverVoicemail(): Promise<void> {
    const vd = this.voicemailDelivery;
    if (!vd || this.closed) return;
    // Arm the voicemail-listening branch in onRawPcm8kIn (see vmDelivering note).
    this.vmDelivering = true;
    // The wait/lead-in loops below are the SOLE frame sender — silence the
    // keepalive watchdog so two pumps never interleave (helicopter chop).
    // Released just before playback so the watchdog's first-byte/stall
    // gap-fill still protects playSentence from the VoBiz 4010 drop.
    this.amdVmManualPumpActive = true;
    const margin  = vd.postSilenceMarginMs ?? VOICEMAIL_GREETING_END_SILENCE_MS;
    const maxWait = vd.maxWaitMs ?? VOICEMAIL_MAX_WAIT_MS;
    const leadInMs = Math.max(0, Math.round((vd.leadInSeconds ?? 0) * 1000));

    // 20 ms comfort-noise frame, sized to the negotiated output format.
    const FRAME_MS    = 20;
    const FRAME_BYTES = this.config.rawPcmOutput ? FRAME_MS * (this.pcmOutRate() / 1000) * 2 : FRAME_MS * 8;
    const silenceFrame = Buffer.alloc(FRAME_BYTES, 0);

    const startedAt = Date.now();
    logger.info(
      { callId: this.config.callId, marginMs: margin, maxWaitMs: maxWait },
      "Voicemail delivery: listening for the machine greeting to end before speaking",
    );

    let trigger: "greeting-end" | "max-wait" = "max-wait";
    let nextTick = Date.now() + FRAME_MS;
    while (!this.closed) {
      // Keep the Vobiz audio bridge alive while we wait silently.
      this.config.onAudioOut(silenceFrame);
      const now = Date.now();
      if (this.vmHeardSpeech && (now - this.vmLastSpeechAt) >= margin) { trigger = "greeting-end"; break; }
      if (now - startedAt >= maxWait) { trigger = "max-wait"; break; }
      const delay = Math.max(0, nextTick - now);
      nextTick += FRAME_MS;
      await new Promise<void>((r) => setTimeout(r, delay));
    }

    if (this.closed) { this.amdVmManualPumpActive = false; return; }
    logger.info(
      {
        callId: this.config.callId,
        trigger,
        waitedMs: Date.now() - startedAt,
        heardGreeting: this.vmHeardSpeech,
        messagePreview: vd.message.slice(0, 80),
      },
      trigger === "greeting-end"
        ? "Voicemail delivery: greeting ended — speaking the full message"
        : "Voicemail delivery: max-wait fallback fired (no greeting end heard) — speaking the full message",
    );

    // Configured Lead-in Pause: after the greeting/beep ends, wait a bit longer so a
    // slow machine finishes its record beep before the message begins. Keep the audio
    // bridge alive with comfort-noise frames during the wait.
    if (leadInMs > 0 && !this.closed) {
      const leadStart = Date.now();
      let leadTick = leadStart + FRAME_MS;
      while (!this.closed && Date.now() - leadStart < leadInMs) {
        this.config.onAudioOut(silenceFrame);
        const now = Date.now();
        const delay = Math.max(0, leadTick - now);
        leadTick += FRAME_MS;
        await new Promise<void>((r) => setTimeout(r, delay));
      }
    }

    // Manual pumping ends HERE — playSentence's paced sender takes over, with
    // the keepalive watchdog re-enabled to cover its first-byte wait / stalls.
    // Exactly one sender is active at any moment either side of this line.
    this.amdVmManualPumpActive = false;
    if (this.closed) return;
    logger.info(
      { callId: this.config.callId },
      "Voicemail delivery: manual frame pump released — starting message playback (watchdog gap-fill re-armed)",
    );
    this.firstAudioSentAt = null;
    this.isPlaying = true;
    try {
      await this.playSentence(vd.message);
    } catch (err) {
      logger.error(
        { callId: this.config.callId, agentId: this.agent.id, ttsProvider: this.agent.ttsProvider, err },
        toReadableError(err, "Voicemail delivery TTS/playback error"),
      );
    } finally {
      this.isPlaying = false;
      this.armTailEchoGrace();
    }
    // Drain the carrier's jitter buffer so the message's final word lands in the
    // recording (sends real silence frames — critical for Vobiz).
    await this.drainPlaybackTail();
    logger.info({ callId: this.config.callId }, "Voicemail delivery: message playback complete — ending call");
    // A voicemail message was actually delivered → distinct voicemail outcome.
    try { this.config.onVoicemailAction?.(); } catch { /* best-effort */ }
    this.config.onCallEnd();
  }

  // ── VAD timers ──────────────────────────────────────────────────────────────

  private resetSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  private scheduleSilenceFlush(): void {
    if (this.silenceTimer) return;
    // ── Adaptive endpoint window ───────────────────────────────────────────
    const lastAgentText = this.conversationHistory.findLast(t => t.role === "assistant")?.content ?? "";
    const partialTranscript = this.pendingTranscriptQueue.length > 0 ? this.pendingTranscriptQueue[this.pendingTranscriptQueue.length - 1].text : "";
    // audioBuffer holds 8kHz 8-bit PCM: 8000 bytes/s → 1 ms ≈ 8 bytes
    const audioBufferMs = Math.round(
      this.audioBuffer.reduce((s, b) => s + b.length, 0) / 8
    );
    const { ms, reason } = computeEndpointMs({
      lastAgentText,
      partialTranscript,
      audioBufferMs,
      baseSilenceMs: this.vadSilenceMs,
    });
    this._lastEndpointMs = ms;
    this._lastEndpointReason = reason;
    this.silenceTimer = setTimeout(() => {
      this.silenceTimer = null;
      void this.flushAndProcess();
    }, ms);
  }

  /**
   * Reset (or start) the silence-hangup watchdog. On a legitimate expiry the
   * watchdog speaks an in-language "are you there?" check-in first and only
   * ends the call (via the inactivity path) if the caller stays silent for a
   * further full window. Raw caller speech energy on either STT path keeps it
   * alive even when streaming STT emits no partials (call 1915).
   */
  private resetHangupTimer(): void {
    if (!this.agent.silenceTimeoutSeconds) return;
    if (!this.silenceWatchdog) {
      this.silenceWatchdog = new SilenceWatchdog({
        timeoutMs: this.agent.silenceTimeoutSeconds * 1000,
        isBusy: () => this.isPlaying || this.isSendingTtsAudio || this.isProcessing,
        onReprompt: () => {
          if (!this.closed) void this.silenceCheckIn();
        },
        onGiveUp: () => {
          if (this.closed) return;
          logger.info({ callId: this.config.callId }, "Silence timeout — ending call");
          void this.playInactivityMessageAndEnd();
        },
        // Diagnostic-only: the watchdog was about to expire but re-armed instead
        // (agent busy, or raw caller speech energy was seen recently). Logged so a
        // false hangup elsewhere is diagnosable directly from call logs — without
        // this, a near-miss leaves no trace at all.
        onNearMiss: (info) => {
          logger.info(
            { callId: this.config.callId, ...info },
            "Silence watchdog near-miss — re-armed instead of expiring",
          );
        },
      });
    }
    this.silenceWatchdog.reset();
  }

  /**
   * Silence-hangup check-in: the watchdog expired once with no caller speech.
   * Speak a short in-language "are you there?" so the caller gets an audible
   * chance to respond before the call is ended. The watchdog has already
   * re-armed a full window; deliberately does NOT call resetHangupTimer(),
   * which would clear the watchdog's check-in count and loop forever.
   */
  private async silenceCheckIn(): Promise<void> {
    if (this.closed || this.isProcessing || this.isPlaying) return; // busy — watchdog re-arms itself
    this.prepareSystemPlayback();
    logWarningEvent(this.logFn, EXEC_COMPONENTS.STT, "Silence Check-in", ["silence_reprompt"], {
      turnNumber: this._activeTurnIndex,
      detail: { reason: "silence-hangup window expired — checking if caller is still there" },
    });
    const text = inactivityReprompt(this.currentLang || this.agent.language);
    this.bargeInHoldUntil = Date.now() + this.bargeInEchoGraceMs;
    this.isPlaying = true;
    try {
      await this.playSentence(text);
    } catch (err) {
      logger.error({ callId: this.config.callId, err }, "Silence check-in playback error");
    } finally {
      this.isPlaying = false;
      this.systemPlaybackActive = false;
      this.armTailEchoGrace();
    }
    await this.drainPlaybackTail();
  }

  /**
   * Graceful max-duration end. Called by the session's max-duration timer instead
   * of closing the pipeline outright. If the agent is idle, resolves immediately
   * so the caller can tear the session down as before. If the agent is mid-
   * playback, it signals the active playTask to stop after the current sentence
   * and waits (bounded by `graceMs`) for playback + tail-drain to settle, so the
   * caller never hears speech cut off mid-word. The wait is hard-capped so a call
   * can never run drastically past its configured max duration.
   */
  async finishSpeakingForMaxDuration(graceMs: number): Promise<void> {
    if (this.closed) return;
    // Idle (not actively speaking and not mid-turn): nothing to drain — end now.
    if (!this.isPlaying && !this.isSendingTtsAudio) return;
    logger.info(
      { callId: this.config.callId, graceMs },
      "Max duration reached mid-playback — finishing current sentence before teardown",
    );
    this.endAfterCurrentSentence = true;
    const deadline = Date.now() + Math.max(0, graceMs);
    // playTask sets isPlaying=false only after it breaks AND its own
    // drainPlaybackTail completes, so waiting on isPlaying covers the full
    // finish-sentence + drain window. Bounded by the grace cap.
    while ((this.isPlaying || this.isSendingTtsAudio) && !this.closed && Date.now() < deadline) {
      await new Promise<void>((r) => setTimeout(r, 50));
    }
  }

  /**
   * Speak the inactivity farewell (configured message, or a default in-language
   * line so the call is never dropped silently) before triggering call end.
   * Tags the teardown as a silence timeout so the Call Ended summary reads
   * "Silence timeout" instead of "Conversation completed".
   */
  private async playInactivityMessageAndEnd(): Promise<void> {
    this.endReasonHint ??= "silence_timeout";
    this.prepareSystemPlayback();
    const farewell = this.agent.inactivityMessage?.trim()
      || inactivityFarewell(this.currentLang || this.agent.language);
    if (!this.closed) {
      try {
        await this.playSentence(farewell);
        await this.drainPlaybackTail();
      } catch { /* ignore */ }
    }
    if (!this.closed) this.config.onCallEnd();
  }

  // ── TTS playback ─────────────────────────────────────────────────────────────

  /**
   * Write a per-call execution-log row (fire-and-forget). Mirrors the web-call
   * path's `logExecution` so the Call Log "Logs" tab shows an identical,
   * chronological timeline for live (telephony) calls. Never throws.
   */
  private logExec(component: string, direction: ExecDirection, opts: ExecLogOpts = {}): void {
    writeExecutionLog(this.config.callId, this.agent.id, component, direction, opts);
  }

  /** Bound logger shaped as `ExecLogFn` so shared lifecycle helpers can drive
   *  the telephony path identically to the web-call path. */
  private readonly logFn: ExecLogFn = (component, direction, opts = {}): void =>
    writeExecutionLog(this.config.callId, this.agent.id, component, direction, opts);

  /** True once onProviderIssue has fired for TTS — the notice is one-shot per call. */
  private ttsIssueNotified = false;

  /**
   * Non-fatal TTS failure reporting. Every failure writes an exec-log warning row
   * (so the call's Logs tab names the reason), and the FIRST failure notifies the
   * transport via onProviderIssue (so the browser Live Test panel shows WHY the
   * call is mute instead of silently dropping audio). Never ends the call —
   * per-sentence TTS errors must stay non-fatal (see the catch sites).
   */
  private reportTtsFailure(reason: string, detail: Record<string, unknown> = {}): void {
    logWarningEvent(this.logFn, EXEC_COMPONENTS.TTS, "Provider Failed", ["provider_error"], {
      provider: this.agent.ttsProvider,
      errorMessage: reason,
      detail,
    });
    if (!this.ttsIssueNotified) {
      this.ttsIssueNotified = true;
      this.config.onProviderIssue?.(
        "tts",
        `Voice synthesis is failing (${this.agent.ttsProvider}) — the call is continuing without audio. ${reason}`,
      );
    }
  }

  /** Final user + agent utterances, for the Call-Ended summary card. */
  getLastTurnTexts(): { lastUser: string | null; lastAgent: string | null } {
    let lastUser: string | null = null;
    let lastAgent: string | null = null;
    for (let i = this.conversationHistory.messages.length - 1; i >= 0; i--) {
      const t = this.conversationHistory.messages[i]!;
      if (lastAgent === null && t.role === "assistant" && t.content) lastAgent = t.content;
      if (lastUser === null && t.role === "user" && t.content) lastUser = t.content;
      if (lastUser !== null && lastAgent !== null) break;
    }
    return { lastUser, lastAgent };
  }

  /**
   * Media WS closed while we were waiting for a short reply after a question.
   * Prefer this label over generic "Caller hung up" (QA often kept the phone up).
   */
  noteMediaDropIfWaitingForReply(): void {
    if (this.endReasonHint) return;
    if (Date.now() >= this.expectingShortReplyUntil) return;
    // Recent caller energy/STT → normal hangup after a question, not a media failure.
    if (this.lastCallerActivityAt > 0 && Date.now() - this.lastCallerActivityAt < 12_000) {
      return;
    }
    this.endReasonHint = "media_disconnect";
    logger.warn(
      { callId: this.config.callId, expectingMsLeft: this.expectingShortReplyUntil - Date.now() },
      "Media stream closed while expecting short caller reply — labeling media_disconnect",
    );
  }

  /**
   * Public playback wrapper — emits the Playback Started/Completed/Interrupted/
   * Cancelled lifecycle rows around the real synthesis+send. ALL telephony
   * playback (greeting, turns, stall reprompts, goodbye) funnels through here,
   * mirroring the web-call playback lifecycle.
   */
  private playSentence(text: string, emotions?: string[]): Promise<void> {
    const seqId = this.interruptionMgr.beginAgentTurn();
    this.activeAgentSequenceId = seqId;
    return this.playJob(this.startSentenceSynthesis(text, this._activeTurnIndex, seqId, undefined, emotions));
  }

  /**
   * Like playSentence, but for LONG single-shot texts (greeting, voicemail
   * message). Splits the text into sentences and plays them with the same
   * synthesize-N+1-while-N-plays prefetch the turn queues use. A single 250-char
   * TTS request makes the provider stream fall behind real-time mid-delivery
   * (call 5047: 16 s greeting audio arrived over 9.2 s but with slow patches →
   * audible mid-sentence gaps); per-sentence requests keep each synthesis short
   * and absorb the next sentence's latency inside current playback.
   */
  private async playTextAsSentences(text: string, emotions?: string[]): Promise<void> {
    const { sentences, remainder } = extractSentences(text, this.agent.ttsMinSentenceChars);
    if (remainder.trim()) sentences.push(remainder.trim());
    if (sentences.length <= 1) return this.playSentence(text, emotions);
    const seqId = this.interruptionMgr.beginAgentTurn();
    this.activeAgentSequenceId = seqId;
    let next = this.startSentenceSynthesis(sentences[0]!, this._activeTurnIndex, seqId, undefined, emotions);
    for (let i = 0; i < sentences.length; i++) {
      const job = next;
      if (i + 1 < sentences.length) {
        // Prefetch: kick off the next sentence's synthesis BEFORE awaiting playback.
        next = this.startSentenceSynthesis(sentences[i + 1]!, this._activeTurnIndex, seqId, undefined, emotions);
      }
      await this.playJob(job);
      if (this.closed || this.bargeInRequested || !this.interruptionMgr.isValidSequence(seqId)) break;
    }
  }

  /**
   * Wraps a TTS synthesis job with the Playback Started/Completed telemetry
   * and isSendingTtsAudio bookkeeping (previously inlined in playSentence).
   * Used both by playSentence (single-shot callers: greeting, IVR, hold/
   * transfer messages, clarifications — behaviorally unchanged) and directly
   * by the turn sentence-queues (processTurn/continueWithToolResult), which
   * pass in a job that may already be synthesizing in the background — see
   * startSentenceSynthesis for why that prefetch is safe.
   */
  private async playJob(job: TtsSentenceJob): Promise<void> {
    if (this.bargeInRequested) return;
    // Voice Memory handoff takeover — drop in-flight LLM sentences so the
    // forced "who am I speaking with?" line can own the channel.
    if (this.skipAgentPlaybackForHandoff && !this.speakingSpeakerHandoffChallenge) return;
    // Track what the agent is about to speak so the streaming-STT path can reject
    // this same audio when the carrier echoes it back (content-based self-echo).
    this.recordAgentSpeech(job.text);
    this._activePlaybackText = job.text;
    this._activePlaybackStartedAt = Date.now();
    const _pbStart = Date.now();
    const _pbTurn = job.turnNumber;
    logPlaybackEvent(this.logFn, "Playback Started", { provider: this.agent.ttsProvider, turnNumber: _pbTurn });
    let _pacedMs: number | undefined;
    let _claimedMs: number | undefined;
    this.isSendingTtsAudio = true;
    try {
      const drain = await this.drainSentenceJob(job);
      _pacedMs = drain?.pacedMs;
      _claimedMs = drain?.claimedMs ?? job.audioDurationMs;
    } finally {
      this.isSendingTtsAudio = false;
      if (this._activePlaybackText === job.text) {
        this._activePlaybackText = null;
        this._activePlaybackStartedAt = null;
      }
      const noAudioSent = _pacedMs === undefined || _pacedMs <= 0;
      const fullyPlayed =
        !noAudioSent
        && _claimedMs != null
        && _claimedMs > 0
        && _pacedMs! >= _claimedMs * 0.85;
      const _pbEvent: PlaybackEvent = this.closed
        ? "Playback Cancelled"
        : this.bargeInRequested
          ? "Playback Interrupted"
          : noAudioSent
            ? "Playback Cancelled"
            : fullyPlayed
              ? "Playback Completed"
              : "Playback Interrupted";
      logPlaybackEvent(this.logFn, _pbEvent, {
        provider: this.agent.ttsProvider,
        turnNumber: _pbTurn,
        playbackDurationMs: Date.now() - _pbStart,
        audioDurationMs: _pacedMs ?? _claimedMs,
        stopReason: this.closed
          ? "call_closed"
          : this.bargeInRequested
            ? "barge_in"
            : noAudioSent
              ? "audio_gated"
              : fullyPlayed
                ? "completed"
                : "partial_emit",
      });
      // Accumulate fully-played sentences for the interruption hint. Only count
      // sentences that completed — a mid-sentence barge-in means the caller may
      // not have heard the whole thing, so we conservatively exclude that one.
      if (_pbEvent === "Playback Completed" && !noAudioSent) {
        this._currentTurnPlayedSentences.push(job.text);
      }
    }
  }

  /**
   * Starts TTS synthesis for `text` immediately and returns a handle that can
   * be drained (played) later via drainSentenceJob. This lets the turn
   * sentence-queues start synthesizing sentence N+1 while sentence N is still
   * playing, so N+1's network/firstByteMs latency is absorbed during N's
   * playback instead of opening an audible gap after it.
   *
   * Only the network fetch + 4-byte alignment happen here — nothing with a
   * real-world side effect (recording, ambient mixing, wire encoding, pacing)
   * runs until drainSentenceJob actually plays the job. That split matters:
   * synthesis for sentence N+1 can finish (or run) WHILE sentence N is still
   * draining, and if recording/ambient mixing happened here they'd fire out
   * of chronological order — corrupting the recording and (on the raw-PCM
   * webcall path) mixing ambient noise against a stream position that isn't
   * "now" yet. Deferring them to drainSentenceJob keeps both correct because
   * drainSentenceJob only ever runs one job at a time, in play order.
   */
  private startSentenceSynthesis(
    text: string,
    turnNumber: number,
    sequenceId: number,
    turnContextId?: string,
    emotions?: string[],
  ): TtsSentenceJob {
    // ── TTS text normalization ────────────────────────────────────────────────
    // Strip the ₹ currency symbol before synthesis. TTS engines (especially
    // Sarvam) expand it to the formal literary word: "ரூபாய்" (Tamil) /
    // "रुपया" (Hindi) / "rupee" (English) — which sounds stiff and unnatural.
    // Removing the symbol keeps "₹10 lakhs" as "10 lakhs" which TTS reads
    // naturally in colloquial style. The LLM language rule below also prevents
    // ₹ from being generated, but this is a safety net for any that slip through.
    text = text.replace(/₹\s*/g, "");

    // Long ALL-CAPS words (6+ letters, e.g. "CODISSIA") get spelled out
    // letter-by-letter by TTS engines, which treat them as acronyms. Real
    // spoken acronyms (GST, PM, EV, AI, WhatsApp caps like "OK") are short,
    // so title-casing only 6+ letter runs is safe: CODISSIA → Codissia,
    // which engines then pronounce as a normal word.
    text = text.replace(/\b[A-Z]{6,}\b/g, (w) => w[0] + w.slice(1).toLowerCase());

    // Meter characters at request-dispatch time — TTS providers charge for the
    // text submitted when the HTTP request is sent, not when audio delivery
    // completes. Dispatch may now happen while a prior sentence is still
    // playing (prefetch), but the metering semantics are unchanged: once per
    // sentence, at the moment its TTS request goes out.
    this.ttsCharactersTotal += text.length;
    const _ttsReqStart = Date.now();
    this.logExec("TTS", "request", {
      provider: this.agent.ttsProvider,
      status: "info",
      turnNumber,
      requestPayload: { text },
    });

    let resolveReady!: () => void;
    const ready = new Promise<void>((r) => { resolveReady = r; });
    const job: TtsSentenceJob = {
      text,
      turnNumber,
      sequenceId,
      streaming: !!this.tts.synthesizeStream,
      pcmQueue: [],
      synthDone: false,
      synthError: null,
      audioDurationMs: undefined,
      nonStreamAudio: null,
      ready,
    };

    // Dead-air / tool fillers: serve cached PCM (Bolna preset-WAV feel) or synthesize once and cache.
    if (sequenceId === FILLER_SEQUENCE_ID) {
      const cacheKey = {
        provider: this.agent.ttsProvider,
        voice: this.agent.ttsVoice ?? "",
        model: this.agent.ttsModel ?? "",
        text,
      };
      const cached = getCachedFillerPcm(cacheKey);
      void (async () => {
        try {
          if (cached) {
            job.streaming = false;
            job.nonStreamAudio = cached;
            job.audioDurationMs = Math.round((cached.length / 2 / 16000) * 1000);
            this.logExec("TTS", "response", {
              provider: this.agent.ttsProvider,
              status: "success",
              latencyMs: Date.now() - _ttsReqStart,
              turnNumber,
              durationMs: Date.now() - _ttsReqStart,
              responsePayload: { audioBytes: cached.length, textLength: text.length, fillerCacheHit: true },
            });
            return;
          }
          // Prefer one-shot synthesize for cacheable fillers even when stream exists.
          const { audio } = await this.tts.synthesize(text);
          if (this.closed || this.bargeInRequested) return;
          job.streaming = false;
          job.nonStreamAudio = audio;
          job.audioDurationMs = Math.round((audio.length / 2 / 16000) * 1000);
          setCachedFillerPcm(cacheKey, audio);
          this.logExec("TTS", "response", {
            provider: this.agent.ttsProvider,
            status: "success",
            latencyMs: Date.now() - _ttsReqStart,
            turnNumber,
            durationMs: Date.now() - _ttsReqStart,
            responsePayload: { audioBytes: audio.length, textLength: text.length, fillerCacheHit: false },
          });
        } catch (err) {
          job.synthError = err;
        } finally {
          job.synthDone = true;
          resolveReady();
        }
      })();
      return job;
    }

    if (this.tts.synthesizeStream) {
      const ttsAdapter = this.tts;
      const synthesizeStream = ttsAdapter.synthesizeStream!.bind(ttsAdapter);
      let accum: Buffer[] = [];
      let accumSize = 0;
      // Carry bytes that weren't a multiple of 4 across flush() calls so
      // downsample16to8 never silently drops trailing PCM samples and
      // creates click artifacts at streaming chunk boundaries.
      let flushRemainder = Buffer.alloc(0);
      let _ttsAccumBytes = 0; // raw PCM bytes accumulated before downsampling
      let _ttsTotalBytes = 0;
      let _ttsFirstByteMs: number | null = null;

      // Aligns received bytes to a 4-byte boundary and buffers the result into
      // job.pcmQueue for later draining. Pure buffering, no recording/ambient/
      // encoding — safe to run ahead of actual playback.
      const flush = (): void => {
        if (accum.length === 0 || this.closed || this.bargeInRequested) {
          accum = [];
          accumSize = 0;
          return;
        }
        const combined = flushRemainder.length > 0
          ? Buffer.concat([flushRemainder, ...accum])
          : Buffer.concat(accum);
        accum = [];
        accumSize = 0;
        const alignedLen = Math.floor(combined.length / 4) * 4;
        flushRemainder = alignedLen < combined.length
          ? combined.slice(alignedLen)
          : Buffer.alloc(0);
        if (alignedLen === 0) return;
        const pcm16k = combined.slice(0, alignedLen);
        _ttsAccumBytes += pcm16k.length;
        job.pcmQueue.push(pcm16k);
      };

      // AbortController lets us cancel the TTS HTTP connection when:
      //   • the pipeline is closed (call ended / WebSocket dropped), or
      //   • barge-in was requested (including while this job was only prefetching), or
      //   • TTS hasn't produced any data within TTS_STREAM_TIMEOUT_MS (hung API).
      // Without this, a hung Cartesia/ElevenLabs fetch blocks synthesis
      // indefinitely and the caller hears complete silence until Vobiz drops.
      const ttsAbort = new AbortController();
      this.activeTtsAborts.add(ttsAbort);
      const ttsTimerId = setTimeout(() => {
        logger.warn({ callId: this.config.callId }, "TTS streaming timed out — aborting fetch");
        ttsAbort.abort();
      }, TTS_STREAM_TIMEOUT_MS);
      const closedWatcher = setInterval(() => {
        if (this.closed || this.bargeInRequested) ttsAbort.abort();
      }, 50);

      void (async () => {
        try {
          const onTtsChunk = (chunk: Buffer): void => {
            if (this.closed || this.bargeInRequested) return;
            if (this._tTurnTtsFirstByte === null) this._tTurnTtsFirstByte = performance.now();
            if (_ttsFirstByteMs === null) _ttsFirstByteMs = Date.now() - _ttsReqStart;
            _ttsTotalBytes += chunk.length;
            clearTimeout(ttsTimerId); // connection is alive — reset the hung-API timer
            accum.push(chunk);
            accumSize += chunk.length;
            if (accumSize >= STREAM_ACCUM_BYTES) flush();
          };
          const onTtsDone = (_characters: number): void => { flush(); };
          // Cartesia turn-level continuations: share one context_id per LLM
          // turn with manual flushing to maintain prosody across sentences.
          if (turnContextId && ttsAdapter instanceof CartesiaTTS) {
            await ttsAdapter.synthesizeStreamInContext(turnContextId, text, onTtsChunk, onTtsDone, ttsAbort.signal, emotions);
          } else {
            await synthesizeStream(text, onTtsChunk, onTtsDone, ttsAbort.signal);
          }
        } catch (err) {
          const isAbort = err instanceof Error && err.name === "AbortError";
          if (!isAbort) {
            job.synthError = err; // real TTS error — surfaced to the caller in drainSentenceJob
          } else {
            logger.warn({ callId: this.config.callId }, "TTS stream aborted");
          }
        } finally {
          clearTimeout(ttsTimerId);
          clearInterval(closedWatcher);
          this.activeTtsAborts.delete(ttsAbort);
          flush(); // flush any leftover accumulator bytes after aborts
          job.audioDurationMs = Math.round((_ttsAccumBytes / 2 / 16000) * 1000);
          if (!job.synthError) {
            this.logExec("TTS", "response", {
              provider: this.agent.ttsProvider,
              status: "success",
              latencyMs: Date.now() - _ttsReqStart,
              turnNumber,
              durationMs: Date.now() - _ttsReqStart,
              responsePayload: { audioBytes: _ttsTotalBytes, textLength: text.length, firstByteMs: _ttsFirstByteMs },
            });
          }
          job.synthDone = true;
          resolveReady();
        }
      })();
    } else {
      void (async () => {
        const ttsAbort = new AbortController();
        this.activeTtsAborts.add(ttsAbort);
        const closedWatcher = setInterval(() => {
          if (this.closed || this.bargeInRequested) ttsAbort.abort();
        }, 50);
        try {
          const { audio } = await this.tts.synthesize(text);
          if (ttsAbort.signal.aborted || this.bargeInRequested || this.closed) return;
          job.nonStreamAudio = audio;
          this.logExec("TTS", "response", {
            provider: this.agent.ttsProvider,
            status: "success",
            latencyMs: Date.now() - _ttsReqStart,
            turnNumber,
            durationMs: Date.now() - _ttsReqStart,
            responsePayload: { audioBytes: audio.length, textLength: text.length },
          });
        } catch (err) {
          const isAbort = err instanceof Error && err.name === "AbortError";
          if (!isAbort) job.synthError = err;
        } finally {
          clearInterval(closedWatcher);
          this.activeTtsAborts.delete(ttsAbort);
          job.synthDone = true;
          resolveReady();
        }
      })();
    }

    return job;
  }

  /**
   * Plays back an already-started (or already-finished) synthesis job in real
   * time. Downsampling, recording, ambient mixing, mulaw/PCM encoding, and
   * pacing all happen here, strictly in playback order — see
   * startSentenceSynthesis for why that ordering matters under prefetch.
   * Returns paced vs claimed durations so playJob telemetry cannot claim
   * "completed" when WAIT/BLOCK cut the drain short (calls 4852/4853).
   */
  private async drainSentenceJob(
    job: TtsSentenceJob,
  ): Promise<{ pacedMs: number; claimedMs?: number } | undefined> {
    if (job.sequenceId === FILLER_SEQUENCE_ID && this._skipPendingFillerPlayback) return;
    if (this.bargeInRequested) return;
    if (!this.canEmitAudio(job.sequenceId)) {
      const ok = await this.waitForAudioEmit(job.sequenceId);
      if (!ok || this.bargeInRequested) return;
    }

    // Extend echo-grace to cover estimated sentence playback duration.
    // ~70 ms/char covers Tamil/Indic and Latin at typical TTS speech rate
    // (observed: 56-char Tamil sentence ≈ 3600 ms = 64 ms/char). Without
    // this, a 600 ms start-grace can expire while multi-second TTS audio is
    // still playing; on speakerphone or poor-AEC setups the agent's own voice
    // echoes back above the energy threshold and fires a false barge-in.
    // Use Math.max so we never REDUCE a grace that was already set longer.
    {
      const estimatedMs = Math.round(job.text.length * 70);
      this.bargeInHoldUntil = Math.max(
        this.bargeInHoldUntil,
        Date.now() + estimatedMs + this.bargeInEchoGraceMs,
      );
    }

    // Record when this sentence starts so the streaming STT path can apply a
    // per-sentence 600 ms echo grace (bargeInSentenceStartAt + bargeInEchoGraceMs)
    // instead of the extended `bargeInHoldUntil` that protects the batch STT path.
    this.bargeInSentenceStartAt = Date.now();

    /** Wire bytes actually sent (mulaw or PCM8k) — source of truth for pacedMs. */
    let bytesSent = 0;
    const noteSent = (chunk: Buffer) => { bytesSent += chunk.length; };

    if (job.streaming) {
      // Producer-consumer pacing: pcm16k blocks buffered by startSentenceSynthesis
      // are converted to wire-ready chunks here, on demand, then sent at exactly
      // real-time rate (20 ms per 160-byte chunk). This prevents flooding Vobiz /
      // Twilio with a burst of messages that overwhelms their playback buffer.
      const wireQueue: Buffer[] = [];
      let pcmIdx = 0;

      // Converts the next buffered pcm16k block into wire-ready chunks. This is
      // where recording + ambient mixing happen — at real "now", right before
      // the audio is due to be sent, never earlier (see startSentenceSynthesis).
      const processNextBlock = (): boolean => {
        if (pcmIdx >= job.pcmQueue.length) return false;
        const pcm16k = job.pcmQueue[pcmIdx++];
        const pcm8k = downsample16to8(pcm16k);
        // Record agent audio (downsampled to match recording sample rate).
        // Recording stays clean — ambient is mixed only into the outbound copy.
        this.recording.addAgentChunk(pcm8k);
        if (this.config.rawPcmOutput) {
          // Vobiz/web accept LINEAR16 PCM natively — skip mulaw encode to avoid
          // lossy round-trip. Mix ambient under speech (at 16 kHz, where the
          // ambient stream's mixIntoPcm16k operates). HD webcall (16k) keeps the
          // full-bandwidth mix; carrier-grade legs downsample to 8 kHz.
          const rate = this.pcmOutRate();
          const mixed16k = this.ambientStream ? this.ambientStream.mixIntoPcm16k(pcm16k) : pcm16k;
          const out = rate === 16000
            ? mixed16k
            : (this.ambientStream ? downsample16to8(mixed16k) : pcm8k);
          const PCM_CHUNK = CHUNK_SIZE_MULAW * 2 * (rate / 8000); // 20ms: 320B @8k, 640B @16k
          for (let i = 0; i < out.length; i += PCM_CHUNK) {
            wireQueue.push(out.slice(i, i + PCM_CHUNK));
          }
        } else {
          const mulaw = encodeMulaw(pcm8k);
          for (let i = 0; i < mulaw.length; i += CHUNK_SIZE_MULAW) {
            wireQueue.push(mulaw.slice(i, i + CHUNK_SIZE_MULAW));
          }
        }
        return true;
      };

      // Buffered-but-unsent audio in ms (16 kHz s16le pcmQueue = 32 bytes/ms).
      const bufferedMs = () => {
        let bytes = 0;
        for (let i = pcmIdx; i < job.pcmQueue.length; i++) bytes += job.pcmQueue[i].length;
        return bytes / 32 + (wireQueue.length * 20);
      };
      // Jitter buffer: wait until targetMs of audio is queued (or synthesis
      // finishes / capMs passes) before (re)starting the send pump. Without
      // this, playback starts on the FIRST 20 ms chunk and every momentary
      // Sarvam stream hiccup becomes an audible mid-sentence gap on the
      // carrier (call 5046: 14.9 s of audio took 17.3 s to play).
      const awaitPrebuffer = async (targetMs: number, capMs: number) => {
        const deadline = Date.now() + capMs;
        while (
          !this.closed && !this.bargeInRequested && !job.synthDone &&
          this.interruptionMgr.isValidSequence(job.sequenceId) &&
          bufferedMs() < targetMs && Date.now() < deadline
        ) {
          await new Promise<void>((r) => setTimeout(r, 10));
        }
      };
      // Underrun instrumentation: every mid-sentence buffer dry-out is an
      // audible glitch ("sticky/breaking" voice). Counted per sentence and
      // surfaced in the downloadable call execution log after playback.
      let underrunCount = 0;
      let underrunWaitMs = 0;
      await awaitPrebuffer(TTS_PREBUFFER_MS, TTS_PREBUFFER_CAP_MS);
      // Re-anchor the per-sentence echo grace + adaptive echo-floor calibration
      // window to actual playback start: the prebuffer wait above would
      // otherwise consume the grace period before any audio is audible, and
      // caller audio during the wait could be sampled as "echo".
      this.bargeInSentenceStartAt = Date.now();

      // Drift-compensated pacing: track the "ideal" next send time and adjust
      // each sleep so that accumulated setTimeout jitter is self-corrected.
      // Without this, late-firing timers cause VoBiz's playout buffer to underrun
      // (gaps/glitches) because audio delivery slows below real-time.
      let nextTick = Date.now() + 20;
      while (!this.closed && !this.bargeInRequested) {
        const emitStatus = this.interruptionMgr.getAudioSendStatus(
          job.sequenceId,
          this.conversationHistory.length,
        );
        if (emitStatus === "BLOCK" || !this.interruptionMgr.isValidSequence(job.sequenceId)) {
          break;
        }
        if (emitStatus === "WAIT") {
          // Pause — do NOT treat WAIT as completion (that produced fake
          // "Playback Completed" when echo VAD set calleeSpeaking).
          const ok = await this.waitForAudioEmit(job.sequenceId, 5_000);
          if (!ok || this.bargeInRequested || this.closed) break;
          nextTick = Date.now() + 20;
          continue;
        }

        if (wireQueue.length === 0) processNextBlock();
        if (wireQueue.length > 0) {
          const chunk = wireQueue.shift()!;
          // Ambient mixing only applies to mulaw output; skip when sending raw PCM
          // (raw PCM is already ambient-mixed above, at real "now", per block).
          const outChunk = (!this.config.rawPcmOutput && this.ambientStream)
            ? this.ambientStream.mixIntoMulaw(chunk)
            : chunk;
          // Final mute gate — never send after barge invalidate (TOCTOU with flag/seq).
          if (this.bargeInRequested || !this.interruptionMgr.isValidSequence(job.sequenceId)) break;
          this.markFirstAudioSent();
          if (this._tTurnFirstAudioOut === null) this._tTurnFirstAudioOut = performance.now();
          this.config.onAudioOut(outChunk);
          noteSent(outChunk);
          this.lastTtsFrameAt = Date.now(); // mark real audio out for the keepalive watchdog
          // NOTE: do NOT re-arm the echo-grace window per chunk here (see armTailEchoGrace).
          // If TTS is already done and this was the last queued chunk, break
          // immediately WITHOUT the trailing 20ms sleep — see drainPlaybackTail.
          if (job.synthDone && pcmIdx >= job.pcmQueue.length && wireQueue.length === 0) break;
          const delay = Math.max(0, nextTick - Date.now());
          nextTick += 20;
          // Prevent large accumulated debt (e.g. after a long pause or barge-in)
          // from causing a burst of back-to-back sends on the next turn.
          if (nextTick < Date.now() - 40) nextTick = Date.now() + 20;
          await new Promise<void>((r) => setTimeout(r, delay));
        } else if (job.synthDone) {
          break; // no more buffered blocks and TTS finished — we're done
        } else {
          // Underrun mid-sentence while TTS is still streaming: instead of
          // resuming on the very next 20 ms chunk (which turns one slow patch
          // into a rapid stutter of micro-gaps), re-buffer a short runway so
          // playback resumes smoothly, then reset pacing to avoid a burst.
          underrunCount++;
          const _uStart = Date.now();
          await awaitPrebuffer(TTS_REBUFFER_MS, TTS_REBUFFER_CAP_MS);
          underrunWaitMs += Date.now() - _uStart;
          nextTick = Date.now() + 20;
        }
      }
      if (underrunCount > 0 && !this.closed) {
        logger.warn(
          { callId: this.config.callId, underrunCount, underrunWaitMs, sentenceLen: job.text?.length ?? 0 },
          "TTS playback underruns — synthesis slower than realtime mid-sentence (audible glitches)",
        );
        this.logExec("TTS", "system", {
          status: "info",
          metadata: {
            event: "Playback underruns (audible glitch)",
            underrunCount,
            underrunWaitMs,
            provider: this.agent.ttsProvider,
          },
        });
      }
      // Ensure synthesis has fully settled (so a real error surfaces) even if
      // playback exited early via barge-in/close.
      await job.ready;
      if (job.synthError) throw job.synthError;
      if (bytesSent <= 0) return undefined;
      const bytesPerMs = this.config.rawPcmOutput ? (this.pcmOutRate() / 1000) * 2 : 8; // s16le vs mulaw
      return {
        pacedMs: Math.round(bytesSent / bytesPerMs),
        claimedMs: job.audioDurationMs,
      };
    } else {
      await job.ready;
      if (job.synthError) throw job.synthError;
      if (this.bargeInRequested) return;
      if (!this.canEmitAudio(job.sequenceId)) {
        const ok = await this.waitForAudioEmit(job.sequenceId);
        if (!ok || this.bargeInRequested) return;
      }
      const ttsPcm16k = job.nonStreamAudio!;
      const ttsPcm8k = downsample16to8(ttsPcm16k);
      this.recording.addAgentChunk(ttsPcm8k);
      const claimedMs = Math.round((ttsPcm16k.length / 2 / 16000) * 1000);
      if (this.config.rawPcmOutput) {
        // Mix ambient under speech at 16 kHz (mixIntoPcm16k's native rate).
        // HD webcall (16k) sends the mix as-is; carrier-grade legs downsample
        // to 8 kHz. When ambient is disabled the 8k path reuses ttsPcm8k
        // unchanged, so the non-ambient path is untouched.
        const outRate = this.pcmOutRate();
        const mixed16k = this.ambientStream ? this.ambientStream.mixIntoPcm16k(ttsPcm16k) : ttsPcm16k;
        const out8k = outRate === 16000
          ? mixed16k
          : (this.ambientStream ? downsample16to8(mixed16k) : ttsPcm8k);
        const PCM_CHUNK = CHUNK_SIZE_MULAW * 2 * (outRate / 8000); // 20ms: 320B @8k, 640B @16k
        for (let i = 0; i < out8k.length; i += PCM_CHUNK) {
          if (this.closed || this.bargeInRequested) break;
          const emitStatus = this.interruptionMgr.getAudioSendStatus(
            job.sequenceId,
            this.conversationHistory.length,
          );
          if (emitStatus === "BLOCK" || !this.interruptionMgr.isValidSequence(job.sequenceId)) break;
          if (emitStatus === "WAIT") {
            const ok = await this.waitForAudioEmit(job.sequenceId, 5_000);
            if (!ok || this.bargeInRequested || this.closed) break;
            i -= PCM_CHUNK; // retry this chunk after WAIT clears
            continue;
          }
          this.markFirstAudioSent();
          const slice = out8k.slice(i, i + PCM_CHUNK);
          this.config.onAudioOut(slice);
          noteSent(slice);
          this.lastTtsFrameAt = Date.now(); // mark real audio out for the keepalive watchdog
          // Do NOT re-arm echo grace per chunk (see the drain-loop note above):
          // the start grace + tail grace bound the self-echo window. A per-chunk
          // re-arm would span the whole sentence and block mid-sentence barge-in.
          // Skip the trailing sleep on the last chunk so drainPlaybackTail can
          // start immediately — no setTimeout-jitter gap before silence frames.
          if (i + PCM_CHUNK < out8k.length) {
            await new Promise<void>((r) => setTimeout(r, 20));
          }
        }
      } else {
        const ttsMusaw = encodeMulaw(ttsPcm8k);
        for (let i = 0; i < ttsMusaw.length; i += CHUNK_SIZE_MULAW) {
          if (this.closed || this.bargeInRequested) break;
          const emitStatus = this.interruptionMgr.getAudioSendStatus(
            job.sequenceId,
            this.conversationHistory.length,
          );
          if (emitStatus === "BLOCK" || !this.interruptionMgr.isValidSequence(job.sequenceId)) break;
          if (emitStatus === "WAIT") {
            const ok = await this.waitForAudioEmit(job.sequenceId, 5_000);
            if (!ok || this.bargeInRequested || this.closed) break;
            i -= CHUNK_SIZE_MULAW;
            continue;
          }
          this.markFirstAudioSent();
          const chunk = ttsMusaw.slice(i, i + CHUNK_SIZE_MULAW);
          const outChunk = this.ambientStream ? this.ambientStream.mixIntoMulaw(chunk) : chunk;
          this.config.onAudioOut(outChunk);
          noteSent(outChunk);
          this.lastTtsFrameAt = Date.now(); // mark real audio out for the keepalive watchdog
          // Do NOT re-arm echo grace per chunk (see the drain-loop note above):
          // start grace + tail grace bound the self-echo window; a per-chunk
          // re-arm would span the whole sentence and block mid-sentence barge-in.
          // Skip the trailing sleep on the last chunk — same reasoning as PCM branch.
          if (i + CHUNK_SIZE_MULAW < ttsMusaw.length) {
            await new Promise<void>((r) => setTimeout(r, 20));
          }
        }
      }
      if (bytesSent <= 0) return undefined;
      const bytesPerMs = this.config.rawPcmOutput ? (this.pcmOutRate() / 1000) * 2 : 8;
      return {
        pacedMs: Math.round(bytesSent / bytesPerMs),
        claimedMs,
      };
    }
  }

  // ── Tool execution ───────────────────────────────────────────────────────────

  /**
   * Public tool dispatcher: writes Tool request/response execution-log rows
   * around the actual dispatch so the Call Log timeline shows every tool call
   * (mirrors the web-call path). Errors are logged with their real reason, then
   * re-thrown to preserve existing control flow.
   */
  private async handleToolCall(toolName: string, args: Record<string, unknown>): Promise<string | undefined> {
    const _toolStart = Date.now();
    this.logExec("Tool", "request", {
      status: "info",
      turnNumber: this._activeTurnIndex,
      requestPayload: { tool: toolName, args },
    });
    logToolExecutionStarted(this.logFn, { tool: toolName, turnNumber: this._activeTurnIndex });
    try {
      const result = await this.handleToolCallInner(toolName, args);
      // A handful of built-in/terminal tools (end_call, webhook, send_sms,
      // cal_com) intentionally return undefined — they don't hand a string
      // back to the LLM for a follow-up turn because they act directly
      // (speak + hang up, fire a webhook, etc). That's a legitimate success,
      // not a missing/failed result, so label it clearly instead of the
      // confusing "unavailable" (which reads like an error in the Tools tab).
      const displayResult = result ?? "(no reply needed — tool completed directly)";
      this.logExec("Tool", "system", {
        status: "success",
        durationMs: Date.now() - _toolStart,
        turnNumber: this._activeTurnIndex,
        metadata: { event: "Tool Executed", tool: toolName, result: displayResult.substring(0, 800) },
      });
      this.logFn("Tool", "system", {
        status: "success",
        durationMs: Date.now() - _toolStart,
        turnNumber: this._activeTurnIndex,
        metadata: { event: "Execution Completed", result: displayResult.substring(0, 800) },
      });
      this.logExec("Tool", "response", {
        status: "success",
        latencyMs: Date.now() - _toolStart,
        turnNumber: this._activeTurnIndex,
        durationMs: Date.now() - _toolStart,
        requestPayload: { tool: toolName },
        responsePayload: { result: displayResult.substring(0, 800) },
      });
      return result;
    } catch (err) {
      const _reason = toReadableError(err, "Tool error");
      this.logFn("Tool", "system", {
        status: "error",
        durationMs: Date.now() - _toolStart,
        turnNumber: this._activeTurnIndex,
        errorMessage: _reason,
        metadata: { event: "Execution Completed", error: _reason, failureReason: _reason },
      });
      this.logExec("Tool", "response", {
        status: "error",
        latencyMs: Date.now() - _toolStart,
        turnNumber: this._activeTurnIndex,
        durationMs: Date.now() - _toolStart,
        errorMessage: _reason,
        requestPayload: { tool: toolName },
        responsePayload: { error: _reason, failureReason: _reason },
      });
      throw err;
    }
  }

  private async handleToolCallInner(toolName: string, args: Record<string, unknown>): Promise<string | undefined> {
    const tool = matchToolByName(this.agent.tools, toolName);
    if (!tool) {
      // Built-in end_call: always available even if not explicitly in agent tools
      if (toolName === "end_call") {
        logger.info({ callId: this.config.callId }, "Built-in end_call invoked by LLM");
        // Speak the configured goodbye message, or a sensible default, before
        // hanging up — never drop the connection silently.
        const endCallTool = this.agent.tools.find(t => t.type === "end_call");
        const goodbye = resolveGoodbyeMessage(
          endCallTool?.type === "end_call" ? endCallTool.goodbyeMessage : undefined,
          this.agent.endCallPhrases,
        );
        this.conversationHistory.appendAssistant(goodbye);
        this.config.onTranscript("agent", goodbye);
        await this.speakRaw(goodbye);
        this.config.onCallEnd();
        return undefined;
      }
      if (toolName === "schedule_callback") {
        const toNumber = this.config.callerPhone ?? "";
        const agentId = this.agent.id;
        const callId = this.config.callId;
        const scheduledAtRaw = args["scheduled_at"] as string | undefined;
        const notes = args["notes"] as string | undefined;
        const cbTz = this.agent.timezone?.trim() || "Asia/Kolkata";
        const { scheduledAt, wasDefaulted, wasClamped } = resolveCallbackTime(scheduledAtRaw, cbTz);
        logger.info(
          { callId, agentId, toNumber, scheduledAtRaw, scheduledAt, tz: cbTz, wasDefaulted, wasClamped, notes },
          "Built-in schedule_callback invoked by LLM",
        );
        if (toNumber) {
          await scheduleCallbackRequested({
            agentId,
            toNumber,
            scheduledAt,
            callId,
            notes,
          });
          const cbLocal = scheduledAt.toLocaleString("en-IN", {
            weekday: "long", day: "numeric", month: "long",
            hour: "numeric", minute: "2-digit", hour12: true, timeZone: cbTz,
          });
          return `Callback recorded for ${cbLocal} (${cbTz}). Now speak naturally to the caller: confirm THIS exact time back to them (e.g. "Great, I've noted that — we'll call you ${cbLocal}"), thank them, then close the conversation. Do NOT call end_call automatically — only end the call after you have spoken a proper goodbye.`;
        }
        return "Callback noted — I'll arrange for someone to call you back.";
      }
      logger.warn({ callId: this.config.callId, toolName }, "LLM called unknown tool — ignoring");
      return undefined;
    }

    logger.info({ callId: this.config.callId, toolName, toolType: tool.type, args }, "Tool invoked by LLM");

    if (tool.type === "call_transfer") {
      return await this.executeCallTransfer(tool, args);
    } else if (tool.type === "transfer_cold") {
      return await this.executeTransferCold(tool, args);
    } else if (tool.type === "transfer_warm") {
      return await this.executeTransferWarm(tool, args);
    } else if (tool.type === "transfer_agent") {
      return await this.executeTransferAgent(tool, args);
    } else if (tool.type === "squad_followup") {
      return await this.executeSquadFollowup(args);
    } else if (tool.type === "webhook") {
      await this.executeWebhookTool(tool, args);
    } else if (tool.type === "send_sms") {
      await this.executeSendSms(tool, args);
    } else if (tool.type === "send_email") {
      return await sharedExecuteSendEmail({
        agentId: this.agent.id,
        callId: this.config.callId,
        agentName: this.agent.name,
        callerPhone: this.config.callerPhone,
        args,
      });
    } else if (tool.type === "send_whatsapp") {
      return await sharedExecuteSendWhatsapp({
        agentId: this.agent.id,
        callId: this.config.callId,
        agentName: this.agent.name,
        callerPhone: this.config.callerPhone,
        args,
      });
    } else if (tool.type === "end_call") {
      await this.executeEndCall(tool);
    } else if (tool.type === "cal_com") {
      await this.executeCalCom(tool, args);
    } else if (tool.type === "native_booking") {
      return await this.executeNativeBooking(tool, args);
    } else if (tool.type === "native_reschedule") {
      // Infer active booking from booking_id arg when multiple bookings were listed
      if (!this.activeRescheduleBooking) {
        const bid = this.parseBookingIdArg(args["booking_id"]);
        if (bid) {
          const found = this.pendingListedBookings.find((b) => b.bookingId === bid);
          if (found) {
            this.activeRescheduleBooking = found;
            logger.info({ callId: this.config.callId, ...found }, "activeRescheduleBooking inferred from reschedule booking_id arg");
          }
        }
      }
      const result = await this.executeNativeReschedule(tool, args);
      if (result.includes("reschedule_confirmed")) {
        logger.info({ callId: this.config.callId }, "Reschedule confirmed — clearing activeRescheduleBooking");
        this.activeRescheduleBooking = null;
        this.pendingListedBookings = [];
      }
      return result;
    } else if (tool.type === "native_cancel") {
      // Infer active booking from booking_id arg when multiple bookings were listed
      if (!this.activeRescheduleBooking) {
        const bid = this.parseBookingIdArg(args["booking_id"]);
        if (bid) {
          const found = this.pendingListedBookings.find((b) => b.bookingId === bid);
          if (found) {
            this.activeRescheduleBooking = found;
            logger.info({ callId: this.config.callId, ...found }, "activeRescheduleBooking inferred from cancel booking_id arg");
          }
        }
      }
      const result = await this.executeNativeCancel(tool, args);
      if (result.includes("cancel_confirmed")) {
        logger.info({ callId: this.config.callId }, "Cancel confirmed — clearing activeRescheduleBooking");
        this.activeRescheduleBooking = null;
        this.pendingListedBookings = [];
      }
      return result;
    } else if (tool.type === "native_check_availability") {
      return await this.executeNativeCheckAvailability(tool, args);
    } else if (tool.type === "native_list_bookings") {
      const result = await this.executeNativeListBookings(tool, args);
      // Always reset first to avoid stale context from a previous list call
      this.activeRescheduleBooking = null;
      this.pendingListedBookings = this.parseAllListedBookings(result);
      if (this.pendingListedBookings.length === 1) {
        this.activeRescheduleBooking = this.pendingListedBookings[0]!;
        logger.info({ callId: this.config.callId, ...this.activeRescheduleBooking }, "activeRescheduleBooking set from list_bookings result (count=1)");
      } else if (this.pendingListedBookings.length > 1) {
        logger.info({ callId: this.config.callId, count: this.pendingListedBookings.length }, "Multiple bookings listed — activeRescheduleBooking deferred until booking_id is known");
      }
      return result;
    }
    return undefined;
  }

  /**
   * Parse all booking entries from a `bookings_found:` result string.
   * Returns an empty array on no-bookings or error results.
   */
  private parseAllListedBookings(result: string): Array<{ bookingId: number; isoDate: string; timeLabel: string; eventName: string }> {
    if (!result.startsWith("bookings_found:")) return [];
    const entries = result.split(" | ");
    const parsed: Array<{ bookingId: number; isoDate: string; timeLabel: string; eventName: string }> = [];
    for (const entry of entries) {
      const bookingIdMatch = /booking_id=(\d+)/.exec(entry);
      const eventMatch = /event="([^"]+)"/.exec(entry);
      const isoStartMatch = /iso_start=([^\s,|]+)/.exec(entry);
      const dateMatch = /date="([^"]+)"/.exec(entry);
      if (!bookingIdMatch || !isoStartMatch) continue;
      const isoFull = isoStartMatch[1]!;
      parsed.push({
        bookingId: parseInt(bookingIdMatch[1]!, 10),
        isoDate: isoFull.split("T")[0] ?? isoFull,
        timeLabel: dateMatch?.[1] ?? isoFull,
        eventName: eventMatch?.[1] ?? "Appointment",
      });
    }
    return parsed;
  }

  private parseBookingIdArg(val: unknown): number | null {
    if (typeof val === "number") return val;
    if (typeof val === "string") { const n = parseInt(val, 10); return isNaN(n) ? null : n; }
    return null;
  }

  private async executeWebhookTool(tool: AgentTool & { type: "webhook" }, args: Record<string, unknown>): Promise<void> {
    await sharedExecuteWebhookTool(this.config.callId, tool, args);
  }

  private async executeSendSms(tool: AgentTool & { type: "send_sms" }, _args: Record<string, unknown>): Promise<void> {
    const callerPhone = this.config.callerPhone;
    if (!callerPhone) {
      logger.warn({ callId: this.config.callId }, "Send SMS: no caller phone available — skipping");
      return;
    }
    const message = tool.messageTemplate;
    const tprov = this.config.telephonyProvider;
    logger.info({ callId: this.config.callId, to: callerPhone, tprov }, "Executing Send SMS tool");
    try {
      if (tprov === "twilio") {
        const authToken = this.config.providerKeys.get("twilio") ?? "";
        const extra = this.config.providerKeys.get("twilio:extraConfig");
        const cfg = extra ? (JSON.parse(extra) as Record<string, string>) : {};
        const accountSid = cfg["accountSid"] ?? "";
        const fromNumber = cfg["fromNumber"] ?? "";
        const body = new URLSearchParams({ To: callerPhone, From: fromNumber, Body: message });
        const resp = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
          {
            method: "POST",
            headers: {
              "Authorization": `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: body.toString(),
          },
        );
        if (!resp.ok) logger.warn({ callId: this.config.callId, status: resp.status }, "Twilio SMS failed");
        else logger.info({ callId: this.config.callId, to: callerPhone }, "SMS sent via Twilio");
      } else if (tprov === "plivo") {
        const authToken = this.config.providerKeys.get("plivo") ?? "";
        const extra = this.config.providerKeys.get("plivo:extraConfig");
        const cfg = extra ? (JSON.parse(extra) as Record<string, string>) : {};
        const authId = cfg["authId"] ?? "";
        const fromNumber = cfg["fromNumber"] ?? "";
        const resp = await fetch(
          `https://api.plivo.com/v1/Account/${authId}/Message/`,
          {
            method: "POST",
            headers: {
              "Authorization": `Basic ${Buffer.from(`${authId}:${authToken}`).toString("base64")}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ src: fromNumber, dst: callerPhone, text: message }),
          },
        );
        if (!resp.ok) logger.warn({ callId: this.config.callId, status: resp.status }, "Plivo SMS failed");
        else logger.info({ callId: this.config.callId, to: callerPhone }, "SMS sent via Plivo");
      } else {
        logger.warn({ callId: this.config.callId, tprov }, "Send SMS: telephony provider does not support SMS");
      }
    } catch (err) {
      logger.error({ callId: this.config.callId, err }, "Send SMS tool execution failed");
    }
  }

  private async executeEndCall(tool: AgentTool & { type: "end_call" }): Promise<void> {
    logger.info({ callId: this.config.callId }, "End Call tool invoked by LLM");
    {
      const goodbye = resolveGoodbyeMessage(tool.goodbyeMessage, this.agent.endCallPhrases);
      this.conversationHistory.appendAssistant(goodbye);
      this.config.onTranscript("agent", goodbye);
      await this.speakRaw(goodbye);
    }
    this.config.onCallEnd();
  }

  private async executeCalCom(tool: AgentTool & { type: "cal_com" }, args: Record<string, unknown>): Promise<void> {
    logger.info({ callId: this.config.callId, eventTypeId: tool.eventTypeId }, "Cal.com booking tool invoked");
    const attendeeName  = String(args["attendee_name"]  ?? args["name"]  ?? "Guest");
    const attendeeEmail = String(args["attendee_email"] ?? args["email"] ?? "");
    const timezone      = String(args["timezone"]       ?? tool.timezone  ?? "UTC");

    if (!attendeeEmail) {
      logger.warn({ callId: this.config.callId }, "Cal.com: no attendee email provided — cannot book");
      return;
    }
    try {
      // Fetch available slots for the next 7 days
      const now       = new Date();
      const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const slotsResp = await fetch(
        `https://api.cal.com/v2/slots/available?eventTypeId=${tool.eventTypeId}` +
        `&startTime=${now.toISOString()}&endTime=${weekLater.toISOString()}` +
        `&timeZone=${encodeURIComponent(timezone)}`,
        {
          headers: {
            "Authorization": `Bearer ${tool.apiKey}`,
            "cal-api-version": "2024-09-04",
          },
          signal: AbortSignal.timeout(8000),
        },
      );
      if (!slotsResp.ok) {
        logger.warn({ callId: this.config.callId, status: slotsResp.status }, "Cal.com: slots API error");
        return;
      }
      const slotsData = await slotsResp.json() as {
        data?: { slots?: Record<string, Array<{ time: string }>> }
      };
      const allSlots = Object.values(slotsData.data?.slots ?? {}).flat();
      if (allSlots.length === 0) {
        logger.info({ callId: this.config.callId }, "Cal.com: no available slots in next 7 days");
        return;
      }
      const slot = allSlots[0]!;
      const bookResp = await fetch("https://api.cal.com/v2/bookings", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${tool.apiKey}`,
          "cal-api-version": "2024-09-04",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          eventTypeId: tool.eventTypeId,
          start: slot.time,
          attendee: { name: attendeeName, email: attendeeEmail, timeZone: timezone },
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (bookResp.ok) {
        logger.info({ callId: this.config.callId, start: slot.time, attendeeEmail }, "Cal.com booking created");
      } else {
        const errText = await bookResp.text().catch(() => "");
        logger.warn({ callId: this.config.callId, status: bookResp.status, errText }, "Cal.com booking API error");
      }
    } catch (err) {
      logger.error({ callId: this.config.callId, err }, "Cal.com tool execution failed");
    }
  }

  private async executeCallTransfer(tool: AgentTool & { type: "call_transfer" }, _args: Record<string, unknown>): Promise<string | undefined> {
    // Arm the transfer gate immediately — BEFORE any async work — so that any STT
    // transcript that arrives while this turn is executing (caller speech during the
    // hold window) is discarded by handleStreamingTranscript and never spawns a
    // duplicate LLM turn / duplicate transfer API call.
    this.transferInitiated = true;

    // Guard: no transfer number configured — return error to LLM so it can respond gracefully
    if (!tool.transferTo?.trim()) {
      this.transferInitiated = false; // reset — call continues
      logger.warn({ callId: this.config.callId }, "call_transfer: no transfer number configured — returning error to LLM");
      return "transfer_unavailable: no transfer number has been configured for this agent";
    }

    logger.info({ callId: this.config.callId, transferTo: tool.transferTo, mode: tool.transferMode ?? "cold" }, "Executing call transfer");

    // Speak the warm handoff message to the CALLER (if configured) before transferring
    if (tool.warmHandoffMessage?.trim()) {
      this.config.onTranscript("agent", tool.warmHandoffMessage);
      this.bargeInHoldUntil = Date.now() + this.bargeInEchoGraceMs;
      this.isPlaying = true;
      try {
        await this.playSentence(tool.warmHandoffMessage);
      } catch (err) {
        logger.error({ callId: this.config.callId, err }, "Warm handoff TTS error");
      } finally {
        this.isPlaying = false;
        this.armTailEchoGrace();
      }
      await this.drainPlaybackTail();
    }

    // ── Warm summary: generate operator briefing from conversation history ──
    let operatorSummary: string | undefined;
    if (tool.transferMode === "warm_summary") {
      const defaultPrompt = [
        "You are summarising this call for the human agent who will now take over.",
        "Write a concise briefing (3–5 sentences) covering:",
        "  • Customer name (if mentioned)",
        "  • The core issue or request",
        "  • Priority / urgency (High / Medium / Low)",
        "  • Any key context the agent needs to resolve it quickly",
        "Use plain prose — no bullet points, no markdown. Speak directly to the operator.",
      ].join("\n");

      const prompt = tool.summaryPrompt?.trim() || defaultPrompt;
      logger.info({ callId: this.config.callId }, "Warm transfer: generating operator summary");

      // Generate the briefing with one LLM adapter (primary or fallback).
      const generateSummary = async (llm: NonNullable<typeof this.fallbackLlm>): Promise<string> => {
        let summaryText = "";
        await llm.chat(
          this.conversationHistory.messages,
          prompt,
          (token) => { summaryText += token; },
          (full)  => { summaryText = full; },
        );
        return stripReasoningBlocks(summaryText).trim();
      };

      // Try the primary LLM, then the configured fallback LLM (mirrors the turn-loop
      // fallback). Without this, a primary-LLM failure (e.g. a retired/unavailable
      // model returning 404) silently downgrades the warm transfer to a context-free
      // cold transfer — the operator gets no briefing.
      try {
        operatorSummary = await generateSummary(this.llm);
        if (!operatorSummary && this.fallbackLlm) {
          logger.warn({ callId: this.config.callId }, "Warm transfer: primary LLM produced empty summary — retrying with fallback LLM");
          operatorSummary = await generateSummary(this.fallbackLlm);
        }
      } catch (primaryErr) {
        logger.warn(
          { callId: this.config.callId, err: toReadableError(primaryErr, "LLM error"), fallbackProvider: this.agent.fallbackLlmProvider },
          "Warm transfer: primary LLM summary failed — attempting fallback LLM",
        );
        if (this.fallbackLlm) {
          try {
            operatorSummary = await generateSummary(this.fallbackLlm);
            logger.info({ callId: this.config.callId }, "Warm transfer: operator summary generated via fallback LLM");
          } catch (fallbackErr) {
            logger.error(
              { callId: this.config.callId, err: toReadableError(fallbackErr, "Fallback LLM error") },
              "Warm transfer: fallback LLM also failed",
            );
          }
        } else {
          logger.error({ callId: this.config.callId }, "Warm transfer: no fallback LLM configured");
        }
      }

      // Last resort: if no LLM could produce a summary, hand the operator the raw tail
      // of the conversation so the warm transfer still carries SOME context instead of
      // degrading to a context-free cold transfer.
      if (!operatorSummary) {
        const MAX_BRIEF_CHARS = 1000;
        let recent = this.conversationHistory.messages
          .filter((t) => t.role === "user" || t.role === "assistant")
          .slice(-6)
          .map((t) => `${t.role === "user" ? "Caller" : "Agent"}: ${t.content}`.trim())
          .filter((line) => line.length > 0)
          .join(". ");
        // Keep the most-recent tail if it overruns — protects TTS/XML length limits.
        if (recent.length > MAX_BRIEF_CHARS) recent = "…" + recent.slice(recent.length - MAX_BRIEF_CHARS);
        if (recent) {
          operatorSummary = `Automatic summary unavailable. Here is the recent conversation. ${recent}`;
          logger.warn({ callId: this.config.callId }, "Warm transfer: using raw-transcript fallback briefing");
        }
      }

      logger.info({ callId: this.config.callId, summaryLength: operatorSummary?.length ?? 0 }, "Warm transfer: operator summary ready");
    }

    // Notify session layer (triggers telephony transfer); only end the call if it succeeded
    const ok = (await this.config.onCallTransfer?.(tool.transferTo, operatorSummary)) ?? true;
    if (!ok) {
      this.transferInitiated = false; // reset — call continues after failure
      logger.warn({ callId: this.config.callId }, "call_transfer: provider transfer failed — returning error to LLM");
      return "transfer_failed: unable to connect to a human agent at this time";
    }
    this.config.onCallEnd();
    return undefined;
  }

  // ── New transfer tool executors (T3+) ─────────────────────────────────────────

  private async executeTransferCold(tool: AgentTool & { type: "transfer_cold" }, _args: Record<string, unknown>): Promise<string | undefined> {
    this.transferInitiated = true;
    // Guard: no transfer number configured — return error to LLM so it can respond gracefully
    if (!tool.targetNumber?.trim()) {
      this.transferInitiated = false; // reset — call continues
      logger.warn({ callId: this.config.callId }, "transfer_cold: no target number configured — returning error to LLM");
      return "transfer_unavailable: no transfer number has been configured for this agent";
    }

    logger.info({ callId: this.config.callId, transferTo: tool.targetNumber, type: "cold" }, "Executing transfer_cold");

    // Optional hold message
    if (tool.holdMessage?.trim()) {
      this.config.onTranscript("agent", tool.holdMessage);
      this.bargeInHoldUntil = Date.now() + this.bargeInEchoGraceMs;
      this.isPlaying = true;
      try {
        await this.playSentence(tool.holdMessage);
      } catch (err) {
        logger.error({ callId: this.config.callId, err }, "transfer_cold: hold message TTS error");
      } finally {
        this.isPlaying = false;
        this.armTailEchoGrace();
      }
      await this.drainPlaybackTail();
    }

    // Notify session layer (triggers telephony redirect); only end the call if it succeeded
    const ok = (await this.config.onCallTransfer?.(tool.targetNumber)) ?? true;
    if (!ok) {
      this.transferInitiated = false; // reset — call continues after failure
      logger.warn({ callId: this.config.callId }, "transfer_cold: provider transfer failed — returning error to LLM");
      return "transfer_failed: unable to connect to a human agent at this time";
    }
    this.config.onCallEnd();

    // Write lead transfer DB
    void writeTransferLeadDb({
      callId: this.config.callId,
      campaignLeadId: this.config.campaignLeadId ?? null,
      transferTo: tool.targetNumber,
      type: "cold",
    });
    return undefined;
  }

  private async executeTransferWarm(tool: AgentTool & { type: "transfer_warm" }, _args: Record<string, unknown>): Promise<string | undefined> {
    this.transferInitiated = true;
    // Guard: no transfer number configured — return error to LLM so it can respond gracefully
    if (!tool.targetNumber?.trim()) {
      this.transferInitiated = false; // reset — call continues
      logger.warn({ callId: this.config.callId }, "transfer_warm: no target number configured — returning error to LLM");
      return "transfer_unavailable: no transfer number has been configured for this agent";
    }

    logger.info({ callId: this.config.callId, transferTo: tool.targetNumber, type: "warm" }, "Executing transfer_warm");

    // Optional hold message
    if (tool.holdMessage?.trim()) {
      this.config.onTranscript("agent", tool.holdMessage);
      this.bargeInHoldUntil = Date.now() + this.bargeInEchoGraceMs;
      this.isPlaying = true;
      try {
        await this.playSentence(tool.holdMessage);
      } catch (err) {
        logger.error({ callId: this.config.callId, err }, "transfer_warm: hold message TTS error");
      } finally {
        this.isPlaying = false;
        this.armTailEchoGrace();
      }
      await this.drainPlaybackTail();
    }

    // Generate LLM operator briefing
    const defaultPrompt = [
      "You are summarising this call for the human agent who will now take over.",
      "Write a concise briefing (3–5 sentences) covering:",
      "  • Customer name (if mentioned)",
      "  • The core issue or request",
      "  • Priority / urgency (High / Medium / Low)",
      "  • Any key context the agent needs to resolve it quickly",
      "Use plain prose — no bullet points, no markdown. Speak directly to the operator.",
    ].join("\n");
    const prompt = tool.summaryPrompt?.trim() || defaultPrompt;

    let operatorSummary: string | undefined;
    try {
      let summaryText = "";
      await this.llm.chat(
        this.conversationHistory.messages,
        prompt,
        (token) => { summaryText += token; },
        (full)  => { summaryText = full; },
      );
      operatorSummary = stripReasoningBlocks(summaryText).trim();
      logger.info({ callId: this.config.callId, summaryLength: operatorSummary.length }, "transfer_warm: operator summary ready");
    } catch (err) {
      logger.error({ callId: this.config.callId, err }, "transfer_warm: summary generation failed — proceeding without summary");
    }

    // Notify session layer (triggers telephony redirect + warm briefing); only end the call if it succeeded
    const ok = (await this.config.onCallTransfer?.(tool.targetNumber, operatorSummary)) ?? true;
    if (!ok) {
      this.transferInitiated = false; // reset — call continues after failure
      logger.warn({ callId: this.config.callId }, "transfer_warm: provider transfer failed — returning error to LLM");
      return "transfer_failed: unable to connect to a human agent at this time";
    }
    this.config.onCallEnd();

    // Write lead transfer DB
    void writeTransferLeadDb({
      callId: this.config.callId,
      campaignLeadId: this.config.campaignLeadId ?? null,
      transferTo: tool.targetNumber,
      type: "warm",
      summary: operatorSummary,
    });
    return undefined;
  }

  private async executeTransferAgent(tool: AgentTool & { type: "transfer_agent" }, _args: Record<string, unknown>): Promise<string | undefined> {
    this.transferInitiated = true;
    const targetAgentId = tool.targetAgentId;
    logger.info({ callId: this.config.callId, targetAgentId }, "Executing transfer_agent");

    // Notify session layer with agent: prefix (session.ts handles AI-to-AI handoff).
    // Only end THIS call if the handoff actually succeeded — if it's unsupported or
    // fails, report the failure back to the LLM so it keeps talking to the caller
    // instead of the call going dead after a no-op transfer.
    const ok = (await this.config.onCallTransfer?.(`agent:${targetAgentId}`)) ?? false;
    if (!ok) {
      this.transferInitiated = false; // reset — call continues
      logger.warn({ callId: this.config.callId, targetAgentId }, "transfer_agent: handoff failed/unsupported — returning error to LLM");
      return "transfer_failed: unable to transfer to the requested agent right now";
    }
    // In-call squad handoff keeps the same media connection — do NOT end the call.
    this.transferInitiated = false;
    void writeTransferLeadDb({
      callId: this.config.callId,
      campaignLeadId: this.config.campaignLeadId ?? null,
      transferTo: `agent:${targetAgentId}`,
      type: "agent",
    });
    return "handoff_complete: a teammate is now continuing with the customer";
  }

  private async executeSquadFollowup(args: Record<string, unknown>): Promise<string> {
    const targetAgentId = parseInt(String(args["targetAgentId"] ?? ""), 10);
    const note = String(args["note"] ?? "").trim();
    const delayMinutes = parseInt(String(args["delay_minutes"] ?? ""), 10);
    if (!Number.isFinite(targetAgentId) || !note || !Number.isFinite(delayMinutes)) {
      return "followup_failed: targetAgentId, note and delay_minutes are all required";
    }
    try {
      const { createSquadFollowupTask } = await import("../services/squad-teamwork.js");
      return await createSquadFollowupTask({
        fromAgentId: this.config.agentConfig.id,
        callId: this.config.callId,
        callerPhone: this.config.callerPhone ?? null,
        targetAgentId,
        note,
        delayMinutes,
        contextSummary: this.getTranscript().slice(-2000),
      });
    } catch (err) {
      logger.warn({ err, callId: this.config.callId }, "squad_followup tool failed");
      return "followup_failed: internal error scheduling the follow-up";
    }
  }

  // ── Core turn logic ───────────────────────────────────────────────────────────

  private async processTurn(transcript: string, sttLatencyMs: number): Promise<void> {
    this.bargeInRequested = false;
    this.bargeInSpeechFrames = 0;
    // Reset the streaming word counter at this deterministic agent-turn
    // boundary so the accumulator never carries stale state into the new turn.
    // A second reset also happens in handleStreamingTranscript whenever a
    // transcript arrives while the agent is not playing (belt-and-suspenders).
    this.streamingBargeInWordCount = 0;
    // Reset per-turn sentence tracker. _interruptionHint is NOT reset here —
    // it was captured at the END of the previous turn and is consumed later in
    // this call's historyForLlm assembly before the LLM is invoked.
    this._currentTurnPlayedSentences = [];
    this.firstAudioSentAt = null;
    const _currentTurnIndex = ++this.turnIndex;
    this._activeTurnIndex = _currentTurnIndex;
    this._tTurnLlmFirstToken  = null;
    this._tTurnLlmFirstClause = null;
    this._tTurnTtsFirstByte   = null;
    this._tTurnFirstAudioOut  = null;
    this._fillerPlayedThisTurn = false;
    this._skipPendingFillerPlayback = false;
    this._eagerLlmHitThisTurn = false;
    this._deadAirFillerEnqueuedAt = null;
    this.clearFragmentCoalesce();
    // Capture adaptive endpoint decision for this turn (set by scheduleSilenceFlush);
    // null when turn was triggered by streaming STT (Deepgram handles endpointing there).
    const _thisEndpointMs = this._lastEndpointMs;
    const _thisEndpointReason = this._lastEndpointReason || "n/a";
    this._lastEndpointMs = null;
    this._lastEndpointReason = "";

    logger.info({ callId: this.config.callId, transcript, sttLatencyMs }, "Processing turn");

    // Drop ultra-short STT stubs before history / LLM — they restart consent loops.
    if (isUltraShortNoiseFragment(transcript)) {
      logger.info(
        { callId: this.config.callId, transcript: transcript.slice(0, 80) },
        "Dropping ultra-short STT fragment — waiting for more speech",
      );
      this.logDiscardedTranscript(transcript, "ultra_short_fragment");
      this.prepareSystemPlayback();
      this.safetyNet.beginListening();
      return;
    }

    // STT execution-log row — the recognized caller utterance for this turn.
    const _sttMeta = this._pendingSttMeta;
    this._pendingSttMeta = null;
    this.logExec("STT", "response", {
      provider: this.agent.asrProvider,
      status: "success",
      latencyMs: _sttMeta?.lastPartialToFinalMs ? Math.round(_sttMeta.lastPartialToFinalMs) : (Math.round(sttLatencyMs) || undefined),
      turnNumber: this._activeTurnIndex,
      responsePayload: { transcript, ...(_sttMeta ?? {}) },
    });

    // P1-I: Start Speaking Plan — content-based delay before triggering LLM response
    if (this.agent.startSpeakingPlan) {
      const plan = this.agent.startSpeakingPlan;
      const lastChar = transcript.trimEnd().slice(-1);
      let delayMs = 0;
      if (/[.?!।]/.test(lastChar)) {
        delayMs = Math.round((plan.onPunctuationSeconds ?? 0) * 1000);
      } else if (/[0-9]/.test(lastChar)) {
        delayMs = Math.round((plan.onNumberSeconds ?? 0) * 1000);
      } else {
        delayMs = Math.round((plan.onNoPunctuationSeconds ?? 0) * 1000);
      }
      delayMs += Math.round((plan.waitSeconds ?? 0) * 1000);
      // Honor Latency Tuning UI values as-is (schema max 5s). No silent hard cap.
      if (delayMs > 0 && !this.bargeInRequested) {
        await new Promise<void>((r) => setTimeout(r, delayMs));
      }
    }

    this.config.onTranscript("user", transcript);
    // If the caller just switched language, annotate the history entry so the
    // LLM knows the transcript may be partially inaccurate (it was captured while
    // ASR was still locked to the old language) and should respond in the new one.
    {
      const langSwitch = this._langSwitchThisTurn;
      this._langSwitchThisTurn = null; // consume — one-shot per turn
      if (langSwitch) {
        const fromName = LANG_DISPLAY_NAMES[langSwitch.from] ?? langSwitch.from;
        const toName = LANG_DISPLAY_NAMES[langSwitch.to] ?? langSwitch.to;
        const note = `\n\n[Context: the caller just switched from ${fromName} to ${toName}. This transcript was captured while ASR was still configured for ${fromName} — some words may be inaccurate. Respond in ${toName}.]`;
        if (!this.conversationHistory.isDuplicateUser(transcript + note)) {
          this.conversationHistory.appendUser(transcript + note);
        }
      } else {
        if (!this.conversationHistory.isDuplicateUser(transcript)) {
          this.conversationHistory.appendUser(transcript);
        }
      }
    }

    // ── Bolna-parity: caller speak chars metric ───────────────────────────────
    this._callerSpeakCharsTotal += transcript.length;

    // ── Progressive gender detection — fire after each confirmed user turn ──
    // Non-blocking: updates genderDetector.gender for the next turn's salutation.
    // GenderDetector (v0) auto-fires via addSpeechChunk and treats this as a no-op.
    if (this.genderDetector && !this.genderDetector.locked) this.genderDetector.runDetection();

    // Voice Memory — enroll / verify windows after confirmed user speech (non-blocking).
    this.speakerVerifier?.tick();

    // ── Explicit caller salutation correction ──────────────────────────────
    // Only an explicit caller correction ("call me sir, not ma'am") can override
    // the locked/detected gender. Once set it is sticky for the rest of the call
    // (re-evaluated each turn so the caller can correct again), and takes
    // precedence over the detector via effectiveGender().
    if (this.genderSalutationInPrompt) {
      const correction = this.detectSalutationCorrection(transcript);
      if (correction && correction !== this.salutationCorrection) {
        this.salutationCorrection = correction;
        logger.info(
          { callId: this.config.callId, correction, transcript: transcript.slice(0, 80) },
          "Pipeline: explicit caller salutation correction — overriding detected gender for the rest of the call",
        );
      }
    }


    // ── Guardrail route check ──
    // Fast word-overlap classifier — runs before the main LLM to intercept
    // sensitive or off-topic utterances and play a canned response instead.
    // P0-A: Garbled transcript recovery — catch noise/garbage before it reaches the LLM
    const sttLang = this.currentLang || this.agent.sttConfig.language;
    const { isGarbled, reason: garbledReason } = checkTranscriptQuality(transcript, { expectedLang: sttLang });
    if (isGarbled) {
      const clarification = pickClarificationPhrase(sttLang, String(this.config.callId));
      logger.warn({ callId: this.config.callId, transcript, garbledReason }, "Garbled transcript — responding with clarification");
      this.bargeInHoldUntil = Date.now() + this.bargeInEchoGraceMs;
      this._currentTurnPlayedSentences = [];
      this.isPlaying = true;
      try { await this.playSentence(clarification); } finally { this.isPlaying = false; this.armTailEchoGrace(); }
      const heard = this.getHeardAgentText();
      if (heard) {
        this.conversationHistory.appendAssistant(heard);
        this.lastAssistantSpokenRaw = heard;
        this.config.onTranscript("agent", heard);
        this.config.onConversationUpdate?.(this.conversationHistory.messages);
      }
      // Drain the carrier's jitter buffer before returning to listening so the
      // last word of the clarification isn't clipped. This short branch bypasses
      // playTask's drain, so it must replicate it (see drainPlaybackTail).
      await this.drainPlaybackTail();
      return;
    }

    // ── Caller farewell short-circuit ─────────────────────────────────────
    // When the caller says a clear farewell ("Thank you", "Bye", "நன்றி"…)
    // after the opening exchange, skip the LLM entirely and trigger end_call
    // immediately.  Without this, the LLM responds with an acknowledgment
    // ("சரிங்க") and keeps waiting — the caller has to hang up manually.
    // In group meetings, "thank you"/"bye" is usually participants talking to
    // EACH OTHER — never auto-leave the meeting on a farewell phrase.
    if (!this.isMeetingMode && this.turnIndex >= 3 && this.isCallerFarewellUtterance(transcript)) {
      const endCallTool = this.agent.tools.find((t) => t.type === "end_call");
      if (endCallTool) {
        logger.info(
          { callId: this.config.callId, transcript, turnIndex: this.turnIndex },
          "Pipeline: caller farewell detected — auto-triggering end_call (skipping LLM)",
        );
        this.logExec("Agent", "system", {
          status: "info",
          metadata: {
            event: "Caller Farewell Auto-End",
            transcript,
            turnNumber: this._activeTurnIndex,
          },
        });
        await this.executeEndCall(endCallTool as AgentTool & { type: "end_call" });
        await this.drainPlaybackTail();
        return;
      }
    }

    const guardrailResponse = this.checkGuardrailRoutes(transcript);
    if (guardrailResponse !== null) {
      logger.info({ callId: this.config.callId, transcript }, "Guardrail route triggered");
      this.bargeInHoldUntil = Date.now() + this.bargeInEchoGraceMs;
      this._currentTurnPlayedSentences = [];
      this.isPlaying = true;
      try { await this.playSentence(guardrailResponse); } finally { this.isPlaying = false; this.armTailEchoGrace(); }
      const heard = this.getHeardAgentText();
      if (heard) {
        this.conversationHistory.appendAssistant(heard);
        this.lastAssistantSpokenRaw = heard;
        this.config.onTranscript("agent", heard);
        this.config.onConversationUpdate?.(this.conversationHistory.messages);
      }
      // Drain the carrier's jitter buffer before returning to listening so the
      // last word of the canned response isn't clipped. This short branch
      // bypasses playTask's drain, so it must replicate it (see drainPlaybackTail).
      await this.drainPlaybackTail();
      return;
    }

    // ── Build tool definitions from agent config ──
    const toolDefs = buildToolDefs(this.agent.tools);
    toolDefs.push(SCHEDULE_CALLBACK_TOOL_DEF);

    const llmStart = Date.now();
    let llmFirstTokenAt: number | null = null;

    let llmResponse = "";
    let pendingText  = "";
    // One-step output guard: suppresses any second question (and everything
    // after it) so a turn that runs through multiple flow steps is truncated at
    // the first natural yield point. Mirrored into stored history below.
    const stepGuard = makeFlowStepGuard({ maxSentences: VOICE_MAX_SENTENCES_PER_TURN });
    let allEnqueued  = false;
    // Leading-ack suppression: when a dead-air or backchannel filler was already
    // spoken this turn, the first LLM sentence is checked and dropped if it is a
    // pure acknowledgment word ("சரி.", "okay.", etc.) — avoids the audible
    // double-ack where filler and LLM opener are the same word.
    let llmFirstSentenceProcessed = false;
    let triggeredToolName: string | null = null;
    let triggeredToolArgs: Record<string, unknown> = {};
    // Per-turn token usage (for the LLM execution-log row metadata).
    let turnInputTokens = 0;
    let turnOutputTokens = 0;
    let turnCachedTokens = 0;

    // ── Think-block + function-tag filters (streaming) ──────────────────────
    // Strips <think>…</think> blocks (DeepSeek-R1) and <function=…>…</function>
    // inline tags that some LLMs emit as text instead of using the tool API.
    const filterThinkToken = makeThinkFilter();
    const filterFnTag = makeFunctionTagFilter();
    const filterToolTail = makeToolTailFilter();
    const filterMarkup = makeMarkupTagFilter();
    const filterBrackets = makeBracketFilter();
    // Defense-in-depth tool-envelope guard: validated against the names of the
    // tools offered this turn so only a genuine serialized tool call is withheld
    // from TTS (ordinary bracketed text streams normally).
    const envelopeGuard = makeToolEnvelopeGuard(toolNamesOf(toolDefs));

    // Cartesia turn-level continuations: one context_id per LLM turn so
    // prosody is maintained across all sentences. finalizeTurnCtx() sends
    // {continue:false} after all sentences are queued.
    const cartesiaTts = this.tts instanceof CartesiaTTS ? this.tts : null;
    const turnContextId = cartesiaTts ? globalThis.crypto.randomUUID() : undefined;
    const finalizeTurnCtx = (): void => {
      if (turnContextId && cartesiaTts) cartesiaTts.finalizeTurnContext(turnContextId);
    };

    // Sentences are queued as TtsSentenceJobs whose synthesis is started at
    // enqueue time (below), not when playTask reaches them — this lets
    // sentence N+1's TTS network fetch run WHILE sentence N is still being
    // drained/played by playTask, closing the audible gap that otherwise
    // opens up between sentences in a multi-sentence reply. See
    // startSentenceSynthesis/drainSentenceJob for the correctness split.
    const sentenceQueue: TtsSentenceJob[] = [];
    let wakePlayer: (() => void) | null = null;

    const enqueue = (text: string, sequenceId: number = this.activeAgentSequenceId): void => {
      if (this.bargeInRequested) return;
      if (llmFirstTokenAt !== null && this._tTurnLlmFirstClause === null) {
        this._tTurnLlmFirstClause = performance.now();
      }
      // Extract any leading <emotion value="…"/> tag so the clean sentence goes
      // to TTS while the emotion array is forwarded to Cartesia's voice controls.
      const { emotion, text: cleanText } = extractEmotionTag(text);
      const emotions = emotion ? mapEmotionToCartesia(emotion) : undefined;
      if (emotion && emotions) {
        logger.info(
          { callId: this.config.callId, evt: "emotion_applied", emotion, emotions, textSnippet: cleanText.slice(0, 80) },
          "Emotion tag forwarded to TTS",
        );
      }
      sentenceQueue.push(this.startSentenceSynthesis(cleanText, this._activeTurnIndex, sequenceId, turnContextId, emotions));
      if (wakePlayer) {
        const wake = wakePlayer;
        wakePlayer = null;
        // Post-utterance grace (Bolna incremental_delay) is enforced once in
        // drainSentenceJob via waitForAudioEmit — do not also delay the player
        // wake here or agents with incrementalDelay>0 hear an extra silent gap
        // between the first LLM clause and first audible TTS byte.
        wake();
      }
    };

    const playTask = async (): Promise<void> => {
      let idx = 0;
      while (true) {
        if (idx < sentenceQueue.length) {
          const job = sentenceQueue[idx++]!;
          this.bargeInHoldUntil = Date.now() + this.bargeInEchoGraceMs;
      this.isPlaying = true;
          try {
            await this.playJob(job);
          } catch (err) {
            // A single sentence's TTS request failing (e.g. Cartesia rejecting a
            // voice/emotion control, a transient network blip) must not end the
            // whole call — the adapters already retry recoverable cases (see
            // CartesiaTTS's invalid-voice-controls retry); anything that still
            // reaches here is treated as "skip this sentence" so the agent keeps
            // listening/responding instead of hanging up on the caller.
            const reason = toReadableError(err, "TTS error");
            logger.error({ callId: this.config.callId, err, text: job.text.slice(0, 40) }, reason);
            this.reportTtsFailure(reason, { where: "sentence", text: job.text.slice(0, 40) });
          }
          if (this.bargeInRequested) break;
          // Max-duration graceful stop: the current sentence has finished playing,
          // so break BEFORE pulling the next one. The drain below still runs so the
          // final word is not clipped, then the caller tears the session down.
          if (this.endAfterCurrentSentence) break;
        } else if (allEnqueued) {
          break;
        } else {
          await new Promise<void>((r) => { wakePlayer = r; });
        }
      }
      this.isPlaying = false;
      this.armTailEchoGrace();
      // Drain the carrier's jitter buffer before the turn returns to listening.
      // playSentence's drain loop resolves as soon as the last chunk is handed
      // off, but the carrier still holds ~100-300ms — without this wait the final
      // word of a NORMAL turn is clipped as the turn ends (previously only the
      // goodbye/terminal/transfer paths drained). drainPlaybackTail is a no-op on
      // barge-in (the user is already speaking, so we must stop immediately) and
      // when closed. Mirrors the web path's per-turn tail-silence drain.
      await this.drainPlaybackTail();
    };

    const playPromise = playTask();

    // ── KB retrieval: use speech-start prefetch if available, else kick off now ─
    // When a prefetch fired on first-speech-frame (handleProcessedAudio), the
    // lookup has been running during the entire utterance + silence wait + STT
    // and is likely already resolved by the time we reach this line.
    // If no prefetch is available (agent has no KB, or prefetch wasn't triggered),
    // fall back to launching it here so it still overlaps with backchannel TTS.
    let systemPromptForTurn = this.agent.systemPrompt;
    const dtInjection = buildDatetimeInjection(this.agent.timezone);
    // Resolve the caller gender up-front (before the Gemini cache base is
    // captured) so {caller_salutation} in the base prompt is substituted INSIDE
    // the cached prefix. effectiveGender() lets an explicit mid-call caller
    // correction override the model-detected (and locked) gender.
    const detectedGender = this.effectiveGender();
    // Language guard — placed at BOTH top and bottom of the system prompt so it
    // survives both long prompts (top = high attention) and recency bias (bottom).
    //
    // Two modes:
    //   languageAutoDetect=true  → "FOLLOW CALLER" guide: tell the LLM which
    //     language the caller is currently using and ask it to match. No "NEVER
    //     switch" clause — switching is the entire point.
    //   languageAutoDetect=false → "ABSOLUTE RULE": enforce one language forever.
    const langGuard = this.buildLangGuard();
    // NOTE: dtInjection ([CURRENT DATE & TIME]) is deliberately NOT placed here.
    // It changes every minute, so keeping it near the top would invalidate the
    // OpenAI prompt cache for the entire static block that follows (language
    // rules + caller memory + base instructions + tool guides) on every turn —
    // OpenAI caching only reuses an exact, unbroken token prefix. It is appended
    // at the VERY END of the system prompt instead (see the "[CURRENT DATE &
    // TIME]" block after the staged-prompt layer below), so the large static
    // prefix stays byte-identical and cacheable turn-over-turn.
    systemPromptForTurn = langGuard
      ? `${langGuard}\n\n${systemPromptForTurn}\n\n${langGuard}`
      : systemPromptForTurn;

    // Resolve {caller_salutation} in the base prompt NOW, before capturing the
    // cache base. The full per-turn substitution still runs later (after the KB
    // and gender-directive appends) and is idempotent on this already-resolved
    // base, but doing it here first guarantees the captured prefix equals the
    // corresponding leading slice of the final systemPromptForTurn. Otherwise the
    // later substitution would mutate the prefix and GoogleLLM.cacheEligible()
    // (systemPrompt.startsWith(cacheBase)) would fail on EVERY turn for any agent
    // whose prompt uses {caller_salutation} — silently defeating the cache.
    systemPromptForTurn = this.substituteSalutation(
      systemPromptForTurn,
      this.salutationFor(detectedGender),
    );

    // Gemini explicit context caching: capture the static prefix (language guard +
    // salutation-resolved base instructions + baked KB) BEFORE the per-turn
    // volatile appends below (per-turn KB slice, gender directive, tool guides,
    // [TOOL CALLING], date/time) and BEFORE the staged-prompt override. The Google
    // adapter registers this prefix as a CachedContent once per call and only
    // re-sends the small volatile tail per turn. Passed to every provider but
    // honoured ONLY by GoogleLLM (ignored elsewhere). On a staged-prompt turn the
    // prompt is replaced, so this is no longer a prefix and the adapter's
    // startsWith() guard safely falls back to the uncached path.
    const cacheBaseForTurn = systemPromptForTurn;


    // KB context preference order (per-turn):
    // 1. LIVE hybrid retrieval (vector + FTS) against the actual transcript —
    //    this is what makes retrieval semantic/multilingual. It runs with a
    //    hard time budget so a slow embed can never delay the turn.
    // 2. The speech-start prefetch (query="" full dump) as fallback when the
    //    live retrieval misses its budget, errors, or finds nothing.
    // Previously the prefetch ALWAYS won when present, which made the query
    // path effectively dead on live calls.
    let kbContextPromise: Promise<KbRetrievalResult | null>;
    // Outer KB race window for THIS turn — scales up on skipFts (vector-only)
    // turns so the wider inner budget can actually elapse and surface the
    // prefetch fallback (see below where the inner budget is resolved).
    let kbOuterRaceMs = KB_CONTEXT_RACE_MS;
    const kbPrefetch = this.kbPrefetchPromise;
    this.kbPrefetchPromise = null;
    // Relabel a prefetch result as source:"prefetch" when it WINS the turn, so
    // the execution log distinguishes fallback context from a real query hit.
    const asPrefetch = (r: KbRetrievalResult | null): KbRetrievalResult | null =>
      r && r.text ? { ...r, source: "prefetch" } : r;
    if (this.agent.kbBakedOnly) {
      // Per-turn KB retrieval is intentionally disabled — the KB is fully baked into
      // the system prompt. Skip the embed+vector-search round-trip (~150-200ms saved).
      logger.debug({ callId: this.config.callId }, "KB per-turn retrieval skipped (kbBakedOnly=true)");
      kbContextPromise = Promise.resolve(null);
    } else if (this.agent.knowledgeSourceIds.length > 0 && transcript.trim().length > 0) {
      // Pure non-Latin transcripts (e.g. Tamil-only) skip English-config FTS
      // and go vector-only; code-mixed transcripts keep the hybrid path.
      const skipFts = isPureNonLatinQuery(transcript);
      // Inner budget: how long the live query retrieval gets before we settle
      // for the speech-start prefetch instead. skipFts (vector-only) turns get
      // a wider, MEASURED budget (default 800ms ≈ Tamil embed p90 + margin —
      // see resolveKbTurnBudgetMs) because the query embed alone takes
      // ~500-550ms; the old flat 200ms meant the semantic path lost to the
      // truncated dump on every Tamil turn (call 2159). Must stay BELOW the
      // outer race (kbOuterRaceMs below scales with this budget) or the
      // prefetch fallback can never surface.
      const budgetMs = resolveKbTurnBudgetMs(skipFts);
      // Outer race must exceed the inner budget; when the inner budget elapses
      // the (already-resolved) prefetch surfaces almost immediately, so the
      // worst-case turn stall stays ≈ budgetMs even on skipFts turns.
      kbOuterRaceMs = Math.max(KB_CONTEXT_RACE_MS, budgetMs + 100);
      const live = retrieveKbContextMultiEx(this.agent.knowledgeSourceIds, transcript, undefined, { skipFts, excludeTitles: this.krutrimSummaryExcludeTitles() })
        .catch((err) => {
          logger.warn({ callId: this.config.callId, err }, "KB retrieval failed — falling back to prefetch");
          return null;
        });
      if (kbPrefetch) {
        const TIMED_OUT = Symbol("kb-budget");
        kbContextPromise = Promise.race([
          live,
          new Promise<typeof TIMED_OUT>((r) => setTimeout(() => r(TIMED_OUT), budgetMs)),
        ]).then((res) => {
          if (res === TIMED_OUT) {
            logger.info({ callId: this.config.callId, budgetMs }, "KB live retrieval missed budget — using prefetch");
            return kbPrefetch.then(asPrefetch);
          }
          // Empty/failed live result → fall back to the prefetched full dump
          // so a zero-hit query never LOSES context vs the old behavior.
          return res && res.text ? res : kbPrefetch.then(asPrefetch);
        });
      } else {
        kbContextPromise = live;
      }
    } else if (kbPrefetch) {
      kbContextPromise = kbPrefetch.then(asPrefetch);
      logger.debug({ callId: this.config.callId }, "KB context: using speech-start prefetch");
    } else if (this.agent.knowledgeSourceIds.length > 0) {
      kbContextPromise = retrieveKbContextMultiEx(this.agent.knowledgeSourceIds, transcript, undefined, { skipFts: isPureNonLatinQuery(transcript), excludeTitles: this.krutrimSummaryExcludeTitles() })
        .catch((err) => {
          logger.warn({ callId: this.config.callId, err }, "KB retrieval failed — continuing without context");
          return null;
        });
    } else {
      kbContextPromise = Promise.resolve(null);
    }

    // ── Backchannel: enqueue filler CONCURRENT with KB retrieval + LLM startup ─
    // playTask starts TTS-ing the filler phrase while KB lookup and LLM warm up.
    // This fills the dead silence between the user finishing speaking and the
    // first agent word.
    // Skip when the caller only said a pure ack ("சரி", "okay") — playing
    // another filler before the real answer makes short turns feel like the
    // agent only said "okay" (call 2967).
    let backchanneledThisTurn = false;
    const skipFillerForBackchannelAck = isBackchannelOnlyUtterance(transcript);
    if (
      this.agent.backchannelingEnabled
      && !this.closed
      && !this.bargeInRequested
      && !skipFillerForBackchannelAck
    ) {
      // Prefer conversation language; bootstrap from agent target / STT config so
      // auto-detect agents still backchannel on turn 1 instead of staying silent.
      const fillerLang = this.currentLang
        || this.agent.language
        || this.agent.sttConfig.language
        || null;
      if (!fillerLang) {
        logger.info(
          { callId: this.config.callId, fillerType: "backchannel" },
          "Backchannel filler skipped — no language available",
        );
      } else {
        const baseFreq = this.agent.backchannelingFrequency ?? 0.5;
        // Honor the configured frequency for all languages (including Tamil).
        // The old 0.25 Tamil hard-cap made enabled backchanneling feel "broken".
        const freq = Math.max(0, Math.min(1, baseFreq));
        if (Math.random() < freq) {
          // Strict, language-based fillers only — no cross-language fallback.
          const fillerOpts = this.backchannelFillerOpts(transcript);
          const pool = getBackchannelFillers(fillerLang, fillerOpts);
          if (pool.length > 0) {
            const phrase = pickBackchannelFiller(fillerLang, this.recentFillerPhrases, fillerOpts)!;
            rememberFillerPhrase(this.recentFillerPhrases, phrase);
            logger.info(
              {
                callId: this.config.callId,
                fillerType: "backchannel",
                language: fillerLang,
                backchannelingEnabled: this.agent.backchannelingEnabled,
                frequency: freq,
                fillerListLength: pool.length,
                selectedFiller: phrase,
                ttsText: phrase,
              },
              "Backchannel filler selected (language-aware)",
            );
            enqueue(phrase, FILLER_SEQUENCE_ID);
            backchanneledThisTurn = true;
          } else {
            logger.info(
              {
                callId: this.config.callId,
                fillerType: "backchannel",
                language: fillerLang,
                backchannelingEnabled: this.agent.backchannelingEnabled,
                fillerListLength: 0,
              },
              "Backchannel filler skipped — no filler set for language",
            );
          }
        } else {
          logger.info(
            {
              callId: this.config.callId,
              fillerType: "backchannel",
              language: fillerLang,
              frequency: freq,
              backchannelingEnabled: true,
            },
            "Backchannel filler skipped — frequency roll",
          );
        }
      }
    }

    // Await KB result — by now it has been running concurrently with the backchannel TTS.
    // Race it against a short timeout so a slow KB lookup doesn't stall the turn: if the
    // prefetch hasn't resolved within KB_CONTEXT_RACE_MS the LLM starts with whatever
    // context is ready (possibly none) to keep first-token time low. The no-KB path
    // (knowledgeSourceIds empty) resolves immediately and is unaffected.
    let kbResult: KbRetrievalResult | null;
    let kbRaceTimedOut = false;
    const kbAwaitStart = Date.now();
    if (this.agent.knowledgeSourceIds.length === 0) {
      kbResult = await kbContextPromise;
    } else {
      // safeKb never rejects (the source promises already .catch), so the race can't throw.
      const safeKb: Promise<KbRetrievalResult | null> = kbContextPromise.catch(() => null);
      let kbRaceTimer: ReturnType<typeof setTimeout> | null = null;
      const kbTimeout = new Promise<null>((resolve) => {
        kbRaceTimer = setTimeout(() => { kbRaceTimer = null; resolve(null); }, kbOuterRaceMs);
      });
      kbResult = await Promise.race([safeKb, kbTimeout]);
      if (kbRaceTimer) clearTimeout(kbRaceTimer);
      else kbRaceTimedOut = kbResult === null;
      // Drain any late-resolving prefetch so it can't surface as an unhandled rejection;
      // its value is intentionally discarded (the turn already proceeded without it).
      void safeKb.catch(() => null);
      if (kbResult === null) {
        logger.debug({ callId: this.config.callId, raceMs: kbOuterRaceMs }, "KB context: race timed out or empty — proceeding without context");
      }
    }
    const kbContext = kbResult?.text || null;
    // Per-turn Knowledge execution-log event: whether KB context was injected,
    // where it came from, how long retrieval took, and how much text landed in
    // the prompt. Logged for every turn of a KB-attached agent (including
    // kbBakedOnly agents, where the KB lives in the baked system prompt).
    if (this.agent.knowledgeSourceIds.length > 0 || this.agent.kbBakedOnly) {
      const hit = this.agent.kbBakedOnly ? true : !!kbContext;
      const source = this.agent.kbBakedOnly ? "baked" : (kbResult?.source ?? "none");
      this.logExec(EXEC_COMPONENTS.Knowledge, "response", {
        status: "info",
        turnNumber: this._activeTurnIndex,
        latencyMs: this.agent.kbBakedOnly ? 0 : (kbResult?.latencyMs ?? Date.now() - kbAwaitStart),
        metadata: {
          event: "KB Context",
          hit,
          source,
          contextChars: kbContext?.length ?? 0,
          // Source attribution (multi-KB starvation diagnosis): which attached
          // sources actually contributed entries to this turn's context, and
          // whether a dump/prefetch block was cut by the char budget.
          ...(kbResult?.contributingSourceIds ? { contributingSourceIds: kbResult.contributingSourceIds } : {}),
          ...(kbResult?.truncated !== undefined ? { truncated: kbResult.truncated } : {}),
          ...(kbResult?.cached ? { cached: true } : {}),
          ...(kbRaceTimedOut ? { raceTimedOut: true, raceMs: kbOuterRaceMs } : {}),
        },
      });
    }
    if (kbContext) {
      // Precedence disclaimer: retrieved KB content is reference material and
      // must never override the agent's configured instructions above.
      systemPromptForTurn = `${systemPromptForTurn}\n\n## Relevant Knowledge Base Context\n\nThe following is reference knowledge base content. If any detail here conflicts with instructions already given above in the system prompt, the system prompt takes precedence — do not override agent-specific configuration with this reference material.\n\n${kbContext}`;
    }

    // Inject gender-based salutation directive once detection has resolved.
    // Appended AFTER the language guard so it wins on recency, and the salutation is
    // marked verbatim so the strict single-language rule above cannot translate it
    // (see memory: language-rule-proper-nouns — "Sir"/"Ma'am" get transliterated otherwise).
    // effectiveGender() (resolved above, before the cache base was captured) lets
    // an explicit mid-call caller correction override the model-detected gender.
    const correctionActive = this.salutationCorrection !== null;
    // Explicit-correction exception: even when a phrasing slips past
    // detectSalutationCorrection(), the LLM must still honor a clear verbal
    // correction from the caller for the rest of the call — and must do so
    // WITHOUT producing a self-contradictory apology that references a gender it
    // never actually used (the backwards "Sorry, I thought you were male, I'll
    // call you that" bug).
    const CORRECTION_EXCEPTION = ` EXCEPTION — caller corrections override everything: if the caller objects to or corrects how they are being addressed (in ANY language, including postfix-negation forms like "ma'am illa" / "sir nahi" and self-descriptions like "I'm a man" / "I'm a woman"), immediately switch to the salutation they ask for and use ONLY that for every remaining reply. Apologize briefly and naturally for the mix-up (e.g. a short "sorry about that") WITHOUT stating or guessing which gender you previously assumed — never say things like "I thought you were …", and do not argue about or explain your earlier assumption.`;
    // When a correction has actually been captured this call, the directive
    // below already names the corrected salutation; tell the model to
    // acknowledge the switch once, cleanly, with no reference to the prior wrong
    // assumption.
    const CORRECTION_ACK = correctionActive
      ? ` The caller has just corrected how they want to be addressed — acknowledge the switch briefly and naturally, and do NOT reference or apologize for any specific previous (incorrect) assumption about their gender.`
      : "";
    if (detectedGender === "male") {
      const sal = this.agent.genderDetectionMaleSalutation;
      systemPromptForTurn += `\n\n[CALLER GENDER — MANDATORY] The caller is male. You MUST address them as "${sal}" in essentially every reply (e.g. "Yes, ${sal}", "Of course, ${sal}", "Certainly, ${sal}"). Keep the word "${sal}" EXACTLY as written — never translate, localize, or transliterate it, even when you are replying in another language; treat it as a proper noun that OVERRIDES the language rule above. Never use "${this.agent.genderDetectionFemaleSalutation}".${CORRECTION_ACK}${CORRECTION_EXCEPTION}`;
    } else if (detectedGender === "female") {
      const sal = this.agent.genderDetectionFemaleSalutation;
      systemPromptForTurn += `\n\n[CALLER GENDER — MANDATORY] The caller is female. You MUST address them as "${sal}" in essentially every reply (e.g. "Yes, ${sal}", "Of course, ${sal}", "Certainly, ${sal}"). Keep the word "${sal}" EXACTLY as written — never translate, localize, or transliterate it, even when you are replying in another language; treat it as a proper noun that OVERRIDES the language rule above. Never use "${this.agent.genderDetectionMaleSalutation}".${CORRECTION_ACK}${CORRECTION_EXCEPTION}`;
    } else if (detectedGender === null && this.agent.genderDetectionNeutralSalutation) {
      const sal = this.agent.genderDetectionNeutralSalutation;
      systemPromptForTurn += `\n\n[CALLER GENDER] Gender not yet determined. Use "${sal}" as a neutral salutation when addressing the caller, kept exactly as written.`;
    }

    // ── Substitute {caller_salutation} placeholder ────────────────────────
    // The initial variable-resolution pass (session.ts) deliberately skips
    // this placeholder so it can be filled in here, after gender detection.
    {
      const resolvedSal = this.salutationFor(detectedGender);
      systemPromptForTurn = this.substituteSalutation(systemPromptForTurn, resolvedSal);
      logger.info(
        { callId: this.config.callId, resolvedSalutation: resolvedSal || "(empty)", detectedGender, correction: this.salutationCorrection },
        "Pipeline: caller_salutation resolved",
      );
    }

    // Inject scheduling tool usage guide when the agent has cancel/reschedule/list-bookings tools
    const hasSchedulingNav = this.agent.tools.some(
      (t) => t.type === "native_cancel" || t.type === "native_reschedule" || t.type === "native_list_bookings",
    );
    if (hasSchedulingNav) {
      const listTool = this.agent.tools.find((t) => t.type === "native_list_bookings");
      const checkTool = this.agent.tools.find((t) => t.type === "native_check_availability");
      const cancelTool = this.agent.tools.find((t) => t.type === "native_cancel");
      const rescheduleTool = this.agent.tools.find((t) => t.type === "native_reschedule");
      const listName = listTool?.name ?? "get_bookings";
      const checkName = checkTool?.name ?? "check_availability";
      const navDefaultTz = (listTool as any)?.timezone ?? (cancelTool as any)?.timezone ?? (rescheduleTool as any)?.timezone ?? (checkTool as any)?.timezone ?? "Asia/Kolkata";
      systemPromptForTurn += [
        "",
        "",
        "[SCHEDULING TOOL GUIDE]",
        "State machine for cancel/reschedule:",
        `1. ALWAYS call "${listName}" (not "${checkName}") to look up their existing appointment by name. Never call "${checkName}" for this purpose.`,
        `2. Always pass timezone="${navDefaultTz}" into every scheduling tool call. NEVER ask the caller what timezone they are in — default silently to "${navDefaultTz}" unless the caller explicitly asks about a different timezone.`,
        `3. If "${listName}" returns an empty result, say: "There are no upcoming bookings under your name."`,
        `4. If all returned bookings are in the past, say: "Your previous appointment has already passed — I can only reschedule upcoming ones. Would you like to book a new one?"`,
        `5. Once a booking is identified for rescheduling: call "${checkName}" for the SAME DATE as the existing booking unless the caller explicitly states a different date. Use the booking's existing date as preferred_date.`,
        `6. After the caller confirms a new slot, call the reschedule tool. Once reschedule_confirmed is returned, the context is cleared.`,
        `IMPORTANT: NEVER invent or guess slot times. You MUST call "${checkName}" before offering any available times to the caller. Only relay times that you received from a tool result.`,
      ].join("\n");

      // Inject active reschedule context so the LLM defaults to the correct date
      if (this.activeRescheduleBooking) {
        const { bookingId, isoDate, timeLabel, eventName } = this.activeRescheduleBooking;
        systemPromptForTurn += [
          "",
          "",
          "[ACTIVE RESCHEDULE CONTEXT]",
          `Currently rescheduling booking #${bookingId} (${eventName}: ${timeLabel}).`,
          `When the caller proposes only a new time (e.g. "Can we do 12:30?"), you MUST default preferred_date to "${isoDate}" unless they explicitly state a different date.`,
          `Always pass preferred_date as a full ISO datetime (e.g. "${isoDate}T12:30:00+05:30") — never omit the date portion.`,
        ].join("\n");
      }
    }

    // Inject booking/availability guide when the agent has a native_booking or native_check_availability tool
    const hasBookingTool = this.agent.tools.some((t) => t.type === "native_booking");
    const hasCheckAvailabilityTool = this.agent.tools.some((t) => t.type === "native_check_availability");
    if (hasBookingTool || hasCheckAvailabilityTool) {
      const bookTool = this.agent.tools.find((t) => t.type === "native_booking");
      const checkTool = this.agent.tools.find((t) => t.type === "native_check_availability");
      const bookName = bookTool?.name ?? "book_appointment";
      const checkName = checkTool?.name ?? "check_availability";
      // Use the tool's configured default timezone; fall back to Asia/Kolkata
      const calDefaultTz = (bookTool as any)?.timezone ?? (checkTool as any)?.timezone ?? "Asia/Kolkata";
      const lines = [
        "",
        "",
        "[BOOKING TOOL GUIDE]",
        `CRITICAL: NEVER invent, guess, or assume any available slot times. You MUST call "${checkName}" before telling the caller any available times. Only relay times you received directly from a "${checkName}" tool result.`,
        `TIMEZONE RULE: The calendar is configured for timezone "${calDefaultTz}". Always pass timezone="${calDefaultTz}" in every tool call. NEVER ask the caller what timezone they are in — default silently to "${calDefaultTz}" unless the caller explicitly asks about a different timezone, in which case use that IANA timezone string.`,
      ];
      if (hasCheckAvailabilityTool) {
        lines.push(
          `"${checkName}" ONLY checks available slots — it does NOT create a booking.`,
          `"${checkName}" returns one of three result types:`,
          `  • requested_slot_available — the exact time the caller asked for is open. Tell the caller the time is available, then immediately ask for their full name and email and call "${bookName}" with the ISO string from the 'slot' field verbatim as preferred_date.`,
          `  • requested_slot_unavailable — the requested time is not open. Tell the caller and read out the slots from the 'alternatives' field. Once the caller picks one, collect their name and email and call "${bookName}" with the chosen ISO string verbatim as preferred_date.`,
          `  • available_slots — a general list of upcoming slots. Each entry in 'next' is an ISO 8601 string followed by a human label in parentheses. Present them to the caller. After the caller picks one, collect name and email and call "${bookName}" with the ISO string verbatim as preferred_date.`,
          `Always pass ISO strings to "${bookName}" exactly as returned — never reformat or convert them.`,
        );
      }
      if (hasBookingTool) {
        lines.push(
          `Before calling "${bookName}", you MUST collect the caller's full name and email address. Ask for them if not yet provided.`,
          `NEVER tell the caller their appointment is confirmed or scheduled unless you have received a booking_confirmed: result from "${bookName}".`,
          `Do NOT say "Your appointment has been scheduled" or any equivalent phrase before "${bookName}" returns a booking_confirmed: result.`,
          `When "${bookName}" returns booking_pending: — the booking was received but NOT confirmed. Tell the caller ONLY: "Your appointment request has been received and is pending confirmation — we'll follow up to confirm it." Do NOT say it is booked, scheduled, or confirmed. NEVER mention internal reasons like "Google Calendar", "calendar event creation failed", or any technical system error to the caller — just say it is pending confirmation.`,
          `When "${bookName}" returns booking_failed: — the booking could not be created. Tell the caller the booking could not be completed and ask them to try again or call back. Do NOT mention technical errors or system details.`,
        );
      }
      systemPromptForTurn += lines.join("\n");
    }

    // ── Tool-call preamble suppression ────────────────────────────────────────
    // OpenAI-compatible models (including Sarvam) emit EITHER content tokens OR
    // tool_calls — never both in the same streaming response. If the model
    // generates a text preamble like "I'll check for you…", it has already
    // committed to a text response and will NOT call the tool in that turn.
    // This instruction block tells the model to skip the preamble and call the
    // tool directly so the pipeline's onToolCall fires in the same turn.
    if (toolDefs.length > 0) {
      systemPromptForTurn += [
        "",
        "",
        "[TOOL CALLING — MANDATORY]",
        "When the caller's request requires a tool call, call the tool IMMEDIATELY — do NOT emit any text before the tool call.",
        "Never say 'I'll check', 'Let me look up', 'One moment', 'Please wait' or any similar preamble — those phrases prevent the tool from running in the same turn.",
        "The system automatically plays a brief wait tone to the caller while the tool runs; you do not need to announce it.",
        "If you are missing a required parameter, ask for it in a single short question — do not say you will look it up first.",
      ].join("\n");
    }

    // ── Token Optimization (Layers 1-4) ──────────────────────────────────────
    const tokenOptEnabled = await fetchTokenOptEnabled();
    const fullHistoryLen = this.conversationHistory.messages.length;

    // Layer 2: Sliding Window — trim context to last N turns
    let historyForLlm: ConversationTurn[] = this.conversationHistory.sanitizeToolMessages();
    if (tokenOptEnabled && this.agent.contextWindowTurns && this.agent.contextWindowTurns > 0) {
      historyForLlm = historyForLlm.slice(-this.agent.contextWindowTurns);
    }
    const sentHistoryLen = historyForLlm.length;

    // Meeting speaker identification: tag the caller's utterance with the name
    // of the participant Recall last reported speaking, so the LLM knows WHO in
    // the meeting said it. LLM-history-only — UI transcripts stay untagged.
    if (this.meetingSpeakerName && historyForLlm.length > 0) {
      const lastTurn = historyForLlm[historyForLlm.length - 1]!;
      if (lastTurn.role === "user") {
        historyForLlm = [
          ...historyForLlm.slice(0, -1),
          { ...lastTurn, content: `[Speaker: ${this.meetingSpeakerName}] ${lastTurn.content}` },
        ];
      }
    }

    // Per-turn language reminder: append a compact reminder to the last user turn.
    // This is the strongest enforcement point — it sits immediately before the LLM
    // generates, so it can't be pushed out of attention by a long system prompt.
    if (langGuard && historyForLlm.length > 0) {
      const lastTurn = historyForLlm[historyForLlm.length - 1]!;
      if (lastTurn.role === "user") {
        const langName = LANG_DISPLAY_NAMES[this.currentLang!] ?? this.currentLang!;
        const reminder = this.agent.languageAutoDetect
          ? `[Language: caller is speaking ${langName} — respond in ${langName}; switch immediately if they change language]`
          : `[Reminder: reply in ${langName} only]`;
        historyForLlm = [
          ...historyForLlm.slice(0, -1),
          { ...lastTurn, content: `${lastTurn.content}\n\n${reminder}` },
        ];
      }
    }

    // Per-turn conversation-discipline reminder: appended to the last user turn so
    // it sits at the highest-attention point (just before generation) and survives
    // both long prompts and the staged-prompt override below (which replaces the
    // system prompt but not the history). Enforces one-step delivery, wait-for-
    // response turn yielding, and resume-after-objection place-keeping.
    if (historyForLlm.length > 0) {
      const lastTurn = historyForLlm[historyForLlm.length - 1]!;
      if (lastTurn.role === "user") {
        historyForLlm = [
          ...historyForLlm.slice(0, -1),
          { ...lastTurn, content: `${lastTurn.content}\n\n${CONVERSATION_DISCIPLINE_TURN_REMINDER}` },
        ];
      }
    }

    // Per-turn anti-repeat nudge (call 548), intent-scoped (call 1915): quote the
    // agent's previous line onto the last user turn and forbid a verbatim repeat.
    // The directive is scoped to the caller's actual intent — hold-requests get a
    // "confirm you're waiting, do NOT advance" directive, questions get an
    // "answer it first" directive, and only genuine bare acknowledgements get the
    // original "advance to the next point" push (which used to steamroll callers
    // who asked to wait or asked a question). Escalates after a detected repeat.
    if (this.lastAssistantSpokenRaw && historyForLlm.length > 0) {
      const lastTurn = historyForLlm[historyForLlm.length - 1]!;
      if (lastTurn.role === "user") {
        const antiRepeat = buildAntiRepeatNudge({
          lastUserText: transcript,
          prevLine: this.lastAssistantSpokenRaw.slice(0, 180),
          escalated: this.consecutiveRepeats >= 1,
        });
        historyForLlm = [
          ...historyForLlm.slice(0, -1),
          { ...lastTurn, content: `${lastTurn.content}\n\n${antiRepeat}` },
        ];
      }
    }

    // Interruption hint: if the previous agent turn was cut short by barge-in,
    // tell the LLM exactly what the caller already heard so it continues (or asks
    // one short question) instead of restarting consent / greeting / pitch.
    if (this._interruptionHint && historyForLlm.length > 0) {
      const lastTurn = historyForLlm[historyForLlm.length - 1]!;
      if (lastTurn.role === "user") {
        const heard = this._interruptionHint.slice(0, 300);
        const hint =
          `[INTERRUPTED — DO NOT RESTART] Your previous reply was cut mid-delivery. ` +
          `The caller already heard (possibly partial): "${heard}". ` +
          `Do NOT restart recording consent, greeting, self-intro, welcome, or sales pitch from the top. ` +
          `Continue from the interrupted step, OR ask ONE short clarifying question about what they just said. ` +
          `Never ask "can you hear me" / "கேக்குதா" unless the caller explicitly said nothing at all.`;
        historyForLlm = [
          ...historyForLlm.slice(0, -1),
          { ...lastTurn, content: `${lastTurn.content}\n\n${hint}` },
        ];
      }
      this._interruptionHint = null;
    }

    // Caller reported they cannot hear the agent (usually because TTS was cut).
    // Resume the unfinished point — do NOT enter a hearing-check loop.
    if (this.pendingAudioDifficultyNote && historyForLlm.length > 0) {
      const lastTurn = historyForLlm[historyForLlm.length - 1]!;
      if (lastTurn.role === "user") {
        const resume =
          `[AUDIO FEEDBACK] The caller says they cannot hear you clearly (your line was likely cut). ` +
          `Do NOT ask "can you hear me?", "கேக்குதா?", or any hearing check. ` +
          `Immediately restate the ONE unfinished point in a short, clear sentence, then STOP and wait.`;
        historyForLlm = [
          ...historyForLlm.slice(0, -1),
          { ...lastTurn, content: `${lastTurn.content}\n\n${resume}` },
        ];
      }
      this.pendingAudioDifficultyNote = false;
    }

    // Caller is asking what you were talking about (STT may have mangled the name).
    if (this.pendingTopicClarificationNote && historyForLlm.length > 0) {
      const lastTurn = historyForLlm[historyForLlm.length - 1]!;
      if (lastTurn.role === "user") {
        const clarify =
          `[CLARIFY LAST TOPIC] The caller wants you to explain again what you just said ` +
          `(product/program names in STT may be wrong — e.g. "Kala Fit" ≈ Gala Fit). ` +
          `Do NOT say "we got cut off". Do NOT restart greeting/consent/full pitch. ` +
          `Give a short clear re-explanation of the last benefit you mentioned, then ask one check question.`;
        historyForLlm = [
          ...historyForLlm.slice(0, -1),
          { ...lastTurn, content: `${lastTurn.content}\n\n${clarify}` },
        ];
      }
      this.pendingTopicClarificationNote = false;
    }

    // Layer 4: Staged Prompt — override system prompt with active stage block
    if (tokenOptEnabled && this.agent.stagedPromptEnabled && this.agent.stagedPromptStages.length > 0) {
      const stage = this.agent.stagedPromptStages[this.currentStageIndex];
      if (stage) {
        const core = this.agent.stagedPromptCoreIdentity?.trim() ?? "";
        systemPromptForTurn = core ? `${core}\n\n${stage.content}` : stage.content;
        // The staged block fully replaces the base system prompt (and its
        // discipline block), so re-append the discipline rules to keep one-step
        // delivery / wait-for-response / resume-after-objection active per turn.
        systemPromptForTurn += `\n\n${CONVERSATION_DISCIPLINE_BLOCK}`;
        logger.debug({ callId: this.config.callId, stage: stage.name, idx: this.currentStageIndex }, "Staged prompt active");
      }
    }

    // ── Opening-only directive neutralizer ────────────────────────────────────
    // The caller-memory returning-caller directive ("Open by greeting them by
    // name and naturally reference what you already know…"), the resume-from-drop
    // directive ("Briefly acknowledge the interruption…") and the network-drop
    // RESUME DIRECTIVE ("Open warmly and acknowledge the drop…") are phrased as
    // OPENING instructions but live in the system prompt for the whole call. The
    // greeting path (compact greeting LLM or static opener) already delivered
    // that opening, so without this note the first real reply re-greets /
    // re-references prior context / re-acknowledges the drop a second time.
    //
    // Once ANY assistant turn exists in the conversation history the opening has
    // been spoken (covers the LLM greeting, static greeting, and the
    // firstSpeaker=user case where the LLM's own first reply IS the opener), so
    // append a one-shot note marking those opening-only directives as satisfied.
    // The persistent rules (NAME PRIORITY, DO NOT RE-ASK KNOWN INFORMATION,
    // memory FACTS) explicitly stay in force.
    //
    // Placement: AFTER the staged-prompt rebuild (so it survives the prompt
    // replacement) and AFTER cacheBaseForTurn was captured (so the Gemini cached
    // prefix stays byte-identical — this lives in the volatile per-turn tail).
    // It is appended BEFORE the per-minute [CURRENT DATE & TIME] block and its
    // text is constant, so once it first appears the prefix stays stable for
    // OpenAI-style prompt caching (at most one cache-miss turn when it appears).
    const hasOpeningOnlyDirective =
      this.agent.systemPrompt.includes("THIS IS A RETURNING CALLER") ||
      this.agent.systemPrompt.includes("RESUME, DO NOT RESTART") ||
      this.agent.systemPrompt.includes("=== RESUME DIRECTIVE ===");
    const openerAlreadySpoken = this.conversationHistory.messages.some((t) => t.role === "assistant");
    if (hasOpeningOnlyDirective && openerAlreadySpoken) {
      systemPromptForTurn += `\n\n${OPENING_ALREADY_DELIVERED_NOTE}`;
    }

    // Voice Memory — handoff / cross-number notes live in the volatile per-turn
    // tail so Gemini / OpenAI cached prefixes stay byte-stable.
    if (this.voiceHandoffActive) {
      if (this.pendingSpeakerChallenge && !this.speakerChallengeSpoken) {
        systemPromptForTurn += `\n\n${SPEAKER_HANDOFF_CHALLENGE_NOTE}`;
        this.pendingSpeakerChallenge = false;
      } else if (this.speakerChallengeSpoken) {
        systemPromptForTurn += `\n\n${SPEAKER_HANDOFF_AFTER_CHALLENGE_NOTE}`;
      } else {
        systemPromptForTurn += `\n\n${SPEAKER_HANDOFF_SUPPRESS_NOTE}`;
      }
    } else if (this.pendingVoiceLinkNote && this.voiceLinkedFromPhone) {
      systemPromptForTurn += `\n\n${VOICE_LINKED_PHONE_NOTE}`;
      this.pendingVoiceLinkNote = false;
    }
    // Voice-matched caller history (new number, known voice) — persistent every
    // turn while the same speaker stays on the line; cleared on handoff.
    if (!this.voiceHandoffActive && this.voiceLinkedMemoryBlock) {
      systemPromptForTurn += `\n\n${this.voiceLinkedMemoryBlock}`;
      // One-shot: on the first turn after the linked memory arrives, have the
      // agent proactively acknowledge the returning caller instead of waiting
      // to be asked "do you remember me?" (user report: recognition worked but
      // the agent never said so).
      if (this.pendingVoiceLinkAck) {
        systemPromptForTurn += `\n\n${VOICE_LINK_ACK_NOTE}`;
        this.pendingVoiceLinkAck = false;
      }
    }

    // One-shot: real human picked up after a call-screening bot — restart the
    // conversation with a fresh greeting (volatile tail, cache-safe).
    if (this.pendingScreeningPickupNote) {
      systemPromptForTurn += `\n\n${SCREENING_PICKUP_NOTE}`;
      this.pendingScreeningPickupNote = false;
    }

    // ── Meeting speaker identification (Recall bot calls) ────────────────────
    // Persistent participant-list line + one-shot join/leave notes. Volatile
    // tail placement keeps the cached static prefix byte-stable.
    if (this.meetingRosterLine) {
      systemPromptForTurn += `\n\n${this.meetingRosterLine}`;
    }
    if (this.pendingMeetingNotes.length) {
      const notes = this.pendingMeetingNotes.splice(0, this.pendingMeetingNotes.length);
      systemPromptForTurn += `\n\n[MEETING UPDATE] ${notes.join(" ")} Acknowledge only if natural — do not interrupt the current topic.`;
    }



    // ── [CURRENT DATE & TIME] — appended LAST for prompt-cache stability ──────
    // This is the only element that changes on every single turn (down to the
    // minute). Appending it here — after the base prompt, KB context, gender
    // directive, tool guides AND the staged-prompt rebuild above — keeps every
    // token before it byte-identical across turns, so OpenAI prompt caching can
    // serve the large static block (language rules + caller memory + base
    // instructions + tool guides) from cache instead of reprocessing it every
    // turn. It sits at the tail of the system message, immediately before the
    // conversation history that llm.chat() appends after it.
    systemPromptForTurn += `\n\n${dtInjection}`;

    // Layer 1: Anthropic KV Cache flag (honoured by AnthropicLLM adapter)
    const useKvCache = tokenOptEnabled && this.agent.llmProvider === "anthropic";

    // ── Dead-air filler timer ────────────────────────────────────────────────
    // If the LLM has not returned a first token within FILLER_THRESHOLD_MS and
    // backchannel didn't already cover the silence, enqueue a filler phrase so
    // the caller hears something rather than dead air.
    let fillerTimer: ReturnType<typeof setTimeout> | null = null;
    if (
      this.agent.backchannelingEnabled
      && !backchanneledThisTurn
      && !skipFillerForBackchannelAck
      && !this.closed
      && !this.bargeInRequested
    ) {
      fillerTimer = setTimeout(() => {
        if (!llmFirstTokenAt && !this.bargeInRequested && !this.closed) {
          // Strict, language-based fillers only — no hardcoded English fallback.
          // Mirror the backchannel language resolution: prefer currentLang, fall back
          // to sttConfig.language only for single-language agents (no auto-detect).
          // This prevents the "en-IN" STT config from selecting English fillers in a
          // Tamil conversation at the 800ms dead-air point.
          const fillerLang = this.currentLang
            || (this.agent.languageAutoDetect ? null : this.agent.sttConfig.language);
          if (!fillerLang) {
            logger.info(
              { callId: this.config.callId, fillerType: "dead-air" },
              "Dead-air filler skipped — language not yet established (auto-detect agent)",
            );
            return;
          }
          const fillerOpts = this.backchannelFillerOpts(transcript);
          const pool = getBackchannelFillers(fillerLang, fillerOpts);
          const phrase = pickBackchannelFiller(fillerLang, this.recentFillerPhrases, fillerOpts);
          if (!phrase) {
            logger.info(
              {
                callId: this.config.callId,
                fillerType: "dead-air",
                language: fillerLang,
                backchannelingEnabled: this.agent.backchannelingEnabled,
                fillerListLength: pool.length,
              },
              "Dead-air filler skipped — no filler set for language (LLM > filler threshold)",
            );
            return;
          }
          rememberFillerPhrase(this.recentFillerPhrases, phrase);
          logger.info(
            {
              callId: this.config.callId,
              fillerType: "dead-air",
              language: fillerLang,
              backchannelingEnabled: this.agent.backchannelingEnabled,
              fillerListLength: pool.length,
              selectedFiller: phrase,
              ttsText: phrase,
            },
            "Dead-air filler enqueued (language-aware, LLM > filler threshold)",
          );
          enqueue(phrase, FILLER_SEQUENCE_ID);
          this._deadAirFillerEnqueuedAt = Date.now();
          this.fillerPlayedCount++;
          this._fillerPlayedThisTurn = true;
        }
      }, FILLER_THRESHOLD_MS);
    }

    const _agnostTurn = process.env["AGNOST_API_KEY"] ? agnost.begin({
      userId:         this.config.callerPhone ?? String(this.config.callId),
      agentName:      this.agent.name,
      input:          transcript,
      conversationId: String(this.config.callId),
      properties: {
        agentId:     this.agent.id,
        llmProvider: this.agent.llmProvider,
        llmModel:    this.agent.llmModel ?? "",
        callId:      this.config.callId,
      },
    }) : null;

    // ── Task 4: Language-confusion recovery injection ───────────────────────
    // After ≥ 2 consecutive turns where the filler guard held the current
    // language (caller said English backchannels in a Tamil conversation),
    // the LLM may have lost track of the call flow and is looping on
    // "I'm speaking in Tamil / do you want another language?".
    // Inject a one-shot system note before the LLM call so it resumes from
    // the last content topic instead of restarting the call flow.
    // The note is injected ONCE (counter resets immediately) and uses role
    // "user" with a [SYSTEM NOTE] prefix so it works across all providers.
    if (this._consecutiveHeldFillerTurns >= 2 && !this._recoveryNoteInjected) {
      const recoveryNote =
        "[SYSTEM NOTE — do not read this aloud] Language confusion has been resolved. " +
        "Resume your call flow from the last content topic you were explaining before the confusion — " +
        "do not re-introduce yourself, do not restart the call from the beginning, " +
        "and do not ask about language preferences again. Continue from where you left off.";
      this.conversationHistory.appendUser(recoveryNote);
      this._recoveryNoteInjected = true;
      this._consecutiveHeldFillerTurns = 0;
      logger.info(
        { callId: this.config.callId, turnNumber: _currentTurnIndex },
        "Language confusion recovery note injected into conversation history",
      );
    }

    this.logExec("LLM", "request", {
      provider: this.agent.llmProvider,
      status: "info",
      turnNumber: _currentTurnIndex,
      requestPayload: {
        model: this.agent.llmModel ?? "",
        systemPromptPreview: systemPromptForTurn.substring(0, 800),
        historyLength: historyForLlm.length,
        tools: toolDefs.length > 0 ? toolDefs.map((t) => (t as any).function?.name ?? (t as any).name).filter(Boolean) : [],
      },
    });

    // ── Speculative LLM prefill — consume or abort ───────────────────────────
    this.interruptionMgr.pruneStaleSequences();
    this.activeAgentSequenceId = this.interruptionMgr.beginAgentTurn();
    // If _launchSpeculativeLlm() fired at barge-in time and the final transcript
    // is close enough to the partial, replay the already-buffered tokens through
    // the normal onToken pipeline via a mock adapter.  On a miss, abort the
    // background speculative call and fall through to the real llm.chat below.
    //
    // JS is single-threaded, so the splice(0) + tokenSink redirect is atomic —
    // no new tokens can arrive between drain and redirect.
    const _spec = this._specLlmState;
    this._specLlmState = null;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let effectiveLlm: typeof this.llm = this.llm;
    if (_spec) {
      // A language switch detected on THIS final transcript makes the prefill
      // stale: its langGuard/system prompt were built for the previous
      // language, so replaying it answers the caller in the WRONG language
      // (call 4814: Tamil caller, English turn-1 reply). Treat as a miss so
      // the real llm.chat below rebuilds the prompt with the new language.
      const _specLangStale = _spec.langAtLaunch !== this.currentLang;
      if (!_spec.aborted && !_spec.storedToolCall && !_specLangStale && isSpeculativeHit(_spec.partial, transcript)) {
        this._eagerLlmHitThisTurn = true;
        this.logExec("LLM", "system", {
          status: "info", turnNumber: _currentTurnIndex,
          metadata: {
            event: "Speculative LLM Hit",
            partial: _spec.partial.slice(0, 80),
            final: transcript.slice(0, 80),
            bufferedTokens: _spec.storedTokens.length,
            done: _spec.done,
          },
        });
        logger.info(
          { callId: this.config.callId, partial: _spec.partial.slice(0, 60), final: transcript.slice(0, 60), buffered: _spec.storedTokens.length },
          "Speculative LLM hit — replaying prefill tokens",
        );
        const spec = _spec;
        effectiveLlm = {
          chat: async (
            _h: ConversationTurn[],
            _s: string,
            realOnToken: (t: string) => void,
            realOnDone: (ft: string, u?: LLMUsage) => void,
            realOpts?: Parameters<LLMAdapter["chat"]>[4],
          ) => {
            // 1. Drain tokens buffered so far (synchronous — no event-loop yield)
            const buffered = spec.storedTokens.splice(0);
            // 2. Redirect future tokens from the still-running speculative stream
            spec.tokenSink = (t) => realOnToken(t);
            // 3. Flush buffered tokens through the real filter pipeline
            for (const t of buffered) realOnToken(t);
            // 4. Wait for the speculative stream to finish
            await spec.completedPromise;
            // 5. Signal completion and report usage
            realOnDone(spec.storedFullText);
            if (spec.storedUsage && realOpts?.onUsage) realOpts.onUsage(spec.storedUsage);
          },
        } as unknown as typeof this.llm;
      } else {
        // Miss (or tool call in speculative): discard speculative tokens.
        _spec.aborted = true;
        if (_specLangStale) {
          // Logged even when the prefill already completed — this is the
          // wrong-language near-miss trail (see call 4814 turn 1).
          logger.info(
            {
              callId: this.config.callId,
              langAtLaunch: _spec.langAtLaunch || "(none)",
              langNow: this.currentLang || "(none)",
              partial: _spec.partial.slice(0, 60),
            },
            "Speculative LLM invalidated — caller language switched after prefill launch",
          );
        } else if (!_spec.done) {
          logger.info(
            { callId: this.config.callId, partial: _spec.partial.slice(0, 60), final: transcript.slice(0, 60) },
            "Speculative LLM miss — aborting prefill",
          );
        }
      }
    }

    // 1 initial + up to 2 same-provider retries for transient (503/429/5xx/network)
    // errors, so a momentary provider blip no longer drops the whole call.
    const MAX_LLM_ATTEMPTS = 3;
    let llmErr: unknown = null;
    let ttftFallbackTimer: ReturnType<typeof setTimeout> | null = null;
    const clearTtftFallbackTimer = () => {
      if (ttftFallbackTimer) { clearTimeout(ttftFallbackTimer); ttftFallbackTimer = null; }
    };
    const armTtftFallbackTimer = () => {
      clearTtftFallbackTimer();
      if (!this.fallbackLlm || effectiveLlm !== this.llm) return;
      ttftFallbackTimer = setTimeout(() => {
        if (llmFirstTokenAt || this.bargeInRequested || this.closed) return;
        logger.warn(
          { callId: this.config.callId, thresholdMs: LLM_TTFT_FALLBACK_MS, provider: this.agent.llmProvider },
          "Primary LLM TTFT exceeded — cancelling in-flight request for fallback",
        );
        this.logExec("LLM", "system", {
          status: "info",
          turnNumber: _currentTurnIndex,
          metadata: {
            event: "TTFT Fallback Triggered",
            thresholdMs: LLM_TTFT_FALLBACK_MS,
            provider: this.agent.llmProvider,
          },
        });
        this.llm.cancelInFlight?.();
      }, LLM_TTFT_FALLBACK_MS);
    };
    for (let llmAttempt = 1; llmAttempt <= MAX_LLM_ATTEMPTS; llmAttempt++) {
    if (llmAttempt > 1) {
      // Only reachable when the previous attempt threw a RETRYABLE error BEFORE
      // streaming any token (llmFirstTokenAt === null): no LLM-derived sentence
      // was enqueued to TTS, so restarting the stream cleanly cannot double-speak
      // the model's reply. Reset per-attempt stream + tool state defensively.
      llmResponse = "";
      pendingText  = "";
      triggeredToolName = null;
      triggeredToolArgs = {};
      await new Promise<void>((r) => setTimeout(r, 300 * (llmAttempt - 1)));
      logWarningEvent(this.logFn, EXEC_COMPONENTS.LLM, "LLM Retry", ["llm_retry"], {
        provider: this.agent.llmProvider,
        retryCount: llmAttempt - 1,
        detail: {
          event: "LLM Retry (same provider, transient error)",
          provider: this.agent.llmProvider,
          attempt: llmAttempt,
          error: toReadableError(llmErr, "LLM error"),
        },
      });
    }
    try {
      armTtftFallbackTimer();
      await effectiveLlm.chat(
        historyForLlm,
        systemPromptForTurn,
        (token) => {
          if (this.bargeInRequested) return;
          if (!llmFirstTokenAt) {
            llmFirstTokenAt = Date.now();
            this._tTurnLlmFirstToken = performance.now();
            clearTtftFallbackTimer();
            this.onLlmFirstTokenReceived();
            // LLM responded in time — cancel the dead-air filler before it fires
            if (fillerTimer) { clearTimeout(fillerTimer); fillerTimer = null; }
            const ttftMs = llmFirstTokenAt - llmStart;
            const slowTtft = ttftMs >= LLM_SLOW_TTFT_MS;
            this.logExec("LLM", "system", {
              provider: this.agent.llmProvider,
              status: "info",
              turnNumber: _currentTurnIndex,
              durationMs: ttftMs,
              ...(slowTtft ? { warningFlags: ["slow_ttft"] as const } : {}),
              metadata: { event: "First Token Received", ttftMs, slow: slowTtft },
            });
          }
          llmResponse += token;                  // keep raw response (incl. think blocks)
          const afterThink = filterThinkToken(token);
          if (!afterThink) return;               // token was entirely inside a think block
          const afterFn = filterFnTag(afterThink); // strip <function=…> inline tags from TTS
          if (!afterFn) return;
          const afterToolTail = filterToolTail(afterFn); // kill leaked <arg_value>/<tool_call> tail mid-reply
          if (!afterToolTail) return;
          const filtered = filterMarkup(afterToolTail);  // strip <emotion>/<break> markup from TTS
          if (!filtered) return;
          const afterBrackets = filterBrackets(filtered); // drop long [instruction…] leaks
          if (!afterBrackets) return;
          // Defense-in-depth: even if an adapter leaks a serialized tool envelope
          // into the token stream (instead of resolving it via onToolCall), the
          // guard withholds it from TTS so a tool call is never spoken aloud.
          const afterEnvelope = envelopeGuard.filter(afterBrackets);
          if (!afterEnvelope) return;
          pendingText += afterEnvelope;
          const { sentences, remainder } = extractSentences(pendingText, this.agent.ttsMinSentenceChars);
          for (const s of sentences) {
            const g = stepGuard.push(s);
            if (!g) continue;
            // Suppress the very first LLM sentence if a filler (backchannel or
            // dead-air) was already played this turn AND the sentence is a pure
            // acknowledgment — avoids the double-ack "சரி … சரி." pattern.
            if (!llmFirstSentenceProcessed) {
              llmFirstSentenceProcessed = true;
              if ((backchanneledThisTurn || this._fillerPlayedThisTurn) && isLlmLeadingAck(g)) {
                logger.info(
                  { callId: this.config.callId, suppressed: g, turnNumber: _currentTurnIndex, evt: "llm_leading_ack_suppressed" },
                  "Pipeline: LLM leading ack suppressed (filler already played this turn)",
                );
                continue;
              }
            }
            enqueue(g);
          }
          pendingText = remainder;
        },
        (fullText) => { llmResponse = fullText; },
        toolDefs.length > 0
          ? {
              tools: toolDefs,
              onToolDetected: (info) => {
                this.logExec("Tool", "system", {
                  status: "info",
                  turnNumber: _currentTurnIndex,
                  metadata: { event: "Tool Detected", format: info.format },
                });
              },
              onToolParsed: (info) => {
                this.logExec("Tool", "system", {
                  status: "info",
                  turnNumber: _currentTurnIndex,
                  metadata: { event: "Tool Parsed", tool: info.name, format: info.format, args: info.args },
                });
              },
              onToolCall: (name, args) => {
                triggeredToolName = name;
                triggeredToolArgs = args;
                this.logExec("Tool", "system", {
                  status: "info",
                  turnNumber: _currentTurnIndex,
                  metadata: { event: "onToolCall Invoked", tool: name, args },
                });
              },
              onUsage: (usage) => {
                this.hasRealLlmUsage = true;
                this.llmInputTokensTotal += usage.inputTokens;
                this.llmOutputTokensTotal += usage.outputTokens;
                turnInputTokens += usage.inputTokens;
                turnOutputTokens += usage.outputTokens;
                turnCachedTokens += usage.cachedTokens ?? 0;
                // Accumulate baseline estimate for savings calculation
                if (fullHistoryLen > sentHistoryLen && sentHistoryLen > 0) {
                  this.baselineInputTokensEstimate += Math.round(usage.inputTokens * fullHistoryLen / sentHistoryLen);
                } else {
                  this.baselineInputTokensEstimate += usage.inputTokens;
                }
              },
              kvCache: useKvCache,
              cacheBase: cacheBaseForTurn,
            }
          : {
              onUsage: (usage) => {
                this.hasRealLlmUsage = true;
                this.llmInputTokensTotal += usage.inputTokens;
                this.llmOutputTokensTotal += usage.outputTokens;
                turnInputTokens += usage.inputTokens;
                turnOutputTokens += usage.outputTokens;
                turnCachedTokens += usage.cachedTokens ?? 0;
                if (fullHistoryLen > sentHistoryLen && sentHistoryLen > 0) {
                  this.baselineInputTokensEstimate += Math.round(usage.inputTokens * fullHistoryLen / sentHistoryLen);
                } else {
                  this.baselineInputTokensEstimate += usage.inputTokens;
                }
              },
              kvCache: useKvCache,
              cacheBase: cacheBaseForTurn,
            }
      );
      clearTtftFallbackTimer();
      // Silent-turn guard: Sarvam models occasionally burn all effort on
      // reasoning and return completely empty text (no tokens streamed, no
      // tool call). Treat that as retryable — a quick same-provider retry
      // (~200ms) beats leaving the caller in dead air. Safe because nothing
      // was enqueued to TTS (llmFirstTokenAt === null).
      if (
        llmAttempt < MAX_LLM_ATTEMPTS &&
        llmFirstTokenAt === null &&
        !triggeredToolName &&
        llmResponse.trim() === "" &&
        pendingText.trim() === "" &&
        !this.bargeInRequested &&
        !this.closed
      ) {
        llmErr = new Error("Empty LLM response (silent turn)");
        continue;
      }
      _agnostTurn?.end(llmResponse);
      llmErr = null;
      break;
    } catch (err) {
      llmErr = err;
      clearTtftFallbackTimer();
      if (fillerTimer) { clearTimeout(fillerTimer); fillerTimer = null; }
      // Same-provider retry for transient errors, ONLY before any token has
      // streamed (llmFirstTokenAt === null) — otherwise a retry would double-speak
      // the reply. Google/OpenAI 503/429/5xx spikes are usually momentary; a quick
      // retry beats dropping the whole call. The ambient/keepalive pump keeps the
      // line alive during the (sub-second) retry window.
      if (llmAttempt < MAX_LLM_ATTEMPTS && llmFirstTokenAt === null && isRetryableLlmError(err)) {
        continue;
      }
      break;
    }
    } // end LLM attempt loop

    if (llmErr) {
      _agnostTurn?.end(String(llmErr), false);
      // P0-B: LLM fallback — if primary failed before producing any tokens, retry with fallback adapter
      if (this.fallbackLlm && llmFirstTokenAt === null) {
        logger.warn({ callId: this.config.callId, err: llmErr, fallbackProvider: this.agent.fallbackLlmProvider }, "Primary LLM failed (no tokens) — retrying with fallback LLM");
        logWarningEvent(this.logFn, EXEC_COMPONENTS.LLM, "LLM Retry", ["llm_retry"], {
          provider: this.agent.fallbackLlmProvider ?? undefined,
          retryCount: 1,
          detail: {
            event: "LLM Retry",
            fromProvider: this.agent.llmProvider,
            toProvider: this.agent.fallbackLlmProvider ?? null,
            error: toReadableError(llmErr, "LLM error"),
          },
        });
        llmResponse = "";
        pendingText  = "";
        llmFirstSentenceProcessed = false; // reset so fallback can also suppress its leading ack
        try {
          await this.fallbackLlm.chat(
            historyForLlm,
            systemPromptForTurn,
            (token) => {
              if (this.bargeInRequested) return;
              if (!llmFirstTokenAt) {
                llmFirstTokenAt = Date.now();
                this._tTurnLlmFirstToken = performance.now();
                this.onLlmFirstTokenReceived();
              }
              llmResponse += token;
              const afterThink = filterThinkToken(token);
              if (!afterThink) return;
              const afterFn = filterFnTag(afterThink);
              if (!afterFn) return;
              const afterToolTail = filterToolTail(afterFn);
              if (!afterToolTail) return;
              const filtered = filterMarkup(afterToolTail);
              if (!filtered) return;
              const afterBrackets = filterBrackets(filtered);
              if (!afterBrackets) return;
              pendingText += afterBrackets;
              const { sentences, remainder } = extractSentences(pendingText, this.agent.ttsMinSentenceChars);
              for (const s of sentences) {
                const g = stepGuard.push(s);
                if (!g) continue;
                if (!llmFirstSentenceProcessed) {
                  llmFirstSentenceProcessed = true;
                  if ((backchanneledThisTurn || this._fillerPlayedThisTurn) && isLlmLeadingAck(g)) {
                    logger.info(
                      { callId: this.config.callId, suppressed: g, turnNumber: _currentTurnIndex, evt: "llm_leading_ack_suppressed" },
                      "Pipeline: LLM leading ack suppressed on fallback path (filler already played this turn)",
                    );
                    continue;
                  }
                }
                enqueue(g);
              }
              pendingText = remainder;
            },
            (fullText) => { llmResponse = fullText; },
            { onUsage: (usage) => {
                this.hasRealLlmUsage = true;
                this.llmInputTokensTotal += usage.inputTokens;
                this.llmOutputTokensTotal += usage.outputTokens;
                turnInputTokens += usage.inputTokens;
                turnOutputTokens += usage.outputTokens;
                turnCachedTokens += usage.cachedTokens ?? 0;
              },
            },
          );
          logger.info({ callId: this.config.callId }, "Fallback LLM succeeded");
        } catch (fallbackErr) {
          const reason = toReadableError(fallbackErr, "Fallback LLM error");
          logger.error({ callId: this.config.callId, err: fallbackErr }, reason);
          this.logExec("LLM", "response", {
            provider: this.agent.fallbackLlmProvider ?? this.agent.llmProvider,
            status: "error",
            latencyMs: Date.now() - llmStart,
            turnNumber: _currentTurnIndex,
            errorMessage: reason,
            metadata: { error: reason },
          });
          this.config.onFatalError?.(reason);
          allEnqueued = true;
          finalizeTurnCtx();
          const w = wakePlayer as (() => void) | null; wakePlayer = null;
          if (w) w();
          await playPromise;
          throw fallbackErr;
        }
      } else {
        const reason = toReadableError(llmErr, "LLM error");
        logger.error({ callId: this.config.callId, err: llmErr }, reason);
        this.logExec("LLM", "response", {
          provider: this.agent.llmProvider,
          status: "error",
          latencyMs: Date.now() - llmStart,
          turnNumber: _currentTurnIndex,
          errorMessage: reason,
          metadata: { error: reason },
        });
        this.config.onFatalError?.(reason);
        allEnqueued = true;
        finalizeTurnCtx();
        const w = wakePlayer as (() => void) | null; wakePlayer = null;
        if (w) w();
        await playPromise;
        throw llmErr;
      }
    }
    // Safety net: clear filler timer if LLM completed without streaming any tokens
    // (e.g. pure tool-call response that never invokes onToken)
    if (fillerTimer) { clearTimeout(fillerTimer); fillerTimer = null; }

    // Defense-in-depth anomaly: the LLM streamed a serialized tool envelope as
    // text (it should have been resolved by the adapter's onToolCall path). The
    // guard withheld it from TTS so it was never spoken — record it for triage.
    if (envelopeGuard.suppressed()) {
      this.logExec("Tool", "system", {
        status: "info",
        turnNumber: _currentTurnIndex,
        warningFlags: ["tool_envelope_suppressed"],
        metadata: {
          event: "Tool Envelope Suppressed",
          detail: "LLM streamed a tool envelope as text; withheld from TTS",
          preview: envelopeGuard.captured().slice(0, 200),
        },
      });
    }

    // LLM response execution-log row — logged before tool handling so the
    // timeline reads LLM request → LLM response → Tool request → Tool response
    // (identical ordering to the web-call path).
    {
      const _llmLogText = stripBracketedInstructions(
        stripMarkupTags(stripFunctionTags(stripReasoningBlocks(llmResponse)))
      ).trim();
      this.logExec("LLM", "response", {
        provider: this.agent.llmProvider,
        status: "success",
        latencyMs: llmFirstTokenAt ? llmFirstTokenAt - llmStart : Date.now() - llmStart,
        turnNumber: _currentTurnIndex,
        responsePayload: { text: _llmLogText || (triggeredToolName ? `[calling tool: ${triggeredToolName}]` : "") },
        metadata: { inputTokens: turnInputTokens, outputTokens: turnOutputTokens, cachedTokens: turnCachedTokens, model: this.agent.llmModel ?? "" },
      });
    }

    // Prompt-cache visibility: log cached vs total input tokens per turn so we can
    // confirm the static system-prompt prefix is hitting the provider's prompt
    // cache turn-over-turn. After turn 1, cachedTokens should climb toward
    // turnInputTokens (OpenAI reports it via usage.prompt_tokens_details.cached_tokens);
    // providers that don't report a cache breakdown leave it at 0.
    if (this.hasRealLlmUsage && turnInputTokens > 0) {
      logger.info(
        {
          callId: this.config.callId,
          turnNumber: _currentTurnIndex,
          provider: this.agent.llmProvider,
          model: this.agent.llmModel ?? "",
          inputTokens: turnInputTokens,
          cachedTokens: turnCachedTokens,
          cacheHitRatio: Math.round((turnCachedTokens / turnInputTokens) * 100) / 100,
        },
        "LLM prompt cache",
      );
    }

    // ── If LLM called a tool, execute it and skip TTS ──
    if (triggeredToolName) {
      // Push the assistant's tool-invocation turn with proper tool_calls metadata.
      // OpenAI-compatible models (Sarvam, Groq, Mistral, DeepSeek, etc.) expect the
      // follow-up call to have a tool_calls assistant turn + a "tool" role result with
      // a matching tool_call_id. Without this they return 400 or loop on the tool call.
      const _toolCallId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const assistantTextContent = stripMarkupTags(stripFunctionTags(stripReasoningBlocks(llmResponse))).trim();
      this.conversationHistory.appendAssistant(assistantTextContent, {
        toolCalls: [{ id: _toolCallId, name: triggeredToolName, args: JSON.stringify(triggeredToolArgs) }],
      });

      // Enqueue a brief filler (language-aware) so the caller hears something while
      // the tool runs (tool calls can take 1–3 s — without this there is dead silence).
      const TOOL_FILLERS: Record<string, string> = {
        en: "One moment…", hi: "एक क्षण…", ta: "ஒரு நிமிடம்…",
        te: "ఒక్క నిమిషం…", kn: "ಒಂದು ಕ್ಷಣ…", mr: "एक क्षण…",
        gu: "એક ક્ષણ…", bn: "একটু অপেক্ষা করুন…", ml: "ഒരു നിമിഷം…",
        es: "Un momento…", fr: "Un instant…", de: "Einen Moment…", ar: "لحظة…",
      };
      const TOOL_FILLERS_BY_NAME: Record<string, Record<string, string>> = {
        native_check_availability: {
          en: "Let me check the available slots real quick…",
          ta: "இருங்க, ஃப்ரீயா இருக்குற ஸ்லாட்ஸ் செக் பண்ணி பாக்குறேன்…",
          hi: "एक मिनट, मैं स्लॉट्स चेक करके बताता हूँ…",
          te: "ఒక్క నిమిషం, అవైలబుల్ స్లాట్స్ చెక్ చేస్తున్నాను…",
          kn: "ಲಭ್ಯವಿರುವ ಸಮಯವನ್ನು ಪರಿಶೀಲಿಸುತ್ತಿದ್ದೇನೆ…",
        },
        native_booking: {
          en: "Great, booking that in for you right now…",
          ta: "சரிங்க, உங்க அப்பாயிண்ட்மென்ட் புக் பண்ணிடுறேன்…",
          hi: "बस आपका अपॉइंटमेंट बुक कर रहा हूँ…",
          te: "సరేనండి, మీ అపాయింట్‌మెంట్ బుక్ చేస్తున్నాను…",
          kn: "ನಿಮ್ಮ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಬುಕ್ ಮಾಡುತ್ತಿದ್ದೇನೆ…",
        },
        native_reschedule: {
          en: "Got it, updating your appointment time now…",
          ta: "ஒரு நிமிஷம், டைம் மாத்தி புக் பண்ணிடுறேன்…",
          hi: "एक मिनट, अपॉइंटमेंट की टाइमिंग चेंज कर देता हूँ…",
          te: "మీ అపాయింట్‌మెంట్‌ను రీషెడ్యూల్ చేస్తున్నాను…",
        },
        native_cancel: {
          en: "Sure thing, cancelling that booking for you…",
          ta: "சரிங்க, அந்த அப்பாயிண்ட்மென்ட் கேன்சல் பண்ணிடுறேன்…",
          hi: "जी, वो अपॉइंटमेंट कैंसिल कर देता हूँ…",
          te: "మీ అపాయింట్‌మెంట్‌ను రద్దు చేస్తున్నాను…",
        },
        native_list_bookings: {
          en: "Let me pull up your upcoming bookings real quick…",
          ta: "ஒரு நிமிஷம், உங்க புக் பண்ணுன ஸ்லாட்ஸ் பாக்குறேன்…",
          hi: "एक मिनट, आपकी बुकिंग्स चेक कर लेता हूँ…",
        },
      };

      const toolAliasMap: Record<string, string> = {
        book_appointment: "native_booking",
        check_availability: "native_check_availability",
        reschedule_booking: "native_reschedule",
        cancel_booking: "native_cancel",
        list_bookings: "native_list_bookings",
      };
      const canonicalName = toolAliasMap[triggeredToolName] ?? triggeredToolName;
      const langPrefix = ((this.currentLang || this.agent.language) ?? "en").split("-")[0] ?? "en";
      const toolSpecific = TOOL_FILLERS_BY_NAME[triggeredToolName] ?? TOOL_FILLERS_BY_NAME[canonicalName];
      const filler = triggeredToolName === "end_call"
        ? undefined
        : (toolSpecific?.[langPrefix] ?? TOOL_FILLERS[langPrefix]);
      if (filler && !this.closed && !this.bargeInRequested) {
        logger.info(
          {
            callId: this.config.callId,
            fillerType: "tool",
            language: langPrefix,
            selectedFiller: filler,
            ttsText: filler,
          },
          "Tool filler enqueued (language-aware)",
        );
        enqueue(filler, FILLER_SEQUENCE_ID);
      } else if (!filler) {
        logger.info(
          { callId: this.config.callId, fillerType: "tool", language: langPrefix },
          "Tool filler skipped — no filler set for language",
        );
      }
      allEnqueued = true;
      finalizeTurnCtx();
      const finalWake = wakePlayer as (() => void) | null;
      wakePlayer = null;
      if (finalWake) finalWake();
      await playPromise; // plays filler (and any earlier backchannel) before continuing
      const toolResult = await this.handleToolCall(triggeredToolName, triggeredToolArgs);
      if (toolResult !== undefined) {
        await this.continueWithToolResult(triggeredToolName, toolResult, 0, _toolCallId);
      }
      return;
    }

    // Strip think blocks and inline function tags from the stored response so
    // they don't appear in the transcript UI or pollute conversation history.
    // Computed BEFORE the final flush so the spoken tail and the stored history
    // are derived from the exact same fully-cleaned text.
    const cleanResponse = stripJsonMessageWrapper(stripToolArtifacts(stripBracketedInstructions(stripMarkupTags(stripFunctionTags(stripReasoningBlocks(llmResponse))))).trim());
    const baseSpokenResponse = stepGuard.truncated() ? truncateToSingleStep(cleanResponse).text : cleanResponse;

    // Final flush: the LLM token stream occasionally ends a few words early while
    // llmResponse (set by the onComplete callback) holds the complete text. Re-run
    // extractSentences on the full clean reply and prefer its remainder over the
    // possibly-truncated pendingText buffer. Enqueue any non-empty trailing text —
    // a length gate would silently drop very short final fragments (e.g. "Ok").
    //
    // Universal final-flush: resolve the correct pending text using cleanResponse
    // (the authoritative full reply set by onComplete) as source of truth.
    //
    // Three cases where pendingText is wrong at stream end:
    // Case A — trueRemainder is longer (non-sentence-boundary tail, normal case).
    // Case B — Gemini held back final token(s): pendingText is a truncated PREFIX
    //   of the last sentence (e.g. "பார்க்க" vs "பார்க்கலாமா?"). remainder="" because
    //   "?" was a sentence boundary, full sentence captured in allSentences.
    // Case C — 60-char comma-split fired mid-sentence: pendingText is a mid-sentence
    //   FRAGMENT (e.g. "எது பார்க்குற" after split emitted "நீங்க...வில்லா"). Not a
    //   prefix of allSentences[-1], but IS a substring of it — emit the suffix.
    const { sentences: allSentences, remainder: trueRemainder } = extractSentences(cleanResponse, this.agent.ttsMinSentenceChars);
    const pendingTrim = pendingText.trim();
    let flushText: string;
    if (trueRemainder.trim().length > pendingTrim.length) {
      // Case A
      flushText = trueRemainder;
    } else if (pendingTrim) {
      const lastSentence = (allSentences.at(-1) ?? "").trim();
      if (lastSentence.startsWith(pendingTrim) && lastSentence.length > pendingTrim.length) {
        // Case B: pendingText is a prefix of the last sentence
        flushText = lastSentence;
      } else {
        // Case C: search all sentences for one containing pendingTrim as a substring;
        // emit the tail of that sentence from pendingTrim onward (recovers the truncated suffix).
        let found = "";
        for (const s of allSentences) {
          const idx = s.indexOf(pendingTrim);
          if (idx !== -1 && s.length > idx + pendingTrim.length) {
            found = s.slice(idx);
            break;
          }
        }
        flushText = found || pendingText;
      }
    } else {
      flushText = pendingText;
    }
    {
      const g = stepGuard.push(flushText);
      if (g.trim()) {
        enqueue(g);
      } else if (flushText.trim() && stepGuard.truncated()) {
        // Micro-clauses during streaming exhausted the sentence cap — still speak
        // the unsent tail so the caller does not hear a prefix then silence.
        enqueue(flushText.trim());
      }
    }
    allEnqueued = true;
    finalizeTurnCtx();
    const finalWake = wakePlayer as (() => void) | null;
    wakePlayer = null;
    if (finalWake) finalWake();

    logger.info(
      { callId: this.config.callId, response: llmResponse.slice(0, 80), sentences: sentenceQueue.length },
      "LLM complete"
    );

    await playPromise;

    // Bolna parity: store only what the caller actually heard (defer until playback ends).
    const heardOnly = this.getHeardAgentText();
    const spokenResponse = resolveSpokenForHistory({
      barged: this.bargeInRequested,
      heardOnly,
      fullResponse: baseSpokenResponse,
    });
    this.captureBargedRemainder(spokenResponse, baseSpokenResponse);
    if (spokenResponse) {
      this.conversationHistory.appendAssistant(spokenResponse);
      this.trackRepeat(spokenResponse);
      this.config.onTranscript("agent", spokenResponse);
      this.config.onConversationUpdate?.(this.conversationHistory.messages);
    }

    // ── Bolna-parity: per-turn speak metrics ──────────────────────────────
    this._agentSpeakCharsThisTurn = spokenResponse.length;
    this._agentSpeakCharsTotal += spokenResponse.length;
    if (spokenResponse.length > this._longestAgentMonologueChars) {
      this._longestAgentMonologueChars = spokenResponse.length;
    }
    if (this._lastTurnWasBargedIn) {
      this._bargeInRecoveryCount++;
      this._lastTurnWasBargedIn = false;
    }
    this.logExec("Agent", "system", {
      status: "info",
      turnNumber: _currentTurnIndex,
      metadata: {
        event: "Turn Metrics",
        turnCloseReason: this._turnCloseReason,
        eagerLlmHit: this._eagerLlmHitThisTurn,
        bargeInFiredTotal: this._bargeInFiredCount,
        bargeInRecoveryTotal: this._bargeInRecoveryCount,
        bargeInRecoveryRate: this._bargeInFiredCount > 0
          ? Math.round((this._bargeInRecoveryCount / this._bargeInFiredCount) * 100) / 100
          : null,
        agentSpeakCharsThisTurn: this._agentSpeakCharsThisTurn,
        agentSpeakCharsTotal: this._agentSpeakCharsTotal,
        callerSpeakCharsTotal: this._callerSpeakCharsTotal,
        talkListenRatio: this._callerSpeakCharsTotal > 0
          ? Math.round((this._agentSpeakCharsTotal / this._callerSpeakCharsTotal) * 100) / 100
          : null,
        longestAgentMonologueChars: this._longestAgentMonologueChars,
      },
    });

    // ── Token Optimization: Stage detection ───────────────────────────────
    if (tokenOptEnabled && this.agent.stagedPromptEnabled && this.agent.stagedPromptStages.length > 0) {
      const stageTagMatch = /\[STAGE:([^\]]+)\]/i.exec(llmResponse);
      if (stageTagMatch) {
        const stageName = stageTagMatch[1]!.trim();
        const stageIdx = this.agent.stagedPromptStages.findIndex(
          (s) => s.name.toLowerCase() === stageName.toLowerCase()
        );
        if (stageIdx >= 0 && stageIdx !== this.currentStageIndex) {
          this.currentStageIndex = stageIdx;
          logger.info({ callId: this.config.callId, stageName, stageIdx }, "Staged prompt: transitioned to new stage");
        }
      }
    }

    // ── Token Optimization: Layer 3 — Summarization (async, non-blocking) ─
    // Runs automatically in the background to keep mid-call token cost down.
    // No longer gated by a user-visible toggle — uses the default threshold (20 turns).
    if (tokenOptEnabled) {
      const threshold = this.agent.tokenSummarizationThresholdTurns ?? 20;
      const histLen = this.conversationHistory.messages.length;
      if (histLen >= threshold) {
        const keepTurns = this.agent.contextWindowTurns ?? Math.ceil(threshold / 2);
        const replaceCount = Math.max(0, histLen - keepTurns);
        if (replaceCount >= 2) {
          const turnsToSummarize = this.conversationHistory.messages.slice(0, replaceCount);
          void this.summarizeOldTurns(turnsToSummarize, replaceCount);
        }
      }
    }

    // ── End-call phrase detection (agent-side) ──
    // The agent finished speaking this turn; if it naturally used a configured
    // End-Call Phrase in its own response, hang up now that playback + tail
    // drain have completed (the final words are already out uncut).
    if (this.agentSaidEndCallPhrase(spokenResponse)) {
      logger.info({ callId: this.config.callId, response: spokenResponse.slice(0, 80) }, "Agent used end-call phrase — hanging up after playback");
      this.config.onCallEnd();
      return;
    }

    // ── Inline function-tag execution (safety net for LLMs that emit <function=X> as text) ──
    // The streaming filter already prevented these tags from reaching TTS.
    // Now execute the first tag found so end_call / scheduling tools still fire.
    {
      const inlineFn = extractInlineFunctionTag(llmResponse);
      if (inlineFn) {
        logger.info({ callId: this.config.callId, fnName: inlineFn.name }, "Inline function tag detected — executing after response");
        const toolResult = await this.handleToolCall(inlineFn.name, inlineFn.args);
        if (toolResult !== undefined) {
          await this.continueWithToolResult(inlineFn.name, toolResult);
        }
        return;
      }
    }

    const llmLatencyMs = llmFirstTokenAt ? llmFirstTokenAt - llmStart : Date.now() - llmStart;
    const ttsFirstChunkMs = this.firstAudioSentAt ? this.firstAudioSentAt - llmStart : 0;
    // Streaming STT invokes processTurn() with sttLatencyMs=0 (there is no
    // batch roundtrip to time); the perceived STT cost there is VAD-flush →
    // final transcript. Hoisted out of the log block so onMetrics reports the
    // same number — before this, call-end avgSttMs was 0 for every
    // streaming-STT call (see call 4814: avgSttMs:0 despite 74-253ms finals).
    const _stt_ms = this._tTurnSttFinal > 0 && this._tTurnVadFlush > 0
      ? Math.round(this._tTurnSttFinal - this._tTurnVadFlush) : Math.round(sttLatencyMs);
    {
      const _tEnd = performance.now();
      const _llm_ttft_ms = this._tTurnLlmFirstToken !== null && this._tTurnSttFinal > 0
        ? Math.round(this._tTurnLlmFirstToken - this._tTurnSttFinal) : null;
      const _llm_ttft_to_clause_ms = this._tTurnLlmFirstClause !== null && this._tTurnLlmFirstToken !== null
        ? Math.round(this._tTurnLlmFirstClause - this._tTurnLlmFirstToken) : null;
      const _tts_ttfb_ms = this._tTurnTtsFirstByte !== null && this._tTurnSttFinal > 0
        ? Math.round(this._tTurnTtsFirstByte - this._tTurnSttFinal) : null;
      const _return_ms = this._tTurnFirstAudioOut !== null && this._tTurnSttFinal > 0
        ? Math.round(this._tTurnFirstAudioOut - this._tTurnSttFinal) : null;
      const _total_ms = this._tTurnVadFlush > 0 ? Math.round(_tEnd - this._tTurnVadFlush) : null;
      logger.info({
        evt:                   "turn_latency",
        path:                  "pipeline",
        callId:                this.config.callId,
        turnIndex:             _currentTurnIndex,
        stt_ms:                _stt_ms,
        llm_ttft_ms:           _llm_ttft_ms,
        llm_ttft_to_clause_ms: _llm_ttft_to_clause_ms,
        tts_ttfb_ms:           _tts_ttfb_ms,
        return_ms:             _return_ms,
        total_ms:              _total_ms,
        endpoint_ms:           _thisEndpointMs,
        endpoint_reason:       _thisEndpointReason,
        asrProvider:           this.agent.asrProvider,
        llmProvider:           this.agent.llmProvider,
        ttsProvider:           this.agent.ttsProvider,
        fillerPlayed:          this._fillerPlayedThisTurn,
        turn_close_reason:     this._turnCloseReason,
      }, "turn_latency");
    }
    this.config.onMetrics?.({ sttLatencyMs: _stt_ms, llmLatencyMs, ttsFirstChunkMs });

    // ── Hangup after LLM call ───────────────────────────────────────────────
    if (this.agent.hangupAfterLlmCall && !this.closed) {
      logger.info({ callId: this.config.callId }, "hangupAfterLlmCall — ending call");
      // Drain the carrier playout buffer so the final response isn't clipped by
      // teardown — the playTask above resolved as soon as the last chunk was
      // handed off, but the jitter buffer still holds a few hundred ms.
      await this.drainPlaybackTail();
      this.config.onCallEnd();
    }
  }

  private async flushAndProcess(): Promise<void> {
    if (this.isProcessing || this.audioBuffer.length === 0) return;

    const pcmChunks = this.audioBuffer.splice(0);
    const native16kChunks = this.audioBufferNative16k.splice(0);
    const pcm8k = Buffer.concat(pcmChunks);
    if (pcm8k.length < MIN_SPEECH_BYTES) return;

    this.isProcessing = true;

    try {
      // Send native 8kHz telephony audio directly when the adapter is configured
      // for it (Sarvam) instead of the linear-interpolation upsample to 16k —
      // avoids manufacturing samples on already-lossy phone audio (see sttSampleRate).
      const useNative8k = this.sttSampleRate === 8000;
      // Prefer the TRUE 16k mic audio queued alongside pcm8k (webcall) over
      // upsample8to16(pcm8k), which is just interpolation of an already
      // 4kHz-Nyquist-limited signal and cannot recover the fricative energy
      // ("v"/"z"/"s") that distinguishes words like "VoBiz" from "Bobby".
      // Falls back to the interpolated version for telephony, which never has
      // a native 16k source.
      const hasNative16k = !useNative8k && native16kChunks.length === pcmChunks.length;
      const sttAudio = useNative8k
        ? pcm8k
        : hasNative16k
          ? Buffer.concat(native16kChunks)
          : upsample8to16(pcm8k);
      logger.info({ callId: this.config.callId, bytes: sttAudio.length, sampleRate: this.sttSampleRate }, "Sending to STT");

      this._tTurnVadFlush = performance.now();
      const sttStart = Date.now();
      let transcript: string | null | undefined;
      try {
        transcript = await this.stt.transcribe(sttAudio, this.sttSampleRate);
      } catch (sttErr) {
        const reason = toReadableError(sttErr, "STT error");
        logger.error({ callId: this.config.callId, err: sttErr }, reason);
        this.config.onFatalError?.(reason);
        if (!this.closed) this.safetyNet.beginListening();
        return;
      }
      this._tTurnSttFinal = performance.now();
      const sttLatencyMs = Date.now() - sttStart;

      if (!transcript?.trim()) {
        // No usable transcript — do NOT clear the stall backstop; let it fire so
        // the caller is reprompted rather than left in a silent "Listening…" hang.
        logger.info({ callId: this.config.callId }, "Empty STT transcript, skipping");
        return;
      }

      this.safetyNet.onFinal();          // real (batch) final — clear safety timers
      this._turnCloseReason = "stt_final";
      this.clearEagerPartialTimer();
      this.interruptionMgr.onUserSpeechEnd();
      await this.processTurn(transcript, sttLatencyMs);

    } catch (err) {
      logger.error({ callId: this.config.callId, err }, "Pipeline error");
      if (!this.closed) this.safetyNet.beginListening();
    } finally {
      this.isProcessing = false;
      if (!this.speakingSpeakerHandoffChallenge) {
        this.skipAgentPlaybackForHandoff = false;
      }
      if (this.audioBuffer.length > 0) void this.flushAndProcess();
      else if (!this.closed) this.safetyNet.beginListening();
    }
  }

  getHistory(): ConversationTurn[] {
    return this.conversationHistory.messages;
  }

  /** Returns the BCP-47 language code the pipeline ended on this call. */
  getCurrentLang(): string {
    return this.currentLang;
  }

  /** Returns the best language to remember as this caller's preference.
   *  = last non-English language they spoke (so an English "thanks, bye"
   *  doesn't wipe out their Tamil/Hindi preference), falling back to
   *  currentLang only when the caller spoke nothing but English all call. */
  getPreferredCallerLang(): string {
    return this.lastNonEnglishLang || this.currentLang;
  }

  /** Related people learned on this call (for durable family_members fact). */


  /** BCP-47 code of the language the caller EXPLICITLY requested mid-call
   *  ("Speak in Tamil"), for persisting back to caller memory at call end so
   *  the next call greets them in the newly requested language. Only exposed
   *  for multilingual (languageAutoDetect) agents — the strict-mode English
   *  escape latch is a this-call-only override and must NOT leak into memory
   *  (it would flip the next call's STT language for a fixed-language agent). */
  getExplicitLangRequestForMemory(): string | null {
    return this.agent.languageAutoDetect ? this.requestedLangLatch : null;
  }

  /**
   * Live-switch the streaming STT session's language hint after an explicit
   * caller language request latches. Without this the stream stays on its
   * call-start language and mistranscribes the caller's new language into the
   * old script, dragging the agent back (call 1881). No-ops when the adapter
   * doesn't support live switching (Deepgram/Azure keep current behavior) or
   * when already on the requested language (reconnect-loop guard).
   */
  private switchStreamSTTLanguage(lang: string): void {
    const stream = this.streamSTT;
    if (!stream?.setLanguage) return;
    if (this.streamSTTLang === lang) return;
    try {
      stream.setLanguage(lang);
      this.streamSTTLang = lang;
      logger.info(
        { callId: this.config.callId, lang },
        "Streaming STT language switched",
      );
    } catch (err) {
      logger.warn(
        { callId: this.config.callId, lang, err },
        "Streaming STT language switch failed — keeping current stream",
      );
    }
  }

  /**
   * Keep Cartesia/Sarvam TTS language tags aligned with currentLang. Without
   * this, auto-detect updates STT+LLM while TTS keeps speaking Tamil text with
   * language:null or the call-start English tag (call 4845).
   */
  private syncTtsLanguage(lang: string): void {
    if (!lang) return;
    if (!this.tts.setLanguage) return;
    if (this.ttsLang === lang) return;
    try {
      this.tts.setLanguage(lang);
      this.ttsLang = lang;
      logger.info(
        { callId: this.config.callId, lang, provider: this.agent.ttsProvider },
        "TTS language switched",
      );
    } catch (err) {
      logger.warn(
        { callId: this.config.callId, lang, err },
        "TTS language switch failed — keeping current TTS language",
      );
    }
  }

  /**
   * Passive or explicit streaming-STT language switch with consecutive-detection
   * guard (2 finals) unless `immediate` (explicit caller language request).
   */
  private maybeSwitchStreamingSttLang(targetLang: string, immediate = false): void {
    // DO NOT reconnect or switch STT WebSocket while agent is speaking or during echo grace.
    // Acoustic echo from the speaker during greeting/reply can trigger false LID and destroy the STT connection.
    const isSpeaking =
      Date.now() < this.bargeInSentenceStartAt + this.bargeInEchoGraceMs ||
      Date.now() < this.greetingEchoHoldUntil ||
      Date.now() < this.bargeInHoldUntil;
    if (isSpeaking) return;

    const { shouldSwitch, gate } = shouldSwitchSttLang(
      { pendingLang: this._pendingSttSwitchLang, pendingCount: this._pendingSttSwitchCount },
      targetLang,
      this.streamSTTLang,
      immediate,
    );
    this._pendingSttSwitchLang = gate.pendingLang;
    this._pendingSttSwitchCount = gate.pendingCount;
    if (shouldSwitch) this.switchStreamSTTLanguage(targetLang);
  }

  /**
   * Returns exact usage totals accumulated during this session.
   * - ttsCharacters: always exact (counted per text.length before each synthesis call)
   * - llmInputTokens / llmOutputTokens: present only when the active LLM adapter
   *   returned real token counts; undefined when the provider doesn't expose them
   *   (e.g. Sarvam), allowing session.ts to fall back to turn-count heuristics.
   * - tokensSaved: estimated input tokens saved by context optimization this call.
   */
  getUsageTotals(): { llmInputTokens?: number; llmOutputTokens?: number; ttsCharacters: number; fillerPlayedCount: number; tokensSaved: number } {
    const tokensSaved = this.hasRealLlmUsage
      ? Math.max(0, this.baselineInputTokensEstimate - this.llmInputTokensTotal)
      : 0;
    return {
      llmInputTokens: this.hasRealLlmUsage ? this.llmInputTokensTotal : undefined,
      llmOutputTokens: this.hasRealLlmUsage ? this.llmOutputTokensTotal : undefined,
      ttsCharacters: this.ttsCharactersTotal,
      fillerPlayedCount: this.fillerPlayedCount,
      tokensSaved,
    };
  }

  /** Layer 3: Summarize old conversation turns and compress them into a single block. */
  private async summarizeOldTurns(turns: ConversationTurn[], replaceCount: number): Promise<void> {
    // Same tool-plumbing exclusions as getTranscript() — don't feed raw tool
    // results or empty placeholder turns to the summarizer as if they were
    // spoken lines.
    const transcript = turns
      .filter((t) => t.role !== "tool" && !(t.role === "user" && t.content.startsWith("[Tool result for")) && t.content.trim() !== "")
      .map((t) => `${t.role === "user" ? "Caller" : "Agent"}: ${t.content}`)
      .join("\n");
    let summary = "";
    try {
      await this.llm.chat(
        [{ role: "user", content: `Summarize the following conversation excerpt in 2–3 sentences, preserving key facts, decisions, and context:\n\n${transcript}` }],
        "You are a concise conversation summarizer. Output only the summary, no preamble.",
        (token) => { summary += token; },
        () => {},
        {
          onUsage: (usage) => {
            this.llmInputTokensTotal += usage.inputTokens;
            this.llmOutputTokensTotal += usage.outputTokens;
            this.baselineInputTokensEstimate += usage.inputTokens;
          },
        }
      );
      if (summary.trim()) {
        this.conversationHistory.replaceRangeWithSummary(replaceCount, {
          role: "assistant",
          content: `[CONVERSATION SUMMARY] ${summary.trim()}`,
        });
        logger.info(
          { callId: this.config.callId, summarizedTurns: replaceCount, historyNow: this.conversationHistory.messages.length },
          "Token summarization: old turns compressed"
        );
      }
    } catch (err) {
      logger.warn({ callId: this.config.callId, err }, "Token summarization failed — continuing without compression");
    }
  }

  getTranscript(): string {
    return this.conversationHistory.messages
      // Internal tool plumbing must never surface as a spoken turn in the
      // human-readable transcript:
      //  - role "tool": the raw structured tool-result string fed back to the
      //    LLM (e.g. "Callback recorded for ...") — only the LLM's natural
      //    follow-up reply (the NEXT assistant turn) should appear as "Agent:".
      //  - role "user" with the "[Tool result for ...]" prefix: same thing for
      //    the inline-function-tag path, which piggybacks on the user role.
      //  - empty-content assistant turns: the placeholder turn recorded when
      //    the LLM's entire reply was a tool call (no text alongside it).
      .filter((t) => t.role !== "tool" && !(t.role === "user" && t.content.startsWith("[Tool result for")) && t.content.trim() !== "")
      .map((t) => `${t.role === "user" ? "Caller" : "Agent"}: ${t.content}`)
      .join("\n");
  }

  /** P2-A: Execute a native booking and return a structured result string for LLM consumption. */
  private async executeNativeBooking(tool: AgentTool & { type: "native_booking" }, args: Record<string, unknown>): Promise<string> {
    // ── Minimum engagement guard ─────────────────────────────────────────────
    // Require at least 2 genuine user turns before a booking can be made.
    // A genuine user turn is a role:"user" message that is NOT a tool-result
    // injection (those start with "[Tool result for"). This blocks Pattern A:
    // LLM chains check_availability×N → book_appointment after a single "Hello".
    const genuineUserTurns = this.conversationHistory.messages.filter(
      (m) => m.role === "user" && !m.content.startsWith("[Tool result for"),
    ).length;
    if (genuineUserTurns < 2) {
      logger.warn(
        { callId: this.config.callId, genuineUserTurns },
        "Native booking blocked: fewer than 2 genuine user turns",
      );
      this.logExec("Booking", "system", {
        status: "error",
        turnNumber: this._activeTurnIndex,
        metadata: {
          event: "Booking Blocked",
          reason: "insufficient_user_turns",
          genuineUserTurns,
          attendeeName: String(args["attendee_name"] ?? args["name"] ?? ""),
          attendeeEmail: String(args["attendee_email"] ?? args["email"] ?? ""),
        },
      });
      return "error: cannot book yet — you must first ask the caller for their name, email, and preferred slot. Do not call this tool until the caller has provided those details in the conversation.";
    }
    return sharedExecuteNativeBooking(this.config.callId, this.agent.id, tool, args);
  }

  private async executeNativeReschedule(tool: AgentTool & { type: "native_reschedule" }, args: Record<string, unknown>): Promise<string> {
    logger.info({
      callId: this.config.callId,
      selected_booking_id: this.activeRescheduleBooking?.bookingId ?? null,
      selected_booking_date: this.activeRescheduleBooking?.isoDate ?? null,
      selected_booking_time: this.activeRescheduleBooking?.timeLabel ?? null,
      resolved_requested_datetime: args["preferred_date"] ?? args["new_time"] ?? null,
    }, "Pipeline: executeNativeReschedule invoked");
    return sharedExecuteNativeReschedule(this.config.callId, this.agent.id, tool, args);
  }

  private async executeNativeCancel(tool: AgentTool & { type: "native_cancel" }, args: Record<string, unknown>): Promise<string> {
    return sharedExecuteNativeCancel(this.config.callId, this.agent.id, tool, args);
  }

  private async executeNativeCheckAvailability(tool: AgentTool & { type: "native_check_availability" }, args: Record<string, unknown>): Promise<string> {
    logger.info({
      callId: this.config.callId,
      selected_booking_id: this.activeRescheduleBooking?.bookingId ?? null,
      selected_booking_date: this.activeRescheduleBooking?.isoDate ?? null,
      selected_booking_time: this.activeRescheduleBooking?.timeLabel ?? null,
      resolved_requested_datetime: args["preferred_date"] ?? null,
    }, "Pipeline: executeNativeCheckAvailability invoked");
    return sharedExecuteNativeCheckAvailability(this.config.callId, this.agent.id, tool, args);
  }

  private async executeNativeListBookings(tool: AgentTool & { type: "native_list_bookings" }, args: Record<string, unknown>): Promise<string> {
    return sharedExecuteNativeListBookings(this.config.callId, this.agent.id, tool, args);
  }

  /**
   * After a native scheduling tool executes, push its structured result to
   * conversation history and run a follow-up LLM turn so the agent responds
   * naturally to the caller based on the outcome.
   *
   * Uses the same sentence-queue streaming pattern as processTurn so the first
   * TTS chunk starts as soon as the LLM emits the first sentence boundary —
   * not after the full response is buffered.
   */
  private async continueWithToolResult(
    toolName: string,
    result: string,
    depth: number = 0,
    toolCallId?: string,
    chainState: { bookApptFired: boolean; toolCounts?: Record<string, number> } = { bookApptFired: false },
  ): Promise<void> {
    if (toolCallId) {
      // Native tool call: use proper "tool" role with matching tool_call_id so
      // OpenAI-compatible APIs (Sarvam, Groq, Mistral, etc.) accept the follow-up call.
      this.conversationHistory.appendToolResult(result, toolCallId, toolName);
    } else {
      // Inline function tag (text-based): no tool_call_id — use user message format
      // which the instruction-following model already understands from its system prompt.
      this.conversationHistory.appendUser(`[Tool result for ${toolName}]: ${result}`);
    }
    // Track whether a booking tool has already fired in this agentic chain so the
    // duplicate-booking guard below can block Pattern B (bulk slot booking).
    const bookApptFired = chainState.bookApptFired || this.agent.tools.some(
      (t) => t.type === "native_booking" && sanitizeToolName(t.name) === toolName,
    );
    // Stable key for the tool that just completed — used to seed toolCounts so
    // the result of the CURRENT call is already counted before the next call fires.
    const completedKey = toolName + ":" + JSON.stringify(
      Object.fromEntries(Object.entries(
        (() => { try { return JSON.parse(
          this.conversationHistory.messages.at(-1)?.toolCalls?.[0]?.args ?? "{}",
        ) as Record<string, unknown>; } catch { return {}; } })(),
      ).sort()),
    );
    const toolCounts: Record<string, number> = { ...chainState.toolCounts };
    toolCounts[completedKey] = (toolCounts[completedKey] ?? 0) + 1;

    let llmResponse = "";
    let pendingText = "";
    // One-step output guard (same as the main turn path) — truncate at the first
    // natural yield point if the post-tool reply runs through multiple steps.
    const stepGuard = makeFlowStepGuard({ maxSentences: VOICE_MAX_SENTENCES_PER_TURN });
    let allEnqueued = false;

    // Keep tools attached on follow-up turns so the agent can chain calls in a
    // single user turn (e.g. check_availability → book_appointment → end_call).
    // A depth cap forces a final tools-detached narration to prevent runaway loops.
    const MAX_TOOL_DEPTH = 5;
    const toolDefs = buildToolDefs(this.agent.tools);
    toolDefs.push(SCHEDULE_CALLBACK_TOOL_DEF);
    const attachTools = depth < MAX_TOOL_DEPTH && toolDefs.length > 0;
    let triggeredToolName: string | null = null;
    let triggeredToolArgs: Record<string, unknown> = {};

    const filterThinkToken = makeThinkFilter();
    const filterFnTag = makeFunctionTagFilter();
    const filterToolTail = makeToolTailFilter();
    const filterMarkup = makeMarkupTagFilter();
    const filterBrackets = makeBracketFilter();
    // Defense-in-depth tool-envelope guard (same as the main turn) — withholds a
    // leaked serialized tool envelope from TTS on chained tool turns too.
    const envelopeGuard = makeToolEnvelopeGuard(toolNamesOf(toolDefs));

    // Cartesia turn-level continuations (mirrors processTurn logic).
    const ctCartesiaTts = this.tts instanceof CartesiaTTS ? this.tts : null;
    const ctTurnContextId = ctCartesiaTts ? globalThis.crypto.randomUUID() : undefined;
    const ctFinalizeTurnCtx = (): void => {
      if (ctTurnContextId && ctCartesiaTts) ctCartesiaTts.finalizeTurnContext(ctTurnContextId);
    };

    // See processTurn's sentenceQueue for why synthesis starts at enqueue
    // time (sentence-prefetch pipelining), not when playTask reaches the job.
    const sentenceQueue: TtsSentenceJob[] = [];
    let wakePlayer: (() => void) | null = null;

    const enqueue = (text: string, sequenceId: number = this.activeAgentSequenceId): void => {
      if (this.bargeInRequested) return;
      // Extract any leading <emotion value="…"/> tag so the clean sentence goes
      // to TTS while the emotion array is forwarded to Cartesia's voice controls.
      const { emotion, text: cleanText } = extractEmotionTag(text);
      const emotions = emotion ? mapEmotionToCartesia(emotion) : undefined;
      if (emotion && emotions) {
        logger.info(
          { callId: this.config.callId, evt: "emotion_applied", emotion, emotions, textSnippet: cleanText.slice(0, 80) },
          "Emotion tag forwarded to TTS",
        );
      }
      sentenceQueue.push(this.startSentenceSynthesis(cleanText, this._activeTurnIndex, sequenceId, ctTurnContextId, emotions));
      if (wakePlayer) { const w = wakePlayer; wakePlayer = null; w(); }
    };

    const playTask = async (): Promise<void> => {
      let idx = 0;
      while (true) {
        if (idx < sentenceQueue.length) {
          const job = sentenceQueue[idx++]!;
          this.bargeInHoldUntil = Date.now() + this.bargeInEchoGraceMs;
          this.isPlaying = true;
          try { await this.playJob(job); } catch (err) {
            const reason = toReadableError(err, "TTS error");
            logger.error({ callId: this.config.callId, err, text: job.text.slice(0, 40) }, `continueWithToolResult ${reason}`);
            this.reportTtsFailure(reason, { where: "tool_followup_sentence", text: job.text.slice(0, 40) });
          }
          if (this.bargeInRequested) break;
          // Max-duration graceful stop (see main playTask): finish the current
          // sentence, then break before the next one; the drain below preserves it.
          if (this.endAfterCurrentSentence) break;
        } else if (allEnqueued) {
          break;
        } else {
          await new Promise<void>((r) => { wakePlayer = r; });
        }
      }
      this.isPlaying = false;
      this.armTailEchoGrace();
      // Drain the carrier's jitter buffer before the turn returns to listening.
      // playSentence's drain loop resolves as soon as the last chunk is handed
      // off, but the carrier still holds ~100-300ms — without this wait the final
      // word of a NORMAL turn is clipped as the turn ends (previously only the
      // goodbye/terminal/transfer paths drained). drainPlaybackTail is a no-op on
      // barge-in (the user is already speaking, so we must stop immediately) and
      // when closed. Mirrors the web path's per-turn tail-silence drain.
      await this.drainPlaybackTail();
    };

    const playPromise = playTask();

    this.interruptionMgr.pruneStaleSequences();
    this.activeAgentSequenceId = this.interruptionMgr.beginAgentTurn();

    // Build a system prompt with {caller_salutation} substituted, same as processTurn.
    const _ctDetectedGender = this.genderDetector?.gender ?? null;
    const _ctRawSal = _ctDetectedGender === "male" ? this.agent.genderDetectionMaleSalutation
      : _ctDetectedGender === "female" ? this.agent.genderDetectionFemaleSalutation
      : (this.agent.genderDetectionNeutralSalutation ?? "");
    const _ctResolvedSal = (_ctRawSal === "(skip)" || !_ctRawSal) ? "" : _ctRawSal;
    let toolSystemPrompt = this.agent.systemPrompt;
    if (_ctResolvedSal) {
      toolSystemPrompt = toolSystemPrompt
        .replace(/\{\{caller_salutation\}\}/g, _ctResolvedSal)
        .replace(/\{caller_salutation\}/g, _ctResolvedSal);
    } else {
      toolSystemPrompt = toolSystemPrompt
        .replace(/\s*\{\{caller_salutation\}\}\s*/g, " ")
        .replace(/\s*\{caller_salutation\}\s*/g, " ");
    }

    // Tool-call preamble suppression (same guard as processTurn — chained calls must
    // also not emit "I'll check" text before the next tool call in the chain).
    if (attachTools) {
      toolSystemPrompt += [
        "",
        "",
        "[TOOL CALLING — MANDATORY]",
        "When the caller's request requires a tool call, call the tool IMMEDIATELY — do NOT emit any text before the tool call.",
        "Never say 'I'll check', 'Let me look up', 'One moment', 'Please wait' or any similar preamble — those phrases prevent the tool from running in the same turn.",
        "The system automatically plays a brief wait tone to the caller while the tool runs; you do not need to announce it.",
        "If you are missing a required parameter, ask for it in a single short question — do not say you will look it up first.",
      ].join("\n");
    }

    // Inject active reschedule context (same as processTurn) so the LLM keeps the
    // correct date when chaining tool calls within a single user turn.
    const _ctHasSchedulingNav = this.agent.tools.some(
      (t) => t.type === "native_cancel" || t.type === "native_reschedule" || t.type === "native_list_bookings",
    );
    if (_ctHasSchedulingNav && this.activeRescheduleBooking) {
      const { bookingId, isoDate, timeLabel, eventName } = this.activeRescheduleBooking;
      toolSystemPrompt += [
        "",
        "",
        "[ACTIVE RESCHEDULE CONTEXT]",
        `Currently rescheduling booking #${bookingId} (${eventName}: ${timeLabel}).`,
        `When the caller proposes only a new time (e.g. "Can we do 12:30?"), you MUST default preferred_date to "${isoDate}" unless they explicitly state a different date.`,
        `Always pass preferred_date as a full ISO datetime (e.g. "${isoDate}T12:30:00+05:30") — never omit the date portion.`,
      ].join("\n");
    }

    try {
      await this.llm.chat(
        this.conversationHistory.messages,
        toolSystemPrompt,
        (token) => {
          if (this.bargeInRequested) return;
          llmResponse += token;
          const afterThink = filterThinkToken(token);
          if (!afterThink) return;
          const afterFn = filterFnTag(afterThink);
          if (!afterFn) return;
          const afterToolTail = filterToolTail(afterFn);
          if (!afterToolTail) return;
          const filtered = filterMarkup(afterToolTail);
          if (!filtered) return;
          const afterBrackets = filterBrackets(filtered);
          if (!afterBrackets) return;
          const afterEnvelope = envelopeGuard.filter(afterBrackets);
          if (!afterEnvelope) return;
          pendingText += afterEnvelope;
          const { sentences, remainder } = extractSentences(pendingText, this.agent.ttsMinSentenceChars);
          for (const s of sentences) { const g = stepGuard.push(s); if (g) enqueue(g); }
          pendingText = remainder;
        },
        (fullText) => { llmResponse = fullText; },
        attachTools
          ? {
              tools: toolDefs,
              onToolDetected: (info) => {
                this.logExec("Tool", "system", {
                  status: "info",
                  turnNumber: this._activeTurnIndex,
                  metadata: { event: "Tool Detected", format: info.format },
                });
              },
              onToolParsed: (info) => {
                this.logExec("Tool", "system", {
                  status: "info",
                  turnNumber: this._activeTurnIndex,
                  metadata: { event: "Tool Parsed", tool: info.name, format: info.format, args: info.args },
                });
              },
              onToolCall: (name, args) => {
                triggeredToolName = name;
                triggeredToolArgs = args;
                this.logExec("Tool", "system", {
                  status: "info",
                  turnNumber: this._activeTurnIndex,
                  metadata: { event: "onToolCall Invoked", tool: name, args },
                });
              },
              onUsage: (usage) => {
                this.hasRealLlmUsage = true;
                this.llmInputTokensTotal += usage.inputTokens;
                this.llmOutputTokensTotal += usage.outputTokens;
              },
            }
          : {
              onUsage: (usage) => {
                this.hasRealLlmUsage = true;
                this.llmInputTokensTotal += usage.inputTokens;
                this.llmOutputTokensTotal += usage.outputTokens;
              },
            },
      );
    } catch (err) {
      logger.error({ callId: this.config.callId, err }, "continueWithToolResult LLM call failed");
      allEnqueued = true;
      ctFinalizeTurnCtx();
      const wErr = wakePlayer as (() => void) | null; wakePlayer = null; if (wErr) wErr();
      await playPromise;
      return;
    }

    // Compute the fully-cleaned response BEFORE the final flush so the spoken
    // tail and the stored history are derived from the exact same text.
    const cleanResponse = stripJsonMessageWrapper(stripToolArtifacts(stripBracketedInstructions(stripMarkupTags(stripFunctionTags(stripReasoningBlocks(llmResponse))))).trim());

    // Final flush: prefer the fullReply-derived remainder over the possibly-
    // truncated pendingText, and enqueue any non-empty trailing text — a length
    // gate would silently drop very short final fragments.
    // Universal final-flush (mirrors processTurn logic — see Case A/B/C comment there).
    const { sentences: allSentences, remainder: trueRemainder } = extractSentences(cleanResponse, this.agent.ttsMinSentenceChars);
    const pendingTrim = pendingText.trim();
    let flushText: string;
    if (trueRemainder.trim().length > pendingTrim.length) {
      flushText = trueRemainder;
    } else if (pendingTrim) {
      const lastSentence = (allSentences.at(-1) ?? "").trim();
      if (lastSentence.startsWith(pendingTrim) && lastSentence.length > pendingTrim.length) {
        flushText = lastSentence;
      } else {
        let found = "";
        for (const s of allSentences) {
          const idx = s.indexOf(pendingTrim);
          if (idx !== -1 && s.length > idx + pendingTrim.length) {
            found = s.slice(idx);
            break;
          }
        }
        flushText = found || pendingText;
      }
    } else {
      flushText = pendingText;
    }
    {
      const g = stepGuard.push(flushText);
      if (g.trim()) {
        enqueue(g);
      } else if (flushText.trim() && stepGuard.truncated()) {
        enqueue(flushText.trim());
      }
    }
    allEnqueued = true;
    ctFinalizeTurnCtx();
    const wFinal = wakePlayer as (() => void) | null; wakePlayer = null; if (wFinal) wFinal();
    await playPromise;

    // ── Chained tool call — the agent invoked another tool off the result ──
    if (triggeredToolName) {
      const chainedName: string = triggeredToolName;
      const chainedCallId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      // ── Same-tool-same-args loop guard ────────────────────────────────────
      // Prevent the LLM from calling the same tool with identical arguments more
      // than twice in a single agentic chain (a common pattern with Groq/llama
      // where check_availability fires 5-6 times in a row for no reason, causing
      // 8-10 seconds of silence after "One moment").
      const chainedArgKey = chainedName + ":" + JSON.stringify(
        Object.fromEntries(Object.entries(triggeredToolArgs).sort()),
      );
      const priorCalls = toolCounts[chainedArgKey] ?? 0;
      if (priorCalls >= 2) {
        logger.warn(
          { callId: this.config.callId, depth, chainedName, priorCalls },
          "Tool loop guard: same tool+args called too many times in chain — breaking loop",
        );
        const loopError = `error: ${chainedName} was already called ${priorCalls} time(s) with these same arguments — you already have the data, speak your response to the caller now without calling the tool again`;
        this.conversationHistory.appendAssistant(cleanResponse || "", {
          toolCalls: [{ id: chainedCallId, name: chainedName, args: JSON.stringify(triggeredToolArgs) }],
        });
        await this.continueWithToolResult(
          chainedName,
          loopError,
          depth + 1,
          chainedCallId,
          { bookApptFired, toolCounts },
        );
        return;
      }

      // ── One-booking-per-chain guard (Pattern B: bulk slot booking) ─────────
      // If book_appointment already fired in this agentic chain, block the second
      // call immediately so the LLM must present the first booking confirmation to
      // the caller and wait for a response before booking again.
      const isChainedBooking = this.agent.tools.some(
        (t) => t.type === "native_booking" && sanitizeToolName(t.name) === chainedName,
      );
      if (isChainedBooking && bookApptFired) {
        logger.warn(
          { callId: this.config.callId, depth, chainedName },
          "Chained booking blocked: book_appointment already called in this agentic chain",
        );
        this.logExec("Booking", "system", {
          status: "error",
          turnNumber: this._activeTurnIndex,
          metadata: {
            event: "Booking Blocked",
            reason: "duplicate_in_chain",
            chainedTool: chainedName,
            depth,
            args: triggeredToolArgs,
          },
        });
        // Push the error as a tool result so the LLM sees it and speaks the
        // first booking's confirmation to the caller rather than booking again.
        const dupError = "error: a booking was already made in this turn — speak the confirmation to the caller and wait for their response before booking again";
        this.conversationHistory.appendAssistant(cleanResponse || "", {
          toolCalls: [{ id: chainedCallId, name: chainedName, args: JSON.stringify(triggeredToolArgs) }],
        });
        await this.continueWithToolResult(
          chainedName,
          dupError,
          depth + 1,
          chainedCallId,
          { bookApptFired: true, toolCounts },
        );
        return;
      }

      this.conversationHistory.appendAssistant(cleanResponse || "", {
        toolCalls: [{ id: chainedCallId, name: chainedName, args: JSON.stringify(triggeredToolArgs) }],
      });
      const chainedResult = await this.handleToolCall(chainedName, triggeredToolArgs);
      if (chainedResult !== undefined) {
        await this.continueWithToolResult(
          chainedName,
          chainedResult,
          depth + 1,
          chainedCallId,
          { bookApptFired: bookApptFired || isChainedBooking, toolCounts },
        );
      }
      return;
    }

    if (cleanResponse) {
      const baseSpokenResponse = stepGuard.truncated() ? truncateToSingleStep(cleanResponse).text : cleanResponse;
      const heardOnly = this.getHeardAgentText();
      const spokenResponse = resolveSpokenForHistory({
        barged: this.bargeInRequested,
        heardOnly,
        fullResponse: baseSpokenResponse,
      });
      this.captureBargedRemainder(spokenResponse, baseSpokenResponse);
      if (spokenResponse) {
        this.conversationHistory.appendAssistant(spokenResponse);
        this.trackRepeat(spokenResponse);
        this.config.onTranscript("agent", spokenResponse);
        this.config.onConversationUpdate?.(this.conversationHistory.messages);

        // ── End-call phrase detection (agent-side) ──
        // Same behavior as the normal turn: if the agent naturally used a
        // configured End-Call Phrase in its post-tool-result response, hang up now
        // that playback + tail drain (await playPromise, above) have completed.
        if (this.agentSaidEndCallPhrase(spokenResponse)) {
          logger.info({ callId: this.config.callId, response: spokenResponse.slice(0, 80) }, "Agent used end-call phrase after tool result — hanging up after playback");
          this.config.onCallEnd();
          return;
        }
      }
    }

    // ── Inline function-tag execution (safety net for LLMs that emit <function=X> as text) ──
    // If no native tool was triggered but the LLM included an inline function tag,
    // execute it now (the tag was already stripped from the spoken text above).
    const inlineFn = extractInlineFunctionTag(llmResponse);
    if (inlineFn) {
      logger.info({ callId: this.config.callId, fnName: inlineFn.name }, "Inline function tag detected in continueWithToolResult — executing");
      const toolResult = await this.handleToolCall(inlineFn.name, inlineFn.args);
      if (toolResult !== undefined) {
        await this.continueWithToolResult(inlineFn.name, toolResult, depth + 1, undefined, { bookApptFired, toolCounts });
      }
    }
  }

  /**
   * Plays the IVR greeting, collects one DTMF digit (or times out), and handles
   * the routing decision.
   *
   * Returns `true` if the call was transferred to another agent (caller has been
   * routed away and the current pipeline should stop), or `false` to continue
   * with the normal agent greeting.
   */
  private async runIvr(): Promise<boolean> {
    const options = this.agent.ivrOptions ?? [];
    const ivrGreeting = this.agent.ivrGreeting!;

    this.dtmfDetector = new DtmfDetector();
    this.dtmfDetector.reset();

    logger.info({ callId: this.config.callId, options: options.length }, "IVR: playing menu");
    this.bargeInHoldUntil = Date.now() + this.bargeInEchoGraceMs;
    this.isPlaying = true;
    try { await this.playSentence(ivrGreeting); }
    finally { this.isPlaying = false; this.armTailEchoGrace(); }

    if (this.closed) { this.dtmfDetector = null; return false; }

    // Wait up to 10 seconds for a keypress
    const digit = await new Promise<string | null>((resolve) => {
      this.dtmfResolver = resolve;
      this.dtmfTimeoutId = setTimeout(() => {
        this.dtmfResolver = null;
        this.dtmfTimeoutId = null;
        resolve(null);
      }, 10_000);
    });

    this.dtmfDetector = null;

    if (digit === null) {
      logger.info({ callId: this.config.callId }, "IVR: no digit received — falling through to agent");
      return false;
    }

    const opt = options.find(o => o.digit === digit);
    logger.info({ callId: this.config.callId, digit, label: opt?.label ?? "(unknown)" }, "IVR digit received");

    if (opt?.targetAgentId !== undefined) {
      // Only treat the IVR selection as a real transfer if the handoff actually
      // succeeded. A false/unsupported result must NOT return true (which would stop
      // the pipeline and leave the caller in dead air) — fall through to the AI instead.
      const ok = (await this.config.onCallTransfer?.(`agent:${opt.targetAgentId}`)) ?? false;
      if (ok) {
        logger.info({ callId: this.config.callId, targetAgentId: opt.targetAgentId }, "IVR: call transferred to agent");
        return true;
      }
      logger.warn({ callId: this.config.callId, targetAgentId: opt.targetAgentId }, "IVR: agent transfer failed/unsupported — continuing with AI");
    }

    // No transfer — append the selection to the system prompt so the LLM knows
    // which menu option the caller chose, then continue with normal greeting.
    if (opt) {
      this.agent.systemPrompt += `\n\n[IVR selection] The caller pressed ${digit}: "${opt.label}".`;
    }
    return false;
  }

  async speakRaw(text: string): Promise<void> {
    if (!text.trim() || this.closed) return;
    await this.playSentence(text);
    // speakRaw is used for terminal utterances (goodbye / end-call line) that are
    // immediately followed by onCallEnd(); drain the carrier's playout buffer so
    // the final words aren't clipped by teardown.
    await this.drainPlaybackTail();
  }

  // ── Meeting speaker identification (services/meet-roster.ts) ──────────────
  /** True when this session is a meeting bot (Recall) rather than a 1:1 call. */
  private isMeetingMode = false;

  /** Marks this session as a group-meeting participant (disables 1:1-call
   *  heuristics like the caller-farewell auto-hangup). */
  markMeetingMode(): void {
    this.isMeetingMode = true;
  }

  /** Persistent participant-list context line (null clears it). */
  setMeetingRoster(line: string | null): void {
    this.meetingRosterLine = line ? line.slice(0, 2000) : null;
    // Exec-logged so prod call logs prove exactly what participant list the
    // LLM was given on this call (hallucinated-name triage).
    logWarningEvent(this.logFn, EXEC_COMPONENTS.Agent, "Meeting Roster Updated", [], {
      turnNumber: this._activeTurnIndex,
      detail: { roster: this.meetingRosterLine ?? "(cleared)" },
    });
  }

  /** Name of the participant currently/last speaking (tags next user turn). */
  setMeetingSpeaker(name: string | null): void {
    this.meetingSpeakerName = name ? name.slice(0, 60) : null;
    logWarningEvent(this.logFn, EXEC_COMPONENTS.Agent, "Meeting Speaker Changed", [], {
      turnNumber: this._activeTurnIndex,
      detail: { speaker: this.meetingSpeakerName ?? "(cleared)" },
    });
  }

  /** One-shot join/leave note delivered in the next turn's volatile tail. */
  injectMeetingNote(note: string): void {
    const n = note.trim().slice(0, 200);
    if (!n || this.pendingMeetingNotes.length >= 10) return;
    this.pendingMeetingNotes.push(n);
  }

  /**
   * True when the agent's own spoken text for a turn contains any configured
   * End-Call Phrase (case-insensitive substring match). Used to hang up AFTER
   * the agent naturally works one of these phrases into its closing sentence —
   * the phrases describe "things the agent says when it's done", not caller
   * commands. The check must run after the turn's playback has fully drained so
   * the agent's final words are never clipped.
   */
  private agentSaidEndCallPhrase(spokenText: string): boolean {
    if (!spokenText || this.agent.endCallPhrases.length === 0) return false;
    const lower = spokenText.toLowerCase();
    return this.agent.endCallPhrases.some(p => {
      const phrase = p.trim().toLowerCase();
      return phrase.length > 0 && lower.includes(phrase);
    });
  }

  /**
   * Returns true when the caller's utterance is a pure farewell — short enough
   * that it cannot be anything else, and containing at least one unambiguous
   * farewell keyword.  Used by the processTurn() farewell short-circuit.
   *
   * Conservative by design: "Thank you for the information" does NOT match
   * (extra content words), "Thank you" DOES match.  This prevents ending the
   * call on a mid-conversation polite acknowledgment.
   */
  private isCallerFarewellUtterance(transcript: string): boolean {
    return isCallerFarewellUtteranceShared(transcript);
  }

  /**
   * Wait for the carrier to play out the final streamed audio before teardown.
   * playSentence's drain loop sends mulaw in real time, so when it resolves the
   * last chunk has only just been handed off — the carrier's jitter buffer still
   * holds a few hundred ms.  Calling onCallEnd() immediately would drop it and
   * clip the final words (especially the goodbye on hangup).  Mirrors the web
   * path's AUDIO_TAIL_SILENCE_MS tail drain.
   */
  private async drainPlaybackTail(): Promise<void> {
    if (this.closed || this.bargeInRequested) return;
    // Send real silence frames during the drain window.  A passive sleep alone
    // is not sufficient for Vobiz: when audio stops arriving, Vobiz can close
    // its internal playout window and clip the last words before we even call
    // onCallEnd().  Sending 20 ms silence frames at real-time rate keeps
    // Vobiz's playout buffer ticking until the window is fully drained.
    // For Twilio / Plivo (mulaw) the same frames extend their jitter buffer.
    const FRAME_MS      = 20;
    const FRAME_BYTES   = this.config.rawPcmOutput
      ? FRAME_MS * (this.pcmOutRate() / 1000) * 2   // 320 B @8k / 640 B @16k (16-bit PCM)
      : FRAME_MS * 8;      // 20 ms × 8000 Hz × 1 byte   = 160 B (µ-law)
    const silenceFrame  = Buffer.alloc(FRAME_BYTES, 0);
    const frames        = Math.ceil(
      (this.agent.telephonyTailDrainMs ?? TELEPHONY_TAIL_DRAIN_MS_DEFAULT) / FRAME_MS,
    );
    let nextTick        = Date.now() + FRAME_MS;
    for (let i = 0; i < frames && !this.closed && !this.bargeInRequested; i++) {
      // When ambient is enabled, carry the ambient bed through the drain window
      // instead of pure digital silence. The ambient silence-fill interval is
      // paused while isPlaying is true (it is still true here, set false only
      // after this returns), so without this the channel emits ~800 ms of pure
      // zero frames after every utterance. A run of digital-silence frames is
      // exactly what a mobile carrier's VAD/DTX reads as an inactive channel:
      // it engages comfort-noise / silence-suppression, which then gates the
      // low-level ambient bed when it resumes — making it inaudible on a real
      // phone while the loud agent voice always passes. Keeping ambient flowing
      // continuously (no pure-silence gaps) keeps the channel "active" so DTX
      // never engages. The frame size and real-time cadence are unchanged, so
      // the drain still keeps Vobiz/Twilio/Plivo playout buffers ticking. When
      // ambient is disabled this is byte-for-byte the original zero frame.
      let frame: Buffer = silenceFrame;
      if (this.ambientStream) {
        frame = this.config.rawPcmOutput
          ? (this.pcmOutRate() === 16000
              ? upsample8to16(this.ambientStream.nextPcmChunk())
              : this.ambientStream.nextPcmChunk())
          : this.ambientStream.nextMulawChunk();
      }
      this.config.onAudioOut(frame);
      const delay = Math.max(0, nextTick - Date.now());
      nextTick += FRAME_MS;
      await new Promise<void>((r) => setTimeout(r, delay));
    }
  }

  /**
   * Re-arm the echo-grace window after playback ends so the agent's own trailing
   * audio (sidetone/echo) returning via STT cannot trigger a barge-in or a
   * spurious new turn that would clip the final words.  Mirrors the web path's
   * end grace (BARGE_IN_END_GRACE_MS).
   */
  private armTailEchoGrace(): void {
    this.bargeInHoldUntil = Date.now() + this.bargeInEchoGraceMs;
    // Keep the VoBiz/ambient audio bridge warm the instant we enter Listening —
    // a multi-hundred-ms dead zone after TTS can look like End Of XML (4010)
    // and surface in the UI as "Caller hung up" even though the phone stayed up.
    this.lastTtsFrameAt = Date.now();
  }

  /**
   * Guardrail route classification using fast word-overlap (Jaccard similarity).
   *
   * For each configured route, we tokenize the caller transcript and each
   * example utterance, compute |intersection| / |union| and compare against
   * the route's scoreThreshold.  The first route whose threshold is met wins
   * and its canned `response` text is returned.  Returns null when no route
   * matches, meaning the turn falls through to the normal LLM pipeline.
   *
   * Why Jaccard over embeddings?
   *  – Zero latency: no API call needed — runs in microseconds
   *  – No extra API keys required
   *  – Sufficient for intent matching when the admin has provided representative
   *    example utterances (typically 3-10 per route)
   */
  private checkGuardrailRoutes(transcript: string): string | null {
    const routes = this.agent.guardrailRoutes;
    if (!routes || routes.length === 0) return null;

    const transcriptTokens = guardrailTokenize(transcript);
    if (transcriptTokens.size === 0) return null;

    for (const route of routes) {
      const threshold = route.scoreThreshold ?? 0.35;
      const lines = route.utterances
        .split(/[\n,]/)
        .map(s => s.trim())
        .filter(Boolean);

      for (const utterance of lines) {
        const uttTokens = guardrailTokenize(utterance);
        if (uttTokens.size === 0) continue;

        let intersection = 0;
        for (const t of transcriptTokens) {
          if (uttTokens.has(t)) intersection++;
        }
        const union = transcriptTokens.size + uttTokens.size - intersection;
        const score = intersection / union;

        if (score >= threshold) {
          logger.info(
            { callId: this.config.callId, route: route.name, score: score.toFixed(3), utterance },
            "Guardrail route matched"
          );
          return route.response;
        }
      }
    }
    return null;
  }

  close(): void {
    this.closed = true;
    // Persist the refined full-call voiceprint (fire-and-forget; DB/HTTP only).
    void this.speakerVerifier?.finalize();
    this.tts.close?.();
    if (this.ambientInterval) {
      clearInterval(this.ambientInterval);
      this.ambientInterval = null;
    }
    // Unblock any pending IVR digit wait so the promise settles immediately
    if (this.dtmfTimeoutId) {
      clearTimeout(this.dtmfTimeoutId);
      this.dtmfTimeoutId = null;
    }
    if (this.dtmfResolver) {
      const r = this.dtmfResolver;
      this.dtmfResolver = null;
      r(null);
    }
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    this.silenceWatchdog?.clear();
    if (this.streamSTTReconnectTimer) {
      clearTimeout(this.streamSTTReconnectTimer);
      this.streamSTTReconnectTimer = null;
    }
    this.safetyNet?.clear();
    this.clearFragmentCoalesce();
    this.clearEagerPartialTimer();
    if (this._specLlmState) {
      this._specLlmState.aborted = true;
      this._specLlmState = null;
    }
    this.llm.cancelInFlight?.();
    for (const ac of this.activeTtsAborts) {
      try { ac.abort(); } catch { /* noop */ }
    }
    this.activeTtsAborts.clear();
    this.streamSTT?.close();
    this.streamSTT = null;
    logger.info({ callId: this.config.callId }, "Pipeline closed");
  }
}

// ── Sentence segmentation ─────────────────────────────────────────────────────

// parsePreferredDate is now in services/tool-executor.ts and imported above.

/**
 * Tokenize text for guardrail Jaccard scoring.
 * Lowercases, strips punctuation, removes common stop-words, returns a Set.
 */
const GUARDRAIL_STOPWORDS = new Set([
  "a","an","the","is","are","was","were","be","been","being","have","has","had",
  "do","does","did","will","would","could","should","may","might","shall","can",
  "i","you","he","she","it","we","they","me","him","her","us","them",
  "my","your","his","its","our","their","this","that","these","those",
  "and","but","or","nor","for","so","yet","to","of","in","on","at","by",
  "up","out","off","over","into","with","about","after","before","from","not",
]);

function guardrailTokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 1 && !GUARDRAIL_STOPWORDS.has(w))
  );
}

/**
 * Factory that returns a stateful streaming think-block filter.
 * Strips <think>…</think> blocks emitted by reasoning models (DeepSeek-R1 etc.)
 * from the token stream before text reaches TTS.  Returns a per-turn closure so
 * each turn (and continueWithToolResult) has independent state.
 */
/**
 * Strips `<function=NAME ...>...</function>` (and self-closing/dangling variants) from text.
 * Used for post-processing the full LLM response before storing in history / transcript.
 */
function stripFunctionTags(text: string): string {
  return text
    .replace(/<function=\w+[^>]*>[\s\S]*?<\/function>/g, "")
    .replace(/<function=\w+[^>]*\/>/g, "")
    .replace(/<function=\w+[^>]*>/g, "")
    .trim();
}

/**
 * Whole-string counterpart to makeToolTailFilter for the final-flush / history
 * text. Removes well-formed tool blocks and any DANGLING tool tag (and its JSON
 * tail) the model emitted as text — e.g. a lone `<arg_value>{ … }` with no close
 * (prod call 1022) — so a leaked tool call is never spoken on the final flush or
 * stored in the transcript. Everything from the first dangling tool marker to
 * end-of-string is dropped (conversational text effectively never follows a
 * serialized tool call).
 */
function stripToolArtifacts(text: string): string {
  return text
    .replace(/<function\b[^>]*>[\s\S]*?<\/function>/gi, "")
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "")
    .replace(/<arg_key>[\s\S]*?<\/arg_key>/gi, "")
    .replace(/<arg_value>[\s\S]*?<\/arg_value>/gi, "")
    .replace(/<\/?(?:function|arg_key|arg_value|tool_call|tools)\b[\s\S]*$/i, "")
    .replace(/<\|(?:tool|python_tag)[\s\S]*$/i, "")
    .replace(/[^\S\r\n]{2,}/g, " ")
    .trim();
}

/**
 * Per-language spec for explicit language-request detection. `mention` matches
 * the language's NAME (romanised + native scripts). `roman` lists the romanised
 * names used to build the "in <lang>" / "<lang> me|la" and negation windows.
 */
interface LangRequestSpec {
  code: string;
  mention: RegExp;
  roman: string[];
  /** Precompiled: "in/into/to <lang>" or "<lang> me|mein|la|il|alli…" (romanised). */
  inLang: RegExp;
  /** Precompiled: romanised/English negation windows around the language name. */
  negation: RegExp[];
}

function buildLangRequestSpec(code: string, mention: RegExp, roman: string[]): LangRequestSpec {
  const alt = roman.join("|");
  return {
    code,
    mention,
    roman,
    inLang: new RegExp(
      `\\b(in|into|to)\\s+(${alt})\\b|\\b(${alt})\\s*(me|mein|mai|main|men|la|le|lo|il|alli|nalli)\\b`,
    ),
    negation: [
      new RegExp(`\\b(no|not|don'?t|do not|dont|never|stop)\\b[^.!?]{0,20}\\b(${alt})\\b`),
      new RegExp(`\\b(${alt})\\b[^.!?]{0,15}\\b(nahi|nahin|mat|naa|na|venda|vendam|veno|beda|nako|illa|illai)\\b`),
    ],
  };
}

/** All languages the multilingual toggle supports for explicit switch requests. */
const LANG_REQUEST_SPECS: LangRequestSpec[] = [
  buildLangRequestSpec("en-IN", /\b(english|inglish)\b|\bangre[jz]i\b|अंग्रेज़ी|अंग्रेजी|ஆங்கில|இங்கிலீ?ஷ்?|இங்கிலிஷ்?|இங்கில|ఇంగ్లీష|ইংরেজি|انگریزی/iu, ["english", "inglish", "angrezi", "angreji"]),
  buildLangRequestSpec("hi-IN", /\bhindi\b|हिन्दी|हिंदी|ஹிந்தி|இந்தி|ہندی/iu, ["hindi"]),
  buildLangRequestSpec("ta-IN", /\b(tamil|thamizh|tamizh)\b|தமிழ|तमिल|తమిళ/iu, ["tamil", "thamizh", "tamizh"]),
  buildLangRequestSpec("te-IN", /\btelugu\b|తెలుగు|तेलुगु|தெலுங்கு/iu, ["telugu"]),
  buildLangRequestSpec("kn-IN", /\bkannada\b|ಕನ್ನಡ|कन्नड़|कन्नड|கன்னட/iu, ["kannada"]),
  buildLangRequestSpec("ml-IN", /\bmalayalam\b|മലയാള|मलयालम|மலையாள/iu, ["malayalam"]),
  buildLangRequestSpec("mr-IN", /\bmarathi\b|मराठी|மராத்தி/iu, ["marathi"]),
  buildLangRequestSpec("bn-IN", /\b(bengali|bangla)\b|বাংলা|बांग्ला|बंगाली/iu, ["bengali", "bangla"]),
  buildLangRequestSpec("gu-IN", /\b(gujarati|gujrati)\b|ગુજરાતી|गुजराती/iu, ["gujarati", "gujrati"]),
  buildLangRequestSpec("pa-IN", /\b(punjabi|panjabi)\b|ਪੰਜਾਬੀ|पंजाबी|پنجابی/iu, ["punjabi", "panjabi"]),
  buildLangRequestSpec("or-IN", /\b(odia|oriya)\b|ଓଡ଼ିଆ|ଓଡିଆ|ओड़िया|उड़िया/iu, ["odia", "oriya"]),
  buildLangRequestSpec("ur-IN", /\burdu\b|اردو|उर्दू|உருது/iu, ["urdu"]),
];

/** Native-script negators checked in the ~18 chars right after a native-script
 *  language mention ("தமிழ் வேண்டாம்", "हिंदी नहीं"). */
const NATIVE_NEGATORS = /வேண்டாம்|வேணாம்|மாட்|नहीं|मत|না|নয়|ਨਹੀਂ|نہیں|ಬೇಡ|వద్దు|വേണ്ട|નહીં/u;

/**
 * Detect an explicit caller request to switch the agent's SPOKEN language.
 * Returns a BCP-47 code ("ta-IN", "en-IN", …) or null. Covers the full
 * multilingual set (en/hi/ta/te/kn/ml/mr/bn/gu/pa/or/ur) in romanised and
 * native scripts. Deliberately conservative — a real request/switch cue must
 * be present, so a bare mention ("English teacher", "do you support Hindi?",
 * "I don't know English") never latches. Simple negation ("don't speak
 * English", "English mat bolo", "தமிழ் வேண்டாம்") is stripped; on a true
 * Hindi/English two-language tie Hindi wins as the safer base-language
 * fallback (existing semantics); any other multi-language mention is
 * ambiguous and never latches.
 */
function detectExplicitLanguageRequest(rawText: string): string | null {
  // "Tamil Nadu" is a place, not a language request ("I live in Tamil Nadu"
  // must never latch Tamil). Scrub the state name before any matching.
  const text = rawText.replace(/tamil\s*nadu/gi, "TN").replace(/தமிழ்\s*நாடு|தமிழ்நாட்|तमिलनाडु/gu, "TN");
  const t = text.toLowerCase();

  const mentioned = LANG_REQUEST_SPECS.filter((s) => s.mention.test(text));
  if (mentioned.length === 0) return null;

  // Require an actual request/switch cue so a BARE mention never latches.
  // Cues: a request/switch verb (English, romanised Hindi/Tamil/Telugu/Kannada/
  // Malayalam, or native-script), "in/to <lang>", or "<lang> me/mein/la/il…".
  const hasRequestVerb =
    /\b(speak|speaking|talk|talking|say|reply|respond|answer|continue|switch|change|use|prefer|please)\b/.test(t) ||
    /\bcan\s+you\b/.test(t) ||
    /\b(pesu|pesunga|pesanum|pannunga|pannalam|matladu|maatladu|matladandi|helu|heli|parayu|samsarikku|bolna|bola)\b/.test(t) ||
    /\b(bol|bolo|boliye|baat|baatein|kar|karo|karein|kijiye|kije|chahiye|chaiye)\b/.test(t) ||
    /स्पीक|स्पिक|टॉक|பேச|பேசு|சொல்லு|बोल|बात|कीजिए|करो|करें|चाहिए|మాట్లాడ|ಮಾತನಾಡ|പറയ|സംസാരിക്ക|বল|বলুন|કહો|બોલ|ਬੋਲ|بولیں|بات/u.test(text);
  const hasInLang =
    mentioned.some((s) => s.inLang.test(t)) ||
    // Native-script locatives: "<lang>में/इन" (Devanagari), "தமிழில்/தமிழ்ல", "…த்தில்/யில்" etc.
    /(अंग्रेज़ी|अंग्रेजी|हिन्दी|हिंदी|तमिल|तेलुगु|कन्नड़|कन्नड|मलयालम|मराठी|बांग्ला|बंगाली|गुजराती|पंजाबी|उड़िया|ओड़िया|उर्दू)\s*(में|मे|इन|इन्)/u.test(text) ||
    /(स्पीक|स्पिक|टॉक|बोल|बोलो)\s*(इन|इन्|में|मे)\s*(अंग्रेज़ी|अंग्रेजी|हिन्दी|हिंदी|तमिल|तेलुगु|कन्नड़|कन्नड|मलयालम)/u.test(text) ||
    /தமிழ(ில்|்ல|ுல)|ஆங்கிலத்தில்|ஹிந்தியில்|இந்தியில்|தெலுங்கில்|கன்னடத்தில்|மலையாளத்தில்|উর্দু|ਵਿੱਚ/u.test(text);
  if (!hasRequestVerb && !hasInLang) {
    // ── Bare-imperative fast-path ──────────────────────────────────────────
    // Indian conversational speech drops the request verb: "Ma'am Tamil" means
    // "Ma'am, speak Tamil". If the ENTIRE non-address content of a SHORT (≤5
    // word) utterance is exactly one language name and there is no negation
    // present, treat it as an explicit language request.
    //
    // Safeguards:
    //   • negation words ("no", "not", "nahi", "illa") veto this path
    //   • more than one content word → not a bare imperative → fall through
    //   • the sole content word must literally match the language spec's own
    //     mention regex (prevents accidental matches from a nearby native-
    //     script language glyph in an otherwise unrelated utterance)
    //
    // Examples that DO latch:   "Ma'am Tamil"  "sir Hindi"  "Tamil please"
    // Examples that do NOT latch: "Do you support Tamil?" (3 content words)
    //                             "I don't know Tamil" (negated)
    //                             "Tamil teacher" (2 content words)
    const isNegatedBare = /\b(no|not|dont|don'?t|never|nahi|nahin|illa|illai|vendam|venda|mat)\b/.test(t);
    if (!isNegatedBare && mentioned.length === 1) {
      const ADDR_TERMS = new Set([
        "maam", "madam", "sir", "please", "hi", "hello", "ok", "okay",
        "uh", "um", "hmm", "hm", "bhai", "didi", "anna", "akka", "hey",
        "yeah", "yea", "yes", "can", "you",
      ]);
      const allWords = t.split(/\s+/).filter((w) => /[a-z]/.test(w));
      const contentWords = allWords.filter((w) => !ADDR_TERMS.has(w.replace(/[^a-z]/g, "")));
      if (allWords.length <= 5 && contentWords.length === 1) {
        const soleWord = contentWords[0]!;
        const spec = mentioned[0]!;
        // Confirm the sole content word itself matches the language's mention pattern.
        if (spec.mention.test(soleWord)) {
          return spec.code;
        }
      }
    }
    return null;
  }

  // Negation guard per language: "don't speak English" / "English mat bolo" /
  // "தமிழ் வேண்டாம்" must not latch that language (but leaves any OTHER
  // positively-requested language free to latch: "Hindi nahi, Tamil me bolo").
  const wanted = mentioned.filter((s) => {
    if (s.negation.some((re) => re.test(t))) return false;
    // Native-script negator shortly after the (native or romanised) mention.
    const m = s.mention.exec(text);
    if (m) {
      const tail = text.slice(m.index + m[0].length, m.index + m[0].length + 18);
      if (NATIVE_NEGATORS.test(tail)) return false;
    }
    return true;
  });

  // Exactly one positively requested → latch it.
  if (wanted.length === 1) return wanted[0].code;
  // Hindi wins a true Hindi/English tie (it's the safer base-language fallback);
  // any other multi-language combination is ambiguous — never latch.
  if (wanted.length === 2) {
    const codes = new Set(wanted.map((w) => w.code));
    if (codes.has("hi-IN") && codes.has("en-IN")) return "hi-IN";
  }
  return null;
}

/**
 * Strips inline prosody/markup tags the LLM sometimes emits — `<emotion …>`,
 * `</emotion>`, and self-closing `<break …/>` — while KEEPING the speakable
 * text between them. Without this they reach TTS verbatim and get XML-escaped
 * (Azure) or spoken literally (Cartesia/ElevenLabs/Deepgram), mangling audio
 * and corrupting sentence splitting. Whole-string variant of makeMarkupTagFilter.
 * Used for transcript/history cleanup only — the streaming filter deliberately
 * passes <emotion …/> through so extractEmotionTag can read it at enqueue time.
 */
function stripMarkupTags(text: string): string {
  return text
    .replace(/<\/?emotion[^>]*>/gi, "")
    .replace(/<break[^>]*\/?>/gi, "")
    .replace(/[^\S\r\n]{2,}/g, " ")
    .trim();
}

/**
 * Extracts the first `<emotion value="…"/>` tag from the very beginning of a
 * sentence (leading whitespace is ignored). Returns the matched emotion value
 * (lowercased) and the sentence text with the tag stripped and leading space
 * trimmed. When no tag is present both fields reflect the original text.
 */
function extractEmotionTag(text: string): { emotion: string | null; text: string } {
  const match = /^\s*<emotion\s+(?:value|type)="([^"]+)"\s*\/?>/i.exec(text);
  const emotion = match ? match[1]!.toLowerCase() : null;
  const cleanText = text.replace(/<\/?emotion[^>]*>/gi, "").replace(/<break[^>]*\/?>/gi, "").trim();
  return { emotion, text: cleanText };
}

/**
 * Maps a VoiceOrch LLM emotion value to Cartesia's `__experimental_controls.emotion`
 * array format. Returns an empty array for `calm` (explicit neutral reset) or
 * any unrecognised value (safe no-op — Cartesia omits the controls block when
 * the array is empty, preserving current behaviour for unknown values).
 *
 * Only `low`/`high` levels are used — Cartesia has rejected `medium` with
 * "invalid emotion level: medium" in production (voice/API-version dependent
 * level support). Even so, the Cartesia TTS adapter independently retries any
 * "invalid voice controls"/"invalid emotion" 400 with controls stripped, so a
 * level Cartesia stops accepting in the future degrades to plain speech for
 * that sentence instead of ending the call.
 */
function mapEmotionToCartesia(value: string): string[] {
  // Current Cartesia API takes the emotion name directly in
  // generation_config.emotion (single enum string) — the legacy
  // ["family:level"] pairs are rejected. Every tag the LLM can emit is a
  // valid enum member, so pass it through; the adapter validates against the
  // full enum and drops unknowns. ("calm" used to map to [] because the old
  // scheme had no calm — it is a real enum value now.)
  switch (value) {
    case "enthusiastic":
    case "sympathetic":
    case "calm":
    case "curious":
    case "content":
    case "sad":
      return [value];
    default:
      return [];
  }
}

/**
 * Extracts the first inline `<function=NAME>BODY</function>` tag from a response string.
 * Returns the function name and parsed args (body treated as JSON), or null if none found.
 */
function extractInlineFunctionTag(text: string): { name: string; args: Record<string, unknown> } | null {
  const m =
    /<function=(\w+)[^>]*>([\s\S]*?)<\/function>/.exec(text) ??
    /<function=(\w+)[^>]*\s*\/>/.exec(text) ??
    /<function=(\w+)[^>]*>/.exec(text);
  if (!m) return null;
  const name = (m[1] ?? "").trim();
  if (!name) return null;
  const body = (m[2] ?? "").trim();
  let args: Record<string, unknown> = {};
  if (body && body !== "{}") {
    try { args = JSON.parse(body) as Record<string, unknown>; } catch { /* ignore malformed args */ }
  }
  return { name, args };
}

/**
 * Stateful per-turn kill-switch for serialized tool-call markup that an LLM
 * leaks into the TEXT stream AFTER some conversational text — so the start-of-
 * reply envelope guard (which only inspects the first non-whitespace char) never
 * sees it. sarvam-30b, for example, appended a bare `<arg_value>{ "scheduled_at":
 * null }` tail after its spoken sentence (prod call 1022); the `<function=…>`
 * filter does not match it, so it was sent to TTS and read aloud. Once ANY tool
 * marker is seen, everything from it to the end of the turn is suppressed.
 * Markers split across streaming chunks are handled by holding back only a tail
 * that is a prefix of a marker; ordinary text flushes immediately.
 */
function makeToolTailFilter(): (token: string) => string {
  const MARKERS = [
    "<function", "<arg_value", "<arg_key", "<tool_call", "</tool_call",
    "<tools>", "<|tool", "<|python_tag|>",
  ];
  const MAXLEN = Math.max(...MARKERS.map((m) => m.length));
  let buf = "";
  let killed = false;

  return function filterToolTailToken(token: string): string {
    if (killed) return "";
    buf += token;
    // Markers are lowercase; match case-insensitively (toLowerCase preserves
    // length so indices/slices stay aligned with the original-cased buf).
    const lower = buf.toLowerCase();

    let cut = -1;
    for (const m of MARKERS) {
      const idx = lower.indexOf(m);
      if (idx !== -1 && (cut === -1 || idx < cut)) cut = idx;
    }
    if (cut !== -1) {
      killed = true;
      const out = buf.slice(0, cut);
      buf = "";
      return out;
    }

    // No complete marker yet. Hold back only a trailing fragment that could be
    // the START of a marker split across streaming chunks; flush the rest now.
    // Any held tail that turns out to be real text is recovered by the
    // cleanResponse final flush (which also runs stripToolArtifacts).
    let hold = 0;
    const maxCheck = Math.min(MAXLEN - 1, buf.length);
    for (let k = maxCheck; k > 0; k--) {
      const tail = lower.slice(lower.length - k);
      if (MARKERS.some((m) => m.startsWith(tail))) { hold = k; break; }
    }
    const out = hold > 0 ? buf.slice(0, buf.length - hold) : buf;
    buf = hold > 0 ? buf.slice(buf.length - hold) : "";
    return out;
  };
}

/**
 * Stateful per-turn filter that strips `<function=NAME>…</function>` tags from
 * the LLM token stream before text reaches TTS. Analogous to makeThinkFilter.
 * Call once per turn; the returned closure is statefull across tokens.
 */
function makeFunctionTagFilter(): (token: string) => string {
  let inFnTag = false;
  let buf = "";

  return function filterFnToken(token: string): string {
    buf += token;
    let out = "";

    while (buf.length > 0) {
      if (inFnTag) {
        const closeIdx = buf.indexOf("</function>");
        if (closeIdx !== -1) {
          inFnTag = false;
          buf = buf.slice(closeIdx + "</function>".length);
        } else {
          // Keep buffering — might be mid close-tag
          const tail = Math.max(0, buf.length - "</function>".length + 1);
          buf = buf.slice(tail);
          break;
        }
      } else {
        const openIdx = buf.indexOf("<function=");
        if (openIdx !== -1) {
          out += buf.slice(0, openIdx);
          const relGt = buf.indexOf(">", openIdx);
          if (relGt !== -1) {
            if (buf[relGt - 1] === "/") {
              // Self-closing: <function=NAME /> — consume and stay outside tag
              buf = buf.slice(relGt + 1);
            } else {
              inFnTag = true;
              buf = buf.slice(relGt + 1);
            }
          } else {
            // Haven't seen ">" yet — buffer to avoid emitting partial tag
            buf = buf.slice(openIdx);
            break;
          }
        } else {
          const tail = Math.max(0, buf.length - "<function=".length + 1);
          out += buf.slice(0, tail);
          buf = buf.slice(tail);
          break;
        }
      }
    }
    return out;
  };
}

/**
 * Stateful per-turn filter that strips `</emotion>` closing tags and
 * self-closing `<break …/>` from the LLM token stream while KEEPING all
 * speakable text (including any `<emotion value="…"/>` opening/self-closing
 * tags, which are passed through intentionally so extractEmotionTag can read
 * them at enqueue time). Buffers partial tags split across streaming chunks
 * and collapses double spaces so words aren't run together.
 */
function makeMarkupTagFilter(): (token: string) => string {
  // Lower-cased prefixes of the tags we strip (everything up to the attributes).
  // NOTE: "<emotion" is deliberately absent — opening emotion tags flow through
  // to the sentence accumulator so enqueue() can extract and forward them to
  // Cartesia's __experimental_controls.emotion.  Only orphaned closing tags and
  // <break/> are removed here.
  const STRIP_PREFIXES = ["</emotion", "<break"];
  let buf = "";
  let prevEndedWithSpace = false;

  return function filterMarkupToken(token: string): string {
    buf += token;
    let raw = "";

    while (buf.length > 0) {
      const lt = buf.indexOf("<");
      if (lt === -1) {
        raw += buf;
        buf = "";
        break;
      }
      // Emit any plain text preceding the "<"
      raw += buf.slice(0, lt);
      buf = buf.slice(lt);

      const lower = buf.toLowerCase();
      let matched = false;
      let partial = false;
      for (const p of STRIP_PREFIXES) {
        if (lower.startsWith(p)) { matched = true; break; }
        if (p.startsWith(lower)) { partial = true; }
      }

      if (matched) {
        const gt = buf.indexOf(">");
        if (gt === -1) break;        // tag not finished yet — wait for more tokens
        buf = buf.slice(gt + 1);     // drop the whole tag, keep surrounding text
      } else if (partial) {
        break;                       // "<" might still grow into one of our tags
      } else {
        raw += "<";                  // a "<" that isn't our tag — keep it
        buf = buf.slice(1);
      }
    }

    // Collapse runs of spaces left where a tag was removed, including runs
    // straddling streaming-chunk boundaries (one space already emitted last call).
    let out = "";
    for (const ch of raw) {
      if (ch === " ") {
        if (prevEndedWithSpace) continue;
        prevEndedWithSpace = true;
        out += ch;
      } else {
        prevEndedWithSpace = false;
        out += ch;
      }
    }
    return out;
  };
}

/** Characters of bracket-block content above which the block is treated as an
 *  instruction-leak and silently dropped from the TTS stream. */
const BRACKET_DISCARD_LEN = 120;

/**
 * Stateful per-turn filter that drops long `[…]` bracket blocks from the LLM
 * token stream before text reaches TTS.  Prevents system-prompt instructions
 * from being read aloud when the LLM wraps them in square brackets (e.g.
 * "[Varsha's persona instructions: …]").  Short spans such as "[WHO]" or
 * "[TamilNadu]" (< BRACKET_DISCARD_LEN chars) are kept intact.
 * Call once per turn; the returned closure is stateful across tokens.
 */
function makeBracketFilter(): (token: string) => string {
  let inBlock = false;
  let outerBuf = "";
  let blockContent = "";

  return function filterBracketToken(token: string): string {
    outerBuf += token;
    let out = "";

    while (outerBuf.length > 0) {
      if (inBlock) {
        const closeIdx = outerBuf.indexOf("]");
        if (closeIdx !== -1) {
          blockContent += outerBuf.slice(0, closeIdx);
          outerBuf = outerBuf.slice(closeIdx + 1);
          inBlock = false;
          if (blockContent.length < BRACKET_DISCARD_LEN) out += "[" + blockContent + "]";
          blockContent = "";
        } else {
          blockContent += outerBuf;
          outerBuf = "";
          // Memory guard: once the block is clearly too long, keep only a short
          // tail (still needed to detect the eventual closing "]").
          if (blockContent.length > 800) blockContent = blockContent.slice(-20);
          break;
        }
      } else {
        const openIdx = outerBuf.indexOf("[");
        if (openIdx !== -1) {
          out += outerBuf.slice(0, openIdx);
          outerBuf = outerBuf.slice(openIdx + 1);
          inBlock = true;
          blockContent = "";
        } else {
          out += outerBuf;
          outerBuf = "";
          break;
        }
      }
    }
    return out;
  };
}

/** Extract the tool names from an array of provider tool definitions, which may
 *  be shaped as either `{ function: { name } }` (OpenAI-style) or `{ name }`. */
function toolNamesOf(toolDefs: unknown[]): Set<string> {
  const names = new Set<string>();
  for (const t of toolDefs) {
    const name = (t as any)?.function?.name ?? (t as any)?.name;
    if (typeof name === "string" && name) names.add(name);
  }
  return names;
}

/**
 * Defense-in-depth tool-envelope guard for the LLM→TTS token stream.
 *
 * The primary fix for serialized tool calls lives in each LLM adapter (which
 * resolves the envelope via onToolCall and never forwards it to onToken). This
 * guard is a last line of defense: if ANY adapter still leaks a tool envelope
 * into the token stream, the guard withholds it so a tool call is never spoken
 * aloud to the caller. It inspects only the FIRST non-whitespace content of the
 * reply:
 *   • starts with `{` or a ``` fence  → JSON/fenced envelope, suppress
 *   • starts with `[<validToolName>]` → bracket envelope, suppress
 *   • anything else                   → ordinary text, flush and stop guarding
 * Ordinary bracketed text (e.g. "[laughs]") is NOT suppressed because its name
 * is not in validToolNames. Once the first decision is made the guard becomes a
 * pass-through (or a sink, if suppressing), so it never affects mid-reply text.
 */
function makeToolEnvelopeGuard(validToolNames: Set<string>): {
  filter: (token: string) => string;
  suppressed: () => boolean;
  captured: () => string;
} {
  let decided = false;
  let suppress = false;
  let held = "";      // leading content withheld until the decision is made
  let captured = "";  // full suppressed text (for the anomaly log)

  return {
    filter(token: string): string {
      if (decided) {
        if (suppress) { captured += token; return ""; }
        return token;
      }
      held += token;
      const peek = held.replace(/^\s+/, "");
      if (peek === "") return ""; // only whitespace so far — keep holding
      const first = peek[0];
      if (first === "{" || first === "`") {
        decided = true; suppress = true; captured = held; return "";
      }
      if (first === "[") {
        const close = peek.indexOf("]");
        if (close === -1) {
          // Wait for the closing bracket, but cap how long we hold so a normal
          // reply that merely contains a "[" is not withheld indefinitely.
          if (peek.length > 64) { decided = true; suppress = false; return held; }
          return "";
        }
        const name = peek.slice(1, close).trim();
        if (validToolNames.has(name)) {
          decided = true; suppress = true; captured = held; return "";
        }
        // A short bracket that is not a known tool (e.g. "[laughs]") — flush.
        decided = true; suppress = false; return held;
      }
      // Ordinary text — flush everything held so far and stop guarding.
      decided = true; suppress = false; return held;
    },
    suppressed: () => suppress,
    captured: () => captured,
  };
}

/**
 * Whole-string variant of makeBracketFilter.  Strips `[…]` blocks whose
 * content is ≥ BRACKET_DISCARD_LEN chars from an already-buffered string.
 * Used for post-processing the full LLM response (cleanResponse / cleanForFlush)
 * before TTS enqueue and history storage.
 */
function stripBracketedInstructions(text: string): string {
  return text.replace(/\[[\s\S]{120,}?\]/g, "").replace(/[^\S\r\n]{2,}/g, " ");
}

/**
 * Splits accumulated LLM streaming text into complete sentences ready for TTS.
 *
 * Improvements over the naive regex approach:
 *  • "!" and "?" are always boundaries (they don't appear in abbreviations).
 *  • "..." (ellipsis) is treated as a single boundary.
 *  • "." is a boundary ONLY when followed by whitespace + an uppercase letter,
 *    quote, or opening paren — this correctly skips:
 *      - Abbreviations:   "Dr. Smith", "Mr. Lee", "e.g. this"  (word before "." ≤ 4 letters)
 *      - Decimal numbers: "$1,200.50"  (period not followed by space)
 *      - Domain names:    "google.com" (period not followed by space)
 *  • Falls back to comma-clause dispatch for long responses with no boundary yet.
 */
export function extractSentences(text: string, minCommaClauseChars = 8): { sentences: string[]; remainder: string } {
  const sentences: string[] = [];
  let i = 0;
  let segStart = 0;

  while (i < text.length) {
    const ch = text[i]!;

    if (ch === '!' || ch === '?') {
      // Consume run of consecutive !/?
      while (i + 1 < text.length && (text[i + 1] === '!' || text[i + 1] === '?')) i++;
      const s = text.slice(segStart, i + 1).trim();
      // Min 10 chars (or minCommaClauseChars) so short Indic phrases accumulate smoothly without micro-chunking
      if (s.length >= Math.min(10, minCommaClauseChars)) sentences.push(s);
      i++;
      while (i < text.length && text[i] === ' ') i++;
      segStart = i;

    } else if (ch === '.' && text[i + 1] === '.' && text[i + 2] === '.') {
      // Ellipsis "..." — single boundary
      const s = text.slice(segStart, i + 3).trim();
      if (s.length >= 4) sentences.push(s);
      i += 3;
      while (i < text.length && text[i] === ' ') i++;
      segStart = i;

    } else if (ch === '\u0964') {
      // Devanagari / Indic danda (।) — sentence boundary in Hindi, Tamil-mixed, etc.
      const s = text.slice(segStart, i + 1).trim();
      if (s.length >= 4) sentences.push(s);
      i++;
      while (i < text.length && text[i] === ' ') i++;
      segStart = i;

    } else if (ch === '.') {
      const next = i + 1;
      if (next >= text.length) {
        // Period at end of string
        const s = text.slice(segStart, i + 1).trim();
        if (s.length >= 4) sentences.push(s);
        i++;
        segStart = i;
      } else if (text[next] === ' ' || text[next] === '\n') {
        // Look at first non-space/newline character after the period
        let j = next + 1;
        while (j < text.length && (text[j] === ' ' || text[j] === '\n')) j++;
        const afterSpace = j < text.length ? text[j] : undefined;

        // Split when:
        //  a) next real char is uppercase/quote (English sentence start), OR
        //  b) nothing follows — period+whitespace is at the tail of the current
        //     streaming chunk (handles Tamil/Indic responses that end with ". ")
        // Indic range (\u0900-\u0D7F) mirrors webcall.ts: Indic scripts have no
        // uppercase, so without it Tamil/Hindi mid-sentence boundaries never split
        // here, and the end-of-stream flush re-enqueues an already-spoken opening
        // clause (duplicated heads, e.g. "வணக்கம். வணக்கம். நான்…").
        const shouldSplit = afterSpace === undefined || /[A-Z"'(\u2018\u201C\u0900-\u0D7F]/.test(afterSpace);

        if (shouldSplit) {
          // Only split when the full word before the period is NOT a short abbreviation.
          // We match the complete trailing Latin word (all consecutive letters) and
          // flag as abbreviation only if it is ≤2 chars (Mr, Dr, vs, St, No, etc.).
          // The old heuristic matched a 1–4-char SUFFIX which incorrectly treated
          // Romanised Hindi words like "kare" (4 chars) or the suffix "rega" of
          // "karega" as abbreviations, blocking the sentence split.
          // Digits/punctuation before "." mean we're NOT in an abbreviation
          // (e.g. "cost $1,200.50. Next…").
          // Non-Latin scripts (Tamil, Hindi etc.) won't match the Latin regex so
          // isAbbrev will be false — they always split correctly.
          const wordBefore = text.slice(segStart, i).match(/([A-Za-z]+)$/)?.[1];
          const isAbbrev = wordBefore !== undefined && wordBefore.length <= 2;
          if (!isAbbrev) {
            const s = text.slice(segStart, i + 1).trim();
            if (s.length >= 4) sentences.push(s);
            segStart = j;
            i = j;
          } else {
            i++;
          }
        } else {
          i++;
        }
      } else {
        i++; // period not followed by space (decimal, URL, etc.)
      }
    } else {
      i++;
    }
  }

  let remainder = text.slice(segStart);

  // Early phrase dispatch (Vapi/Bolna-style): start TTS on the first speakable
  // clause while the LLM is still streaming — don't wait for .!? boundaries.
  const early = tryEarlyPhraseDispatch(remainder, minCommaClauseChars);
  if (early) {
    sentences.push(early.clause);
    remainder = early.rest;
  }

  return { sentences, remainder };
}

/**
 * Emit the first speakable clause from streaming LLM text before a sentence
 * boundary (.!?) arrives. Uses comma/semicolon breaks first, then a word
 * boundary once the buffer is long enough for natural prosody.
 */
export function tryEarlyPhraseDispatch(
  remainder: string,
  minChars: number,
): { clause: string; rest: string } | null {
  const minBuffer = minChars + 6;
  if (remainder.length < minBuffer) return null;

  const firstComma = remainder.indexOf(", ");
  if (firstComma !== -1 && remainder.length >= minBuffer) {
    const clause = remainder.slice(0, firstComma).trim();
    // Comma is a natural breath point — allow shorter leading clauses (e.g. "Hello Gopi").
    if (clause.length >= 5) {
      return { clause, rest: remainder.slice(firstComma + 2) };
    }
  }

  for (const sep of ["; ", " — ", " - "] as const) {
    const idx = remainder.lastIndexOf(sep);
    if (idx >= minChars - 1) {
      const clause = remainder.slice(0, idx).trim();
      if (clause.length >= minChars) {
        return { clause, rest: remainder.slice(idx + sep.length) };
      }
    }
  }

  // No word-boundary split here — micro-clauses were consuming the 2-sentence
  // per-turn cap and silencing the final flush (call 2541). Comma/semicolon
  // breaks are enough for early TTS without starving the tail.
  return null;
}
