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
 * Models (from catalogue):
 *   - Qwen/Qwen3.5-9B         — smallest, fastest TTFT, cheapest (₹3/1M in)
 *   - Qwen/Qwen3.6-35B-A3B   — MoE: 3B active params, 35B quality (₹7/1M in)
 *   - Qwen/Qwen3.6-27B       — dense 27B (₹23/1M in, skip for voice)
 *   - Google/gemma-4-E4B-it  — 4B multimodal, good quality (₹3/1M in)
 *   - Google/gemma-4-31b-it  — 31B multimodal (₹9/1M in)
 *   - OpenAI/gpt-oss-20b     — 20B open-source (₹8/1M in)
 *   - OpenAI/gpt-oss-120b    — 120B open-source (₹13/1M in)
 *
 * Tool calling: Qwen3.x and Gemma-4 support native function calling via the
 * standard OpenAI tools/tool_calls interface. gpt-oss models may vary.
 *
 * BYOP only — no managed platform key (Krutrim accounts are user-provisioned).
 */

const DEFAULT_MODEL = "Qwen/Qwen3.5-9B";

/** Models that reliably support native tool/function calling on Krutrim. */
const TOOL_CAPABLE_MODELS = new Set([
  "Qwen/Qwen3.5-9B",
  "Qwen/Qwen3.6-35B-A3B",
  "Qwen/Qwen3.6-27B",
  "Google/gemma-4-E4B-it",
  "Google/gemma-4-31b-it",
  "OpenAI/gpt-oss-20b",
  "OpenAI/gpt-oss-120b",
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

      // Strip Qwen3 thinking-mode delimiters that may appear with thinking=true.
      const cleaned = token.replace(/<\|(?:think|\/think)\|>/g, "");
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
