/**
 * Cartesia Sonic TTS — rebuilt from current docs (Cartesia-Version 2026-03-01).
 *
 *   https://docs.cartesia.ai/api-reference/tts/websocket
 *   https://docs.cartesia.ai/use-the-api/tts-websocket/buffering
 *   https://docs.cartesia.ai/build-with-cartesia/capability-guides/stream-inputs-using-continuations
 *
 * One WebSocket per call. One context_id per LLM turn.
 * Word-sized continue:true transcripts (never letter BPE — call 25026).
 * continue:false with empty transcript when the turn ends.
 * REST /tts/bytes only if the handshake never opens or a sentence has no WS audio.
 */
import crypto from "node:crypto";
import { logger } from "../../../lib/logger.js";
import type { TTSAdapter } from "../../types.js";

const CARTESIA_VERSION = "2026-03-01";
const WS_CONNECT_TIMEOUT_MS = 6_000;
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 300;
/** Docs managed-buffering default. 0 starts a clip per token. */
const CARTESIA_MAX_BUFFER_DELAY_MS = 3000;

export const CARTESIA_DEFAULT_MODEL = "sonic-3.6";
export const CARTESIA_SONIC_36_MODEL = "sonic-3.6";

const CARTESIA_MODEL_ALIASES: Record<string, string> = {
  "sonic-3.6": CARTESIA_SONIC_36_MODEL,
  "sonic3.6": CARTESIA_SONIC_36_MODEL,
  "3.6": CARTESIA_SONIC_36_MODEL,
  "sonic-3.5": "sonic-3.5",
  "sonic3.5": "sonic-3.5",
  "3.5": "sonic-3.5",
};

const CARTESIA_VALID_MODELS = new Set([
  CARTESIA_DEFAULT_MODEL, "sonic-3.5", "sonic-3.5-2026-05-04", "sonic-latest",
  CARTESIA_SONIC_36_MODEL, "sonic-3.6-2026-08-27", "sonic-preview",
  "sonic-3", "sonic-3-2026-01-12", "sonic-3-latest",
  "sonic-2", "sonic-2-2025-03-07", "sonic-2-2025-04-16", "sonic-2-2025-05-08", "sonic-2-2025-06-11",
  "sonic-turbo", "sonic-turbo-2025-03-07", "sonic-turbo-2025-06-04",
  "sonic-english", "sonic-multilingual",
]);

export function resolveCartesiaModelId(model: string | null | undefined): string {
  const raw = (model ?? "").trim();
  if (!raw) return CARTESIA_DEFAULT_MODEL;
  const key = raw.toLowerCase().replace(/\s+/g, "-");
  const id = CARTESIA_MODEL_ALIASES[key] ?? raw;
  return CARTESIA_VALID_MODELS.has(id) ? id : CARTESIA_DEFAULT_MODEL;
}

const CARTESIA_IN_LOCALES = new Set([
  "bn", "gu", "hi", "kn", "ml", "mr", "or", "pa", "ta", "te", "ur",
]);

export function parseCartesiaLang(tag: string | null | undefined): {
  language: string | null;
  locale: string | null;
} {
  const raw = (tag ?? "").trim();
  if (!raw) return { language: null, locale: null };
  const [lang, region] = raw.split(/[-_]/);
  const language = (lang ?? "").toLowerCase() || null;
  if (!language) return { language: null, locale: null };
  if (region) return { language, locale: `${language}-${region.toUpperCase()}` };
  if (CARTESIA_IN_LOCALES.has(language)) {
    return { language, locale: `${language}-IN` };
  }
  return { language, locale: null };
}

/** Tag to send on `language` (never also `locale` — both 400s). */
export function cartesiaWireLanguage(language: string | null, locale: string | null): string | null {
  return locale ?? language;
}

export function joinContinuationTranscript(_previous: string, next: string): string {
  return next;
}

export function appendCartesiaRemainder(prev: string, next: string): string {
  return prev + next;
}

export function isCartesiaContextClosedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /context has closed|no longer accepting new inputs|use a new context id/i.test(msg);
}

const WORD_BREAK = /[\s.,;:!?…।॥]/u;

/** Hold BPE letters until a word boundary so Sonic does not spell (call 25026). */
export function takeCartesiaWordChunks(buffered: string, incoming: string, flush: boolean): {
  chunks: string[];
  rest: string;
} {
  const buf = appendCartesiaRemainder(buffered, incoming);
  if (!buf) return { chunks: [], rest: "" };
  if (flush) return { chunks: [buf], rest: "" };
  if (/\p{M}$/u.test(buf)) return { chunks: [], rest: buf };
  let last = -1;
  for (let i = 0; i < buf.length; i++) {
    if (WORD_BREAK.test(buf[i]!)) last = i;
  }
  if (last >= 0) {
    const head = buf.slice(0, last + 1);
    if (head.trim()) return { chunks: [head], rest: buf.slice(last + 1) };
  }
  return { chunks: [], rest: buf };
}

function isInvalidVoiceControlsError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /invalid voice controls|invalid emotion|generation_config/i.test(msg);
}

const CARTESIA_EMOTIONS = new Set([
  "neutral", "happy", "excited", "enthusiastic", "elated", "euphoric",
  "triumphant", "amazed", "surprised", "flirtatious", "curious", "content",
  "peaceful", "serene", "calm", "grateful", "affectionate", "trust",
  "sympathetic", "anticipation", "mysterious", "angry", "mad", "outraged",
  "frustrated", "agitated", "threatened", "disgusted", "contempt", "envious",
  "sarcastic", "ironic", "sad", "dejected", "melancholic", "disappointed",
  "hurt", "guilty", "bored", "tired", "rejected", "nostalgic", "wistful",
  "apologetic", "hesitant", "insecure", "confused", "resigned", "anxious",
  "panicked", "alarmed", "scared", "proud", "confident", "distant",
  "skeptical", "contemplative", "determined",
]);

const LEGACY_EMOTION_MAP: Record<string, string> = {
  positivity: "happy",
  sadness: "sad",
  curiosity: "curious",
  anger: "angry",
  surprise: "surprised",
};

function normalizeEmotion(emotions?: string[]): string | undefined {
  const first = emotions?.[0]?.trim().toLowerCase();
  if (!first) return undefined;
  const base = first.split(":")[0]!.trim();
  if (CARTESIA_EMOTIONS.has(base)) return base;
  const mapped = LEGACY_EMOTION_MAP[base];
  return mapped && CARTESIA_EMOTIONS.has(mapped) ? mapped : undefined;
}

const CARTESIA_BASE_URL = (process.env["CARTESIA_BASE_URL"] ?? "https://api-india.cartesia.ai").replace(/\/+$/, "");
const CARTESIA_WS_BASE = CARTESIA_BASE_URL.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://");

async function fetchWithRetry(url: string, init: RequestInit, retries = MAX_RETRIES): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      lastErr = err;
      const isNetwork = err instanceof TypeError && err.name !== "AbortError";
      if (!isNetwork || attempt === retries) throw err;
      await new Promise<void>((r) => setTimeout(r, RETRY_BASE_MS * 2 ** attempt));
    }
  }
  throw lastErr;
}

interface PendingCtx {
  onChunk: (pcm: Buffer) => void;
  resolve: () => void;
  reject: (err: unknown) => void;
}

export class CartesiaTTS implements TTSAdapter {
  private key: string;
  private voiceId: string;
  private modelId: string;
  private language: string | null;
  private locale: string | null;
  private speed: number | null;
  readonly pcmSampleRate: 8000 | 16000;

  private ws: WebSocket | null = null;
  private wsConnecting: Promise<WebSocket> | null = null;
  private wsFailedPermanently = false;

  private readonly pending = new Map<string, PendingCtx>();
  private readonly claimedTurns = new Set<string>();
  private readonly finalizedTurns = new Set<string>();
  private readonly cancelledTurns = new Set<string>();
  private readonly closedTurns = new Set<string>();
  private readonly restFallbackTurns = new Set<string>();
  private readonly turnChunkHandlers = new Map<string, (pcm: Buffer) => void>();
  private readonly turnOutBuf = new Map<string, string>();
  private readonly closedRemainder = new Map<string, string>();
  private readonly turnSendChains = new Map<string, Promise<void>>();
  private readonly turnOpened = new Map<string, Promise<void>>();
  private readonly turnOpenedResolve = new Map<string, () => void>();
  private readonly turnInputs = new Map<string, Set<Promise<void>>>();
  private readonly contextSettings = new Map<string, Record<string, unknown>>();
  private readonly wordTimings = new Map<string, Array<{ word: string; end: number }>>();

  constructor(
    apiKey: string,
    voice: string | null,
    model: string | null,
    language?: string | null,
    speed?: number | null,
    sampleRate?: number | null,
  ) {
    this.key = apiKey;
    this.voiceId = (voice && voice.trim()) ? voice : "2ee87190-8f84-4925-97da-e52547f9462c";
    this.speed = (speed != null && Number.isFinite(speed) && speed !== 1)
      ? Math.min(1.5, Math.max(0.6, speed))
      : null;
    this.modelId = resolveCartesiaModelId(model);
    const parsedLang = parseCartesiaLang(language);
    this.language = parsedLang.language;
    this.locale = parsedLang.locale;
    this.pcmSampleRate = sampleRate === 8000 ? 8000 : 16000;
  }

  get resolvedModelId(): string {
    return this.modelId;
  }

  playedText(contextId: string, audioMs: number): string {
    return (this.wordTimings.get(contextId) ?? [])
      .filter((w) => w.end * 1000 <= audioMs).map((w) => w.word).join(" ").trim();
  }

  setLanguage(lang: string): void {
    const parsed = parseCartesiaLang(lang);
    this.language = parsed.language;
    this.locale = parsed.locale;
  }

  setSpeed(speed: number | null): void {
    this.speed = (speed != null && Number.isFinite(speed) && speed !== 1)
      ? Math.min(1.5, Math.max(0.6, speed))
      : null;
  }

  warmup(): void {
    void this.getOrOpenWs().catch(() => undefined);
  }

  private errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  private isAbortErr(err: unknown, signal?: AbortSignal): boolean {
    if (signal?.aborted) return true;
    if (err instanceof DOMException && err.name === "AbortError") return true;
    return err instanceof Error && err.name === "AbortError";
  }

  private outputFormat(): { container: "raw"; encoding: "pcm_s16le"; sample_rate: 8000 | 16000 } {
    return { container: "raw", encoding: "pcm_s16le", sample_rate: this.pcmSampleRate };
  }

  private buildVoice(): { mode: "id"; id: string } {
    return { mode: "id", id: this.voiceId };
  }

  private buildGenerationConfig(emotions?: string[]): Record<string, unknown> | undefined {
    const gc: Record<string, unknown> = {};
    if (this.speed != null) gc.speed = this.speed;
    const emotion = normalizeEmotion(emotions);
    if (emotion) gc.emotion = emotion;
    return Object.keys(gc).length > 0 ? gc : undefined;
  }

  /** Cartesia: `language` OR `locale`, never both. */
  private applyLang(msg: Record<string, unknown>): void {
    const tag = cartesiaWireLanguage(this.language, this.locale);
    if (!tag) return;
    msg.language = tag;
    msg.normalization = tag;
  }

  settingsForContext(contextId: string, emotions?: string[]): Record<string, unknown> {
    let settings = this.contextSettings.get(contextId);
    if (!settings) {
      settings = {
        model_id: this.modelId,
        voice: this.buildVoice(),
        output_format: this.outputFormat(),
        max_buffer_delay_ms: CARTESIA_MAX_BUFFER_DELAY_MS,
        add_timestamps: true,
      };
      const gc = this.buildGenerationConfig(emotions);
      if (gc) settings.generation_config = gc;
      this.applyLang(settings);
      this.contextSettings.set(contextId, settings);
      if (this.wordTimings.size >= 32) this.wordTimings.delete(this.wordTimings.keys().next().value!);
      this.wordTimings.set(contextId, []);
    }
    return settings;
  }

  static ensureTerminalPunctuation(text: string): string {
    const trimmed = text.trimEnd();
    if (!trimmed) return text;
    const last = trimmed[trimmed.length - 1]!;
    if (last === "." || last === "?" || last === "!" || last === "…" || last === "।") return text;
    if (last === "," || last === ";" || last === ":") return text;
    return trimmed + ".";
  }

  private get restHeaders() {
    return {
      "Authorization": `Bearer ${this.key}`,
      "X-API-Key": this.key,
      "Cartesia-Version": CARTESIA_VERSION,
      "Content-Type": "application/json",
    };
  }

  close(): void {
    this.wsFailedPermanently = true;
    if (this.ws) {
      try { this.ws.close(1000, "call ended"); } catch { /* ignore */ }
      this.ws = null;
    }
    this.wsConnecting = null;
    for (const resolveOpen of this.turnOpenedResolve.values()) resolveOpen();
    for (const [, ctx] of this.pending) {
      ctx.reject(new Error("CartesiaTTS: WebSocket closed (call ended)"));
    }
    this.pending.clear();
    this.claimedTurns.clear();
    this.finalizedTurns.clear();
    this.cancelledTurns.clear();
    this.closedTurns.clear();
    this.restFallbackTurns.clear();
    this.turnChunkHandlers.clear();
    this.turnOutBuf.clear();
    this.closedRemainder.clear();
    this.turnSendChains.clear();
    this.turnOpened.clear();
    this.turnOpenedResolve.clear();
    this.turnInputs.clear();
    this.contextSettings.clear();
  }

  private enqueueTurnSend(turnContextId: string, send: () => void): Promise<void> {
    const prev = this.turnSendChains.get(turnContextId) ?? Promise.resolve();
    const next = prev.then(() => { send(); });
    this.turnSendChains.set(turnContextId, next.catch(() => undefined));
    return next;
  }

  claimTurnContext(turnContextId: string): boolean {
    if (this.claimedTurns.has(turnContextId) || this.finalizedTurns.has(turnContextId)) {
      return false;
    }
    this.claimedTurns.add(turnContextId);
    this.turnOpened.set(turnContextId, new Promise<void>((r) => {
      this.turnOpenedResolve.set(turnContextId, r);
    }));
    return true;
  }

  appendTurnRemainder(turnContextId: string, text: string): void {
    if (!text) return;
    this.closedTurns.add(turnContextId);
    const prev = this.closedRemainder.get(turnContextId) ?? "";
    this.closedRemainder.set(turnContextId, appendCartesiaRemainder(prev, text));
  }

  finalizeTurnContext(turnContextId: string): void {
    if (this.finalizedTurns.has(turnContextId)) return;
    this.finalizedTurns.add(turnContextId);
    void this.completeTurn(turnContextId).catch((err: unknown) => {
      logger.warn({ contextId: turnContextId, err: this.errMsg(err) }, "Cartesia turn finalization failed");
      this.pending.get(turnContextId)?.reject(err instanceof Error ? err : new Error(String(err)));
    });
  }

  private async completeTurn(turnContextId: string): Promise<void> {
    await this.turnOpened.get(turnContextId);
    await Promise.allSettled([...(this.turnInputs.get(turnContextId) ?? [])]);
    await this.turnSendChains.get(turnContextId);
    if (this.cancelledTurns.has(turnContextId)) {
      this.cleanupTurn(turnContextId);
      return;
    }

    const held = this.turnOutBuf.get(turnContextId) ?? "";
    this.turnOutBuf.delete(turnContextId);
    const remainder = appendCartesiaRemainder(held, this.closedRemainder.get(turnContextId) ?? "");
    this.closedRemainder.delete(turnContextId);
    if (remainder && this.closedTurns.has(turnContextId)) {
      const owner = this.turnChunkHandlers.get(turnContextId) ?? (() => undefined);
      try {
        await this.synthesizeViaWsOneShot(remainder, owner, () => undefined);
      } catch (err) {
        logger.warn({ contextId: turnContextId, err: this.errMsg(err) }, "Cartesia leftover synthesis failed");
      }
    }

    const skipClose = this.restFallbackTurns.has(turnContextId) || this.closedTurns.has(turnContextId);
    if (skipClose || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.pending.get(turnContextId)?.resolve();
      this.cleanupTurn(turnContextId);
      return;
    }

    await this.enqueueTurnSend(turnContextId, () => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const extra = held && !this.closedTurns.has(turnContextId) ? held : "";
      if (extra) {
        this.ws.send(JSON.stringify({
          ...this.settingsForContext(turnContextId),
          context_id: turnContextId,
          transcript: extra,
          continue: true,
        }));
      }
      this.ws.send(JSON.stringify({
        ...this.settingsForContext(turnContextId),
        context_id: turnContextId,
        transcript: "",
        continue: false,
      }));
    });
  }

  private cleanupTurn(turnContextId: string): void {
    this.contextSettings.delete(turnContextId);
    this.turnChunkHandlers.delete(turnContextId);
    this.turnOutBuf.delete(turnContextId);
    this.closedRemainder.delete(turnContextId);
    this.turnInputs.delete(turnContextId);
    this.turnOpened.delete(turnContextId);
    this.turnOpenedResolve.delete(turnContextId);
    this.turnSendChains.delete(turnContextId);
    this.cancelledTurns.delete(turnContextId);
    this.restFallbackTurns.delete(turnContextId);
    this.closedTurns.delete(turnContextId);
  }

  private async getOrOpenWs(): Promise<WebSocket> {
    if (this.wsFailedPermanently) throw new Error("CartesiaTTS: WS permanently failed");
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return this.ws;
    if (this.wsConnecting) return this.wsConnecting;

    this.wsConnecting = new Promise<WebSocket>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (!settled) { settled = true; fn(); }
      };
      const ws = new WebSocket(
        `${CARTESIA_WS_BASE}/tts/websocket?api_key=${encodeURIComponent(this.key)}&cartesia_version=${encodeURIComponent(CARTESIA_VERSION)}`,
      );
      const timer = setTimeout(() => {
        settle(() => {
          this.wsConnecting = null;
          reject(new Error("CartesiaTTS: WS connect timeout"));
          try { ws.close(); } catch { /* ignore */ }
        });
      }, WS_CONNECT_TIMEOUT_MS);

      ws.addEventListener("open", () => {
        clearTimeout(timer);
        this.ws = ws;
        settle(() => { this.wsConnecting = null; resolve(ws); });
      });
      ws.addEventListener("message", (event: MessageEvent) => {
        this.handleWsMessage(String(event.data));
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        settle(() => {
          this.wsConnecting = null;
          reject(new Error("CartesiaTTS: WS connection error"));
        });
      });
      ws.addEventListener("close", () => {
        clearTimeout(timer);
        if (!settled) {
          settle(() => {
            this.wsConnecting = null;
            reject(new Error("CartesiaTTS: WS closed before open"));
          });
          return;
        }
        if (this.ws !== ws) return;
        this.ws = null;
        this.wsConnecting = null;
        for (const [id, ctx] of this.pending) {
          ctx.reject(new Error("CartesiaTTS: WS closed mid-stream"));
          this.pending.delete(id);
        }
      });
    });
    return this.wsConnecting;
  }

  handleWsMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(raw) as Record<string, unknown>; } catch { return; }
    const type = msg["type"] as string | undefined;
    const contextId = msg["context_id"] as string | undefined;

    if (type === "timestamps") {
      const wt = msg["word_timestamps"] as { words?: unknown[]; end?: unknown[] } | undefined;
      const timings = contextId ? this.wordTimings.get(contextId) : undefined;
      if (timings && Array.isArray(wt?.words) && Array.isArray(wt?.end)) {
        wt.words.forEach((word, i) => {
          const end = wt.end![i];
          if (typeof word === "string" && typeof end === "number" && Number.isFinite(end) && end >= 0 && timings.length < 10000) {
            timings.push({ word, end });
          }
        });
      }
      return;
    }

    if (type === "error") {
      const detail = [msg["error_code"], msg["title"], msg["message"], msg["error"]].filter(Boolean).map(String).join(" — ");
      logger.warn({ evt: "cartesia_ws_error", contextId, detail }, `CartesiaTTS: WebSocket error — ${detail.slice(0, 240)}`);
      const err = new Error(`Cartesia WS synthesis error: ${detail || "unknown"}`);
      if (contextId && isCartesiaContextClosedError(err) && this.claimedTurns.has(contextId) && !this.finalizedTurns.has(contextId)) {
        this.closedTurns.add(contextId);
        return;
      }
      if (contextId) {
        this.pending.get(contextId)?.reject(err);
        this.pending.delete(contextId);
      } else {
        for (const [id, ctx] of this.pending) {
          ctx.reject(err);
          this.pending.delete(id);
        }
      }
      return;
    }

    if (!contextId) return;
    const ctx = this.pending.get(contextId);
    if (!ctx) return;
    if (type === "chunk") {
      const b64 = msg["data"] as string | undefined;
      if (b64) ctx.onChunk(Buffer.from(b64, "base64"));
    } else if (type === "done") {
      if (this.claimedTurns.has(contextId) && !this.finalizedTurns.has(contextId)) return;
      this.pending.delete(contextId);
      ctx.resolve();
    }
  }

  synthesizeStreamInContext(
    turnContextId: string,
    text: string,
    onChunk: (pcm16k: Buffer) => void,
    onDone: (characters: number) => void,
    signal?: AbortSignal,
    emotions?: string[],
    join = false,
  ): Promise<void> {
    const work = this.synthesizeInContext(turnContextId, text, onChunk, onDone, signal, emotions, join);
    if (join) {
      const inputs = this.turnInputs.get(turnContextId) ?? new Set<Promise<void>>();
      inputs.add(work);
      this.turnInputs.set(turnContextId, inputs);
      const release = (): void => { inputs.delete(work); };
      void work.then(release, (err: unknown) => {
        if (this.isAbortErr(err, signal)) this.cancelledTurns.add(turnContextId);
        release();
      });
    } else {
      const release = (): void => { this.turnOpenedResolve.get(turnContextId)?.(); };
      void work.then(release, (err: unknown) => {
        if (this.isAbortErr(err, signal)) this.cancelledTurns.add(turnContextId);
        release();
      });
    }
    return work;
  }

  private async synthesizeInContext(
    turnContextId: string,
    text: string,
    onChunk: (pcm: Buffer) => void,
    onDone: (characters: number) => void,
    signal: AbortSignal | undefined,
    emotions: string[] | undefined,
    join: boolean,
  ): Promise<void> {
    if (!join) this.turnChunkHandlers.set(turnContextId, onChunk);
    if (join && (this.closedTurns.has(turnContextId) || this.restFallbackTurns.has(turnContextId))) {
      const prev = this.closedRemainder.get(turnContextId) ?? "";
      this.closedRemainder.set(turnContextId, appendCartesiaRemainder(prev, text));
      onDone(text.length);
      return;
    }
    const sink = join ? (this.turnChunkHandlers.get(turnContextId) ?? onChunk) : onChunk;

    if (this.wsFailedPermanently) {
      this.restFallbackTurns.add(turnContextId);
      await this.synthesizeViaRest(text, sink, onDone, signal, emotions);
      return;
    }

    try {
      const ws = await this.getOrOpenWs();
      await this.sendInContext(ws, turnContextId, text, sink, onDone, signal, emotions, join);
    } catch (err) {
      if (this.isAbortErr(err, signal)) throw err;
      if (isCartesiaContextClosedError(err)) this.closedTurns.add(turnContextId);
      if (/connect timeout|connection error|permanently failed|closed before open/i.test(this.errMsg(err))) {
        this.wsFailedPermanently = true;
      }
      this.turnOpenedResolve.get(turnContextId)?.();
      this.restFallbackTurns.add(turnContextId);
      await this.synthesizeViaRest(text, sink, onDone, signal, emotions);
    }
  }

  private async sendInContext(
    ws: WebSocket,
    turnContextId: string,
    text: string,
    onChunk: (pcm: Buffer) => void,
    onDone: (characters: number) => void,
    signal: AbortSignal | undefined,
    emotions: string[] | undefined,
    join: boolean,
  ): Promise<void> {
    const sendTranscript = (transcript: string): void => {
      const prev = this.turnOutBuf.get(turnContextId) ?? "";
      const { chunks, rest } = takeCartesiaWordChunks(prev, transcript, false);
      this.turnOutBuf.set(turnContextId, rest);
      for (const chunk of chunks) {
        ws.send(JSON.stringify({
          ...this.settingsForContext(turnContextId, emotions),
          context_id: turnContextId,
          transcript: chunk,
          continue: true,
        }));
      }
    };

    if (join) {
      await this.turnOpened.get(turnContextId);
      // Stay on this context. Dumping to remainder because `pending` is not
      // registered yet is what sent letter-sized one-shots (call 25026).
      if (this.closedTurns.has(turnContextId) || this.restFallbackTurns.has(turnContextId) || this.cancelledTurns.has(turnContextId)) {
        const prev = this.closedRemainder.get(turnContextId) ?? "";
        this.closedRemainder.set(turnContextId, appendCartesiaRemainder(prev, text));
        onDone(text.length);
        return;
      }
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      await this.enqueueTurnSend(turnContextId, () => sendTranscript(text));
      onDone(text.length);
      return;
    }

    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
      const cleanup = (fn: () => void): void => {
        signal?.removeEventListener("abort", onAbort);
        this.pending.delete(turnContextId);
        fn();
      };
      const onAbort = (): void => {
        this.cancelledTurns.add(turnContextId);
        if (ws.readyState === WebSocket.OPEN) {
          try { ws.send(JSON.stringify({ context_id: turnContextId, cancel: true })); } catch { /* ignore */ }
        }
        cleanup(() => reject(new DOMException("Aborted", "AbortError")));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(turnContextId, {
        onChunk,
        resolve: () => cleanup(() => {
          onDone(text.length);
          this.cleanupTurn(turnContextId);
          resolve();
        }),
        reject: (err) => cleanup(() => reject(err)),
      });
      this.turnOpenedResolve.get(turnContextId)?.();
      void this.enqueueTurnSend(turnContextId, () => sendTranscript(text)).catch((err) => {
        cleanup(() => reject(err));
      });
    });
  }

  private async synthesizeViaWsOneShot(
    text: string,
    onChunk: (pcm: Buffer) => void,
    onDone: (characters: number) => void,
    signal?: AbortSignal,
    emotions?: string[],
  ): Promise<void> {
    const ws = await this.getOrOpenWs();
    const safeText = CartesiaTTS.ensureTerminalPunctuation(text);
    const contextId = crypto.randomUUID();
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
      const cleanup = (fn: () => void) => {
        signal?.removeEventListener("abort", onAbort);
        this.pending.delete(contextId);
        fn();
      };
      const onAbort = () => cleanup(() => reject(new DOMException("Aborted", "AbortError")));
      signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(contextId, {
        onChunk,
        resolve: () => cleanup(() => { onDone(safeText.length); resolve(); }),
        reject: (err) => cleanup(() => reject(err)),
      });
      const msg: Record<string, unknown> = {
        context_id: contextId,
        model_id: this.modelId,
        transcript: safeText,
        voice: this.buildVoice(),
        output_format: this.outputFormat(),
        continue: false,
      };
      const gc = this.buildGenerationConfig(emotions);
      if (gc) msg.generation_config = gc;
      this.applyLang(msg);
      try { ws.send(JSON.stringify(msg)); } catch (err) { cleanup(() => reject(err)); }
    });
  }

  private async synthesizeViaRest(
    text: string,
    onChunk: (pcm: Buffer) => void,
    onDone: (characters: number) => void,
    signal?: AbortSignal,
    emotions?: string[],
  ): Promise<void> {
    const safeText = CartesiaTTS.ensureTerminalPunctuation(text);
    const body: Record<string, unknown> = {
      transcript: safeText,
      model_id: this.modelId,
      voice: this.buildVoice(),
      output_format: this.outputFormat(),
    };
    const gc = this.buildGenerationConfig(emotions);
    if (gc) body.generation_config = gc;
    this.applyLang(body);
    const resp = await fetchWithRetry(`${CARTESIA_BASE_URL}/tts/bytes`, {
      method: "POST",
      headers: this.restHeaders,
      body: JSON.stringify(body),
      signal,
    });
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Cartesia TTS stream error ${resp.status}: ${err}`);
    }
    if (!resp.body) throw new Error("Cartesia TTS: no response body");
    const reader = resp.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value?.length) onChunk(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
    onDone(safeText.length);
  }

  async synthesize(text: string, emotions?: string[]): Promise<{ audio: Buffer; characters: number }> {
    const chunks: Buffer[] = [];
    await this.synthesizeViaRest(text, (pcm) => chunks.push(pcm), () => undefined, undefined, emotions).catch(async (err) => {
      if (emotions && emotions.length > 0 && isInvalidVoiceControlsError(err)) {
        await this.synthesizeViaRest(text, (pcm) => chunks.push(pcm), () => undefined, undefined, undefined);
        return;
      }
      throw err;
    });
    return { audio: Buffer.concat(chunks), characters: CartesiaTTS.ensureTerminalPunctuation(text).length };
  }

  async synthesizeStream(
    text: string,
    onChunk: (pcm: Buffer) => void,
    onDone: (characters: number) => void,
    signal?: AbortSignal,
    emotions?: string[],
  ): Promise<void> {
    if (this.wsFailedPermanently) {
      return this.synthesizeViaRest(text, onChunk, onDone, signal, emotions);
    }
    try {
      await this.synthesizeViaWsOneShot(text, onChunk, onDone, signal, emotions);
    } catch (err) {
      if (this.isAbortErr(err, signal)) throw err;
      if (emotions && emotions.length > 0 && isInvalidVoiceControlsError(err)) {
        return this.synthesizeViaWsOneShot(text, onChunk, onDone, signal, undefined);
      }
      if (/connect timeout|connection error|permanently failed|closed before open/i.test(this.errMsg(err))) {
        this.wsFailedPermanently = true;
      }
      return this.synthesizeViaRest(text, onChunk, onDone, signal, emotions);
    }
  }
}
