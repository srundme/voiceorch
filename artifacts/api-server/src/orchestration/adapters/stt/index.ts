import type { STTAdapter } from "./base.js";
import { AzureSTT } from "./azure.js";
import { AssemblyAISTT } from "./assemblyai.js";
import { SarvamSTT } from "./sarvam.js";
import { CartesiaSTT } from "./cartesia.js";
import { DeepgramSTT } from "./deepgram.js";

export function createSTTAdapter(
  provider: string,
  apiKey: string,
  model: string | null,
  extraConfig: string | null
): STTAdapter {
  switch (provider.toLowerCase()) {
    case "azure":
      return new AzureSTT(apiKey, model, extraConfig);
    case "assemblyai":
      return new AssemblyAISTT(apiKey, model);
    case "sarvam":
      return new SarvamSTT(apiKey, model);
    case "cartesia":
      return new CartesiaSTT(apiKey, model);
    case "deepgram":
      return new DeepgramSTT(apiKey, model);
    default:
      throw new Error(`Unknown STT provider: ${provider}`);
  }
}

export type { STTAdapter };
