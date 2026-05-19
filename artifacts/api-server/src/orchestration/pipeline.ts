import { createSTTAdapter } from "./adapters/stt/index.js";
import { createLLMAdapter } from "./adapters/llm/index.js";
import { createTTSAdapter } from "./adapters/tts/index.js";
import { decodeMulaw, encodeMulaw, upsample8to16, downsample16to8, hasSpeechEnergy } from "./audio.js";
import type { AgentConfig, ConversationTurn, SessionConfig } from "./types.js";
import { logger } from "../lib/logger.js";

const VAD_SILENCE_MS  = 250;      // silence window before STT flush — tighter = faster response
const MIN_SPEECH_BYTES = 3200;    // ~200ms of 8kHz PCM — skip noise bursts shorter than this
const CHUNK_SIZE_MULAW = 160;     // 20ms @ 8kHz mulaw for paced batch playback
const VAD_THRESHOLD   = 100;      // RMS threshold for speech detection
// Min PCM accumulation before forwarding a stream chunk to avoid tiny sends
const STREAM_ACCUM_BYTES = 640;   // 20ms of 16kHz PCM (2 bytes/sample × 16000/50)

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
      this.agent.asrProvider, sttKey, this.agent.asrModel,
      keys.get(`${this.agent.asrProvider}:extraConfig`) ?? null
    );
    this.llm = createLLMAdapter(this.agent.llmProvider, llmKey, this.agent.llmModel);
    this.tts = createTTSAdapter(
      this.agent.ttsProvider, ttsKey, this.agent.ttsVoice, this.agent.ttsModel
    );

    logger.info({ callId: config.callId, agent: this.agent.name }, "Pipeline initialized");
  }

  /** Called with each incoming mulaw audio chunk from Twilio/Plivo */
  onAudioIn(mulawChunk: Buffer): void {
    this.onRawPcm8kIn(decodeMulaw(mulawChunk));
  }

  /** Called with raw LINEAR16 PCM at 8 kHz — used by providers that skip mulaw (e.g. Vobiz) */
  onRawPcm8kIn(pcm8k: Buffer): void {
    if (this.closed || this.isProcessing) return;

    if (hasSpeechEnergy(pcm8k, VAD_THRESHOLD)) {
      this.audioBuffer.push(pcm8k);
      this.resetSilenceTimer();
    } else if (this.audioBuffer.length > 0) {
      this.audioBuffer.push(pcm8k);
      this.scheduleSilenceFlush();
    }
  }

  /**
   * Send an AI-generated opening greeting as soon as the call connects.
   */
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
      await this.playSentence(greeting);
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
   * Play a single sentence through TTS.
   * Uses synthesizeStream if available (lower TTFAB — first audio arrives before synthesis completes).
   * Falls back to batch synthesize with 20ms pacing.
   */
  private async playSentence(text: string): Promise<void> {
    if (this.tts.synthesizeStream) {
      // Streaming path: accumulate small HTTP chunks into ~20ms blocks before forwarding
      let accum: Buffer[] = [];
      let accumSize = 0;

      const flush = (): void => {
        if (accum.length === 0 || this.closed) return;
        const pcm16k = Buffer.concat(accum);
        accum = [];
        accumSize = 0;
        const pcm8k  = downsample16to8(pcm16k);
        const mulaw  = encodeMulaw(pcm8k);
        for (let i = 0; i < mulaw.length; i += CHUNK_SIZE_MULAW) {
          if (!this.closed) this.config.onAudioOut(mulaw.slice(i, i + CHUNK_SIZE_MULAW));
        }
      };

      await this.tts.synthesizeStream(
        text,
        (chunk) => {
          if (this.closed) return;
          accum.push(chunk);
          accumSize += chunk.length;
          if (accumSize >= STREAM_ACCUM_BYTES) flush();
        },
        flush
      );
    } else {
      // Batch fallback: pace to real-time to avoid flooding the telephony buffer
      const ttsPcm16k = await this.tts.synthesize(text);
      const ttsPcm8k  = downsample16to8(ttsPcm16k);
      const ttsMusaw  = encodeMulaw(ttsPcm8k);
      for (let i = 0; i < ttsMusaw.length; i += CHUNK_SIZE_MULAW) {
        if (this.closed) break;
        this.config.onAudioOut(ttsMusaw.slice(i, i + CHUNK_SIZE_MULAW));
        await new Promise<void>((r) => setTimeout(r, 20));
      }
    }
  }

  private async flushAndProcess(): Promise<void> {
    if (this.isProcessing || this.audioBuffer.length === 0) return;

    const pcmChunks = this.audioBuffer.splice(0);
    const pcm8k = Buffer.concat(pcmChunks);
    if (pcm8k.length < MIN_SPEECH_BYTES) return;

    this.isProcessing = true;

    try {
      // ── 1. STT ─────────────────────────────────────────────────────────────
      const pcm16k = upsample8to16(pcm8k);
      logger.info({ callId: this.config.callId, bytes: pcm16k.length }, "Sending to STT");

      const transcript = await this.stt.transcribe(pcm16k, 16000);
      if (!transcript?.trim()) {
        logger.info({ callId: this.config.callId }, "Empty STT transcript, skipping");
        return;
      }

      logger.info({ callId: this.config.callId, transcript }, "STT result");
      this.config.onTranscript("user", transcript);
      this.conversationHistory.push({ role: "user", content: transcript });

      // ── 2+3. LLM sentence-streaming → TTS ─────────────────────────────────
      //
      // Architecture:
      //   • As LLM tokens arrive we detect sentence boundaries.
      //   • Each complete sentence is immediately pushed to a queue.
      //   • A single playback coroutine processes the queue sequentially —
      //     it plays each sentence via playSentence (streaming TTS) before
      //     moving to the next, maintaining natural ordering.
      //   • A Promise resolver ("wakePlayer") gives zero-delay notification
      //     when a new sentence is enqueued — no polling loop.
      //
      // Net effect: first TTS request fires the moment the LLM emits its first
      // sentence end, while the LLM is still generating the rest of the reply.

      let llmResponse   = "";
      let pendingText   = "";
      let allEnqueued   = false;

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
      const playTask = async (): Promise<void> => {
        let idx = 0;
        while (true) {
          if (idx < sentenceQueue.length) {
            const text = sentenceQueue[idx++];
            try {
              await this.playSentence(text);
            } catch (err) {
              logger.error(
                { callId: this.config.callId, err, text: text.slice(0, 40) },
                "TTS sentence error"
              );
            }
          } else if (allEnqueued) {
            break;
          } else {
            // Zero-overhead wait: resolved immediately when enqueue() is called
            await new Promise<void>((r) => { wakePlayer = r; });
          }
        }
      };

      const playPromise = playTask();

      // LLM streaming — detect sentence boundaries as tokens arrive
      await this.llm.chat(
        this.conversationHistory,
        this.agent.systemPrompt,
        (token) => {
          llmResponse += token;
          pendingText += token;
          const { sentences, remainder } = extractSentences(pendingText);
          for (const s of sentences) enqueue(s);
          pendingText = remainder;
        },
        async (fullText) => { llmResponse = fullText; }
      );

      // Flush any remainder that didn't end with punctuation
      const tail = pendingText.trim();
      if (tail.length >= 2) enqueue(tail);
      allEnqueued = true;
      // Wake player one last time in case it's waiting and the tail is the only item
      // Cast needed: TS ignores closure assignments so it thinks wakePlayer is always null
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
      logger.info({ callId: this.config.callId }, "Audio playback complete");

    } catch (err) {
      logger.error({ callId: this.config.callId, err }, "Pipeline error");
    } finally {
      this.isProcessing = false;
      if (this.audioBuffer.length > 0) void this.flushAndProcess();
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

// ── Sentence segmentation ──────────────────────────────────────────────────────
//
// Strategy (in priority order):
//   1. Standard sentence-end punctuation: . ! ?
//   2. Comma break: trigger after a comma when we have ≥60 chars already accumulated
//      (avoids tiny TTS calls while still reducing first-sentence latency)
//
// Returns the sentences found and the leftover partial text.

function extractSentences(text: string): { sentences: string[]; remainder: string } {
  const sentences: string[] = [];

  // Pass 1 — sentence-ending punctuation
  const re = /([^.!?]*[.!?]+)\s*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const s = m[1].trim();
    if (s.length >= 4) sentences.push(s);
    last = re.lastIndex;
  }
  let remainder = text.slice(last);

  // Pass 2 — comma break for long clauses (only when no sentence was found yet
  //           and the accumulated text is long enough to warrant an early TTS kick)
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
