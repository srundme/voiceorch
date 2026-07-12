import OpenAI from "openai";
import type { ConversationTurn, LLMAdapter, LLMGenerationParams, LLMUsage, ToolDefinition } from "../../types.js";
import { logger } from "../../../lib/logger.js";
import { toOpenAIMessages } from "./openai-messages.js";
import { drainOpenAICompatibleStream } from "./openai-compat.js";

/**
 * Groq — OpenAI-compatible API with ultra-fast LPU inference.
 *
 * Latency guidance (from Groq docs):
 *  • 8B models  (llama-3.1-8b-instant)    → minimal TTFT variance, best for voice
 *  • 32B models (qwen/qwen3-32b)           → balanced quality/latency
 *  • 70B models (llama-3.3-70b-versatile)  → highest quality, higher TTFT
 *
 * service_tier:"on_demand" is always set for real-time voice calls:
 *  guarantees dedicated-resource processing with no queueing delays.
 *
 * max_tokens caps output length which directly reduces total latency:
 *   Total Latency = TTFT + (output_tokens / generation_speed) + network
 *
 * Tool calling is supported on: llama-3.3-70b-versatile, llama-3.1-8b-instant,
 *   llama3-groq-*-tool-use-preview, and qwen/qwen3-32b.
 *   gemma2-9b-it does NOT support Groq function calling — tools are stripped.
 */

const GROQ_MODEL_REPLACEMENTS: Record<string, string> = {
  // Deprecated models → current equivalents
  "mixtral-8x7b-32768":         "llama-3.3-70b-versatile",
  "llama2-70b-4096":            "llama-3.3-70b-versatile",
  "llama-3.1-70b-versatile":    "llama-3.3-70b-versatile",
  // Old 8b naming → instant variant
  "llama3-8b-8192":             "llama-3.1-8b-instant",
  "llama-3-8b":                 "llama-3.1-8b-instant",
  // Qwen shorthand → fully-qualified Groq model id
  "qwen3-32b":                  "qwen/qwen3-32b",
  "qwen3-235b":                 "qwen/qwen3-235b-a22b",
};

/**
 * Default model: 70B versatile gives the best quality.
 * Switch to "llama-3.1-8b-instant" for lowest possible TTFT (~50 % faster)
 * when quality requirements allow it (e.g. simple FAQ / IVR agents).
 */
const GROQ_DEFAULT = "llama-3.3-70b-versatile";

/** Models that support Groq's function-calling interface */
const TOOL_CAPABLE_MODELS = new Set([
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "llama3-groq-70b-8192-tool-use-preview",
  "llama3-groq-8b-8192-tool-use-preview",
  "qwen/qwen3-32b",
  "qwen/qwen3-235b-a22b",
]);

const SCHEDULING_TOOL_NAME_PATTERNS = [
  "check_availability",
  "book_appointment",
  "get_bookings",
  "cancel_appointment",
  "reschedule_appointment",
];

function resolveGroqModel(model: string | null): string {
  const m = (model ?? "").trim();
  return GROQ_MODEL_REPLACEMENTS[m] ?? (m || GROQ_DEFAULT);
}

export class GroqLLM implements LLMAdapter {
  private client: OpenAI;
  private model: string;
  private maxTokens: number | undefined;
  private temperature: number | undefined;

  constructor(apiKey: string, model: string | null, genParams?: LLMGenerationParams) {
    this.client = new OpenAI({
      apiKey,
      baseURL: "https://api.groq.com/openai/v1",
    });
    this.model     = resolveGroqModel(model);
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
    if (!supportsTools && options?.tools?.length) {
      logger.warn(
        { model: this.model, toolCount: options.tools.length },
        "Groq: model does not support function calling — tools stripped. " +
          "Switch to llama-3.3-70b-versatile or llama-3.1-8b-instant for tool support.",
      );
    }
    const groqTools = supportsTools && options?.tools?.length
      ? options.tools.map((t) => ({
          type: "function" as const,
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }))
      : undefined;

    const hasSchedulingTools = options?.tools?.some(
      (t) => SCHEDULING_TOOL_NAME_PATTERNS.some((pattern) => t.name.includes(pattern)),
    ) ?? false;
    const toolChoice = groqTools ? (hasSchedulingTools ? "required" : "auto") : undefined;

    const stream = await this.client.chat.completions.create({
      model:          this.model,
      stream:         true,
      stream_options: { include_usage: true },
      // service_tier:"on_demand" guarantees dedicated LPU resources with no
      // queue wait, which is critical for real-time voice turn latency.
      service_tier:   "on_demand" as any,
      // Capping output tokens directly reduces Decoding Time in the formula:
      //   Total Latency = TTFT + (output_tokens / generation_speed) + network
      // Voice turns rarely need more than 150–200 tokens; longer replies are
      // chunked into sentences and played incrementally, so the cap doesn't
      // truncate natural speech.
      ...(this.maxTokens ? { max_tokens: this.maxTokens } : {}),
      ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
      messages: [
        { role: "system", content: systemPrompt },
        ...toOpenAIMessages(messages),
      ] as any,
      ...(groqTools ? { tools: groqTools, tool_choice: toolChoice } : {}),
    });

    await drainOpenAICompatibleStream(stream as any, onToken, onDone, options);
  }
}
