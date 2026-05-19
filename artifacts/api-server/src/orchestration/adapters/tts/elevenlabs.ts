import type { TTSAdapter } from "../../types.js";

/**
 * ElevenLabs — Text-to-Speech REST API
 * Docs: https://elevenlabs.io/docs/api-reference/text-to-speech
 * Supports streaming via /stream endpoint for lower TTFAB.
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

  private buildBody(text: string): string {
    return JSON.stringify({
      text,
      model_id: this.modelId,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      output_format: "pcm_16000",
    });
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
        body: this.buildBody(text),
      }
    );

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`ElevenLabs TTS error ${resp.status}: ${err}`);
    }

    return Buffer.from(await resp.arrayBuffer());
  }

  /**
   * Streaming synthesis via ElevenLabs /stream endpoint.
   * First PCM chunk arrives before full synthesis completes.
   */
  async synthesizeStream(
    text: string,
    onChunk: (pcm16k: Buffer) => void,
    onDone: () => void
  ): Promise<void> {
    const resp = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream`,
      {
        method: "POST",
        headers: {
          "xi-api-key": this.key,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: this.buildBody(text),
      }
    );

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`ElevenLabs TTS stream error ${resp.status}: ${err}`);
    }

    if (!resp.body) throw new Error("ElevenLabs TTS: no response body");

    const reader = resp.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value?.length) onChunk(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
    onDone();
  }
}
