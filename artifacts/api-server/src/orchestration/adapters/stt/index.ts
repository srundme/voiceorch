import type { STTAdapter } from "./base.js";
import type { STTConfig } from "../../types.js";
import { AzureSTT } from "./azure.js";
import { AssemblyAISTT } from "./assemblyai.js";
import { SarvamSTT } from "./sarvam.js";
import { CartesiaSTT } from "./cartesia.js";
import { DeepgramSTT } from "./deepgram.js";
import { GeminiSTT } from "./gemini.js";
import { GoogleSpeechSTT } from "./google-speech.js";
import { STUB_PROVIDERS_ENABLED, createStubSTT } from "../stubs.js";

export function createSTTAdapter(
  provider: string,
  apiKey: string,
  model: string | null,
  extraConfig: string | null,
  cfg: STTConfig
): STTAdapter {
  if (STUB_PROVIDERS_ENABLED) return createStubSTT();
  switch (provider.toLowerCase()) {
    case "azure":
      return new AzureSTT(apiKey, model, extraConfig, cfg);
    case "assemblyai":
      return new AssemblyAISTT(apiKey, model, cfg);
    case "sarvam":
      return new SarvamSTT(apiKey, model, extraConfig, cfg);
    case "cartesia":
      return new CartesiaSTT(apiKey, model, cfg);
    case "deepgram":
      return new DeepgramSTT(apiKey, model, cfg);
    case "google_speech":
    case "google_stt":
      return new GoogleSpeechSTT(apiKey, model, cfg);
    case "gemini":
    case "gemini_audio":
    case "google":
      return new GeminiSTT(apiKey, model, cfg);
    default:
      throw new Error(`Unknown STT provider: ${provider}`);
  }
}

export type { STTAdapter };
