import type { ConversationTurn, LLMAdapter } from "../../types.js";

/**
 * Sarvam AI — Chat completions (OpenAI-compatible endpoint)
 * Models: sarvam-2b, sarvam-m
 * Docs: https://docs.sarvam.ai/api-reference/text/chat-completions
 */
export class SarvamLLM implements LLMAdapter {
  private key: string;
  private model: string;

  constructor(apiKey: string, model: string | null) {
    this.key = apiKey;
    this.model = model ?? "sarvam-2b";
  }

  async chat(
    messages: ConversationTurn[],
    systemPrompt: string,
    onToken: (token: string) => void,
    onDone: (fullText: string) => void
  ): Promise<void> {
    const resp = await fetch("https://api.sarvam.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "api-subscription-key": this.key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        stream: true,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.map((m) => ({ role: m.role, content: m.content })),
        ],
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Sarvam LLM error ${resp.status}: ${err}`);
    }

    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let full = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value, { stream: true });
      const lines = text.split("\n").filter((l) => l.startsWith("data: "));

      for (const line of lines) {
        const data = line.slice(6);
        if (data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data) as {
            choices: Array<{ delta?: { content?: string } }>;
          };
          const token = parsed.choices[0]?.delta?.content ?? "";
          if (token) {
            full += token;
            onToken(token);
          }
        } catch {
          // skip malformed chunk
        }
      }
    }

    onDone(full);
  }
}
