import type { STTAdapter } from "./base.js";
import type { STTConfig } from "../../types.js";
import { AzureSTT } from "./azure.js";
import { AssemblyAISTT } from "./assemblyai.js";
import { CartesiaSTT } from "./cartesia.js";
import { DeepgramSTT } from "./deepgram.js";
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
    case "cartesia":
      return new CartesiaSTT(apiKey, model, cfg);
    case "deepgram":
      return new DeepgramSTT(apiKey, model, cfg);
    default:
      throw new Error(`Unknown STT provider: ${provider}`);
  }
}

export type { STTAdapter };
