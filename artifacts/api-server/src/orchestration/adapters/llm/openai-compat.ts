import type { LLMUsage, ToolDefinition } from "../../types.js";
import { parseToolEnvelope } from "./sarvam.js";

/**
 * Regex that detects a Groq/Llama-style planning preamble before a serialized
 * tool call (e.g. "I will execute the book_appointment function...").
 * When matched we switch to buffer mode so the preamble + call are not sent to TTS.
 */
const OPENAI_COMPAT_PREAMBLE_RE =
  /\b(i will|i'll|let me|i need to|i'm going to|i should|based on|i shall)\b.{0,80}(book_appointment|check_availability|transfer_to_human|cancel_appointment|reschedule_appointment|get_bookings)/i;


/**
 * Detects any tool_name(...) call embedded in streamed text so we can switch to
 * buffer mode before the call reaches TTS mid-stream.
 */
function looksLikeFunctionCallNotation(text: string, validNames: Set<string>): boolean {
  if (validNames.size === 0) return false;
  for (const name of validNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Require name( — a bare tool name in spoken text is not a call and must
    // not stall TTS until the stream ends.
    if (new RegExp(`\\b${escaped}\\s*\\(`).test(text)) return true;
  }
  return false;
}

export { looksLikeFunctionCallNotation };

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
  // When true we withhold tokens from TTS (preamble + function-call notation detected)
  let bufferMode = false;
  const validNames = new Set((options?.tools ?? []).map((t) => t.name));

  for await (const chunk of stream) {
    if (chunk.usage) {
      usage = {
        inputTokens: chunk.usage.prompt_tokens,
        outputTokens: chunk.usage.completion_tokens,
        cachedTokens: chunk.usage.prompt_tokens_details?.cached_tokens,
      };
    }

    const delta = chunk.choices?.[0]?.delta;
    if (!delta) continue;

    const token = delta.content ?? "";
    if (token) {
      full += token;
      // Switch to buffer mode if we detect a planning preamble or an inline function call
      if (!bufferMode && options?.onToolCall && validNames.size > 0) {
        if (OPENAI_COMPAT_PREAMBLE_RE.test(full) || looksLikeFunctionCallNotation(full, validNames)) {
          bufferMode = true;
        }
      }
      // Only forward to TTS when not buffering
      if (!bufferMode) onToken(token);
    }

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
  // (handles JSON, bracket, or function-call notation from Groq/Llama/Gemini etc.)
  if (!isToolCall && options?.onToolCall && options?.tools?.length) {
    const env = parseToolEnvelope(full, validNames);
    if (env) {
      options.onToolCall(env.name, env.args);
      return;
    }
  }

  onDone(full, usage);
}
