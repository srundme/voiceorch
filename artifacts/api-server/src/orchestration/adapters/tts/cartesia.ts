import type { TTSAdapter } from "../../types.js";

/**
 * Cartesia — Sonic TTS REST API
 * Docs: https://docs.cartesia.ai/api-reference/tts/bytes
 * Returns raw PCM audio (supports body streaming for low latency)
 */
export class CartesiaTTS implements TTSAdapter {
  private key: string;
  private voiceId: string;
  private modelId: string;
  private language: string | null;

  constructor(apiKey: string, voice: string | null, model: string | null, language?: string | null) {
    this.key = apiKey;
    this.voiceId = voice ?? "a0e99841-438c-4a64-b679-ae501e7d6091"; // British Reading Lady
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

  async synthesize(text: string): Promise<{ audio: Buffer; characters: number }> {
    const resp = await fetch("https://api.cartesia.ai/tts/bytes", {
      method: "POST",
      headers: {
        "X-API-Key": this.key,
        "Cartesia-Version": "2026-03-01",
        "Content-Type": "application/json",
      },
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
   */
  async synthesizeStream(
    text: string,
    onChunk: (pcm16k: Buffer) => void,
    onDone: (characters: number) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const resp = await fetch("https://api.cartesia.ai/tts/bytes", {
      method: "POST",
      headers: {
        "X-API-Key": this.key,
        "Cartesia-Version": "2026-03-01",
        "Content-Type": "application/json",
      },
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
