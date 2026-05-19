import { pcmToWav } from "../../audio.js";
import type { STTAdapter } from "./base.js";

/**
 * Azure Cognitive Services — Batch Speech-to-Text via REST
 * Docs: https://learn.microsoft.com/en-us/azure/cognitive-services/speech-service/rest-speech-to-text
 *
 * extraConfig JSON: { "region": "eastus", "language": "en-US" }
 * apiKey: Azure Speech subscription key
 */
export class AzureSTT implements STTAdapter {
  private key: string;
  private region: string;
  private language: string;
  private model: string | null;

  constructor(apiKey: string, model: string | null, extraConfig: string | null) {
    this.key = apiKey;
    this.model = model;
    const cfg = extraConfig ? JSON.parse(extraConfig) : {};
    this.region = cfg.region ?? "eastus";
    this.language = cfg.language ?? "en-US";
  }

  async transcribe(audioBuffer: Buffer, sampleRate = 16000): Promise<string> {
    const wav = pcmToWav(audioBuffer, sampleRate);

    const url = `https://${this.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${this.language}`;

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": this.key,
        "Content-Type": "audio/wav",
        Accept: "application/json",
      },
      body: wav,
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Azure STT error ${resp.status}: ${err}`);
    }

    const json = (await resp.json()) as { DisplayText?: string; RecognitionStatus?: string };
    return json.DisplayText?.trim() ?? "";
  }
}
