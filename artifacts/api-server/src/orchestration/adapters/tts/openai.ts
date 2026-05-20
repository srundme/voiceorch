import OpenAI from "openai";
import type { TTSAdapter } from "../../types.js";

/**
 * OpenAI TTS — gpt-4o-mini-tts / tts-1 / tts-1-hd
 * Returns 24 kHz PCM; we downsample to 16 kHz before handing to the pipeline.
 * Voices: alloy, ash, coral, echo, fable, onyx, nova, sage, shimmer
 */

const DEFAULT_MODEL = "tts-1";
const DEFAULT_VOICE = "alloy";

/** Downsample Int16 PCM from 24 kHz → 16 kHz via linear interpolation (2:3 ratio) */
function downsample24to16(pcm24k: Buffer): Buffer {
  const samples24 = pcm24k.length >> 1;
  const samples16 = Math.floor((samples24 * 2) / 3);
  const out = Buffer.allocUnsafe(samples16 * 2);
  for (let i = 0; i < samples16; i++) {
    const pos = i * 1.5;
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, samples24 - 1);
    const frac = pos - lo;
    const sLo = pcm24k.readInt16LE(lo * 2);
    const sHi = pcm24k.readInt16LE(hi * 2);
    const sample = Math.round(sLo + (sHi - sLo) * frac);
    out.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), i * 2);
  }
  return out;
}

export class OpenAITTS implements TTSAdapter {
  private client: OpenAI;
  private voice: string;
  private model: string;

  constructor(apiKey: string, voice: string | null, model: string | null) {
    this.client = new OpenAI({ apiKey });
    this.voice = voice ?? DEFAULT_VOICE;
    this.model = model ?? DEFAULT_MODEL;
  }

  async synthesize(text: string): Promise<Buffer> {
    const resp = await this.client.audio.speech.create({
      model: this.model,
      voice: this.voice as "alloy",
      input: text,
      response_format: "pcm",
    });
    const pcm24k = Buffer.from(await resp.arrayBuffer());
    return downsample24to16(pcm24k);
  }
}
