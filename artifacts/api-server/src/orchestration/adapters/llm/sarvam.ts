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
 *   Thinking is ON BY DEFAULT. For voice agent conversational turns we DISABLE it
 *   by sending `reasoning_effort: null` to keep latency low.
 *   For tool turns we send `reasoning_effort: null` too — the native tool_calls API
 *   works without thinking when we use the non-streaming path (see below).
 *
 * Tool calling — non-streaming path:
 *   Sarvam-30b's streaming SSE does NOT reliably emit `delta.tool_calls`:
 *   - With reasoning_effort:null → model skips tool dispatch, emits canned text.
 *   - With reasoning_effort:"low" → model generates correct JSON args but writes
 *     them to delta.content as bare JSON (no tool name) — TTS reads them aloud.
 *
 *   The non-streaming API works correctly per the official docs:
 *   POST with stream:false → finish_reason:"tool_calls" + message.tool_calls[].
 *
 *   Strategy:
 *     • hasTools=true  → non-streaming request; parse message.tool_calls.
 *     • hasTools=false → streaming request; low-latency TTFT as before.
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

  const merged: ConversationTurn[] = [];
  for (const msg of messages) {
    const last = merged[merged.length - 1];
    if (!isToolRelated(msg) && last && !isToolRelated(last) && last.role === msg.role) {
      merged[merged.length - 1] = { role: last.role, content: `${last.content}\n${msg.content}` };
    } else {
      merged.push({ ...msg });
    }
  }

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
   * Build Sarvam generation parameters.
   * reasoning_effort defaults to null (thinking OFF) for voice latency.
   * Agent-level reasoningEffort config overrides this.
   */
  private buildGenerationBody(): Record<string, unknown> {
    const p = this.genParams;
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

    const reasoningEffort: unknown = p.reasoningEffort !== undefined ? p.reasoningEffort : null;
    const body: Record<string, unknown> = { reasoning_effort: reasoningEffort };

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

    if (typeof p.stop === "string" && p.stop.length > 0) {
      body["stop"] = p.stop;
    } else if (Array.isArray(p.stop)) {
      const stops = p.stop.filter((s) => typeof s === "string" && s.length > 0).slice(0, 4);
      if (stops.length > 0) body["stop"] = stops;
    }

    return body;
  }

  /**
   * Non-streaming tool-call path.
   *
   * Sarvam's streaming SSE doesn't reliably emit delta.tool_calls.
   * The non-streaming API returns finish_reason:"tool_calls" and
   * message.tool_calls[] correctly per the official docs.
   *
   * We use stream:false here and call options.onToolCall when a tool
   * call is detected, or onToken+onDone for a plain text reply.
   */
  private async chatWithTools(
    messages: ConversationTurn[],
    systemPrompt: string,
    onToken: (token: string) => void,
    onDone: (fullText: string, usage?: LLMUsage) => void,
    options: {
      tools: ToolDefinition[];
      onToolCall?: (name: string, args: Record<string, unknown>) => void;
      onUsage?: (usage: LLMUsage) => void;
    }
  ): Promise<void> {
    const sanitized = sanitizeForAlternation(messages);

    // Build tool definitions in the OpenAI/Sarvam format
    const toolDefs = options.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const resp = await fetch("https://api.sarvam.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "api-subscription-key": this.key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        ...this.buildGenerationBody(),
        messages: [
          { role: "system", content: systemPrompt },
          ...toOpenAIMessages(sanitized),
        ],
        tools: toolDefs,
        tool_choice: "auto",
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Sarvam LLM error ${resp.status}: ${err}`);
    }

    const json = await resp.json() as {
      choices: Array<{
        finish_reason: string;
        message: {
          role: string;
          content: string | null;
          tool_calls?: Array<{
            id: string;
            type: string;
            function: { name: string; arguments: string };
          }>;
        };
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const usage: LLMUsage | undefined = json.usage
      ? { inputTokens: json.usage.prompt_tokens ?? 0, outputTokens: json.usage.completion_tokens ?? 0 }
      : undefined;

    if (usage) options.onUsage?.(usage);

    const choice = json.choices[0];
    if (!choice) {
      onDone("", usage);
      return;
    }

    // Tool call: finish_reason is "tool_calls" and message.tool_calls is populated
    if (
      choice.finish_reason === "tool_calls" &&
      choice.message.tool_calls?.length &&
      options.onToolCall
    ) {
      const tc = choice.message.tool_calls[0]!;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        // malformed args — call with empty args
      }
      options.onToolCall(tc.function.name, args);
      return; // do NOT call onDone — pipeline expects either onToolCall or onDone, not both
    }

    // Plain text reply (model chose not to call a tool)
    const text = choice.message.content ?? "";
    if (text) onToken(text);
    onDone(text, usage);
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
    const supportsTools = TOOL_CAPABLE_MODELS.has(this.model);
    const hasTools = supportsTools && (options?.tools?.length ?? 0) > 0;

    // ── Tool turns: use non-streaming so message.tool_calls is populated ──────
    // Sarvam's streaming SSE does not reliably emit delta.tool_calls.
    // The non-streaming API returns finish_reason:"tool_calls" + message.tool_calls
    // correctly per the official Sarvam docs.
    if (hasTools && options?.tools) {
      return this.chatWithTools(messages, systemPrompt, onToken, onDone, {
        tools: options.tools,
        onToolCall: options.onToolCall,
        onUsage: options.onUsage,
      });
    }

    // ── Conversational turns: streaming for low-latency TTFT ─────────────────
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
        ...this.buildGenerationBody(),
        messages: [
          { role: "system", content: systemPrompt },
          ...toOpenAIMessages(sanitized),
        ],
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Sarvam LLM error ${resp.status}: ${err}`);
    }

    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let full = "";
    let usage: LLMUsage | undefined;

    const handleData = (data: string): void => {
      if (data === "[DONE]") return;
      try {
        const parsed = JSON.parse(data) as {
          choices: Array<{
            delta?: {
              content?: string;
              reasoning_content?: string;
            };
          }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };

        if (parsed.usage) {
          usage = {
            inputTokens: parsed.usage.prompt_tokens ?? 0,
            outputTokens: parsed.usage.completion_tokens ?? 0,
          };
        }

        const delta = parsed.choices[0]?.delta;
        if (!delta) return;

        // Only forward reply text — reasoning_content is intentionally ignored.
        const token = delta.content ?? "";
        if (token) {
          full += token;
          onToken(token);
        }
      } catch {
        // skip malformed chunk
      }
    };

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

    buffer += decoder.decode();
    const tail = buffer.trim();
    if (tail.startsWith("data: ")) handleData(tail.slice(6));

    if (usage) options?.onUsage?.(usage);
    onDone(full, usage);
  }
}
