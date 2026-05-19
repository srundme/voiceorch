import { createSTTAdapter } from "./adapters/stt/index.js";
import { createLLMAdapter } from "./adapters/llm/index.js";
import { createTTSAdapter } from "./adapters/tts/index.js";
import { decodeMulaw, encodeMulaw, upsample8to16, downsample16to8, hasSpeechEnergy } from "./audio.js";
import type { AgentConfig, ConversationTurn, SessionConfig } from "./types.js";
import { logger } from "../lib/logger.js";

const VAD_SILENCE_MS = 400;       // silence window before STT flush (was 700ms)
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

  /** Called with each incoming mulaw audio chunk from Twilio/Plivo */
  onAudioIn(mulawChunk: Buffer): void {
    this.onRawPcm8kIn(decodeMulaw(mulawChunk));
  }

  /** Called with raw LINEAR16 PCM at 8 kHz — used by providers that don't use mulaw (e.g. Vobiz) */
  onRawPcm8kIn(pcm8k: Buffer): void {
    if (this.closed || this.isProcessing) return;

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

      await this.synthesizeAndPlay(greeting);
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

  /**
   * Synthesize text and play it immediately as a single TTS call.
   * Used for the greeting and as a fallback.
   */
  private async synthesizeAndPlay(text: string): Promise<void> {
    const ttsPcm16k = await this.tts.synthesize(text);
    const ttsPcm8k  = downsample16to8(ttsPcm16k);
    const ttsMusaw  = encodeMulaw(ttsPcm8k);
    for (let i = 0; i < ttsMusaw.length; i += CHUNK_SIZE_MULAW) {
      if (this.closed) break;
      this.config.onAudioOut(ttsMusaw.slice(i, i + CHUNK_SIZE_MULAW));
      await new Promise<void>((r) => setTimeout(r, 20));
    }
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
      this.conversationHistory.push({ role: "user", content: transcript });

      // 2+3. LLM → sentence-streaming TTS → audio playback
      //
      // Instead of waiting for the full LLM response before synthesizing:
      //   - As LLM streams tokens we detect sentence boundaries
      //   - Each complete sentence is immediately queued for TTS synthesis
      //   - A synthesis task runs concurrently with LLM generation
      //   - A playback task plays sentences in order as synthesis completes
      //
      // Result: first audio chunk starts playing ~(LLM time-to-first-sentence + TTS latency)
      // instead of ~(full LLM time + full TTS time).

      let llmResponse = "";
      let pendingText = "";
      let allEnqueued = false;

      // Queue of sentences: text is set when enqueued, pcm16k is set when TTS finishes
      const sentenceQueue: Array<{ text: string; pcm16k?: Buffer }> = [];

      /**
       * Extract complete sentences (ending with . ! ?) from accumulated text.
       * Returns the sentences found and the leftover partial sentence.
       */
      function extractComplete(text: string): { sentences: string[]; remainder: string } {
        const sentences: string[] = [];
        // Match sequences that end with sentence-ending punctuation
        const re = /([^.!?]*[.!?]+)\s*/g;
        let last = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
          const s = m[1].trim();
          if (s.length >= 4) sentences.push(s); // skip trivially short fragments
          last = re.lastIndex;
        }
        return { sentences, remainder: text.slice(last) };
      }

      // TTS synthesis task — runs concurrently, picks up sentences as they're enqueued
      const synthTask = async (): Promise<void> => {
        let idx = 0;
        while (true) {
          if (idx < sentenceQueue.length) {
            const job = sentenceQueue[idx];
            if (job.pcm16k === undefined) {
              try {
                job.pcm16k = await this.tts.synthesize(job.text);
              } catch (err) {
                logger.error({ callId: this.config.callId, err, text: job.text.slice(0, 40) }, "TTS sentence error");
                job.pcm16k = Buffer.alloc(0); // mark done so playback doesn't stall
              }
            }
            idx++;
          } else if (allEnqueued) {
            break;
          } else {
            await new Promise<void>((r) => setTimeout(r, 5));
          }
        }
      };

      // Playback task — plays sentences in order as their pcm16k becomes available
      const playTask = async (): Promise<void> => {
        let idx = 0;
        while (true) {
          const job = sentenceQueue[idx];
          if (job !== undefined && job.pcm16k !== undefined) {
            idx++;
            if (job.pcm16k.length > 0) {
              const ttsPcm8k = downsample16to8(job.pcm16k);
              const ttsMusaw = encodeMulaw(ttsPcm8k);
              for (let i = 0; i < ttsMusaw.length; i += CHUNK_SIZE_MULAW) {
                if (this.closed) return;
                this.config.onAudioOut(ttsMusaw.slice(i, i + CHUNK_SIZE_MULAW));
                await new Promise<void>((r) => setTimeout(r, 20));
              }
            }
          } else if (allEnqueued && idx >= sentenceQueue.length) {
            break;
          } else {
            await new Promise<void>((r) => setTimeout(r, 5));
          }
        }
      };

      // Launch synthesis and playback tasks before LLM call so they're ready immediately
      const synthPromise = synthTask();
      const playPromise  = playTask();

      // 2. LLM — stream tokens, detect sentence boundaries, enqueue for TTS
      await this.llm.chat(
        this.conversationHistory,
        this.agent.systemPrompt,
        (token) => {
          llmResponse  += token;
          pendingText  += token;
          const { sentences, remainder } = extractComplete(pendingText);
          for (const s of sentences) {
            sentenceQueue.push({ text: s });
          }
          pendingText = remainder;
        },
        async (fullText) => {
          llmResponse = fullText;
        }
      );

      // Flush any remaining text that didn't end with punctuation
      const remaining = pendingText.trim();
      if (remaining.length >= 2) {
        sentenceQueue.push({ text: remaining });
      }
      allEnqueued = true;

      logger.info(
        { callId: this.config.callId, response: llmResponse.slice(0, 80), sentences: sentenceQueue.length },
        "LLM complete"
      );

      this.conversationHistory.push({ role: "assistant", content: llmResponse });
      this.config.onTranscript("agent", llmResponse);

      // Wait for all synthesis and playback to finish
      await Promise.all([synthPromise, playPromise]);

      logger.info({ callId: this.config.callId }, "Audio playback complete");

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
