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
    this.modelId = model ?? "sonic-2";
  }

  async synthesize(text: string): Promise<Buffer> {
    const resp = await fetch("https://api.cartesia.ai/tts/bytes", {
      method: "POST",
      headers: {
        "X-API-Key": this.key,
        "Cartesia-Version": "2024-06-10",
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
