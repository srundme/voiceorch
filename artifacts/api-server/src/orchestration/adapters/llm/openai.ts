import OpenAI from "openai";
import type { ConversationTurn, LLMAdapter, LLMGenerationParams, LLMUsage, ToolDefinition } from "../../types.js";
import { toOpenAIMessages } from "./openai-messages.js";
import { drainOpenAICompatibleStream } from "./openai-compat.js";
import { logger } from "../../../lib/logger.js";

/**
 * OpenAI — streaming Responses API (stateful) with chat.completions fallback.
 *
 * Turn 1:  sends full history + `instructions` (system prompt) via responses.create().
 *          OpenAI stores the response server-side and returns a `response.id`.
 *
 * Turn N+:  sends ONLY the new user message (or function_call_output) plus
 *           `previous_response_id`.  The server reconstructs the full context
 *           — no re-transmission of conversation history.
 *
 * Expected gain vs chat.completions on a 10-turn voice call:
 *   Turn 2 saves ~(sys_prompt + turn1_tokens) ≈ 600–2 000 input tokens.
 *   Turn N saves all prior turns. For gpt-4o-mini this is ~20–60 ms TTFT/turn.
 *
 * Barge-in cancel:
 *   cancelInFlight() aborts the local stream AND calls responses.cancel() so
 *   OpenAI stops generating tokens server-side immediately (saves input+output
 *   tokens for the abandoned turn). Modelled after Bolna's OpenAIWSConnection.
 *
 * Speculative (pre-barge-in) calls always use chat.completions so a spec miss
 * does NOT advance previousResponseId and corrupt the real turn's state.
 *
 * Set OPENAI_USE_CHAT_COMPLETIONS=1 to force the legacy path (e.g. for debugging).
 *
 * compact_threshold: when set (env OPENAI_COMPACT_THRESHOLD, integer token count),
 * passed to responses.create() so OpenAI automatically compacts the stored context
 * when it exceeds that many tokens, keeping per-turn input cost bounded for long calls.
 */

const USE_RESPONSES_API = process.env.OPENAI_USE_CHAT_COMPLETIONS !== "1";

/** When set, OpenAI auto-compacts the server-side context when it exceeds this
 *  token count. Keeps per-turn input cost bounded on very long calls. */
const COMPACT_THRESHOLD = (() => {
  const v = parseInt(process.env.OPENAI_COMPACT_THRESHOLD ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : undefined;
})();

export class OpenAILLM implements LLMAdapter {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly temperature: number | undefined;

  // Stateful Responses API context — lives for the duration of one call.
  // previousResponseId: OpenAI response.id from the last completed turn.
  // pendingToolCallId:  call_id of the function_call in that response, needed
  //                     to send function_call_output in the next turn.
  private previousResponseId: string | null = null;
  private pendingToolCallId: string | null = null;

  // In-flight cancel support — set just before responses.create(), cleared after.
  private _inFlightAbort: AbortController | null = null;
  private _inFlightResponseId: string | null = null;

  constructor(apiKey: string, model: string | null, genParams?: LLMGenerationParams) {
    this.client = new OpenAI({ apiKey });
    let resolvedModel = model ?? "gpt-4.1-mini";
    if (resolvedModel === "gpt-5.1-mini" || resolvedModel === "gpt-5-mini") {
      resolvedModel = "gpt-4.1-mini";
    } else if (resolvedModel === "gpt-5.1" || resolvedModel === "gpt-5") {
      resolvedModel = "gpt-4.1";
    }
    this.model = resolvedModel;
    const t = genParams?.temperature;
    this.temperature =
      typeof t === "number" && Number.isFinite(t) ? Math.min(2, Math.max(0, t)) : undefined;
  }

  /**
   * Abort the in-flight streaming call and send a server-side response.cancel()
   * so OpenAI stops generating tokens immediately on barge-in.
   * Fire-and-forget — the caller (pipeline barge-in handler) does not await this.
   */
  cancelInFlight(): void {
    // 1. Abort the local HTTP stream so the for-await loop exits.
    if (this._inFlightAbort) {
      this._inFlightAbort.abort();
      this._inFlightAbort = null;
    }
    // 2. Server-side cancel: tell OpenAI to stop generating tokens.
    // This saves the output tokens for the abandoned turn.
    if (this._inFlightResponseId) {
      const rid = this._inFlightResponseId;
      this._inFlightResponseId = null;
      // Best-effort, fire-and-forget — we don't await or surface errors.
      this.client.responses.cancel(rid).catch((err: unknown) => {
        logger.debug({ model: this.model, responseId: rid, err: (err as any)?.message ?? err },
          "openai_responses_cancel_error (best-effort, ignored)");
      });
    }
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
      speculative?: boolean;
    },
  ): Promise<void> {
    // Speculative (pre-barge-in) calls bypass stateful history to prevent a
    // spec miss from advancing previousResponseId and corrupting turn N+1.
    if (!USE_RESPONSES_API || options?.speculative) {
      await this.chatCompletions(messages, systemPrompt, onToken, onDone, options);
      return;
    }

    try {
      await this.chatResponses(messages, systemPrompt, onToken, onDone, options);
    } catch (err: any) {
      if (err?.name === "AbortError") {
        // Barge-in cancel — not an error; caller already stopped caring about this turn.
        return;
      }
      if (this.previousResponseId) {
        // Stale / expired previousResponseId — reset and replay with full history.
        logger.warn(
          { model: this.model, err: err?.message, prev: this.previousResponseId },
          "openai_responses_stateful_miss: expired previousResponseId, replaying with full history",
        );
        this.previousResponseId = null;
        this.pendingToolCallId = null;
        await this.chatResponses(messages, systemPrompt, onToken, onDone, options);
      } else {
        throw err;
      }
    }
  }

  // ─── Responses API path ────────────────────────────────────────────────────

  private async chatResponses(
    messages: ConversationTurn[],
    systemPrompt: string,
    onToken: (token: string) => void,
    onDone: (fullText: string, usage?: LLMUsage) => void,
    options?: {
      tools?: ToolDefinition[];
      onToolCall?: (name: string, args: Record<string, unknown>) => void;
      onUsage?: (usage: LLMUsage) => void;
    },
  ): Promise<void> {
    const responsesTools = options?.tools?.length
      ? options.tools.map((t) => ({
          type: "function" as const,
          name: t.name,
          description: t.description,
          parameters: t.parameters as Record<string, unknown>,
        }))
      : undefined;

    const lastMsg = messages.length ? messages[messages.length - 1] : null;

    // Build `input` and optional `instructions` based on conversation state.
    let input: any[];
    let instructions: string | undefined;

    if (!this.previousResponseId) {
      // ── First turn (or post-reset): establish the conversation ──────────────
      // Send the full history so OpenAI can store it server-side.
      // Tool-result turns are collapsed to user messages here; in subsequent
      // turns the server already has the function call via previousResponseId.
      instructions = systemPrompt;
      input = messages.map((m): any => {
        if (m.role === "tool") {
          return {
            role: "user",
            content: `[Tool result for ${m.toolName ?? "tool"}]: ${m.content}`,
          };
        }
        if (m.role === "assistant" && m.toolCalls?.length) {
          // Emit the assistant text without the tool_calls structure; in stateful
          // mode the server owns the function-call items from turn 1 onward.
          return { role: "assistant", content: m.content || "" };
        }
        return { role: m.role, content: m.content };
      });
    } else if (lastMsg?.role === "tool" && this.pendingToolCallId) {
      // ── Tool-result continuation ─────────────────────────────────────────────
      // Server already has the function_call in previousResponseId; provide output.
      input = [
        {
          type: "function_call_output",
          call_id: this.pendingToolCallId,
          output: lastMsg.content,
        },
      ];
    } else if (lastMsg) {
      // ── Normal stateful turn: only the new user message ──────────────────────
      // This is the common case and delivers the full latency/cost benefit.
      input = [{ role: lastMsg.role, content: lastMsg.content }];
    } else {
      input = [{ role: "user", content: "Hello" }];
    }

    const createParams: any = {
      model: this.model,
      input,
      stream: true,
      ...(instructions !== undefined ? { instructions } : {}),
      ...(this.previousResponseId ? { previous_response_id: this.previousResponseId } : {}),
      ...(responsesTools ? { tools: responsesTools, tool_choice: "auto" } : {}),
      // Float → integer coercion: the Responses API rejects float temperatures
      // (e.g. 0.7 → 400). Round to 1 decimal to keep control while satisfying the API.
      ...(this.temperature !== undefined
        ? { temperature: Math.round(this.temperature * 10) / 10 }
        : {}),
      // compact_threshold: when set, OpenAI automatically compacts the server-side
      // context when it exceeds this token count, bounding per-turn input cost on
      // very long calls. Modelled after Bolna's compact_threshold param.
      ...(COMPACT_THRESHOLD ? { compact_threshold: COMPACT_THRESHOLD } : {}),
    };

    // Set up AbortController so cancelInFlight() can abort this stream.
    const abort = new AbortController();
    this._inFlightAbort = abort;

    let stream: AsyncIterable<any>;
    try {
      stream = (await this.client.responses.create(createParams, {
        signal: abort.signal,
      })) as unknown as AsyncIterable<any>;
    } catch (err: any) {
      this._inFlightAbort = null;
      logger.warn({ model: this.model, err: err?.message }, "OpenAI responses.create failed, falling back to chat.completions");
      return this.chatCompletions(messages, systemPrompt, onToken, onDone, options);
    }

    let full = "";
    let toolCallName = "";
    let toolCallArgs = "";
    let isToolCall = false;
    let usage: LLMUsage | undefined;
    let newResponseId: string | null = null;
    let newToolCallId: string | null = null;

    try {
      for await (const event of stream) {
        // Track the response ID as soon as it's available so cancelInFlight()
        // can send a server-side cancel even if the stream is mid-flight.
        if (!this._inFlightResponseId && event.type === "response.created") {
          this._inFlightResponseId = (event.response as any)?.id ?? null;
        }

        switch (event.type as string) {
          case "response.output_text.delta": {
            const delta = (event.delta as string) ?? "";
            if (delta) {
              full += delta;
              onToken(delta);
            }
            break;
          }
          case "response.function_call_arguments.delta":
            isToolCall = true;
            toolCallArgs += (event.delta as string) ?? "";
            break;
          case "response.function_call_arguments.done":
            isToolCall = true;
            if (!toolCallName) toolCallName = (event.name as string) ?? "";
            if (!toolCallArgs) toolCallArgs = (event.arguments as string) ?? "";
            break;
          case "response.completed": {
            const response = event.response as any;
            newResponseId = response?.id ?? null;
            if (response?.usage) {
              usage = {
                inputTokens: response.usage.input_tokens ?? 0,
                outputTokens: response.usage.output_tokens ?? 0,
                cachedTokens: response.usage.input_tokens_details?.cached_tokens,
              };
            }
            // Log service tier for latency diagnosis (mirrors Bolna's service_tier tracking).
            if (response?.service_tier && response.service_tier !== "default") {
              logger.info({ model: this.model, service_tier: response.service_tier },
                "openai_responses_service_tier");
            }
            // Extract call_id for the next function_call_output (tool continuation).
            if (isToolCall && response?.output) {
              const fnItem = (response.output as any[]).find(
                (it: any) => it.type === "function_call",
              );
              newToolCallId = fnItem?.call_id ?? null;
            }
            break;
          }
          default:
            break;
        }
      }
    } finally {
      // Always clear the AbortController and in-flight response ID once the
      // stream has finished (normally or via abort).
      this._inFlightAbort = null;
      this._inFlightResponseId = null;
    }

    // Advance stateful context only after a clean stream completion.
    if (newResponseId) this.previousResponseId = newResponseId;
    if (isToolCall) this.pendingToolCallId = newToolCallId;

    if (usage) options?.onUsage?.(usage);

    if (isToolCall && toolCallName && options?.onToolCall) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(toolCallArgs || "{}") as Record<string, unknown>;
      } catch {
        /* keep {} on malformed args */
      }
      options.onToolCall(toolCallName, args);
    } else {
      onDone(full, usage);
    }
  }

  // ─── Legacy chat.completions path (speculative calls + OPENAI_USE_CHAT_COMPLETIONS=1) ──

  private async chatCompletions(
    messages: ConversationTurn[],
    systemPrompt: string,
    onToken: (token: string) => void,
    onDone: (fullText: string, usage?: LLMUsage) => void,
    options?: {
      tools?: ToolDefinition[];
      onToolCall?: (name: string, args: Record<string, unknown>) => void;
      onUsage?: (usage: LLMUsage) => void;
    },
  ): Promise<void> {
    const openAiTools = options?.tools?.length
      ? options.tools.map((t) => ({
          type: "function" as const,
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }))
      : undefined;

    const stream = await this.client.chat.completions.create({
      model: this.model,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: "system", content: systemPrompt },
        ...toOpenAIMessages(messages),
      ] as any,
      ...(openAiTools ? { tools: openAiTools, tool_choice: "auto" } : {}),
      ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
    });

    await drainOpenAICompatibleStream(stream as any, onToken, onDone, options);
  }
}
