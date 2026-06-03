import type { LLMAdapter } from "../../types.js";
import { OpenAILLM } from "./openai.js";
import { GroqLLM } from "./groq.js";
import { GoogleLLM } from "./google.js";
import { QwenLLM } from "./qwen.js";
import { SarvamLLM } from "./sarvam.js";
import { DeepSeekLLM } from "./deepseek.js";
import { AnthropicLLM } from "./anthropic.js";
import { MistralLLM } from "./mistral.js";
import { CohereLLM } from "./cohere.js";

export function createLLMAdapter(
  provider: string,
  apiKey: string,
  model: string | null
): LLMAdapter {
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
      return new SarvamLLM(apiKey, model);
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
    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }
}
