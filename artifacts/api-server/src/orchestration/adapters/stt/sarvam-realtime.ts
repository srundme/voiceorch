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
import { SarvamSTT, resolveOptionalMsSetting } from "./sarvam.js";
import { resolveSarvamSttMode, type SarvamSttMode } from "./sarvam-mode.js";

const WS_BASE = "wss://api.sarvam.ai/speech-to-text-realtime/ws";
const PING_MS = 20_000;

/**
 * Sarvam LiveKit production VAD table
 * (https://docs.sarvam.ai/api/integration/livekit-production-best-practices).
 * Telephony (8 kHz) needs a higher onset bar and longer EOS than headset audio.
 */
export function resolveRealtimeVadDefaults(_sampleRate: 8000 | 16000): {
  silenceDurationMs: number | null;
  minSpeechDurationMs: number | null;
  threshold: number | null;
} {
  // Bolna does not overlay VAD milliseconds. Omit unless the agent set them.
  return { silenceDurationMs: null, minSpeechDurationMs: null, threshold: null };
}

export type SarvamRealtimeStreamType = "fast" | "balanced" | "simulated";

/** Voice agents default to fast. Sarvam's API default is balanced (captioning). */
export function resolveRealtimeStreamType(raw: unknown): SarvamRealtimeStreamType {
  if (raw === "balanced" || raw === "simulated" || raw === "fast") return raw;
  return "fast";
}

/** Terminology hint for the final transcript only. Empty/omitted = none. */
export function clipRealtimePrompt(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.trim().slice(0, 500);
  return t || undefined;
}

/** Default Indian B2B / travel terms so Saaras keeps B2B/CRM in Latin. */
const DEFAULT_SARVAM_HINTS = [
  "B2B", "B2C", "CRM", "integration", "travel portal",
  "flight booking", "hotel booking", "GST", "UPI",
];

export function buildSarvamTerminologyPrompt(
  keyterms: string[] | undefined,
  extraPrompt?: string | null,
): string | undefined {
  const parts = [
    ...DEFAULT_SARVAM_HINTS,
    ...(keyterms ?? []),
    ...(extraPrompt ? extraPrompt.split(/[,;]/).map((s) => s.trim()).filter(Boolean) : []),
  ];
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(p);
  }
  return clipRealtimePrompt(merged.join(" "));
}

const REALTIME_LANG = new Set([
  "auto",
  "en-IN", "hi-IN", "bn-IN", "kn-IN", "ml-IN", "mr-IN", "or-IN", "pa-IN",
  "ta-IN", "te-IN", "gu-IN", "as-IN", "ur-IN", "ne-IN", "kok-IN", "ks-IN",
  "sd-IN", "sa-IN", "sat-IN", "mni-IN", "brx-IN", "mai-IN", "doi-IN",
]);

/** 24 accepted `language_code` values (includes `auto`). */
export const REALTIME_LANGUAGE_CODES = [...REALTIME_LANG] as const;

const BARE_TO_REALTIME: Record<string, string> = {
  en: "en-IN", hi: "hi-IN", bn: "bn-IN", kn: "kn-IN", ml: "ml-IN",
  mr: "mr-IN", or: "or-IN", od: "or-IN", pa: "pa-IN", ta: "ta-IN",
  te: "te-IN", gu: "gu-IN", as: "as-IN", ur: "ur-IN", ne: "ne-IN",
  kok: "kok-IN", ks: "ks-IN", sd: "sd-IN", sa: "sa-IN", sat: "sat-IN",
  mni: "mni-IN", brx: "brx-IN", mai: "mai-IN", doi: "doi-IN",
};

export function isSarvamRealtimeModel(model: string | null | undefined): boolean {
  const m = (model ?? "").trim();
  if (m === "saarika:v2.5" || m.startsWith("saarika")) return false;
  if (m === "saaras:v3-realtime" || m === "saaras:v4-realtime") return true;
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
  if (t === "od-IN" || t === "ne-NP") return t === "ne-NP" ? "ne-IN" : "or-IN";
  if (REALTIME_LANG.has(t)) return t;
  const bare = t.split("-")[0]?.toLowerCase() ?? "";
  const hit = BARE_TO_REALTIME[bare];
  return hit && REALTIME_LANG.has(hit) ? hit : "en-IN";
}

/**
 * Realtime `language_code` per Sarvam docs + speech-to-text skill:
 *   • auto-detect ON  → `auto` (LID on every partial/final)
 *   • auto-detect OFF → agent BCP-47 (skill: pin language for audio <3s)
 * Never invent auto for a single-language agent — short "haan"/"ok" turns
 * lose LID. Mixed Hinglish is `mode=codemix`, not a language pin.
 */
export function resolveRealtimeSocketLanguage(
  configuredLang?: string | null,
  languageAutoDetect?: boolean,
): string {
  return toRealtimeLanguageCode(configuredLang, languageAutoDetect === true);
}

/**
 * Live `language_code` after a mid-call switch.
 *
 * Explicit pin (`pin=true`): caller asked for a language ("हिंदी से बोलना")
 * or we restored a latch after reconnect — `config.update` to that BCP-47.
 * Staying on `auto` here is what leaked Kannada into Hindi call 20094.
 *
 * Passive LID/script-detect (`pin` omitted/false): if the socket is still
 * `auto`, stay on `auto`. Pinning those flips is what silenced mixed turns
 * (call 13919).
 */
export function nextRealtimeLanguageOnSwitch(
  current: string,
  requested: string,
  pin = false,
): string {
  if (pin) return toRealtimeLanguageCode(requested, false);
  if (current === "auto") return "auto";
  return toRealtimeLanguageCode(requested, false);
}

/** Empty `transcript.final` used to be dropped silently; recover the last partial. */
export function resolveRealtimeFinalText(finalText: string, lastPartial: string): string {
  const text = finalText.trim();
  return text || lastPartial.trim();
}

/**
 * LID on transcript.partial / transcript.final when language_code=auto.
 * Returns undefined when pinned (no language field) or the code is unknown.
 */
export function parseRealtimeDetectedLang(code: string | null | undefined): string | undefined {
  if (!code) return undefined;
  const t = code.trim();
  if (!t || t === "auto" || t === "unknown") return undefined;
  if (t === "od-IN") return "or-IN";
  if (t === "ne-NP") return "ne-IN";
  if (REALTIME_LANG.has(t) && t !== "auto") return t;
  return BARE_TO_REALTIME[t.split("-")[0]?.toLowerCase() ?? ""];
}

export function parseRealtimeLanguageConfidence(raw: unknown): number | undefined {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return undefined;
  return Math.min(1, Math.max(0, n));
}

/**
 * Sarvam's own guidance: pin `language_code` for audio under ~3s, because auto
 * LID needs more signal. Real PSTN turns are 0.5–2s, so a multilingual agent on
 * `auto` can have every short Tamil/Hindi turn come back as low-confidence
 * `en-IN` — and Saaras then decodes that audio with the English model, so the
 * caller side of the whole transcript is English junk (call 13919: "Killer
 * calendar", "Complex" for Tamil speech, confidence 0.1–0.4).
 *
 * Two such finals in a row are enough to stop trusting LID and pin the agent's
 * own language for the rest of the call. Turn 1 still gets `auto`, so a caller
 * who really opens in another language is still discovered.
 */
export const LID_DRIFT_CONFIDENCE_BAR = 0.6;
export const LID_DRIFT_FINALS_TO_PIN = 2;

export function isLidDriftFinal(opts: {
  /** Agent's own language as a realtime code — "auto"/English disables the guard. */
  primaryLanguage: string;
  detectedLanguage: string | undefined;
  languageConfidence: number | undefined;
}): boolean {
  const primary = opts.primaryLanguage.trim().toLowerCase();
  if (!primary || primary === "auto" || primary.startsWith("en")) return false;
  if (!opts.detectedLanguage?.toLowerCase().startsWith("en")) return false;
  // A confident English read is a real English caller, not LID drift.
  return opts.languageConfidence !== undefined && opts.languageConfidence < LID_DRIFT_CONFIDENCE_BAR;
}

export function resolveSarvamRealtimeModel(model?: string | null): "saaras:v3-realtime" | "saaras:v4-realtime" {
  const selected = model?.trim();
  return selected === "saaras:v4" || selected === "saaras:v4-realtime"
    ? "saaras:v4-realtime"
    : "saaras:v3-realtime";
}

export function buildRealtimeWsUrl(opts: {
  model?: string | null;
  languageCode: string;
  sampleRate: 8000 | 16000;
  mode: SarvamSttMode;
  streamType?: SarvamRealtimeStreamType;
  silenceDurationMs?: number | null;
  minSpeechDurationMs?: number | null;
  threshold?: number | null;
  prefixPaddingMs?: number | null;
  prompt?: string;
  returnTimestamps?: boolean;
}): string {
  const params = new URLSearchParams({
    model: resolveSarvamRealtimeModel(opts.model),
    language_code: opts.languageCode,
    stream_type: opts.streamType ?? "fast",
    mode: opts.mode,
    // Server VAD owns turns. Manual (`speech_start`/`speech_end`/`flush`) would
    // fight PSTN echo and our lost-turn backstop — do not switch unless we stop
    // feeding audio continuously.
    endpointing: "vad",
    // We always decode carrier mulaw to PCM before this socket.
    encoding: "linear16",
    sample_rate: String(opts.sampleRate === 8000 ? 8000 : 16000),
    return_timestamps: opts.returnTimestamps === false ? "false" : "true",
  });
  if (opts.silenceDurationMs != null) {
    params.set("silence_duration_ms", String(opts.silenceDurationMs));
  }
  if (opts.minSpeechDurationMs != null) {
    params.set("min_speech_duration_ms", String(opts.minSpeechDurationMs));
  }
  if (opts.threshold != null) {
    params.set("threshold", String(opts.threshold));
  }
  if (opts.prefixPaddingMs != null) {
    params.set("prefix_padding_ms", String(opts.prefixPaddingMs));
  }
  const prompt = clipRealtimePrompt(opts.prompt);
  if (prompt) params.set("prompt", prompt);
  return `${WS_BASE}?${params.toString()}`;
}

/** Mid-call `config.update` — never reconnect the realtime socket for these. */
export function buildRealtimeConfigUpdate(opts: {
  languageCode?: string;
  mode?: SarvamSttMode;
  streamType?: SarvamRealtimeStreamType;
  threshold?: number;
  silenceDurationMs?: number;
  minSpeechDurationMs?: number;
  prompt?: string;
}): Record<string, unknown> {
  const body: Record<string, unknown> = { event: "config.update" };
  if (opts.languageCode) body.language_code = opts.languageCode;
  if (opts.mode) body.mode = opts.mode;
  if (opts.streamType) body.stream_type = opts.streamType;
  if (opts.threshold !== undefined) body.threshold = opts.threshold;
  if (opts.silenceDurationMs !== undefined) body.silence_duration_ms = opts.silenceDurationMs;
  if (opts.minSpeechDurationMs !== undefined) body.min_speech_duration_ms = opts.minSpeechDurationMs;
  const prompt = clipRealtimePrompt(opts.prompt);
  if (prompt) body.prompt = prompt;
  return body;
}

/**
 * PSTN: vad.speech_start is a signal to inspect speech, not to interrupt.
 * Require a usable STT partial. Greeting / echo-grace stay blocked unless
 * the caller already passed a hard interrupt (stop/wait) into this gate.
 */
export function shouldBargeOnRealtimeVadStart(opts: {
  agentSpeaking: boolean;
  greetingOrSystem: boolean;
  inEchoGrace: boolean;
  isWebcall?: boolean;
  hasUsablePartial?: boolean;
  energyAboveEchoBar?: boolean;
  isHardInterrupt?: boolean;
}): boolean {
  if (!opts.agentSpeaking) return false;
  if (!opts.hasUsablePartial) return false;
  if (opts.isHardInterrupt) return true;
  if (opts.greetingOrSystem) return false;
  if (opts.inEchoGrace) return false;
  return true;
}

/** Streaming energy may arm, but PSTN must not clearAudio on echo-loud frames. */
export function shouldCommitStreamingEnergyBarge(opts: {
  hasUsablePending: boolean;
  isHardInterrupt: boolean;
  isBookingAnswer: boolean;
  echoBarReady: boolean;
  energyAboveEchoBar: boolean;
}): boolean {
  if (!opts.hasUsablePending || !opts.isHardInterrupt) return false;
  if (opts.echoBarReady && !opts.energyAboveEchoBar && !opts.isBookingAnswer) return false;
  return true;
}

/**
 * Official LiveKit recipe: first non-echo partial (`min_words` ≥ 1) cuts TTS.
 * Greeting lock, echo grace, and self-echo stay. No energy / hard-interrupt extras.
 */
export function shouldBargeOnRealtimePartial(opts: {
  greetingOrSystem: boolean;
  inEchoGrace: boolean;
  isWebcall?: boolean;
  isSelfEcho: boolean;
  echoBarReady?: boolean;
  energyAboveEchoBar?: boolean;
  charCount: number;
  minChars: number;
  /** Isolated hello/hi while TTS is playing — leftover greeting / echo (call 16832). */
  isGreetingOnly?: boolean;
  isHardInterrupt?: boolean;
  isBookingAnswer?: boolean;
}): boolean {
  if (opts.charCount < opts.minChars) return false;
  if (opts.isSelfEcho) return false;
  if (opts.isGreetingOnly) return false;
  if (opts.greetingOrSystem) return false;
  if (opts.inEchoGrace) return false;
  return true;
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
  start_s?: number;
  end_s?: number;
}

export class SarvamRealtimeSTT implements STTAdapter {
  private readonly model: "saaras:v3-realtime" | "saaras:v4-realtime";
  private readonly legacy: SarvamSTT;
  private readonly key: string;
  private readonly sampleRate: 8000 | 16000;
  private readonly mode: SarvamSttMode;
  private readonly explicitMode: string | null;
  private languageCode: string;
  /** Agent language, kept even when the socket opens on `auto`, for LID-drift recovery. */
  private readonly primaryLanguage: string;
  private readonly silenceDurationMs: number | null;
  private readonly minSpeechDurationMs: number | null;
  private readonly threshold: number | null;
  private readonly streamType: SarvamRealtimeStreamType;
  private readonly prompt?: string;

  constructor(
    apiKey: string,
    model: string | null,
    extraConfig: string | null,
    cfg: STTConfig,
  ) {
    this.key = apiKey;
    this.model = resolveSarvamRealtimeModel(model);
    this.sampleRate = cfg.nativeSampleRate === 8000 ? 8000 : 16000;
    this.legacy = new SarvamSTT(apiKey, this.model.replace(/-realtime$/, ""), extraConfig, cfg);

    const extra = extraConfig
      ? (JSON.parse(extraConfig) as {
          mode?: string;
          languageAutoDetect?: boolean;
          firstTurnMinSpeechMs?: number | null;
          endOfSpeechSilenceMs?: number | null;
          vadThreshold?: number | null;
          streamType?: string;
          prompt?: string;
        })
      : {};

    this.explicitMode = extra.mode ?? null;
    this.mode = resolveSarvamSttMode(cfg.language, this.explicitMode);
    this.languageCode = resolveRealtimeSocketLanguage(cfg.language, extra.languageAutoDetect);
    this.primaryLanguage = toRealtimeLanguageCode(cfg.language, false);
    const vadDefaults = resolveRealtimeVadDefaults(this.sampleRate);
    this.silenceDurationMs = resolveOptionalMsSetting(
      extra.endOfSpeechSilenceMs,
      "SARVAM_END_OF_SPEECH_SILENCE_MS",
      vadDefaults.silenceDurationMs,
      { min: 150, max: 2000 },
    );
    this.minSpeechDurationMs = resolveOptionalMsSetting(
      extra.firstTurnMinSpeechMs,
      "SARVAM_FIRST_TURN_MIN_SPEECH_MS",
      vadDefaults.minSpeechDurationMs,
      { min: 80, max: 2000 },
    );
    const th = extra.vadThreshold;
    this.threshold =
      typeof th === "number" && Number.isFinite(th)
        ? Math.min(1, Math.max(0, th))
        : vadDefaults.threshold;
    this.streamType = resolveRealtimeStreamType(extra.streamType);
    this.prompt = buildSarvamTerminologyPrompt(cfg.keyterms, extra.prompt);

    logger.info(
      {
        languageCode: this.languageCode,
        model: this.model,
        primaryLanguage: this.primaryLanguage,
        mode: this.mode,
        streamType: this.streamType,
        prefixPaddingMs: null,
        prompt: this.prompt ? this.prompt.slice(0, 40) : undefined,
        sampleRate: this.sampleRate,
        silenceDurationMs: this.silenceDurationMs,
        minSpeechDurationMs: this.minSpeechDurationMs,
        threshold: this.threshold,
      },
      "Sarvam STT realtime: session config",
    );
  }

  transcribe(audioBuffer: Buffer, sampleRate?: number): Promise<string> {
    const rate = sampleRate === 8000 || sampleRate === 16000 ? sampleRate : undefined;
    return this.legacy.transcribe(audioBuffer, rate);
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
    let mode = this.mode;
    const primaryLanguage = this.primaryLanguage;
    const explicitMode = this.explicitMode;
    let silenceDurationMs = this.silenceDurationMs;
    const minSpeechDurationMs = this.minSpeechDurationMs;
    const threshold = this.threshold;
    const streamType = this.streamType;
    const prompt = this.prompt;
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
    let lidDriftFinals = 0;
    const audioQueue: Buffer[] = [];
    const MAX_QUEUE_BYTES = sampleRate * 2 * 8;

    let _onSpeechStart: (() => void) | null = null;
    let _onSpeechEnd: (() => void) | null = null;
    let _onConnectionDead: (() => void) | null = null;
    let _onSessionUsage: ((info: { audioDurationS: number }) => void) | null = null;

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
      if (event === "pong") return;
      if (event === "config.updated") {
        logger.info({ applied: msg.applied, requestId: lastRequestId }, "Sarvam STT realtime: config.updated");
        return;
      }
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
        // New utterance — drop the previous partial so barge-in cannot treat
        // leftover echo text as "usable caller words" on this VAD tick.
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
        const detected = parseRealtimeDetectedLang(msg.language);
        lastPartialLang = detected;
        onTranscript(text, false, detected, {
          pendingPartial: true,
          requestId: lastRequestId,
        });
        return;
      }
      if (event === "transcript.final") {
        const recoveredFromPartial = !stripSpeaker(msg.text ?? "") && lastPartial.trim();
        const text = resolveRealtimeFinalText(stripSpeaker(msg.text ?? ""), lastPartial);
        lastPartial = "";
        const detected = parseRealtimeDetectedLang(msg.language) ?? lastPartialLang;
        lastPartialLang = detected;
        if (!text) {
          logger.warn(
            {
              requestId: lastRequestId,
              startS: msg.start_s,
              endS: msg.end_s,
              language: msg.language,
            },
            "Sarvam STT realtime: empty final — VAD heard speech but no transcript",
          );
          return;
        }
        if (recoveredFromPartial) {
          logger.info(
            { text: text.slice(0, 80), requestId: lastRequestId },
            "Sarvam STT realtime: empty final — recovered last partial",
          );
        }
        const languageConfidence = parseRealtimeLanguageConfidence(msg.language_confidence);
        let languagePinnedTo: string | undefined;
        if (languageCode === "auto") {
          if (isLidDriftFinal({ primaryLanguage, detectedLanguage: detected, languageConfidence })) {
            lidDriftFinals++;
            if (lidDriftFinals >= LID_DRIFT_FINALS_TO_PIN) {
              lidDriftFinals = 0;
              languageCode = primaryLanguage;
              mode = resolveSarvamSttMode(primaryLanguage, explicitMode);
              languagePinnedTo = primaryLanguage;
              logger.warn(
                {
                  to: primaryLanguage,
                  mode,
                  detected,
                  languageConfidence,
                  requestId: lastRequestId,
                },
                "Sarvam STT realtime: LID drift — pinning language_code to the agent language",
              );
              sendJson(buildRealtimeConfigUpdate({ languageCode, mode }));
            }
          } else {
            lidDriftFinals = 0;
          }
        }
        const meta: SttFinalMetadata = {
          requestId: lastRequestId,
          endDetectToFinalMs: speechEndAt > 0 ? Date.now() - speechEndAt : undefined,
          speechEndReceived: speechEndAt > 0,
          startS: typeof msg.start_s === "number" ? msg.start_s : undefined,
          endS: typeof msg.end_s === "number" ? msg.end_s : undefined,
          languageConfidence,
          languagePinnedTo,
        };
        speechEndAt = 0;
        logger.info(
          {
            text: text.slice(0, 80),
            language: detected,
            languageConfidence,
            requestId: lastRequestId,
            startS: meta.startS,
            endS: meta.endS,
          },
          "Sarvam STT realtime: final transcript",
        );
        onTranscript(text, true, detected, meta);
        return;
      }
      if (event === "session.end") {
        const audioDurationS = typeof msg.audio_duration_s === "number" ? msg.audio_duration_s : undefined;
        logger.info(
          { audioDurationS, requestId: lastRequestId },
          "Sarvam STT realtime: session.end",
        );
        if (audioDurationS !== undefined) {
          _onSessionUsage?.({ audioDurationS });
        }
      }
    };

    const openSocket = (): void => {
      const url = buildRealtimeWsUrl({
        model: this.model,
        languageCode,
        sampleRate,
        mode,
        streamType,
        silenceDurationMs,
        minSpeechDurationMs,
        threshold,
        prompt,
        returnTimestamps: true,
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
        // endpointing=vad: do not send {"event":"flush"} — that is manual-mode only.
        // Recover a held partial locally for the lost-turn backstop.
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
      setLanguage(lang: string, pin = false): void {
        if (usingLegacy) {
          legacyStream?.setLanguage?.(lang);
          return;
        }
        const nextLang = nextRealtimeLanguageOnSwitch(languageCode, lang, pin);
        const nextMode = resolveSarvamSttMode(nextLang, explicitMode);
        if (nextLang === languageCode && nextMode === mode) {
          if (languageCode === "auto" && !pin) {
            logger.info({ requested: lang }, "Sarvam STT realtime: keeping language_code=auto (passive LID)");
          }
          return;
        }
        languageCode = nextLang;
        mode = nextMode;
        logger.info(
          { to: nextLang, mode: nextMode, pin, requested: lang },
          "Sarvam STT realtime: config.update language",
        );
        sendJson(buildRealtimeConfigUpdate({ languageCode: nextLang, mode: nextMode }));
      },
      setSilenceDurationMs(ms: number): void {
        if (usingLegacy) {
          legacyStream?.setSilenceDurationMs?.(ms);
          return;
        }
        const next = Math.max(150, Math.min(2000, Math.round(ms)));
        if (!Number.isFinite(next) || next === silenceDurationMs) return;
        silenceDurationMs = next;
        logger.info({ silenceDurationMs: next }, "Sarvam STT realtime: silence_duration_ms");
        sendJson(buildRealtimeConfigUpdate({ silenceDurationMs: next }));
      },
      getRealtimeActive(): boolean {
        return !usingLegacy && sessionBegan;
      },
      getRealtimeStreamType(): SarvamRealtimeStreamType {
        return streamType;
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
    Object.defineProperty(sttObj, "onSessionUsage", {
      get(): ((info: { audioDurationS: number }) => void) | null { return _onSessionUsage; },
      set(cb: ((info: { audioDurationS: number }) => void) | null): void {
        _onSessionUsage = cb;
      },
    });

    return sttObj;
  }
}
