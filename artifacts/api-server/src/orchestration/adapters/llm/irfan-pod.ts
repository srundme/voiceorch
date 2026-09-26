import OpenAI from "openai";
import type { ConversationTurn, LLMAdapter, LLMGenerationParams, LLMUsage, ToolDefinition } from "../../types.js";
import { toOpenAIMessages } from "./openai-messages.js";
import { drainOpenAICompatibleStream } from "./openai-compat.js";
import { toOpenAiToolChoice } from "./tool-choice.js";
import { irfanPodBaseUrl } from "../irfan-pod-url.js";
import { logger } from "../../../lib/logger.js";

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
  /** In-flight read of the system prompt, started while the greeting plays. */
  private warmInflight: Promise<void> | null = null;

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

  /**
   * Read the call prompt into the brain while the greeting plays, so the
   * caller's first answer does not pay that cost. The real turn sends the
   * same prompt with their words after it, and vLLM reuses the read.
   */
  warmContextCache(base: string, tools?: ToolDefinition[]): void {
    if (!base.trim() || this.warmInflight) return;
    const openaiTools = this.openAiTools(tools);
    this.warmInflight = (async () => {
      // Let the greeting take the GPU first. The caller is still listening.
      await new Promise((resolve) => setTimeout(resolve, 400));
      await this.client.chat.completions.create({
        model: this.model,
        max_tokens: 1,
        temperature: 0,
        messages: [
          { role: "system", content: this.effectiveSystem(base, openaiTools != null) },
          { role: "user", content: "ok" },
        ],
        ...(openaiTools ? { tools: openaiTools, tool_choice: "auto" as const } : {}),
      });
    })().then(() => {
      logger.info("Irfan prompt is in memory before the first caller turn");
    }).catch((err) => {
      logger.warn({ err }, "Irfan prompt warm failed");
    }).finally(() => {
      this.warmInflight = null;
    });
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
    const callerHasSpoken = messages.some((m) => m.role === "user");
    if (callerHasSpoken && this.warmInflight) await this.warmInflight;
    const tools = this.openAiTools(options?.tools);
    const toolChoice = tools ? toOpenAiToolChoice(options?.toolChoice, options?.tools) : undefined;

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
          { role: "system", content: this.effectiveSystem(systemPrompt, tools != null) },
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

  private openAiTools(tools?: ToolDefinition[]) {
    if (!tools?.length) return undefined;
    return tools.map((t) => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }

  private effectiveSystem(systemPrompt: string, hasTools: boolean): string {
    if (!hasTools) return systemPrompt;
    return `[TOOL CALLING RULES — FOLLOW EXACTLY]
When you want to call a tool, use the tool-call format. Do not describe the call in spoken text.

${systemPrompt}`;
  }
}
