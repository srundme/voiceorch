/**
 * Sarvam AI — Speech-to-Text
 *
 * Batch:     POST https://api.sarvam.ai/speech-to-text
 * Streaming: wss://api.sarvam.ai/speech-to-text/ws
 *
 * Official docs:
 *   https://docs.sarvam.ai/api-reference-docs/speech-to-text/apis/streaming
 *
 * ── WebSocket connection parameters (query string) ───────────────────────────
 *   model               "saaras:v3" (recommended) | "saarika:v2.5" (legacy)
 *   language_code       BCP-47, e.g. "ta-IN", "hi-IN", "en-IN"
 *   mode                "transcribe" | "codemix" | "verbatim" | "translit"
 *                       (saaras:v3 only; codemix handles Tamil+English mixing)
 *   sample_rate         16000 (default) | 8000
 *   input_audio_codec   "pcm_s16le" | "wav"
 *   high_vad_sensitivity true → 0.5 s silence boundary (snappier for voice agents)
 *   vad_signals         true → emits START_SPEECH / END_SPEECH events
 *
 * ── Auth ─────────────────────────────────────────────────────────────────────
 *   Header: api-subscription-key: <key>
 *
 * ── Audio message (JSON text, sent as each PCM chunk arrives) ────────────────
 *   { audio: { data: "<base64 raw PCM>", encoding: "audio/wav", sample_rate: 16000 } }
 *   NOTE: encoding enum MUST be "audio/wav" — "pcm_s16le" is rejected by Sarvam's
 *   Pydantic model even though the URL param `input_audio_codec=pcm_s16le` sets
 *   the actual codec. Confirmed via live WebSocket probe (June 2026).
 *
 * ── Server → client messages (JSON text) ─────────────────────────────────────
 *   { type: "events", data: { signal_type: "START_SPEECH" | "END_SPEECH" } }
 *   { type: "data",   data: { transcript: string } }
 *
 * ── Close codes ──────────────────────────────────────────────────────────────
 *   1000 Normal closure (intentional)
 *   1001 Going away        — reconnect
 *   1006 Abnormal (no close frame) — reconnect with backoff
 *   1011 Server error      — reconnect with backoff
 *   4xxx Auth / quota      — do NOT retry; fix first
 */

import { WebSocket } from "ws";
import { pcmToWav } from "../../audio.js";
import type { STTAdapter, SttFinalMetadata } from "./base.js";
import type { STTConfig, StreamSTT } from "../../types.js";
import { logger } from "../../../lib/logger.js";

const BATCH_URL = "https://api.sarvam.ai/speech-to-text";
const WS_BASE   = "wss://api.sarvam.ai/speech-to-text/ws";

/** Only saaras:v3 supports the `mode` parameter. */
const MODE_CAPABLE = new Set(["saaras:v3"]);

/** BCP-47 codes accepted by Sarvam (note: Odia uses od-IN, not or-IN). */
const VALID_LANG = new Set([
  "bn-IN", "en-IN", "gu-IN", "hi-IN", "kn-IN",
  "ml-IN", "mr-IN", "od-IN", "pa-IN", "ta-IN", "te-IN",
]);

/** ISO-639-1 bare codes → Sarvam BCP-47. */
const LANG_MAP: Record<string, string> = {
  bn: "bn-IN", en: "en-IN", gu: "gu-IN", hi: "hi-IN",
  kn: "kn-IN", ml: "ml-IN", mr: "mr-IN",
  or: "od-IN", od: "od-IN",             // Odia: BCP-47 is or-IN but Sarvam uses od-IN
  pa: "pa-IN", ta: "ta-IN", te: "te-IN",
};

function normaliseLang(code: string | null | undefined): string {
  if (!code) return "en-IN";
  const t = code.trim();
  if (VALID_LANG.has(t)) return t;
  const bare = t.split("-")[0]?.toLowerCase() ?? "";
  const mapped = LANG_MAP[bare];
  if (mapped) return mapped;
  logger.warn({ rawLang: code }, "Sarvam STT: unrecognised language — falling back to en-IN");
  return "en-IN";
}

interface SarvamMsg {
  type: string;
  data?: { transcript?: string; signal_type?: string; message?: string };
}

export class SarvamSTT implements STTAdapter {
  private readonly key: string;
  private readonly model: string;
  private readonly langCode: string;
  private readonly mode: string;
  private readonly cfg: STTConfig;

  constructor(
    apiKey: string,
    model: string | null,
    extraConfig: string | null,
    cfg: STTConfig,
  ) {
    this.key = apiKey;
    this.cfg = cfg;

    const extra = extraConfig
      ? (JSON.parse(extraConfig) as { mode?: string })
      : {};

    // Model: saaras:v3 is recommended; saarika:v2.5 / saaras:v2.5 are legacy.
    const requested = (model ?? "").trim();
    this.model = ["saaras:v3", "saarika:v2.5", "saaras:v2.5"].includes(requested)
      ? requested
      : "saaras:v3";

    this.langCode = normaliseLang(cfg.language);

    // Default mode: codemix handles Tamil+English code-switching naturally.
    // Only saaras:v3 supports mode; legacy models ignore it.
    this.mode = MODE_CAPABLE.has(this.model) ? (extra.mode ?? "codemix") : "transcribe";
  }

  // ── Batch REST ──────────────────────────────────────────────────────────────

  async transcribe(audioBuffer: Buffer, sampleRate = 16000): Promise<string> {
    const wav = pcmToWav(audioBuffer, sampleRate);

    const formData = new FormData();
    // Copy into a plain ArrayBuffer to avoid SharedArrayBuffer incompatibility with Blob.
    const wavBuf = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer;
    formData.append("file", new Blob([wavBuf], { type: "audio/wav" }), "audio.wav");
    formData.append("model", this.model === "saaras:v3" ? "saaras:v3" : "saarika:v2.5");
    formData.append("language_code", this.langCode);

    const resp = await fetch(BATCH_URL, {
      method: "POST",
      headers: { "api-subscription-key": this.key },
      body: formData,
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Sarvam STT batch error ${resp.status}: ${err}`);
    }

    const json = (await resp.json()) as { transcript?: string };
    return (json.transcript ?? "").trim();
  }

  // ── Streaming WebSocket ─────────────────────────────────────────────────────

  transcribeStream(
    onTranscript: (
      text: string,
      isFinal: boolean,
      detectedLanguage?: string,
      metadata?: SttFinalMetadata,
    ) => void,
    onClose?: () => void,
  ): StreamSTT {
    // Capture class fields as locals so closures (plain object methods, nested
    // functions) can reference them without relying on `this` binding.
    const langCode = this.langCode;
    const model    = this.model;
    const mode     = this.mode;
    const key      = this.key;

    const params = new URLSearchParams({
      model:              model,
      language_code:      langCode,
      sample_rate:        "16000",
      input_audio_codec:  "pcm_s16le",
      high_vad_sensitivity: "true",  // 0.5 s silence boundary — snappier for voice agents
      vad_signals:        "true",    // emit START_SPEECH / END_SPEECH events
      flush_signal:       "true",    // allow manual buffer flush via flush() call
    });

    if (MODE_CAPABLE.has(model)) {
      params.set("mode", mode);
    }

    const wsUrl = `${WS_BASE}?${params.toString()}`;

    let ws: WebSocket;
    let wsReady = false;
    let intentionallyClosed = false;
    let reconnectAttempts = 0;
    const MAX_RECONNECT = 10;

    const audioQueue: Buffer[] = [];
    let speechEndAt = 0; // timestamp of last END_SPEECH event for latency tracking

    const sendChunk = (chunk: Buffer) => {
      if (!wsReady || ws.readyState !== WebSocket.OPEN) return;
      ws.send(
        JSON.stringify({
          audio: {
            data:        chunk.toString("base64"),
            encoding:    "audio/wav",   // enum must be "audio/wav"; actual codec is set via URL param
            sample_rate: 16000,
          },
        }),
      );
    };

    const openSocket = () => {
      wsReady = false;

      ws = new WebSocket(wsUrl, {
        headers: { "api-subscription-key": key },
      });

      ws.on("open", () => {
        wsReady = true;
        reconnectAttempts = 0;
        logger.info(
          { langCode, model, mode },
          "Sarvam streaming STT: WebSocket opened",
        );
        // Flush any audio that arrived before the socket was ready.
        for (const chunk of audioQueue.splice(0)) sendChunk(chunk);
      });

      ws.on("message", (raw: Buffer | string) => {
        let msg: SarvamMsg;
        try {
          msg = JSON.parse(raw.toString()) as SarvamMsg;
        } catch {
          return; // ignore non-JSON frames
        }

        // VAD signals — official type values: "speech_start" / "speech_end"
        // (legacy guessed values "events" + signal_type also handled for safety)
        if (msg.type === "speech_start" || (msg.type === "events" && msg.data?.signal_type === "START_SPEECH")) {
          logger.debug({ langCode }, "Sarvam STT: speech start");
          return;
        }
        if (msg.type === "speech_end" || (msg.type === "events" && msg.data?.signal_type === "END_SPEECH")) {
          speechEndAt = Date.now();
          logger.debug({ langCode }, "Sarvam STT: speech end");
          return;
        }

        // Final transcript — official type: "transcript"; legacy: "data"
        if (msg.type === "transcript" || msg.type === "data") {
          const text = (msg.data?.transcript ?? "").trim();
          if (!text) return;
          const meta: SttFinalMetadata = {
            endDetectToFinalMs: speechEndAt > 0 ? Date.now() - speechEndAt : undefined,
          };
          logger.info(
            {
              text: text.slice(0, 80),
              model,
              mode,
              endDetectToFinalMs: meta.endDetectToFinalMs,
            },
            "Sarvam STT: final transcript",
          );
          speechEndAt = 0;
          onTranscript(text, true, undefined, meta);
          return;
        }

        if (msg.type === "error") {
          logger.error({ msg: msg.data?.message, langCode }, "Sarvam STT: server error");
        }
      });

      ws.on("close", (code, reason) => {
        wsReady = false;

        if (intentionallyClosed) {
          onClose?.();
          return;
        }

        // Auth / quota errors: do not retry.
        if (code >= 4000 && code < 5000) {
          logger.error(
            { code, reason: reason.toString() },
            "Sarvam STT: auth/quota close — not retrying",
          );
          onClose?.();
          return;
        }

        if (reconnectAttempts >= MAX_RECONNECT) {
          logger.error({ code, reconnectAttempts }, "Sarvam STT: max reconnects reached");
          onClose?.();
          return;
        }

        // Exponential backoff: 500ms, 1s, 2s, 4s … capped at 8s.
        const delay = Math.min(500 * 2 ** reconnectAttempts, 8000);
        reconnectAttempts++;
        logger.warn(
          { code, delay, reconnectAttempts },
          "Sarvam STT: WebSocket closed — reconnecting",
        );
        setTimeout(openSocket, delay);
      });

      ws.on("error", (err) => {
        logger.error({ err }, "Sarvam STT: WebSocket error");
      });
    };

    openSocket();

    return {
      sendAudio(chunk: Buffer): void {
        if (!wsReady || ws.readyState !== WebSocket.OPEN) {
          audioQueue.push(chunk);
        } else {
          sendChunk(chunk);
        }
      },
      flush(): void {
        // Ask Sarvam to immediately finalize its internal audio buffer.
        // Useful when we know the caller has finished speaking and want a
        // transcript without waiting for VAD silence detection.
        if (!wsReady || ws.readyState !== WebSocket.OPEN) return;
        const emptyData = Buffer.alloc(0);
        ws.send(
          JSON.stringify({
            audio: {
              data:        emptyData.toString("base64"),
              encoding:    "audio/wav",
              sample_rate: 16000,
            },
            flush: true,
          }),
        );
        logger.debug({ langCode }, "Sarvam STT: flush signal sent");
      },
      close(): void {
        intentionallyClosed = true;
        if (
          ws.readyState === WebSocket.OPEN ||
          ws.readyState === WebSocket.CONNECTING
        ) {
          ws.close(1000);
        }
      },
    };
  }
}
