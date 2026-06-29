import type { LLMAdapter, LLMGenerationParams } from "../../types.js";
import { OpenAILLM } from "./openai.js";
import { GroqLLM } from "./groq.js";
import { GoogleLLM } from "./google.js";
import { QwenLLM } from "./qwen.js";
import { SarvamLLM } from "./sarvam.js";
import { DeepSeekLLM } from "./deepseek.js";
import { AnthropicLLM } from "./anthropic.js";
import { MistralLLM } from "./mistral.js";
import { CohereLLM } from "./cohere.js";
import { UltravoxLLM } from "./ultravox.js";
import { STUB_PROVIDERS_ENABLED, createStubLLM } from "../stubs.js";

export function createLLMAdapter(
  provider: string,
  apiKey: string,
  model: string | null,
  /** Optional override for the provider's base URL (e.g. self-hosted vLLM endpoint). */
  baseUrl?: string,
  /** Optional resolved generation params. Currently only the Sarvam adapter consumes these. */
  genParams?: LLMGenerationParams,
  /** Optional call id for diagnostic logging only. Currently only the Sarvam adapter uses it. */
  callId?: number
): LLMAdapter {
  if (STUB_PROVIDERS_ENABLED) return createStubLLM();
  switch (provider.toLowerCase()) {
    case "openai":
      return new OpenAILLM(apiKey, model);
    case "groq":
      return new GroqLLM(apiKey, model);
    case "google":
      return new GoogleLLM(apiKey, model);
    case "gemini":
      return new QwenLLM(apiKey, model);
    case "sarvam":
      return new SarvamLLM(apiKey, model, genParams, callId);
    case "deepseek":
      return new DeepSeekLLM(apiKey, model);
    case "anthropic":
    case "claude":
      return new AnthropicLLM(apiKey, model);
    case "mistral":
      return new MistralLLM(apiKey, model);
    case "cohere":
      return new CohereLLM(apiKey, model);
    case "qwen":
      return new QwenLLM(apiKey, model);
    case "ultravox":
      return new UltravoxLLM(apiKey, model, baseUrl);
    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }
}
