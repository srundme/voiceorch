import type { ConversationTurn, LLMAdapter, LLMGenerationParams, LLMUsage, ToolDefinition } from "../../types.js";

/**
 * Convert ConversationTurn[] to Anthropic's message format.
 * Tool results use Anthropic's `tool_result` content block (nested inside a user turn).
 * Assistant tool invocations use Anthropic's `tool_use` content block.
 */
function toAnthropicMessages(turns: ConversationTurn[]): Record<string, unknown>[] {
  return turns.map((m): Record<string, unknown> => {
    if (m.role === "tool") {
      return {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: m.toolCallId ?? "unknown",
            content: m.content,
          },
        ],
      };
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant",
        content: [
          ...(m.content ? [{ type: "text", text: m.content }] : []),
          ...m.toolCalls.map((tc) => ({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: (() => {
              try { return JSON.parse(tc.args || "{}") as Record<string, unknown>; } catch { return {}; }
            })(),
          })),
        ],
      };
    }
    return { role: m.role, content: m.content };
  });
}

/**
 * Anthropic Claude — native Messages API with SSE streaming
 * Models: claude-opus-4-5, claude-3-5-sonnet-20241022, claude-3-5-haiku-20241022
 * Endpoint: https://api.anthropic.com/v1/messages
 */

const DEFAULT_MODEL = "claude-3-5-haiku-20241022";
const API_URL = "https://api.anthropic.com/v1/messages";

interface AnthropicStreamEvent {
  type: string;
  index?: number;
  delta?: { type: string; text?: string; partial_json?: string };
  content_block?: { type: string; name?: string };
  message?: { usage?: { input_tokens?: number; output_tokens?: number } };
  usage?: { input_tokens?: number; output_tokens?: number };
}

export class AnthropicLLM implements LLMAdapter {
  private key: string;
  private model: string;
  // Anthropic's Messages API accepts temperature in the range 0–1 (unlike the
  // shared 0–2 UI slider), so clamp down rather than passing 0–2 through.
  private temperature: number | undefined;
  private maxTokens: number | undefined;
  private abortController: AbortController | null = null;

  constructor(apiKey: string, model: string | null, genParams?: LLMGenerationParams) {
    this.key = apiKey;
    this.model = model ?? DEFAULT_MODEL;
    const t = genParams?.temperature;
    this.temperature = typeof t === "number" && Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : undefined;
    // Honor the agent's configured llmMaxTokens (was hardcoded to 1024 and
    // silently ignored the setting — the only adapter that did).
    const mt = genParams?.maxTokens;
    this.maxTokens = typeof mt === "number" && Number.isFinite(mt) && mt > 0 ? Math.floor(mt) : undefined;
  }

  cancelInFlight(): void {
    this.abortController?.abort();
    this.abortController = null;
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
      kvCache?: boolean;
    }
  ): Promise<void> {
    const useKvCache = options?.kvCache === true;

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: this.maxTokens ?? 1024,
      // Use block format to allow cache_control when KV cache is enabled
      system: useKvCache
        ? [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }]
        : systemPrompt,
      messages: toAnthropicMessages(messages),
      stream: true,
      ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
    };

    if (options?.tools?.length) {
      body.tools = options.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    const headers: Record<string, string> = {
      "x-api-key": this.key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    };
    if (useKvCache) {
      headers["anthropic-beta"] = "prompt-caching-2024-07-31";
    }

    this.abortController?.abort();
    const abortController = new AbortController();
    this.abortController = abortController;

    try {
      const resp = await fetch(API_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: abortController.signal,
      });

      if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${await resp.text()}`);
      if (!resp.body) throw new Error("Anthropic: no response body");

      let full = "";
      let toolName = "";
      let toolJson = "";
      let inToolUse = false;
      let inputTokens = 0;
      let outputTokens = 0;

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (!raw || raw === "[DONE]") continue;
            let ev: AnthropicStreamEvent;
            try { ev = JSON.parse(raw) as AnthropicStreamEvent; } catch { continue; }

            // message_start carries the initial input token count
            if (ev.type === "message_start" && ev.message?.usage) {
              inputTokens = ev.message.usage.input_tokens ?? 0;
            }

            // message_delta carries the final output token count
            if (ev.type === "message_delta" && ev.usage) {
              outputTokens = ev.usage.output_tokens ?? 0;
            }

            if (ev.type === "content_block_start" && ev.content_block?.type === "tool_use") {
              inToolUse = true;
              toolName = ev.content_block.name ?? "";
            }

            if (ev.type === "content_block_delta") {
              if (ev.delta?.type === "text_delta" && ev.delta.text) {
                full += ev.delta.text;
                onToken(ev.delta.text);
              }
              if (ev.delta?.type === "input_json_delta" && ev.delta.partial_json) {
                toolJson += ev.delta.partial_json;
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      const usage: LLMUsage | undefined = (inputTokens > 0 || outputTokens > 0)
        ? { inputTokens, outputTokens }
        : undefined;

      if (usage) options?.onUsage?.(usage);

      if (inToolUse && toolName && options?.onToolCall) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(toolJson || "{}") as Record<string, unknown>; } catch { /* ignore */ }
        options.onToolCall(toolName, args);
      } else {
        onDone(full, usage);
      }
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
}
