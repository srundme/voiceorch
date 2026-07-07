import OpenAI from "openai";
import type { ConversationTurn, LLMAdapter, LLMGenerationParams, LLMUsage, ToolDefinition } from "../../types.js";
import { toOpenAIMessages } from "./openai-messages.js";

/**
 * Together AI — OpenAI-compatible gateway to open-weight models.
 * Used as the managed LLM provider for Qwen3.6 and Qwen3.5 model family.
 * Platform provides a managed_together_key so users on the managed plan
 * can access these models without supplying their own API key.
 *
 * Models: Qwen/Qwen3.6-35B-A3B (fast), Qwen/Qwen3.5-397B-A17B (quality)
 * Endpoint: https://api.together.xyz/v1
 *
 * Tool calling: both models support native tool/function calling.
 */

const DEFAULT_MODEL = "Qwen/Qwen3.6-35B-A3B";

const TOOL_CAPABLE_MODELS = new Set([
  "Qwen/Qwen3.6-35B-A3B",
  "Qwen/Qwen3.5-397B-A17B",
]);

const SCHEDULING_TOOL_NAME_PATTERNS = [
  "check_availability",
  "book_appointment",
  "get_bookings",
  "cancel_appointment",
  "reschedule_appointment",
];

export class TogetherLLM implements LLMAdapter {
  private client: OpenAI;
  private model: string;
  private maxTokens: number | undefined;
  private temperature: number | undefined;

  constructor(apiKey: string, model: string | null, genParams?: LLMGenerationParams) {
    this.client = new OpenAI({
      apiKey,
      baseURL: "https://api.together.xyz/v1",
      defaultHeaders: {
        "X-Title": "VoiceOrch",
      },
    });
    this.model     = model?.trim() || DEFAULT_MODEL;
    this.maxTokens = genParams?.maxTokens ?? undefined;
    const t = genParams?.temperature;
    this.temperature = typeof t === "number" && Number.isFinite(t) ? Math.min(2, Math.max(0, t)) : undefined;
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
    const togetherTools = supportsTools && options?.tools?.length
      ? options.tools.map((t) => ({
          type: "function" as const,
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }))
      : undefined;

    const hasSchedulingTools = options?.tools?.some(
      (t) => SCHEDULING_TOOL_NAME_PATTERNS.some((pattern) => t.name.includes(pattern)),
    ) ?? false;
    const toolChoice = togetherTools ? (hasSchedulingTools ? "required" : "auto") : undefined;

    // Disable reasoning/thinking tokens — they add latency before first spoken word
    // and are never useful for a real-time voice call. Cast to any because the
    // OpenAI SDK types don't expose the Together AI-specific `reasoning` field.
    const reqBody: any = {
      model:          this.model,
      stream:         true,
      stream_options: { include_usage: true },
      reasoning:      { effort: "none" },
      messages: [
        { role: "system", content: systemPrompt },
        ...toOpenAIMessages(messages),
      ],
      ...(this.maxTokens   ? { max_tokens: this.maxTokens }     : {}),
      ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
      ...(togetherTools ? { tools: togetherTools, tool_choice: toolChoice } : {}),
    };
    const stream = await this.client.chat.completions.create(reqBody) as unknown as AsyncIterable<any>;

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
