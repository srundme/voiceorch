import OpenAI from "openai";
import type { ConversationTurn, LLMAdapter, LLMGenerationParams, LLMUsage, ToolDefinition } from "../../types.js";
import { toOpenAIMessages } from "./openai-messages.js";
import { drainOpenAICompatibleStream } from "./openai-compat.js";
import { toOpenAiToolChoice } from "./tool-choice.js";
import { irfanPodBaseUrl } from "../irfan-pod-url.js";

/**
 * Qwen3-32B on the GPU pod (vLLM). The pod speaks the OpenAI chat stream,
 * including tool_calls, so intake can keep saving the form.
 */
export class IrfanPodLLM implements LLMAdapter {
  private client: OpenAI;
  private model: string;
  private maxTokens: number | undefined;
  private temperature: number | undefined;
  private abortController: AbortController | null = null;

  constructor(apiKey: string, model: string | null, genParams?: LLMGenerationParams) {
    this.client = new OpenAI({
      apiKey: apiKey || "pod",
      baseURL: `${irfanPodBaseUrl()}/v1`,
    });
    this.model = (model ?? "").trim() || "qwen3-32b-awq";
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
      toolChoice?: "auto" | "required" | { name: string };
      onToolCall?: (name: string, args: Record<string, unknown>) => void;
      onUsage?: (usage: LLMUsage) => void;
    },
  ): Promise<void> {
    const tools = options?.tools?.length
      ? options.tools.map((t) => ({
          type: "function" as const,
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }))
      : undefined;
    const toolChoice = tools ? toOpenAiToolChoice(options?.toolChoice, options?.tools) : undefined;
    const effectiveSystemPrompt = tools
      ? `[TOOL CALLING RULES — FOLLOW EXACTLY]
When you want to call a tool, use the tool-call format. Do not describe the call in spoken text.

${systemPrompt}`
      : systemPrompt;

    this.abortController?.abort();
    const abortController = new AbortController();
    this.abortController = abortController;
    try {
      const stream = await this.client.chat.completions.create({
        model: this.model,
        stream: true,
        ...(this.maxTokens ? { max_tokens: this.maxTokens } : {}),
        ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
        messages: [
          { role: "system", content: effectiveSystemPrompt },
          ...toOpenAIMessages(messages),
        ] as any,
        ...(tools ? { tools, tool_choice: toolChoice } : {}),
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
