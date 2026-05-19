import { GoogleGenerativeAI } from "@google/generative-ai";
import type { ConversationTurn, LLMAdapter } from "../../types.js";

/**
 * Google Gemini — streaming generative AI
 * Models: gemini-2.0-flash, gemini-1.5-pro, gemini-1.5-flash
 */
export class GoogleLLM implements LLMAdapter {
  private genAI: GoogleGenerativeAI;
  private model: string;

  constructor(apiKey: string, model: string | null) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = model ?? "gemini-2.0-flash";
  }

  async chat(
    messages: ConversationTurn[],
    systemPrompt: string,
    onToken: (token: string) => void,
    onDone: (fullText: string) => void
  ): Promise<void> {
    const gemini = this.genAI.getGenerativeModel({
      model: this.model,
      systemInstruction: systemPrompt,
    });

    // Build chat history (all turns except the last user message)
    const history = messages.slice(0, -1).map((m) => ({
      role: m.role === "user" ? ("user" as const) : ("model" as const),
      parts: [{ text: m.content }],
    }));

    const lastMessage = messages[messages.length - 1]?.content ?? "";

    const chat = gemini.startChat({ history });
    const result = await chat.sendMessageStream(lastMessage);

    let full = "";
    for await (const chunk of result.stream) {
      const token = chunk.text();
      if (token) {
        full += token;
        onToken(token);
      }
    }
    onDone(full);
  }
}
