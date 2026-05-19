import type { TTSAdapter } from "../../types.js";
import { ElevenLabsTTS } from "./elevenlabs.js";
import { CartesiaTTS } from "./cartesia.js";
import { SarvamTTS } from "./sarvam.js";

export function createTTSAdapter(
  provider: string,
  apiKey: string,
  voice: string | null,
  model: string | null = null
): TTSAdapter {
  switch (provider.toLowerCase()) {
    case "elevenlabs":
      return new ElevenLabsTTS(apiKey, voice);
    case "cartesia":
      return new CartesiaTTS(apiKey, voice, model);
    case "sarvam":
      return new SarvamTTS(apiKey, voice);
    default:
      throw new Error(`Unknown TTS provider: ${provider}`);
  }
}

export type { TTSAdapter };
