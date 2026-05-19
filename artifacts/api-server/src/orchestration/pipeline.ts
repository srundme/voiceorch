import { createSTTAdapter } from "./adapters/stt/index.js";
import { createLLMAdapter } from "./adapters/llm/index.js";
import { createTTSAdapter } from "./adapters/tts/index.js";
import { decodeMulaw, encodeMulaw, upsample8to16, downsample16to8, hasSpeechEnergy } from "./audio.js";
import type { AgentConfig, ConversationTurn, SessionConfig, StreamSTT } from "./types.js";
import { logger } from "../lib/logger.js";

const VAD_SILENCE_MS   = 250;    // silence window before STT flush
const MIN_SPEECH_BYTES = 3200;   // ~200ms @ 8kHz PCM — skip noise bursts shorter than this
const CHUNK_SIZE_MULAW = 160;    // 20ms @ 8kHz mulaw for paced batch playback
const VAD_THRESHOLD    = 100;    // RMS threshold for speech detection
const STREAM_ACCUM_BYTES = 640;  // 20ms of 16kHz PCM before forwarding a TTS stream chunk

export class OrchestrationPipeline {
  private config: SessionConfig;
  private agent: AgentConfig;
  private stt: ReturnType<typeof createSTTAdapter>;
  private llm: ReturnType<typeof createLLMAdapter>;
  private tts: ReturnType<typeof createTTSAdapter>;

  private audioBuffer: Buffer[] = [];
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private isProcessing = false;

  // Barge-in state
  private isPlaying = false;           // true while audio chunks are actively being sent
  private bargeInRequested = false;    // set when caller speaks during agent playback
  private bargeInCallback: (() => void) | null;

  // Streaming STT (Deepgram live transcription)
  private streamSTT: StreamSTT | null = null;
  private pendingTranscript: string | null = null;

  // Metrics
  private firstAudioSentAt: number | null = null;

  private conversationHistory: ConversationTurn[] = [];
  private closed = false;

  constructor(config: SessionConfig) {
    this.config = config;
    this.agent = config.agentConfig;
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
      keys.get(`${this.agent.asrProvider}:extraConfig`) ?? null
    );
    this.llm = createLLMAdapter(this.agent.llmProvider, llmKey, this.agent.llmModel);
    this.tts = createTTSAdapter(
      this.agent.ttsProvider, ttsKey, this.agent.ttsVoice, this.agent.ttsModel
    );

    logger.info({ callId: config.callId, agent: this.agent.name }, "Pipeline initialized");

    // Start live streaming STT if the adapter supports it (e.g. Deepgram)
    if (this.stt.transcribeStream) {
      this.initStreamingSTT();
    }
  }

  // ── Streaming STT ───────────────────────────────────────────────────────────

  private initStreamingSTT(): void {
    if (!this.stt.transcribeStream) return;
    try {
      this.streamSTT = this.stt.transcribeStream((text, isFinal) => {
        if (!isFinal || !text.trim() || this.closed) return;
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
      // Caller spoke while agent was playing — interrupt playback
      this.bargeInRequested = true;
      this.bargeInCallback?.();
      logger.info({ callId: this.config.callId }, "Barge-in detected (streaming STT)");
    }

    if (this.isProcessing) {
      // Already processing — queue the new utterance; it runs after current turn
      this.pendingTranscript = transcript;
      return;
    }

    this.isProcessing = true;
    try {
      // sttLatencyMs = 0: Deepgram's endpointing already accounts for the silence window
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

  /** Incoming mulaw from Twilio / Plivo */
  onAudioIn(mulawChunk: Buffer): void {
    this.onRawPcm8kIn(decodeMulaw(mulawChunk));
  }

  /** Incoming raw LINEAR16 PCM @ 8 kHz from Vobiz (bypasses mulaw decode) */
  onRawPcm8kIn(pcm8k: Buffer): void {
    if (this.closed) return;

    // Streaming STT path: feed all audio directly to Deepgram — no local VAD needed
    if (this.streamSTT) {
      const pcm16k = upsample8to16(pcm8k);
      this.streamSTT.sendAudio(pcm16k);
      return;
    }

    // Batch STT path with local VAD + barge-in detection
    const hasSpeech = hasSpeechEnergy(pcm8k, VAD_THRESHOLD);

    if (hasSpeech && this.isPlaying && !this.bargeInRequested) {
      // First speech energy during playback = barge-in
      this.bargeInRequested = true;
      this.bargeInCallback?.();
      this.audioBuffer = []; // discard stale audio
      logger.info({ callId: this.config.callId }, "Barge-in detected (batch STT)");
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
      let greeting = "";
      await this.llm.chat(
        [], this.agent.systemPrompt,
        (token) => { greeting += token; },
        (full)  => { greeting = full; }
      );
      if (!greeting.trim() || this.closed) return;
      logger.info({ callId: this.config.callId, greeting: greeting.slice(0, 80) }, "Sending greeting");
      this.conversationHistory.push({ role: "assistant", content: greeting });
      this.config.onTranscript("agent", greeting);
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

  // ── TTS playback ─────────────────────────────────────────────────────────────

  /**
   * Synthesise and stream a single sentence to the telephony channel.
   * Uses streaming TTS if available (lower time-to-first-audio).
   * Checks bargeInRequested at every audio boundary and aborts early.
   */
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
      // Batch fallback: pace to real-time to avoid flooding telephony buffers
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

  // ── Core turn logic ───────────────────────────────────────────────────────────

  /**
   * Given a final transcript, run the full LLM → sentence-streaming TTS pipeline.
   * Records per-turn latency metrics: STT (passed in), LLM TTFT, TTS first-chunk.
   */
  private async processTurn(transcript: string, sttLatencyMs: number): Promise<void> {
    this.bargeInRequested = false;
    this.firstAudioSentAt = null;

    const llmStart = Date.now();
    let llmFirstTokenAt: number | null = null;

    logger.info({ callId: this.config.callId, transcript, sttLatencyMs }, "Processing turn");
    this.config.onTranscript("user", transcript);
    this.conversationHistory.push({ role: "user", content: transcript });

    let llmResponse = "";
    let pendingText  = "";
    let allEnqueued  = false;

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

    // Playback coroutine — runs concurrently with LLM generation
    // isPlaying is set on the first sentence and cleared when all sentences finish
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
      this.agent.systemPrompt,
      (token) => {
        if (!llmFirstTokenAt) llmFirstTokenAt = Date.now();
        llmResponse += token;
        pendingText += token;
        const { sentences, remainder } = extractSentences(pendingText);
        for (const s of sentences) enqueue(s);
        pendingText = remainder;
      },
      async (fullText) => { llmResponse = fullText; }
    );

    // Flush any trailing text that didn't end with punctuation
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

    await playPromise;

    // Emit per-turn latency metrics
    const llmLatencyMs = llmFirstTokenAt ? llmFirstTokenAt - llmStart : Date.now() - llmStart;
    const ttsFirstChunkMs = this.firstAudioSentAt ? this.firstAudioSentAt - llmStart : 0;
    logger.info(
      { callId: this.config.callId, sttLatencyMs, llmLatencyMs, ttsFirstChunkMs },
      "Turn metrics"
    );
    this.config.onMetrics?.({ sttLatencyMs, llmLatencyMs, ttsFirstChunkMs });
  }

  /**
   * Flush the accumulated audio buffer through batch STT → processTurn.
   * Triggered by the VAD silence timer.
   */
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

  // ── Utilities ─────────────────────────────────────────────────────────────────

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
    this.streamSTT?.close();
    this.streamSTT = null;
    logger.info({ callId: this.config.callId }, "Pipeline closed");
  }
}

// ── Sentence segmentation ─────────────────────────────────────────────────────
//
// Priority order:
//   1. Standard sentence-end punctuation: . ! ?
//   2. Comma break: trigger after a comma when ≥60 chars accumulated
//      (avoids tiny TTS calls while still reducing first-sentence latency)

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
