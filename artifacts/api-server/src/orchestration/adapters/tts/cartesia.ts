import crypto from "node:crypto";
import { logger } from "../../../lib/logger.js";
import type { TTSAdapter } from "../../types.js";

/**
 * Cartesia — Sonic TTS
 *
 * Primary path: WebSocket (`/tts/websockets`)
 *   - One persistent WS connection per call (lazy-opened on first sentence).
 *   - No per-sentence TCP/TLS handshake → saves ~30–80ms per sentence.
 *   - max_buffer_delay_ms: 0 → we send complete sentences (client-side buffering).
 *   - One context_id per LLM turn. Later sentences are continuations (continue:true,
 *     no flush) so Cartesia keeps prosody — a per-sentence flush was the audible seam.
 *
 * Fallback: REST (`/tts/bytes`) — used if WS open fails or errors mid-call.
 *   - Exact same behaviour as before; REST path is unchanged.
 *
 * Docs:
 *   https://docs.cartesia.ai/api-reference/tts/websocket
 *   https://docs.cartesia.ai/api-reference/tts/bytes
 */

const MAX_RETRIES = 2;
const RETRY_BASE_MS = 300;
const CARTESIA_VERSION = "2026-03-01";
const WS_CONNECT_TIMEOUT_MS = 6_000;

/** Stable default. Sonic 3.6 is beta on `sonic-preview` until Cartesia GA. */
export const CARTESIA_DEFAULT_MODEL = "sonic-3.5";
/** Cartesia's live API id for Sonic 3.6 (beta). `sonic-3.6` is accepted as an alias. */
export const CARTESIA_SONIC_36_MODEL = "sonic-preview";

const CARTESIA_MODEL_ALIASES: Record<string, string> = {
  "sonic-3.6": CARTESIA_SONIC_36_MODEL,
};

const CARTESIA_VALID_MODELS = new Set([
  CARTESIA_DEFAULT_MODEL, "sonic-3.5-2026-05-04", "sonic-latest",
  CARTESIA_SONIC_36_MODEL,
  "sonic-3", "sonic-3-2026-01-12", "sonic-3-latest",
  "sonic-2", "sonic-2-2025-03-07", "sonic-2-2025-04-16", "sonic-2-2025-05-08", "sonic-2-2025-06-11",
  "sonic-turbo", "sonic-turbo-2025-03-07", "sonic-turbo-2025-06-04",
  "sonic-english", "sonic-multilingual",
]);

/** Map agent TTS model ids to a Cartesia `model_id`. Unknown ids fall back to 3.5. */
export function resolveCartesiaModelId(model: string | null | undefined): string {
  const raw = (model ?? "").trim();
  const id = CARTESIA_MODEL_ALIASES[raw] ?? raw;
  return CARTESIA_VALID_MODELS.has(id) ? id : CARTESIA_DEFAULT_MODEL;
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
  private speed: number | null;
  /** Native PCM rate Cartesia should emit — match the telephony wire to skip a second resample. */
  readonly pcmSampleRate: 8000 | 16000;

  private ws: WebSocket | null = null;
  private wsConnecting: Promise<WebSocket> | null = null;
  private wsFailedPermanently = false;
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
    this.language = language ? language.split("-")[0] : null;
    this.pcmSampleRate = sampleRate === 8000 ? 8000 : 16000;
  }

  private outputFormat(): { container: "raw"; encoding: "pcm_s16le"; sample_rate: 8000 | 16000 } {
    return { container: "raw", encoding: "pcm_s16le", sample_rate: this.pcmSampleRate };
  }

  setLanguage(lang: string): void {
    this.language = lang.split("-")[0];
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

  close(): void {
    this.wsFailedPermanently = true;
    if (this.ws) {
      try { this.ws.close(1000, "call ended"); } catch {}
      this.ws = null;
    }
    this.wsConnecting = null;
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
  }

  private buildWsUrl(): string {
    return `${CARTESIA_WS_BASE}/tts/websockets?api_key=${encodeURIComponent(this.key)}&cartesia_version=${encodeURIComponent(CARTESIA_VERSION)}`;
  }

  private buildVoice(): Record<string, unknown> {
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
    if (this.language) body.language = this.language;
    return JSON.stringify(body);
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
          reject(new Error("CartesiaTTS: WS connect timeout"));
          try { ws.close(); } catch {}
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
        this.ws = null;
        this.wsConnecting = null;
        settle(() => reject(new Error("CartesiaTTS: WS closed before open")));
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

  private handleWsMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(raw) as Record<string, unknown>; } catch { return; }

    const contextId = msg["context_id"] as string | undefined;
    if (!contextId) return;

    const type = msg["type"] as string | undefined;
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
          flushCtx.reject(new Error(`Cartesia WS turn error: ${String(msg["error"] ?? "unknown")}`));
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
      if (b64) ctx.onChunk(Buffer.from(b64, "base64"));
    } else if (type === "done") {
      this.pending.delete(contextId);
      ctx.resolve();
    } else if (type === "error") {
      this.pending.delete(contextId);
      ctx.reject(new Error(`Cartesia WS synthesis error: ${String(msg["error"] ?? "unknown")}`));
    }
  }

  /**
   * First sentence of a Cartesia turn claims the context. Later sentences join
   * it (skipDrain) so one PCM stream plays instead of N clipped jobs.
   */
  claimTurnContext(turnContextId: string): boolean {
    if (this.wsFailedPermanently) return true;
    if (this.claimedTurns.has(turnContextId)) return false;
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
    const safeText = CartesiaTTS.ensureTerminalPunctuation(text);

    const sendTranscript = (transcript: string): void => {
      const transcriptMsg: Record<string, unknown> = {
        context_id: turnContextId,
        model_id: this.modelId,
        transcript,
        voice: this.buildVoice(),
        output_format: this.outputFormat(),
        continue: true,
        max_buffer_delay_ms: 0,
      };
      const gcCtx = this.buildGenerationConfig(emotions);
      if (gcCtx) transcriptMsg.generation_config = gcCtx;
      if (this.language) transcriptMsg.language = this.language;
      ws.send(JSON.stringify(transcriptMsg));
      this.turnLastTranscript.set(turnContextId, transcript);
    };

    if (join) {
      const waitOpen = this.turnOpened.get(turnContextId);
      if (waitOpen) await waitOpen;
      if (!this.pending.has(turnContextId)) {
        return this.synthesizeViaWs(ws, text, onChunk, onDone, signal, emotions);
      }
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const transcript = joinContinuationTranscript(
        this.turnLastTranscript.get(turnContextId) ?? "",
        safeText,
      );
      await this.enqueueTurnSend(turnContextId, () => sendTranscript(transcript));
      onDone(safeText.length);
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
      const onAbort = (): void => cleanup(() => reject(new DOMException("Aborted", "AbortError")));
      signal?.addEventListener("abort", onAbort, { once: true });

      this.pending.set(turnContextId, {
        text: safeText,
        onChunk,
        resolve: () => cleanup(() => { onDone(safeText.length); resolve(); }),
        reject: (err) => cleanup(() => reject(err)),
      });
      this.turnOpenedResolve.get(turnContextId)?.();

      void this.enqueueTurnSend(turnContextId, () => sendTranscript(safeText)).catch((err) => {
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
    if (!this.wsFailedPermanently) {
      try {
        const ws = await this.getOrOpenWs();
        return await this.synthesizeViaWsInContext(ws, turnContextId, text, onChunk, onDone, signal, emotions, join);
      } catch (err) {
        if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) throw err;
        if (emotions && emotions.length > 0 && isInvalidVoiceControlsError(err)) {
          try {
            const ws = await this.getOrOpenWs();
            return await this.synthesizeViaWsInContext(ws, turnContextId, text, onChunk, onDone, signal, undefined, join);
          } catch (retryErr) {
            if (signal?.aborted || (retryErr instanceof DOMException && retryErr.name === "AbortError")) throw retryErr;
            this.wsFailedPermanently = true;
          }
        } else {
          this.wsFailedPermanently = true;
        }
      }
    }
    try {
      return await this.synthesizeViaRest(text, onChunk, onDone, signal, emotions);
    } catch (err) {
      if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) throw err;
      if (emotions && emotions.length > 0 && isInvalidVoiceControlsError(err)) {
        return this.synthesizeViaRest(text, onChunk, onDone, signal, undefined);
      }
      throw err;
    }
  }

  /**
   * Finalizes a turn context by telling Cartesia no more input is coming.
   * Must be called once after all sentences for the turn have been dispatched.
   */
  finalizeTurnContext(turnContextId: string): void {
    if (this.finalizedTurns.has(turnContextId)) return;
    this.finalizedTurns.add(turnContextId);
    this.claimedTurns.delete(turnContextId);
    const sendClose = (): void => {
      this.turnFlushCounters.delete(turnContextId);
      this.turnLastTranscript.delete(turnContextId);
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({
            context_id: turnContextId,
            transcript: "",
            continue: false,
          }));
        } catch { /* WS closing, fine */ }
      }
    };
    void this.enqueueTurnSend(turnContextId, sendClose);
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
    if (last === "." || last === "?" || last === "!" || last === "…") return text;
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
        max_buffer_delay_ms: 0,
      };
      const gcMsg = this.buildGenerationConfig(emotions);
      if (gcMsg) msg.generation_config = gcMsg;
      if (this.language) msg.language = this.language;

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
    if (!this.wsFailedPermanently) {
      try {
        const ws = await this.getOrOpenWs();
        return await this.synthesizeViaWs(ws, text, onChunk, onDone, signal, emotions);
      } catch (err) {
        if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) throw err;
        // Cartesia rejected the emotion/voice controls — retry once on the same
        // WS with plain (no-emotion) voice controls before falling back to REST.
        if (emotions && emotions.length > 0 && isInvalidVoiceControlsError(err)) {
          try {
            const ws = await this.getOrOpenWs();
            return await this.synthesizeViaWs(ws, text, onChunk, onDone, signal, undefined);
          } catch (retryErr) {
            if (signal?.aborted || (retryErr instanceof DOMException && retryErr.name === "AbortError")) throw retryErr;
            this.wsFailedPermanently = true;
          }
        } else {
          this.wsFailedPermanently = true;
        }
      }
    }
    try {
      return await this.synthesizeViaRest(text, onChunk, onDone, signal, emotions);
    } catch (err) {
      if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) throw err;
      if (emotions && emotions.length > 0 && isInvalidVoiceControlsError(err)) {
        return this.synthesizeViaRest(text, onChunk, onDone, signal, undefined);
      }
      throw err;
    }
  }
}
