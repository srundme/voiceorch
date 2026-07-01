import OpenAI from "openai";
import type { ConversationTurn, LLMAdapter, LLMUsage, ToolDefinition } from "../../types.js";
import { toOpenAIMessages } from "./openai-messages.js";

/**
 * OpenAI — streaming chat completions with native function/tool calling
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
    onDone: (fullText: string, usage?: LLMUsage) => void,
    options?: {
      tools?: ToolDefinition[];
      onToolCall?: (name: string, args: Record<string, unknown>) => void;
      onUsage?: (usage: LLMUsage) => void;
    }
  ): Promise<void> {
    const openAiTools = options?.tools?.length
      ? options.tools.map((t) => ({
          type: "function" as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        }))
      : undefined;

    const stream = await this.client.chat.completions.create({
      model: this.model,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: "system", content: systemPrompt },
        ...toOpenAIMessages(messages),
      ] as any,
      ...(openAiTools ? { tools: openAiTools, tool_choice: "auto" } : {}),
    });

    let full = "";
    let toolCallName = "";
    let toolCallArgs = "";
    let isToolCall = false;
    let usage: LLMUsage | undefined;

    for await (const chunk of stream) {
      if (chunk.usage) {
        usage = {
          inputTokens: chunk.usage.prompt_tokens,
          outputTokens: chunk.usage.completion_tokens,
          // Prompt-cache hit size (OpenAI reports it under prompt_tokens_details).
          // Lets the pipeline verify the static system-prompt prefix is cached
          // turn-over-turn. Absent on providers that don't report a breakdown.
          cachedTokens: chunk.usage.prompt_tokens_details?.cached_tokens,
        };
      }

      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      // Regular text tokens
      const token = delta.content ?? "";
      if (token) {
        full += token;
        onToken(token);
      }

      // Tool call deltas (streamed in fragments)
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
      try {
        args = JSON.parse(toolCallArgs || "{}") as Record<string, unknown>;
      } catch {
        // malformed args — pass empty
      }
      options.onToolCall(toolCallName, args);
    } else {
      onDone(full, usage);
    }
  }
}
