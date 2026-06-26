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
 *   Thinking is ON BY DEFAULT. For voice agents we DISABLE it by sending
 *   `reasoning_effort: null` to keep latency low (an agent can opt back in).
 *
 * Tool calling — single STREAMING path:
 *   Sarvam-30b emits standard OpenAI-style streaming tool calls. With
 *   `stream:true`, `reasoning_effort:null` and `tool_choice:"auto"` it returns:
 *     • delta.tool_calls[0] = { index, id, function:{ name, arguments:"" } }  (first)
 *     • delta.tool_calls[0] = { index, function:{ arguments:"<fragment>" } }   (rest)
 *       — argument fragments must be CONCATENATED across chunks by index.
 *     • a chunk with finish_reason:"tool_calls"
 *     • a final chunk with empty `choices` carrying `usage`, then `data: [DONE]`.
 *   (Occasionally a whitespace-only delta.content:"\n" is interleaved — ignored.)
 *
 *   So we stream EVERYTHING — plain replies and tool turns alike — for low TTFT,
 *   accumulate tool-call fragments, and at end-of-stream fire either onToolCall
 *   (a tool was requested) or onDone (a plain text reply). Reasoning content is
 *   never forwarded to TTS.
 *
 * Streaming framing: each `data:` line is a chat.completion.chunk. SSE events can
 * split across TCP reads, so we buffer and dispatch only complete `\n`-terminated
 * lines, flushing the trailing line after the stream ends.
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

    const sanitized = sanitizeForAlternation(messages);

    const genBody = this.buildGenerationBody();

    // When tools are present, Sarvam models need their reasoning trace to decide
    // whether to call a tool vs reply conversationally. With reasoning_effort:null
    // (thinking off) the model defaults to text replies and skips tool calls.
    //
    // Model-specific budget for tool turns (agent-level override still respected):
    //   sarvam-30b  → "medium": 30b with "low" still asks for confirmation before
    //                 calling; "medium" gives enough budget to call immediately.
    //   sarvam-105b → "low":    105b with "medium" reasoning generates thousands of
    //                 reasoning tokens and produces an EMPTY final response, causing
    //                 10–15 s silent turns. 105b is powerful enough at "low" to call
    //                 tools correctly without over-reasoning.
    if (hasTools && genBody["reasoning_effort"] === null) {
      genBody["reasoning_effort"] = this.model === "sarvam-105b" ? "low" : "medium";
    }

    // Sarvam-specific tool-use injection: placed at the very top of the system
    // prompt. Without this, sarvam-30b confirms before every action even when
    // explicitly instructed not to.
    const effectiveSystemPrompt = hasTools
      ? `[TOOL USE — MANDATORY] You have tools available. Rules:\n1. When you have the caller's name, email, and time — call the tool NOW. Do NOT announce "I'll book…" first.\n2. When the caller says yes, ok, confirm, sure, or any affirmative — call the tool IMMEDIATELY. Do NOT ask any follow-up question.\n3. NEVER ask for confirmation before calling a tool. NEVER summarise what you are about to do. Just call the tool.\n\n${systemPrompt}`
      : systemPrompt;

    const body: Record<string, unknown> = {
      model: this.model,
      stream: true,
      ...genBody,
      messages: [
        { role: "system", content: effectiveSystemPrompt },
        ...toOpenAIMessages(sanitized),
      ],
    };

    // Tools are streamed too — Sarvam emits OpenAI-style delta.tool_calls fragments.
    if (hasTools && options?.tools) {
      body["tools"] = options.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      body["tool_choice"] = "auto";
    }

    const resp = await fetch("https://api.sarvam.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "api-subscription-key": this.key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Sarvam LLM error ${resp.status}: ${err}`);
    }

    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let full = "";
    let usage: LLMUsage | undefined;

    // Tool-call fragments accumulated by index. The first fragment carries id+name;
    // later fragments carry only argument string chunks that must be concatenated.
    const toolAcc = new Map<number, { id: string; name: string; args: string }>();
    let sawToolDelta = false;
    // Tracks whether any non-whitespace reply text has been forwarded, so we can
    // drop leading whitespace-only tokens (the stray "\n" artifact in tool turns)
    // without ever swallowing inter-word spaces in a real reply.
    let sawRealContent = false;

    const handleData = (data: string): void => {
      if (data === "[DONE]") return;
      try {
        const parsed = JSON.parse(data) as {
          choices: Array<{
            finish_reason?: string | null;
            delta?: {
              content?: string;
              reasoning_content?: string;
              tool_calls?: Array<{
                index?: number;
                id?: string | null;
                type?: string;
                function?: { name?: string | null; arguments?: string | null };
              }>;
            };
          }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };

        // Usage arrives on the final chunk (empty `choices`) — read it first.
        if (parsed.usage) {
          usage = {
            inputTokens: parsed.usage.prompt_tokens ?? 0,
            outputTokens: parsed.usage.completion_tokens ?? 0,
          };
        }

        const delta = parsed.choices[0]?.delta;
        if (!delta) return;

        // Accumulate streaming tool-call fragments.
        if (delta.tool_calls?.length) {
          for (const tc of delta.tool_calls) {
            const idx = typeof tc.index === "number" ? tc.index : 0;
            sawToolDelta = true;
            const cur = toolAcc.get(idx) ?? { id: "", name: "", args: "" };
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.name = tc.function.name;
            if (typeof tc.function?.arguments === "string") cur.args += tc.function.arguments;
            toolAcc.set(idx, cur);
          }
          return;
        }

        // Once a tool call is in flight, ignore any trailing content artifacts.
        if (sawToolDelta) return;

        // Only forward reply text — reasoning_content is intentionally ignored.
        let token = delta.content ?? "";
        if (!token) return;

        // Strip Sarvam thinking-mode delimiter tokens that leak into delta.content
        // when reasoning_effort is "low"/"medium"/"high". These are internal model
        // separators and must never reach TTS or the conversation history.
        token = token.replace(/<\|(?:message|thinking|endofthinking|endofmessage|im_start|im_end)\|>/g, "");
        if (!token) return;

        // Drop leading whitespace-only tokens (tool-turn "\n" artifact / trimmable
        // preamble); forward everything once real content has started.
        if (!sawRealContent && /^\s*$/.test(token)) return;

        sawRealContent = true;
        full += token;
        onToken(token);
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

    // Report usage exactly once, before the terminal callback.
    if (usage) options?.onUsage?.(usage);

    // Tool turn: dispatch the first (lowest-index) tool call that has a name.
    if (toolAcc.size > 0 && options?.onToolCall) {
      const picked = [...toolAcc.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, v]) => v)
        .find((v) => v.name);
      if (picked?.name) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(picked.args || "{}") as Record<string, unknown>;
        } catch {
          // malformed args — call with empty args
        }
        options.onToolCall(picked.name, args);
        return; // exactly one terminal callback — do NOT also call onDone
      }
    }

    // Plain text reply.
    onDone(full, usage);
  }
}
