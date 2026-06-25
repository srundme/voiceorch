import type { ConversationTurn, LLMAdapter, LLMGenerationParams, LLMUsage, ToolDefinition } from "../../types.js";
import { toOpenAIMessages } from "./openai-messages.js";

/**
 * Sarvam AI — Chat Completions (OpenAI-compatible endpoint)
 * Docs: https://docs.sarvam.ai/api-reference-docs/chat-completion/overview
 *
 * Models:
 *   - sarvam-30b  (default) — 64K context, lower latency / faster TTFT, best for voice agents
 *   - sarvam-105b           — 128K context, highest quality (higher latency)
 *   (sarvam-m / 24B is deprecated — aliased to sarvam-30b below.)
 *
 * Endpoint: POST https://api.sarvam.ai/v1/chat/completions
 * Auth: `api-subscription-key` header (also accepts `Authorization: Bearer <key>`).
 *
 * Hybrid Thinking Mode:
 *   Thinking is ON BY DEFAULT (reasoning_effort="low"). When enabled the model
 *   streams `reasoning_content` BEFORE the reply `content`, which:
 *     - adds latency before the first spoken word,
 *     - is billed as completion tokens, and
 *     - can consume the whole max_tokens budget on short replies, leaving an
 *       empty `content` with finish_reason "length".
 *   For a voice agent we want low latency, so we DISABLE thinking by sending
 *   `reasoning_effort: null` (the documented way to turn it off). We also never
 *   forward `reasoning_content` to TTS even if some leaks through.
 *
 * Tool calling: supported on sarvam-30b and sarvam-105b. Wire format is identical
 * to OpenAI (function name + stringified JSON arguments).
 *
 * Streaming: each `data:` line is a chat.completion.chunk. `delta.content` carries
 * the reply text; the final chunk has an empty `choices` array and carries `usage`;
 * the stream ends with `data: [DONE]`.
 */

/** Models that support Sarvam's function-calling interface */
const TOOL_CAPABLE_MODELS = new Set(["sarvam-30b", "sarvam-105b"]);

/**
 * Sarvam requires strictly-alternating user/assistant turns starting with a user message.
 * This function collapses any consecutive same-role messages by joining their content,
 * then drops any leading assistant turns.
 *
 * Tool-related turns (role="tool", or role="assistant" with toolCalls) carry structured
 * metadata that must be preserved — they are never merged with adjacent turns.
 */
function sanitizeForAlternation(messages: ConversationTurn[]): ConversationTurn[] {
  if (messages.length === 0) return messages;

  const isToolRelated = (m: ConversationTurn) =>
    m.role === "tool" || (m.role === "assistant" && (m.toolCalls?.length ?? 0) > 0);

  // Merge consecutive same-role turns, but never merge tool-related turns
  const merged: ConversationTurn[] = [];
  for (const msg of messages) {
    const last = merged[merged.length - 1];
    if (!isToolRelated(msg) && last && !isToolRelated(last) && last.role === msg.role) {
      merged[merged.length - 1] = { role: last.role, content: `${last.content}\n${msg.content}` };
    } else {
      merged.push({ ...msg });
    }
  }

  // Drop any leading non-user messages (must start with user)
  while (merged.length > 0 && merged[0]!.role !== "user") {
    merged.shift();
  }

  return merged;
}

export class SarvamLLM implements LLMAdapter {
  private key: string;
  private model: string;
  private genParams: LLMGenerationParams;

  constructor(apiKey: string, model: string | null, genParams?: LLMGenerationParams) {
    this.key = apiKey;
    this.genParams = genParams ?? {};
    // Map legacy/deprecated model names to current equivalents
    const ALIASES: Record<string, string> = {
      "sarvam-m":        "sarvam-30b",
      "sarvam-2b":       "sarvam-30b",
      "sarvam-2b-v0.5":  "sarvam-30b",
      "sarvam-m1":       "sarvam-30b",
    };
    const raw = model ?? "sarvam-30b";
    this.model = ALIASES[raw] ?? raw;
  }

  /**
   * Map the resolved generation params onto Sarvam's documented request fields,
   * clamping each to its valid range and including it ONLY when explicitly set,
   * so an unset param falls back to Sarvam's own default.
   *
   * `reasoning_effort` is the one exception: it always defaults to `null`
   * (Hybrid Thinking disabled) for low-latency voice, unless the agent has
   * explicitly overridden it to "low" | "medium" | "high" | null.
   */
  private buildGenerationBody(): Record<string, unknown> {
    const p = this.genParams;
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    const body: Record<string, unknown> = {
      reasoning_effort: p.reasoningEffort === undefined ? null : p.reasoningEffort,
    };

    if (typeof p.temperature === "number" && Number.isFinite(p.temperature))
      body["temperature"] = clamp(p.temperature, 0, 2);
    if (typeof p.topP === "number" && Number.isFinite(p.topP))
      body["top_p"] = clamp(p.topP, 0, 1);
    if (typeof p.maxTokens === "number" && Number.isFinite(p.maxTokens) && p.maxTokens > 0)
      body["max_tokens"] = Math.floor(p.maxTokens);
    if (typeof p.presencePenalty === "number" && Number.isFinite(p.presencePenalty))
      body["presence_penalty"] = clamp(p.presencePenalty, -2, 2);
    if (typeof p.frequencyPenalty === "number" && Number.isFinite(p.frequencyPenalty))
      body["frequency_penalty"] = clamp(p.frequencyPenalty, -2, 2);
    if (typeof p.seed === "number" && Number.isFinite(p.seed))
      body["seed"] = Math.trunc(p.seed);
    if (typeof p.wikiGrounding === "boolean")
      body["wiki_grounding"] = p.wikiGrounding;

    // stop: a single non-empty string, or up to 4 non-empty strings.
    if (typeof p.stop === "string" && p.stop.length > 0) {
      body["stop"] = p.stop;
    } else if (Array.isArray(p.stop)) {
      const stops = p.stop.filter((s) => typeof s === "string" && s.length > 0).slice(0, 4);
      if (stops.length > 0) body["stop"] = stops;
    }

    return body;
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
    // Only sarvam-30b and sarvam-105b support tool use
    const supportsTools = TOOL_CAPABLE_MODELS.has(this.model);
    const sarvamTools = supportsTools && options?.tools?.length
      ? options.tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        }))
      : undefined;

    // Sarvam enforces strict user/assistant alternation starting with a user message.
    // Merge any consecutive same-role turns before sending.
    const sanitized = sanitizeForAlternation(messages);

    const resp = await fetch("https://api.sarvam.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "api-subscription-key": this.key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        stream: true,
        // Generation params (temperature/top_p/penalties/seed/stop/max_tokens/
        // wiki_grounding) resolved from agent config. Also supplies
        // reasoning_effort, which defaults to null (Hybrid Thinking disabled) for
        // low-latency voice — avoiding reasoning_content latency/cost and the
        // empty-content-on-short-reply trap — unless explicitly overridden.
        ...this.buildGenerationBody(),
        messages: [
          { role: "system", content: systemPrompt },
          ...toOpenAIMessages(sanitized),
        ],
        ...(sarvamTools ? { tools: sarvamTools, tool_choice: "auto" } : {}),
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Sarvam LLM error ${resp.status}: ${err}`);
    }

    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let full = "";
    let toolCallName = "";
    let toolCallArgs = "";
    let isToolCall = false;
    let usage: LLMUsage | undefined;

    // Process a single complete `data: ...` SSE payload. Mutates the closure
    // accumulators above. Kept as a closure so the buffered reader and the
    // end-of-stream flush share one parse path.
    const handleData = (data: string): void => {
      if (data === "[DONE]") return;
      try {
        const parsed = JSON.parse(data) as {
          choices: Array<{
            delta?: {
              content?: string;
              // Thinking tokens — deliberately NOT spoken. Typed only for honesty;
              // we never forward it to onToken/TTS.
              reasoning_content?: string;
              tool_calls?: Array<{
                function?: { name?: string; arguments?: string };
              }>;
            };
          }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };

        // The final chunk has an empty `choices` array and carries usage.
        if (parsed.usage) {
          usage = {
            inputTokens: parsed.usage.prompt_tokens ?? 0,
            outputTokens: parsed.usage.completion_tokens ?? 0,
          };
        }

        const delta = parsed.choices[0]?.delta;
        if (!delta) return;

        // Only the reply text is spoken — reasoning_content is intentionally ignored.
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
      } catch {
        // skip malformed chunk
      }
    };

    // Buffered SSE parse: events can split across TCP reads, so accumulate text
    // and only dispatch complete lines, keeping any partial remainder for the
    // next read. This protects token capture, tool-call args, and the final
    // usage chunk from being lost on chunk boundaries.
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line.startsWith("data: ")) handleData(line.slice(6));
      }
    }

    // Flush any trailing buffered line left without a final newline.
    buffer += decoder.decode();
    const tail = buffer.trim();
    if (tail.startsWith("data: ")) handleData(tail.slice(6));

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
