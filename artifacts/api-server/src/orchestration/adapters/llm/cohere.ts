import OpenAI from "openai";
import type { ConversationTurn, LLMAdapter, LLMUsage, ToolDefinition } from "../../types.js";

/**
 * Cohere — OpenAI-compatible endpoint
 * Models: command-r-plus-08-2024, command-r-08-2024, command-r, command-r-plus
 * Endpoint: https://api.cohere.com/compatibility/v1
 */

const DEFAULT_MODEL = "command-r-plus-08-2024";

export class CohereLLM implements LLMAdapter {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string | null) {
    this.client = new OpenAI({
      apiKey,
      baseURL: "https://api.cohere.com/compatibility/v1",
    });
    this.model = model ?? DEFAULT_MODEL;
  }

  async chat(
    messages: ConversationTurn[],
    systemPrompt: string,
    onToken: (token: string) => void,
    onDone: (fullText: string, usage?: LLMUsage) => void,
    options?: {
      tools?: ToolDefinition[];
      onUsage?: (usage: LLMUsage) => void;
      onToolCall?: (name: string, args: Record<string, unknown>) => void;
    }
  ): Promise<void> {
    const tools = options?.tools?.length
      ? options.tools.map((t) => ({
          type: "function" as const,
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }))
      : undefined;

    const stream = await this.client.chat.completions.create({
      model: this.model,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: "system", content: systemPrompt },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      ...(tools ? { tools, tool_choice: "auto" } : {}),
    });

    let full = "";
    let toolCallName = "";
    let toolCallArgs = "";
    let isToolCall = false;
    let usage: LLMUsage | undefined;

    for await (const chunk of stream) {
      if (chunk.usage) {
        usage = { inputTokens: chunk.usage.prompt_tokens, outputTokens: chunk.usage.completion_tokens };
      }
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;
      const token = delta.content ?? "";
      if (token) { full += token; onToken(token); }
      if (delta.tool_calls) {
        isToolCall = true;
        for (const tc of delta.tool_calls) {
          if (tc.function?.name) toolCallName += tc.function.name;
          if (tc.function?.arguments) toolCallArgs += tc.function.arguments;
        }
      }
    }

    if (usage) options?.onUsage?.(usage);

    if (isToolCall && toolCallName && options?.onToolCall) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(toolCallArgs || "{}") as Record<string, unknown>; } catch { /* ignore */ }
      options.onToolCall(toolCallName, args);
    } else {
      onDone(full, usage);
    }
  }
}
