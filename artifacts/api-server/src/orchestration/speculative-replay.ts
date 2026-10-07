import type { ConversationTurn, LLMAdapter, LLMUsage } from "./types.js";

export type SpeculativeReplaySource = {
  storedTokens: string[];
  storedFullText: string;
  storedUsage?: LLMUsage;
  storedToolCall?: { name: string; args: Record<string, unknown> };
  tokenSink: (t: string) => void;
  completedPromise: Promise<void>;
};

/**
 * Replays a committed speculative LLM stream as if it were the real turn's
 * chat call. A speculative stream can still finish with a tool call after it
 * was committed; that call is handed to the real turn exactly like a live
 * adapter would, instead of completing the turn with empty text.
 */
export function speculativeReplayChat(spec: SpeculativeReplaySource): LLMAdapter["chat"] {
  return async (
    _history: ConversationTurn[],
    _systemPrompt: string,
    onToken: (t: string) => void,
    onDone: (fullText: string, usage?: LLMUsage) => void,
    opts?: Parameters<LLMAdapter["chat"]>[4],
  ) => {
    const buffered = spec.storedTokens.splice(0);
    spec.tokenSink = (t) => onToken(t);
    for (const t of buffered) onToken(t);
    await spec.completedPromise;
    if (spec.storedUsage && opts?.onUsage) opts.onUsage(spec.storedUsage);
    const call = spec.storedToolCall;
    if (call && opts?.onToolCall) {
      opts.onToolDetected?.({ format: "structured" });
      opts.onToolParsed?.({ name: call.name, format: "structured", args: call.args });
      opts.onToolCall(call.name, call.args);
      return;
    }
    onDone(spec.storedFullText);
  };
}
