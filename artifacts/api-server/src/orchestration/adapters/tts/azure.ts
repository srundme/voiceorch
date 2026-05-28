import type { TTSAdapter } from "../../types.js";

/**
 * Azure Cognitive Services TTS — REST API
 * Uses raw-16khz-16bit-mono-pcm output format → returns PCM16k directly.
 *
 * extraConfig JSON: { "region": "eastus" }
 * Voice: Azure Neural voice name, e.g. "en-US-AriaNeural"
 */

const DEFAULT_VOICE = "en-US-AriaNeural";
const DEFAULT_REGION = "eastus";

function buildSsml(text: string, voice: string, lang: string): string {
  return [
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}">`,
    `  <voice name="${voice}">${text.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c] ?? c))}</voice>`,
    `</speak>`,
  ].join("\n");
}

function detectLang(voice: string): string {
  const match = /^([a-z]{2}-[A-Z]{2})/.exec(voice);
  return match ? match[1] : "en-US";
}

export class AzureTTS implements TTSAdapter {
  private key: string;
  private voice: string;
  private region: string;

  constructor(apiKey: string, voice: string | null, extraConfig?: string | null) {
    this.key = apiKey;
    this.voice = voice ?? DEFAULT_VOICE;
    let region = DEFAULT_REGION;
    if (extraConfig) {
      try {
        const cfg = JSON.parse(extraConfig) as { region?: string };
        if (cfg.region) region = cfg.region;
      } catch { /* ignore */ }
    }
    this.region = region;
  }

  async synthesize(text: string): Promise<{ audio: Buffer; characters: number }> {
    const lang = detectLang(this.voice);
    const ssml = buildSsml(text, this.voice, lang);

    const url = `https://${this.region}.tts.speech.microsoft.com/cognitiveservices/v1`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": this.key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "raw-16khz-16bit-mono-pcm",
        "User-Agent": "VoiceOrch/1.0",
      },
      body: ssml,
    });

    if (!resp.ok) throw new Error(`Azure TTS ${resp.status}: ${await resp.text()}`);
    return { audio: Buffer.from(await resp.arrayBuffer()), characters: text.length };
  }
}
