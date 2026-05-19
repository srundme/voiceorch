import { WebSocket } from "ws";
import type { STTAdapter } from "./base.js";
import type { StreamSTT } from "../../types.js";
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
    private readonly noiseCancellation = false
  ) {}

  async transcribe(audioBuffer: Buffer, sampleRate = 16000): Promise<string> {
    const model = this.model ?? "nova-2";
    const url = [
      "https://api.deepgram.com/v1/listen",
      `?model=${encodeURIComponent(model)}`,
      `&punctuate=true&smart_format=true`,
      `&encoding=linear16&sample_rate=${sampleRate}`,
      this.noiseCancellation ? "&filler_words=false&numerals=true" : "",
    ].join("");

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Token ${this.key}`,
        "Content-Type": "audio/raw",
      },
      body: audioBuffer,
    });

    if (!resp.ok) {
      throw new Error(`Deepgram HTTP ${resp.status}: ${await resp.text()}`);
    }

    const json = await resp.json() as DeepgramBatchResult;
    return json.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
  }

  transcribeStream(
    onTranscript: (text: string, isFinal: boolean) => void
  ): StreamSTT {
    const model = this.model ?? "nova-2";
    const params = new URLSearchParams({
      model,
      encoding: "linear16",
      sample_rate: "16000",
      channels: "1",
      punctuate: "true",
      smart_format: "true",
      endpointing: "300",
      ...(this.noiseCancellation ? { filler_words: "false", numerals: "true" } : {}),
    });
    const wsUrl = `wss://api.deepgram.com/v1/listen?${params.toString()}`;

    let wsReady = false;
    const audioQueue: Buffer[] = [];

    const ws = new WebSocket(wsUrl, {
      headers: { Authorization: `Token ${this.key}` },
    });

    ws.on("open", () => {
      wsReady = true;
      for (const chunk of audioQueue.splice(0)) {
        ws.send(chunk);
      }
      logger.info("Deepgram streaming STT WebSocket opened");
    });

    ws.on("message", (raw: Buffer) => {
      let msg: DeepgramStreamMessage;
      try {
        msg = JSON.parse(raw.toString()) as DeepgramStreamMessage;
      } catch {
        return;
      }
      if (
        msg.type === "Results" &&
        msg.speech_final === true &&
        msg.is_final === true
      ) {
        const text = msg.channel?.alternatives?.[0]?.transcript ?? "";
        if (text.trim()) {
          onTranscript(text, true);
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
        if (ws.readyState < WebSocket.CLOSING) {
          ws.close();
        }
      },
    };
  }
}
