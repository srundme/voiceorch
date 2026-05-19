import { pcmToWav } from "../../audio.js";
import type { STTAdapter } from "./base.js";
import type { STTConfig } from "../../types.js";

/**
 * Azure Cognitive Services — Batch Speech-to-Text via REST
 * extraConfig JSON: { "region": "eastus" }
 * Language is taken from STTConfig.language (overrides extraConfig.language).
 */
export class AzureSTT implements STTAdapter {
  private key: string;
  private region: string;
  private language: string;
  private model: string | null;

  constructor(
    apiKey: string,
    model: string | null,
    extraConfig: string | null,
    cfg: STTConfig
  ) {
    this.key = apiKey;
    this.model = model;
    const extra = extraConfig ? (JSON.parse(extraConfig) as { region?: string; language?: string }) : {};
    this.region = extra.region ?? "eastus";
    // sttConfig.language takes priority over extraConfig.language
    this.language = cfg.language ?? extra.language ?? "en-US";
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
