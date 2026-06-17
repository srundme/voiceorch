import OpenAI from "openai";
import type { ConversationTurn, LLMAdapter, LLMUsage, ToolDefinition } from "../../types.js";
import { logger } from "../../../lib/logger.js";

/**
 * Groq — OpenAI-compatible API with ultra-fast inference
 * Models: llama-3.3-70b-versatile, llama-3.1-8b-instant, gemma2-9b-it
 *
 * Tool calling: supported on llama-3.3-70b-versatile, llama-3.1-8b-instant,
 *   llama3-groq-*-tool-use-preview, and qwen/qwen3-32b.
 *   gemma2-9b-it does NOT support Groq function calling — tools are stripped for it.
 * Uses identical format to OpenAI (same SDK, different baseURL)
 */

const GROQ_MODEL_REPLACEMENTS: Record<string, string> = {
  "mixtral-8x7b-32768":        "llama-3.3-70b-versatile",
  "llama2-70b-4096":           "llama-3.3-70b-versatile",
  "llama-3.1-70b-versatile":   "llama-3.3-70b-versatile",
  "qwen3-32b":                  "qwen/qwen3-32b",
};
const GROQ_DEFAULT = "llama-3.3-70b-versatile";

/** Models that support Groq's function-calling interface */
const TOOL_CAPABLE_MODELS = new Set([
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "llama3-groq-70b-8192-tool-use-preview",
  "llama3-groq-8b-8192-tool-use-preview",
  "qwen/qwen3-32b",
]);

/**
 * Scheduling-related tool names that warrant forcing tool_choice: "required".
 * This list covers the standard native tool names defined in buildToolDefs.
 */
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

  constructor(apiKey: string, model: string | null) {
    this.client = new OpenAI({
      apiKey,
      baseURL: "https://api.groq.com/openai/v1",
    });
    this.model = resolveGroqModel(model);
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
    // Only pass tools when the model supports function calling.
    // gemma2-9b-it does not support Groq function calling — warn and strip tools.
    const supportsTools = TOOL_CAPABLE_MODELS.has(this.model);
    if (!supportsTools && options?.tools?.length) {
      logger.warn(
        { model: this.model, toolCount: options.tools.length },
        "Groq: model does not support function calling — tools stripped. " +
          "Agents using scheduling tools with this model will not be able to call tools. " +
          "Switch to llama-3.3-70b-versatile or llama-3.1-8b-instant for tool support.",
      );
    }
    const groqTools = supportsTools && options?.tools?.length
      ? options.tools.map((t) => ({
          type: "function" as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        }))
      : undefined;

    // Use tool_choice: "required" when scheduling tools are present so the model
    // is forced to invoke a tool rather than hallucinating slot times in plain text.
    // Keep "auto" when only end_call is present to avoid forcing unnecessary tool calls.
    const hasSchedulingTools = options?.tools?.some(
      (t) => SCHEDULING_TOOL_NAME_PATTERNS.some((pattern) => t.name.includes(pattern)),
    ) ?? false;
    const toolChoice = groqTools ? (hasSchedulingTools ? "required" : "auto") : undefined;

    const stream = await this.client.chat.completions.create({
      model: this.model,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: "system", content: systemPrompt },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      ...(groqTools ? { tools: groqTools, tool_choice: toolChoice } : {}),
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
