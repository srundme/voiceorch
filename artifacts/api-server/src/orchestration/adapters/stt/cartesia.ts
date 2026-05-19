import { pcmToWav } from "../../audio.js";
import type { STTAdapter } from "./base.js";
import type { STTConfig } from "../../types.js";

/**
 * Cartesia — Speech-to-Text (Whisper-compatible endpoint)
 */
export class CartesiaSTT implements STTAdapter {
  private key: string;
  private model: string;
  private cfg: STTConfig;

  constructor(apiKey: string, model: string | null, cfg: STTConfig) {
    this.key = apiKey;
    this.model = model ?? "whisper-1";
    this.cfg = cfg;
  }

  async transcribe(audioBuffer: Buffer, sampleRate = 16000): Promise<string> {
    const wav = pcmToWav(audioBuffer, sampleRate);

    const formData = new FormData();
    const wavAb = new ArrayBuffer(wav.byteLength);
    new Uint8Array(wavAb).set(wav);
    formData.append("file", new Blob([wavAb], { type: "audio/wav" }), "audio.wav");
    formData.append("model", this.model);
    if (this.cfg.language) formData.append("language", this.cfg.language);

    const resp = await fetch("https://api.cartesia.ai/v1/audio/transcriptions", {
      method: "POST",
      headers: { "X-API-Key": this.key },
      body: formData,
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Cartesia STT error ${resp.status}: ${err}`);
    }

    const json = (await resp.json()) as { text?: string };
    return json.text?.trim() ?? "";
  }
}
