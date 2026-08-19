/**
 * Sarvam saaras:v3-realtime — the voice-agent STT socket.
 *
 * Docs: https://docs.sarvam.ai/api/api-guides-tutorials/speech-to-text/realtime-streaming
 *
 * Unlike legacy /speech-to-text/ws (finals only, frame-count VAD, reconnect to
 * change language), this endpoint streams transcript.partial, tunes VAD in
 * milliseconds, and accepts config.update on the open socket.
 */

import { WebSocket } from "ws";
import type { STTAdapter, SttFinalMetadata } from "./base.js";
import type { STTConfig, StreamSTT } from "../../types.js";
import { logger } from "../../../lib/logger.js";
import { SarvamSTT, resolveMsSetting } from "./sarvam.js";
import { resolveSarvamSttMode, type SarvamSttMode } from "./sarvam-mode.js";

const WS_BASE = "wss://api.sarvam.ai/speech-to-text-realtime/ws";
const PING_MS = 20_000;
const DEFAULT_SILENCE_MS = 500;
const DEFAULT_MIN_SPEECH_MS = 250;
const DEFAULT_THRESHOLD = 0.3;

const REALTIME_LANG = new Set([
  "auto",
  "en-IN", "hi-IN", "bn-IN", "kn-IN", "ml-IN", "mr-IN", "or-IN", "pa-IN",
  "ta-IN", "te-IN", "gu-IN", "as-IN", "ur-IN", "ne-IN", "kok-IN", "ks-IN",
  "sd-IN", "sa-IN", "sat-IN", "mni-IN", "brx-IN", "mai-IN", "doi-IN",
]);

export function isSarvamRealtimeModel(model: string | null | undefined): boolean {
  const m = (model ?? "").trim();
  if (m === "saarika:v2.5" || m.startsWith("saarika")) return false;
  if (m === "saaras:v3-realtime") return true;
  if (process.env["SARVAM_STT_REALTIME"] === "0") return false;
  // saaras:v3 (and v4 labels) ride the realtime socket unless explicitly disabled.
  return m === "saaras:v3" || m === "saaras:v4" || m === "" || m.startsWith("saaras");
}

/** Legacy od-IN → realtime or-IN. Pass through auto and known BCP-47. */
export function toRealtimeLanguageCode(code: string | null | undefined, auto: boolean): string {
  if (auto) return "auto";
  if (!code) return "en-IN";
  const t = code.trim();
  if (t === "unknown") return "auto";
  if (t === "od-IN" || t === "or") return "or-IN";
  if (REALTIME_LANG.has(t)) return t;
  const bare = t.split("-")[0]?.toLowerCase() ?? "";
  const mapped: Record<string, string> = {
    en: "en-IN", hi: "hi-IN", bn: "bn-IN", kn: "kn-IN", ml: "ml-IN",
    mr: "mr-IN", or: "or-IN", od: "or-IN", pa: "pa-IN", ta: "ta-IN",
    te: "te-IN", gu: "gu-IN", as: "as-IN", ur: "ur-IN", ne: "ne-IN",
  };
  const hit = mapped[bare];
  return hit && REALTIME_LANG.has(hit) ? hit : "en-IN";
}

export function buildRealtimeWsUrl(opts: {
  languageCode: string;
  sampleRate: 8000 | 16000;
  mode: SarvamSttMode;
  streamType?: "fast" | "balanced" | "simulated";
  silenceDurationMs: number;
  minSpeechDurationMs: number;
  threshold: number;
}): string {
  const params = new URLSearchParams({
    model: "saaras:v3-realtime",
    language_code: opts.languageCode,
    stream_type: opts.streamType ?? "fast",
    mode: opts.mode,
    endpointing: "vad",
    encoding: "linear16",
    sample_rate: String(opts.sampleRate),
    silence_duration_ms: String(opts.silenceDurationMs),
    min_speech_duration_ms: String(opts.minSpeechDurationMs),
    threshold: String(opts.threshold),
  });
  return `${WS_BASE}?${params.toString()}`;
}

interface RealtimeMsg {
  event?: string;
  text?: string;
  language?: string;
  language_confidence?: number | string;
  utterance_idx?: number;
  request_id?: string;
  code?: string;
  is_fatal?: boolean;
  message?: string;
  applied?: string[];
  audio_duration_s?: number;
}

export class SarvamRealtimeSTT implements STTAdapter {
  private readonly legacy: SarvamSTT;
  private readonly key: string;
  private readonly sampleRate: 8000 | 16000;
  private readonly mode: SarvamSttMode;
  private languageCode: string;
  private readonly silenceDurationMs: number;
  private readonly minSpeechDurationMs: number;
  private readonly threshold: number;

  constructor(
    apiKey: string,
    model: string | null,
    extraConfig: string | null,
    cfg: STTConfig,
  ) {
    this.key = apiKey;
    this.sampleRate = cfg.nativeSampleRate === 8000 ? 8000 : 16000;
    this.legacy = new SarvamSTT(apiKey, model === "saaras:v3-realtime" ? "saaras:v3" : model, extraConfig, cfg);

    const extra = extraConfig
      ? (JSON.parse(extraConfig) as {
          mode?: string;
          languageAutoDetect?: boolean;
          firstTurnMinSpeechMs?: number | null;
          endOfSpeechSilenceMs?: number | null;
          vadThreshold?: number | null;
        })
      : {};

    this.mode = resolveSarvamSttMode(cfg.language, extra.mode ?? null);
    this.languageCode = toRealtimeLanguageCode(cfg.language, extra.languageAutoDetect === true);
    this.silenceDurationMs = resolveMsSetting(
      extra.endOfSpeechSilenceMs,
      "SARVAM_END_OF_SPEECH_SILENCE_MS",
      DEFAULT_SILENCE_MS,
      { min: 150, max: 2000 },
    );
    this.minSpeechDurationMs = resolveMsSetting(
      extra.firstTurnMinSpeechMs,
      "SARVAM_FIRST_TURN_MIN_SPEECH_MS",
      DEFAULT_MIN_SPEECH_MS,
      { min: 80, max: 2000 },
    );
    const th = extra.vadThreshold;
    this.threshold =
      typeof th === "number" && Number.isFinite(th)
        ? Math.min(1, Math.max(0, th))
        : DEFAULT_THRESHOLD;

    logger.info(
      {
        languageCode: this.languageCode,
        mode: this.mode,
        sampleRate: this.sampleRate,
        silenceDurationMs: this.silenceDurationMs,
        minSpeechDurationMs: this.minSpeechDurationMs,
        threshold: this.threshold,
      },
      "Sarvam STT realtime: session config",
    );
  }

  transcribe(audioBuffer: Buffer, sampleRate?: number): Promise<string> {
    return this.legacy.transcribe(audioBuffer, sampleRate);
  }

  transcribeStream(
    onTranscript: (
      text: string,
      isFinal: boolean,
      detectedLanguage?: string,
      metadata?: SttFinalMetadata,
    ) => void,
    onClose?: () => void,
  ): StreamSTT {
    const key = this.key;
    const sampleRate = this.sampleRate;
    let languageCode = this.languageCode;
    const mode = this.mode;
    const silenceDurationMs = this.silenceDurationMs;
    const minSpeechDurationMs = this.minSpeechDurationMs;
    const threshold = this.threshold;
    const legacy = this.legacy;

    let ws: WebSocket | null = null;
    let wsReady = false;
    let sessionBegan = false;
    let intentionallyClosed = false;
    let usingLegacy = false;
    let legacyStream: StreamSTT | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let lastPartial = "";
    let lastPartialLang: string | undefined;
    let speechEndAt = 0;
    let lastRequestId: string | undefined;
    const audioQueue: Buffer[] = [];
    const MAX_QUEUE_BYTES = sampleRate * 2 * 8;

    let _onSpeechStart: (() => void) | null = null;
    let _onSpeechEnd: (() => void) | null = null;
    let _onConnectionDead: (() => void) | null = null;

    const stripSpeaker = (text: string): string =>
      text.replace(/(^|\n)\s*speaker\s*\d*\s*:\s*/gi, "$1").trim();

    const sendJson = (obj: Record<string, unknown>): void => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify(obj));
    };

    const sendChunk = (chunk: Buffer): void => {
      sendJson({ event: "audio_input", audio: chunk.toString("base64") });
    };

    const drainQueue = (): void => {
      while (audioQueue.length > 0) {
        const c = audioQueue.shift()!;
        sendChunk(c);
      }
    };

    const stopPing = (): void => {
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
    };

    const startPing = (): void => {
      stopPing();
      pingTimer = setInterval(() => {
        if (intentionallyClosed || usingLegacy) return;
        sendJson({ event: "ping" });
      }, PING_MS);
    };

    const fallbackToLegacy = (reason: string, detail?: Record<string, unknown>): void => {
      if (usingLegacy || intentionallyClosed) return;
      usingLegacy = true;
      sessionBegan = false;
      stopPing();
      logger.warn(
        { reason, ...detail },
        "Sarvam STT realtime unavailable — falling back to legacy /speech-to-text/ws",
      );
      try { ws?.close(1000); } catch { /* noop */ }
      ws = null;
      legacyStream = legacy.transcribeStream(onTranscript, onClose);
      if (_onSpeechStart) legacyStream.onSpeechStart = _onSpeechStart;
      if (_onSpeechEnd) legacyStream.onSpeechEnd = _onSpeechEnd;
      if (_onConnectionDead) legacyStream.onConnectionDead = _onConnectionDead;
      for (const c of audioQueue) legacyStream.sendAudio(c);
      audioQueue.length = 0;
    };

    const handleMessage = (raw: WebSocket.RawData): void => {
      let msg: RealtimeMsg;
      try {
        msg = JSON.parse(raw.toString()) as RealtimeMsg;
      } catch {
        return;
      }
      const event = msg.event ?? "";
      if (msg.request_id) lastRequestId = msg.request_id;

      if (event === "session.begin") {
        sessionBegan = true;
        wsReady = true;
        logger.info(
          { requestId: lastRequestId, languageCode },
          "Sarvam STT realtime: session.begin",
        );
        drainQueue();
        return;
      }
      if (event === "pong" || event === "config.updated") return;
      if (event === "error") {
        logger.warn(
          { code: msg.code, fatal: msg.is_fatal, message: msg.message, requestId: lastRequestId },
          "Sarvam STT realtime: error event",
        );
        if (msg.is_fatal && !sessionBegan) {
          fallbackToLegacy("fatal_error_before_session", { code: msg.code, message: msg.message });
        }
        return;
      }
      if (event === "vad.speech_start") {
        lastPartial = "";
        lastPartialLang = undefined;
        _onSpeechStart?.();
        return;
      }
      if (event === "vad.speech_end") {
        speechEndAt = Date.now();
        _onSpeechEnd?.();
        return;
      }
      if (event === "transcript.partial") {
        const text = stripSpeaker(msg.text ?? "");
        if (!text) return;
        lastPartial = text;
        lastPartialLang = msg.language;
        onTranscript(text, false, msg.language, {
          pendingPartial: true,
          requestId: lastRequestId,
        });
        return;
      }
      if (event === "transcript.final") {
        const text = stripSpeaker(msg.text ?? "");
        lastPartial = "";
        const detected = msg.language;
        lastPartialLang = detected;
        if (!text) return;
        const meta: SttFinalMetadata = {
          requestId: lastRequestId,
          endDetectToFinalMs: speechEndAt > 0 ? Date.now() - speechEndAt : undefined,
          speechEndReceived: speechEndAt > 0,
        };
        speechEndAt = 0;
        logger.info(
          { text: text.slice(0, 80), language: detected, requestId: lastRequestId },
          "Sarvam STT realtime: final transcript",
        );
        onTranscript(text, true, detected, meta);
        return;
      }
      if (event === "session.end") {
        logger.info(
          { audioDurationS: msg.audio_duration_s, requestId: lastRequestId },
          "Sarvam STT realtime: session.end",
        );
      }
    };

    const openSocket = (): void => {
      const url = buildRealtimeWsUrl({
        languageCode,
        sampleRate,
        mode,
        streamType: "fast",
        silenceDurationMs,
        minSpeechDurationMs,
        threshold,
      });
      ws = new WebSocket(url, { headers: { "api-subscription-key": key } });
      ws.on("open", () => {
        wsReady = true;
        startPing();
      });
      ws.on("message", handleMessage);
      ws.on("close", (code, reasonBuf) => {
        stopPing();
        wsReady = false;
        const reason = reasonBuf?.toString() ?? "";
        logger.info({ code, reason, sessionBegan }, "Sarvam STT realtime: socket closed");
        if (intentionallyClosed || usingLegacy) return;
        // 4000 = invalid model / account not enabled — fall back once.
        if ((code === 4000 || code === 1003) && !sessionBegan) {
          fallbackToLegacy("ws_close", { code, reason });
          return;
        }
        if (code === 1008 && !sessionBegan) {
          fallbackToLegacy("inactivity_before_session", { code });
          return;
        }
        if (!intentionallyClosed) {
          _onConnectionDead?.();
          onClose?.();
        }
      });
      ws.on("error", (err) => {
        logger.warn({ err }, "Sarvam STT realtime: socket error");
      });
    };

    openSocket();

    const sttObj: StreamSTT = {
      sendAudio(chunk: Buffer): void {
        if (usingLegacy) {
          legacyStream?.sendAudio(chunk);
          return;
        }
        if (!wsReady || !sessionBegan || !ws || ws.readyState !== WebSocket.OPEN) {
          audioQueue.push(chunk);
          let total = audioQueue.reduce((a, b) => a + b.length, 0);
          while (total > MAX_QUEUE_BYTES && audioQueue.length > 1) {
            total -= audioQueue.shift()!.length;
          }
          return;
        }
        sendChunk(chunk);
      },
      flush(): boolean {
        if (usingLegacy) return legacyStream?.flush?.() === true;
        // Realtime flush is documented for endpointing=manual only. Emit the
        // last partial as a recovered fragment if we still have one.
        const held = lastPartial.trim();
        if (!held) return false;
        lastPartial = "";
        onTranscript(held, true, lastPartialLang, {
          pendingPartial: false,
          speechEndReceived: true,
          requestId: lastRequestId,
        });
        return true;
      },
      setLanguage(lang: string): void {
        if (usingLegacy) {
          legacyStream?.setLanguage?.(lang);
          return;
        }
        const next = toRealtimeLanguageCode(lang, false);
        if (next === languageCode) return;
        languageCode = next;
        logger.info({ to: next }, "Sarvam STT realtime: config.update language_code");
        sendJson({ event: "config.update", language_code: next });
      },
      close(): void {
        intentionallyClosed = true;
        stopPing();
        if (usingLegacy) {
          legacyStream?.close();
          return;
        }
        try { sendJson({ event: "end" }); } catch { /* noop */ }
        try { ws?.close(1000); } catch { /* noop */ }
      },
      getPendingTranscript(): string {
        if (usingLegacy) return legacyStream?.getPendingTranscript?.() ?? "";
        return lastPartial;
      },
    };

    Object.defineProperty(sttObj, "onSpeechStart", {
      get(): (() => void) | null { return _onSpeechStart; },
      set(cb: (() => void) | null): void {
        _onSpeechStart = cb;
        if (legacyStream) legacyStream.onSpeechStart = cb;
      },
    });
    Object.defineProperty(sttObj, "onSpeechEnd", {
      get(): (() => void) | null { return _onSpeechEnd; },
      set(cb: (() => void) | null): void {
        _onSpeechEnd = cb;
        if (legacyStream) legacyStream.onSpeechEnd = cb;
      },
    });
    Object.defineProperty(sttObj, "onConnectionDead", {
      get(): (() => void) | null { return _onConnectionDead; },
      set(cb: (() => void) | null): void {
        _onConnectionDead = cb;
        if (legacyStream) legacyStream.onConnectionDead = cb;
      },
    });

    return sttObj;
  }
}
