import type { LLMAdapter } from "../../types.js";
import { OpenAILLM } from "./openai.js";
import { GroqLLM } from "./groq.js";
import { GoogleLLM } from "./google.js";
import { SarvamLLM } from "./sarvam.js";

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
    case "gemini":
      return new GoogleLLM(apiKey, model);
    case "sarvam":
      return new SarvamLLM(apiKey, model);
    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }
}
