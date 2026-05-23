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
    const agentLanguage = (this.agent as any).language as string | null ?? null;
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
      this.streamSTT = this.stt.transcribeStream((text, isFinal) => {
        if (!isFinal || !text.trim() || this.closed) return;
        this.resetHangupTimer();
        void this.handleStreamingTranscript(text);
      });
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

  private async handleToolCall(toolName: string, args: Record<string, unknown>): Promise<void> {
    const tool = this.agent.tools.find((t) => t.name === toolName);
    if (!tool) {
      logger.warn({ callId: this.config.callId, toolName }, "LLM called unknown tool — ignoring");
      return;
    }

    logger.info({ callId: this.config.callId, toolName, toolType: tool.type, args }, "Tool invoked by LLM");

    if (tool.type === "call_transfer") {
      await this.executeCallTransfer(tool, args);
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
    const toolDefs: ToolDefinition[] = this.agent.tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: {
        type: "object" as const,
        properties: {
          reason: {
            type: "string",
            description: "Brief reason for invoking this tool",
          },
        },
        required: [],
      },
    }));

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
      await this.handleToolCall(triggeredToolName, triggeredToolArgs);
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

  /** P2-A: Speak a raw message to the caller (used by warm transfer REST endpoint). */
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
    this.streamSTT?.close();
    this.streamSTT = null;
    logger.info({ callId: this.config.callId }, "Pipeline closed");
  }
}

// ── Sentence segmentation ─────────────────────────────────────────────────────

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
