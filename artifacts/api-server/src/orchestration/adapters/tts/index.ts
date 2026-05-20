import type { TTSAdapter } from "../../types.js";
import { ElevenLabsTTS } from "./elevenlabs.js";
import { CartesiaTTS } from "./cartesia.js";
import { SarvamTTS } from "./sarvam.js";
import { OpenAITTS } from "./openai.js";
import { AzureTTS } from "./azure.js";
import { DeepgramTTS } from "./deepgram.js";

export function createTTSAdapter(
  provider: string,
  apiKey: string,
  voice: string | null,
  model: string | null = null,
  extraConfig?: string | null
): TTSAdapter {
  switch (provider.toLowerCase()) {
    case "elevenlabs":
      return new ElevenLabsTTS(apiKey, voice);
    case "cartesia":
      return new CartesiaTTS(apiKey, voice, model);
    case "sarvam":
      return new SarvamTTS(apiKey, voice);
    case "openai":
    case "openai_tts":
      return new OpenAITTS(apiKey, voice, model);
    case "azure":
    case "azure_tts":
      return new AzureTTS(apiKey, voice, extraConfig);
    case "deepgram":
    case "deepgram_aura":
      return new DeepgramTTS(apiKey, voice);
    default:
      throw new Error(`Unknown TTS provider: ${provider}`);
  }
}

export type { TTSAdapter };
