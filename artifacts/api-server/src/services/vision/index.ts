import type { IVisionProvider } from "./provider.interface.js";
import { GeminiVisionProvider } from "./gemini.js";
import { OpenAIVisionProvider } from "./openai.js";
import { SarvamVisionProvider } from "./sarvam.js";

export type { IVisionProvider, VisionAnalysisRequest, VisionAnalysisResult } from "./provider.interface.js";

export function resolveVisionProvider(
  providerName: string,
  apiKey: string,
): IVisionProvider {
  switch (providerName.toLowerCase()) {
    case "openai":
      return new OpenAIVisionProvider(apiKey);
    case "sarvam":
      return new SarvamVisionProvider(apiKey);
    case "gemini":
    case "azure":
    default:
      return new GeminiVisionProvider(apiKey);
  }
}

export { GeminiVisionProvider } from "./gemini.js";
export { OpenAIVisionProvider } from "./openai.js";
export { SarvamVisionProvider } from "./sarvam.js";
