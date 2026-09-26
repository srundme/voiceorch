import { WebSocket } from "ws";
import type { STTAdapter } from "./base.js";
import type { STTConfig, StreamSTT } from "../../types.js";
import { logger } from "../../../lib/logger.js";
import { irfanPodBaseUrl } from "../irfan-pod-url.js";

/**
 * Streams phone audio to the GPU pod. Telephony is 8 kHz and the pod
 * resamples it. The pod decides when an utterance ends.
 */
export class IrfanPodSTT implements STTAdapter {
  constructor(
    private readonly _key: string,
    private readonly _model: string | null,
    private readonly _cfg: STTConfig,
  ) {}

  private sampleRate(given?: number): 8000 | 16000 {
    if (given === 8000 || given === 16000) return given;
    return this._cfg.nativeSampleRate === 8000 ? 8000 : 16000;
  }

  async transcribe(audioBuffer: Buffer, sampleRate?: number): Promise<string> {
    const rate = this.sampleRate(sampleRate);
    const resp = await fetch(`${irfanPodBaseUrl()}/v1/audio/transcriptions`, {
      method: "POST",
      headers: { "Content-Type": "audio/L16", "X-Sample-Rate": String(rate) },
      body: audioBuffer,
    });
    if (!resp.ok) {
      throw new Error(`Irfan pod STT HTTP ${resp.status}`);
    }
    const json = await resp.json() as { text?: string };
    return (json.text ?? "").trim();
  }

  transcribeStream(
    onTranscript: (text: string, isFinal: boolean) => void,
    onClose?: () => void,
  ): StreamSTT {
    const http = irfanPodBaseUrl();
    const wsUrl = `${http.replace(/^http/, "ws")}/v1/stt?rate=${this.sampleRate()}`;
    const pending: Buffer[] = [];
    let opened = false;
    let silenceMs = 600;
    let pendingControl: string | null = null;
    const ws = new WebSocket(wsUrl);

    const sendSilence = (ms: number) => {
      const next = Math.max(400, Math.min(3200, Math.round(ms)));
      if (next === silenceMs && pendingControl === null) return;
      silenceMs = next;
      const payload = JSON.stringify({ silence_ms: next });
      if (opened && ws.readyState === WebSocket.OPEN) ws.send(payload);
      else pendingControl = payload;
    };

    ws.on("open", () => {
      opened = true;
      if (pendingControl) {
        ws.send(pendingControl);
        pendingControl = null;
      }
      for (const chunk of pending.splice(0)) ws.send(chunk);
    });
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as { text?: string; is_final?: boolean };
        const text = (msg.text ?? "").trim();
        if (!text) return;
        onTranscript(text, Boolean(msg.is_final));
      } catch (err) {
        logger.warn({ err }, "Irfan pod STT: bad transcript message");
      }
    });
    ws.on("close", () => onClose?.());
    ws.on("error", (err) => {
      logger.warn({ err }, "Irfan pod STT socket error");
    });

    return {
      sendAudio(chunk: Buffer) {
        if (!opened || ws.readyState !== WebSocket.OPEN) {
          if (pending.length < 200) pending.push(chunk);
          return;
        }
        ws.send(chunk);
      },
      setSilenceDurationMs(ms: number) {
        sendSilence(ms);
      },
      close() {
        ws.close();
      },
    };
  }
}
