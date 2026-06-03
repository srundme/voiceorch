import OpenAI from "openai";
import type { ConversationTurn, LLMAdapter, LLMUsage, ToolDefinition } from "../../types.js";

/**
 * Qwen via Groq — OpenAI-compatible API
 * Models: qwen/qwen3-32b, qwen/qwen3-235b-a22b
 * Endpoint: https://api.groq.com/openai/v1 (Groq-hosted Qwen)
 *
 * Tool calling: supported on Qwen 3 models via Groq's function-calling interface.
 */

const DEFAULT_MODEL = "qwen/qwen3-32b";

/** Models that support function calling via Groq */
const TOOL_CAPABLE_MODELS = new Set([
  "qwen/qwen3-32b",
  "qwen/qwen3-235b-a22b",
]);

export class QwenLLM implements LLMAdapter {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string | null) {
    this.client = new OpenAI({
      apiKey,
      baseURL: "https://api.groq.com/openai/v1",
    });
    this.model = model || DEFAULT_MODEL;
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
    const supportsTools = TOOL_CAPABLE_MODELS.has(this.model);
    const qwenTools = supportsTools && options?.tools?.length
      ? options.tools.map((t) => ({
          type: "function" as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        }))
      : undefined;

    // Prepend /no_think to disable Qwen3 extended reasoning for voice calls.
    // Think-block generation adds 200–600 ms to TTFT before the first spoken
    // word; voice agents need low latency, not deep reasoning chains.
    // This is Groq's documented per-request way to turn off thinking mode.
    const voiceSystemPrompt = `/no_think\n${systemPrompt}`;

    const stream = await this.client.chat.completions.create({
      model: this.model,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: "system", content: voiceSystemPrompt },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      ...(qwenTools ? { tools: qwenTools, tool_choice: "auto" } : {}),
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
