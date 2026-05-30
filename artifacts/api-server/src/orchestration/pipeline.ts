import { createSTTAdapter } from "./adapters/stt/index.js";
import { toReadableError } from "./utils.js";
import { createLLMAdapter } from "./adapters/llm/index.js";
import { createTTSAdapter } from "./adapters/tts/index.js";
import { encodeMulaw, upsample8to16, downsample16to8, decodeMulaw, hasSpeechEnergy } from "./audio.js";
import { AmbientNoiseStream } from "./ambient.js";
import { DtmfDetector } from "./dtmf.js";
import { processAudioIn, processRawPcm8kIn, destroyAudioSession } from "./audioPool.js";
import { RecordingBuffer } from "./recorder.js";
import type { AudioProcessResult } from "./audioPool.js";
import type { AgentConfig, AgentTool, ConversationTurn, LLMUsage, SessionConfig, StreamSTT, ToolDefinition } from "./types.js";
import { retrieveKbContext } from "./kb-retrieval.js";
import { logger } from "../lib/logger.js";
import { format, addMinutes } from "date-fns";
import { toZonedTime, formatInTimeZone } from "date-fns-tz";
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

  // Usage accumulators — updated on every LLM call and every TTS synthesis.
  // Exposed via getUsageTotals() so session.ts can pass real values to recordUsage().
  private llmInputTokensTotal = 0;
  private llmOutputTokensTotal = 0;
  private ttsCharactersTotal = 0;
  // True once any LLM adapter returned real token counts.  Stays false for
  // providers that don't expose usage (e.g. Sarvam) so session.ts can fall back
  // to its turn-count heuristic for LLM tokens while still using exact TTS chars.
  private hasRealLlmUsage = false;

  // Recording — stereo WAV of both sides (caller=L, agent=R)
  private recording = new RecordingBuffer(8000);

  private conversationHistory: ConversationTurn[] = [];
  private closed = false;

  // Ambient noise
  private ambientStream: AmbientNoiseStream | null = null;
  private ambientInterval: ReturnType<typeof setInterval> | null = null;

  // IVR / DTMF
  private dtmfDetector: DtmfDetector | null = null;
  private dtmfResolver: ((digit: string | null) => void) | null = null;
  private dtmfTimeoutId: ReturnType<typeof setTimeout> | null = null;

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

    // Ambient noise — start looping silence-fill interval
    if (this.agent.ambientNoiseEnabled && this.agent.ambientNoiseTrack) {
      this.ambientStream = new AmbientNoiseStream(this.agent.ambientNoiseTrack);
      // Send one 20 ms ambient chunk every 20 ms while the agent is silent.
      // When isPlaying=true playSentence owns the timing, so we skip here to
      // avoid interleaving two concurrent senders on the same WebSocket.
      this.ambientInterval = setInterval(() => {
        if (!this.closed && !this.isPlaying && this.ambientStream) {
          this.config.onAudioOut(this.ambientStream.nextMulawChunk());
        }
      }, 20);
      logger.info({ callId: config.callId, track: this.agent.ambientNoiseTrack }, "Ambient noise enabled");
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
      // IVR pre-filter: play menu, collect a digit, then fall through to normal greeting
      if (this.agent.ivrEnabled && this.agent.ivrGreeting) {
        const transferred = await this.runIvr();
        if (transferred || this.closed) return; // call was routed away — do not greet
      }

      let greeting = this.agent.greetingMessage ?? "";

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
    const tool = this.agent.tools.find((t) => t.name === toolName);
    if (!tool) {
      // Built-in end_call: always available even if not explicitly in agent tools
      if (toolName === "end_call") {
        logger.info({ callId: this.config.callId }, "Built-in end_call invoked by LLM");
        this.config.onCallEnd();
        return undefined;
      }
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
    } else if (tool.type === "native_check_availability") {
      return await this.executeNativeCheckAvailability(tool, args);
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

    logger.info({ callId: this.config.callId, transcript, sttLatencyMs }, "Processing turn");
    this.config.onTranscript("user", transcript);
    this.conversationHistory.push({ role: "user", content: transcript });

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
      if (this.agent.endCallPhrases.some(p => lower.includes(p.toLowerCase()))) {
        logger.info({ callId: this.config.callId, transcript }, "End-call phrase detected — hanging up");
        this.config.onCallEnd();
        return;
      }
    }

    // ── Build tool definitions from agent config ──
    // Always inject a built-in end_call tool so the LLM can end the call at the
    // right moment, even if the user hasn't explicitly added an end_call tool.
    const hasExplicitEndCall = this.agent.tools.some(t => t.type === "end_call");
    const builtInEndCall: ToolDefinition[] = hasExplicitEndCall ? [] : [{
      name: "end_call",
      description: "End the phone call. Call this when the conversation is complete, the caller says goodbye, all objectives are met, or the caller requests to end the call.",
      parameters: { type: "object", properties: {}, required: [] },
    }];

    const toolDefs: ToolDefinition[] = [...builtInEndCall, ...this.agent.tools.map((t): ToolDefinition => {
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
      if (t.type === "native_check_availability") {
        return {
          name: t.name,
          description: t.description,
          parameters: {
            type: "object",
            properties: {
              preferred_date: { type: "string", description: "Optional preferred date or time of day to check availability for, e.g. 'next Tuesday', '2025-06-10', 'tomorrow morning'. Defaults to the next 7 days." },
            },
            required: [],
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
    })];

    const llmStart = Date.now();
    let llmFirstTokenAt: number | null = null;

    let llmResponse = "";
    let pendingText  = "";
    let allEnqueued  = false;
    let triggeredToolName: string | null = null;
    let triggeredToolArgs: Record<string, unknown> = {};

    // ── Think-block filter (streaming) ───────────────────────────────────────
    // Strips <think>…</think> reasoning blocks from models like DeepSeek-R1.
    // makeThinkFilter() returns a stateful per-turn closure (shared with
    // continueWithToolResult via the same factory).
    const filterThinkToken = makeThinkFilter();

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

    // ── KB retrieval: kick off immediately so it runs concurrently ───────────
    // Start the KB lookup as a promise RIGHT NOW — before the backchannel phrase
    // is even enqueued.  That way KB retrieval overlaps with the backchannel TTS
    // playback instead of adding to LLM start latency.
    let systemPromptForTurn = this.agent.systemPrompt;
    let kbContextPromise: Promise<string | null> = Promise.resolve(null);
    if (this.agent.knowledgeBaseId) {
      const openaiKey = this.config.providerKeys.get("openai");
      if (openaiKey) {
        kbContextPromise = retrieveKbContext(this.agent.knowledgeBaseId, transcript, openaiKey)
          .catch((err) => {
            logger.warn({ callId: this.config.callId, err }, "KB retrieval failed — continuing without context");
            return null;
          });
      }
    }

    // ── Backchannel: enqueue filler CONCURRENT with KB retrieval + LLM startup ─
    // playTask starts TTS-ing the filler phrase while KB lookup and LLM warm up.
    // This fills the dead silence between the user finishing speaking and the
    // first agent word.
    if (this.agent.backchannelingEnabled && !this.closed && !this.bargeInRequested) {
      const freq = this.agent.backchannelingFrequency ?? 0.5;
      if (Math.random() < freq) {
        const phrase = BACKCHANNEL_PHRASES[Math.floor(Math.random() * BACKCHANNEL_PHRASES.length)]!;
        enqueue(phrase);
      }
    }

    // Await KB result — by now it has been running concurrently with the backchannel TTS
    const kbContext = await kbContextPromise;
    if (kbContext) {
      systemPromptForTurn = `${systemPromptForTurn}\n\n## Relevant Knowledge Base Context\n\n${kbContext}`;
    }

    try {
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
              },
            }
          : {
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
      allEnqueued = true;
      const w = wakePlayer as (() => void) | null; wakePlayer = null;
      if (w) w();
      await playPromise;
      throw llmErr;
    }

    // ── If LLM called a tool, execute it and skip TTS ──
    if (triggeredToolName) {
      // Push the assistant's tool-invocation turn to history BEFORE executing the tool.
      // Without this, continueWithToolResult would see two consecutive "user" messages
      // (the caller's speech + the tool result), which breaks Sarvam's strict turn
      // alternation and confuses all LLMs lacking a tool-result role.
      const assistantToolContent = llmResponse.trim() || `[calling tool: ${triggeredToolName}]`;
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
   */
  getUsageTotals(): { llmInputTokens?: number; llmOutputTokens?: number; ttsCharacters: number } {
    return {
      llmInputTokens: this.hasRealLlmUsage ? this.llmInputTokensTotal : undefined,
      llmOutputTokens: this.hasRealLlmUsage ? this.llmOutputTokensTotal : undefined,
      ttsCharacters: this.ttsCharactersTotal,
    };
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
      // Always start by resolving the agent owner so we can verify any stored
      // calendarId actually belongs to this agent's tenant.
      const [agentRow] = await db
        .select({ userId: agentsTable.userId })
        .from(agentsTable)
        .where(eq(agentsTable.id, this.agent.id));
      const agentOwnerId = agentRow?.userId ?? null;

      let authorizedUserId: string | null = null;
      if (tool.calendarId) {
        // Verify the stored calendarId belongs to the agent owner — prevents a
        // malicious/forged calendarId from authorizing cross-tenant cancellations.
        const [calRow] = await db
          .select({ userId: schedulingCalendarsTable.userId })
          .from(schedulingCalendarsTable)
          .where(eq(schedulingCalendarsTable.id, tool.calendarId));
        if (!calRow || calRow.userId !== agentOwnerId) {
          logger.warn({ callId: this.config.callId, toolCalendarId: tool.calendarId, agentOwnerId }, "Native cancel: stored calendarId does not belong to agent owner — rejected");
          return `error: no booking found with reference ${bookingId}`;
        }
        authorizedUserId = calRow.userId;
      } else {
        // Fallback: find a calendar linked to this agent, then fall back to agent owner
        const [agentCalendar] = await db
          .select({ userId: schedulingCalendarsTable.userId })
          .from(schedulingCalendarsTable)
          .where(eq(schedulingCalendarsTable.agentId, this.agent.id));
        authorizedUserId = agentCalendar?.userId ?? agentOwnerId;
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

  private async executeNativeCheckAvailability(tool: AgentTool & { type: "native_check_availability" }, args: Record<string, unknown>): Promise<string> {
    logger.info({ callId: this.config.callId, eventTypeId: tool.eventTypeId }, "Native check-availability tool invoked");
    const preferredRaw = args["preferred_date"] != null ? String(args["preferred_date"]) : null;

    try {
      // ── Authorization: resolve owning userId for this agent ──
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
      if (authorizedUserId && calendar.userId !== authorizedUserId) {
        logger.warn({ callId: this.config.callId, eventTypeId: tool.eventTypeId }, "Native check-availability: ownership mismatch — rejected");
        return "error: the appointment type is unavailable";
      }

      const { searchStart, minSlotStart, timeFilter } = preferredRaw
        ? parsePreferredDate(preferredRaw, calendar.timezone)
        : { searchStart: new Date(), minSlotStart: undefined, timeFilter: undefined };
      const searchEnd = new Date(searchStart.getTime() + 7 * 24 * 60 * 60 * 1000);
      let slots = await getAvailableSlots(tool.eventTypeId, format(searchStart, "yyyy-MM-dd"), format(searchEnd, "yyyy-MM-dd"));
      if (minSlotStart) slots = slots.filter(s => s.slotStart >= minSlotStart);
      if (timeFilter)   slots = slots.filter(timeFilter);

      if (slots.length === 0) {
        const rangeDesc = preferredRaw ? `on or after "${preferredRaw}"` : "in the next 7 days";
        return `no_availability: no available slots ${rangeDesc}`;
      }

      // Return up to the first 5 slots formatted for the LLM to read back (in calendar timezone)
      const tz = tool.timezone || calendar.timezone || "UTC";
      const preview = slots.slice(0, 5).map(s => formatInTimeZone(s.slotStart, tz, "EEE MMM d 'at' h:mm a")).join("; ");
      return `available_slots: count=${slots.length}, event="${eventType.name}", duration_mins=${eventType.durationMinutes}, timezone="${tz}", next="${preview}"`;

    } catch (err) {
      logger.error({ callId: this.config.callId, err }, "Native check-availability tool execution failed");
      return "error: availability check failed due to a technical issue";
    }
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
  private async continueWithToolResult(toolName: string, result: string): Promise<void> {
    this.conversationHistory.push({ role: "user", content: `[Tool result for ${toolName}]: ${result}` });

    let llmResponse = "";
    let pendingText = "";
    let allEnqueued = false;

    const filterThinkToken = makeThinkFilter();

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

    try {
      await this.llm.chat(
        this.conversationHistory,
        this.agent.systemPrompt,
        (token) => {
          llmResponse += token;
          const filtered = filterThinkToken(token);
          if (!filtered) return;
          pendingText += filtered;
          const { sentences, remainder } = extractSentences(pendingText);
          for (const s of sentences) enqueue(s);
          pendingText = remainder;
        },
        (fullText) => { llmResponse = fullText; },
        {
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

    const cleanResponse = llmResponse.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    if (cleanResponse) {
      this.conversationHistory.push({ role: "assistant", content: cleanResponse });
      this.config.onTranscript("agent", cleanResponse);
      this.config.onConversationUpdate?.(this.conversationHistory);
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
