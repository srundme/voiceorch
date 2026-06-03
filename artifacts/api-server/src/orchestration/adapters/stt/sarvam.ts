import { WebSocket } from "ws";
import { pcmToWav } from "../../audio.js";
import type { STTAdapter } from "./base.js";
import type { STTConfig, StreamSTT } from "../../types.js";
import { logger } from "../../../lib/logger.js";

/**
 * Sarvam AI — Speech-to-Text (batch + WebSocket streaming)
 * Batch:     POST https://api.sarvam.ai/speech-to-text
 * Streaming: wss://api.sarvam.ai/speech-to-text/ws
 *
 * Streaming is enabled automatically when model is saaras:v3 or saaras:v3-realtime.
 * Audio is sent as raw PCM16-LE binary frames (input_audio_codec=pcm_s16le, 16 kHz).
 * Response envelope: { type: "data"|"error"|"events", data: { transcript, ... } }
 */

const VALID_SARVAM_STT_MODELS = new Set([
  "saarika:v2.5", "saarika:v2", "saarika:v1", "saarika:flash",
  "saaras:v3", "saaras:v3-realtime",
]);
const DEFAULT_SARVAM_STT_MODEL = "saaras:v3";

/** Only these models support Sarvam's real-time WebSocket API. */
const STREAMING_MODELS = new Set(["saaras:v3", "saaras:v3-realtime"]);

/** All language codes Sarvam accepts (BCP 47 with -IN suffix). */
const VALID_SARVAM_LANG = new Set([
  "unknown",
  "hi-IN", "bn-IN", "kn-IN", "ml-IN", "mr-IN", "od-IN",
  "pa-IN", "ta-IN", "te-IN", "en-IN", "gu-IN", "as-IN",
  "ur-IN", "ne-IN", "kok-IN", "ks-IN", "sd-IN", "sa-IN",
  "sat-IN", "mni-IN", "brx-IN", "mai-IN", "doi-IN",
]);

/** Map bare ISO-639-1 codes → Sarvam BCP-47 equivalents. */
const LANG_REMAP: Record<string, string> = {
  en: "en-IN", hi: "hi-IN", bn: "bn-IN", kn: "kn-IN",
  ml: "ml-IN", mr: "mr-IN", pa: "pa-IN", ta: "ta-IN",
  te: "te-IN", gu: "gu-IN", ur: "ur-IN",
};

function normaliseSarvamLang(code: string | null): string {
  if (!code) return "en-IN";
  if (VALID_SARVAM_LANG.has(code)) return code;
  const remapped = LANG_REMAP[code.toLowerCase()];
  if (remapped) return remapped;
  const withIN = `${code}-IN`;
  if (VALID_SARVAM_LANG.has(withIN)) return withIN;
  return "en-IN";
}

interface SarvamStreamMsg {
  type?: string;
  data?: { transcript?: string; message?: string };
}

export class SarvamSTT implements STTAdapter {
  private readonly key: string;
  private readonly model: string;
  private readonly langCode: string;

  // Conditionally present — undefined for batch-only (saarika) models so the
  // pipeline's `if (stt.transcribeStream)` guard correctly bypasses streaming.
  transcribeStream?: STTAdapter["transcribeStream"];

  constructor(apiKey: string, model: string | null, cfg: STTConfig) {
    this.key = apiKey;
    const candidate = model ?? "";
    this.model = VALID_SARVAM_STT_MODELS.has(candidate) ? candidate : DEFAULT_SARVAM_STT_MODEL;
    this.langCode = normaliseSarvamLang(cfg.language);

    if (STREAMING_MODELS.has(this.model)) {
      this.transcribeStream = this.buildStreamingSession.bind(this);
    }
  }

  // ── Batch (REST) ────────────────────────────────────────────────────────────

  async transcribe(audioBuffer: Buffer, sampleRate = 16000): Promise<string> {
    const wav = pcmToWav(audioBuffer, sampleRate);

    const formData = new FormData();
    const wavAb = new ArrayBuffer(wav.byteLength);
    new Uint8Array(wavAb).set(wav);
    formData.append("file", new Blob([wavAb], { type: "audio/wav" }), "audio.wav");
    formData.append("model", this.model);
    formData.append("language_code", this.langCode);

    const resp = await fetch("https://api.sarvam.ai/speech-to-text", {
      method: "POST",
      headers: { "api-subscription-key": this.key },
      body: formData,
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Sarvam STT error ${resp.status}: ${err}`);
    }

    const json = (await resp.json()) as { transcript?: string };
    return json.transcript?.trim() ?? "";
  }

  // ── Streaming (WebSocket) ───────────────────────────────────────────────────

  private buildStreamingSession(
    onTranscript: (text: string, isFinal: boolean) => void,
    onClose?: () => void,
  ): StreamSTT {
    // saaras:v3-realtime is our UI label; the actual API model name is saaras:v3
    const apiModel = "saaras:v3";

    const params = new URLSearchParams({
      "language-code": this.langCode,
      model: apiModel,
      input_audio_codec: "pcm_s16le",
      sample_rate: "16000",
    });

    const wsUrl = `wss://api.sarvam.ai/speech-to-text/ws?${params.toString()}`;

    let wsReady = false;
    let closing = false;
    const audioQueue: Buffer[] = [];

    const ws = new WebSocket(wsUrl, {
      headers: { "api-subscription-key": this.key },
    });

    ws.on("open", () => {
      wsReady = true;
      for (const chunk of audioQueue.splice(0)) ws.send(chunk);
      logger.info(
        { model: apiModel, lang: this.langCode },
        "Sarvam streaming STT WebSocket opened",
      );
    });

    ws.on("message", (raw: Buffer) => {
      let msg: SarvamStreamMsg;
      try {
        msg = JSON.parse(raw.toString()) as SarvamStreamMsg;
      } catch {
        return;
      }

      if (msg.type === "error") {
        logger.warn({ err: msg.data?.message }, "Sarvam streaming STT error event");
        return;
      }

      // type === "events" carries VAD signals (speech_start / speech_end) — no transcript
      if (msg.type !== "data") return;

      const transcript = msg.data?.transcript?.trim();
      if (transcript) {
        logger.info({ text: transcript.slice(0, 80) }, "Sarvam streaming STT → transcript");
        onTranscript(transcript, true);
      }
    });

    ws.on("error", (err: unknown) => {
      logger.error({ err }, "Sarvam streaming STT WebSocket error");
    });

    ws.on("close", () => {
      logger.info("Sarvam streaming STT WebSocket closed");
      onClose?.();
    });

    return {
      sendAudio(chunk: Buffer): void {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(chunk);
        } else if (!wsReady && !closing) {
          audioQueue.push(chunk);
        }
      },
      close(): void {
        if (ws.readyState < WebSocket.CLOSING) {
          closing = true;
          // Send flush signal so Sarvam finalises any buffered partial transcript
          try { ws.send(JSON.stringify({ type: "flush" })); } catch { /* best-effort */ }
          ws.close();
        }
      },
    };
  }
}
