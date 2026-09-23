import { WebSocket } from "ws";
import type { STTAdapter } from "./base.js";
import type { StreamSTT } from "../../types.js";
import { logger } from "../../../lib/logger.js";

function voiceCpuUrl(): string {
  return (process.env["VOICE_CPU_URL"] || "http://127.0.0.1:8090").replace(/\/$/, "");
}

function voiceCpuWs(): string {
  const url = new URL(voiceCpuUrl());
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/stt";
  return url.toString();
}

/**
 * Streams 16-bit PCM to the CPU voice service (Moonshine).
 * The service emits { text, final } while the caller is still speaking.
 */
export class MoonshineSTT implements STTAdapter {
  constructor(private readonly sampleRate = 16000) {}

  async transcribe(): Promise<string> {
    throw new Error("MoonshineSTT batch transcribe is not used on live calls");
  }

  transcribeStream(
    onTranscript: (text: string, isFinal: boolean) => void,
    onClose?: () => void,
  ): StreamSTT {
    const ws = new WebSocket(voiceCpuWs());
    let opened = false;
    const pending: Buffer[] = [];
    ws.on("open", () => {
      opened = true;
      ws.send(JSON.stringify({ sampleRate: this.sampleRate }));
      for (const chunk of pending) ws.send(chunk);
      pending.length = 0;
    });
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as { text?: string; final?: boolean; error?: string };
        if (msg.error) {
          logger.warn({ err: msg.error }, "moonshine stt error");
          return;
        }
        if (msg.text) onTranscript(msg.text, !!msg.final);
      } catch {
        /* ignore non-json */
      }
    });
    ws.on("close", () => onClose?.());
    ws.on("error", (err) => {
      logger.warn({ err }, "moonshine stt socket error");
      onClose?.();
    });
    return {
      sendAudio(chunk: Buffer) {
        if (!opened || ws.readyState !== WebSocket.OPEN) {
          pending.push(chunk);
          return;
        }
        ws.send(chunk);
      },
      close() {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "close" }));
          ws.close();
        }
      },
    };
  }
}
