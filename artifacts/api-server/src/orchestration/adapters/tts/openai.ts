import OpenAI from "openai";
import type { TTSAdapter } from "../../types.js";
import { downsample24to16 } from "../../audio.js";

/**
 * OpenAI TTS — gpt-4o-mini-tts / tts-1 / tts-1-hd
 * Returns 24 kHz PCM; we downsample to 16 kHz (shared windowed-sinc
 * anti-alias converter in audio.ts) before handing to the pipeline.
 * Voices: alloy, ash, coral, echo, fable, onyx, nova, sage, shimmer
 */

const DEFAULT_MODEL = "tts-1";
const DEFAULT_VOICE = "alloy";

export class OpenAITTS implements TTSAdapter {
  private client: OpenAI;
  private voice: string;
  private model: string;

  constructor(apiKey: string, voice: string | null, model: string | null) {
    this.client = new OpenAI({ apiKey });
    this.voice = voice ?? DEFAULT_VOICE;
    this.model = model ?? DEFAULT_MODEL;
  }

  async synthesize(text: string): Promise<{ audio: Buffer; characters: number }> {
    const resp = await this.client.audio.speech.create({
      model: this.model,
      voice: this.voice as "alloy",
      input: text,
      response_format: "pcm",
    });
    const pcm24k = Buffer.from(await resp.arrayBuffer());
    return { audio: downsample24to16(pcm24k), characters: text.length };
  }
}
