import type { TTSAdapter } from "../../types.js";

/**
 * Cartesia — Sonic TTS REST API
 * Docs: https://docs.cartesia.ai/api-reference/tts/bytes
 * Returns raw PCM audio (supports body streaming for low latency)
 */

const MAX_RETRIES = 2;
const RETRY_BASE_MS = 300;

/** Retry a fetch call on transient network failures (ETIMEDOUT, ECONNRESET, etc.). */
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
      // Only retry on network-level errors (TypeError: fetch failed / ETIMEDOUT).
      // Don't retry on AbortError (caller cancelled).
      const isNetwork = err instanceof TypeError && !(err.name === "AbortError");
      if (!isNetwork || attempt === retries) throw err;
      await new Promise<void>((r) => setTimeout(r, RETRY_BASE_MS * 2 ** attempt));
    }
  }
  throw lastErr;
}

export class CartesiaTTS implements TTSAdapter {
  private key: string;
  private voiceId: string;
  private modelId: string;
  private language: string | null;

  constructor(apiKey: string, voice: string | null, model: string | null, language?: string | null) {
    this.key = apiKey;
    this.voiceId = voice ?? "2ee87190-8f84-4925-97da-e52547f9462c"; // Arushi — warm Indian English female (matches UI default)
    // Normalise legacy / invalid model IDs to the supported set
    const VALID = new Set([
      // Sonic 3.5 (latest, May 2026) — 42 languages, industry-leading latency
      "sonic-3.5", "sonic-3.5-2026-05-04", "sonic-latest",
      // Sonic 3
      "sonic-3", "sonic-3-2026-01-12", "sonic-3-latest",
      // Sonic 2
      "sonic-2", "sonic-2-2025-03-07", "sonic-2-2025-04-16", "sonic-2-2025-05-08", "sonic-2-2025-06-11",
      // Sonic turbo
      "sonic-turbo", "sonic-turbo-2025-03-07", "sonic-turbo-2025-06-04",
      // Legacy aliases
      "sonic-english", "sonic-multilingual",
    ]);
    this.modelId = model && VALID.has(model) ? model : "sonic-3.5";
    // Map BCP-47 to ISO 639-1 (e.g. "ta-IN" → "ta", "en-US" → "en")
    this.language = language ? language.split("-")[0] : null;
  }

  private buildRequestBody(text: string): string {
    const body: Record<string, unknown> = {
      transcript: text,
      model_id: this.modelId,
      voice: { mode: "id", id: this.voiceId },
      output_format: {
        container: "raw",
        encoding: "pcm_s16le",
        sample_rate: 16000,
      },
    };
    if (this.language) body.language = this.language;
    return JSON.stringify(body);
  }

  private get headers() {
    return {
      "X-API-Key": this.key,
      "Cartesia-Version": "2026-03-01",
      "Content-Type": "application/json",
    };
  }

  /** Hot-swap the TTS language mid-call (multilingual mode). */
  setLanguage(lang: string): void {
    this.language = lang.split("-")[0];
  }

  async synthesize(text: string): Promise<{ audio: Buffer; characters: number }> {
    const resp = await fetchWithRetry("https://api.cartesia.ai/tts/bytes", {
      method: "POST",
      headers: this.headers,
      body: this.buildRequestBody(text),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Cartesia TTS error ${resp.status}: ${err}`);
    }

    return { audio: Buffer.from(await resp.arrayBuffer()), characters: text.length };
  }

  /**
   * Streaming synthesis — calls onChunk for each PCM buffer fragment as it
   * arrives over HTTP, so playback can begin before synthesis is complete.
   * First chunk typically arrives in ~80-150ms.
   * Retries up to MAX_RETRIES times on transient network failures.
   */
  async synthesizeStream(
    text: string,
    onChunk: (pcm16k: Buffer) => void,
    onDone: (characters: number) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const resp = await fetchWithRetry("https://api.cartesia.ai/tts/bytes", {
      method: "POST",
      headers: this.headers,
      body: this.buildRequestBody(text),
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
    onDone(text.length);
  }
}
