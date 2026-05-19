import type { TTSAdapter } from "../../types.js";

/**
 * Cartesia — Sonic TTS REST API
 * Docs: https://docs.cartesia.ai/api-reference/tts/bytes
 * Returns raw PCM audio
 */
export class CartesiaTTS implements TTSAdapter {
  private key: string;
  private voiceId: string;
  private modelId: string;

  constructor(apiKey: string, voice: string | null, model: string | null) {
    this.key = apiKey;
    this.voiceId = voice ?? "a0e99841-438c-4a64-b679-ae501e7d6091"; // British Reading Lady
    // Normalise legacy / invalid model IDs to the supported set
    const VALID = new Set(["sonic-2", "sonic-3", "sonic-turbo",
      "sonic-2-2025-03-07", "sonic-2-2025-04-16", "sonic-2-2025-05-08", "sonic-2-2025-06-11",
      "sonic-3-2026-01-12", "sonic-3-latest",
      "sonic-turbo-2025-03-07", "sonic-turbo-2025-06-04",
      "sonic-english", "sonic-multilingual"]);
    this.modelId = model && VALID.has(model) ? model : "sonic-3";
  }

  async synthesize(text: string): Promise<Buffer> {
    const resp = await fetch("https://api.cartesia.ai/tts/bytes", {
      method: "POST",
      headers: {
        "X-API-Key": this.key,
        "Cartesia-Version": "2026-03-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transcript: text,
        model_id: this.modelId,
        voice: { mode: "id", id: this.voiceId },
        output_format: {
          container: "raw",
          encoding: "pcm_s16le",
          sample_rate: 16000,
        },
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Cartesia TTS error ${resp.status}: ${err}`);
    }

    return Buffer.from(await resp.arrayBuffer());
  }
}
