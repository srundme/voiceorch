import type { ConversationTurn } from "../../types.js";

/**
 * Convert ConversationTurn[] to OpenAI-compatible message format.
 *
 * The pipeline stores native tool calls with structured metadata:
 *   - assistant turn with `toolCalls` = the LLM's tool invocation
 *   - tool turn with `toolCallId` + `toolName` = the result
 *
 * OpenAI-compatible APIs (OpenAI, Sarvam, Groq, Mistral, DeepSeek, Qwen, Cohere)
 * REQUIRE this exact format in follow-up calls or they return 400 / call the tool again.
 * Using plain text ("[calling tool: X]" / "[Tool result for X]: ...") causes them to
 * loop or error because they expect tool_calls on the assistant turn and a tool role
 * message with a matching tool_call_id.
 *
 * Gemini already works via its own SDK which takes the history separately, so it is
 * handled by the Google adapter instead.
 */
export function toOpenAIMessages(turns: ConversationTurn[]): any[] {
  return turns.map((m): Record<string, unknown> => {
    if (m.role === "tool") {
      return {
        role: "tool",
        tool_call_id: m.toolCallId ?? "call_unknown",
        content: m.content,
      };
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.args },
        })),
      };
    }
    return { role: m.role, content: m.content };
  });
}
