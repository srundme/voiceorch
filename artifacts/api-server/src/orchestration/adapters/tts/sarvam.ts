import { WebSocket } from "ws";
import type { TTSAdapter } from "../../types.js";
import { logger } from "../../../lib/logger.js";

/**
 * Sarvam AI — Text-to-Speech (Bulbul)
 *
 * Paths (in preference order for live calls):
 *   1. WebSocket  wss://api.sarvam.ai/text-to-speech/ws   (persistent; config → text → flush)
 *   2. HTTP stream POST /text-to-speech/stream            (fallback after WS retries)
 *   3. REST        POST /text-to-speech                    (fillers / cache)
 *
 * Best practices (docs):
 *   - Config message first after connect
 *   - Flush after text so the buffer finishes
 *   - Ping every ~30s (idle close ~1 min)
 *   - send_completion_event=true → wait for event_type=final
 *   - Keep the socket open across utterances; close only on barge-in
 *   - Chunk text <500 chars so barge-in discards less audio
 *   - Reconnect with backoff on 1006/1011; never blind-retry 4xxx
 *
 * Docs: https://docs.sarvam.ai/api/api-guides-tutorials/text-to-speech/streaming-api/web-socket
 */

const BASE = "https://api.sarvam.ai";
const WS_BASE = "wss://api.sarvam.ai/text-to-speech/ws";
const WAV_HEADER_BYTES = 44;
const WS_CONNECT_TIMEOUT_MS = 8_000;
const WS_PING_INTERVAL_MS = 30_000;
const WS_RETRY_MAX = 3;
const WS_RETRY_BASE_MS = 400;
const WS_RETRY_MAX_MS = 4_000;

/** REST /text-to-speech caps input at 2,500 characters. */
const MAX_TTS_CHARS = 2400;
/** HTTP stream /text-to-speech/stream caps at 3,500 characters. */
const MAX_STREAM_CHARS = 3400;
/** WS text messages: max 2,500; keep under 500 for lowest latency / barge-in. */
const MAX_WS_TEXT_CHARS = 500;

const VALID_MODELS = new Set(["bulbul:v3", "bulbul:v3-beta", "bulbul:v2"]);

const SARVAM_LANG: Record<string, string> = {
  "en":    "en-IN", "en-IN": "en-IN", "en-US": "en-IN", "en-GB": "en-IN",
  "ta":    "ta-IN", "ta-IN": "ta-IN",
  "hi":    "hi-IN", "hi-IN": "hi-IN",
  "te":    "te-IN", "te-IN": "te-IN",
  "kn":    "kn-IN", "kn-IN": "kn-IN",
  "mr":    "mr-IN", "mr-IN": "mr-IN",
  "gu":    "gu-IN", "gu-IN": "gu-IN",
  "bn":    "bn-IN", "bn-IN": "bn-IN",
  "ml":    "ml-IN", "ml-IN": "ml-IN",
  "pa":    "pa-IN", "pa-IN": "pa-IN",
  "or":    "od-IN", "or-IN": "od-IN", "od": "od-IN", "od-IN": "od-IN",
};

const DEFAULT_SPEAKER: Record<string, string> = {
  "bulbul:v3":      "ritu",
  "bulbul:v3-beta": "ritu",
  "bulbul:v2":      "anushka",
};

const V2_SPEAKERS = new Set([
  "anushka", "abhilash", "manisha", "vidya", "arya", "karun", "hitesh",
]);

/** Built-in Bulbul speakers (v2 + v3). Anything else is treated as a Creative Studio clone id. */
const CATALOG_SPEAKERS = new Set([
  ...V2_SPEAKERS,
  "ritu", "priya", "neha", "pooja", "simran", "kavya", "ishita", "shreya", "roopa",
  "tanya", "shruti", "suhani", "kavitha", "rupali",
  "rahul", "rohan", "aditya", "amit", "dev", "ratan", "varun", "manan", "sumit",
  "kabir", "aayan", "shubh", "ashutosh", "advait", "anand", "tarun", "sunny",
  "mani", "gokul", "vijay", "mohit", "rehan", "soham",
]);

/** True when `speaker` is a public Bulbul catalog name (not a user clone). */
export function isSarvamCatalogSpeaker(speaker: string | null | undefined): boolean {
  if (!speaker) return false;
  return CATALOG_SPEAKERS.has(speaker.trim().toLowerCase());
}

/** Cartesia-style UUIDs — reject so a pasted Cartesia id never hits Sarvam. */
function looksLikeUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function resolveSpeaker(voice: string | null, model: string): string {
  const fallback = DEFAULT_SPEAKER[model] ?? "ritu";
  if (!voice) return fallback;
  const trimmed = voice.trim();
  if (!trimmed || looksLikeUuid(trimmed)) return fallback;
  if (model === "bulbul:v2") return V2_SPEAKERS.has(trimmed) ? trimmed : fallback;
  // v3: reject known v2-only names; accept catalog speakers AND Creative Studio
  // cloned speaker ids (hyphenated custom ids are allowed — only UUIDs are rejected).
  if (V2_SPEAKERS.has(trimmed)) return fallback;
  return trimmed;
}

function apiModel(model: string): "bulbul:v2" | "bulbul:v3" {
  return model === "bulbul:v2" ? "bulbul:v2" : "bulbul:v3";
}

function abortError(): Error {
  const err = new Error("Aborted");
  err.name = "AbortError";
  return err;
}

/** Application-specific WS close (auth/quota) — do not blind-retry. */
class SarvamWsFatalError extends Error {
  constructor(message: string, readonly code: number) {
    super(message);
    this.name = "SarvamWsFatalError";
  }
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function retryDelayMs(attempt: number): number {
  const base = Math.min(WS_RETRY_MAX_MS, WS_RETRY_BASE_MS * 2 ** attempt);
  const jitter = Math.floor(Math.random() * 150);
  return base + jitter;
}

export class SarvamTTS implements TTSAdapter {
  private key: string;
  private speaker: string;
  private model: string;
  private langCode: string;
  private pace: number | null;
  /** Expand digits to spoken Indic forms ("500" → "paanch sau"). Default on. */
  private enablePreprocessing = true;

  /** Idle configured socket — reused across utterances until barge-in / idle close. */
  private warmWs: WebSocket | null = null;
  private warmConnecting: Promise<WebSocket> | null = null;
  private warmPingTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  /** True while an utterance owns the warm/live WS — parallel prefetch must not steal it. */
  private wsInUse = false;

  constructor(
    apiKey: string,
    voice: string | null,
    extraConfig?: string | null,
    language?: string | null,
    model?: string | null,
    speed?: number | null,
  ) {
    this.key = apiKey;
    this.model = (model && VALID_MODELS.has(model)) ? model : "bulbul:v3";

    let lang = language ?? null;
    if (extraConfig) {
      try {
        const cfg = JSON.parse(extraConfig) as {
          language?: string;
          model?: string;
          enable_preprocessing?: boolean;
        };
        if (!lang) lang = cfg.language ?? null;
        if (cfg.model && VALID_MODELS.has(cfg.model)) this.model = cfg.model;
        if (typeof cfg.enable_preprocessing === "boolean") {
          this.enablePreprocessing = cfg.enable_preprocessing;
        }
      } catch {
        // ignore malformed extraConfig
      }
    }
    this.langCode = (lang && SARVAM_LANG[lang]) ? SARVAM_LANG[lang]! : "en-IN";
    this.speaker = resolveSpeaker(voice, this.model);
    this.pace = (typeof speed === "number" && Number.isFinite(speed))
      ? Math.min(2, Math.max(0.5, speed))
      : null;
  }

  setLanguage(lang: string): void {
    const next = SARVAM_LANG[lang] ?? SARVAM_LANG[lang.split("-")[0]!] ?? "en-IN";
    if (next === this.langCode) return;
    this.langCode = next;
    // Config on the warm socket is stale — next synth opens a fresh connection.
    this.dropWarmWs();
  }

  warmup(): void {
    if (this.closed) return;
    void this.ensureWarmWs().catch((err) => {
      logger.warn({ err }, "SarvamTTS warmup failed — first synth will open fresh");
    });
  }

  close(): void {
    this.closed = true;
    this.dropWarmWs();
  }

  private get headers() {
    return {
      "api-subscription-key": this.key,
      "Content-Type": "application/json",
    };
  }

  private applyPace(body: Record<string, unknown>): void {
    if (this.pace !== null && Math.abs(this.pace - 1) > 0.001) body["pace"] = this.pace;
  }

  private static splitForLimit(text: string, maxChars: number): string[] {
    if (text.length <= maxChars) return [text];
    const parts: string[] = [];
    let rest = text;
    while (rest.length > maxChars) {
      let cut = rest.lastIndexOf(" ", maxChars);
      if (cut < maxChars / 2) cut = maxChars;
      parts.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trimStart();
    }
    if (rest) parts.push(rest);
    return parts.filter((p) => p.length > 0);
  }

  private buildConfigPayload(): Record<string, unknown> {
    const data: Record<string, unknown> = {
      speaker: this.speaker,
      target_language_code: this.langCode,
      speech_sample_rate: "16000",
      output_audio_codec: "linear16",
      min_buffer_size: 50,
      max_chunk_length: 200,
    };
    this.applyPace(data);
    return data;
  }

  private dropWarmWs(): void {
    if (this.warmPingTimer) {
      clearInterval(this.warmPingTimer);
      this.warmPingTimer = null;
    }
    const ws = this.warmWs;
    this.warmWs = null;
    this.warmConnecting = null;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      try { ws.close(1000, "dropped"); } catch { /* ignore */ }
    }
  }

  /** Park an open socket for the next utterance; ping keeps idle ~1 min alive. */
  private parkWarmWs(ws: WebSocket): void {
    if (this.closed || ws.readyState !== WebSocket.OPEN) {
      try { ws.close(1000, "not parking"); } catch { /* ignore */ }
      return;
    }
    if (this.warmWs && this.warmWs !== ws) {
      // Already have a spare — close the extra.
      try { ws.close(1000, "extra"); } catch { /* ignore */ }
      return;
    }
    this.warmWs = ws;
    this.startWarmPing(ws);
    ws.once("close", () => {
      if (this.warmWs === ws) {
        if (this.warmPingTimer) {
          clearInterval(this.warmPingTimer);
          this.warmPingTimer = null;
        }
        this.warmWs = null;
      }
    });
  }

  private startWarmPing(ws: WebSocket): void {
    if (this.warmPingTimer) clearInterval(this.warmPingTimer);
    this.warmPingTimer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        this.dropWarmWs();
        return;
      }
      try { ws.send(JSON.stringify({ type: "ping" })); } catch { this.dropWarmWs(); }
    }, WS_PING_INTERVAL_MS);
    this.warmPingTimer.unref?.();
  }

  private buildWsUrl(): string {
    const url = new URL(WS_BASE);
    url.searchParams.set("model", apiModel(this.model));
    url.searchParams.set("send_completion_event", "true");
    return url.toString();
  }

  private openConfiguredWs(): Promise<WebSocket> {
    return new Promise<WebSocket>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };

      const ws = new WebSocket(this.buildWsUrl(), {
        headers: { "api-subscription-key": this.key },
      });

      const timer = setTimeout(() => {
        settle(() => {
          try { ws.close(); } catch { /* ignore */ }
          reject(new Error("SarvamTTS: WS connect timeout"));
        });
      }, WS_CONNECT_TIMEOUT_MS);

      ws.once("open", () => {
        try {
          // Config MUST be the first message after connect.
          ws.send(JSON.stringify({ type: "config", data: this.buildConfigPayload() }));
        } catch (err) {
          settle(() => {
            try { ws.close(); } catch { /* ignore */ }
            reject(err instanceof Error ? err : new Error(String(err)));
          });
          return;
        }
        settle(() => resolve(ws));
      });

      ws.once("error", (err) => {
        settle(() => reject(err instanceof Error ? err : new Error("SarvamTTS: WS error")));
      });

      ws.once("close", (code, reason) => {
        const reasonStr = reason?.toString?.() ?? "";
        settle(() => {
          if (code >= 4000 && code <= 4999) {
            reject(new SarvamWsFatalError(
              `SarvamTTS: WS auth/quota close ${code}${reasonStr ? `: ${reasonStr}` : ""}`,
              code,
            ));
          } else {
            reject(new Error(`SarvamTTS: WS closed during connect (${code})`));
          }
        });
      });
    });
  }

  private async ensureWarmWs(): Promise<WebSocket> {
    if (this.warmWs && this.warmWs.readyState === WebSocket.OPEN) return this.warmWs;
    if (this.warmConnecting) return this.warmConnecting;
    this.warmConnecting = this.openConfiguredWs()
      .then((ws) => {
        this.warmWs = ws;
        this.warmConnecting = null;
        this.startWarmPing(ws);
        ws.once("close", () => {
          if (this.warmWs === ws) {
            if (this.warmPingTimer) {
              clearInterval(this.warmPingTimer);
              this.warmPingTimer = null;
            }
            this.warmWs = null;
          }
        });
        return ws;
      })
      .catch((err) => {
        this.warmConnecting = null;
        throw err;
      });
    return this.warmConnecting;
  }

  /** Take the warm socket if available; otherwise open a fresh configured one. */
  private async takeWs(): Promise<WebSocket> {
    if (this.warmWs && this.warmWs.readyState === WebSocket.OPEN) {
      const ws = this.warmWs;
      if (this.warmPingTimer) {
        clearInterval(this.warmPingTimer);
        this.warmPingTimer = null;
      }
      this.warmWs = null;
      return ws;
    }
    return this.openConfiguredWs();
  }

  private async synthesizeOne(text: string): Promise<Buffer> {
    const body: Record<string, unknown> = {
      inputs: [text],
      target_language_code: this.langCode,
      speaker: this.speaker,
      model: this.model,
      enable_preprocessing: this.enablePreprocessing,
      speech_sample_rate: 16000,
    };
    this.applyPace(body);

    const resp = await fetch(`${BASE}/text-to-speech`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Sarvam TTS error ${resp.status}: ${err}`);
    }

    const json = (await resp.json()) as { audios?: string[] };
    if (!json.audios?.[0]) throw new Error("Sarvam TTS: no audio in response");

    const wav = Buffer.from(json.audios[0], "base64");
    return wav.slice(WAV_HEADER_BYTES);
  }

  async synthesize(text: string): Promise<{ audio: Buffer; characters: number }> {
    const parts = SarvamTTS.splitForLimit(text, MAX_TTS_CHARS);
    const buffers: Buffer[] = [];
    for (const part of parts) buffers.push(await this.synthesizeOne(part));
    return {
      audio: buffers.length === 1 ? buffers[0]! : Buffer.concat(buffers),
      characters: text.length,
    };
  }

  /**
   * Streaming synthesis — WebSocket first (with backoff), HTTP stream fallback.
   * Yields raw PCM s16le @ 16 kHz chunks.
   *
   * Parallel sentence prefetch: if the warm WS is already synthesizing sentence N,
   * sentence N+1 uses HTTP stream instead of stealing the socket (calls 4852/4853
   * firstByteMs spikes up to ~1s when two utterances contended for one WS).
   */
  async synthesizeStream(
    text: string,
    onChunk: (pcm16k: Buffer) => void,
    onDone: (characters: number) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) throw abortError();
    if (this.closed) throw new Error("SarvamTTS: closed");

    if (this.wsInUse) {
      logger.info("SarvamTTS WS busy — parallel synth via HTTP stream");
      await this.synthesizeViaHttpStream(text, onChunk, signal);
      onDone(text.length);
      return;
    }

    this.wsInUse = true;
    try {
      let lastErr: unknown;
      for (let attempt = 0; attempt < WS_RETRY_MAX; attempt++) {
        if (signal?.aborted) throw abortError();
        try {
          await this.synthesizeViaWs(text, onChunk, signal);
          onDone(text.length);
          return;
        } catch (err) {
          if (isAbort(err)) throw err;
          lastErr = err;
          if (err instanceof SarvamWsFatalError) {
            logger.warn({ err }, "SarvamTTS WS fatal (auth/quota) — not retrying WS");
            break;
          }
          if (attempt + 1 < WS_RETRY_MAX) {
            const delay = retryDelayMs(attempt);
            logger.warn({ err, attempt, delay }, "SarvamTTS WS failed — reconnect backoff");
            await sleep(delay);
          }
        }
      }

      logger.warn({ err: lastErr }, "SarvamTTS WS exhausted — falling back to HTTP stream");
      await this.synthesizeViaHttpStream(text, onChunk, signal);
      onDone(text.length);
    } finally {
      this.wsInUse = false;
    }
  }

  private async synthesizeViaWs(
    text: string,
    onChunk: (pcm16k: Buffer) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const ws = await this.takeWs();
    const parts = SarvamTTS.splitForLimit(text, MAX_WS_TEXT_CHARS);

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn();
      };

      const onAbort = () => {
        // Barge-in: close socket so server stops generating; next reply opens fresh.
        settle(() => {
          try { ws.close(1000, "barge-in"); } catch { /* ignore */ }
          reject(abortError());
        });
      };

      const onMessage = (raw: WebSocket.RawData) => {
        let msg: { type?: string; data?: Record<string, unknown> };
        try {
          msg = JSON.parse(String(raw)) as { type?: string; data?: Record<string, unknown> };
        } catch {
          return;
        }

        if (msg.type === "audio") {
          const b64 = msg.data?.["audio"];
          if (typeof b64 === "string" && b64.length > 0) {
            onChunk(Buffer.from(b64, "base64"));
          }
          return;
        }

        if (msg.type === "event") {
          // send_completion_event=true → final marks end of this utterance.
          if (msg.data?.["event_type"] === "final") {
            settle(() => {
              this.parkWarmWs(ws); // keep connection for the next sentence
              resolve();
            });
          }
          return;
        }

        if (msg.type === "error") {
          const message = String(msg.data?.["message"] ?? "unknown");
          settle(() => {
            try { ws.close(); } catch { /* ignore */ }
            reject(new Error(`SarvamTTS WS error: ${message}`));
          });
        }
      };

      const onClose = (code: number, reason: Buffer) => {
        settle(() => {
          const reasonStr = reason?.toString?.() ?? "";
          if (code >= 4000 && code <= 4999) {
            reject(new SarvamWsFatalError(
              `SarvamTTS: WS auth/quota close ${code}${reasonStr ? `: ${reasonStr}` : ""}`,
              code,
            ));
          } else if (code === 1000) {
            // Normal close without final — treat as done (legacy servers).
            resolve();
          } else {
            reject(new Error(`SarvamTTS: WS closed mid-stream (${code})`));
          }
        });
      };

      const onError = (err: Error) => {
        settle(() => reject(err));
      };

      const cleanup = () => {
        signal?.removeEventListener("abort", onAbort);
        ws.off("message", onMessage);
        ws.off("close", onClose);
        ws.off("error", onError);
      };

      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      ws.on("message", onMessage);
      ws.once("close", onClose);
      ws.once("error", onError);

      try {
        for (const part of parts) {
          ws.send(JSON.stringify({ type: "text", data: { text: part } }));
        }
        // Flush so remaining buffer is processed even below min_buffer_size.
        ws.send(JSON.stringify({ type: "flush" }));
      } catch (err) {
        settle(() => reject(err instanceof Error ? err : new Error(String(err))));
      }
    });
  }

  private async synthesizeViaHttpStream(
    text: string,
    onChunk: (pcm16k: Buffer) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const parts = SarvamTTS.splitForLimit(text, MAX_STREAM_CHARS);
    for (const part of parts) {
      await this.httpStreamOne(part, onChunk, signal);
    }
  }

  private async httpStreamOne(
    text: string,
    onChunk: (pcm16k: Buffer) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const body: Record<string, unknown> = {
      text,
      target_language_code: this.langCode,
      speaker: this.speaker,
      model: apiModel(this.model),
      enable_preprocessing: this.enablePreprocessing,
      speech_sample_rate: 16000,
      output_audio_codec: "linear16",
    };
    this.applyPace(body);

    const resp = await fetch(`${BASE}/text-to-speech/stream`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
      signal,
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Sarvam TTS stream error ${resp.status}: ${err}`);
    }
    if (!resp.body) throw new Error("Sarvam TTS stream: no response body");

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
  }
}
