import { pcmToWav } from "../../audio.js";
import type { STTAdapter } from "./base.js";

/**
 * Sarvam AI — Speech-to-Text (saarika model)
 * Docs: https://docs.sarvam.ai/api-reference/speech-to-text
 * Models: saarika:v1, saarika:v2, saarika:flash
 */
const VALID_SARVAM_STT_MODELS = new Set([
  "saarika:v2.5", "saarika:v2", "saarika:v1", "saarika:flash",
  "saaras:v3", "saaras:v3-realtime",
]);
const DEFAULT_SARVAM_STT_MODEL = "saarika:v2";

export class SarvamSTT implements STTAdapter {
  private key: string;
  private model: string;

  constructor(apiKey: string, model: string | null) {
    this.key = apiKey;
    const candidate = model ?? "";
    this.model = VALID_SARVAM_STT_MODELS.has(candidate) ? candidate : DEFAULT_SARVAM_STT_MODEL;
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
