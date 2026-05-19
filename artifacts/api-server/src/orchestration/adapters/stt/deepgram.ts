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

    if (this.cfg.language) params.set("language", this.cfg.language);

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
    onTranscript: (text: string, isFinal: boolean) => void
  ): StreamSTT {
    const model = this.model ?? "nova-2";
    const useSmartEndpointing = this.cfg.smartEndpointing !== "off";

    const params = new URLSearchParams({
      model,
      encoding: "linear16",
      sample_rate: "16000",
      channels: "1",
      punctuate: "true",
      smart_format: "true",
    });

    if (this.cfg.language) params.set("language", this.cfg.language);

    if (useSmartEndpointing) {
      // VAPI/LiveKit mode — use Deepgram's VAD utterance-end events (ML-based endpointing)
      params.set("vad_events", "true");
      params.set("utterance_end_ms", String(this.cfg.endOfTurnTimeout));
      params.set("interim_results", "true");
      logger.info(
        { mode: this.cfg.smartEndpointing, utterance_end_ms: this.cfg.endOfTurnTimeout },
        "Deepgram: smart endpointing enabled (utterance_end_ms)"
      );
    } else {
      // Standard silence-based endpointing
      params.set("endpointing", String(this.cfg.endOfTurnTimeout));
    }

    for (const term of this.cfg.keyterms) {
      params.append("keywords", `${term}:2`);
    }

    const wsUrl = `wss://api.deepgram.com/v1/listen?${params.toString()}`;

    let wsReady = false;
    const audioQueue: Buffer[] = [];
    let pendingInterim = "";

    const ws = new WebSocket(wsUrl, {
      headers: { Authorization: `Token ${this.key}` },
    });

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

      // ── UtteranceEnd event (smart endpointing: vapi/livekit mode) ──────────
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
      logger.info("Deepgram streaming STT WebSocket closed");
    });

    return {
      sendAudio(chunk: Buffer): void {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(chunk);
        } else if (!wsReady) {
          audioQueue.push(chunk);
        }
      },
      close(): void {
        if (ws.readyState < WebSocket.CLOSING) ws.close();
      },
    };
  }
}
