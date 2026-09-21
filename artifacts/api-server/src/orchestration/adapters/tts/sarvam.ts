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
const WS_CONNECT_TIMEOUT_MS = 4_000;
const WS_PING_INTERVAL_MS = 30_000;
const WS_RETRY_MAX = 3;
/** After flush, if the WS goes fully idle this long with no message (audio,
 * event, or error), assume "final" was lost and resolve — every armed message
 * re-arms the timer, so slow-but-alive synthesis of long sentences is safe. */
const FINAL_EVENT_IDLE_MS = Math.max(1500, Number(process.env.SARVAM_TTS_FINAL_IDLE_MS ?? 2500));
const WS_RETRY_BASE_MS = 400;
const WS_RETRY_MAX_MS = 4_000;

/**
 * Decode Sarvam REST `audios[0]` to raw s16le PCM.
 * Prefer linear16 responses (no header). If WAV/RIFF, locate the `data` chunk
 * instead of blindly slicing 44 bytes (non-canonical headers cause clicks).
 */
function pcmFromSarvamAudio(b64: string): Buffer {
  return stripRiffHeader(Buffer.from(b64, "base64"));
}

/**
 * Strip a WAV/RIFF header from a buffer if present, returning only PCM data.
 * Streaming paths MUST use this too — header bytes fed into the pipeline as
 * PCM are audible as a click/crackle at the start of every sentence.
 */
function stripRiffHeader(buf: Buffer): Buffer {
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF") return buf;
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = Math.min(buf.length, dataStart + size);
    if (id === "data") return buf.subarray(dataStart, dataEnd);
    offset = dataStart + size + (size % 2);
  }
  return buf.length > WAV_HEADER_BYTES ? buf.subarray(WAV_HEADER_BYTES) : buf;
}

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

/**
 * Bulbul v3 language for this utterance. Indic script in the text wins over
 * the session tag — otherwise Tamil LLM output tagged `en-IN`/`hi-IN` is
 * spoken with a North-Indian accent (call 26668 / Tamil-like-Hindi reports).
 * Latin-only text keeps `fallback` so "Okay" on a Tamil call does not flip TTS.
 */
export function resolveSarvamTtsLanguageCode(text: string, fallback: string): string {
  const t = text ?? "";
  if (/[\u0B80-\u0BFF]/.test(t)) return "ta-IN";
  if (/[\u0C00-\u0C7F]/.test(t)) return "te-IN";
  if (/[\u0C80-\u0CFF]/.test(t)) return "kn-IN";
  if (/[\u0D00-\u0D7F]/.test(t)) return "ml-IN";
  if (/[\u0A80-\u0AFF]/.test(t)) return "gu-IN";
  if (/[\u0A00-\u0A7F]/.test(t)) return "pa-IN";
  if (/[\u0B00-\u0B7F]/.test(t)) return "od-IN";
  if (/[\u0980-\u09FF]/.test(t)) return "bn-IN";
  if (/[\u0900-\u097F]/.test(t)) {
    const mapped = SARVAM_LANG[fallback] ?? fallback;
    return mapped === "mr-IN" ? "mr-IN" : "hi-IN";
  }
  return SARVAM_LANG[fallback] ?? SARVAM_LANG[fallback.split("-")[0] ?? ""] ?? "en-IN";
}

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

function resolveSpeaker(voice: string | null, model: string): string {
  const fallback = DEFAULT_SPEAKER[model] ?? "ritu";
  if (!voice) return fallback;
  const trimmed = voice.trim();
  if (!trimmed) return fallback;
  if (model === "bulbul:v2") return V2_SPEAKERS.has(trimmed) ? trimmed : fallback;
  // v3: reject known v2-only names; pass through catalog speakers and Creative
  // Studio clone ids (`svc-…` or the uuid after the prefix). Never remap a
  // clone id to a catalog voice — that made probe/save look fine while calls
  // spoke as ritu.
  if (V2_SPEAKERS.has(trimmed)) {
    logger.warn(
      { voice: trimmed, model, fallback },
      "SarvamTTS: speaker is v2-only and not available on v3 — falling back. Update the agent voice to a v3-compatible speaker.",
    );
    return fallback;
  }
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
  readonly synthesisScheduling = "serial" as const;
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
  /**
   * Sarvam accepts many utterances on one configured socket, but only one
   * flush cycle can own that socket at a time. Keep concurrent sentence
   * prefetch ordered instead of moving sentence N+1 to the slower HTTP path.
   */
  private synthesisTail: Promise<void> = Promise.resolve();

  /** Native PCM rate of returned chunks. 8 kHz on VoBiz; 16 kHz on HD webcall. */
  readonly pcmSampleRate: 8000 | 16000;

  constructor(
    apiKey: string,
    voice: string | null,
    extraConfig?: string | null,
    language?: string | null,
    model?: string | null,
    speed?: number | null,
    sampleRate?: number | null,
  ) {
    this.key = apiKey;
    this.pcmSampleRate = sampleRate === 8000 ? 8000 : 16000;
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

  private preprocessingOverride: boolean | null = null;

  /** Disable preprocessing for the next synthesize call only (e.g. for OTP/phone number/digit accuracy). */
  disablePreprocessingForNextCall(): void {
    this.preprocessingOverride = this.enablePreprocessing;
    this.enablePreprocessing = false;
    setTimeout(() => {
      if (this.preprocessingOverride !== null) {
        this.enablePreprocessing = this.preprocessingOverride;
        this.preprocessingOverride = null;
      }
    }, 5000);
  }

  setLanguage(lang: string): void {
    const next = SARVAM_LANG[lang] ?? SARVAM_LANG[lang.split("-")[0]!] ?? "en-IN";
    if (next === this.langCode) return;
    this.langCode = next;
    // Drop the warm WS — Sarvam's WS protocol does not support re-configuration on an existing socket.
    // Eagerly warm up a fresh WS with the new language so the next utterance doesn't pay connect latency.
    this.dropWarmWs();
    void this.ensureWarmWs().catch((err) => {
      logger.warn({ err }, "SarvamTTS: proactive warm-up after language change failed");
    });
  }

  setSpeed(speed: number | null): void {
    this.pace = (typeof speed === "number" && Number.isFinite(speed))
      ? Math.min(2, Math.max(0.5, speed))
      : null;
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
      // Prefer sentence boundaries (period, danda, question, exclamation)
      // before falling back to space, then hard cut.
      let cut = -1;
      for (const sep of [". ", "। ", "? ", "! ", "।", ".", "?", "!"]) {
        const idx = rest.lastIndexOf(sep, maxChars);
        if (idx > maxChars / 2) { cut = idx + sep.length; break; }
      }
      if (cut === -1) {
        cut = rest.lastIndexOf(" ", maxChars);
        if (cut < maxChars / 2) cut = maxChars;
      }
      parts.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trimStart();
    }
    if (rest) parts.push(rest);
    return parts.filter((p) => p.length > 0);
  }

  /**
   * Sarvam WS `min_buffer_size` is minimum *character* length that triggers
   * a flush (integer 30–200, SDK default 50) — not PCM bytes. Sending
   * `(sampleRate/1000)*10*2` (160 @ 8 kHz, 320 @ 16 kHz) made 16 kHz webcall
   * fail with "Input parameters has to be a valid dictionary" (call 17933).
   */
  private minBufferChars(): number {
    return 50;
  }

  private buildConfigPayload(): Record<string, unknown> {
    const data: Record<string, unknown> = {
      speaker: this.speaker,
      // Bulbul v3: language_code. Also send the older REST name so fallbacks
      // that still read target_language_code keep the same tag.
      language_code: this.langCode,
      target_language_code: this.langCode,
      speech_sample_rate: this.pcmSampleRate,
      output_audio_codec: "linear16",
      min_buffer_size: this.minBufferChars(),
      max_chunk_length: 500,
    };
    this.applyPace(data);
    return data;
  }

  /** Pin WS/REST language to Indic script in this utterance before synth. */
  private pinLanguageForText(text: string): void {
    const next = resolveSarvamTtsLanguageCode(text, this.langCode);
    if (next !== this.langCode) this.setLanguage(next);
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
      try { ws.send(JSON.stringify({ type: "ping", data: {} })); } catch { this.dropWarmWs(); }
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
      language_code: this.langCode,
      target_language_code: this.langCode,
      speaker: this.speaker,
      model: this.model,
      enable_preprocessing: this.enablePreprocessing,
      speech_sample_rate: this.pcmSampleRate,
      output_audio_codec: "linear16",
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

    return pcmFromSarvamAudio(json.audios[0]);
  }

  async synthesize(text: string): Promise<{ audio: Buffer; characters: number }> {
    this.pinLanguageForText(text);
    const parts = SarvamTTS.splitForLimit(text, MAX_TTS_CHARS);
    const buffers: Buffer[] = [];
    for (const part of parts) buffers.push(await this.synthesizeOne(part));
    return {
      audio: buffers.length === 1 ? buffers[0]! : Buffer.concat(buffers),
      characters: text.length,
    };
  }

  /**
   * Streaming synthesis — serialised WebSocket flush cycles, with HTTP stream
   * used only after genuine WS failure. Yields raw PCM s16le @ 16 kHz chunks.
   *
   * The pipeline deliberately starts sentence N+1 while N is still playing.
   * Sarvam cannot safely run two flush cycles on one socket, and mixing a
   * parallel HTTP response into the next sentence caused uneven delivery and
   * mid-sentence underruns. Queueing preserves one persistent WS and lets the
   * pipeline's PCM jitter buffer absorb provider timing variation.
   */
  async synthesizeStream(
    text: string,
    onChunk: (pcm16k: Buffer) => void,
    onDone: (characters: number) => void,
    signal?: AbortSignal,
    _emotions?: string[],
    onStarted?: () => void,
  ): Promise<void> {
    if (signal?.aborted) throw abortError();
    if (this.closed) throw new Error("SarvamTTS: closed");

    const previous = this.synthesisTail;
    let release!: () => void;
    const slot = new Promise<void>((resolve) => { release = resolve; });
    // A cancelled waiter may release itself early, but never the preceding slot.
    this.synthesisTail = previous.then(() => slot);
    try {
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => { cleanup(); reject(abortError()); };
        const cleanup = () => signal?.removeEventListener("abort", onAbort);
        signal?.addEventListener("abort", onAbort, { once: true });
        if (signal?.aborted) { onAbort(); return; }
        previous.then(() => { cleanup(); resolve(); }, (err) => { cleanup(); reject(err); });
      });
      if (signal?.aborted) throw abortError();
      if (this.closed) throw new Error("SarvamTTS: closed");
      this.pinLanguageForText(text);
      onStarted?.();

      let lastErr: unknown;
      for (let attempt = 0; attempt < WS_RETRY_MAX; attempt++) {
        if (signal?.aborted) throw abortError();
        let emittedAudio = false;
        try {
          await this.synthesizeViaWs(text, (chunk) => {
            if (signal?.aborted) return;
            if (chunk.length > 0) emittedAudio = true;
            onChunk(chunk);
          }, signal);
          if (signal?.aborted) throw abortError();
          onDone(text.length);
          return;
        } catch (err) {
          if (isAbort(err)) throw err;
          // Playback consumes chunks concurrently. Restarting the full text
          // after any bytes escaped repeats the prefix the caller already heard.
          // Without provider word alignment there is no safe resumable offset.
          if (emittedAudio) throw err;
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
      release();
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

      // Sarvam sometimes never sends the "final" event. Without a backstop the
      // promise hangs until the 8s stream timeout — the caller hears silence
      // mid-sentence while the pipeline rebuffer-loops. If the socket goes
      // fully idle after flush, treat synthesis as complete: all audio that
      // arrived has already been forwarded. Drop (don't park) the socket since
      // its state is unknown.
      let idleTimer: NodeJS.Timeout | null = null;
      const armIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          settle(() => {
            logger.warn({ textLen: text.length }, "SarvamTTS WS final-event idle backstop — resolving without final");
            try { ws.close(1000, "final-idle"); } catch { /* ignore */ }
            resolve();
          });
        }, FINAL_EVENT_IDLE_MS);
      };

      const onMessage = (raw: WebSocket.RawData) => {
        armIdle();
        let msg: { type?: string; data?: Record<string, unknown> };
        try {
          msg = JSON.parse(String(raw)) as { type?: string; data?: Record<string, unknown> };
        } catch {
          return;
        }

        if (msg.type === "audio") {
          const b64 = msg.data?.["audio"];
          if (typeof b64 === "string" && b64.length > 0) {
            // Each WS audio message can arrive WAV-wrapped — strip any RIFF
            // header or it plays as a click at sentence start.
            const pcm = pcmFromSarvamAudio(b64);
            if (pcm.length > 0) onChunk(pcm);
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
        if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
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
        ws.send(JSON.stringify({ type: "flush", data: {} }));
        armIdle();
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
      language_code: this.langCode,
      target_language_code: this.langCode,
      speaker: this.speaker,
      model: apiModel(this.model),
      enable_preprocessing: this.enablePreprocessing,
      speech_sample_rate: this.pcmSampleRate,
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
    // A WAV/RIFF header may lead the stream (and can span the first reads).
    // Buffer until we can strip it, then pass everything else straight through.
    let headBuf: Buffer | null = Buffer.alloc(0);
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.length) continue;
        let chunk = Buffer.from(value);
        if (headBuf !== null) {
          headBuf = Buffer.concat([headBuf, chunk]);
          // Wait for enough bytes to identify + skip a header (canonical is 44).
          if (headBuf.length < 64) continue;
          chunk = stripRiffHeader(headBuf);
          headBuf = null;
        }
        if (chunk.length > 0) onChunk(chunk);
      }
      // Tiny stream that never hit 64 bytes — flush what we have.
      if (headBuf !== null && headBuf.length > 0) {
        const chunk = stripRiffHeader(headBuf);
        if (chunk.length > 0) onChunk(chunk);
      }
    } finally {
      reader.releaseLock();
    }
  }
}
