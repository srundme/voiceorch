import type { ConversationTurn, LLMAdapter, ToolDefinition } from "../../types.js";

/**
 * Sarvam AI — Chat completions (OpenAI-compatible endpoint)
 * Models: sarvam-m (default), sarvam-30b, sarvam-105b
 * Docs: https://docs.sarvam.ai/api-reference/text/chat-completions
 *
 * Tool calling: supported on sarvam-m and above.
 * The wire format is identical to OpenAI (OpenAI-compatible endpoint).
 */

/** Models that support Sarvam's function-calling interface */
const TOOL_CAPABLE_MODELS = new Set(["sarvam-m", "sarvam-30b", "sarvam-105b"]);

export class SarvamLLM implements LLMAdapter {
  private key: string;
  private model: string;

  constructor(apiKey: string, model: string | null) {
    this.key = apiKey;
    // Map legacy model names to current equivalents
    const ALIASES: Record<string, string> = {
      "sarvam-2b":       "sarvam-m",
      "sarvam-2b-v0.5":  "sarvam-m",
      "sarvam-m1":       "sarvam-m",
    };
    const raw = model ?? "sarvam-m";
    this.model = ALIASES[raw] ?? raw;
  }

  async chat(
    messages: ConversationTurn[],
    systemPrompt: string,
    onToken: (token: string) => void,
    onDone: (fullText: string) => void,
    options?: {
      tools?: ToolDefinition[];
      onToolCall?: (name: string, args: Record<string, unknown>) => void;
    }
  ): Promise<void> {
    // Only sarvam-m supports tool use
    const supportsTools = TOOL_CAPABLE_MODELS.has(this.model);
    const sarvamTools = supportsTools && options?.tools?.length
      ? options.tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        }))
      : undefined;

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
        ...(sarvamTools ? { tools: sarvamTools, tool_choice: "auto" } : {}),
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Sarvam LLM error ${resp.status}: ${err}`);
    }

    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let full = "";
    let toolCallName = "";
    let toolCallArgs = "";
    let isToolCall = false;

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
            choices: Array<{
              delta?: {
                content?: string;
                tool_calls?: Array<{
                  function?: { name?: string; arguments?: string };
                }>;
              };
            }>;
          };
          const delta = parsed.choices[0]?.delta;
          if (!delta) continue;

          const token = delta.content ?? "";
          if (token) {
            full += token;
            onToken(token);
          }

          if (delta.tool_calls) {
            isToolCall = true;
            for (const tc of delta.tool_calls) {
              if (tc.function?.name) toolCallName += tc.function.name;
              if (tc.function?.arguments) toolCallArgs += tc.function.arguments;
            }
          }
        } catch {
          // skip malformed chunk
        }
      }
    }

    if (isToolCall && toolCallName && options?.onToolCall) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(toolCallArgs || "{}") as Record<string, unknown>;
      } catch {
        // malformed args — pass empty
      }
      options.onToolCall(toolCallName, args);
    } else {
      onDone(full);
    }
  }
}
