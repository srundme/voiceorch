import { createSTTAdapter } from "./adapters/stt/index.js";
import { createLLMAdapter } from "./adapters/llm/index.js";
import { createTTSAdapter } from "./adapters/tts/index.js";
import { encodeMulaw, upsample8to16, downsample16to8, decodeMulaw, hasSpeechEnergy } from "./audio.js";
import { processAudioIn, processRawPcm8kIn, destroyAudioSession } from "./audioPool.js";
import type { AudioProcessResult } from "./audioPool.js";
import type { AgentConfig, AgentTool, ConversationTurn, SessionConfig, StreamSTT, ToolDefinition } from "./types.js";
import { detectCallerGender, applyCallerSalutation } from "./genderDetection.js";
import { logger } from "../lib/logger.js";

const VAD_SILENCE_MS     = 250;    // silence window before STT flush
const MIN_SPEECH_BYTES   = 3200;   // ~200ms @ 8kHz PCM — skip noise bursts shorter than this
const CHUNK_SIZE_MULAW   = 160;    // 20ms @ 8kHz mulaw for paced batch playback
const VAD_THRESHOLD      = 100;    // RMS threshold for speech detection
const STREAM_ACCUM_BYTES = 640;    // 20ms of 16kHz PCM before forwarding a TTS stream chunk
const HANDOFF_SILENCE_MS = 3000;   // sustained silence that may indicate a phone handoff

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

  // Streaming STT (Deepgram live transcription)
  private streamSTT: StreamSTT | null = null;
  private pendingTranscript: string | null = null;

  // Metrics
  private firstAudioSentAt: number | null = null;

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
    this.tts = createTTSAdapter(
      this.agent.ttsProvider, ttsKey, this.agent.ttsVoice, this.agent.ttsModel,
      keys.get(`${this.agent.ttsProvider}:extraConfig`) ?? null
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
    // Accumulate raw (pre-noise-cancellation) PCM for gender detection so the
    // 300 Hz bandpass highpass in NoiseCanceller does not strip female
    // fundamentals (165–255 Hz).  Skip while the agent is playing TTS to
    // avoid mis-classifying echo of the agent's own voice.
    if (this.agent.genderDetectionEnabled && !this.genderDetected && !this.isPlaying) {
      this.accumulateGenderAudio(decodeMulaw(mulawChunk));
    }
    processAudioIn(callId, mulawChunk, this.agent.noiseCancellationEnabled)
      .then((result) => this.handleProcessedAudio(result))
      .catch((err) => logger.error({ callId: this.config.callId, err }, "Audio worker error (mulaw)"));
  }

  /** Incoming raw LINEAR16 PCM @ 8 kHz from Vobiz — offloads noise-cancel + VAD to worker thread */
  onRawPcm8kIn(pcm8k: Buffer): void {
    if (this.closed) return;
    const callId = String(this.config.callId);
    // Same as onAudioIn: accumulate raw PCM before noise-cancellation and
    // skip while the agent is speaking to prevent echo misclassification.
    if (this.agent.genderDetectionEnabled && !this.genderDetected && !this.isPlaying) {
      this.accumulateGenderAudio(pcm8k);
    }
    processRawPcm8kIn(callId, pcm8k, this.agent.noiseCancellationEnabled)
      .then((result) => this.handleProcessedAudio(result))
      .catch((err) => logger.error({ callId: this.config.callId, err }, "Audio worker error (pcm8k)"));
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

      // Patch the live system prompt — replace every occurrence of the placeholder
      this.agent.systemPrompt = applyCallerSalutation(this.agent.systemPrompt, salutation);
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

      if (this.isPlaying && !this.bargeInRequested) {
        this.bargeInRequested = true;
        this.bargeInCallback?.();
        this.audioBuffer = [];
        logger.info({ callId: this.config.callId }, "Barge-in detected (batch STT)");
      }
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
    }, VAD_SILENCE_MS);
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
        const pcm8k  = downsample16to8(pcm16k);
        const mulaw  = encodeMulaw(pcm8k);
        for (let i = 0; i < mulaw.length; i += CHUNK_SIZE_MULAW) {
          if (!this.closed && !this.bargeInRequested) {
            if (!this.firstAudioSentAt) this.firstAudioSentAt = Date.now();
            this.config.onAudioOut(mulaw.slice(i, i + CHUNK_SIZE_MULAW));
          }
        }
      };

      await this.tts.synthesizeStream(
        text,
        (chunk) => {
          if (this.closed || this.bargeInRequested) return;
          accum.push(chunk);
          accumSize += chunk.length;
          if (accumSize >= STREAM_ACCUM_BYTES) flush();
        },
        flush
      );
    } else {
      const ttsPcm16k = await this.tts.synthesize(text);
      if (this.bargeInRequested) return;
      const ttsPcm8k  = downsample16to8(ttsPcm16k);
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

    await this.llm.chat(
      this.conversationHistory,
      this.resolvedSystemPrompt(),
      (token) => {
        if (!llmFirstTokenAt) llmFirstTokenAt = Date.now();
        llmResponse += token;
        pendingText += token;
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

    this.conversationHistory.push({ role: "assistant", content: llmResponse });
    this.config.onTranscript("agent", llmResponse);
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
