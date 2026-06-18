import { WebSocket } from "ws";
import { randomUUID } from "crypto";
import { pcmToWav } from "../../audio.js";
import type { STTAdapter } from "./base.js";
import type { STTConfig, StreamSTT } from "../../types.js";
import { logger } from "../../../lib/logger.js";

// ── Azure Speech WebSocket framing ─────────────────────────────────────────
//
// Every message TO Azure (text or binary) MUST include X-RequestId.
// Use a single UUID per streaming session — all frames within one connection
// share the same requestId.  Omitting X-RequestId causes a 1002 close.
//
// Text messages (speech.config, speech.context):
//   "Path: <path>\r\nX-RequestId: <uuid>\r\nX-Timestamp: <iso>\r\nContent-Type: application/json; charset=utf-8\r\n\r\n<json>"
//
// Binary messages (audio chunks):
//   [2-byte big-endian header length][header string bytes][raw PCM bytes]
//   Header string: "Path: audio\r\nX-RequestId: <uuid>\r\nX-Timestamp: <iso>\r\nContent-Type: audio/x-raw;format=PCM;bit=16;channels=1;samplerate=16000\r\n"
//
// Received text messages carry a "Path:" header indicating the event type.
// ─────────────────────────────────────────────────────────────────────────────

/** Build a text-frame for speech.config / speech.context. */
function textFrame(path: string, body: string, requestId: string): string {
  return (
    `Path: ${path}\r\n` +
    `X-RequestId: ${requestId}\r\n` +
    `X-Timestamp: ${new Date().toISOString()}\r\n` +
    `Content-Type: application/json; charset=utf-8\r\n` +
    `\r\n${body}`
  );
}

/** Build a binary audio frame for raw 16-bit / 16 kHz / mono PCM. */
function audioFrame(pcm: Buffer, requestId: string): Buffer {
  const hdr = Buffer.from(
    `Path: audio\r\n` +
    `X-RequestId: ${requestId}\r\n` +
    `X-Timestamp: ${new Date().toISOString()}\r\n` +
    `Content-Type: audio/x-raw;format=PCM;bit=16;channels=1;samplerate=16000\r\n`,
    "utf8",
  );
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16BE(hdr.length, 0);
  return Buffer.concat([lenBuf, hdr, pcm]);
}

/** Extract the Path value and body from a received text frame. */
function parseFrame(raw: string): { path: string; body: string } | null {
  const sep = raw.indexOf("\r\n\r\n");
  if (sep === -1) return null;
  const headers = raw.slice(0, sep);
  const body = raw.slice(sep + 4);
  const m = headers.match(/Path:\s*(\S+)/i);
  return m ? { path: m[1]!.toLowerCase(), body } : null;
}

// ── Response types ─────────────────────────────────────────────────────────

interface AzurePhraseBody {
  RecognitionStatus?: string;
  DisplayText?: string;
  NBest?: Array<{ Confidence?: number; Display?: string; Language?: string }>;
}

interface AzureHypothesisBody {
  Text?: string;
}

// ── Adapter ────────────────────────────────────────────────────────────────

/**
 * Azure Cognitive Services — Speech-to-Text
 *
 * Implements both:
 *  • Batch REST      → `transcribe()`         (short utterances, ≤ 15 s)
 *  • Streaming WS    → `transcribeStream()`   (continuous, real-time)
 *
 * extraConfig JSON fields:
 *   region      — Azure region slug, e.g. "eastus" (default: "eastus")
 *   endpointId  — Custom model endpoint ID (optional)
 *
 * Language comes from STTConfig.language; falls back to extraConfig.language
 * then "en-US".
 */
/**
 * On the v1 conversation endpoint the `model` query param is interpreted as a
 * custom Speech deployment ID — a GUID — NOT a base-model label. Azure derives
 * the correct base model from the `language` locale automatically, so we must
 * never forward label-style model strings (e.g. "en-US-standard"). Only a
 * genuine GUID is accepted, and it is passed via `endpointId`.
 */
const GUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Short ISO-639-1 codes → full IETF BCP-47 locales that Azure accepts.
// Azure requires full locale tags (e.g. "hi-IN") on the STT endpoint;
// bare language codes ("hi", "en") are silently mis-handled.
const LOCALE_MAP: Record<string, string> = {
  "hi": "hi-IN", "en": "en-IN", "ta": "ta-IN", "te": "te-IN",
  "kn": "kn-IN", "ml": "ml-IN", "mr": "mr-IN", "bn": "bn-IN",
  "gu": "gu-IN", "pa": "pa-IN", "or": "or-IN", "ur": "ur-IN",
  "fr": "fr-FR", "de": "de-DE", "es": "es-ES", "pt": "pt-BR",
  "it": "it-IT", "ja": "ja-JP", "ko": "ko-KR", "zh": "zh-CN",
  "ar": "ar-EG", "ru": "ru-RU",
};


/** Expand a short code ("hi") or already-full locale ("hi-IN") to the
 *  canonical IETF tag Azure requires.
 *
 *  Sanitizes model-style suffixes that users sometimes paste into the language
 *  field (e.g. "en-IN-standard", "ta-IN-neural").  Azure locale tags are
 *  always "ll-RR" (two dash-separated segments); extra segments cause Azure
 *  to reject the locale, producing empty transcripts and a stuck
 *  "Listening…" state.  We take only the first two segments.
 */
function normalizeLocale(lang: string): string {
  if (!lang) return "en-IN";
  // Canonicalize to "language-Region" — strip any extra segments such as
  // "-standard", "-neural", "-preview" that are Azure model labels, not
  // BCP-47 locale identifiers.
  const parts = lang.split("-");
  const canonical = parts.length >= 2 ? `${parts[0]!}-${parts[1]!}` : lang;
  if (canonical.includes("-")) return canonical;
  return LOCALE_MAP[canonical.toLowerCase()] ?? `${canonical}-${canonical.toUpperCase()}`;
}

export class AzureSTT implements STTAdapter {
  private readonly key: string;
  private readonly region: string;
  private readonly language: string;
  private readonly endpointId: string | null;
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
      ? (JSON.parse(extraConfig) as {
          region?: string;
          language?: string;
          endpointId?: string;
        })
      : {};

    this.region = extra.region ?? "eastus";
    const rawLang = cfg.language ?? extra.language ?? "en-IN";
    this.language = normalizeLocale(rawLang);

    // A custom deployment is only honored when a real GUID is supplied — either
    // explicitly via extraConfig.endpointId or as a GUID-shaped asrModel.
    // Base-model labels from the model picker are ignored (Azure auto-selects
    // the base model from `language`).
    const guidModel = model && GUID_RE.test(model.trim()) ? model.trim() : null;
    this.endpointId = extra.endpointId ?? guidModel ?? null;
  }

  // ── Batch REST ────────────────────────────────────────────────────────────

  /** Build shared URL params for both batch and streaming endpoints. */
  private buildParams(): URLSearchParams {
    const params = new URLSearchParams({ language: this.language, format: "detailed" });
    if (this.endpointId) params.set("endpointId", this.endpointId);
    return params;
  }

  async transcribe(audioBuffer: Buffer, sampleRate = 16000): Promise<string> {
    const wav = pcmToWav(audioBuffer, sampleRate);

    const params = this.buildParams();

    const url =
      `https://${this.region}.stt.speech.microsoft.com/speech/recognition/` +
      `conversation/cognitiveservices/v1?${params.toString()}`;

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": this.key,
        "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
        Accept: "application/json",
      },
      body: wav,
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Azure STT error ${resp.status}: ${err}`);
    }

    const json = (await resp.json()) as AzurePhraseBody;

    if (json.RecognitionStatus !== "Success") {
      logger.info(
        { status: json.RecognitionStatus },
        "Azure STT batch: non-success recognition status",
      );
      return "";
    }

    // RecognitionStatus=Success is the primary gate for Azure batch.
    // Confidence scores in batch mode are unreliable (especially for
    // Indic languages) and should not be used to filter valid speech.
    // We only discard if the result text itself is empty.
    const best = json.NBest?.[0];
    const text = (best?.Display ?? json.DisplayText ?? "").trim();
    if (!text) return "";

    logger.info(
      { confidence: best?.Confidence, language: this.language },
      "Azure STT batch: transcript accepted",
    );
    return text;
  }

  // ── Streaming WebSocket ───────────────────────────────────────────────────

  transcribeStream(
    onTranscript: (text: string, isFinal: boolean, detectedLanguage?: string) => void,
    onClose?: () => void,
  ): StreamSTT {
    const params = this.buildParams();

    const wsUrl =
      `wss://${this.region}.stt.speech.microsoft.com/speech/recognition/` +
      `conversation/cognitiveservices/v1?${params.toString()}`;

    // Mutable socket state — replaced on reconnect.
    let ws: WebSocket;
    let wsReady = false;
    let intentionallyClosed = false;
    let reconnectAttempts = 0;
    let currentRequestId = "";
    const MAX_RECONNECT_ATTEMPTS = 10;
    const audioQueue: Buffer[] = [];

    const openSocket = () => {
      // Each Azure connection needs its own requestId — shared across all
      // frames within a single connection, replaced on reconnect.
      const requestId = randomUUID().replace(/-/g, "").toUpperCase();
      currentRequestId = requestId;
      wsReady = false;

      ws = new WebSocket(wsUrl, {
        headers: { "Ocp-Apim-Subscription-Key": this.key },
      });

      ws.on("open", () => {
        wsReady = true;
        reconnectAttempts = 0;

        // ① Speech config — declares the audio format to Azure
        ws.send(
          textFrame(
            "speech.config",
            JSON.stringify({
              context: {
                system: { version: "1.0.0" },
                os: { platform: "node", name: "node", version: process.version },
                device: {
                  manufacturer: "voiceorch",
                  model: "voiceorch",
                  version: "1.0",
                },
              },
            }),
            requestId,
          ),
        );

        // ② Speech context — phrase list (keyterms only; no LID)
        if (this.cfg.keyterms.length > 0) {
          const ctx: Record<string, unknown> = {
            phraseDetection: {
              onInterim: { resultType: "Always" },
              onSuccess: { resultType: "Always" },
              mode: "Conversation",
            },
            phraseList: {
              onRecognition: { enabled: true, phrases: this.cfg.keyterms },
            },
          };
          ws.send(textFrame("speech.context", JSON.stringify(ctx), requestId));
        }

        // ③ Flush any audio queued before the socket was ready
        for (const chunk of audioQueue.splice(0)) {
          ws.send(audioFrame(chunk, requestId));
        }

        logger.info(
          {
            region: this.region,
            language: this.language,
            keyterms: this.cfg.keyterms.length,
            hasEndpointId: !!this.endpointId,
            reconnectAttempts,
          },
          "Azure streaming STT WebSocket opened",
        );
      });

      ws.on("message", (raw: Buffer | string, isBinary: boolean) => {
        // Azure only sends transcript events as text frames; skip binary frames.
        if (isBinary) return;

        const parsed = parseFrame(raw.toString());
        if (!parsed) return;

        const { path, body } = parsed;

        // ── Interim hypothesis ──────────────────────────────────────────────
        if (path === "speech.hypothesis") {
          try {
            const msg = JSON.parse(body) as AzureHypothesisBody;
            const text = msg.Text?.trim();
            if (text) onTranscript(text, false);
          } catch {
            // malformed JSON — ignore
          }
          return;
        }

        // ── Final phrase ────────────────────────────────────────────────────
        if (path === "speech.phrase") {
          try {
            const msg = JSON.parse(body) as AzurePhraseBody;

            if (msg.RecognitionStatus !== "Success") {
              // InitialSilenceTimeout, NoMatch, etc. — nothing to emit
              return;
            }

            const best = msg.NBest?.[0];
            const text = (best?.Display ?? msg.DisplayText ?? "").trim();

            if (!text) return;

            // In streaming mode, apply confidence filter only as a soft gate.
            // Use the configured threshold but floor it at 0.15 — Azure streaming
            // confidence for Indic languages is naturally lower than Latin-script.
            const confidence = best?.Confidence ?? 1;
            const effectiveThreshold = Math.min(this.cfg.confidenceThreshold, 0.15);
            if (confidence < effectiveThreshold) {
              logger.info(
                { confidence, effectiveThreshold, configured: this.cfg.confidenceThreshold },
                "Azure stream: transcript filtered by confidence",
              );
              return;
            }

            onTranscript(text, true);
          } catch {
            // malformed JSON — ignore
          }
          return;
        }

        // ── Turn lifecycle (informational only) ─────────────────────────────
        // After turn.end the socket stays open; the next audio chunk starts a
        // new turn automatically — no reconnect needed.
        if (path === "turn.end") {
          logger.debug({ region: this.region }, "Azure STT: turn.end");
          return;
        }

        if (path === "turn.start") {
          logger.debug({ region: this.region }, "Azure STT: turn.start");
          return;
        }

        if (path === "speech.enddetected") {
          logger.debug({ region: this.region }, "Azure STT: speech.enddetected");
          return;
        }
      });

      ws.on("error", (err: unknown) => {
        logger.error({ err }, "Azure streaming STT WebSocket error");
      });

      ws.on("close", (code: number, reason: Buffer) => {
        logger.info(
          { code, reason: reason.toString(), intentionallyClosed, reconnectAttempts },
          "Azure streaming STT WebSocket closed",
        );
        if (intentionallyClosed) {
          onClose?.();
          return;
        }
        // Unexpected close — reconnect with exponential back-off (max ~30 s).
        // Azure closes after ~10 min idle or on transient errors; reconnect
        // silently so long calls continue without dropping user audio.
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30_000);
          reconnectAttempts++;
          logger.info({ delay, reconnectAttempts }, "Azure STT: reconnecting…");
          setTimeout(openSocket, delay);
        } else {
          logger.error({ reconnectAttempts }, "Azure STT: max reconnect attempts reached");
          onClose?.();
        }
      });
    };

    openSocket();

    return {
      sendAudio(chunk: Buffer): void {
        if (wsReady && ws.readyState === WebSocket.OPEN) {
          ws.send(audioFrame(chunk, currentRequestId));
        } else {
          // Buffer audio that arrives before the socket is ready or during
          // a reconnect window — flushed once the new socket opens.
          audioQueue.push(chunk);
        }
      },

      close(): void {
        intentionallyClosed = true;
        if (ws.readyState < WebSocket.CLOSING) ws.close();
      },
    };
  }
}
