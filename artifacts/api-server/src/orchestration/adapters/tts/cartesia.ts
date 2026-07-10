import crypto from "node:crypto";
import type { TTSAdapter } from "../../types.js";

/**
 * Cartesia — Sonic TTS
 *
 * Primary path: WebSocket (`/tts/websockets`)
 *   - One persistent WS connection per call (lazy-opened on first sentence).
 *   - No per-sentence TCP/TLS handshake → saves ~30–80ms per sentence.
 *   - max_buffer_delay_ms: 0 → Cartesia synthesises immediately, no server-side batching.
 *   - Each sentence gets its own context_id so concurrent prefetch sentences are muxed safely.
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

/** India endpoint by default for lowest latency; override via CARTESIA_BASE_URL env var. */
const CARTESIA_BASE_URL = (process.env["CARTESIA_BASE_URL"] ?? "https://api-india.cartesia.ai").replace(/\/+$/, "");

/** wss:// equivalent of CARTESIA_BASE_URL for the WebSocket endpoint. */
const CARTESIA_WS_BASE = CARTESIA_BASE_URL.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://");

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

export class CartesiaTTS implements TTSAdapter {
  private key: string;
  private voiceId: string;
  private modelId: string;
  private language: string | null;
  private speed: number | null;

  private ws: WebSocket | null = null;
  private wsConnecting: Promise<WebSocket> | null = null;
  private wsFailedPermanently = false;
  private readonly pending = new Map<string, PendingCtx>();

  constructor(
    apiKey: string,
    voice: string | null,
    model: string | null,
    language?: string | null,
    speed?: number | null,
  ) {
    this.key = apiKey;
    // Treat null, undefined, and empty string the same — fall back to Arushi.
    this.voiceId = (voice && voice.trim()) ? voice : "2ee87190-8f84-4925-97da-e52547f9462c";
    this.speed = (speed != null && Number.isFinite(speed) && speed !== 1)
      ? Math.min(2, Math.max(0.5, speed))
      : null;
    const VALID = new Set([
      "sonic-3.5", "sonic-3.5-2026-05-04", "sonic-latest",
      "sonic-3", "sonic-3-2026-01-12", "sonic-3-latest",
      "sonic-2", "sonic-2-2025-03-07", "sonic-2-2025-04-16", "sonic-2-2025-05-08", "sonic-2-2025-06-11",
      "sonic-turbo", "sonic-turbo-2025-03-07", "sonic-turbo-2025-06-04",
      "sonic-english", "sonic-multilingual",
    ]);
    this.modelId = model && VALID.has(model) ? model : "sonic-3.5";
    this.language = language ? language.split("-")[0] : null;
  }

  setLanguage(lang: string): void {
    this.language = lang.split("-")[0];
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
  }

  private buildWsUrl(): string {
    return `${CARTESIA_WS_BASE}/tts/websockets?api_key=${encodeURIComponent(this.key)}&cartesia_version=${encodeURIComponent(CARTESIA_VERSION)}`;
  }

  private buildVoice(): Record<string, unknown> {
    return this.speed != null
      ? { mode: "id", id: this.voiceId, __experimental_controls: { speed: this.speed } }
      : { mode: "id", id: this.voiceId };
  }

  private buildRestBody(text: string): string {
    const body: Record<string, unknown> = {
      transcript: text,
      model_id: this.modelId,
      voice: this.buildVoice(),
      output_format: { container: "raw", encoding: "pcm_s16le", sample_rate: 16000 },
    };
    if (this.language) body.language = this.language;
    return JSON.stringify(body);
  }

  private get restHeaders() {
    return {
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
      });
    });

    return this.wsConnecting;
  }

  private handleWsMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(raw) as Record<string, unknown>; } catch { return; }

    const contextId = msg["context_id"] as string | undefined;
    if (!contextId) return;
    const ctx = this.pending.get(contextId);
    if (!ctx) return;

    const type = msg["type"] as string | undefined;
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
  private static ensureTerminalPunctuation(text: string): string {
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
        output_format: { container: "raw", encoding: "pcm_s16le", sample_rate: 16000 },
        continue: false,
        max_buffer_delay_ms: 0,
      };
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
  ): Promise<void> {
    const safeText = CartesiaTTS.ensureTerminalPunctuation(text);
    const resp = await fetchWithRetry(`${CARTESIA_BASE_URL}/tts/bytes`, {
      method: "POST",
      headers: this.restHeaders,
      body: this.buildRestBody(safeText),
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

  async synthesize(text: string): Promise<{ audio: Buffer; characters: number }> {
    const safeText = CartesiaTTS.ensureTerminalPunctuation(text);
    const resp = await fetchWithRetry(`${CARTESIA_BASE_URL}/tts/bytes`, {
      method: "POST",
      headers: this.restHeaders,
      body: this.buildRestBody(safeText),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Cartesia TTS error ${resp.status}: ${err}`);
    }

    return { audio: Buffer.from(await resp.arrayBuffer()), characters: safeText.length };
  }

  async synthesizeStream(
    text: string,
    onChunk: (pcm16k: Buffer) => void,
    onDone: (characters: number) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!this.wsFailedPermanently) {
      try {
        const ws = await this.getOrOpenWs();
        return await this.synthesizeViaWs(ws, text, onChunk, onDone, signal);
      } catch (err) {
        if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) throw err;
        this.wsFailedPermanently = true;
      }
    }
    return this.synthesizeViaRest(text, onChunk, onDone, signal);
  }
}
