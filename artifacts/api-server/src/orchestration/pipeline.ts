import * as agnost from "agnostai";
import { GenderDetector } from "./genderDetector.js";
import { GenderDetectorML } from "./genderDetectorML.js";
import { GenderDetectorMLv2 } from "./genderDetectorMLv2.js";
import { buildDatetimeInjection } from "./datetimeInject.js";
import { createSTTAdapter } from "./adapters/stt/index.js";
import { toReadableError } from "./utils.js";
import { createLLMAdapter } from "./adapters/llm/index.js";
import { createTTSAdapter } from "./adapters/tts/index.js";
import { encodeMulaw, upsample8to16, downsample16to8, decodeMulaw, hasSpeechEnergy } from "./audio.js";
import { AmbientNoiseStream, FileAmbientNoiseStream, TRACK_PARAMS, loadPcmLoop } from "./ambient.js";
import { DtmfDetector } from "./dtmf.js";
import { processAudioIn, processRawPcm8kIn, destroyAudioSession } from "./audioPool.js";
import { RecordingBuffer } from "./recorder.js";
import type { AudioProcessResult } from "./audioPool.js";
import type { AgentConfig, AgentTool, ConversationTurn, LLMUsage, SessionConfig, StreamSTT, ToolDefinition } from "./types.js";
import { DEFAULT_GOODBYE_MESSAGE } from "./types.js";
import { retrieveKbContext, retrieveKbContextMulti } from "./kb-retrieval.js";
import { logger } from "../lib/logger.js";
import { format, addMinutes } from "date-fns";
import { toZonedTime, formatInTimeZone } from "date-fns-tz";
import { db, bookingsTable, eventTypesTable, schedulingCalendarsTable, agentsTable, platformSettingsTable } from "@workspace/db";
import { eq, and, or, sql } from "drizzle-orm";
import { getAvailableSlots } from "../services/scheduling/slot-engine.js";
import type { TimeSlot } from "../services/scheduling/slot-engine.js";
import { buildSlotLockKey } from "../services/scheduling/lock.js";
import { sendBookingCreatedEmail, sendBookingCancelledEmail, sendBookingRescheduledEmail } from "../services/scheduling/notifications.js";
import { dispatchSchedulingWebhooks } from "../routes/scheduling/webhooks.js";
import {
  buildToolDefs,
  matchToolByName,
  executeNativeBooking as sharedExecuteNativeBooking,
  executeNativeCheckAvailability as sharedExecuteNativeCheckAvailability,
  executeNativeListBookings as sharedExecuteNativeListBookings,
  executeNativeReschedule as sharedExecuteNativeReschedule,
  executeNativeCancel as sharedExecuteNativeCancel,
  executeWebhookTool as sharedExecuteWebhookTool,
  parsePreferredDate,
  writeTransferLeadDb,
} from "../services/tool-executor.js";

const VAD_SILENCE_MS          = 250;    // silence window before STT flush
const MIN_SPEECH_BYTES        = 3200;   // ~200ms @ 8kHz PCM — skip noise bursts shorter than this
const CHUNK_SIZE_MULAW        = 160;    // 20ms @ 8kHz mulaw for paced batch playback
const VAD_THRESHOLD           = 100;    // RMS threshold for speech detection
const STREAM_ACCUM_BYTES      = 640;    // 20ms of 16kHz PCM before forwarding a TTS stream chunk
const HANDOFF_SILENCE_MS      = 3000;   // sustained silence that may indicate a phone handoff
const FILLER_THRESHOLD_MS     = 800;    // play a filler phrase if LLM has not returned a first
                                        // token within this window (and backchannel didn't fire)
const FILLER_PHRASES = [
  "One moment please...",
  "Let me check that for you...",
  "Sure, give me just a second...",
];
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

const BACKCHANNEL_PHRASES = [
  "I see.", "Got it.", "Okay.", "Mm-hmm.", "Sure.", "I understand.", "Go on.",
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

export class OrchestrationPipeline {
  private config: SessionConfig;
  private agent: AgentConfig;
  private stt: ReturnType<typeof createSTTAdapter>;
  private llm: ReturnType<typeof createLLMAdapter>;
  private tts: ReturnType<typeof createTTSAdapter>;

  private audioBuffer: Buffer[] = [];
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private silenceHangupTimer: ReturnType<typeof setTimeout> | null = null;
  private isProcessing = false;

  // Barge-in state
  private isPlaying = false;
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
  private streamingBargeInWordCount = 0;
  // Echo grace period: timestamp (ms) until which barge-in is suppressed after
  // playback starts.  Vobiz / Twilio route a small amount of our own TTS audio
  // back to us as "caller audio" (sidetone / echo).  Without this hold, the
  // echo triggers barge-in within 200 ms and the caller never hears anything.
  private bargeInHoldUntil = 0;

  // P1-D: Per-agent VAD / barge-in settings (set from agent config in constructor)
  private readonly vadSilenceMs: number;
  private readonly bargeInEnabled: boolean;
  private readonly bargeInEnergyThreshold: number;
  private readonly bargeInMinFrames: number;
  private readonly bargeInEchoGraceMs: number;

  // Streaming STT (Deepgram live transcription)
  private streamSTT: StreamSTT | null = null;
  private pendingTranscript: { text: string; emittedAt: number } | null = null;
  private streamSTTReconnectAttempts = 0;
  private streamSTTReconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // KB prefetch — fired on the first speech frame of a new utterance so the
  // result is ready by the time STT finishes and processTurn() starts.
  // Consumed (set to null) at the top of processTurn() to avoid stale reuse.
  private kbPrefetchPromise: Promise<string | null> | null = null;
  // Tracks whether we are currently inside an active speech segment for the
  // streaming STT path (where there is no audioBuffer to check against).
  private inSpeechSegment = false;

  // Metrics
  private firstAudioSentAt: number | null = null;
  // Count of filler phrases played due to slow LLM response (>800 ms to first token)
  private fillerPlayedCount = 0;

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

  // Recording — stereo WAV of both sides (caller=L, agent=R)
  private recording = new RecordingBuffer(8000);

  private conversationHistory: ConversationTurn[] = [];
  private closed = false;

  // Ambient noise
  private ambientStream: AmbientNoiseStream | FileAmbientNoiseStream | null = null;
  private ambientInterval: ReturnType<typeof setInterval> | null = null;

  // IVR / DTMF
  private dtmfDetector: DtmfDetector | null = null;
  private dtmfResolver: ((digit: string | null) => void) | null = null;
  private dtmfTimeoutId: ReturnType<typeof setTimeout> | null = null;

  // Gender detection — fires once per call using early caller speech
  private genderDetector: GenderDetector | GenderDetectorML | GenderDetectorMLv2;

  // Multilingual — tracks the active language detected by Azure LID
  private currentLang: string = "";

  constructor(config: SessionConfig) {
    this.config = config;
    this.agent = config.agentConfig;
    this.bargeInCallback = config.onBargeIn ?? null;
    // P1-D: Per-agent VAD / barge-in tuning
    this.vadSilenceMs           = config.agentConfig.vadSilenceMs;
    this.bargeInEnabled         = config.agentConfig.bargeInEnabled;
    this.bargeInEnergyThreshold = config.agentConfig.bargeInEnergyThreshold;
    this.bargeInMinFrames       = config.agentConfig.bargeInMinFrames;
    this.bargeInEchoGraceMs     = config.agentConfig.bargeInEchoGraceMs;
    // P1-J: Stop Speaking Plan overrides barge-in params when configured
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
    if (config.agentConfig.genderDetectionEnabled) {
      const gp = config.agentConfig.genderDetectionProvider;
      this.genderDetector = gp === "ml_model_v2"
        ? new GenderDetectorMLv2(config.callId)
        : gp === "ml_model"
          ? new GenderDetectorML(config.callId)
          : new GenderDetector(config.callId);
    } else {
      this.genderDetector = null as unknown as GenderDetector;
    }

    const keys = config.providerKeys;

    const sttKey = keys.get(this.agent.asrProvider);
    if (!sttKey) throw new Error(`No API key found for STT provider: ${this.agent.asrProvider}`);

    const llmKey = keys.get(this.agent.llmProvider);
    if (!llmKey) throw new Error(`No API key found for LLM provider: ${this.agent.llmProvider}`);

    const ttsKey = keys.get(this.agent.ttsProvider);
    if (!ttsKey) throw new Error(`No API key found for TTS provider: ${this.agent.ttsProvider}`);

    // Multilingual: pass all configured languages as Azure LID candidates
    const sttCfg = this.agent.sttConfig;
    if (this.agent.isMultilingual && this.agent.multilingualLanguages.length > 0) {
      sttCfg.candidateLanguages = this.agent.multilingualLanguages;
    }

    this.stt = createSTTAdapter(
      this.agent.asrProvider, sttKey, this.agent.asrModel,
      keys.get(`${this.agent.asrProvider}:extraConfig`) ?? null,
      sttCfg
    );
    this.llm = createLLMAdapter(this.agent.llmProvider, llmKey, this.agent.llmModel);
    const agentLanguage = this.agent.language ?? null;
    const ttsExtraConfig = this.agent.ttsProvider === "sarvam"
      ? JSON.stringify({ language: agentLanguage ?? "en-IN" })
      : (keys.get(`${this.agent.ttsProvider}:extraConfig`) ?? null);
    this.tts = createTTSAdapter(
      this.agent.ttsProvider, ttsKey, this.agent.ttsVoice, this.agent.ttsModel,
      ttsExtraConfig, agentLanguage
    );

    if (this.agent.noiseCancellationEnabled) {
      logger.info({ callId: config.callId }, "Noise cancellation enabled (audio worker pool)");
    }

    // Ambient noise — start looping silence-fill interval
    if (this.agent.ambientNoiseEnabled && this.agent.ambientNoiseTrack) {
      const track = this.agent.ambientNoiseTrack;
      if (Object.prototype.hasOwnProperty.call(TRACK_PARAMS, track)) {
        // Built-in procedural track — synchronous
        this.ambientStream = new AmbientNoiseStream(track);
        logger.info({ callId: config.callId, track }, "Ambient noise enabled (built-in track)");
      } else {
        // Uploaded sound ID — load PCM from GCS asynchronously
        // ambientStream starts as null; the interval skips while loading
        logger.info({ callId: config.callId, soundId: track }, "Ambient noise enabled (uploaded sound, loading PCM…)");
        loadPcmLoop(track)
          .then((pcmBuffer) => {
            if (!this.closed) {
              this.ambientStream = new FileAmbientNoiseStream(pcmBuffer);
              logger.info({ callId: config.callId, soundId: track }, "Ambient noise: PCM loop ready");
            }
          })
          .catch((err) => {
            logger.error({ callId: config.callId, soundId: track, err }, "Ambient noise: failed to load PCM loop — ambient disabled for this call");
          });
      }
      // Send one 20 ms ambient chunk every 20 ms while the agent is silent.
      // When isPlaying=true playSentence owns the timing, so we skip here to
      // avoid interleaving two concurrent senders on the same WebSocket.
      this.ambientInterval = setInterval(() => {
        if (!this.closed && !this.isPlaying && this.ambientStream) {
          this.config.onAudioOut(this.ambientStream.nextMulawChunk());
        }
      }, 20);
    }

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
        (text, isFinal, detectedLanguage) => {
          if (!isFinal || !text.trim() || this.closed) return;
          this.streamSTTReconnectAttempts = 0; // reset backoff on successful transcript
          this.resetHangupTimer();
          // Multilingual: hot-swap TTS language when Azure LID detects a switch
          if (
            detectedLanguage &&
            this.agent.isMultilingual &&
            detectedLanguage !== this.currentLang
          ) {
            this.currentLang = detectedLanguage;
            if (typeof (this.tts as unknown as { setLanguage?: (l: string) => void }).setLanguage === "function") {
              (this.tts as unknown as { setLanguage: (l: string) => void }).setLanguage(detectedLanguage);
            }
            logger.info(
              { callId: this.config.callId, lang: detectedLanguage },
              "Multilingual: language switched mid-call",
            );
          }
          void this.handleStreamingTranscript(text, Date.now());
        },
        () => {
          // Stream closed — attempt reconnect unless the call is already over
          if (this.closed) return;
          this.streamSTT = null;
          const MAX_ATTEMPTS = 5;
          if (this.streamSTTReconnectAttempts >= MAX_ATTEMPTS) {
            logger.warn({ callId: this.config.callId }, "Streaming STT: max reconnect attempts reached — falling back to batch STT");
            return;
          }
          const backoffMs = Math.min(1000 * 2 ** this.streamSTTReconnectAttempts, 16000);
          this.streamSTTReconnectAttempts++;
          logger.warn(
            { callId: this.config.callId, attempt: this.streamSTTReconnectAttempts, backoffMs },
            "Streaming STT disconnected — scheduling reconnect"
          );
          this.streamSTTReconnectTimer = setTimeout(() => {
            if (!this.closed) this.initStreamingSTT();
          }, backoffMs);
        }
      );
      logger.info({ callId: this.config.callId, provider: this.agent.asrProvider }, "Streaming STT initialized");
    } catch (err) {
      logger.error({ callId: this.config.callId, err }, "Streaming STT init failed — falling back to batch");
    }
  }

  /**
   * Called by the streaming STT callback when a final transcript arrives.
   * Handles barge-in detection and queuing if a turn is already in progress.
   */
  private async handleStreamingTranscript(transcript: string, sttEmittedAt = Date.now()): Promise<void> {
    const sttToProcessMs = Date.now() - sttEmittedAt;
    logger.info(
      { callId: this.config.callId, sttToProcessMs, queued: this.isProcessing },
      "Streaming STT transcript received"
    );
    // A final transcript marks the end of the current speech segment — reset the
    // flag so the NEXT utterance triggers a fresh KB prefetch.
    this.inSpeechSegment = false;

    if (this.bargeInEnabled && this.isPlaying && !this.bargeInRequested) {
      // Accumulate word count across streaming callbacks for this user turn and
      // only fire barge-in once the wordsForInterruption threshold is reached,
      // matching the behaviour of the energy-based path in batch STT mode.
      const wordCount = transcript.trim().split(/\s+/).filter(Boolean).length;
      this.streamingBargeInWordCount += wordCount;
      const threshold = this.agent.wordsForInterruption ?? 2;
      if (this.streamingBargeInWordCount >= threshold) {
        this.bargeInRequested = true;
        this.bargeInCallback?.();
        logger.info(
          { callId: this.config.callId, words: this.streamingBargeInWordCount, threshold },
          "Barge-in detected (streaming STT)",
        );
      }
    } else if (!this.isPlaying) {
      // Agent is not currently playing — keep the accumulator at zero so the
      // next agent speaking turn always begins with a clean slate.  This is the
      // true agent-turn boundary: barge-in detection only makes sense while the
      // agent is speaking, and the very first callback that arrives while
      // isPlaying=true will therefore always start from 0.
      this.streamingBargeInWordCount = 0;
    }

    if (this.isProcessing) {
      this.pendingTranscript = { text: transcript, emittedAt: sttEmittedAt };
      return;
    }

    this.isProcessing = true;
    try {
      await this.processTurn(transcript, 0);
    } catch (err) {
      logger.error({ callId: this.config.callId, err }, "Turn error (streaming STT)");
    } finally {
      this.isProcessing = false;
      const pending = this.pendingTranscript;
      if (pending) {
        this.pendingTranscript = null;
        void this.handleStreamingTranscript(pending.text, pending.emittedAt);
      }
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
    processAudioIn(callId, mulawChunk, this.agent.noiseCancellationEnabled)
      .then((result) => this.handleProcessedAudio(result))
      .catch((err) => logger.error({ callId: this.config.callId, err }, "Audio worker error (mulaw)"));
  }

  /** Incoming raw LINEAR16 PCM @ 8 kHz from Vobiz — offloads noise-cancel + VAD to worker thread */
  onRawPcm8kIn(pcm8k: Buffer): void {
    if (this.closed) return;
    const callId = String(this.config.callId);
    // Record raw caller audio (before noise cancellation)
    this.recording.addCallerChunk(pcm8k);
    // Voice-intelligence tap — runs outside the main audio pipeline
    this.config.callerAudioTap?.(pcm8k);
    processRawPcm8kIn(callId, pcm8k, this.agent.noiseCancellationEnabled)
      .then((result) => this.handleProcessedAudio(result))
      .catch((err) => logger.error({ callId: this.config.callId, err }, "Audio worker error (pcm8k)"));
  }

  /** Returns the recording buffer so the caller (session.ts) can finalize it at call end. */
  getRecording(): RecordingBuffer {
    return this.recording;
  }

  /** Handles pre-processed audio returned by the audio worker pool. */
  private handleProcessedAudio({ pcm8k, pcm16k, hasSpeech }: AudioProcessResult): void {
    if (this.closed) return;

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
      // Feed all frames (not just speech) — librosa pyin handles silence gracefully
      this.genderDetector?.addSpeechChunk(pcm8k);
      // KB prefetch: fire on the first frame of a new speech segment so the lookup
      // runs during the utterance rather than after STT resolves.
      if (!this.inSpeechSegment && !this.isProcessing && this.agent.knowledgeSourceIds.length > 0) {
        this.inSpeechSegment = true;
        this.kbPrefetchPromise = retrieveKbContextMulti(this.agent.knowledgeSourceIds, "")
          .catch((err) => {
            logger.warn({ callId: this.config.callId, err }, "KB prefetch (streaming STT) failed");
            return null;
          });
      }
      this.streamSTT.sendAudio(pcm16k);
      return;
    }

    // Feed all frames to the gender detector (fires async once after 2 s of audio, then no-ops)
    this.genderDetector?.addSpeechChunk(pcm8k);

    // Batch STT path with local VAD + barge-in detection
    if (hasSpeech) {
      this.resetHangupTimer();

      if (this.bargeInEnabled && this.isPlaying && !this.bargeInRequested) {
        const now = Date.now();
        if (now < this.bargeInHoldUntil) {
          // Echo grace period: suppress barge-in for the first bargeInEchoGraceMs
          // after playback starts to ignore phone sidetone / echo returning from Vobiz.
          this.bargeInSpeechFrames = 0;
        } else if (hasSpeechEnergy(pcm8k, this.bargeInEnergyThreshold)) {
          // Only count frames that exceed the much-higher barge-in energy threshold
          // (4× the normal VAD level) — intentional caller speech will clear this bar,
          // but ambient noise, echo bleed, or background conversation won't.
          this.bargeInSpeechFrames++;
          // wordsForInterruption: each word ≈ 20 frames at 20ms/frame (150 wpm).
          // Effective min frames = max(bargeInMinFrames, wordsForInterruption * 20).
          const effectiveMinFrames = Math.max(
            this.bargeInMinFrames,
            (this.agent.wordsForInterruption ?? 2) * 20,
          );
          if (this.bargeInSpeechFrames >= effectiveMinFrames) {
            this.bargeInRequested = true;
            this.bargeInCallback?.();
            this.audioBuffer = [];
            logger.info({ callId: this.config.callId, frames: this.bargeInSpeechFrames, effectiveMinFrames }, "Barge-in detected (batch STT)");
          }
          this.bargeInLowEnergyFrames = 0;
        } else {
          // Don't reset immediately on a single below-threshold frame — brief
          // inter-syllable pauses would otherwise kill an accumulating run.
          // Only reset after 5 consecutive low-energy frames (~100 ms).
          this.bargeInLowEnergyFrames++;
          if (this.bargeInLowEnergyFrames >= 5) {
            this.bargeInSpeechFrames = 0;
            this.bargeInLowEnergyFrames = 0;
          }
        }
      }
    } else {
      this.bargeInSpeechFrames = 0; // genuine VAD silence — reset
      this.bargeInLowEnergyFrames = 0;
    }

    if (this.isProcessing) return;

    if (hasSpeech) {
      // KB prefetch: fire on the very first speech frame of a new utterance so
      // the lookup runs while the user is still speaking + during the silence
      // wait + during STT — well before processTurn() needs the result.
      if (this.audioBuffer.length === 0 && this.agent.knowledgeSourceIds.length > 0) {
        this.kbPrefetchPromise = retrieveKbContextMulti(this.agent.knowledgeSourceIds, "")
          .catch((err) => {
            logger.warn({ callId: this.config.callId, err }, "KB prefetch (batch STT) failed");
            return null;
          });
      }
      this.audioBuffer.push(pcm8k);
      this.resetSilenceTimer();
    } else if (this.audioBuffer.length > 0) {
      this.audioBuffer.push(pcm8k);
      this.scheduleSilenceFlush();
    }
  }

  // ── Greeting ────────────────────────────────────────────────────────────────

  async greet(): Promise<void> {
    if (this.closed) return;
    // "User speaks first" — stay silent on connect; the session listens for
    // caller audio and only responds after the user speaks.
    if (this.agent.firstSpeaker === "user") {
      logger.info({ callId: this.config.callId }, "First speaker = user — skipping opening greeting");
      return;
    }
    this.isProcessing = true;
    try {
      // IVR pre-filter: play menu, collect a digit, then fall through to normal greeting
      if (this.agent.ivrEnabled && this.agent.ivrGreeting) {
        const transferred = await this.runIvr();
        if (transferred || this.closed) return; // call was routed away — do not greet
      }

      let greeting = this.agent.greetingMessage ?? "";

      // Substitute {caller_salutation} in the greeting with the neutral salutation —
      // gender detection has not fired yet at greeting time.
      if (greeting) {
        const rawSal = this.agent.genderDetectionNeutralSalutation ?? "";
        const resolvedSal = (rawSal === "(skip)" || !rawSal) ? "" : rawSal;
        if (resolvedSal) {
          greeting = greeting
            .replace(/\{\{caller_salutation\}\}/g, resolvedSal)
            .replace(/\{caller_salutation\}/g, resolvedSal);
        } else {
          greeting = greeting
            .replace(/\s*\{\{caller_salutation\}\}\s*/g, " ")
            .replace(/\s*\{caller_salutation\}\s*/g, " ");
        }
        logger.info({ callId: this.config.callId, resolvedSalutation: resolvedSal || "(empty)" }, "Pipeline: caller_salutation in greeting resolved to neutral (pre-detection)");
      }

      if (!greeting.trim()) {
        // Fallback: ask the LLM to generate an opener
        try {
          await this.llm.chat(
            [], this.agent.systemPrompt,
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
        } catch (llmErr) {
          const reason = toReadableError(llmErr, "LLM error");
          logger.error({ callId: this.config.callId, err: llmErr }, reason);
          this.config.onFatalError?.(reason);
          return;
        }
        // Strip any <think>…</think> reasoning blocks that reasoning models emit
        greeting = greeting.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      }

      if (!greeting.trim() || this.closed) return;
      logger.info({ callId: this.config.callId, greeting: greeting.slice(0, 80) }, "Sending greeting");
      this.conversationHistory.push({ role: "assistant", content: greeting });
      this.config.onTranscript("agent", greeting);
      this.config.onConversationUpdate?.(this.conversationHistory);
      this.firstAudioSentAt = null;
      this.bargeInHoldUntil = Date.now() + this.bargeInEchoGraceMs;
      this.isPlaying = true;
      try {
        await this.playSentence(greeting);
      } finally {
        this.isPlaying = false;
      }
    } catch (err) {
      logger.error({ callId: this.config.callId, err }, "Greeting error");
    } finally {
      this.isProcessing = false;
    }
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
    this.silenceTimer = setTimeout(() => {
      this.silenceTimer = null;
      void this.flushAndProcess();
    }, this.vadSilenceMs);
  }

  /** Reset (or start) the silence-hangup countdown. Fires onCallEnd if no speech for silenceTimeoutSeconds. */
  private resetHangupTimer(): void {
    if (!this.agent.silenceTimeoutSeconds) return;
    if (this.silenceHangupTimer) clearTimeout(this.silenceHangupTimer);
    this.silenceHangupTimer = setTimeout(() => {
      this.silenceHangupTimer = null;
      if (!this.closed) {
        logger.info({ callId: this.config.callId }, "Silence timeout — ending call");
        void this.playInactivityMessageAndEnd();
      }
    }, this.agent.silenceTimeoutSeconds * 1000);
  }

  /** Speak the inactivity farewell message (if configured) before triggering call end. */
  private async playInactivityMessageAndEnd(): Promise<void> {
    if (this.agent.inactivityMessage && !this.closed) {
      try { await this.playSentence(this.agent.inactivityMessage); } catch { /* ignore */ }
    }
    if (!this.closed) this.config.onCallEnd();
  }

  // ── TTS playback ─────────────────────────────────────────────────────────────

  private async playSentence(text: string): Promise<void> {
    if (this.bargeInRequested) return;

    // Meter characters at request-dispatch time — TTS providers charge for the
    // text submitted when the HTTP request is sent, not when audio delivery
    // completes.  Counting here ensures barge-in aborts and stream timeouts
    // don't under-report usage even though the provider already billed.
    this.ttsCharactersTotal += text.length;

    if (this.tts.synthesizeStream) {
      // Producer-consumer pacing: the TTS stream callback pushes mulaw chunks
      // into a queue; a concurrent drain loop sends them at exactly real-time
      // rate (20 ms per 160-byte chunk).  This prevents flooding Vobiz / Twilio
      // with a burst of messages that overwhelms their playback buffer and causes
      // glitches or stuttering.
      const queue: Buffer[] = [];
      let ttsDone = false;

      const drainLoop = async (): Promise<void> => {
        while (!this.closed && !this.bargeInRequested) {
          if (queue.length > 0) {
            const chunk = queue.shift()!;
            if (!this.firstAudioSentAt) this.firstAudioSentAt = Date.now();
            // Ambient mixing only applies to mulaw output; skip when sending raw PCM
            const outChunk = (!this.config.rawPcmOutput && this.ambientStream)
              ? this.ambientStream.mixIntoMulaw(chunk)
              : chunk;
            this.config.onAudioOut(outChunk);
            await new Promise<void>((r) => setTimeout(r, 20));
          } else if (ttsDone) {
            break; // queue drained and TTS finished — we're done
          } else {
            // Queue momentarily empty while TTS is still streaming —
            // wait a short tick before checking again
            await new Promise<void>((r) => setTimeout(r, 5));
          }
        }
      };

      let accum: Buffer[] = [];
      let accumSize = 0;

      const flush = (): void => {
        if (accum.length === 0 || this.closed || this.bargeInRequested) {
          accum = [];
          accumSize = 0;
          return;
        }
        const pcm16k = Buffer.concat(accum);
        accum = [];
        accumSize = 0;
        const pcm8k = downsample16to8(pcm16k);
        // Record agent audio (downsampled to match recording sample rate)
        this.recording.addAgentChunk(pcm8k);
        if (this.config.rawPcmOutput) {
          // Vobiz accepts LINEAR16 PCM natively — skip mulaw encode to avoid lossy round-trip
          const PCM_CHUNK = CHUNK_SIZE_MULAW * 2; // 320 bytes = 20ms @ 8kHz 16-bit
          for (let i = 0; i < pcm8k.length; i += PCM_CHUNK) {
            queue.push(pcm8k.slice(i, i + PCM_CHUNK));
          }
        } else {
          const mulaw = encodeMulaw(pcm8k);
          for (let i = 0; i < mulaw.length; i += CHUNK_SIZE_MULAW) {
            queue.push(mulaw.slice(i, i + CHUNK_SIZE_MULAW));
          }
        }
      };

      // AbortController lets us cancel the TTS HTTP connection when:
      //   • the pipeline is closed (call ended / WebSocket dropped), or
      //   • TTS hasn't produced any data within TTS_STREAM_TIMEOUT_MS (hung API).
      // Without this, a hung Cartesia/ElevenLabs fetch blocks playSentence
      // indefinitely and the caller hears complete silence until Vobiz drops.
      const ttsAbort  = new AbortController();
      const ttsTimerId = setTimeout(() => {
        logger.warn({ callId: this.config.callId }, "TTS streaming timed out — aborting fetch");
        ttsAbort.abort();
      }, TTS_STREAM_TIMEOUT_MS);

      // Also abort immediately when the call closes mid-sentence.
      const closedWatcher = setInterval(() => {
        if (this.closed || this.bargeInRequested) ttsAbort.abort();
      }, 50);

      // Start drain loop concurrently with TTS streaming so playback begins
      // as soon as the first chunk arrives (preserves low-latency streaming).
      const drainPromise = drainLoop();

      // ttsOnDone: called by the adapter when synthesis is complete.
      // Characters were already counted at dispatch time above; this just flushes remaining audio.
      const ttsOnDone = (_characters: number): void => {
        flush();
      };

      try {
        await this.tts.synthesizeStream(
          text,
          (chunk) => {
            if (this.closed || this.bargeInRequested) return;
            // Reset the timeout every time a chunk arrives — the connection is alive.
            clearTimeout(ttsTimerId);
            accum.push(chunk);
            accumSize += chunk.length;
            if (accumSize >= STREAM_ACCUM_BYTES) flush();
          },
          ttsOnDone,
          ttsAbort.signal
        );
      } catch (err) {
        const isAbort = err instanceof Error && err.name === "AbortError";
        if (!isAbort) throw err; // real TTS error — propagate up
        logger.warn({ callId: this.config.callId }, "TTS stream aborted");
      } finally {
        clearTimeout(ttsTimerId);
        clearInterval(closedWatcher);
      }

      flush(); // flush any leftover accumulator bytes after aborts (ttsOnDone already called on success)

      ttsDone = true;
      await drainPromise;
    } else {
      const { audio: ttsPcm16k } = await this.tts.synthesize(text);
      if (this.bargeInRequested) return;
      const ttsPcm8k = downsample16to8(ttsPcm16k);
      this.recording.addAgentChunk(ttsPcm8k);
      if (this.config.rawPcmOutput) {
        const PCM_CHUNK = CHUNK_SIZE_MULAW * 2; // 320 bytes = 20ms @ 8kHz 16-bit
        for (let i = 0; i < ttsPcm8k.length; i += PCM_CHUNK) {
          if (this.closed || this.bargeInRequested) break;
          if (!this.firstAudioSentAt) this.firstAudioSentAt = Date.now();
          this.config.onAudioOut(ttsPcm8k.slice(i, i + PCM_CHUNK));
          await new Promise<void>((r) => setTimeout(r, 20));
        }
      } else {
        const ttsMusaw = encodeMulaw(ttsPcm8k);
        for (let i = 0; i < ttsMusaw.length; i += CHUNK_SIZE_MULAW) {
          if (this.closed || this.bargeInRequested) break;
          if (!this.firstAudioSentAt) this.firstAudioSentAt = Date.now();
          const chunk = ttsMusaw.slice(i, i + CHUNK_SIZE_MULAW);
          const outChunk = this.ambientStream ? this.ambientStream.mixIntoMulaw(chunk) : chunk;
          this.config.onAudioOut(outChunk);
          await new Promise<void>((r) => setTimeout(r, 20));
        }
      }
    }
  }

  // ── Tool execution ───────────────────────────────────────────────────────────

  private async handleToolCall(toolName: string, args: Record<string, unknown>): Promise<string | undefined> {
    const tool = matchToolByName(this.agent.tools, toolName);
    if (!tool) {
      // Built-in end_call: always available even if not explicitly in agent tools
      if (toolName === "end_call") {
        logger.info({ callId: this.config.callId }, "Built-in end_call invoked by LLM");
        // Speak the configured goodbye message, or a sensible default, before
        // hanging up — never drop the connection silently.
        const endCallTool = this.agent.tools.find(t => t.type === "end_call");
        const goodbye =
          endCallTool?.type === "end_call" && endCallTool.goodbyeMessage?.trim()
            ? endCallTool.goodbyeMessage
            : DEFAULT_GOODBYE_MESSAGE;
        this.conversationHistory.push({ role: "assistant", content: goodbye });
        this.config.onTranscript("agent", goodbye);
        await this.speakRaw(goodbye);
        this.config.onCallEnd();
        return undefined;
      }
      logger.warn({ callId: this.config.callId, toolName }, "LLM called unknown tool — ignoring");
      return undefined;
    }

    logger.info({ callId: this.config.callId, toolName, toolType: tool.type, args }, "Tool invoked by LLM");

    if (tool.type === "call_transfer") {
      await this.executeCallTransfer(tool, args);
    } else if (tool.type === "transfer_cold") {
      await this.executeTransferCold(tool, args);
    } else if (tool.type === "transfer_warm") {
      await this.executeTransferWarm(tool, args);
    } else if (tool.type === "transfer_agent") {
      await this.executeTransferAgent(tool, args);
    } else if (tool.type === "webhook") {
      await this.executeWebhookTool(tool, args);
    } else if (tool.type === "send_sms") {
      await this.executeSendSms(tool, args);
    } else if (tool.type === "end_call") {
      await this.executeEndCall(tool);
    } else if (tool.type === "cal_com") {
      await this.executeCalCom(tool, args);
    } else if (tool.type === "native_booking") {
      return await this.executeNativeBooking(tool, args);
    } else if (tool.type === "native_reschedule") {
      return await this.executeNativeReschedule(tool, args);
    } else if (tool.type === "native_cancel") {
      return await this.executeNativeCancel(tool, args);
    } else if (tool.type === "native_check_availability") {
      return await this.executeNativeCheckAvailability(tool, args);
    } else if (tool.type === "native_list_bookings") {
      return await this.executeNativeListBookings(tool, args);
    }
    return undefined;
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
      const goodbye = tool.goodbyeMessage?.trim() ? tool.goodbyeMessage : DEFAULT_GOODBYE_MESSAGE;
      this.conversationHistory.push({ role: "assistant", content: goodbye });
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

  private async executeCallTransfer(tool: AgentTool & { type: "call_transfer" }, _args: Record<string, unknown>): Promise<void> {
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
      }
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

      try {
        let summaryText = "";
        await this.llm.chat(
          this.conversationHistory,
          prompt,
          (token) => { summaryText += token; },
          (full)  => { summaryText = full; },
        );
        operatorSummary = summaryText.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
        logger.info({ callId: this.config.callId, summaryLength: operatorSummary.length }, "Warm transfer: operator summary ready");
      } catch (err) {
        logger.error({ callId: this.config.callId, err }, "Warm transfer: summary generation failed — proceeding with cold transfer");
      }
    }

    // Notify session layer (triggers telephony transfer + marks call as transferred)
    this.config.onCallTransfer?.(tool.transferTo, operatorSummary);
    this.config.onCallEnd();
  }

  // ── New transfer tool executors (T3+) ─────────────────────────────────────────

  private async executeTransferCold(tool: AgentTool & { type: "transfer_cold" }, _args: Record<string, unknown>): Promise<void> {
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
      }
    }

    // Notify session layer (triggers telephony redirect)
    this.config.onCallTransfer?.(tool.targetNumber);
    this.config.onCallEnd();

    // Write lead transfer DB
    void writeTransferLeadDb({
      callId: this.config.callId,
      campaignLeadId: this.config.campaignLeadId ?? null,
      transferTo: tool.targetNumber,
      type: "cold",
    });
  }

  private async executeTransferWarm(tool: AgentTool & { type: "transfer_warm" }, _args: Record<string, unknown>): Promise<void> {
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
      }
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
        this.conversationHistory,
        prompt,
        (token) => { summaryText += token; },
        (full)  => { summaryText = full; },
      );
      operatorSummary = summaryText.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      logger.info({ callId: this.config.callId, summaryLength: operatorSummary.length }, "transfer_warm: operator summary ready");
    } catch (err) {
      logger.error({ callId: this.config.callId, err }, "transfer_warm: summary generation failed — proceeding without summary");
    }

    // Notify session layer (triggers telephony redirect + warm briefing)
    this.config.onCallTransfer?.(tool.targetNumber, operatorSummary);
    this.config.onCallEnd();

    // Write lead transfer DB
    void writeTransferLeadDb({
      callId: this.config.callId,
      campaignLeadId: this.config.campaignLeadId ?? null,
      transferTo: tool.targetNumber,
      type: "warm",
      summary: operatorSummary,
    });
  }

  private async executeTransferAgent(tool: AgentTool & { type: "transfer_agent" }, _args: Record<string, unknown>): Promise<void> {
    const targetAgentId = tool.targetAgentId;
    logger.info({ callId: this.config.callId, targetAgentId }, "Executing transfer_agent");

    // Notify session layer with agent: prefix (session.ts will handle AI-to-AI handoff)
    this.config.onCallTransfer?.(`agent:${targetAgentId}`);
    this.config.onCallEnd();

    // Write lead transfer DB
    void writeTransferLeadDb({
      callId: this.config.callId,
      campaignLeadId: this.config.campaignLeadId ?? null,
      transferTo: `agent:${targetAgentId}`,
      type: "agent",
    });
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
    this.firstAudioSentAt = null;

    logger.info({ callId: this.config.callId, transcript, sttLatencyMs }, "Processing turn");

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
      if (delayMs > 0 && !this.bargeInRequested) {
        await new Promise<void>((r) => setTimeout(r, delayMs));
      }
    }

    this.config.onTranscript("user", transcript);
    this.conversationHistory.push({ role: "user", content: transcript });

    // ── Progressive gender detection — fire after each confirmed user turn ──
    // Non-blocking: updates genderDetector.gender for the next turn's salutation.
    // GenderDetector (v0) auto-fires via addSpeechChunk and treats this as a no-op.
    if (this.genderDetector && !this.genderDetector.locked) this.genderDetector.runDetection();

    // ── Guardrail route check ──
    // Fast word-overlap classifier — runs before the main LLM to intercept
    // sensitive or off-topic utterances and play a canned response instead.
    const guardrailResponse = this.checkGuardrailRoutes(transcript);
    if (guardrailResponse !== null) {
      logger.info({ callId: this.config.callId, transcript }, "Guardrail route triggered");
      this.conversationHistory.push({ role: "assistant", content: guardrailResponse });
      this.config.onTranscript("agent", guardrailResponse);
      this.config.onConversationUpdate?.(this.conversationHistory);
      this.isPlaying = true;
      try { await this.playSentence(guardrailResponse); } finally { this.isPlaying = false; }
      return;
    }

    // ── End-call phrase detection ──
    if (this.agent.endCallPhrases.length > 0) {
      const lower = transcript.toLowerCase();
      const matchedPhrase = this.agent.endCallPhrases.find(p => lower.includes(p.toLowerCase()));
      if (matchedPhrase) {
        logger.info({ callId: this.config.callId, transcript }, "End-call phrase detected — speaking goodbye then hanging up");
        const endCallTool = this.agent.tools.find(t => t.type === "end_call");
        const goodbyeText =
          endCallTool?.type === "end_call" && endCallTool.goodbyeMessage?.trim()
            ? endCallTool.goodbyeMessage
            : DEFAULT_GOODBYE_MESSAGE;
        this.conversationHistory.push({ role: "assistant", content: goodbyeText });
        this.config.onTranscript("agent", goodbyeText);
        await this.speakRaw(goodbyeText);
        this.config.onCallEnd();
        return;
      }
    }

    // ── Build tool definitions from agent config ──
    const toolDefs = buildToolDefs(this.agent.tools);

    const llmStart = Date.now();
    let llmFirstTokenAt: number | null = null;

    let llmResponse = "";
    let pendingText  = "";
    let allEnqueued  = false;
    let triggeredToolName: string | null = null;
    let triggeredToolArgs: Record<string, unknown> = {};

    // ── Think-block + function-tag filters (streaming) ──────────────────────
    // Strips <think>…</think> blocks (DeepSeek-R1) and <function=…>…</function>
    // inline tags that some LLMs emit as text instead of using the tool API.
    const filterThinkToken = makeThinkFilter();
    const filterFnTag = makeFunctionTagFilter();

    const sentenceQueue: string[] = [];
    let wakePlayer: (() => void) | null = null;

    const enqueue = (text: string): void => {
      sentenceQueue.push(text);
      if (wakePlayer) {
        const wake = wakePlayer;
        wakePlayer = null;
        const delayMs = this.agent.incrementalDelay ?? 0;
        if (delayMs > 0) {
          setTimeout(wake, delayMs);
        } else {
          wake();
        }
      }
    };

    const playTask = async (): Promise<void> => {
      let idx = 0;
      while (true) {
        if (idx < sentenceQueue.length) {
          const text = sentenceQueue[idx++];
          this.bargeInHoldUntil = Date.now() + this.bargeInEchoGraceMs;
      this.isPlaying = true;
          try {
            await this.playSentence(text);
          } catch (err) {
            const reason = toReadableError(err, "TTS error");
            logger.error({ callId: this.config.callId, err, text: text.slice(0, 40) }, reason);
            this.config.onFatalError?.(reason);
          }
          if (this.bargeInRequested) break;
        } else if (allEnqueued) {
          break;
        } else {
          await new Promise<void>((r) => { wakePlayer = r; });
        }
      }
      this.isPlaying = false;
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
    systemPromptForTurn = `${dtInjection}\n\n${systemPromptForTurn}`;
    let kbContextPromise: Promise<string | null>;
    if (this.kbPrefetchPromise) {
      kbContextPromise = this.kbPrefetchPromise;
      this.kbPrefetchPromise = null;
      logger.debug({ callId: this.config.callId }, "KB context: using speech-start prefetch");
    } else if (this.agent.knowledgeSourceIds.length > 0) {
      kbContextPromise = retrieveKbContextMulti(this.agent.knowledgeSourceIds, transcript)
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
    let backchanneledThisTurn = false;
    if (this.agent.backchannelingEnabled && !this.closed && !this.bargeInRequested) {
      const freq = this.agent.backchannelingFrequency ?? 0.5;
      if (Math.random() < freq) {
        const pool = this.agent.backchannelPhrases.length > 0 ? this.agent.backchannelPhrases : BACKCHANNEL_PHRASES;
        const phrase = pool[Math.floor(Math.random() * pool.length)]!;
        enqueue(phrase);
        backchanneledThisTurn = true;
      }
    }

    // Await KB result — by now it has been running concurrently with the backchannel TTS
    const kbContext = await kbContextPromise;
    if (kbContext) {
      systemPromptForTurn = `${systemPromptForTurn}\n\n## Relevant Knowledge Base Context\n\n${kbContext}`;
    }

    // Inject gender-based salutation directive once detection has resolved
    const detectedGender = this.genderDetector?.gender ?? null;
    if (detectedGender === "male") {
      const sal = this.agent.genderDetectionMaleSalutation;
      systemPromptForTurn += `\n\n[CALLER GENDER] The caller has been identified as male. Always address them respectfully as "${sal}" when appropriate (e.g. "Yes, ${sal}", "Of course, ${sal}"). Never use "${this.agent.genderDetectionFemaleSalutation}".`;
    } else if (detectedGender === "female") {
      const sal = this.agent.genderDetectionFemaleSalutation;
      systemPromptForTurn += `\n\n[CALLER GENDER] The caller has been identified as female. Always address them respectfully as "${sal}" when appropriate (e.g. "Yes, ${sal}", "Of course, ${sal}"). Never use "${this.agent.genderDetectionMaleSalutation}".`;
    } else if (detectedGender === null && this.agent.genderDetectionNeutralSalutation) {
      const sal = this.agent.genderDetectionNeutralSalutation;
      systemPromptForTurn += `\n\n[CALLER GENDER] Gender could not be determined. Use "${sal}" as a neutral salutation when appropriate.`;
    }

    // ── Substitute {caller_salutation} placeholder ────────────────────────
    // The initial variable-resolution pass (session.ts) deliberately skips
    // this placeholder so it can be filled in here, after gender detection.
    {
      const rawSal = detectedGender === "male" ? this.agent.genderDetectionMaleSalutation
        : detectedGender === "female" ? this.agent.genderDetectionFemaleSalutation
        : (this.agent.genderDetectionNeutralSalutation ?? "");
      const resolvedSal = (rawSal === "(skip)" || !rawSal) ? "" : rawSal;
      if (resolvedSal) {
        systemPromptForTurn = systemPromptForTurn
          .replace(/\{\{caller_salutation\}\}/g, resolvedSal)
          .replace(/\{caller_salutation\}/g, resolvedSal);
      } else {
        systemPromptForTurn = systemPromptForTurn
          .replace(/\s*\{\{caller_salutation\}\}\s*/g, " ")
          .replace(/\s*\{caller_salutation\}\s*/g, " ");
      }
      logger.info({ callId: this.config.callId, resolvedSalutation: resolvedSal || "(empty)", detectedGender }, "Pipeline: caller_salutation resolved");
    }

    // Inject scheduling tool usage guide when the agent has cancel/reschedule/list-bookings tools
    const hasSchedulingNav = this.agent.tools.some(
      (t) => t.type === "native_cancel" || t.type === "native_reschedule" || t.type === "native_list_bookings",
    );
    if (hasSchedulingNav) {
      const listTool = this.agent.tools.find((t) => t.type === "native_list_bookings");
      const checkTool = this.agent.tools.find((t) => t.type === "native_check_availability");
      const listName = listTool?.name ?? "get_bookings";
      const checkName = checkTool?.name ?? "check_availability";
      systemPromptForTurn += [
        "",
        "",
        "[SCHEDULING TOOL GUIDE]",
        "When the caller wants to cancel or reschedule an appointment:",
        `1. ALWAYS call "${listName}" (not "${checkName}") to look up their existing appointment by name. Never call "${checkName}" for this purpose.`,
        `2. Always pass the caller's stated timezone into every scheduling tool call (e.g. timezone="Asia/Kolkata"). Default to "Asia/Kolkata" if not stated.`,
        `3. If "${listName}" returns an empty result, say: "There are no upcoming bookings under your name."`,
        `4. If all returned bookings are in the past, say: "Your previous appointment has already passed — I can only reschedule upcoming ones. Would you like to book a new one?"`,
        `IMPORTANT: NEVER invent or guess slot times. You MUST call "${checkName}" before offering any available times to the caller. Only relay times that you received from a tool result.`,
      ].join("\n");
    }

    // Inject booking/availability guide when the agent has a native_booking or native_check_availability tool
    const hasBookingTool = this.agent.tools.some((t) => t.type === "native_booking");
    const hasCheckAvailabilityTool = this.agent.tools.some((t) => t.type === "native_check_availability");
    if (hasBookingTool || hasCheckAvailabilityTool) {
      const bookTool = this.agent.tools.find((t) => t.type === "native_booking");
      const checkTool = this.agent.tools.find((t) => t.type === "native_check_availability");
      const bookName = bookTool?.name ?? "book_appointment";
      const checkName = checkTool?.name ?? "check_availability";
      const lines = [
        "",
        "",
        "[BOOKING TOOL GUIDE]",
        `CRITICAL: NEVER invent, guess, or assume any available slot times. You MUST call "${checkName}" before telling the caller any available times. Only relay times you received directly from a "${checkName}" tool result.`,
      ];
      if (hasCheckAvailabilityTool) {
        lines.push(`"${checkName}" ONLY checks available slots — it does NOT create a booking.`);
      }
      if (hasBookingTool) {
        lines.push(
          `Before calling "${bookName}", you MUST collect the caller's full name and email address. Ask for them if not yet provided.`,
          `NEVER tell the caller their appointment is confirmed or scheduled unless you have received a booking_confirmed: result from "${bookName}".`,
          `Do NOT say "Your appointment has been scheduled" or any equivalent phrase before "${bookName}" returns a booking_confirmed: result.`,
        );
      }
      systemPromptForTurn += lines.join("\n");
    }

    // ── Token Optimization (Layers 1-4) ──────────────────────────────────────
    const tokenOptEnabled = await fetchTokenOptEnabled();
    const fullHistoryLen = this.conversationHistory.length;

    // Layer 2: Sliding Window — trim context to last N turns
    let historyForLlm = this.conversationHistory;
    if (tokenOptEnabled && this.agent.contextWindowTurns && this.agent.contextWindowTurns > 0) {
      historyForLlm = this.conversationHistory.slice(-this.agent.contextWindowTurns);
    }
    const sentHistoryLen = historyForLlm.length;

    // Layer 4: Staged Prompt — override system prompt with active stage block
    if (tokenOptEnabled && this.agent.stagedPromptEnabled && this.agent.stagedPromptStages.length > 0) {
      const stage = this.agent.stagedPromptStages[this.currentStageIndex];
      if (stage) {
        const core = this.agent.stagedPromptCoreIdentity?.trim() ?? "";
        systemPromptForTurn = core ? `${core}\n\n${stage.content}` : stage.content;
        logger.debug({ callId: this.config.callId, stage: stage.name, idx: this.currentStageIndex }, "Staged prompt active");
      }
    }

    // Layer 1: Anthropic KV Cache flag (honoured by AnthropicLLM adapter)
    const useKvCache = tokenOptEnabled && this.agent.llmProvider === "anthropic";

    // ── Dead-air filler timer ────────────────────────────────────────────────
    // If the LLM has not returned a first token within FILLER_THRESHOLD_MS and
    // backchannel didn't already cover the silence, enqueue a filler phrase so
    // the caller hears something rather than dead air.
    let fillerTimer: ReturnType<typeof setTimeout> | null = null;
    if (!backchanneledThisTurn && !this.closed && !this.bargeInRequested) {
      fillerTimer = setTimeout(() => {
        if (!llmFirstTokenAt && !this.bargeInRequested && !this.closed) {
          const phrase = FILLER_PHRASES[Math.floor(Math.random() * FILLER_PHRASES.length)]!;
          enqueue(phrase);
          this.fillerPlayedCount++;
          logger.info({ callId: this.config.callId, phrase }, "Dead-air filler enqueued (LLM > 800 ms)");
        }
      }, FILLER_THRESHOLD_MS);
    }

    const _agnostTurn = agnost.begin({
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
    });

    try {
      await this.llm.chat(
        historyForLlm,
        systemPromptForTurn,
        (token) => {
          if (!llmFirstTokenAt) {
            llmFirstTokenAt = Date.now();
            // LLM responded in time — cancel the dead-air filler before it fires
            if (fillerTimer) { clearTimeout(fillerTimer); fillerTimer = null; }
          }
          llmResponse += token;                  // keep raw response (incl. think blocks)
          const afterThink = filterThinkToken(token);
          if (!afterThink) return;               // token was entirely inside a think block
          const filtered = filterFnTag(afterThink); // strip <function=…> inline tags from TTS
          if (!filtered) return;
          pendingText += filtered;
          const { sentences, remainder } = extractSentences(pendingText);
          for (const s of sentences) enqueue(s);
          pendingText = remainder;
        },
        (fullText) => { llmResponse = fullText; },
        toolDefs.length > 0
          ? {
              tools: toolDefs,
              onToolCall: (name, args) => {
                triggeredToolName = name;
                triggeredToolArgs = args;
              },
              onUsage: (usage) => {
                this.hasRealLlmUsage = true;
                this.llmInputTokensTotal += usage.inputTokens;
                this.llmOutputTokensTotal += usage.outputTokens;
                // Accumulate baseline estimate for savings calculation
                if (fullHistoryLen > sentHistoryLen && sentHistoryLen > 0) {
                  this.baselineInputTokensEstimate += Math.round(usage.inputTokens * fullHistoryLen / sentHistoryLen);
                } else {
                  this.baselineInputTokensEstimate += usage.inputTokens;
                }
              },
              kvCache: useKvCache,
            }
          : {
              onUsage: (usage) => {
                this.hasRealLlmUsage = true;
                this.llmInputTokensTotal += usage.inputTokens;
                this.llmOutputTokensTotal += usage.outputTokens;
                if (fullHistoryLen > sentHistoryLen && sentHistoryLen > 0) {
                  this.baselineInputTokensEstimate += Math.round(usage.inputTokens * fullHistoryLen / sentHistoryLen);
                } else {
                  this.baselineInputTokensEstimate += usage.inputTokens;
                }
              },
              kvCache: useKvCache,
            }
      );
      _agnostTurn?.end(llmResponse);
    } catch (llmErr) {
      if (fillerTimer) { clearTimeout(fillerTimer); fillerTimer = null; }
      _agnostTurn?.end(String(llmErr), false);
      const reason = toReadableError(llmErr, "LLM error");
      logger.error({ callId: this.config.callId, err: llmErr }, reason);
      this.config.onFatalError?.(reason);
      allEnqueued = true;
      const w = wakePlayer as (() => void) | null; wakePlayer = null;
      if (w) w();
      await playPromise;
      throw llmErr;
    }
    // Safety net: clear filler timer if LLM completed without streaming any tokens
    // (e.g. pure tool-call response that never invokes onToken)
    if (fillerTimer) { clearTimeout(fillerTimer); fillerTimer = null; }

    // ── If LLM called a tool, execute it and skip TTS ──
    if (triggeredToolName) {
      // Push the assistant's tool-invocation turn to history BEFORE executing the tool.
      // Without this, continueWithToolResult would see two consecutive "user" messages
      // (the caller's speech + the tool result), which breaks Sarvam's strict turn
      // alternation and confuses all LLMs lacking a tool-result role.
      const assistantToolContent = stripFunctionTags(llmResponse.replace(/<think>[\s\S]*?<\/think>/g, "")).trim() || `[calling tool: ${triggeredToolName}]`;
      this.conversationHistory.push({ role: "assistant", content: assistantToolContent });

      // Enqueue a brief filler (language-aware) so the caller hears something while
      // the tool runs (tool calls can take 1–3 s — without this there is dead silence).
      const TOOL_FILLERS: Record<string, string> = {
        en: "One moment…", hi: "एक क्षण…", ta: "ஒரு நிமிடம்…",
        te: "ఒక్క నిమిషం…", kn: "ಒಂದು ಕ್ಷಣ…", mr: "एक क्षण…",
        gu: "એક ક્ષણ…", bn: "একটু অপেক্ষা করুন…", ml: "ഒരു നിമിഷം…",
        es: "Un momento…", fr: "Un instant…", de: "Einen Moment…", ar: "لحظة…",
      };
      const langPrefix = (this.agent.language ?? "en").split("-")[0] ?? "en";
      const filler = TOOL_FILLERS[langPrefix] ?? TOOL_FILLERS["en"]!;
      if (!this.closed && !this.bargeInRequested) {
        enqueue(filler);
      }
      allEnqueued = true;
      const finalWake = wakePlayer as (() => void) | null;
      wakePlayer = null;
      if (finalWake) finalWake();
      await playPromise; // plays filler (and any earlier backchannel) before continuing
      const toolResult = await this.handleToolCall(triggeredToolName, triggeredToolArgs);
      if (toolResult !== undefined) {
        await this.continueWithToolResult(triggeredToolName, toolResult);
      }
      return;
    }

    const tail = pendingText.trim();
    if (tail.length >= 2) enqueue(tail);
    allEnqueued = true;
    const finalWake = wakePlayer as (() => void) | null;
    wakePlayer = null;
    if (finalWake) finalWake();

    logger.info(
      { callId: this.config.callId, response: llmResponse.slice(0, 80), sentences: sentenceQueue.length },
      "LLM complete"
    );

    // Strip think blocks and inline function tags from the stored response so
    // they don't appear in the transcript UI or pollute conversation history.
    const cleanResponse = stripFunctionTags(llmResponse.replace(/<think>[\s\S]*?<\/think>/g, "")).trim();
    this.conversationHistory.push({ role: "assistant", content: cleanResponse });
    this.config.onTranscript("agent", cleanResponse);
    this.config.onConversationUpdate?.(this.conversationHistory);

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
    if (tokenOptEnabled && this.agent.tokenSummarizationEnabled) {
      const threshold = this.agent.tokenSummarizationThresholdTurns ?? 20;
      const histLen = this.conversationHistory.length;
      if (histLen >= threshold) {
        const keepTurns = this.agent.contextWindowTurns ?? Math.ceil(threshold / 2);
        const replaceCount = Math.max(0, histLen - keepTurns);
        if (replaceCount >= 2) {
          const turnsToSummarize = this.conversationHistory.slice(0, replaceCount);
          void this.summarizeOldTurns(turnsToSummarize, replaceCount);
        }
      }
    }

    await playPromise;

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
    logger.info(
      { callId: this.config.callId, sttLatencyMs, llmLatencyMs, ttsFirstChunkMs },
      "Turn metrics"
    );
    this.config.onMetrics?.({ sttLatencyMs, llmLatencyMs, ttsFirstChunkMs });

    // ── Hangup after LLM call ───────────────────────────────────────────────
    if (this.agent.hangupAfterLlmCall && !this.closed) {
      logger.info({ callId: this.config.callId }, "hangupAfterLlmCall — ending call");
      this.config.onCallEnd();
    }
  }

  private async flushAndProcess(): Promise<void> {
    if (this.isProcessing || this.audioBuffer.length === 0) return;

    const pcmChunks = this.audioBuffer.splice(0);
    const pcm8k = Buffer.concat(pcmChunks);
    if (pcm8k.length < MIN_SPEECH_BYTES) return;

    this.isProcessing = true;

    try {
      const pcm16k = upsample8to16(pcm8k);
      logger.info({ callId: this.config.callId, bytes: pcm16k.length }, "Sending to STT");

      const sttStart = Date.now();
      let transcript: string | null | undefined;
      try {
        transcript = await this.stt.transcribe(pcm16k, 16000);
      } catch (sttErr) {
        const reason = toReadableError(sttErr, "STT error");
        logger.error({ callId: this.config.callId, err: sttErr }, reason);
        this.config.onFatalError?.(reason);
        return;
      }
      const sttLatencyMs = Date.now() - sttStart;

      if (!transcript?.trim()) {
        logger.info({ callId: this.config.callId }, "Empty STT transcript, skipping");
        return;
      }

      await this.processTurn(transcript, sttLatencyMs);

    } catch (err) {
      logger.error({ callId: this.config.callId, err }, "Pipeline error");
    } finally {
      this.isProcessing = false;
      if (this.audioBuffer.length > 0) void this.flushAndProcess();
    }
  }

  getHistory(): ConversationTurn[] {
    return this.conversationHistory;
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
    const transcript = turns
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
        this.conversationHistory.splice(0, replaceCount, {
          role: "assistant",
          content: `[CONVERSATION SUMMARY] ${summary.trim()}`,
        });
        logger.info(
          { callId: this.config.callId, summarizedTurns: replaceCount, historyNow: this.conversationHistory.length },
          "Token summarization: old turns compressed"
        );
      }
    } catch (err) {
      logger.warn({ callId: this.config.callId, err }, "Token summarization failed — continuing without compression");
    }
  }

  getTranscript(): string {
    return this.conversationHistory
      .map((t) => `${t.role === "user" ? "Caller" : "Agent"}: ${t.content}`)
      .join("\n");
  }

  /** P2-A: Execute a native booking and return a structured result string for LLM consumption. */
  private async executeNativeBooking(tool: AgentTool & { type: "native_booking" }, args: Record<string, unknown>): Promise<string> {
    return sharedExecuteNativeBooking(this.config.callId, this.agent.id, tool, args);
  }

  private async executeNativeReschedule(tool: AgentTool & { type: "native_reschedule" }, args: Record<string, unknown>): Promise<string> {
    return sharedExecuteNativeReschedule(this.config.callId, this.agent.id, tool, args);
  }

  private async executeNativeCancel(tool: AgentTool & { type: "native_cancel" }, args: Record<string, unknown>): Promise<string> {
    return sharedExecuteNativeCancel(this.config.callId, this.agent.id, tool, args);
  }

  private async executeNativeCheckAvailability(tool: AgentTool & { type: "native_check_availability" }, args: Record<string, unknown>): Promise<string> {
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
  private async continueWithToolResult(toolName: string, result: string, depth: number = 0): Promise<void> {
    this.conversationHistory.push({ role: "user", content: `[Tool result for ${toolName}]: ${result}` });

    let llmResponse = "";
    let pendingText = "";
    let allEnqueued = false;

    // Keep tools attached on follow-up turns so the agent can chain calls in a
    // single user turn (e.g. check_availability → book_appointment → end_call).
    // A depth cap forces a final tools-detached narration to prevent runaway loops.
    const MAX_TOOL_DEPTH = 5;
    const toolDefs = buildToolDefs(this.agent.tools);
    const attachTools = depth < MAX_TOOL_DEPTH && toolDefs.length > 0;
    let triggeredToolName: string | null = null;
    let triggeredToolArgs: Record<string, unknown> = {};

    const filterThinkToken = makeThinkFilter();
    const filterFnTag = makeFunctionTagFilter();

    const sentenceQueue: string[] = [];
    let wakePlayer: (() => void) | null = null;

    const enqueue = (text: string): void => {
      sentenceQueue.push(text);
      if (wakePlayer) { const w = wakePlayer; wakePlayer = null; w(); }
    };

    const playTask = async (): Promise<void> => {
      let idx = 0;
      while (true) {
        if (idx < sentenceQueue.length) {
          const text = sentenceQueue[idx++]!;
          this.bargeInHoldUntil = Date.now() + this.bargeInEchoGraceMs;
          this.isPlaying = true;
          try { await this.playSentence(text); } catch (err) {
            logger.error({ callId: this.config.callId, err, text: text.slice(0, 40) }, "continueWithToolResult TTS error");
          }
          if (this.bargeInRequested) break;
        } else if (allEnqueued) {
          break;
        } else {
          await new Promise<void>((r) => { wakePlayer = r; });
        }
      }
      this.isPlaying = false;
    };

    const playPromise = playTask();

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

    try {
      await this.llm.chat(
        this.conversationHistory,
        toolSystemPrompt,
        (token) => {
          llmResponse += token;
          const afterThink = filterThinkToken(token);
          if (!afterThink) return;
          const filtered = filterFnTag(afterThink);
          if (!filtered) return;
          pendingText += filtered;
          const { sentences, remainder } = extractSentences(pendingText);
          for (const s of sentences) enqueue(s);
          pendingText = remainder;
        },
        (fullText) => { llmResponse = fullText; },
        attachTools
          ? {
              tools: toolDefs,
              onToolCall: (name, args) => {
                triggeredToolName = name;
                triggeredToolArgs = args;
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
      const wErr = wakePlayer as (() => void) | null; wakePlayer = null; if (wErr) wErr();
      await playPromise;
      return;
    }

    const tail = pendingText.trim();
    if (tail.length >= 2) enqueue(tail);
    allEnqueued = true;
    const wFinal = wakePlayer as (() => void) | null; wakePlayer = null; if (wFinal) wFinal();
    await playPromise;

    // ── Chained tool call — the agent invoked another tool off the result ──
    if (triggeredToolName) {
      const chainedName: string = triggeredToolName;
      const assistantToolContent = stripFunctionTags(llmResponse.replace(/<think>[\s\S]*?<\/think>/g, "")).trim()
        || `[calling tool: ${chainedName}]`;
      this.conversationHistory.push({ role: "assistant", content: assistantToolContent });
      const chainedResult = await this.handleToolCall(chainedName, triggeredToolArgs);
      if (chainedResult !== undefined) {
        await this.continueWithToolResult(chainedName, chainedResult, depth + 1);
      }
      return;
    }

    const cleanResponse = stripFunctionTags(llmResponse.replace(/<think>[\s\S]*?<\/think>/g, "")).trim();
    if (cleanResponse) {
      this.conversationHistory.push({ role: "assistant", content: cleanResponse });
      this.config.onTranscript("agent", cleanResponse);
      this.config.onConversationUpdate?.(this.conversationHistory);
    }

    // ── Inline function-tag execution (safety net for LLMs that emit <function=X> as text) ──
    // If no native tool was triggered but the LLM included an inline function tag,
    // execute it now (the tag was already stripped from the spoken text above).
    const inlineFn = extractInlineFunctionTag(llmResponse);
    if (inlineFn) {
      logger.info({ callId: this.config.callId, fnName: inlineFn.name }, "Inline function tag detected in continueWithToolResult — executing");
      const toolResult = await this.handleToolCall(inlineFn.name, inlineFn.args);
      if (toolResult !== undefined) {
        await this.continueWithToolResult(inlineFn.name, toolResult, depth + 1);
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
    this.isPlaying = true;
    try { await this.playSentence(ivrGreeting); }
    finally { this.isPlaying = false; }

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
      this.config.onCallTransfer?.(`agent:${opt.targetAgentId}`);
      logger.info({ callId: this.config.callId, targetAgentId: opt.targetAgentId }, "IVR: call transferred to agent");
      return true;
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
    if (this.silenceHangupTimer) {
      clearTimeout(this.silenceHangupTimer);
      this.silenceHangupTimer = null;
    }
    if (this.streamSTTReconnectTimer) {
      clearTimeout(this.streamSTTReconnectTimer);
      this.streamSTTReconnectTimer = null;
    }
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

function makeThinkFilter(): (token: string) => string {
  let inThinkBlock = false;
  let thinkBuf = "";

  return function filterThinkToken(token: string): string {
    thinkBuf += token;
    let out = "";

    while (thinkBuf.length > 0) {
      if (inThinkBlock) {
        const closeIdx = thinkBuf.indexOf("</think>");
        if (closeIdx !== -1) {
          inThinkBlock = false;
          thinkBuf = thinkBuf.slice(closeIdx + "</think>".length);
        } else {
          const tail = Math.max(0, thinkBuf.length - "</think>".length + 1);
          thinkBuf = thinkBuf.slice(tail);
          break;
        }
      } else {
        const openIdx = thinkBuf.indexOf("<think>");
        if (openIdx !== -1) {
          out += thinkBuf.slice(0, openIdx);
          inThinkBlock = true;
          thinkBuf = thinkBuf.slice(openIdx + "<think>".length);
        } else {
          const tail = Math.max(0, thinkBuf.length - "<think>".length + 1);
          out += thinkBuf.slice(0, tail);
          thinkBuf = thinkBuf.slice(tail);
          break;
        }
      }
    }
    return out;
  };
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
function extractSentences(text: string): { sentences: string[]; remainder: string } {
  const sentences: string[] = [];
  let i = 0;
  let segStart = 0;

  while (i < text.length) {
    const ch = text[i]!;

    if (ch === '!' || ch === '?') {
      // Consume run of consecutive !/?
      while (i + 1 < text.length && (text[i + 1] === '!' || text[i + 1] === '?')) i++;
      const s = text.slice(segStart, i + 1).trim();
      if (s.length >= 4) sentences.push(s);
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
        const shouldSplit = afterSpace === undefined || /[A-Z"'(\u2018\u201C]/.test(afterSpace);

        if (shouldSplit) {
          // Only split when word before the period is > 4 letters (not an abbreviation).
          // A ≤4-letter all-alpha word (Mr, Mrs, Dr, Prof, vs, etc.) is almost
          // certainly an abbreviation.  Digits/punctuation before "." mean we're
          // NOT in an abbreviation (e.g. "cost $1,200.50. Next…").
          // Non-Latin scripts (Tamil, Hindi etc.) won't match the Latin regex so
          // isAbbrev will be false — they always split correctly.
          const wordBefore = text.slice(segStart, i).match(/([A-Za-z]{1,4})$/)?.[1];
          const isAbbrev = wordBefore !== undefined; // matched = 1–4 letter suffix = abbreviation
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

  // Comma-clause fallback: keep TTS latency low on long list-heavy responses
  // with no sentence boundary yet.
  if (sentences.length === 0 && remainder.length >= 60) {
    const commaIdx = remainder.lastIndexOf(", ");
    if (commaIdx >= 30) {
      const clause = remainder.slice(0, commaIdx).trim();
      if (clause.length >= 8) {
        sentences.push(clause);
        remainder = remainder.slice(commaIdx + 2);
      }
    }
  }

  return { sentences, remainder };
}
