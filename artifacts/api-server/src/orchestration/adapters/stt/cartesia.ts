import { pcmToWav } from "../../audio.js";
import type { STTAdapter } from "./base.js";

/**
 * Cartesia — Speech-to-Text
 * Docs: https://docs.cartesia.ai
 * Note: Cartesia primarily offers TTS; STT falls back to Whisper-compatible endpoint.
 * If Cartesia releases dedicated STT, update this adapter.
 */
export class CartesiaSTT implements STTAdapter {
  private key: string;
  private model: string;

  constructor(apiKey: string, model: string | null) {
    this.key = apiKey;
    this.model = model ?? "whisper-1";
  }

  async transcribe(audioBuffer: Buffer, sampleRate = 16000): Promise<string> {
    const wav = pcmToWav(audioBuffer, sampleRate);

    const formData = new FormData();
    const wavAb = new ArrayBuffer(wav.byteLength);
    new Uint8Array(wavAb).set(wav);
    formData.append("file", new Blob([wavAb], { type: "audio/wav" }), "audio.wav");
    formData.append("model", this.model);

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
