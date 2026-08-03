import type { LLMUsage, ToolDefinition } from "../../types.js";
import { parseToolEnvelope } from "./sarvam.js";

/**
 * Shared streaming-loop for all OpenAI-compatible LLM adapters.
 *
 * Every provider that uses the OpenAI Chat Completions streaming protocol
 * (openai, groq, deepseek, mistral, cohere, qwen, openrouter, together, ...)
 * has the same drain loop: accumulate usage, forward text tokens, assemble
 * tool-call fragments, then dispatch onToolCall or onDone.
 *
 * Usage:
 *   const stream = await this.client.chat.completions.create({ ..., stream: true });
 *   await drainOpenAICompatibleStream(stream, onToken, onDone, options);
 *
 * The `options` shape is intentionally compatible with the `options?` parameter
 * each adapter already exposes on its `chat()` method — pass it through directly.
 */
export async function drainOpenAICompatibleStream(
  stream: AsyncIterable<{
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
      prompt_tokens_details?: { cached_tokens?: number };
    };
    choices?: Array<{
      delta?: {
        content?: string | null;
        tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
      };
    }>;
  }>,
  onToken: (token: string) => void,
  onDone: (fullText: string, usage?: LLMUsage) => void,
  options?: {
    tools?: ToolDefinition[];
    onToolCall?: (name: string, args: Record<string, unknown>) => void;
    onUsage?: (usage: LLMUsage) => void;
  },
): Promise<void> {
  let full = "";
  let toolCallName = "";
  let toolCallArgs = "";
  let isToolCall = false;
  let usage: LLMUsage | undefined;

  for await (const chunk of stream) {
    if (chunk.usage) {
      usage = {
        inputTokens: chunk.usage.prompt_tokens,
        outputTokens: chunk.usage.completion_tokens,
        // OpenAI and some compatible providers report prompt-cache hits here.
        // Undefined for providers that don't surface it — that's fine, the
        // pipeline log falls through to "no cache info" silently.
        cachedTokens: chunk.usage.prompt_tokens_details?.cached_tokens,
      };
    }

    const delta = chunk.choices?.[0]?.delta;
    if (!delta) continue;

    const token = delta.content ?? "";
    if (token) { full += token; onToken(token); }

    if (delta.tool_calls) {
      isToolCall = true;
      for (const tc of delta.tool_calls) {
        if (tc.function?.name) toolCallName += tc.function.name;
        if (tc.function?.arguments) toolCallArgs += tc.function.arguments;
      }
    }
  }

  if (usage) options?.onUsage?.(usage);

  if (isToolCall && toolCallName && options?.onToolCall) {
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(toolCallArgs || "{}") as Record<string, unknown>; } catch { /* keep {} on malformed */ }
    options.onToolCall(toolCallName, args);
    return;
  }

  // Fallback: Check if the text output contains a serialized text-envelope tool call
  if (!isToolCall && options?.onToolCall && options?.tools?.length) {
    const validNames = new Set(options.tools.map((t) => t.name));
    const env = parseToolEnvelope(full, validNames);
    if (env) {
      options.onToolCall(env.name, env.args);
      return;
    }
  }

  onDone(full, usage);
}
