import type { TTSAdapter } from "../../types.js";

/**
 * ElevenLabs — Text-to-Speech REST API
 * Docs: https://elevenlabs.io/docs/api-reference/text-to-speech
 * Returns MP3 audio by default; we request PCM 16kHz for direct pipeline use
 */
export class ElevenLabsTTS implements TTSAdapter {
  private key: string;
  private voiceId: string;
  private modelId: string;

  constructor(apiKey: string, voice: string | null) {
    this.key = apiKey;
    // voice can be "VoiceName:voice_id" or just a voice_id
    const parts = (voice ?? "Rachel:21m00Tcm4TlvDq8ikWAM").split(":");
    this.voiceId = parts[1] ?? parts[0] ?? "21m00Tcm4TlvDq8ikWAM";
    this.modelId = "eleven_turbo_v2_5";
  }

  async synthesize(text: string): Promise<Buffer> {
    const resp = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": this.key,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: this.modelId,
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
          output_format: "pcm_16000",
        }),
      }
    );

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`ElevenLabs TTS error ${resp.status}: ${err}`);
    }

    return Buffer.from(await resp.arrayBuffer());
  }
}
