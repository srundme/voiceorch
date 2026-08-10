import OpenAI from "openai";
import type { ConversationTurn, LLMAdapter, LLMGenerationParams, LLMUsage, ToolDefinition } from "../../types.js";
import { toOpenAIMessages } from "./openai-messages.js";
import { envInt } from "../../utils.js";
import { logger } from "../../../lib/logger.js";

/**
 * Krutrim Cloud — OpenAI-compatible LLM gateway, Bangalore-hosted.
 * Best for Tamil/Indic voice calls from Indian callers — lowest RTT.
 *
 * Endpoint: https://cloud.olakrutrim.com/v1
 * Auth: Authorization: Bearer <api_key>
 * Docs: https://cloud.olakrutrim.com/docs
 *
 * Dashboard exposes only tool-capable models (agents need end_call / booking / etc.):
 *   - gpt-oss-20b / gpt-oss-120b
 * Gemma / Qwen on Krutrim omit tools — keep them out of the product picker.
 */

// Aligned with session.ts's voice default (200) — 120 clipped Indic-script
// replies mid-sentence on the non-session paths that construct this adapter
// without generation params.
const VOICE_DEFAULT_MAX_TOKENS = envInt("VOICE_DEFAULT_MAX_TOKENS", 200);

const DEFAULT_MODEL = "gpt-oss-20b";

/** Hard per-request timeout — fail fast so the pipeline's retry/fallback logic can take over */
const REQUEST_TIMEOUT_MS = envInt("KRUTRIM_REQUEST_TIMEOUT_MS", 15000, 1000);

/** Models that reliably support native tool/function calling on Krutrim. */
const TOOL_CAPABLE_MODELS = new Set([
  "gpt-oss-20b",
  "gpt-oss-120b",
]);

/**
 * Qwen3.5/3.6 are thinking models by default on Krutrim.
 * We disable thinking via chat_template_kwargs: { enable_thinking: false }
 * so they behave as fast non-thinking models suitable for voice.
 * (enable_thinking: false top-level param is ignored by Krutrim's API.)
 */
const NO_THINK_MODELS = new Set([
  "Qwen3.5-9B",
  "Qwen3.6-27B",
  "Qwen3.6-35B-A3B",
]);

export class KrutrimLLM implements LLMAdapter {
  private client: OpenAI;
  private model: string;
  private maxTokens: number | undefined;
  private temperature: number | undefined;
  private abortController: AbortController | null = null;

  constructor(apiKey: string, model: string | null, genParams?: LLMGenerationParams) {
    this.client = new OpenAI({
      apiKey,
      baseURL: "https://cloud.olakrutrim.com/v1",
    });
    this.model = model?.trim() || DEFAULT_MODEL;
    this.maxTokens = genParams?.maxTokens ?? VOICE_DEFAULT_MAX_TOKENS;
    const t = genParams?.temperature;
    this.temperature = typeof t === "number" && Number.isFinite(t) ? Math.min(2, Math.max(0, t)) : undefined;
  }

  cancelInFlight(): void {
    this.abortController?.abort();
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
    if ((options?.tools?.length ?? 0) > 0 && !TOOL_CAPABLE_MODELS.has(this.model)) {
      logger.warn(
        { model: this.model, toolCount: options!.tools!.length },
        "Krutrim: tools omitted — model is not tool-capable",
      );
    }

    const body: Parameters<typeof this.client.chat.completions.create>[0] & Record<string, unknown> = {
      model: this.model,
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        ...toOpenAIMessages(messages),
      ],
      ...(this.maxTokens ? { max_tokens: this.maxTokens } : {}),
      ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
      // Disable thinking for Qwen models — top-level enable_thinking is ignored
      // by Krutrim; chat_template_kwargs is the only working knob (verified 2026-07-09).
      ...(NO_THINK_MODELS.has(this.model) ? { chat_template_kwargs: { enable_thinking: false } } : {}),
    };

    if (hasTools && options?.tools) {
      body.tools = options.tools.map((t) => ({
        type: "function" as const,
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      body.tool_choice = "auto";
    }

    this.abortController?.abort();
    const abortController = new AbortController();
    this.abortController = abortController;

    const stream = await this.client.chat.completions.create(
      { ...body, stream: true },
      { timeout: REQUEST_TIMEOUT_MS, signal: abortController.signal },
    );

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

      // Safety-net: strip any residual thinking delimiters.
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
