import crypto from "node:crypto";
import { logger } from "../../../lib/logger.js";
import type { TTSAdapter } from "../../types.js";

/**
 * Cartesia — Sonic TTS
 *
 * Primary path: WebSocket (`/tts/websocket`)
 *   - One persistent WS connection per call (lazy-opened on first transcript).
 *   - Stream LLM tokens with continue:true and omit max_buffer_delay_ms so
 *     Cartesia managed buffering decides when to start speech (docs default
 *     3000ms cap; the model starts earlier when it has enough context).
 *   - Do not pre-split Tamil/English clauses client-side — that was custom
 *     buffering stacked on the API (call 24396 ~2s/turn).
 *   - continue:false (empty transcript) when the LLM turn ends.
 *   - pcm_s16le @ the leg rate: 8000 for VoBiz, 16000 for HD webcall.
 *
 * Fallback: REST (`/tts/bytes`) — WS-down, or leftover text if Cartesia
 *   closed the context (400).
 *
 * Docs:
 *   https://docs.cartesia.ai/use-the-api/tts-websocket/buffering
 *   https://docs.cartesia.ai/build-with-cartesia/capability-guides/stream-inputs-using-continuations
 *   https://docs.cartesia.ai/api-reference/tts/websocket
 */

const MAX_RETRIES = 2;
const RETRY_BASE_MS = 300;
const CARTESIA_VERSION = "2026-03-01";
const WS_CONNECT_TIMEOUT_MS = 6_000;

/** Cartesia current TTS model (https://docs.cartesia.ai/build-with-cartesia/tts-models/latest). */
export const CARTESIA_DEFAULT_MODEL = "sonic-3.6";
/** Production Sonic 3.6 id. `sonic-preview` stays a separate beta snapshot. */
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

/** Map agent TTS model ids to a Cartesia `model_id`. 3.5 stays 3.5; 3.6 stays 3.6. */
export function resolveCartesiaModelId(model: string | null | undefined): string {
  const raw = (model ?? "").trim();
  if (!raw) return CARTESIA_DEFAULT_MODEL;
  const key = raw.toLowerCase().replace(/\s+/g, "-");
  const id = CARTESIA_MODEL_ALIASES[key] ?? raw;
  return CARTESIA_VALID_MODELS.has(id) ? id : CARTESIA_DEFAULT_MODEL;
}

/** `en-IN` → language `en` + locale `en-IN` (Sonic 3.6 date/number reading). */
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
  return { language, locale: null };
}

/** India endpoint by default for lowest latency; override via CARTESIA_BASE_URL env var. */
const CARTESIA_BASE_URL = (process.env["CARTESIA_BASE_URL"] ?? "https://api-india.cartesia.ai").replace(/\/+$/, "");

/** wss:// equivalent of CARTESIA_BASE_URL for the WebSocket endpoint. */
const CARTESIA_WS_BASE = CARTESIA_BASE_URL.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://");

/**
 * Detects Cartesia's "invalid voice controls" family of errors (400s caused by
 * an `__experimental_controls.emotion` value the API no longer accepts, e.g.
 * "invalid emotion level: medium" after Cartesia deprecated/renamed levels).
 * Used to trigger a one-time same-sentence retry with emotion controls
 * stripped, instead of letting the error propagate and end the call.
 */
function isInvalidVoiceControlsError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /invalid voice controls|invalid emotion|generation_config/i.test(msg);
}

/**
 * Cartesia closes a continue:true context after the first clip when
 * max_buffer_delay_ms is 0 (call 19809). That is a per-context 400, not a
 * dead WebSocket — leftover sentences must REST, not kill the session.
 */
export function isCartesiaContextClosedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /context has closed|no longer accepting new inputs|use a new context id/i.test(msg);
}

/** Quiet after the last WS chunk ≈ first clip finished (fallback if no `done`). */
const FIRST_CLIP_QUIET_MS = 400;

/** Cartesia continuations require the joined transcripts to be a valid string. */
export function joinContinuationTranscript(previous: string, next: string): string {
  if (!next) return next;
  if (!previous) return next;
  if (/^\s/.test(next)) return next;
  return ` ${next}`;
}

/** Emotion enum accepted by generation_config.emotion (2026-03-01 spec). */
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

/** Legacy "family:level" bases → nearest current enum value. */
const LEGACY_EMOTION_MAP: Record<string, string> = {
  positivity: "happy",
  sadness: "sad",
  curiosity: "curious",
  anger: "angry",
  surprise: "surprised",
};

/**
 * Current Cartesia API takes ONE emotion enum string; the old scheme was an
 * array of "family:level" tags (now rejected — see the strip-and-retry
 * fallback). Accept both shapes from callers: plain enum names pass through,
 * legacy pairs map to the nearest enum value, unknowns are dropped.
 */
function normalizeEmotion(emotions?: string[]): string | undefined {
  const first = emotions?.[0]?.trim().toLowerCase();
  if (!first) return undefined;
  const base = first.split(":")[0]!.trim();
  if (CARTESIA_EMOTIONS.has(base)) return base;
  const mapped = LEGACY_EMOTION_MAP[base];
  return mapped && CARTESIA_EMOTIONS.has(mapped) ? mapped : undefined;
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = MAX_RETRIES,
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      lastErr = err;
      const isNetwork = err instanceof TypeError && !(err.name === "AbortError");
      if (!isNetwork || attempt === retries) throw err;
      await new Promise<void>((r) => setTimeout(r, RETRY_BASE_MS * 2 ** attempt));
    }
  }
  throw lastErr;
}

interface PendingCtx {
  text: string;
  onChunk: (pcm: Buffer) => void;
  resolve: () => void;
  reject: (err: unknown) => void;
}

/**
 * Pending entry for a sentence within a turn-level context (manual flushing).
 * Keyed by `${contextId}:${flushId}` in CartesiaTTS.flushPending.
 */
interface FlushPendingCtx {
  onChunk: (pcm: Buffer) => void;
  resolve: () => void;
  reject: (err: unknown) => void;
}

export class CartesiaTTS implements TTSAdapter {
  private key: string;
  private voiceId: string;
  private modelId: string;
  private language: string | null;
  /** Sonic 3.6 locale (`en-IN`, `en-GB`) — dates/numbers read the local way. */
  private locale: string | null;
  private speed: number | null;
  /** Native PCM rate Cartesia should emit. 8 kHz on VoBiz; 16 kHz on HD webcall. */
  readonly pcmSampleRate: 8000 | 16000;

  private ws: WebSocket | null = null;
  private wsConnecting: Promise<WebSocket> | null = null;
  private wsFailedPermanently = false;
  /** Log handshake-level WS death only once per call. */
  private wsFallbackLogged = false;
  /** Turns that already spoke via REST — do not also send WS continue:false (second voice). */
  private readonly restFallbackTurns = new Set<string>();
  private readonly pending = new Map<string, PendingCtx>();
  /** Turn-level flush tracking: key = `${contextId}:${flushId}` */
  private readonly flushPending = new Map<string, FlushPendingCtx>();
  /** Client-side flush_id counter per turn context (legacy flush path; unused for continuations). */
  private readonly turnFlushCounters = new Map<string, number>();
  /** First sentence's chunk sink — later continuations must not open a second stream. */
  private readonly turnChunkHandlers = new Map<string, (pcm: Buffer) => void>();
  private readonly turnLastTranscript = new Map<string, string>();
  private readonly claimedTurns = new Set<string>();
  private readonly turnSendChains = new Map<string, Promise<void>>();
  private readonly turnOpened = new Map<string, Promise<void>>();
  private readonly turnOpenedResolve = new Map<string, () => void>();
  private readonly finalizedTurns = new Set<string>();
  /** First WS clip finished (premature `done`, context-closed 400, or quiet). */
  private readonly firstClipDone = new Set<string>();
  private readonly firstClipWaiters = new Map<string, Array<() => void>>();
  private readonly firstClipQuietTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly turnWsBytes = new Map<string, number>();
  private readonly closedTurns = new Set<string>();
  /** Join sentences claimed while delay=0 — leftover REST still in flight. */
  private readonly leftoverPending = new Map<string, number>();
  private readonly leftoverPendingWaiters = new Map<string, Array<() => void>>();
  private readonly leftoverRestChains = new Map<string, Promise<void>>();
  private readonly finalizedWaiters = new Map<string, Array<() => void>>();

  constructor(
    apiKey: string,
    voice: string | null,
    model: string | null,
    language?: string | null,
    speed?: number | null,
    sampleRate?: number | null,
  ) {
    this.key = apiKey;
    // Treat null, undefined, and empty string the same — fall back to Arushi.
    this.voiceId = (voice && voice.trim()) ? voice : "2ee87190-8f84-4925-97da-e52547f9462c";
    // generation_config.speed documented range is [0.6, 1.5] — out-of-range
    // values are rejected, so clamp instead of forwarding raw agent config.
    this.speed = (speed != null && Number.isFinite(speed) && speed !== 1)
      ? Math.min(1.5, Math.max(0.6, speed))
      : null;
    this.modelId = resolveCartesiaModelId(model);
    const parsedLang = parseCartesiaLang(language);
    this.language = parsedLang.language;
    this.locale = parsedLang.locale;
    this.pcmSampleRate = sampleRate === 8000 ? 8000 : 16000;
  }

  /** Cartesia `model_id` actually sent (3.5 or 3.6 as selected). */
  get resolvedModelId(): string {
    return this.modelId;
  }

  private outputFormat(): { container: "raw"; encoding: "pcm_s16le"; sample_rate: 8000 | 16000 } {
    return { container: "raw", encoding: "pcm_s16le", sample_rate: this.pcmSampleRate };
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

  /** Fire-and-forget WS pre-warm — called at session start so the greeting
   *  doesn't pay the TCP+TLS+WS handshake cost on first synthesis. */
  warmup(): void {
    void this.getOrOpenWs().catch(() => {
      // Failure here is fine — synthesizeStream will retry or fall back to REST.
    });
  }

  private errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  private isAbortErr(err: unknown, signal?: AbortSignal): boolean {
    if (signal?.aborted) return true;
    if (err instanceof DOMException && err.name === "AbortError") return true;
    return err instanceof Error && err.name === "AbortError";
  }

  /**
   * Handshake cannot be established — REST for the rest of this call.
   * Do NOT use this for a single context/synthesis error: that was forcing
   * every later sentence onto slow REST (timeouts / word-jump) and replaying
   * the same text after WS already streamed audio (speaking twice).
   */
  private markWsFailed(err: unknown, where: string): void {
    this.wsFailedPermanently = true;
    if (!this.wsFallbackLogged) {
      this.wsFallbackLogged = true;
      const msg = this.errMsg(err);
      logger.warn(
        { evt: "cartesia_ws_fallback_rest", where, err: msg },
        `CartesiaTTS: WebSocket handshake failed (${msg.slice(0, 160)}) — REST for the rest of this call`,
      );
    }
  }

  /** Finish this sentence on REST only when WS produced no PCM (no double-speak). */
  private async restIfSilent(
    text: string,
    onChunk: (pcm16k: Buffer) => void,
    onDone: (characters: number) => void,
    signal: AbortSignal | undefined,
    emotions: string[] | undefined,
    wsBytes: number,
    where: string,
    err: unknown,
    turnContextId?: string,
  ): Promise<void> {
    const msg = this.errMsg(err);
    if (wsBytes > 0) {
      logger.warn(
        { evt: "cartesia_skip_rest_duplicate", where, wsBytes, err: msg },
        `CartesiaTTS: WS already delivered audio (${wsBytes} bytes) — skipping REST replay (${msg.slice(0, 120)})`,
      );
      onDone(text.length);
      return;
    }
    if (turnContextId) this.restFallbackTurns.add(turnContextId);
    logger.warn(
      { evt: "cartesia_rest_sentence", where, err: msg },
      `CartesiaTTS: WS sentence failed with no audio (${msg.slice(0, 160)}) — REST this sentence only`,
    );
    try {
      await this.synthesizeViaRest(text, onChunk, onDone, signal, emotions);
    } catch (restErr) {
      if (this.isAbortErr(restErr, signal)) throw restErr;
      if (emotions && emotions.length > 0 && isInvalidVoiceControlsError(restErr)) {
        await this.synthesizeViaRest(text, onChunk, onDone, signal, undefined);
        return;
      }
      throw restErr;
    }
  }

  close(): void {
    this.wsFailedPermanently = true;
    if (this.ws) {
      try { this.ws.close(1000, "call ended"); } catch {}
      this.ws = null;
    }
    this.wsConnecting = null;
    for (const timer of this.firstClipQuietTimers.values()) clearTimeout(timer);
    this.firstClipQuietTimers.clear();
    for (const resolveOpen of this.turnOpenedResolve.values()) resolveOpen();
    for (const id of [...this.claimedTurns]) {
      this.markFirstClipDone(id);
      this.bumpLeftoverPending(id, -(this.leftoverPending.get(id) ?? 0));
      const fw = this.finalizedWaiters.get(id);
      this.finalizedWaiters.delete(id);
      for (const w of fw ?? []) w();
    }
    for (const [, ctx] of this.pending) {
      ctx.reject(new Error("CartesiaTTS: WebSocket closed (call ended)"));
    }
    this.pending.clear();
    for (const [, ctx] of this.flushPending) {
      ctx.reject(new Error("CartesiaTTS: WebSocket closed (call ended)"));
    }
    this.flushPending.clear();
    this.turnFlushCounters.clear();
    this.turnChunkHandlers.clear();
    this.turnLastTranscript.clear();
    this.claimedTurns.clear();
    this.turnSendChains.clear();
    this.turnOpened.clear();
    this.turnOpenedResolve.clear();
    this.finalizedTurns.clear();
    this.restFallbackTurns.clear();
    this.firstClipDone.clear();
    this.firstClipWaiters.clear();
    this.closedTurns.clear();
    this.turnWsBytes.clear();
    this.leftoverPending.clear();
    this.leftoverPendingWaiters.clear();
    this.leftoverRestChains.clear();
    this.finalizedWaiters.clear();
  }

  private buildWsUrl(): string {
    return `${CARTESIA_WS_BASE}/tts/websocket?api_key=${encodeURIComponent(this.key)}&cartesia_version=${encodeURIComponent(CARTESIA_VERSION)}`;
  }

  /**
   * Cartesia-Version 2026-03-01 WS requires `{ mode: "id", id }`.
   * `{ id }` alone is rejected as "Voice ID required" (call 19760) after
   * partial audio — that abort is the audible mid-sentence break.
   */
  private buildVoice(): { mode: "id"; id: string } {
    return { mode: "id", id: this.voiceId };
  }

  /**
   * Current API (2026-03-01): speed/volume/emotion live in a top-level
   * `generation_config` object — `voice.__experimental_controls` is gone from
   * the spec (it was silently ignored/rejected). Speed is a double in
   * [0.6, 1.5]; emotion is a SINGLE enum string, not the legacy array.
   */
  private buildGenerationConfig(emotions?: string[]): Record<string, unknown> | undefined {
    const gc: Record<string, unknown> = {};
    if (this.speed != null) gc.speed = this.speed;
    const emotion = normalizeEmotion(emotions);
    if (emotion) {
      gc.emotion = emotion;
      logger.info({ evt: "cartesia_emotion_controls", emotion }, "Injecting emotion into Cartesia generation_config");
    }
    return Object.keys(gc).length > 0 ? gc : undefined;
  }

  private buildRestBody(text: string, emotions?: string[]): string {
    const body: Record<string, unknown> = {
      transcript: text,
      model_id: this.modelId,
      voice: this.buildVoice(),
      output_format: this.outputFormat(),
    };
    const gc = this.buildGenerationConfig(emotions);
    if (gc) body.generation_config = gc;
    this.applyLang(body);
    return JSON.stringify(body);
  }

  /**
   * Cartesia: `language` OR `locale`, never both (docs: TTSRequest). Sending
   * both 400s every clip — silent call. `locale` is Sonic 3.6+ only; the India
   * endpoint we use still speaks `language` (`en`). Keep locale off the wire.
   */
  private applyLang(msg: Record<string, unknown>): void {
    if (this.language) msg.language = this.language;
  }

  private get restHeaders() {
    return {
      // Documented auth for 2026-03-01 is Authorization: Bearer; X-API-Key is
      // the legacy header, kept during the transition for compatibility.
      "Authorization": `Bearer ${this.key}`,
      "X-API-Key": this.key,
      "Cartesia-Version": CARTESIA_VERSION,
      "Content-Type": "application/json",
    };
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

      const ws = new WebSocket(this.buildWsUrl());

      const timer = setTimeout(() => {
        settle(() => {
          this.wsConnecting = null;
          logger.warn(
            { evt: "cartesia_ws_connect_timeout", timeoutMs: WS_CONNECT_TIMEOUT_MS },
            "CartesiaTTS: WebSocket handshake exceeded connect timeout — will fall back to REST",
          );
          reject(new Error("CartesiaTTS: WS connect timeout"));
          try { ws.close(); } catch {}
        });
      }, WS_CONNECT_TIMEOUT_MS);

      ws.addEventListener("open", () => {
        clearTimeout(timer);
        this.ws = ws;
        logger.info(
          { evt: "cartesia_ws_open" },
          "CartesiaTTS: WebSocket connected — using streaming WS path",
        );
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
        // Only the *live* socket may clear singleton state. Warmup opens WS
        // ~2–3s before greeting TTS (AMD + greeting LLM). If that idle socket
        // closes while a newer socket is already open — or while greeting
        // pending is registered — the old handler used to null `this.ws` and
        // reject EVERY context (call 19742: ws_open then instant REST fallback).
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
        logger.warn(
          { evt: "cartesia_ws_closed" },
          "CartesiaTTS: live WebSocket closed — next sentence will reconnect",
        );
        for (const [id, ctx] of this.pending) {
          ctx.reject(new Error("CartesiaTTS: WS closed mid-stream"));
          this.pending.delete(id);
        }
        for (const [, ctx] of this.flushPending) {
          ctx.reject(new Error("CartesiaTTS: WS closed mid-stream"));
        }
        this.flushPending.clear();
      });
    });

    return this.wsConnecting;
  }

  private formatWsError(msg: Record<string, unknown>): string {
    const bits = [
      msg["error_code"] ?? msg["errorCode"],
      msg["title"],
      msg["message"],
      msg["error"],
      msg["detail"],
      msg["status_code"] != null
        ? `status=${String(msg["status_code"])}`
        : (msg["status"] != null ? `status=${String(msg["status"])}` : null),
    ].filter((v) => v != null && String(v).trim() !== "" && String(v) !== "undefined");
    return bits.length > 0 ? bits.map(String).join(" — ") : "unknown";
  }

  private handleWsMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(raw) as Record<string, unknown>; } catch { return; }

    const type = msg["type"] as string | undefined;
    const contextId = msg["context_id"] as string | undefined;

    // 2026-03-01 errors use { type, error_code, title, message, status_code }.
    // `context_id` is optional — dropping those used to look like a silent WS death.
    if (type === "error") {
      const detail = this.formatWsError(msg);
      logger.warn(
        { evt: "cartesia_ws_error", contextId, errorCode: msg["error_code"] ?? msg["errorCode"], status: msg["status_code"] ?? msg["status"], detail },
        `CartesiaTTS: WebSocket error — ${detail.slice(0, 240)}`,
      );
      if (!contextId) {
        for (const [id, ctx] of this.pending) {
          ctx.reject(new Error(`Cartesia WS synthesis error: ${detail}`));
          this.pending.delete(id);
        }
        for (const [key, flushCtx] of this.flushPending) {
          flushCtx.reject(new Error(`Cartesia WS turn error: ${detail}`));
          this.flushPending.delete(key);
        }
        return;
      }
    }

    if (!contextId) return;

    const flushId = msg["flush_id"] as number | undefined;

    // Route to flush-tracked pending (turn-level contexts using manual flushing).
    if (flushId != null) {
      const key = `${contextId}:${flushId}`;
      const flushCtx = this.flushPending.get(key);
      if (flushCtx) {
        if (type === "chunk") {
          const b64 = msg["data"] as string | undefined;
          if (b64) flushCtx.onChunk(Buffer.from(b64, "base64"));
        } else if (type === "done" || type === "flush_done") {
          // "flush_done" is the documented per-flush ack; "done" kept for
          // compatibility with servers that send per-flush dones.
          this.flushPending.delete(key);
          flushCtx.resolve();
        } else if (type === "error") {
          this.flushPending.delete(key);
          flushCtx.reject(new Error(`Cartesia WS turn error: ${this.formatWsError(msg)}`));
        }
        return;
      }
    }

    // Context-level done without flush_id: safety net — resolves any remaining
    // flush entries for this context in case the server sends a single done
    // instead of per-flush dones.
    if (type === "done" && flushId == null) {
      for (const [key, flushCtx] of this.flushPending) {
        if (key.startsWith(`${contextId}:`)) {
          this.flushPending.delete(key);
          flushCtx.resolve();
        }
      }
    }

    // Route to per-sentence pending (single-sentence contexts, no flushing).
    const ctx = this.pending.get(contextId);
    if (!ctx) return;

    if (type === "chunk") {
      const b64 = msg["data"] as string | undefined;
      if (b64) {
        const buf = Buffer.from(b64, "base64");
        this.turnWsBytes.set(contextId, (this.turnWsBytes.get(contextId) ?? 0) + buf.length);
        this.armFirstClipQuiet(contextId);
        ctx.onChunk(buf);
      }
    } else if (type === "done") {
      // Call 18112 / 19809: delay=0 emits `done` after clip 1 while more
      // sentences are still queued. Mark first-clip complete so leftover REST
      // can start; do not resolve the owner until leftover audio is queued.
      this.markFirstClipDone(contextId);
      if (this.claimedTurns.has(contextId) && !this.finalizedTurns.has(contextId)) {
        return;
      }
      this.pending.delete(contextId);
      ctx.resolve();
    } else if (type === "error") {
      const err = new Error(`Cartesia WS synthesis error: ${this.formatWsError(msg)}`);
      if (
        isCartesiaContextClosedError(err)
        && this.claimedTurns.has(contextId)
        && !this.finalizedTurns.has(contextId)
      ) {
        this.closedTurns.add(contextId);
        this.markFirstClipDone(contextId);
        const wsBytes = this.turnWsBytes.get(contextId) ?? 0;
        logger.info(
          { evt: "cartesia_context_closed_after_first_clip", contextId, wsBytes },
          "Cartesia closed turn context after first clip — leftover sentences via REST",
        );
        if (wsBytes > 0) return;
      }
      this.markFirstClipDone(contextId);
      this.pending.delete(contextId);
      ctx.reject(err);
    }
  }

  /**
   * First sentence of a Cartesia turn claims the context. Later sentences join
   * it (skipDrain) so one PCM stream plays instead of N clipped jobs.
   */
  claimTurnContext(turnContextId: string): boolean {
    // Always one owner per turn. Returning true on WS-down (old behavior)
    // made every sentence a new playJob — call 17915: two Playback Started
    // rows and a 3s stall on the second clip.
    if (this.claimedTurns.has(turnContextId) || this.finalizedTurns.has(turnContextId)) {
      return false;
    }
    this.claimedTurns.add(turnContextId);
    this.turnOpened.set(turnContextId, new Promise<void>((r) => {
      this.turnOpenedResolve.set(turnContextId, r);
    }));
    return true;
  }

  private enqueueTurnSend(turnContextId: string, send: () => void): Promise<void> {
    const prev = this.turnSendChains.get(turnContextId) ?? Promise.resolve();
    const next = prev.then(() => { send(); }).catch(() => { /* prior send failed; keep chain alive */ });
    this.turnSendChains.set(turnContextId, next);
    return next;
  }

  private markFirstClipDone(turnContextId: string): void {
    if (this.firstClipDone.has(turnContextId)) return;
    this.firstClipDone.add(turnContextId);
    const quiet = this.firstClipQuietTimers.get(turnContextId);
    if (quiet) {
      clearTimeout(quiet);
      this.firstClipQuietTimers.delete(turnContextId);
    }
    const waiters = this.firstClipWaiters.get(turnContextId);
    this.firstClipWaiters.delete(turnContextId);
    for (const w of waiters ?? []) w();
  }

  private waitFirstClipComplete(turnContextId: string): Promise<void> {
    if (this.firstClipDone.has(turnContextId) || this.closedTurns.has(turnContextId)) {
      return Promise.resolve();
    }
    return new Promise<void>((r) => {
      const arr = this.firstClipWaiters.get(turnContextId) ?? [];
      arr.push(r);
      this.firstClipWaiters.set(turnContextId, arr);
    });
  }

  private armFirstClipQuiet(turnContextId: string): void {
    if (this.firstClipDone.has(turnContextId) || this.finalizedTurns.has(turnContextId)) return;
    const prev = this.firstClipQuietTimers.get(turnContextId);
    if (prev) clearTimeout(prev);
    this.firstClipQuietTimers.set(turnContextId, setTimeout(() => {
      this.firstClipQuietTimers.delete(turnContextId);
      this.markFirstClipDone(turnContextId);
    }, FIRST_CLIP_QUIET_MS));
  }

  private bumpLeftoverPending(turnContextId: string, delta: number): void {
    const n = Math.max(0, (this.leftoverPending.get(turnContextId) ?? 0) + delta);
    this.leftoverPending.set(turnContextId, n);
    if (n === 0) {
      const waiters = this.leftoverPendingWaiters.get(turnContextId);
      this.leftoverPendingWaiters.delete(turnContextId);
      for (const w of waiters ?? []) w();
    }
  }

  private waitLeftoversIdle(turnContextId: string): Promise<void> {
    if ((this.leftoverPending.get(turnContextId) ?? 0) === 0) return Promise.resolve();
    return new Promise<void>((r) => {
      const arr = this.leftoverPendingWaiters.get(turnContextId) ?? [];
      arr.push(r);
      this.leftoverPendingWaiters.set(turnContextId, arr);
    });
  }

  private waitTurnFinalized(turnContextId: string): Promise<void> {
    if (this.finalizedTurns.has(turnContextId)) return Promise.resolve();
    return new Promise<void>((r) => {
      const arr = this.finalizedWaiters.get(turnContextId) ?? [];
      arr.push(r);
      this.finalizedWaiters.set(turnContextId, arr);
    });
  }

  private enqueueLeftoverRest(turnContextId: string, work: () => Promise<void>): Promise<void> {
    this.bumpLeftoverPending(turnContextId, 1);
    const prev = this.leftoverRestChains.get(turnContextId) ?? Promise.resolve();
    const next = prev.then(() => work(), () => work());
    this.leftoverRestChains.set(turnContextId, next.then(() => undefined, () => undefined));
    return next;
  }

  private async runLeftoverRest(
    turnContextId: string,
    text: string,
    fallbackSink: (pcm: Buffer) => void,
    onDone: (characters: number) => void,
    signal: AbortSignal | undefined,
    emotions: string[] | undefined,
  ): Promise<void> {
    try {
      const waitOpen = this.turnOpened.get(turnContextId);
      if (waitOpen) await waitOpen;
      const owner = this.turnChunkHandlers.get(turnContextId) ?? fallbackSink;
      await this.waitFirstClipComplete(turnContextId);
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      logger.info(
        { evt: "cartesia_leftover_rest", contextId: turnContextId, chars: text.length },
        "Cartesia leftover sentence via REST after first clip (call 19809)",
      );
      await this.synthesizeViaRest(text, owner, onDone, signal, emotions);
    } finally {
      this.bumpLeftoverPending(turnContextId, -1);
    }
  }

  private cleanupTurnMaps(turnContextId: string): void {
    const quiet = this.firstClipQuietTimers.get(turnContextId);
    if (quiet) clearTimeout(quiet);
    this.firstClipQuietTimers.delete(turnContextId);
    this.firstClipWaiters.delete(turnContextId);
    this.leftoverPendingWaiters.delete(turnContextId);
    this.turnWsBytes.delete(turnContextId);
    this.leftoverRestChains.delete(turnContextId);
    this.leftoverPending.delete(turnContextId);
    this.closedTurns.delete(turnContextId);
    this.firstClipDone.delete(turnContextId);
  }

  /**
   * After leftover REST, close the Cartesia context if it is still open.
   * Call 19809: delay=0 already closed it after clip 1 — do not send
   * continue:false (that 400s) and resolve the owner pending instead.
   */
  private async completeTurnContext(turnContextId: string): Promise<void> {
    await this.waitLeftoversIdle(turnContextId);
    const chain = this.leftoverRestChains.get(turnContextId);
    if (chain) await chain.catch(() => undefined);

    const skipClose = this.restFallbackTurns.has(turnContextId)
      || this.closedTurns.has(turnContextId);

    if (skipClose || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      const ctx = this.pending.get(turnContextId);
      if (ctx) ctx.resolve();
      this.cleanupTurnMaps(turnContextId);
      return;
    }

    const sendClose = (): void => {
      this.turnFlushCounters.delete(turnContextId);
      this.turnLastTranscript.delete(turnContextId);
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({
            context_id: turnContextId,
            model_id: this.modelId,
            transcript: "",
            voice: this.buildVoice(),
            output_format: this.outputFormat(),
            continue: false,
          }));
        } catch { /* WS closing, fine */ }
      }
    };
    void this.enqueueTurnSend(turnContextId, sendClose);
  }

  /**
   * Synthesis within a shared turn context. First call owns the PCM sink and
   * waits until the context is finalized. Later calls only append transcript
   * (continue:true, no flush) so Sonic keeps one prosody contour.
   */
  private async synthesizeViaWsInContext(
    ws: WebSocket,
    turnContextId: string,
    text: string,
    onChunk: (pcm16k: Buffer) => void,
    onDone: (characters: number) => void,
    signal: AbortSignal | undefined,
    emotions: string[] | undefined,
    join: boolean,
  ): Promise<void> {
    const streamed = text;

    const sendTranscript = (transcript: string): void => {
      const transcriptMsg: Record<string, unknown> = {
        context_id: turnContextId,
        model_id: this.modelId,
        transcript,
        voice: this.buildVoice(),
        output_format: this.outputFormat(),
        continue: true,
      };
      const gcCtx = this.buildGenerationConfig(emotions);
      if (gcCtx) transcriptMsg.generation_config = gcCtx;
      this.applyLang(transcriptMsg);
      ws.send(JSON.stringify(transcriptMsg));
      this.turnLastTranscript.set(turnContextId, transcript);
    };

    if (join) {
      const waitOpen = this.turnOpened.get(turnContextId);
      if (waitOpen) await waitOpen;
      if (!this.pending.has(turnContextId)) {
        // Owner already closed or fell back to REST. Do not open a fresh
        // context_id — that is a second voice start (audible seam).
        const owner = this.turnChunkHandlers.get(turnContextId) ?? onChunk;
        return this.synthesizeViaRest(text, owner, onDone, signal, emotions);
      }
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const transcript = joinContinuationTranscript(
        this.turnLastTranscript.get(turnContextId) ?? "",
        streamed,
      );
      await this.enqueueTurnSend(turnContextId, () => sendTranscript(transcript));
      onDone(streamed.length);
      return;
    }

    this.turnChunkHandlers.set(turnContextId, onChunk);

    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }

      const cleanup = (fn: () => void): void => {
        signal?.removeEventListener("abort", onAbort);
        this.pending.delete(turnContextId);
        this.turnChunkHandlers.delete(turnContextId);
        fn();
      };
      const onAbort = (): void => {
        this.markFirstClipDone(turnContextId);
        cleanup(() => reject(new DOMException("Aborted", "AbortError")));
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      this.pending.set(turnContextId, {
        text: streamed,
        onChunk,
        resolve: () => cleanup(() => { onDone(streamed.length); resolve(); }),
        reject: (err) => {
          this.markFirstClipDone(turnContextId);
          cleanup(() => reject(err));
        },
      });
      this.turnOpenedResolve.get(turnContextId)?.();

      void this.enqueueTurnSend(turnContextId, () => sendTranscript(streamed)).catch((err) => {
        cleanup(() => reject(err));
      });
    });
  }

  /**
   * Public entry-point for per-sentence turn-level synthesis.
   * Falls back to normal per-sentence REST synthesis if the WS is broken.
   */
  async synthesizeStreamInContext(
    turnContextId: string,
    text: string,
    onChunk: (pcm16k: Buffer) => void,
    onDone: (characters: number) => void,
    signal?: AbortSignal,
    emotions?: string[],
    join = false,
  ): Promise<void> {
    // Register the owner sink before awaiting WS so a later sentence can
    // append into the same PCM queue even if this call falls back to REST.
    if (!join) {
      this.turnChunkHandlers.set(turnContextId, onChunk);
    }
    // delay=0: leftover sentences REST after clip 1. Register before awaiting
    // WS so finalizeTurnContext can wait on leftoverPending even if this
    // sentence's IIFE has not reached getOrOpenWs yet.
    if (join && (this.closedTurns.has(turnContextId) || this.restFallbackTurns.has(turnContextId))) {
      return this.enqueueLeftoverRest(turnContextId, () =>
        this.runLeftoverRest(turnContextId, text, onChunk, onDone, signal, emotions),
      );
    }
    const sink = join
      ? (this.turnChunkHandlers.get(turnContextId) ?? onChunk)
      : onChunk;
    const releaseOwnerWait = (): void => {
      if (!join) this.turnOpenedResolve.get(turnContextId)?.();
    };

    let wsBytes = 0;
    const countedSink = (buf: Buffer): void => {
      wsBytes += buf.length;
      sink(buf);
    };

    if (!this.wsFailedPermanently) {
      try {
        const ws = await this.getOrOpenWs();
        return await this.synthesizeViaWsInContext(ws, turnContextId, text, countedSink, onDone, signal, emotions, join);
      } catch (err) {
        if (this.isAbortErr(err, signal)) throw err;
        if (isCartesiaContextClosedError(err)) {
          this.closedTurns.add(turnContextId);
          this.markFirstClipDone(turnContextId);
        }
        if (emotions && emotions.length > 0 && isInvalidVoiceControlsError(err)) {
          try {
            const ws = await this.getOrOpenWs();
            return await this.synthesizeViaWsInContext(ws, turnContextId, text, countedSink, onDone, signal, undefined, join);
          } catch (retryErr) {
            if (this.isAbortErr(retryErr, signal)) throw retryErr;
            if (isCartesiaContextClosedError(retryErr)) {
              this.closedTurns.add(turnContextId);
              this.markFirstClipDone(turnContextId);
            }
            if (/connect timeout|connection error|permanently failed|closed before open/i.test(this.errMsg(retryErr))) {
              this.markWsFailed(retryErr, "streamInContext:retry");
            }
            releaseOwnerWait();
            await this.restIfSilent(text, sink, onDone, signal, undefined, wsBytes, "streamInContext:retry", retryErr, turnContextId);
            return;
          }
        } else {
          if (/connect timeout|connection error|permanently failed|closed before open/i.test(this.errMsg(err))) {
            this.markWsFailed(err, "streamInContext");
          }
          releaseOwnerWait();
          await this.restIfSilent(text, sink, onDone, signal, emotions, wsBytes, "streamInContext", err, turnContextId);
          return;
        }
      }
    }
    releaseOwnerWait();
    await this.restIfSilent(text, sink, onDone, signal, emotions, 0, "streamInContext:wsDown", new Error("WS permanently failed"), turnContextId);
  }

  /**
   * Finalizes a turn context after all sentences have been dispatched.
   * delay=0 leftover REST must finish before the owner pending resolves so
   * playJob drain does not exit with remaining sentence PCM still in flight.
   */
  finalizeTurnContext(turnContextId: string): void {
    if (this.finalizedTurns.has(turnContextId)) return;
    this.finalizedTurns.add(turnContextId);
    const waiters = this.finalizedWaiters.get(turnContextId);
    this.finalizedWaiters.delete(turnContextId);
    for (const w of waiters ?? []) w();
    void this.completeTurnContext(turnContextId);
  }

  /**
   * Cartesia docs: text without terminal punctuation (`.`, `?`, `!`) can cause
   * audio artifacts — the model may treat incomplete text as still-incoming and
   * generate an oddly-ended or distorted clip. We always add a period when the
   * final printable character isn't already sentence-ending punctuation.
   *
   * Handles trailing SSML/nonverbalism tags correctly:
   *   "Your ID is <spell>AB12</spell>"  → "Your ID is <spell>AB12</spell>."
   *   "Great question! [laughter]"      → "Great question! [laughter]."
   *   "How can I help you?"             → unchanged
   */
  static ensureTerminalPunctuation(text: string): string {
    const trimmed = text.trimEnd();
    if (!trimmed) return text;
    // Check the trimmed form — no need to strip tags, just look at the last char.
    const last = trimmed[trimmed.length - 1]!;
    if (last === "." || last === "?" || last === "!" || last === "…" || last === "।") return text;
    // Sonic 3.5/3.6: a comma is a pause, not a missing period. Adding "." here
    // makes "Hello Gopi," speak as a full stop ("Hello Gopi.") — robotic cadence.
    if (last === "," || last === ";" || last === ":") return text;
    return trimmed + ".";
  }

  private synthesizeViaWs(
    ws: WebSocket,
    text: string,
    onChunk: (pcm16k: Buffer) => void,
    onDone: (characters: number) => void,
    signal?: AbortSignal,
    emotions?: string[],
  ): Promise<void> {
    const safeText = CartesiaTTS.ensureTerminalPunctuation(text);

    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }

      const contextId = crypto.randomUUID();

      const cleanup = (fn: () => void) => {
        signal?.removeEventListener("abort", onAbort);
        this.pending.delete(contextId);
        fn();
      };

      const onAbort = () => cleanup(() => reject(new DOMException("Aborted", "AbortError")));
      signal?.addEventListener("abort", onAbort, { once: true });

      this.pending.set(contextId, {
        text: safeText,
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
      const gcMsg = this.buildGenerationConfig(emotions);
      if (gcMsg) msg.generation_config = gcMsg;
      this.applyLang(msg);

      try {
        ws.send(JSON.stringify(msg));
      } catch (err) {
        cleanup(() => reject(err));
      }
    });
  }

  private async synthesizeViaRest(
    text: string,
    onChunk: (pcm16k: Buffer) => void,
    onDone: (characters: number) => void,
    signal?: AbortSignal,
    emotions?: string[],
  ): Promise<void> {
    const safeText = CartesiaTTS.ensureTerminalPunctuation(text);
    const resp = await fetchWithRetry(`${CARTESIA_BASE_URL}/tts/bytes`, {
      method: "POST",
      headers: this.restHeaders,
      body: this.buildRestBody(safeText, emotions),
      signal,
    });

    if (!resp.ok) {
      const err = await resp.text();
      logger.warn(
        { evt: "cartesia_rest_error", status: resp.status, body: err.slice(0, 300) },
        resp.status === 429
          ? "CartesiaTTS: REST /tts/bytes rate-limited (429 concurrency_limited/quota_exceeded)"
          : "CartesiaTTS: REST /tts/bytes non-OK response",
      );
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
    const safeText = CartesiaTTS.ensureTerminalPunctuation(text);
    const doRequest = async (withEmotions?: string[]): Promise<{ audio: Buffer; characters: number }> => {
      const resp = await fetchWithRetry(`${CARTESIA_BASE_URL}/tts/bytes`, {
        method: "POST",
        headers: this.restHeaders,
        body: this.buildRestBody(safeText, withEmotions),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        if (resp.status === 429) {
          logger.warn(
            { evt: "cartesia_rest_error", status: 429, body: errText.slice(0, 300) },
            "CartesiaTTS: one-shot /tts/bytes rate-limited (429 concurrency_limited/quota_exceeded)",
          );
        }
        throw new Error(`Cartesia TTS error ${resp.status}: ${errText}`);
      }

      return { audio: Buffer.from(await resp.arrayBuffer()), characters: safeText.length };
    };

    try {
      return await doRequest(emotions);
    } catch (err) {
      // Cartesia rejected the emotion/voice controls — retry once without them
      // instead of failing the whole call for a single sentence's styling.
      if (emotions && emotions.length > 0 && isInvalidVoiceControlsError(err)) {
        return doRequest(undefined);
      }
      throw err;
    }
  }

  async synthesizeStream(
    text: string,
    onChunk: (pcm16k: Buffer) => void,
    onDone: (characters: number) => void,
    signal?: AbortSignal,
    emotions?: string[],
  ): Promise<void> {
    let wsBytes = 0;
    const countedSink = (buf: Buffer): void => {
      wsBytes += buf.length;
      onChunk(buf);
    };
    if (!this.wsFailedPermanently) {
      try {
        const ws = await this.getOrOpenWs();
        return await this.synthesizeViaWs(ws, text, countedSink, onDone, signal, emotions);
      } catch (err) {
        if (this.isAbortErr(err, signal)) throw err;
        if (emotions && emotions.length > 0 && isInvalidVoiceControlsError(err)) {
          try {
            const ws = await this.getOrOpenWs();
            return await this.synthesizeViaWs(ws, text, countedSink, onDone, signal, undefined);
          } catch (retryErr) {
            if (this.isAbortErr(retryErr, signal)) throw retryErr;
            if (/connect timeout|connection error|permanently failed|closed before open/i.test(this.errMsg(retryErr))) {
              this.markWsFailed(retryErr, "stream:retry");
            }
            return await this.restIfSilent(text, onChunk, onDone, signal, undefined, wsBytes, "stream:retry", retryErr);
          }
        } else {
          if (/connect timeout|connection error|permanently failed|closed before open/i.test(this.errMsg(err))) {
            this.markWsFailed(err, "stream");
          }
          return await this.restIfSilent(text, onChunk, onDone, signal, emotions, wsBytes, "stream", err);
        }
      }
    }
    return await this.restIfSilent(text, onChunk, onDone, signal, emotions, 0, "stream:wsDown", new Error("WS permanently failed"));
  }
}
