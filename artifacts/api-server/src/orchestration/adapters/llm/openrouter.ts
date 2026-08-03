import OpenAI from "openai";
import type { ConversationTurn, LLMAdapter, LLMGenerationParams, LLMUsage, ToolDefinition } from "../../types.js";
import { toOpenAIMessages } from "./openai-messages.js";
import { drainOpenAICompatibleStream } from "./openai-compat.js";

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

    const toolChoice = orTools ? "auto" : undefined;

    // Disable reasoning/thinking tokens — they add latency before first spoken word
    // and are never useful for a real-time voice call. Cast to any because the
    // OpenAI SDK types don't expose the OpenRouter-specific `reasoning` field.
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
      ...(orTools ? { tools: orTools, tool_choice: toolChoice } : {}),
    };
    const stream = await this.client.chat.completions.create(reqBody) as unknown as AsyncIterable<any>;

    await drainOpenAICompatibleStream(stream, onToken, onDone, options);
  }
}
