import OpenAI from "openai";
import type { ConversationTurn, LLMAdapter, LLMGenerationParams, LLMUsage, ToolDefinition } from "../../types.js";
import { toOpenAIMessages } from "./openai-messages.js";
import { drainOpenAICompatibleStream } from "./openai-compat.js";
import { toOpenAiToolChoice } from "./tool-choice.js";

/**
 * Qwen LLM Adapter — supports Groq (gsk_...) and OpenRouter (sk-or-v1-...).
 * Groq models: qwen-2.5-32b, qwen-2.5-coder-32b, deepseek-r1-distill-qwen-32b
 * OpenRouter models: qwen/qwen-2.5-72b-instruct, qwen/qwen-2.5-32b-instruct
 */

const GROQ_QWEN_MODEL_MAP: Record<string, string> = {
  "qwen/qwen3-32b": "qwen-2.5-32b",
  "qwen3-32b": "qwen-2.5-32b",
  "qwen/qwen3-235b-a22b": "qwen-2.5-32b",
  "qwen/qwen-2.5-32b": "qwen-2.5-32b",
  "qwen-32b": "qwen-2.5-32b",
};

const DEFAULT_GROQ_MODEL = "qwen-2.5-32b";
const DEFAULT_OPENROUTER_MODEL = "qwen/qwen-2.5-72b-instruct";

const SCHEDULING_TOOL_NAME_PATTERNS = [
  "check_availability",
  "book_appointment",
  "get_bookings",
  "cancel_appointment",
  "reschedule_appointment",
];

export class QwenLLM implements LLMAdapter {
  private client: OpenAI;
  private model: string;
  private maxTokens: number | undefined;
  private temperature: number | undefined;
  private abortController: AbortController | null = null;

  constructor(apiKey: string, rawModel: string | null, genParams?: LLMGenerationParams) {
    const isOpenRouter = apiKey?.startsWith("sk-or-v1");
    const baseURL = isOpenRouter
      ? "https://openrouter.ai/api/v1"
      : "https://api.groq.com/openai/v1";

    this.client = new OpenAI({ apiKey, baseURL });

    const trimmed = rawModel?.trim() || "";
    if (isOpenRouter) {
      this.model = trimmed || DEFAULT_OPENROUTER_MODEL;
    } else {
      this.model = GROQ_QWEN_MODEL_MAP[trimmed] || (trimmed.startsWith("qwen/") ? trimmed.slice(5) : (trimmed || DEFAULT_GROQ_MODEL));
    }

    this.maxTokens = genParams?.maxTokens ?? undefined;
    const t = genParams?.temperature;
    this.temperature = typeof t === "number" && Number.isFinite(t) ? Math.min(2, Math.max(0, t)) : undefined;
  }

  cancelInFlight(): void {
    this.abortController?.abort();
    this.abortController = null;
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
    const qwenTools = options?.tools?.length
      ? options.tools.map((t) => ({
          type: "function" as const,
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }))
      : undefined;

    const toolChoice = qwenTools ? toOpenAiToolChoice(options?.toolChoice, options?.tools) : undefined;

    this.abortController?.abort();
    const abortController = new AbortController();
    this.abortController = abortController;
    try {
      const stream = await this.client.chat.completions.create({
        model:          this.model,
        stream:         true,
        stream_options: { include_usage: true },
        ...(this.maxTokens ? { max_tokens: this.maxTokens } : {}),
        ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
        messages: [
          { role: "system", content: systemPrompt },
          ...toOpenAIMessages(messages),
        ] as any,
        ...(qwenTools ? { tools: qwenTools, tool_choice: toolChoice } : {}),
      }, { signal: abortController.signal });

      await drainOpenAICompatibleStream(stream as any, onToken, onDone, options);
    } catch (err) {
      if (abortController.signal.aborted) {
        onDone("");
        return;
      }
      throw err;
    } finally {
      if (this.abortController === abortController) this.abortController = null;
    }
  }
}
