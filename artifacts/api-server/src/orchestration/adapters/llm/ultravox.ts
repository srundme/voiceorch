import OpenAI from "openai";
import type { ConversationTurn, LLMAdapter, LLMUsage, ToolDefinition } from "../../types.js";
import { logger } from "../../../lib/logger.js";

/**
 * Ultravox — multimodal speech-language model by Fixie.ai
 * Models: ultravox-v0.6-gemma3-27b, ultravox-v0.4_1-llama-3_1-8b
 *
 * API is OpenAI-compatible (chat completions).
 * Default endpoint: https://api.ultravox.ai  (Fixie.ai hosted)
 * Self-hosted vLLM: supply a custom baseUrl in agentConfig.ultravoxBaseUrl
 *
 * Auth: X-API-Key header (also sends Authorization: Bearer for compat).
 * Tool calling: NOT supported by Ultravox models — tools are silently stripped.
 */

const ULTRAVOX_DEFAULT_BASE = "https://api.ultravox.ai";
const ULTRAVOX_DEFAULT_MODEL = "ultravox-v0.6-gemma3-27b";

export class UltravoxLLM implements LLMAdapter {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string | null, baseUrl?: string) {
    const base = (baseUrl ?? ULTRAVOX_DEFAULT_BASE).replace(/\/$/, "");
    this.client = new OpenAI({
      apiKey: apiKey || "no-key",
      baseURL: base,
      defaultHeaders: {
        // Fixie.ai uses X-API-Key; self-hosted vLLM accepts Bearer — send both.
        "X-API-Key": apiKey || "",
      },
    });
    this.model = (model ?? "").trim() || ULTRAVOX_DEFAULT_MODEL;
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
    if (options?.tools?.length) {
      logger.warn(
        { model: this.model, toolCount: options.tools.length },
        "Ultravox: model does not support function calling — tools stripped. " +
          "Agents using scheduling/call-transfer tools will not be able to invoke them. " +
          "Use a tool-capable LLM (OpenAI, Groq llama-3.3-70b, etc.) for agents with tools.",
      );
    }

    const stream = await this.client.chat.completions.create({
      model: this.model,
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    });

    let full = "";
    let usage: LLMUsage | undefined;

    for await (const chunk of stream) {
      if (chunk.usage) {
        usage = {
          inputTokens: chunk.usage.prompt_tokens,
          outputTokens: chunk.usage.completion_tokens,
        };
      }

      const token = chunk.choices[0]?.delta?.content ?? "";
      if (token) {
        full += token;
        onToken(token);
      }
    }

    if (usage) options?.onUsage?.(usage);
    onDone(full, usage);
  }
}
