import OpenAI from "openai";
import type { ConversationTurn, LLMAdapter, LLMGenerationParams, ToolDefinition } from "../../types.js";
import { logger } from "../../../lib/logger.js";
import { toOpenAIMessages } from "./openai-messages.js";
import { drainOpenAICompatibleStream } from "./openai-compat.js";

function voiceCpuUrl(): string {
  return (process.env["VOICE_CPU_URL"] || "http://127.0.0.1:8090").replace(/\/$/, "");
}

/**
 * Qwen on the CPU voice service. Thinking is forced off in that process.
 * Short max tokens keep a recruiter turn inside the CPU budget.
 */
export class LocalCpuLLM implements LLMAdapter {
  private client: OpenAI;
  private model: string;
  private maxTokens: number;
  private temperature: number;
  private abortController: AbortController | null = null;

  constructor(model: string | null, genParams?: LLMGenerationParams) {
    this.client = new OpenAI({
      apiKey: "local",
      baseURL: `${voiceCpuUrl()}/v1`,
    });
    this.model = model?.trim() || "qwen3.5-0.8b";
    this.maxTokens = genParams?.maxTokens ?? 80;
    const t = genParams?.temperature;
    this.temperature = typeof t === "number" && Number.isFinite(t) ? t : 0.3;
  }

  cancelInFlight(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  async chat(
    messages: ConversationTurn[],
    systemPrompt: string,
    onToken: (token: string) => void,
    onDone: (fullText: string) => void,
    options?: {
      tools?: ToolDefinition[];
      toolChoice?: "auto" | "required" | { name: string };
      onToolCall?: (name: string, args: Record<string, unknown>) => void;
      onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
    },
  ): Promise<void> {
    this.abortController?.abort();
    this.abortController = new AbortController();
    // Qwen 0.8B on CPU speaks the next line. Tool schemas make that process
    // wait on a grammar, so the caller hears silence (call 31864).
    if (options?.tools?.length) {
      logger.warn(
        { model: this.model, toolCount: options.tools.length },
        "Qwen CPU: tools stripped so the reply is spoken",
      );
    }
    try {
      const stream = await this.client.chat.completions.create(
        {
          model: this.model,
          temperature: this.temperature,
          max_tokens: this.maxTokens,
          stream: true,
          messages: [
            { role: "system", content: systemPrompt },
            ...toOpenAIMessages(messages),
          ] as OpenAI.Chat.ChatCompletionMessageParam[],
        },
        { signal: this.abortController.signal },
      );
      await drainOpenAICompatibleStream(stream, onToken, onDone, options);
    } catch (err) {
      if (this.abortController?.signal.aborted) {
        onDone("");
        return;
      }
      throw err;
    } finally {
      this.abortController = null;
    }
  }
}
