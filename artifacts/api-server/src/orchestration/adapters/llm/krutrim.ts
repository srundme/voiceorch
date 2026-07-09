import OpenAI from "openai";
import type { ConversationTurn, LLMAdapter, LLMGenerationParams, LLMUsage, ToolDefinition } from "../../types.js";
import { toOpenAIMessages } from "./openai-messages.js";

/**
 * Krutrim Cloud — OpenAI-compatible LLM gateway, Bangalore-hosted.
 * Best for Tamil/Indic voice calls from Indian callers — lowest RTT.
 *
 * Endpoint: https://cloud.olakrutrim.com/v1
 * Auth: Authorization: Bearer <api_key>
 * Docs: https://cloud.olakrutrim.com/docs
 *
 * Models (from catalogue — actual IDs):
 *   Text-Generation:
 *   - Qwen3-30B-A3B                 — MoE, fast, tool-capable (recommended for voice)
 *   - Qwen3-32B                     — dense, best quality, tool-capable
 *   - Llama-3.3-70B-Instruct        — strong multilingual, tool-capable
 *   - DeepSeek-R1-Distill-Llama-8B  — ultra-fast reasoning distill
 *   - DeepSeek-R1-Distill-Llama-70B — larger reasoning distill
 *   - DeepSeek-R1                   — full reasoning (slow, skip for voice)
 *   - Krutrim-1 / Krutrim-2         — India-trained proprietary
 *   - chitrapathak                  — Krutrim proprietary
 *   - Phi-4-reasoning-plus          — Microsoft reasoning
 *   - Mistral-7B-v0.2               — lightweight
 */

const DEFAULT_MODEL = "Qwen3-30B-A3B";

/** Models that reliably support native tool/function calling on Krutrim. */
const TOOL_CAPABLE_MODELS = new Set([
  "Qwen3-30B-A3B",
  "Qwen3-32B",
  "Llama-3.3-70B-Instruct",
]);

export class KrutrimLLM implements LLMAdapter {
  private client: OpenAI;
  private model: string;
  private maxTokens: number | undefined;
  private temperature: number | undefined;

  constructor(apiKey: string, model: string | null, genParams?: LLMGenerationParams) {
    this.client = new OpenAI({
      apiKey,
      baseURL: "https://cloud.olakrutrim.com/v1",
    });
    this.model = model?.trim() || DEFAULT_MODEL;
    this.maxTokens = genParams?.maxTokens ?? 250;
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
      onToolDetected?: (info: { format: "structured" | "json" | "bracket" | "function_tag" }) => void;
      onToolParsed?: (info: { name: string; format: "structured" | "json" | "bracket" | "function_tag"; args: Record<string, unknown> }) => void;
      onUsage?: (usage: LLMUsage) => void;
    }
  ): Promise<void> {
    const hasTools = TOOL_CAPABLE_MODELS.has(this.model) && (options?.tools?.length ?? 0) > 0;

    const body: Parameters<typeof this.client.chat.completions.create>[0] = {
      model: this.model,
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        ...toOpenAIMessages(messages),
      ],
      ...(this.maxTokens ? { max_tokens: this.maxTokens } : {}),
      ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
    };

    if (hasTools && options?.tools) {
      body.tools = options.tools.map((t) => ({
        type: "function" as const,
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      body.tool_choice = "auto";
    }

    const stream = await this.client.chat.completions.create({ ...body, stream: true });

    let full = "";
    let usage: LLMUsage | undefined;

    // Accumulate streaming tool-call fragments by index (OpenAI protocol).
    const toolAcc = new Map<number, { id: string; name: string; args: string }>();
    let sawToolDelta = false;

    for await (const chunk of stream) {
      if (chunk.usage) {
        usage = {
          inputTokens:  chunk.usage.prompt_tokens     ?? 0,
          outputTokens: chunk.usage.completion_tokens ?? 0,
        };
      }

      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      // Accumulate tool-call fragments.
      if (delta.tool_calls?.length) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          sawToolDelta = true;
          const cur = toolAcc.get(idx) ?? { id: "", name: "", args: "" };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name = tc.function.name;
          if (typeof tc.function?.arguments === "string") cur.args += tc.function.arguments;
          toolAcc.set(idx, cur);
        }
        continue;
      }

      if (sawToolDelta) continue;

      const token = delta.content;
      if (!token) continue;

      // Strip Qwen3 thinking-mode delimiters and DeepSeek-R1 <think>…</think> blocks.
      const cleaned = token
        .replace(/<\|(?:think|\/think)\|>/g, "")
        .replace(/<\/?think>/g, "");
      if (!cleaned) continue;

      full += cleaned;
      onToken(cleaned);
    }

    // Fire tool calls after the stream completes.
    if (sawToolDelta && toolAcc.size > 0 && options?.onToolCall) {
      for (const tc of toolAcc.values()) {
        if (!tc.name) continue;
        options.onToolDetected?.({ format: "structured" });
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.args || "{}"); } catch { /* keep {} */ }
        options.onToolParsed?.({ name: tc.name, format: "structured", args });
        options.onToolCall(tc.name, args);
      }
      onDone("", usage);
      return;
    }

    onDone(full, usage);
  }
}
