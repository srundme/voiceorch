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
import { OpenRouterLLM } from "./openrouter.js";
import { TogetherLLM } from "./together.js";
import { KrutrimLLM } from "./krutrim.js";
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
      return new OpenAILLM(apiKey, model, genParams);
    case "groq":
      return new GroqLLM(apiKey, model, genParams);
    case "google":
    case "gemini":
      return new GoogleLLM(apiKey, model, genParams);
    case "sarvam":
      return new SarvamLLM(apiKey, model, genParams, callId);
    case "deepseek":
      return new DeepSeekLLM(apiKey, model, genParams);
    case "anthropic":
    case "claude":
      return new AnthropicLLM(apiKey, model, genParams);
    case "mistral":
      return new MistralLLM(apiKey, model, genParams);
    case "cohere":
      return new CohereLLM(apiKey, model, genParams);
    case "qwen":
      return new QwenLLM(apiKey, model, genParams);
    case "openrouter":
      return new OpenRouterLLM(apiKey, model, genParams);
    case "together":
      return new TogetherLLM(apiKey, model, genParams);
    case "krutrim":
      return new KrutrimLLM(apiKey, model, genParams);
    case "ultravox":
      // Ultravox is a multimodal speech-language model; its OpenAI-compatible
      // endpoint does not document a comparable text-generation temperature
      // control, so it intentionally does not receive genParams (out of scope).
      return new UltravoxLLM(apiKey, model, baseUrl);
    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }
}
