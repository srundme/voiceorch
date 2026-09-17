/**
 * Cartesia Sonic TTS.
 *
 * Built against the current WebSocket contract (Cartesia-Version 2026-03-01):
 *   https://docs.cartesia.ai/api-reference/tts/websocket.md
 *   https://docs.cartesia.ai/use-the-api/tts-websocket/context-flushing-and-flush-i-ds.md
 *   https://docs.cartesia.ai/build-with-cartesia/capability-guides/stream-inputs-using-continuations.md
 *
 * Model of operation: one WebSocket per call, one context per agent turn.
 * Text is written to the context as it arrives with `continue: true`. Complete
 * sentences (terminal punctuation) are left for Sonic to generate as one
 * continuation — flushing each sentence starts a *new* generation on the same
 * context, and those streams overlap in the PCM sink (call 25226: Cartesia
 * greeting heard on top of itself). Incomplete fragments are flushed so they
 * are not held for `max_buffer_delay_ms`, and the next write waits for
 * `flush_done` so the following generation cannot start in parallel.
 * `max_buffer_delay_ms` itself is left at the default — forcing it to 0
 * makes Sonic speak each word as its own clip (choppy, call 25061).
 *
 * The turn is closed by one `continue: false` write. Cartesia rejects a close
 * whose transcript is empty ("No valid transcripts passed", calls 25048/25049)
 * and then never emits `done`, so exactly one piece of text is held back to
 * carry that close. Holding text back is only safe because `closeContext` is the
 * single place that can flush it and it has no early exits — the previous
 * implementation held the same piece but had six return paths that dropped or
 * re-routed it onto a throwaway context, which is why turns lost their last
 * sentence.
 */
import crypto from "node:crypto";
import { logger } from "../../../lib/logger.js";
import type { TTSAdapter } from "../../types.js";

const CARTESIA_VERSION = "2026-03-01";
const WS_CONNECT_TIMEOUT_MS = 6_000;
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 300;
/** Contexts whose word timings stay queryable after the turn ends. */
const WORD_TIMING_CONTEXTS = 32;

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

/**
 * sonic-2 / turbo (and aliases) sunset 20 Oct 2026. They also do not list
 * `en-IN` — REST `/tts/bytes` may still speak a filler, but the WebSocket
 * continuation used for Talk errors, so the caller only hears hmm/okay.
 * https://docs.cartesia.ai/build-with-cartesia/tts-models/older-models.md
 */
const CARTESIA_RETIRED_PREFIXES = ["sonic-2", "sonic-turbo", "sonic-english", "sonic-multilingual"];

function isRetiredCartesiaModel(id: string): boolean {
  const key = id.toLowerCase();
  return CARTESIA_RETIRED_PREFIXES.some((prefix) => key === prefix || key.startsWith(`${prefix}-`));
}

export function resolveCartesiaModelId(model: string | null | undefined): string {
  const raw = (model ?? "").trim();
  if (!raw) return CARTESIA_DEFAULT_MODEL;
  const key = raw.toLowerCase().replace(/\s+/g, "-");
  const id = CARTESIA_MODEL_ALIASES[key] ?? raw;
  if (isRetiredCartesiaModel(id)) return CARTESIA_DEFAULT_MODEL;
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
  if (CARTESIA_IN_LOCALES.has(language)) return { language, locale: `${language}-IN` };
  return { language, locale: null };
}

/** `language` and `locale` accept the same values; sending both is a 400. */
export function cartesiaWireLanguage(language: string | null, locale: string | null): string | null {
  return locale ?? language;
}

export function appendCartesiaRemainder(prev: string, next: string): string {
  return prev + next;
}

/** Continuations replace nothing — each write is appended by the model. */
export function joinContinuationTranscript(_previous: string, next: string): string {
  return next;
}

export function isCartesiaContextClosedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /context has closed|no longer accepting new inputs|use a new context id/i.test(msg);
}

const WORD_BREAK = /[\s.,;:!?…।॥]/u;
const SENTENCE_END = /[.?!…।॥]$/u;

function isCompleteCartesiaUtterance(text: string): boolean {
  return SENTENCE_END.test(text.trimEnd());
}

/**
 * Split streamed text on the last word boundary. Writes carry whole words so
 * Sonic never receives a bare BPE fragment and spell it out (call 25026); the
 * trailing partial word stays buffered until more text or the close arrives.
 * Callers that already hold a complete sentence get it back unchanged.
 */
export function takeCartesiaWordChunks(buffered: string, incoming: string, flush: boolean): {
  chunks: string[];
  rest: string;
} {
  const buf = appendCartesiaRemainder(buffered, incoming);
  if (!buf) return { chunks: [], rest: "" };
  if (flush) return { chunks: [buf], rest: "" };
  // Never cut between a base character and its combining mark (Indic scripts).
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

export function isSpeakableCartesiaTranscript(text: string): boolean {
  return text.trim().length > 0;
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

/** Defaults to the India gateway; override for other regions. */
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

/** A single agent turn's Cartesia context. */
interface TurnCtx {
  /** Owner's PCM sink — every write on this context drains into it. */
  sink: ((pcm: Buffer) => void) | null;
  /** Complete text held back to carry the `continue: false` close. */
  held: string;
  /** Trailing partial word, not yet a legal write. */
  tail: string;
  /** Text handed over after the context stopped accepting writes. */
  spill: string;
  /** At least one non-empty transcript reached Cartesia on this context. */
  sentAny: boolean;
  /** Every write's text, so a WS error can REST the whole turn if no audio arrived. */
  full: string;
  /** True once a PCM chunk landed in this turn's sink. */
  gotAudio: boolean;
  /** `continue: false` went out; we are waiting for `done`. */
  awaitingDone: boolean;
  /** closeContext has run (or is running) — no further writes. */
  closed: boolean;
  /** Cartesia closed the context, or the turn was aborted. */
  dead: boolean;
  /** Barge-in / abort — drop remaining text instead of speaking it. */
  cancelled: boolean;
  /** WS unusable; writes go out over REST instead. */
  restFallback: boolean;
  /** Serializes writes so text reaches Cartesia in the order it was produced. */
  queue: Promise<void>;
  /** Resolvers waiting for the next `flush_done` on this context. */
  flushWaiters: Array<() => void>;
  /** Resolved when Cartesia reports `done` for the context. */
  settleOwner: ((err?: unknown) => void) | null;
  /** Characters the owner should report as billed. */
  chars: number;
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

  private readonly turns = new Map<string, TurnCtx>();
  /** One-shot (non-context) synthesis awaiting `done`. */
  private readonly oneShots = new Map<string, {
    onChunk: (pcm: Buffer) => void;
    settle: (err?: unknown) => void;
  }>();
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
    this.speed = normalizeSpeed(speed);
    this.modelId = resolveCartesiaModelId(model);
    const parsed = parseCartesiaLang(language);
    this.language = parsed.language;
    this.locale = parsed.locale;
    this.pcmSampleRate = sampleRate === 8000 ? 8000 : 16000;
  }

  get resolvedModelId(): string {
    return this.modelId;
  }

  setLanguage(lang: string): void {
    const parsed = parseCartesiaLang(lang);
    this.language = parsed.language;
    this.locale = parsed.locale;
  }

  setSpeed(speed: number | null): void {
    this.speed = normalizeSpeed(speed);
  }

  warmup(): void {
    void this.getOrOpenWs().catch(() => undefined);
  }

  /** Words whose audio has already been played, for interrupted-turn history. */
  playedText(contextId: string, audioMs: number): string {
    return (this.wordTimings.get(contextId) ?? [])
      .filter((w) => w.end * 1000 <= audioMs)
      .map((w) => w.word)
      .join(" ")
      .trim();
  }

  // ── message shapes ────────────────────────────────────────────────────────

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

  private applyLang(msg: Record<string, unknown>): void {
    const tag = cartesiaWireLanguage(this.language, this.locale);
    if (!tag) return;
    msg.language = tag;
    msg.normalization = tag;
  }

  /**
   * Per-context request fields. Cartesia requires model / voice / output_format
   * on every generation request and that they stay identical for the life of
   * the context, so they are resolved once and replayed.
   */
  settingsForContext(contextId: string, emotions?: string[]): Record<string, unknown> {
    let settings = this.contextSettings.get(contextId);
    if (!settings) {
      settings = {
        model_id: this.modelId,
        voice: this.buildVoice(),
        output_format: this.outputFormat(),
        add_timestamps: true,
      };
      const gc = this.buildGenerationConfig(emotions);
      if (gc) settings.generation_config = gc;
      this.applyLang(settings);
      this.contextSettings.set(contextId, settings);
      if (this.wordTimings.size >= WORD_TIMING_CONTEXTS) {
        this.wordTimings.delete(this.wordTimings.keys().next().value!);
      }
      this.wordTimings.set(contextId, []);
    }
    return settings;
  }

  /** A close must end a sentence or Sonic trails off mid-phrase. */
  static ensureTerminalPunctuation(text: string): string {
    const trimmed = text.trimEnd();
    if (!trimmed) return text;
    const last = trimmed[trimmed.length - 1]!;
    if (".?!…।,;:".includes(last)) return text;
    return trimmed + ".";
  }

  private get restHeaders(): Record<string, string> {
    return {
      "Authorization": `Bearer ${this.key}`,
      "X-API-Key": this.key,
      "Cartesia-Version": CARTESIA_VERSION,
      "Content-Type": "application/json",
    };
  }

  // ── socket ────────────────────────────────────────────────────────────────

  private async getOrOpenWs(): Promise<WebSocket> {
    if (this.wsFailedPermanently) throw new Error("CartesiaTTS: WS permanently failed");
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return this.ws;
    if (this.wsConnecting) return this.wsConnecting;

    this.wsConnecting = new Promise<WebSocket>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void): void => {
        if (!settled) { settled = true; fn(); }
      };
      const url = `${CARTESIA_WS_BASE}/tts/websocket`
        + `?api_key=${encodeURIComponent(this.key)}`
        + `&cartesia_version=${encodeURIComponent(CARTESIA_VERSION)}`;
      const ws = new WebSocket(url);
      const timer = setTimeout(() => {
        settle(() => {
          this.wsConnecting = null;
          reject(new Error("CartesiaTTS: WS connect timeout"));
          try { ws.close(); } catch { /* already gone */ }
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
        this.failAllInFlight(new Error("CartesiaTTS: WS closed mid-stream"));
      });
    });
    return this.wsConnecting;
  }

  private failAllInFlight(err: Error): void {
    for (const [id, shot] of this.oneShots) {
      this.oneShots.delete(id);
      shot.settle(err);
    }
    for (const ctx of this.turns.values()) {
      ctx.dead = true;
      ctx.settleOwner?.(err);
    }
  }

  private send(msg: Record<string, unknown>): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify(msg));
      return true;
    } catch (err) {
      logger.warn({ err: errMsg(err) }, "CartesiaTTS: WS send failed");
      return false;
    }
  }

  handleWsMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(raw) as Record<string, unknown>; } catch { return; }
    const type = msg["type"] as string | undefined;
    const contextId = msg["context_id"] as string | undefined;

    if (type === "timestamps") {
      this.recordTimestamps(contextId, msg["word_timestamps"]);
      return;
    }
    if (type === "flush_done") {
      const ctx = contextId ? this.turns.get(contextId) : undefined;
      ctx?.flushWaiters.shift()?.();
      return;
    }

    if (type === "error") {
      this.handleWsError(msg, contextId);
      return;
    }
    if (!contextId) return;

    if (type === "chunk") {
      const b64 = msg["data"] as string | undefined;
      if (b64) {
        const ctx = this.turns.get(contextId);
        if (ctx) ctx.gotAudio = true;
        this.sinkFor(contextId)?.(Buffer.from(b64, "base64"));
      }
      return;
    }
    if (type === "done") {
      const shot = this.oneShots.get(contextId);
      if (shot) {
        this.oneShots.delete(contextId);
        shot.settle();
        return;
      }
      const ctx = this.turns.get(contextId);
      // `done` before the close went out means Cartesia finished the text it
      // had; the turn is still open and more sentences are coming.
      if (ctx?.closed) {
        ctx.awaitingDone = false;
        ctx.settleOwner?.();
      }
    }
  }

  private sinkFor(contextId: string): ((pcm: Buffer) => void) | null {
    return this.oneShots.get(contextId)?.onChunk ?? this.turns.get(contextId)?.sink ?? null;
  }

  private recordTimestamps(contextId: string | undefined, payload: unknown): void {
    const wt = payload as { words?: unknown[]; end?: unknown[] } | undefined;
    const timings = contextId ? this.wordTimings.get(contextId) : undefined;
    if (!timings || !Array.isArray(wt?.words) || !Array.isArray(wt?.end)) return;
    wt.words.forEach((word, i) => {
      const end = wt.end![i];
      if (
        typeof word === "string" && typeof end === "number"
        && Number.isFinite(end) && end >= 0 && timings.length < 10_000
      ) {
        timings.push({ word, end });
      }
    });
  }

  private handleWsError(msg: Record<string, unknown>, contextId: string | undefined): void {
    const detail = [msg["error_code"], msg["title"], msg["message"], msg["error"]]
      .filter(Boolean).map(String).join(" — ");
    logger.warn(
      { evt: "cartesia_ws_error", contextId, detail },
      `CartesiaTTS: WebSocket error — ${detail.slice(0, 240)}`,
    );
    const err = new Error(`Cartesia WS synthesis error: ${detail || "unknown"}`);

    if (!contextId) {
      this.failAllInFlight(err);
      return;
    }
    const shot = this.oneShots.get(contextId);
    if (shot) {
      this.oneShots.delete(contextId);
      shot.settle(err);
      return;
    }
    const ctx = this.turns.get(contextId);
    if (!ctx) return;
    ctx.dead = true;
    // A closed context is recoverable: remaining text is spoken on a fresh
    // context rather than lost. Other WS generation errors (unsupported
    // language on sonic-2, rejected flush, etc.) must not abort Talk —
    // fillers already use REST, so the caller would only hear hmm/okay.
    if (isCartesiaContextClosedError(err)) {
      if (ctx.closed) ctx.settleOwner?.();
      return;
    }
    ctx.restFallback = true;
    if (ctx.awaitingDone) {
      ctx.awaitingDone = false;
      const text = ctx.gotAudio ? "" : ctx.full;
      if (isSpeakableCartesiaTranscript(text)) {
        void this.speakDetached(CartesiaTTS.ensureTerminalPunctuation(text), ctx);
      } else {
        ctx.settleOwner?.();
      }
    }
  }

  // ── turn contexts ─────────────────────────────────────────────────────────

  private ctx(contextId: string): TurnCtx {
    let ctx = this.turns.get(contextId);
    if (!ctx) {
      ctx = {
        sink: null,
        held: "",
        tail: "",
        spill: "",
        sentAny: false,
        full: "",
        gotAudio: false,
        awaitingDone: false,
        closed: false,
        dead: false,
        cancelled: false,
        restFallback: false,
        queue: Promise.resolve(),
        flushWaiters: [],
        settleOwner: null,
        chars: 0,
      };
      this.turns.set(contextId, ctx);
    }
    return ctx;
  }

  /** First caller for a turn owns the context (and its PCM sink). */
  claimTurnContext(turnContextId: string): boolean {
    const fresh = !this.turns.has(turnContextId);
    const ctx = this.ctx(turnContextId);
    return fresh && !ctx.closed;
  }

  /** Text produced after the context stopped accepting writes. */
  appendTurnRemainder(turnContextId: string, text: string): void {
    if (!text) return;
    const ctx = this.turns.get(turnContextId);
    if (!ctx) return;
    ctx.spill = appendCartesiaRemainder(ctx.spill, text);
    ctx.full = appendCartesiaRemainder(ctx.full, text);
  }

  /** No more text for this turn — flush what is held and close the context. */
  finalizeTurnContext(turnContextId: string): void {
    const ctx = this.turns.get(turnContextId);
    if (!ctx || ctx.closed) return;
    ctx.closed = true;
    ctx.queue = ctx.queue
      .then(() => this.closeContext(turnContextId, ctx))
      .catch((err: unknown) => {
        logger.warn({ contextId: turnContextId, err: errMsg(err) }, "Cartesia turn close failed");
        ctx.settleOwner?.(err);
      });
  }

  synthesizeStreamInContext(
    turnContextId: string,
    text: string,
    onChunk: (pcm: Buffer) => void,
    onDone: (characters: number) => void,
    signal?: AbortSignal,
    emotions?: string[],
    join = false,
  ): Promise<void> {
    const ctx = this.ctx(turnContextId);
    if (!join && !ctx.sink) ctx.sink = onChunk;

    // Writes are chained so Cartesia receives sentences in production order.
    const written = this.enqueueWrite(turnContextId, ctx, text, signal, emotions);

    if (join) {
      // Continuations report back as soon as their text is on the wire; their
      // audio lands in the owner's sink and is awaited by the owner.
      return written.then(() => { onDone(text.length); });
    }

    ctx.chars += text.length;
    return new Promise<void>((resolve, reject) => {
      const finish = (err?: unknown): void => {
        if (ctx.settleOwner === null) return;
        ctx.settleOwner = null;
        signal?.removeEventListener("abort", onAbort);
        if (err) { reject(err); return; }
        onDone(ctx.chars);
        this.cleanupTurn(turnContextId);
        resolve();
      };
      const onAbort = (): void => {
        ctx.cancelled = true;
        ctx.dead = true;
        // Only worth cancelling if Cartesia is already generating for this turn.
        if (ctx.sentAny) this.send({ context_id: turnContextId, cancel: true });
        finish(abortError());
      };
      ctx.settleOwner = finish;
      if (signal?.aborted) { onAbort(); return; }
      signal?.addEventListener("abort", onAbort, { once: true });
      // A write that fails outright (no socket, provider error) must not leave
      // the owner hanging — the pipeline is waiting on this promise to drain.
      void written.catch((err: unknown) => finish(err));
    });
  }

  private enqueueWrite(
    contextId: string,
    ctx: TurnCtx,
    text: string,
    signal: AbortSignal | undefined,
    emotions: string[] | undefined,
  ): Promise<void> {
    const next = ctx.queue
      .then(() => this.writeText(contextId, ctx, text, signal, emotions))
      .catch((err: unknown) => {
        // One aborted write means the whole turn is gone — stop the rest of the
        // queue (and the close) from speaking text the caller already cut off.
        if (isAbortErr(err, signal)) ctx.cancelled = true;
        throw err;
      });
    ctx.queue = next.catch(() => undefined);
    return next;
  }

  /**
   * Write one piece of turn text. Everything except the newest complete piece
   * goes out immediately with `continue: true`. A flush is only used for
   * fragments that would otherwise sit in Sonic's input buffer — flushing a
   * finished sentence starts a parallel generation on this context (call 25226).
   */
  private async writeText(
    contextId: string,
    ctx: TurnCtx,
    text: string,
    signal: AbortSignal | undefined,
    emotions: string[] | undefined,
  ): Promise<void> {
    if (ctx.cancelled || signal?.aborted) throw abortError();
    if (!text) return;
    ctx.full = appendCartesiaRemainder(ctx.full, text);
    // The context can no longer take writes — keep the text so the close can
    // still speak it on a fresh context.
    if (ctx.closed || ctx.dead || ctx.restFallback) {
      ctx.spill = appendCartesiaRemainder(ctx.spill, text);
      return;
    }

    const { chunks, rest } = takeCartesiaWordChunks(ctx.tail, text, false);
    ctx.tail = rest;
    const ready = chunks.filter(isSpeakableCartesiaTranscript);
    if (ready.length === 0) return;

    // Promote the previously held piece; hold the newest one for the close.
    const toSend = appendCartesiaRemainder(ctx.held, ready.slice(0, -1).join(""));
    ctx.held = ready[ready.length - 1]!;
    if (!isSpeakableCartesiaTranscript(toSend)) return;

    try {
      await this.getOrOpenWs();
    } catch (err) {
      this.onWsUnusable(ctx, err);
      ctx.spill = appendCartesiaRemainder(toSend, appendCartesiaRemainder(ctx.held, ctx.spill));
      ctx.held = "";
      return;
    }
    if (ctx.cancelled || signal?.aborted) throw abortError();

    const settings = this.settingsForContext(contextId, emotions);
    const sent = this.send({ ...settings, context_id: contextId, transcript: toSend, continue: true });
    if (!sent) {
      ctx.spill = appendCartesiaRemainder(toSend, appendCartesiaRemainder(ctx.held, ctx.spill));
      ctx.held = "";
      ctx.dead = true;
      return;
    }
    ctx.sentAny = true;
    if (isCompleteCartesiaUtterance(toSend)) return;
    // Incomplete fragment: force generation now, then wait so the next write
    // cannot start a second overlapping Sonic generation on this context.
    this.send({ context_id: contextId, transcript: "", continue: true, flush: true });
    await this.waitFlushDone(ctx);
  }

  private waitFlushDone(ctx: TurnCtx): Promise<void> {
    if (ctx.cancelled || ctx.dead) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, 1_500);
      ctx.flushWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /**
   * Single exit for a turn. Sends the held text plus anything that spilled as
   * one `continue: false` write, which both speaks the tail of the turn and
   * closes the context. Never sends an empty close: Cartesia answers
   * "No valid transcripts passed" and stops emitting `done`.
   */
  private async closeContext(contextId: string, ctx: TurnCtx): Promise<void> {
    const pending = [ctx.held, ctx.tail, ctx.spill]
      .filter(isSpeakableCartesiaTranscript)
      .join("");
    ctx.held = "";
    ctx.tail = "";
    ctx.spill = "";

    if (ctx.cancelled) {
      ctx.settleOwner?.(abortError());
      return;
    }
    if (!isSpeakableCartesiaTranscript(pending)) {
      // Nothing left to say. If text did go out, Cartesia's `done` for it is
      // what ends the turn; if nothing ever did, there is no audio to wait for.
      if (ctx.restFallback && !ctx.gotAudio && isSpeakableCartesiaTranscript(ctx.full)) {
        await this.speakDetached(CartesiaTTS.ensureTerminalPunctuation(ctx.full), ctx);
        return;
      }
      if (!ctx.sentAny) ctx.settleOwner?.();
      return;
    }

    const closing = CartesiaTTS.ensureTerminalPunctuation(pending);
    // A short turn can reach the close before any write needed the socket.
    if (!ctx.dead && !ctx.restFallback && !this.ws) {
      await this.getOrOpenWs().catch((err: unknown) => { this.onWsUnusable(ctx, err); });
    }
    // The context died mid-turn (closed by Cartesia, or the socket went away).
    // Speak the tail on its own context so the turn still finishes. When no
    // PCM arrived at all, REST the full transcript — not just the held tail —
    // otherwise the caller only heard fillers (REST one-shots) and never Talk.
    if (ctx.dead || ctx.restFallback || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      const text = (ctx.restFallback && !ctx.gotAudio)
        ? (ctx.full || closing)
        : closing;
      await this.speakDetached(CartesiaTTS.ensureTerminalPunctuation(text), ctx);
      return;
    }
    const sent = this.send({
      ...this.settingsForContext(contextId),
      context_id: contextId,
      transcript: closing,
      continue: false,
    });
    if (sent) {
      ctx.sentAny = true;
      ctx.awaitingDone = true;
      return; // owner settles on `done`
    }
    await this.speakDetached(closing, ctx);
  }

  /** Last resort for turn-tail text: its own context, or REST. */
  private async speakDetached(text: string, ctx: TurnCtx): Promise<void> {
    const sink = ctx.sink ?? ((): void => undefined);
    try {
      if (ctx.restFallback || this.wsFailedPermanently) {
        await this.synthesizeViaRest(text, sink, () => undefined);
      } else {
        await this.synthesizeViaWsOneShot(text, sink, () => undefined);
      }
      ctx.settleOwner?.();
    } catch (err) {
      logger.warn({ err: errMsg(err) }, "Cartesia turn-tail synthesis failed");
      ctx.settleOwner?.(err);
    }
  }

  private onWsUnusable(ctx: TurnCtx, err: unknown): void {
    if (/connect timeout|connection error|permanently failed|closed before open/i.test(errMsg(err))) {
      this.wsFailedPermanently = true;
    }
    ctx.restFallback = true;
  }

  private cleanupTurn(contextId: string): void {
    this.turns.delete(contextId);
    this.contextSettings.delete(contextId);
  }

  // ── one-shot synthesis ────────────────────────────────────────────────────

  private async synthesizeViaWsOneShot(
    text: string,
    onChunk: (pcm: Buffer) => void,
    onDone: (characters: number) => void,
    signal?: AbortSignal,
    emotions?: string[],
  ): Promise<void> {
    if (!isSpeakableCartesiaTranscript(text)) {
      onDone(0);
      return;
    }
    const ws = await this.getOrOpenWs();
    const safeText = CartesiaTTS.ensureTerminalPunctuation(text);
    const contextId = crypto.randomUUID();
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) { reject(abortError()); return; }
      let settled = false;
      const settle = (err?: unknown): void => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        this.oneShots.delete(contextId);
        if (err) reject(err);
        else { onDone(safeText.length); resolve(); }
      };
      const onAbort = (): void => {
        try { ws.send(JSON.stringify({ context_id: contextId, cancel: true })); } catch { /* gone */ }
        settle(abortError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.oneShots.set(contextId, { onChunk, settle });

      const msg: Record<string, unknown> = {
        context_id: contextId,
        model_id: this.modelId,
        transcript: safeText,
        voice: this.buildVoice(),
        output_format: this.outputFormat(),
        add_timestamps: true,
        continue: false,
      };
      const gc = this.buildGenerationConfig(emotions);
      if (gc) msg.generation_config = gc;
      this.applyLang(msg);
      try { ws.send(JSON.stringify(msg)); } catch (err) { settle(err); }
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
      throw new Error(`Cartesia TTS stream error ${resp.status}: ${await resp.text()}`);
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
    const collect = (pcm: Buffer): void => { chunks.push(pcm); };
    await this.synthesizeViaRest(text, collect, () => undefined, undefined, emotions)
      .catch(async (err: unknown) => {
        if (emotions?.length && isInvalidVoiceControlsError(err)) {
          await this.synthesizeViaRest(text, collect, () => undefined);
          return;
        }
        throw err;
      });
    return {
      audio: Buffer.concat(chunks),
      characters: CartesiaTTS.ensureTerminalPunctuation(text).length,
    };
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
      if (isAbortErr(err, signal)) throw err;
      if (emotions?.length && isInvalidVoiceControlsError(err)) {
        return this.synthesizeViaWsOneShot(text, onChunk, onDone, signal);
      }
      this.onWsUnusableGlobal(err);
      return this.synthesizeViaRest(text, onChunk, onDone, signal, emotions);
    }
  }

  private onWsUnusableGlobal(err: unknown): void {
    if (/connect timeout|connection error|permanently failed|closed before open/i.test(errMsg(err))) {
      this.wsFailedPermanently = true;
    }
  }

  close(): void {
    this.wsFailedPermanently = true;
    if (this.ws) {
      try { this.ws.close(1000, "call ended"); } catch { /* already gone */ }
      this.ws = null;
    }
    this.wsConnecting = null;
    this.failAllInFlight(new Error("CartesiaTTS: WebSocket closed (call ended)"));
    this.turns.clear();
    this.oneShots.clear();
    this.contextSettings.clear();
  }
}

function normalizeSpeed(speed: number | null | undefined): number | null {
  if (speed == null || !Number.isFinite(speed) || speed === 1) return null;
  return Math.min(1.5, Math.max(0.6, speed));
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

function isAbortErr(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return err instanceof Error && err.name === "AbortError";
}
