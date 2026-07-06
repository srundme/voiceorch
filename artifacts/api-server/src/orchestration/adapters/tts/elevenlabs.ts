import type { TTSAdapter } from "../../types.js";

/**
 * ElevenLabs — Text-to-Speech REST API
 * Docs: https://elevenlabs.io/docs/api-reference/text-to-speech
 * Supports streaming via /stream endpoint for lower TTFAB.
 *
 * IMPORTANT: output_format must be a URL query parameter, NOT a JSON body field.
 * Setting Accept: audio/mpeg overrides output_format and returns compressed MP3,
 * which the pipeline would decode as raw PCM → garbage audio. Use no Accept header
 * (defaults to audio/pcm when output_format=pcm_*) or Accept: *//*
 */
export class ElevenLabsTTS implements TTSAdapter {
  private key: string;
  private voiceId: string;
  private modelId: string;
  private speed: number | null;

  constructor(apiKey: string, voice: string | null, speed?: number | null) {
    this.key = apiKey;
    // voice can be "VoiceName:voice_id" or just a voice_id
    const parts = (voice ?? "Rachel:21m00Tcm4TlvDq8ikWAM").split(":");
    this.voiceId = parts[1] ?? parts[0] ?? "21m00Tcm4TlvDq8ikWAM";
    this.modelId = "eleven_turbo_v2_5";
    // ElevenLabs voice_settings.speed only accepts 0.7-1.2; clamp and skip at default.
    this.speed = (speed != null && Number.isFinite(speed) && speed !== 1)
      ? Math.min(1.2, Math.max(0.7, speed))
      : null;
  }

  /** Build the full URL with output_format as a query parameter (required by ElevenLabs API). */
  private buildUrl(path: string): string {
    const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}${path}`);
    url.searchParams.set("output_format", "pcm_16000");
    return url.toString();
  }

  private buildBody(text: string): string {
    return JSON.stringify({
      text,
      model_id: this.modelId,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        ...(this.speed != null ? { speed: this.speed } : {}),
      },
    });
  }

  private get commonHeaders() {
    return {
      "xi-api-key": this.key,
      "Content-Type": "application/json",
    };
  }

  async synthesize(text: string): Promise<{ audio: Buffer; characters: number }> {
    const resp = await fetch(this.buildUrl(""), {
      method: "POST",
      headers: this.commonHeaders,
      body: this.buildBody(text),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`ElevenLabs TTS error ${resp.status}: ${err}`);
    }

    return { audio: Buffer.from(await resp.arrayBuffer()), characters: text.length };
  }

  /**
   * Streaming synthesis via ElevenLabs /stream endpoint.
   * Returns raw 16kHz PCM chunks (output_format=pcm_16000 query param).
   * First PCM chunk arrives before full synthesis completes.
   */
  async synthesizeStream(
    text: string,
    onChunk: (pcm16k: Buffer) => void,
    onDone: (characters: number) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const resp = await fetch(this.buildUrl("/stream"), {
      method: "POST",
      headers: this.commonHeaders,
      body: this.buildBody(text),
      signal,
    });

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
    onDone(text.length);
  }
}
