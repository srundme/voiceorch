import { WebSocket } from "ws";
import type { STTAdapter } from "./base.js";
import type { STTConfig, StreamSTT } from "../../types.js";
import { logger } from "../../../lib/logger.js";

interface DeepgramBatchResult {
  results?: {
    channels?: Array<{
      alternatives?: Array<{ transcript: string; confidence: number }>;
    }>;
  };
}

interface DeepgramStreamMessage {
  type?: string;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: {
    alternatives?: Array<{ transcript: string; confidence: number }>;
  };
}

/**
 * Deepgram accepts regional English variants (en-US, en-IN, etc.) and a handful
 * of other full locale codes, but for most non-English languages it only accepts
 * the bare ISO-639-1 code (e.g. "hi" not "hi-IN", "ta" not "ta-IN").
 * Passing an unsupported BCP-47 tag causes the streaming WS to close immediately.
 */
const DEEPGRAM_FULL_LOCALES = new Set([
  "en", "en-US", "en-AU", "en-GB", "en-NZ", "en-IN", "en-IE",
  "es-419", "es-LATAM", "es-US",
  "fr-CA",
  "pt-BR", "pt-PT",
  "zh-CN", "zh-TW",
]);

function normaliseDeepgramLang(code: string | null): string | null {
  if (!code) return null;
  if (DEEPGRAM_FULL_LOCALES.has(code)) return code;
  // For everything else (e.g. "hi-IN", "ta-IN", "kn-IN") strip to bare code.
  // Deepgram Nova-2 supports hi, ta, te, kn, ml, ur, vi, id, ms, ar, fa etc.
  // as bare language codes; regional suffixes cause a WS close.
  const bare = code.split("-")[0];
  return bare ?? code;
}

export class DeepgramSTT implements STTAdapter {
  constructor(
    private readonly key: string,
    private readonly model: string | null,
    private readonly cfg: STTConfig
  ) {}

  async transcribe(audioBuffer: Buffer, sampleRate = 16000): Promise<string> {
    const model = this.model ?? "nova-2";
    const params = new URLSearchParams({
      model,
      punctuate: "true",
      smart_format: "true",
      encoding: "linear16",
      sample_rate: String(sampleRate),
    });

    const dgLangBatch = normaliseDeepgramLang(this.cfg.language ?? null);
    if (dgLangBatch) params.set("language", dgLangBatch);
    if (this.cfg.backgroundDenoising) params.set("noise_reduction", "true");

    for (const term of this.cfg.keyterms) {
      params.append("keywords", `${term}:2`);
    }

    const resp = await fetch(
      `https://api.deepgram.com/v1/listen?${params.toString()}`,
      {
        method: "POST",
        headers: {
          Authorization: `Token ${this.key}`,
          "Content-Type": "audio/raw",
        },
        body: audioBuffer,
      }
    );

    if (!resp.ok) {
      throw new Error(`Deepgram HTTP ${resp.status}: ${await resp.text()}`);
    }

    const json = (await resp.json()) as DeepgramBatchResult;
    const alt = json.results?.channels?.[0]?.alternatives?.[0];
    if (!alt?.transcript) return "";

    if (alt.confidence < this.cfg.confidenceThreshold) {
      logger.info(
        { confidence: alt.confidence, threshold: this.cfg.confidenceThreshold },
        "Deepgram batch: transcript filtered by confidence"
      );
      return "";
    }

    return alt.transcript;
  }

  transcribeStream(
    onTranscript: (text: string, isFinal: boolean) => void,
    onClose?: () => void,
  ): StreamSTT {
    const model = this.model ?? "nova-2";
    const useSmartEndpointing = this.cfg.smartEndpointing !== "off";

    const params = new URLSearchParams({
      model,
      encoding: "linear16",
      sample_rate: String(this.cfg.nativeSampleRate ?? 16000),
      channels: "1",
      punctuate: "true",
      smart_format: "true",
    });

    const dgLang = normaliseDeepgramLang(this.cfg.language ?? null);
    if (dgLang) params.set("language", dgLang);
    if (this.cfg.backgroundDenoising) params.set("noise_reduction", "true");

    if (useSmartEndpointing) {
      // VAPI / utterance-end mode — Deepgram's VAD events (ML-based endpointing)
      // Prefer Latency Tuning UI (endpointingSilenceMs) over legacy endOfTurnTimeout.
      const utteranceEndMs = Math.min(
        this.cfg.endpointingSilenceMs ?? this.cfg.endOfTurnTimeout,
        5000,
      );
      params.set("vad_events", "true");
      params.set("utterance_end_ms", String(utteranceEndMs));
      params.set("interim_results", "true");
      logger.info(
        { mode: this.cfg.smartEndpointing, utterance_end_ms: utteranceEndMs },
        "Deepgram: smart endpointing enabled (utterance_end_ms)"
      );
    } else {
      // Standard silence-based endpointing — Deepgram caps at 2000 ms;
      // values above 2000 cause the WS to close immediately.
      const endpointing = Math.min(
        this.cfg.endpointingSilenceMs ?? this.cfg.endOfTurnTimeout,
        2000,
      );
      params.set("endpointing", String(endpointing));
    }

    for (const term of this.cfg.keyterms) {
      params.append("keywords", `${term}:2`);
    }

    const wsUrl = `wss://api.deepgram.com/v1/listen?${params.toString()}`;

    let wsReady = false;
    const audioQueue: Buffer[] = [];
    const MAX_AUDIO_QUEUE = 200;
    let pendingInterim = "";

    const ws = new WebSocket(wsUrl, {
      headers: { Authorization: `Token ${this.key}` },
    });

    // Deepgram closes idle connections after ~10 s of no audio.
    // Send a KeepAlive frame every 8 s so the WS stays open during the
    // agent's greeting / TTS playback when the user isn't speaking yet.
    const keepAliveInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "KeepAlive" }));
      }
    }, 8_000);

    ws.on("open", () => {
      wsReady = true;
      for (const chunk of audioQueue.splice(0)) ws.send(chunk);
      logger.info(
        { model, smartEndpointing: this.cfg.smartEndpointing },
        "Deepgram streaming STT WebSocket opened"
      );
    });

    ws.on("message", (raw: Buffer) => {
      let msg: DeepgramStreamMessage & { type?: string };
      try {
        msg = JSON.parse(raw.toString()) as DeepgramStreamMessage;
      } catch {
        return;
      }

      // ── UtteranceEnd event (smart endpointing: vapi / utterance-end mode) ──
      if (msg.type === "UtteranceEnd" && useSmartEndpointing) {
        const text = pendingInterim.trim();
        pendingInterim = "";
        if (text) {
          logger.info({ text: text.slice(0, 60) }, "Deepgram UtteranceEnd → flush transcript");
          onTranscript(text, true);
        }
        return;
      }

      if (msg.type !== "Results") return;

      const alt = msg.channel?.alternatives?.[0];
      if (!alt?.transcript) return;

      const confidence = alt.confidence ?? 1;

      if (useSmartEndpointing) {
        // In smart mode: accumulate interim results, flush on UtteranceEnd
        if (msg.is_final) {
          if (confidence >= this.cfg.confidenceThreshold) {
            pendingInterim += (pendingInterim ? " " : "") + alt.transcript;
          } else {
            logger.info(
              { confidence, threshold: this.cfg.confidenceThreshold },
              "Deepgram stream: interim filtered by confidence"
            );
          }
        }
      } else {
        // Standard mode: emit on speech_final + is_final
        if (msg.speech_final && msg.is_final) {
          if (confidence < this.cfg.confidenceThreshold) {
            logger.info(
              { confidence, threshold: this.cfg.confidenceThreshold },
              "Deepgram stream: transcript filtered by confidence"
            );
            return;
          }
          const text = alt.transcript.trim();
          if (text) onTranscript(text, true);
        }
      }
    });

    ws.on("error", (err: unknown) => {
      logger.error({ err }, "Deepgram streaming STT error");
    });

    ws.on("close", () => {
      clearInterval(keepAliveInterval);
      logger.info("Deepgram streaming STT WebSocket closed");
      onClose?.();
    });

    return {
      sendAudio(chunk: Buffer): void {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(chunk);
        } else if (!wsReady || ws.readyState === WebSocket.CONNECTING) {
          if (audioQueue.length < MAX_AUDIO_QUEUE) audioQueue.push(chunk);
        }
      },
      close(): void {
        clearInterval(keepAliveInterval);
        if (ws.readyState < WebSocket.CLOSING) ws.close();
      },
    };
  }
}
