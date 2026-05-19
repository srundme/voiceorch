import { pcmToWav } from "../../audio.js";
import type { STTAdapter } from "./base.js";

/**
 * Sarvam AI — Speech-to-Text (saarika model)
 * Docs: https://docs.sarvam.ai/api-reference/speech-to-text
 * Models: saarika:v1, saarika:v2, saarika:flash
 */
export class SarvamSTT implements STTAdapter {
  private key: string;
  private model: string;

  constructor(apiKey: string, model: string | null) {
    this.key = apiKey;
    this.model = model ?? "saarika:v2";
  }

  async transcribe(audioBuffer: Buffer, sampleRate = 16000): Promise<string> {
    const wav = pcmToWav(audioBuffer, sampleRate);

    const formData = new FormData();
    const wavAb = new ArrayBuffer(wav.byteLength);
    new Uint8Array(wavAb).set(wav);
    formData.append("file", new Blob([wavAb], { type: "audio/wav" }), "audio.wav");
    formData.append("model", this.model);
    formData.append("language_code", "en-IN");

    const resp = await fetch("https://api.sarvam.ai/speech-to-text", {
      method: "POST",
      headers: { "api-subscription-key": this.key },
      body: formData,
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Sarvam STT error ${resp.status}: ${err}`);
    }

    const json = (await resp.json()) as { transcript?: string };
    return json.transcript?.trim() ?? "";
  }
}
