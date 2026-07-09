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
 * Live model catalogue (GET /v1/models — verified 2026-07-09):
 *   - gpt-oss-20b        — Krutrim proprietary 20B, fast, tool-capable (recommended for voice)
 *   - gpt-oss-120b       — Krutrim proprietary 120B, higher quality, tool-capable
 *   - gemma-4-E4B-it     — Gemma 4 4B MoE (ultra-fast)
 *   - gemma-4-31b-it     — Gemma 4 31B
 *   - gemma-4-26B-A4B-it — Gemma 4 26B MoE, 262k context
 *   - Qwen3.5-9B         — Qwen 3.5 thinking model (needs maxTokens ≥ 500 for voice)
 *   - Qwen3.6-27B        — Qwen 3.6 thinking model (needs maxTokens ≥ 500)
 *   - Qwen3.6-35B-A3B    — Qwen 3.6 35B MoE thinking model (needs maxTokens ≥ 500)
 */

const DEFAULT_MODEL = "gpt-oss-20b";

/** Models that reliably support native tool/function calling on Krutrim. */
const TOOL_CAPABLE_MODELS = new Set([
  "gpt-oss-20b",
  "gpt-oss-120b",
]);

/**
 * Qwen3.5/3.6 thinking models: require a higher max_tokens floor so the
 * internal <think> block (which scales with prompt complexity) doesn't exhaust
 * the entire budget before the spoken reply is generated.
 * With a full production system prompt + tools the thinking block can easily
 * use 800–1200 tokens, leaving nothing for the response at a 500-token cap.
 * Floor raised to 1500 — any per-agent maxTokens setting below this is bumped.
 */
const THINKING_MODELS = new Set([
  "Qwen3.5-9B",
  "Qwen3.6-27B",
  "Qwen3.6-35B-A3B",
]);
const THINKING_MIN_TOKENS = 1500;

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
    // Thinking models need a higher floor so the internal <think> block doesn't
    // exhaust the entire budget before the spoken reply. With a full production
    // system prompt the think block can use 800–1200 tokens on its own.
    const minForThinking = THINKING_MODELS.has(this.model) ? THINKING_MIN_TOKENS : 0;
    this.maxTokens = Math.max(genParams?.maxTokens ?? 250, minForThinking);
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
