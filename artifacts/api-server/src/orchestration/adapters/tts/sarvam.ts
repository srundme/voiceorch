import type { TTSAdapter } from "../../types.js";

/**
 * Sarvam AI — Text-to-Speech (Bulbul model)
 * Docs: https://docs.sarvam.ai/api-reference/text-to-speech
 * Models: bulbul:v1, bulbul:v2
 * Returns base64-encoded WAV audio
 */
export class SarvamTTS implements TTSAdapter {
  private key: string;
  private speaker: string;
  private model: string;

  constructor(apiKey: string, voice: string | null) {
    this.key = apiKey;
    this.speaker = voice ?? "meera";
    this.model = "bulbul:v2";
  }

  async synthesize(text: string): Promise<Buffer> {
    const resp = await fetch("https://api.sarvam.ai/text-to-speech", {
      method: "POST",
      headers: {
        "api-subscription-key": this.key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: [text],
        target_language_code: "en-IN",
        speaker: this.speaker,
        model: this.model,
        enable_preprocessing: true,
        speech_sample_rate: 16000,
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Sarvam TTS error ${resp.status}: ${err}`);
    }

    const json = (await resp.json()) as { audios?: string[] };
    if (!json.audios?.[0]) throw new Error("Sarvam TTS: no audio in response");

    // Audios are base64-encoded WAV; strip the WAV header (44 bytes) to get raw PCM
    const wav = Buffer.from(json.audios[0], "base64");
    return wav.slice(44); // strip WAV header → raw PCM s16le at 16kHz
  }
}
