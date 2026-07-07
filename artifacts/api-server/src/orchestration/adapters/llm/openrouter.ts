import OpenAI from "openai";
import type { ConversationTurn, LLMAdapter, LLMGenerationParams, LLMUsage, ToolDefinition } from "../../types.js";
import { toOpenAIMessages } from "./openai-messages.js";

/**
 * OpenRouter — OpenAI-compatible gateway to third-party-hosted models.
 * Used here for the newer Qwen3.5 / Qwen3.6 model family (not yet available
 * via the Groq-hosted `qwen` adapter), which requires a user-supplied
 * OPENROUTER API key added on the Providers page (BYOP — no managed key).
 *
 * Models: qwen/qwen3.5-397b-a17b, qwen/qwen3.6-35b-a3b
 * Endpoint: https://openrouter.ai/api/v1
 *
 * Tool calling: both Qwen3.5 and Qwen3.6 support native tool/function calling.
 */

const DEFAULT_MODEL = "qwen/qwen3.6-35b-a3b";

const TOOL_CAPABLE_MODELS = new Set([
  "qwen/qwen3.5-397b-a17b",
  "qwen/qwen3.6-35b-a3b",
]);

const SCHEDULING_TOOL_NAME_PATTERNS = [
  "check_availability",
  "book_appointment",
  "get_bookings",
  "cancel_appointment",
  "reschedule_appointment",
];

export class OpenRouterLLM implements LLMAdapter {
  private client: OpenAI;
  private model: string;
  private maxTokens: number | undefined;
  private temperature: number | undefined;

  constructor(apiKey: string, model: string | null, genParams?: LLMGenerationParams) {
    this.client = new OpenAI({
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        // Recommended by OpenRouter for attribution/rate-limit routing; harmless if ignored.
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
    const orTools = supportsTools && options?.tools?.length
      ? options.tools.map((t) => ({
          type: "function" as const,
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }))
      : undefined;

    const hasSchedulingTools = options?.tools?.some(
      (t) => SCHEDULING_TOOL_NAME_PATTERNS.some((pattern) => t.name.includes(pattern)),
    ) ?? false;
    const toolChoice = orTools ? (hasSchedulingTools ? "required" : "auto") : undefined;

    const stream = await this.client.chat.completions.create({
      model:          this.model,
      stream:         true,
      stream_options: { include_usage: true },
      ...(this.maxTokens ? { max_tokens: this.maxTokens } : {}),
      ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
      // Disable reasoning/thinking tokens — they add latency before first spoken word
      // and are never useful for a real-time voice call.
      reasoning: { effort: "none" },
      messages: [
        { role: "system", content: systemPrompt },
        ...toOpenAIMessages(messages),
      ] as any,
      ...(orTools ? { tools: orTools, tool_choice: toolChoice } : {}),
    } as any);

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
