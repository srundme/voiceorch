import OpenAI from "openai";
import type { ConversationTurn, LLMAdapter } from "../../types.js";

/**
 * Groq — OpenAI-compatible API with ultra-fast inference
 * Models: llama-3.3-70b-versatile, llama-3.1-8b-instant, gemma2-9b-it
 */

/** Map decommissioned → current replacement */
const GROQ_MODEL_REPLACEMENTS: Record<string, string> = {
  "mixtral-8x7b-32768":   "llama-3.3-70b-versatile",
  "llama2-70b-4096":       "llama-3.3-70b-versatile",
  "llama-3.1-70b-versatile": "llama-3.3-70b-versatile",
};
const GROQ_DEFAULT = "llama-3.3-70b-versatile";

function resolveGroqModel(model: string | null): string {
  const m = model ?? "";
  return GROQ_MODEL_REPLACEMENTS[m] ?? (m || GROQ_DEFAULT);
}

export class GroqLLM implements LLMAdapter {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string | null) {
    this.client = new OpenAI({
      apiKey,
      baseURL: "https://api.groq.com/openai/v1",
    });
    this.model = resolveGroqModel(model);
  }

  async chat(
    messages: ConversationTurn[],
    systemPrompt: string,
    onToken: (token: string) => void,
    onDone: (fullText: string) => void
  ): Promise<void> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    });

    let full = "";
    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content ?? "";
      if (token) {
        full += token;
        onToken(token);
      }
    }
    onDone(full);
  }
}
