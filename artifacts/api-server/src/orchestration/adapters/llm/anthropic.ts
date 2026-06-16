import type { ConversationTurn, LLMAdapter, LLMUsage, ToolDefinition } from "../../types.js";

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

  constructor(apiKey: string, model: string | null) {
    this.key = apiKey;
    this.model = model ?? DEFAULT_MODEL;
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
      max_tokens: 1024,
      // Use block format to allow cache_control when KV cache is enabled
      system: useKvCache
        ? [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }]
        : systemPrompt,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
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

    const resp = await fetch(API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
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
  }
}
