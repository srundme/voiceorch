import { createSTTAdapter } from "./adapters/stt/index.js";
import { createLLMAdapter } from "./adapters/llm/index.js";
import { createTTSAdapter } from "./adapters/tts/index.js";
import { encodeMulaw, upsample8to16, downsample16to8, decodeMulaw, hasSpeechEnergy } from "./audio.js";
import { processAudioIn, processRawPcm8kIn, destroyAudioSession } from "./audioPool.js";
import { RecordingBuffer } from "./recorder.js";
import type { AudioProcessResult } from "./audioPool.js";
import type { AgentConfig, AgentTool, ConversationTurn, SessionConfig, StreamSTT, ToolDefinition } from "./types.js";
import { detectCallerGender, applyCallerSalutation, buildGenderInstruction } from "./genderDetection.js";
import { retrieveKbContext } from "./kb-retrieval.js";
import { logger } from "../lib/logger.js";
import { format, addMinutes } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { db, bookingsTable, eventTypesTable, schedulingCalendarsTable, agentsTable } from "@workspace/db";
import { eq, and, or, sql } from "drizzle-orm";
import { getAvailableSlots } from "../services/scheduling/slot-engine.js";
import type { TimeSlot } from "../services/scheduling/slot-engine.js";
import { buildSlotLockKey } from "../services/scheduling/lock.js";
import { sendBookingCreatedEmail, sendBookingCancelledEmail, sendBookingRescheduledEmail } from "../services/scheduling/notifications.js";
import { dispatchSchedulingWebhooks } from "../routes/scheduling/webhooks.js";

const VAD_SILENCE_MS          = 250;    // silence window before STT flush
const MIN_SPEECH_BYTES        = 3200;   // ~200ms @ 8kHz PCM — skip noise bursts shorter than this
const CHUNK_SIZE_MULAW        = 160;    // 20ms @ 8kHz mulaw for paced batch playback
const VAD_THRESHOLD           = 100;    // RMS threshold for speech detection
const STREAM_ACCUM_BYTES      = 640;    // 20ms of 16kHz PCM before forwarding a TTS stream chunk
const HANDOFF_SILENCE_MS      = 3000;   // sustained silence that may indicate a phone handoff
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

export class OrchestrationPipeline {
  private config: SessionConfig;
  private agent: AgentConfig;
  private stt: ReturnType<typeof createSTTAdapter>;
  private llm: ReturnType<typeof createLLMAdapter>;
  private tts: ReturnType<typeof createTTSAdapter>;

  private audioBuffer: Buffer[] = [];
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private silenceHangupTimer: ReturnType<typeof setTimeout> | null = null;
  private handoffSilenceTimer: ReturnType<typeof setTimeout> | null = null;
  private isProcessing = false;

  // Barge-in state
  private isPlaying = false;
  private bargeInRequested = false;
  private bargeInCallback: (() => void) | null;
  // Require N consecutive speech frames before triggering barge-in to avoid
  // ambient noise / single-word false positives stopping the agent mid-sentence.
  private bargeInSpeechFrames = 0;
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
  private pendingTranscript: string | null = null;
  private streamSTTReconnectAttempts = 0;
  private streamSTTReconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Metrics
  private firstAudioSentAt: number | null = null;

  // Recording — stereo WAV of both sides (caller=L, agent=R)
  private recording = new RecordingBuffer(8000);

  private conversationHistory: ConversationTurn[] = [];
  private closed = false;

  // Gender detection
  // We accumulate the first ~1 s of caller PCM (16 000 bytes @ 8 kHz 16-bit),
  // detect once, then resolve {caller_salutation} in the system prompt.
  private readonly GENDER_MIN_BYTES = 16000;
  private readonly originalSystemPrompt: string;   // never mutated — used to restore on handoff
  private genderDetected = false;
  private genderAudioAccum: Buffer[] = [];
  private genderAudioBytes = 0;
  private genderDetectPromise: Promise<void> | null = null;

  constructor(config: SessionConfig) {
    this.config = config;
    this.agent = config.agentConfig;
    this.originalSystemPrompt = config.agentConfig.systemPrompt ?? "";
    this.bargeInCallback = config.onBargeIn ?? null;
    // P1-D: Per-agent VAD / barge-in tuning
    this.vadSilenceMs           = config.agentConfig.vadSilenceMs;
    this.bargeInEnabled         = config.agentConfig.bargeInEnabled;
    this.bargeInEnergyThreshold = config.agentConfig.bargeInEnergyThreshold;
    this.bargeInMinFrames       = config.agentConfig.bargeInMinFrames;
    this.bargeInEchoGraceMs     = config.agentConfig.bargeInEchoGraceMs;

    const keys = config.providerKeys;

    const sttKey = keys.get(this.agent.asrProvider);
    if (!sttKey) throw new Error(`No API key found for STT provider: ${this.agent.asrProvider}`);

    const llmKey = keys.get(this.agent.llmProvider);
    if (!llmKey) throw new Error(`No API key found for LLM provider: ${this.agent.llmProvider}`);

    const ttsKey = keys.get(this.agent.ttsProvider);
    if (!ttsKey) throw new Error(`No API key found for TTS provider: ${this.agent.ttsProvider}`);

    this.stt = createSTTAdapter(
      this.agent.asrProvider, sttKey, this.agent.asrModel,
      keys.get(`${this.agent.asrProvider}:extraConfig`) ?? null,
      this.agent.sttConfig
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
        (text, isFinal) => {
          if (!isFinal || !text.trim() || this.closed) return;
          this.streamSTTReconnectAttempts = 0; // reset backoff on successful transcript
          this.resetHangupTimer();
          void this.handleStreamingTranscript(text);
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
      logger.info({ callId: this.config.callId }, "Streaming STT initialized (Deepgram)");
    } catch (err) {
      logger.error({ callId: this.config.callId, err }, "Streaming STT init failed — falling back to batch");
    }
  }

  /**
   * Called by the streaming STT callback when a final transcript arrives.
   * Handles barge-in detection and queuing if a turn is already in progress.
   */
  private async handleStreamingTranscript(transcript: string): Promise<void> {
    if (this.isPlaying) {
      this.bargeInRequested = true;
      this.bargeInCallback?.();
      logger.info({ callId: this.config.callId }, "Barge-in detected (streaming STT)");
    }

    if (this.isProcessing) {
      this.pendingTranscript = transcript;
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
        void this.handleStreamingTranscript(pending);
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
    // Accumulate raw (pre-noise-cancellation) PCM for gender detection so the
    // 300 Hz bandpass highpass in NoiseCanceller does not strip female
    // fundamentals (165–255 Hz).  Skip while the agent is playing TTS to
    // avoid mis-classifying echo of the agent's own voice.
    if (this.agent.genderDetectionEnabled && !this.genderDetected && !this.isPlaying) {
      this.accumulateGenderAudio(pcm8k);
    }
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
    // Same as onAudioIn: accumulate raw PCM before noise-cancellation and
    // skip while the agent is speaking to prevent echo misclassification.
    if (this.agent.genderDetectionEnabled && !this.genderDetected && !this.isPlaying) {
      this.accumulateGenderAudio(pcm8k);
    }
    processRawPcm8kIn(callId, pcm8k, this.agent.noiseCancellationEnabled)
      .then((result) => this.handleProcessedAudio(result))
      .catch((err) => logger.error({ callId: this.config.callId, err }, "Audio worker error (pcm8k)"));
  }

  /** Returns the recording buffer so the caller (session.ts) can finalize it at call end. */
  getRecording(): RecordingBuffer {
    return this.recording;
  }

  // ── Gender detection ────────────────────────────────────────────────────────

  /**
   * Accumulate caller PCM audio until we have enough to estimate pitch (~1 s),
   * then trigger an async detection.  Safe to call on every audio chunk.
   */
  private accumulateGenderAudio(pcm8k: Buffer): void {
    if (!this.agent.genderDetectionEnabled || this.genderDetected) return;
    // Skip silent/background frames — only voiced speech carries pitch information.
    if (!hasSpeechEnergy(pcm8k)) return;
    this.genderAudioAccum.push(pcm8k);
    this.genderAudioBytes += pcm8k.length;
    if (this.genderAudioBytes >= this.GENDER_MIN_BYTES && !this.genderDetectPromise) {
      const combined = Buffer.concat(this.genderAudioAccum);
      this.genderAudioAccum = [];   // free memory
      this.genderDetectPromise = this.detectGenderAsync(combined).finally(() => {
        this.genderDetectPromise = null;
      });
    }
  }

  // ── Gender handoff detection ─────────────────────────────────────────────

  /**
   * Reset gender detection state so the next speech chunk re-runs the detector.
   * Restores the system prompt to the original template (with {caller_salutation}
   * placeholder intact) so the new detection can patch it again.
   */
  private resetGenderDetection(): void {
    this.genderDetected       = false;
    this.genderAudioAccum     = [];
    this.genderAudioBytes     = 0;
    this.genderDetectPromise  = null;
    this.agent.systemPrompt   = this.originalSystemPrompt;
    logger.info({ callId: this.config.callId }, "Gender detection reset — possible phone handoff");
  }

  /**
   * Start (or restart) a timer that resets gender detection after HANDOFF_SILENCE_MS
   * of continuous silence — a long quiet gap strongly suggests a phone was passed.
   * Only arms itself when gender detection has already fired (no point resetting
   * before we ever detected anything).
   */
  private resetHandoffSilenceTimer(): void {
    if (!this.agent.genderDetectionEnabled) return;
    if (this.handoffSilenceTimer) clearTimeout(this.handoffSilenceTimer);
    this.handoffSilenceTimer = setTimeout(() => {
      this.handoffSilenceTimer = null;
      if (!this.closed && this.genderDetected) {
        this.resetGenderDetection();
      }
    }, HANDOFF_SILENCE_MS);
  }

  /** Cancel the handoff silence timer (called on any incoming speech). */
  private stopHandoffSilenceTimer(): void {
    if (this.handoffSilenceTimer) {
      clearTimeout(this.handoffSilenceTimer);
      this.handoffSilenceTimer = null;
    }
  }

  /**
   * Returns the system prompt with any remaining {caller_salutation} placeholders
   * replaced by the neutral salutation. This is the safe fallback for LLM calls
   * that happen before gender detection has completed (e.g. short first utterances).
   * Once gender detection runs, it mutates this.agent.systemPrompt directly so the
   * placeholder is already gone and this becomes a no-op.
   */
  private resolvedSystemPrompt(): string {
    if (!this.genderDetected) {
      return applyCallerSalutation(this.agent.systemPrompt, this.agent.genderDetectionNeutralSalutation || "");
    }
    return this.agent.systemPrompt;
  }

  /** Run the detection, resolve the system prompt, log the result. */
  private async detectGenderAsync(pcm8k: Buffer): Promise<void> {
    try {
      const salutation = await detectCallerGender(pcm8k, {
        provider: this.agent.genderDetectionProvider,
        maleSalutation: this.agent.genderDetectionMaleSalutation,
        femaleSalutation: this.agent.genderDetectionFemaleSalutation,
        neutralSalutation: this.agent.genderDetectionNeutralSalutation,
        providerKeys: this.config.providerKeys,
        callId: this.config.callId,
      });

      // Patch the live system prompt:
      // 1. Replace every {caller_salutation} placeholder with the resolved word.
      // 2. Prepend a short, high-priority instruction block so the LLM actually
      //    uses the salutation in spoken output (passive placeholder replacement
      //    alone is often not enough to make the model say it out loud).
      const patched = applyCallerSalutation(this.agent.systemPrompt, salutation);
      this.agent.systemPrompt = buildGenderInstruction(salutation) + patched;
      this.genderDetected = true;
      logger.info(
        { callId: this.config.callId, salutation },
        "Gender detection complete — system prompt updated"
      );
    } catch (err) {
      logger.warn({ callId: this.config.callId, err }, "detectGenderAsync failed");
    }
  }

  /** Handles pre-processed audio returned by the audio worker pool. */
  private handleProcessedAudio({ pcm8k, pcm16k, hasSpeech }: AudioProcessResult): void {
    if (this.closed) return;

    // Gender audio is now accumulated in onAudioIn / onRawPcm8kIn from raw
    // (pre-noise-cancellation) PCM so the bandpass filter does not strip
    // female fundamentals.  Here we only manage the handoff-silence timer.
    if (hasSpeech) {
      this.stopHandoffSilenceTimer();
    } else {
      this.resetHandoffSilenceTimer();
    }

    // Streaming STT path: feed all audio directly to Deepgram — no local VAD needed
    if (this.streamSTT) {
      this.streamSTT.sendAudio(pcm16k);
      return;
    }

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
          if (this.bargeInSpeechFrames >= this.bargeInMinFrames) {
            this.bargeInRequested = true;
            this.bargeInCallback?.();
            this.audioBuffer = [];
            logger.info({ callId: this.config.callId, frames: this.bargeInSpeechFrames }, "Barge-in detected (batch STT)");
          }
        } else {
          this.bargeInSpeechFrames = 0; // dropped below barge-in threshold — reset
        }
      }
    } else {
      this.bargeInSpeechFrames = 0; // silence resets the run
    }

    if (this.isProcessing) return;

    if (hasSpeech) {
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
    this.isProcessing = true;
    try {
      let greeting = this.agent.greetingMessage ?? "";

      if (!greeting.trim()) {
        // Fallback: ask the LLM to generate an opener
        await this.llm.chat(
          [], this.resolvedSystemPrompt(),
          (token) => { greeting += token; },
          (full)  => { greeting = full; }
        );
        // Strip any <think>…</think> reasoning blocks that reasoning models emit
        greeting = greeting.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      }

      // {caller_salutation} in the greeting fires before any caller audio arrives,
      // so gender detection hasn't run yet. Use the neutral salutation as fallback.
      // The system prompt placeholder is handled separately once audio is heard.
      greeting = applyCallerSalutation(greeting, this.agent.genderDetectionNeutralSalutation || "");

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
            this.config.onAudioOut(chunk);
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
        const mulaw = encodeMulaw(pcm8k);
        for (let i = 0; i < mulaw.length; i += CHUNK_SIZE_MULAW) {
          queue.push(mulaw.slice(i, i + CHUNK_SIZE_MULAW));
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
          flush,
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

      flush(); // flush any leftover accumulator bytes after stream ends / aborts

      ttsDone = true;
      await drainPromise;
    } else {
      const ttsPcm16k = await this.tts.synthesize(text);
      if (this.bargeInRequested) return;
      const ttsPcm8k  = downsample16to8(ttsPcm16k);
      // Record agent audio
      this.recording.addAgentChunk(ttsPcm8k);
      const ttsMusaw  = encodeMulaw(ttsPcm8k);
      for (let i = 0; i < ttsMusaw.length; i += CHUNK_SIZE_MULAW) {
        if (this.closed || this.bargeInRequested) break;
        if (!this.firstAudioSentAt) this.firstAudioSentAt = Date.now();
        this.config.onAudioOut(ttsMusaw.slice(i, i + CHUNK_SIZE_MULAW));
        await new Promise<void>((r) => setTimeout(r, 20));
      }
    }
  }

  // ── Tool execution ───────────────────────────────────────────────────────────

  private async handleToolCall(toolName: string, args: Record<string, unknown>): Promise<string | undefined> {
    const tool = this.agent.tools.find((t) => t.name === toolName);
    if (!tool) {
      logger.warn({ callId: this.config.callId, toolName }, "LLM called unknown tool — ignoring");
      return undefined;
    }

    logger.info({ callId: this.config.callId, toolName, toolType: tool.type, args }, "Tool invoked by LLM");

    if (tool.type === "call_transfer") {
      await this.executeCallTransfer(tool, args);
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
    }
    return undefined;
  }

  private async executeWebhookTool(tool: AgentTool & { type: "webhook" }, args: Record<string, unknown>): Promise<void> {
    logger.info({ callId: this.config.callId, url: tool.url, method: tool.method }, "Executing webhook tool");
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(tool.headers ?? {}),
      };
      if (tool.secret) headers["X-Webhook-Secret"] = tool.secret;

      const resp = await fetch(tool.url, {
        method: tool.method,
        headers,
        body: tool.method === "POST"
          ? JSON.stringify({ callId: this.config.callId, toolName: tool.name, args })
          : undefined,
        signal: AbortSignal.timeout(8000),
      });

      if (!resp.ok) {
        logger.warn({ callId: this.config.callId, url: tool.url, status: resp.status }, "Webhook tool returned non-OK status");
      } else {
        logger.info({ callId: this.config.callId, url: tool.url, status: resp.status }, "Webhook tool executed successfully");
      }
    } catch (err) {
      logger.error({ callId: this.config.callId, url: tool.url, err }, "Webhook tool execution failed");
    }
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
    if (tool.goodbyeMessage?.trim()) {
      await this.speakRaw(tool.goodbyeMessage);
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
    logger.info({ callId: this.config.callId, transferTo: tool.transferTo }, "Executing call transfer");

    // Speak the warm handoff message (if configured) before transferring
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

    // Notify session layer (triggers telephony transfer + marks call as transferred)
    this.config.onCallTransfer?.(tool.transferTo);
    this.config.onCallEnd();
  }

  // ── Core turn logic ───────────────────────────────────────────────────────────

  private async processTurn(transcript: string, sttLatencyMs: number): Promise<void> {
    this.bargeInRequested = false;
    this.bargeInSpeechFrames = 0;
    this.firstAudioSentAt = null;

    // If gender detection is running concurrently, wait for it to finish so the
    // system prompt is fully resolved before the LLM receives the first turn.
    if (this.genderDetectPromise) {
      await this.genderDetectPromise;
    }

    logger.info({ callId: this.config.callId, transcript, sttLatencyMs }, "Processing turn");
    this.config.onTranscript("user", transcript);
    this.conversationHistory.push({ role: "user", content: transcript });

    // ── End-call phrase detection ──
    if (this.agent.endCallPhrases.length > 0) {
      const lower = transcript.toLowerCase();
      if (this.agent.endCallPhrases.some(p => lower.includes(p.toLowerCase()))) {
        logger.info({ callId: this.config.callId, transcript }, "End-call phrase detected — hanging up");
        this.config.onCallEnd();
        return;
      }
    }

    // ── Phone-handoff phrase detection (Signal 1: transcript keyword) ──
    if (this.agent.genderDetectionEnabled && this.genderDetected) {
      const lower = transcript.toLowerCase();
      if (HANDOFF_PHRASES.some(p => lower.includes(p))) {
        logger.info({ callId: this.config.callId, transcript }, "Handoff phrase detected — resetting gender detection");
        this.resetGenderDetection();
      }
    }

    // ── Backchanneling: short acknowledgement while LLM thinks ──
    if (this.agent.backchannelingEnabled && !this.closed && !this.bargeInRequested) {
      const freq = this.agent.backchannelingFrequency ?? 0.5;
      if (Math.random() < freq) {
        const phrase = BACKCHANNEL_PHRASES[Math.floor(Math.random() * BACKCHANNEL_PHRASES.length)]!;
        this.bargeInHoldUntil = Date.now() + this.bargeInEchoGraceMs;
      this.isPlaying = true;
        try {
          await this.playSentence(phrase);
        } catch (err) {
          logger.error({ callId: this.config.callId, err }, "Backchannel TTS error");
        } finally {
          this.isPlaying = false;
        }
      }
    }

    // ── Build tool definitions from agent config ──
    const toolDefs: ToolDefinition[] = this.agent.tools.map((t): ToolDefinition => {
      if (t.type === "native_booking") {
        return {
          name: t.name,
          description: t.description,
          parameters: {
            type: "object",
            properties: {
              attendee_name:  { type: "string", description: "Full name of the person being booked" },
              attendee_email: { type: "string", description: "Email address of the person being booked" },
              preferred_date: { type: "string", description: "Optional preferred date or time of day for the appointment, e.g. 'next Tuesday', '2025-06-10', 'morning', or 'afternoon'. The system will find the first available slot on or after this date/time." },
            },
            required: ["attendee_name", "attendee_email"],
          },
        };
      }
      if (t.type === "native_reschedule") {
        return {
          name: t.name,
          description: t.description,
          parameters: {
            type: "object",
            properties: {
              booking_id:     { type: "string", description: "The booking reference ID to reschedule" },
              preferred_date: { type: "string", description: "Optional preferred date/time for the new slot, e.g. 'next Tuesday' or '2025-06-10T14:00'" },
            },
            required: ["booking_id"],
          },
        };
      }
      if (t.type === "native_cancel") {
        return {
          name: t.name,
          description: t.description,
          parameters: {
            type: "object",
            properties: {
              booking_id: { type: "string", description: "The booking reference ID to cancel" },
            },
            required: ["booking_id"],
          },
        };
      }
      return {
        name: t.name,
        description: t.description,
        parameters: {
          type: "object",
          properties: {
            reason: { type: "string", description: "Brief reason for invoking this tool" },
          },
          required: [],
        },
      };
    });

    const llmStart = Date.now();
    let llmFirstTokenAt: number | null = null;

    let llmResponse = "";
    let pendingText  = "";
    let allEnqueued  = false;
    let triggeredToolName: string | null = null;
    let triggeredToolArgs: Record<string, unknown> = {};

    // ── Think-block filter (streaming) ───────────────────────────────────────
    // Reasoning models (DeepSeek-R1, Sarvam, etc.) emit <think>…</think> blocks
    // before their answer.  We must strip these from the TTS stream so the agent
    // doesn't read the internal reasoning out loud.
    //
    // State machine: track whether the current token position is inside a think
    // block.  Tokens may straddle the <think> / </think> boundary so we handle
    // partial tags correctly.
    let inThinkBlock = false;
    let thinkBuf = "";  // accumulates partial tag characters so we can detect straddled boundaries

    /**
     * Filters one streaming token: removes any <think>…</think> content.
     * Returns the portion of the token that should flow to TTS / pendingText.
     */
    function filterThinkToken(token: string): string {
      // Append to tag-detection buffer
      thinkBuf += token;
      let out = "";

      while (thinkBuf.length > 0) {
        if (inThinkBlock) {
          // Looking for closing tag
          const closeIdx = thinkBuf.indexOf("</think>");
          if (closeIdx !== -1) {
            inThinkBlock = false;
            thinkBuf = thinkBuf.slice(closeIdx + "</think>".length);
          } else {
            // Might be a partial </think — keep tail in buffer, discard rest
            const tail = Math.max(0, thinkBuf.length - "</think>".length + 1);
            thinkBuf = thinkBuf.slice(tail); // keep only potential partial tag
            break;
          }
        } else {
          // Looking for opening tag
          const openIdx = thinkBuf.indexOf("<think>");
          if (openIdx !== -1) {
            out += thinkBuf.slice(0, openIdx);
            inThinkBlock = true;
            thinkBuf = thinkBuf.slice(openIdx + "<think>".length);
          } else {
            // Might be a partial <think — keep tail, flush safe prefix
            const tail = Math.max(0, thinkBuf.length - "<think>".length + 1);
            out += thinkBuf.slice(0, tail);
            thinkBuf = thinkBuf.slice(tail);
            break;
          }
        }
      }
      return out;
    }

    const sentenceQueue: string[] = [];
    let wakePlayer: (() => void) | null = null;

    const enqueue = (text: string): void => {
      sentenceQueue.push(text);
      if (wakePlayer) {
        const wake = wakePlayer;
        wakePlayer = null;
        wake();
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
            logger.error({ callId: this.config.callId, err, text: text.slice(0, 40) }, "TTS error");
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

    // P1-B: KB context injection — retrieve semantically relevant chunks before LLM call
    let systemPromptForTurn = this.resolvedSystemPrompt();
    if (this.agent.knowledgeBaseId) {
      const openaiKey = this.config.providerKeys.get("openai");
      if (openaiKey) {
        try {
          const kbContext = await retrieveKbContext(this.agent.knowledgeBaseId, transcript, openaiKey);
          if (kbContext) {
            systemPromptForTurn =
              `${systemPromptForTurn}\n\n## Relevant Knowledge Base Context\n\n${kbContext}`;
          }
        } catch (err) {
          logger.warn({ callId: this.config.callId, err }, "KB retrieval failed — continuing without context");
        }
      }
    }

    await this.llm.chat(
      this.conversationHistory,
      systemPromptForTurn,
      (token) => {
        if (!llmFirstTokenAt) llmFirstTokenAt = Date.now();
        llmResponse += token;                  // keep raw response (incl. think blocks)
        const filtered = filterThinkToken(token);
        if (!filtered) return;                 // token was entirely inside a think block
        pendingText += filtered;
        const { sentences, remainder } = extractSentences(pendingText);
        for (const s of sentences) enqueue(s);
        pendingText = remainder;
      },
      async (fullText) => { llmResponse = fullText; },
      toolDefs.length > 0
        ? {
            tools: toolDefs,
            onToolCall: (name, args) => {
              triggeredToolName = name;
              triggeredToolArgs = args;
            },
          }
        : undefined
    );

    // ── If LLM called a tool, execute it and skip TTS ──
    if (triggeredToolName) {
      allEnqueued = true;
      const finalWake = wakePlayer as (() => void) | null;
      wakePlayer = null;
      if (finalWake) finalWake();
      await playPromise;
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

    // Strip any think blocks from the stored response so they don't appear in
    // the transcript UI or pollute the conversation history for future turns.
    const cleanResponse = llmResponse.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    this.conversationHistory.push({ role: "assistant", content: cleanResponse });
    this.config.onTranscript("agent", cleanResponse);
    this.config.onConversationUpdate?.(this.conversationHistory);

    await playPromise;

    const llmLatencyMs = llmFirstTokenAt ? llmFirstTokenAt - llmStart : Date.now() - llmStart;
    const ttsFirstChunkMs = this.firstAudioSentAt ? this.firstAudioSentAt - llmStart : 0;
    logger.info(
      { callId: this.config.callId, sttLatencyMs, llmLatencyMs, ttsFirstChunkMs },
      "Turn metrics"
    );
    this.config.onMetrics?.({ sttLatencyMs, llmLatencyMs, ttsFirstChunkMs });
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
      const transcript = await this.stt.transcribe(pcm16k, 16000);
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

  getTranscript(): string {
    return this.conversationHistory
      .map((t) => `${t.role === "user" ? "Caller" : "Agent"}: ${t.content}`)
      .join("\n");
  }

  /** P2-A: Execute a native booking and return a structured result string for LLM consumption. */
  private async executeNativeBooking(tool: AgentTool & { type: "native_booking" }, args: Record<string, unknown>): Promise<string> {
    logger.info({ callId: this.config.callId, eventTypeId: tool.eventTypeId }, "Native booking tool invoked");
    const attendeeName  = String(args["attendee_name"]  ?? args["name"]  ?? "Guest");
    const attendeeEmail = String(args["attendee_email"] ?? args["email"] ?? "");
    const preferredRaw  = args["preferred_date"] != null ? String(args["preferred_date"]) : null;

    if (!attendeeEmail) {
      logger.warn({ callId: this.config.callId }, "Native booking: no attendee email — cannot book");
      return "error: attendee_email is required to complete the booking";
    }

    try {
      // ── Authorization: resolve the owning userId for this agent ──
      const [agentCalendar] = await db
        .select({ userId: schedulingCalendarsTable.userId })
        .from(schedulingCalendarsTable)
        .where(eq(schedulingCalendarsTable.agentId, this.agent.id));
      let authorizedUserId: string | null = null;
      if (agentCalendar) {
        authorizedUserId = agentCalendar.userId;
      } else {
        const [agentRow] = await db
          .select({ userId: agentsTable.userId })
          .from(agentsTable)
          .where(eq(agentsTable.id, this.agent.id));
        authorizedUserId = agentRow?.userId ?? null;
      }

      const [eventType] = await db.select().from(eventTypesTable).where(eq(eventTypesTable.id, tool.eventTypeId));
      if (!eventType || !eventType.isActive) {
        return "error: the appointment type is unavailable";
      }

      const [calendar] = await db.select().from(schedulingCalendarsTable).where(eq(schedulingCalendarsTable.id, eventType.calendarId));
      if (!calendar || !calendar.isActive) {
        return "error: the calendar is unavailable";
      }

      // ── Ownership check: event type calendar must belong to this agent's user ──
      if (authorizedUserId && calendar.userId !== authorizedUserId) {
        logger.warn({ callId: this.config.callId, eventTypeId: tool.eventTypeId, authorizedUserId, calendarUserId: calendar.userId }, "Native booking: event type ownership mismatch — rejected");
        return "error: the appointment type is unavailable";
      }

      // ── Resolve search window from optional preferred_date ──
      const { searchStart, minSlotStart, timeFilter } = preferredRaw
        ? parsePreferredDate(preferredRaw, calendar.timezone)
        : { searchStart: new Date(), minSlotStart: undefined, timeFilter: undefined };
      if (preferredRaw) {
        logger.info({ callId: this.config.callId, preferredRaw, searchStart, minSlotStart }, "Native booking: preferred date resolved");
      }
      const searchEnd  = new Date(searchStart.getTime() + 7 * 24 * 60 * 60 * 1000);
      let slots        = await getAvailableSlots(tool.eventTypeId, format(searchStart, "yyyy-MM-dd"), format(searchEnd, "yyyy-MM-dd"));
      if (minSlotStart) slots = slots.filter(s => s.slotStart >= minSlotStart);
      if (timeFilter)   slots = slots.filter(timeFilter);
      if (slots.length === 0) {
        const rangeDesc = preferredRaw ? `on or after "${preferredRaw}"` : "in the next 7 days";
        logger.info({ callId: this.config.callId, eventTypeId: tool.eventTypeId }, `Native booking: no available slots ${rangeDesc}`);
        return `error: no available slots ${rangeDesc}`;
      }

      const slot      = slots[0]!;
      const slotStart = slot.slotStart;
      const slotEnd   = slot.slotEnd;
      const lockKey   = buildSlotLockKey(calendar.id, slotStart);

      let booking: typeof bookingsTable.$inferSelect | undefined;
      let lockConflict = false;

      await db.transaction(async (tx) => {
        const lockResult = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS acquired`);
        const acquired = (lockResult.rows[0] as any)?.acquired === true;
        if (!acquired) { lockConflict = true; return; }

        const bufBefore = addMinutes(slotStart, -eventType.bufferBeforeMins);
        const bufAfter  = addMinutes(slotEnd,   eventType.bufferAfterMins);

        const overlapCount = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(bookingsTable)
          .where(and(
            eq(bookingsTable.calendarId, calendar.id),
            or(eq(bookingsTable.status, "pending"), eq(bookingsTable.status, "confirmed")),
            sql`${bookingsTable.slotStart} < ${bufAfter}`,
            sql`${bookingsTable.slotEnd} > ${bufBefore}`,
          ))
          .then(r => r[0]?.count ?? 0);

        const exactOverlapCount = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(bookingsTable)
          .where(and(
            eq(bookingsTable.calendarId, calendar.id),
            or(eq(bookingsTable.status, "pending"), eq(bookingsTable.status, "confirmed")),
            sql`${bookingsTable.slotStart} < ${slotEnd}`,
            sql`${bookingsTable.slotEnd} > ${slotStart}`,
          ))
          .then(r => r[0]?.count ?? 0);

        if (exactOverlapCount >= eventType.maxBookingsPerSlot || overlapCount > exactOverlapCount) {
          lockConflict = true; return;
        }

        const [inserted] = await tx.insert(bookingsTable).values({
          eventTypeId: eventType.id,
          calendarId:  calendar.id,
          callId:      this.config.callId,
          userId:      calendar.userId,
          attendeeName,
          attendeeEmail,
          attendeeNotes: null,
          slotStart,
          slotEnd,
          status:    eventType.confirmationMode === "instant" ? "confirmed" : "pending",
          bookedVia: "agent",
        }).returning();
        booking = inserted;
      });

      if (lockConflict || !booking) {
        logger.warn({ callId: this.config.callId }, "Native booking: slot conflict");
        return "error: slot was just taken — no booking created";
      }

      const dateStr = format(slotStart, "EEEE, MMMM do 'at' h:mm a");
      logger.info({ callId: this.config.callId, bookingId: booking.id, slotStart, attendeeEmail }, "Native booking created");

      void sendBookingCreatedEmail({
        attendeeName:  booking.attendeeName,
        attendeeEmail: booking.attendeeEmail,
        eventTypeName: eventType.name,
        slotStart:     booking.slotStart,
        slotEnd:       booking.slotEnd,
        timezone:      calendar.timezone,
        bookingId:     booking.id,
        notes:         booking.attendeeNotes,
      });
      void dispatchSchedulingWebhooks(calendar.userId, "scheduling.booking.created", {
        booking: {
          ...booking,
          slotStart:   booking.slotStart.toISOString(),
          slotEnd:     booking.slotEnd.toISOString(),
          cancelledAt: booking.cancelledAt?.toISOString() ?? null,
          createdAt:   booking.createdAt.toISOString(),
          updatedAt:   booking.updatedAt.toISOString(),
        },
      });

      return `booking_confirmed: event="${eventType.name}", slot="${dateStr}", booking_id=${booking.id}, attendee="${attendeeName}", email="${attendeeEmail}", status="${booking.status}"`;
    } catch (err) {
      logger.error({ callId: this.config.callId, err }, "Native booking tool execution failed");
      return "error: booking failed due to a technical issue";
    }
  }

  private async executeNativeReschedule(tool: AgentTool & { type: "native_reschedule" }, args: Record<string, unknown>): Promise<string> {
    logger.info({ callId: this.config.callId }, "Native reschedule tool invoked");
    const bookingId    = Number(args["booking_id"] ?? args["bookingId"] ?? 0);
    const preferredRaw = args["preferred_date"] != null ? String(args["preferred_date"]) : null;
    if (!bookingId) {
      return "error: booking_id is required to reschedule";
    }

    try {
      // ── Authorization: resolve the owning userId for this agent ──
      const [agentCalendar] = await db
        .select({ userId: schedulingCalendarsTable.userId })
        .from(schedulingCalendarsTable)
        .where(eq(schedulingCalendarsTable.agentId, this.agent.id));
      let authorizedUserId: string | null = null;
      if (agentCalendar) {
        authorizedUserId = agentCalendar.userId;
      } else {
        const [agentRow] = await db
          .select({ userId: agentsTable.userId })
          .from(agentsTable)
          .where(eq(agentsTable.id, this.agent.id));
        authorizedUserId = agentRow?.userId ?? null;
      }

      const [existing] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId));
      if (!existing || existing.status === "cancelled") {
        return `error: no active booking found with reference ${bookingId}`;
      }

      // ── Ownership check ──
      if (authorizedUserId && existing.userId !== authorizedUserId) {
        logger.warn({ callId: this.config.callId, bookingId, authorizedUserId, bookingUserId: existing.userId }, "Native reschedule: ownership mismatch — rejected");
        return `error: no active booking found with reference ${bookingId}`;
      }

      const [eventType] = await db.select().from(eventTypesTable).where(eq(eventTypesTable.id, existing.eventTypeId));
      if (!eventType) {
        return "error: appointment type not found for this booking";
      }

      const [calendar] = await db.select().from(schedulingCalendarsTable).where(eq(schedulingCalendarsTable.id, existing.calendarId));
      if (!calendar || !calendar.isActive) {
        return "error: calendar is unavailable";
      }

      // ── Resolve preferred start date ──
      const { searchStart, minSlotStart, timeFilter } = preferredRaw
        ? parsePreferredDate(preferredRaw, calendar.timezone)
        : { searchStart: new Date(), minSlotStart: undefined, timeFilter: undefined };
      if (preferredRaw) {
        logger.info({ callId: this.config.callId, preferredRaw, searchStart, minSlotStart }, "Native reschedule: preferred date resolved");
      }
      const searchEnd     = new Date(searchStart.getTime() + 7 * 24 * 60 * 60 * 1000);
      let slots           = await getAvailableSlots(eventType.id, format(searchStart, "yyyy-MM-dd"), format(searchEnd, "yyyy-MM-dd"));
      if (minSlotStart) slots = slots.filter(s => s.slotStart >= minSlotStart);
      if (timeFilter)   slots = slots.filter(timeFilter);
      const filteredSlots = slots.filter(s => s.slotStart.getTime() !== existing.slotStart.getTime());
      if (filteredSlots.length === 0) {
        const rangeDesc = preferredRaw ? `on or after "${preferredRaw}"` : "in the next 7 days";
        return `error: no other available slots ${rangeDesc}`;
      }

      const newSlot  = filteredSlots[0]!;
      const newStart = newSlot.slotStart;
      const newEnd   = newSlot.slotEnd;
      const lockKey  = buildSlotLockKey(calendar.id, newStart);
      let newBooking: typeof bookingsTable.$inferSelect | undefined;
      let lockConflict = false;

      await db.transaction(async (tx) => {
        const lockResult = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS acquired`);
        const acquired = (lockResult.rows[0] as any)?.acquired === true;
        if (!acquired) { lockConflict = true; return; }

        // ── Same overlap/capacity checks as public booking flow ──
        const bufBefore = addMinutes(newStart, -eventType.bufferBeforeMins);
        const bufAfter  = addMinutes(newEnd,    eventType.bufferAfterMins);

        const overlapCount = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(bookingsTable)
          .where(and(
            eq(bookingsTable.calendarId, calendar.id),
            or(eq(bookingsTable.status, "pending"), eq(bookingsTable.status, "confirmed")),
            sql`${bookingsTable.slotStart} < ${bufAfter}`,
            sql`${bookingsTable.slotEnd} > ${bufBefore}`,
          ))
          .then(r => r[0]?.count ?? 0);

        const exactOverlapCount = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(bookingsTable)
          .where(and(
            eq(bookingsTable.calendarId, calendar.id),
            or(eq(bookingsTable.status, "pending"), eq(bookingsTable.status, "confirmed")),
            sql`${bookingsTable.slotStart} < ${newEnd}`,
            sql`${bookingsTable.slotEnd} > ${newStart}`,
          ))
          .then(r => r[0]?.count ?? 0);

        if (exactOverlapCount >= eventType.maxBookingsPerSlot || overlapCount > exactOverlapCount) {
          lockConflict = true; return;
        }

        await tx.update(bookingsTable)
          .set({ status: "cancelled", cancelledAt: new Date() })
          .where(eq(bookingsTable.id, bookingId));

        const [inserted] = await tx.insert(bookingsTable).values({
          eventTypeId:       eventType.id,
          calendarId:        calendar.id,
          callId:            this.config.callId,
          userId:            calendar.userId,
          attendeeName:      existing.attendeeName,
          attendeeEmail:     existing.attendeeEmail,
          attendeeNotes:     existing.attendeeNotes,
          slotStart:         newStart,
          slotEnd:           newEnd,
          status:            eventType.confirmationMode === "instant" ? "confirmed" : "pending",
          bookedVia:         "agent",
          rescheduledFromId: bookingId,
        }).returning();
        newBooking = inserted;
      });

      if (lockConflict || !newBooking) {
        return "error: slot was just taken — reschedule failed";
      }

      const dateStr = format(newStart, "EEEE, MMMM do 'at' h:mm a");
      logger.info({ callId: this.config.callId, oldBookingId: bookingId, newBookingId: newBooking.id }, "Native reschedule complete");

      void sendBookingRescheduledEmail({
        attendeeName:  newBooking.attendeeName,
        attendeeEmail: newBooking.attendeeEmail,
        eventTypeName: eventType.name,
        slotStart:     newBooking.slotStart,
        slotEnd:       newBooking.slotEnd,
        timezone:      calendar.timezone,
        bookingId:     newBooking.id,
        notes:         newBooking.attendeeNotes,
        oldSlotStart:  existing.slotStart,
      });
      void dispatchSchedulingWebhooks(calendar.userId, "scheduling.booking.rescheduled", {
        booking: {
          ...newBooking,
          slotStart:   newBooking.slotStart.toISOString(),
          slotEnd:     newBooking.slotEnd.toISOString(),
          cancelledAt: newBooking.cancelledAt?.toISOString() ?? null,
          createdAt:   newBooking.createdAt.toISOString(),
          updatedAt:   newBooking.updatedAt.toISOString(),
        },
      });

      return `reschedule_confirmed: old_booking_id=${bookingId}, new_booking_id=${newBooking.id}, new_slot="${dateStr}", status="${newBooking.status}"`;
    } catch (err) {
      logger.error({ callId: this.config.callId, err }, "Native reschedule tool execution failed");
      return "error: reschedule failed due to a technical issue";
    }
  }

  private async executeNativeCancel(tool: AgentTool & { type: "native_cancel" }, args: Record<string, unknown>): Promise<string> {
    logger.info({ callId: this.config.callId }, "Native cancel tool invoked");
    const bookingId = Number(args["booking_id"] ?? args["bookingId"] ?? 0);
    if (!bookingId) {
      return "error: booking_id is required to cancel";
    }

    try {
      // ── Authorization: resolve the owning userId for this agent ──
      const [agentCalendar] = await db
        .select({ userId: schedulingCalendarsTable.userId })
        .from(schedulingCalendarsTable)
        .where(eq(schedulingCalendarsTable.agentId, this.agent.id));
      let authorizedUserId: string | null = null;
      if (agentCalendar) {
        authorizedUserId = agentCalendar.userId;
      } else {
        const [agentRow] = await db
          .select({ userId: agentsTable.userId })
          .from(agentsTable)
          .where(eq(agentsTable.id, this.agent.id));
        authorizedUserId = agentRow?.userId ?? null;
      }

      const [existing] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId));
      if (!existing) {
        return `error: no booking found with reference ${bookingId}`;
      }

      // ── Ownership check ──
      if (authorizedUserId && existing.userId !== authorizedUserId) {
        logger.warn({ callId: this.config.callId, bookingId, authorizedUserId, bookingUserId: existing.userId }, "Native cancel: ownership mismatch — rejected");
        return `error: no booking found with reference ${bookingId}`;
      }

      if (existing.status === "cancelled") {
        return `info: booking ${bookingId} was already cancelled`;
      }

      const [eventType] = await db.select().from(eventTypesTable).where(eq(eventTypesTable.id, existing.eventTypeId));
      const [calendar]  = await db.select().from(schedulingCalendarsTable).where(eq(schedulingCalendarsTable.id, existing.calendarId));

      const cancelledAt = new Date();
      await db.update(bookingsTable)
        .set({ status: "cancelled", cancelledAt })
        .where(eq(bookingsTable.id, bookingId));

      logger.info({ callId: this.config.callId, bookingId }, "Native cancel complete");

      if (eventType && calendar) {
        void sendBookingCancelledEmail({
          attendeeName:  existing.attendeeName,
          attendeeEmail: existing.attendeeEmail,
          eventTypeName: eventType.name,
          slotStart:     existing.slotStart,
          slotEnd:       existing.slotEnd,
          timezone:      calendar.timezone,
          bookingId:     existing.id,
          notes:         existing.attendeeNotes,
        });
        void dispatchSchedulingWebhooks(calendar.userId, "scheduling.booking.cancelled", {
          booking: {
            ...existing,
            status:      "cancelled",
            cancelledAt: cancelledAt.toISOString(),
            slotStart:   existing.slotStart.toISOString(),
            slotEnd:     existing.slotEnd.toISOString(),
            createdAt:   existing.createdAt.toISOString(),
            updatedAt:   existing.updatedAt.toISOString(),
          },
        });
      }

      return `cancellation_confirmed: booking_id=${bookingId}`;
    } catch (err) {
      logger.error({ callId: this.config.callId, err }, "Native cancel tool execution failed");
      return "error: cancellation failed due to a technical issue";
    }
  }

  /**
   * After a native scheduling tool executes, push its structured result to
   * conversation history and run a follow-up LLM turn so the agent responds
   * naturally to the caller based on the outcome.
   */
  private async continueWithToolResult(toolName: string, result: string): Promise<void> {
    this.conversationHistory.push({ role: "user", content: `[Tool result for ${toolName}]: ${result}` });

    let llmResponse = "";
    try {
      await this.llm.chat(
        this.conversationHistory,
        this.resolvedSystemPrompt(),
        () => {},
        async (fullText) => { llmResponse = fullText; },
      );
    } catch (err) {
      logger.error({ callId: this.config.callId, err }, "continueWithToolResult LLM call failed");
      return;
    }

    if (llmResponse.trim()) {
      const cleaned = llmResponse.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      this.conversationHistory.push({ role: "assistant", content: cleaned });
      this.config.onTranscript("agent", cleaned);
      this.config.onConversationUpdate?.(this.conversationHistory);
      await this.speakRaw(cleaned);
    }
  }

  async speakRaw(text: string): Promise<void> {
    if (!text.trim() || this.closed) return;
    await this.playSentence(text);
  }

  close(): void {
    this.closed = true;
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    if (this.silenceHangupTimer) {
      clearTimeout(this.silenceHangupTimer);
      this.silenceHangupTimer = null;
    }
    this.stopHandoffSilenceTimer();
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

/**
 * Parse a natural-language or ISO preferred date string into a concrete search
 * start date, an optional minimum slot start instant for time-precision, and an
 * optional time-of-day slot filter.
 *
 * @param raw  - The raw preferred_date value from the LLM tool call.
 * @param tz   - IANA timezone string of the calendar (e.g. "America/New_York").
 *               Used to interpret "morning"/"afternoon"/"evening" in local time.
 *               Falls back to UTC if omitted.
 *
 * Supported inputs:
 *   - ISO date strings:     "2025-06-10"          → search from that date
 *   - ISO datetime strings: "2025-06-10T14:00"    → search from that date AND
 *                                                    enforce slotStart ≥ parsed instant
 *   - "today", "tomorrow"
 *   - Weekday names: "tuesday", "next friday", "this monday"
 *   - Time of day: "morning" (before noon), "afternoon" (noon–5 pm), "evening" (5 pm+)
 *     Hours are compared in the calendar's local timezone.
 *
 * Falls back to `now` for any unrecognised input so booking always proceeds.
 */
function parsePreferredDate(
  raw: string,
  tz = "UTC",
): { searchStart: Date; minSlotStart?: Date; timeFilter?: (slot: TimeSlot) => boolean } {
  const now   = new Date();
  const lower = raw.trim().toLowerCase();

  // ── Time-of-day preferences (timezone-aware) ─────────────────────────────
  if (lower === "morning") {
    return {
      searchStart: now,
      timeFilter: (s) => toZonedTime(s.slotStart, tz).getHours() < 12,
    };
  }
  if (lower === "afternoon") {
    return {
      searchStart: now,
      timeFilter: (s) => {
        const h = toZonedTime(s.slotStart, tz).getHours();
        return h >= 12 && h < 17;
      },
    };
  }
  if (lower === "evening") {
    return {
      searchStart: now,
      timeFilter: (s) => toZonedTime(s.slotStart, tz).getHours() >= 17,
    };
  }

  // ── Relative day references ──────────────────────────────────────────────
  if (lower === "today") {
    return { searchStart: now };
  }
  if (lower === "tomorrow") {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(0, 0, 0, 0);
    return { searchStart: d };
  }

  // ── Weekday names: "tuesday", "next friday", "this monday" ───────────────
  const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const dayMatch  = lower.match(/^(?:(next|this)\s+)?(\w+)$/);
  if (dayMatch) {
    const modifier = dayMatch[1];  // "next" | "this" | undefined
    const dayName  = dayMatch[2]!;
    const dayIdx   = DAY_NAMES.indexOf(dayName);
    if (dayIdx !== -1) {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      const currentDay = d.getDay();
      let daysAhead    = dayIdx - currentDay;
      // "next <day>" always means strictly next week's occurrence
      if (modifier === "next") {
        if (daysAhead <= 0) daysAhead += 7;
        else daysAhead += 7;
      } else {
        // "this <day>" or bare day name: nearest upcoming occurrence (same day rolls to next week)
        if (daysAhead <= 0) daysAhead += 7;
      }
      d.setDate(d.getDate() + daysAhead);
      return { searchStart: d };
    }
  }

  // ── ISO / parseable date or datetime string ───────────────────────────────
  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    const effectiveStart = parsed > now ? parsed : now;
    // Detect whether the original string carries a time component.
    // A bare date like "2025-06-10" parses to midnight UTC, so its time parts
    // are all zero.  If any time digit is non-zero the string is a datetime.
    const hasTimeComponent = raw.includes("T") || raw.includes(" ");
    return {
      searchStart:  effectiveStart,
      // Enforce the time instant so slots earlier in the day are excluded
      minSlotStart: hasTimeComponent ? effectiveStart : undefined,
    };
  }

  // ── Fallback ──────────────────────────────────────────────────────────────
  return { searchStart: now };
}

function extractSentences(text: string): { sentences: string[]; remainder: string } {
  const sentences: string[] = [];

  const re = /([^.!?]*[.!?]+)\s*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const s = m[1].trim();
    if (s.length >= 4) sentences.push(s);
    last = re.lastIndex;
  }
  let remainder = text.slice(last);

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
