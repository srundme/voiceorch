import { createSTTAdapter } from "./adapters/stt/index.js";
import { createLLMAdapter } from "./adapters/llm/index.js";
import { createTTSAdapter } from "./adapters/tts/index.js";
import { decodeMulaw, encodeMulaw, upsample8to16, downsample16to8, hasSpeechEnergy } from "./audio.js";
import type { AgentConfig, ConversationTurn, SessionConfig } from "./types.js";
import { logger } from "../lib/logger.js";

const VAD_SILENCE_MS = 700;       // how long of silence triggers STT
const MIN_SPEECH_BYTES = 3200;    // minimum audio bytes (~200ms@8kHz) before sending to STT
const CHUNK_SIZE_MULAW = 160;     // 20ms @ 8kHz mulaw
const VAD_THRESHOLD = 100;        // RMS threshold for telephony audio (mulaw 8kHz decoded)

export class OrchestrationPipeline {
  private config: SessionConfig;
  private agent: AgentConfig;
  private stt: ReturnType<typeof createSTTAdapter>;
  private llm: ReturnType<typeof createLLMAdapter>;
  private tts: ReturnType<typeof createTTSAdapter>;

  private audioBuffer: Buffer[] = [];
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private isProcessing = false;
  private conversationHistory: ConversationTurn[] = [];
  private closed = false;

  constructor(config: SessionConfig) {
    this.config = config;
    this.agent = config.agentConfig;

    const keys = config.providerKeys;

    const sttKey = keys.get(this.agent.asrProvider);
    if (!sttKey) throw new Error(`No API key found for STT provider: ${this.agent.asrProvider}`);

    const llmKey = keys.get(this.agent.llmProvider);
    if (!llmKey) throw new Error(`No API key found for LLM provider: ${this.agent.llmProvider}`);

    const ttsKey = keys.get(this.agent.ttsProvider);
    if (!ttsKey) throw new Error(`No API key found for TTS provider: ${this.agent.ttsProvider}`);

    this.stt = createSTTAdapter(
      this.agent.asrProvider,
      sttKey,
      this.agent.asrModel,
      keys.get(`${this.agent.asrProvider}:extraConfig`) ?? null
    );

    this.llm = createLLMAdapter(
      this.agent.llmProvider,
      llmKey,
      this.agent.llmModel
    );

    this.tts = createTTSAdapter(
      this.agent.ttsProvider,
      ttsKey,
      this.agent.ttsVoice,
      this.agent.ttsModel
    );

    logger.info(
      { callId: config.callId, agent: this.agent.name },
      "Pipeline initialized"
    );
  }

  /** Called with each incoming mulaw audio chunk from telephony */
  onAudioIn(mulawChunk: Buffer): void {
    if (this.closed || this.isProcessing) return;

    // Decode mulaw → linear16 PCM @ 8kHz
    const pcm8k = decodeMulaw(mulawChunk);

    if (hasSpeechEnergy(pcm8k, VAD_THRESHOLD)) {
      this.audioBuffer.push(pcm8k);
      this.resetSilenceTimer();
    } else if (this.audioBuffer.length > 0) {
      // Silence detected — accumulate a little more before flushing
      this.audioBuffer.push(pcm8k);
      this.scheduleSilenceFlush();
    }
  }

  /**
   * Send an AI-generated opening greeting as soon as the call connects.
   * Blocks audio processing until the greeting audio has been fully sent.
   */
  async greet(): Promise<void> {
    if (this.closed) return;
    this.isProcessing = true;
    try {
      let greeting = "";
      await this.llm.chat(
        [],
        this.agent.systemPrompt,
        (token) => { greeting += token; },
        (full)  => { greeting = full; }
      );

      if (!greeting.trim() || this.closed) return;

      logger.info({ callId: this.config.callId, greeting: greeting.slice(0, 80) }, "Sending greeting");
      this.conversationHistory.push({ role: "assistant", content: greeting });
      this.config.onTranscript("agent", greeting);

      const ttsPcm16k = await this.tts.synthesize(greeting);
      const ttsPcm8k  = downsample16to8(ttsPcm16k);
      const ttsMusaw  = encodeMulaw(ttsPcm8k);

      for (let i = 0; i < ttsMusaw.length; i += CHUNK_SIZE_MULAW) {
        if (this.closed) break;
        this.config.onAudioOut(ttsMusaw.slice(i, i + CHUNK_SIZE_MULAW));
        await new Promise((r) => setTimeout(r, 20));
      }
    } catch (err) {
      logger.error({ callId: this.config.callId, err }, "Greeting error");
    } finally {
      this.isProcessing = false;
    }
  }

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

  private async flushAndProcess(): Promise<void> {
    if (this.isProcessing || this.audioBuffer.length === 0) return;

    const pcmChunks = this.audioBuffer.splice(0);
    const pcm8k = Buffer.concat(pcmChunks);

    if (pcm8k.length < MIN_SPEECH_BYTES) return; // too short, skip

    this.isProcessing = true;

    try {
      // Upsample 8kHz → 16kHz for STT
      const pcm16k = upsample8to16(pcm8k);

      logger.info({ callId: this.config.callId, bytes: pcm16k.length }, "Sending to STT");

      // 1. Speech-to-Text
      const transcript = await this.stt.transcribe(pcm16k, 16000);

      if (!transcript || transcript.trim().length === 0) {
        logger.info({ callId: this.config.callId }, "Empty STT transcript, skipping");
        return;
      }

      logger.info({ callId: this.config.callId, transcript }, "STT result");
      this.config.onTranscript("user", transcript);

      // Add to conversation history
      this.conversationHistory.push({ role: "user", content: transcript });

      // 2. LLM — collect full response (sentence-by-sentence TTS would be more responsive
      //    but requires partial sentence detection; for MVP we do full response → TTS)
      let llmResponse = "";
      const sentenceBuffer: string[] = [];

      await this.llm.chat(
        this.conversationHistory,
        this.agent.systemPrompt,
        (token) => {
          llmResponse += token;
          sentenceBuffer.push(token);
        },
        async (fullText) => {
          llmResponse = fullText;
        }
      );

      logger.info({ callId: this.config.callId, response: llmResponse.slice(0, 80) }, "LLM response");
      this.conversationHistory.push({ role: "assistant", content: llmResponse });
      this.config.onTranscript("agent", llmResponse);

      // 3. Text-to-Speech
      const ttsPcm16k = await this.tts.synthesize(llmResponse);
      logger.info({ callId: this.config.callId, bytes: ttsPcm16k.length }, "TTS audio ready");

      // Downsample 16kHz → 8kHz for telephony
      const ttsPcm8k = downsample16to8(ttsPcm16k);

      // Encode to mulaw for telephony
      const ttsMusaw = encodeMulaw(ttsPcm8k);

      // Send audio out in 20ms chunks (160 bytes of mulaw @ 8kHz)
      for (let i = 0; i < ttsMusaw.length; i += CHUNK_SIZE_MULAW) {
        if (this.closed) break;
        const chunk = ttsMusaw.slice(i, i + CHUNK_SIZE_MULAW);
        this.config.onAudioOut(chunk);
        await new Promise((r) => setTimeout(r, 20)); // pace to real-time
      }
    } catch (err) {
      logger.error({ callId: this.config.callId, err }, "Pipeline error");
    } finally {
      this.isProcessing = false;

      // If more audio accumulated while we were processing, flush again
      if (this.audioBuffer.length > 0) {
        void this.flushAndProcess();
      }
    }
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
    logger.info({ callId: this.config.callId }, "Pipeline closed");
  }
}
