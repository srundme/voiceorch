import OpenAI from "openai";
import type { ConversationTurn, LLMAdapter, LLMGenerationParams, LLMUsage, ToolDefinition } from "../../types.js";
import { toOpenAIMessages } from "./openai-messages.js";
import { drainOpenAICompatibleStream } from "./openai-compat.js";
import { toOpenAiToolChoice } from "./tool-choice.js";

/**
 * DeepSeek — OpenAI-compatible API
 * Models: deepseek-chat (V3), deepseek-reasoner (R1)
 * Endpoint: https://api.deepseek.com
 */

const DEFAULT_MODEL = "deepseek-chat";

export class DeepSeekLLM implements LLMAdapter {
  private client: OpenAI;
  private model: string;
  private temperature: number | undefined;

  constructor(apiKey: string, model: string | null, genParams?: LLMGenerationParams) {
    this.client = new OpenAI({ apiKey, baseURL: "https://api.deepseek.com" });
    this.model = model ?? DEFAULT_MODEL;
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
        ...toOpenAIMessages(messages),
      ] as any,
      ...(tools ? { tools, tool_choice: toOpenAiToolChoice(options?.toolChoice, options?.tools) } : {}),
      ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
    });

    await drainOpenAICompatibleStream(stream as any, onToken, onDone, options);
  }
}
