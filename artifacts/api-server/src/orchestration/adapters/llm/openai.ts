import OpenAI from "openai";
import type { ConversationTurn, LLMAdapter } from "../../types.js";

/**
 * OpenAI — streaming chat completions
 * Models: gpt-4o, gpt-4o-mini, gpt-4-turbo, gpt-3.5-turbo
 */
export class OpenAILLM implements LLMAdapter {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string | null) {
    this.client = new OpenAI({ apiKey });
    this.model = model ?? "gpt-4o-mini";
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
