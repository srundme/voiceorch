import type { ConversationTurn, LLMAdapter, LLMGenerationParams, LLMUsage, ToolDefinition } from "../../types.js";
import { toOpenAIMessages } from "./openai-messages.js";
import { logger } from "../../../lib/logger.js";

/**
 * Gated raw-SSE diagnostic flag (OFF by default). When SARVAM_RAW_SSE_DEBUG is
 * "1" or "true", the adapter emits a single structured record each time the
 * buffer-and-sniff path resolves a tool call that Sarvam streamed as JSON text
 * in delta.content (instead of structured delta.tool_calls). Read dynamically so
 * the flag can be toggled without a code change. Behaviour is otherwise unchanged.
 */
function rawSseDebugEnabled(): boolean {
  const v = process.env.SARVAM_RAW_SSE_DEBUG;
  return v === "1" || v === "true";
}

/** Max chars of the withheld content buffer to include in a diagnostic record. */
const RAW_SSE_DIAG_MAX_BUFFER = 2000;

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
 * Tool calling — STREAMING with a buffered fallback (Sarvam is unreliable here):
 *   The PRIMARY path is standard OpenAI-style streaming tool calls. With
 *   `stream:true` and `tool_choice:"auto"` Sarvam may return:
 *     • delta.tool_calls[0] = { index, id, function:{ name, arguments:"" } }  (first)
 *     • delta.tool_calls[0] = { index, function:{ arguments:"<fragment>" } }   (rest)
 *       — argument fragments must be CONCATENATED across chunks by index.
 *     • a chunk with finish_reason:"tool_calls"
 *     • a final chunk with empty `choices` carrying `usage`, then `data: [DONE]`.
 *     (Occasionally a whitespace-only delta.content:"\n" is interleaved — ignored.)
 *
 *   BUT Sarvam's streaming endpoint is unreliable: it INTERMITTENTLY emits the
 *   tool call as a plain-text JSON blob inside `delta.content` (e.g.
 *   `{ "name": "transfer_to_human", "arguments": { … } }`, optionally wrapped in a
 *   ```json fence) instead of structured delta.tool_calls. If that text were
 *   forwarded to TTS the caller would HEAR the raw JSON. So when tools are enabled
 *   we buffer-and-sniff: if the first non-whitespace reply content begins with `{`
 *   or a code fence, we WITHHOLD all content from onToken/TTS and resolve it at
 *   end-of-stream — parse it as a tool call (→ onToolCall) or, if parsing fails,
 *   treat it as genuine text (→ onDone) so it is never silently dropped.
 *
 *   So we stream plain replies (not starting with `{`/fence) for low TTFT, while
 *   accumulating either structured tool-call fragments OR a possible serialized
 *   tool-call buffer, and at end-of-stream fire exactly one of onToolCall (a tool
 *   was requested) or onDone (a plain text reply). Reasoning content is never
 *   forwarded to TTS.
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

/**
 * Parse a serialized tool call that Sarvam emitted as plain JSON text in
 * delta.content (instead of structured delta.tool_calls). Tolerates an optional
 * ```json (or plain ```) fence and an `arguments` value that is itself a JSON
 * string. Returns null when the text is not a well-formed tool call — the caller
 * then treats the buffer as genuine reply text rather than dropping it.
 *
 * Sarvam does not commit to a single envelope shape. As well as the canonical
 * OpenAI form `{"name": "...", "arguments": {...}}` it also emits variants like
 * `{"tool": "transfer_to_human", "reason": "..."}` — the tool name under `tool`
 * (also seen: `function`/`action`) and the args spread as bare top-level keys
 * with no `arguments` wrapper. We recognise the name under any of these keys and
 * derive args from `arguments`/`parameters`/`args` when present, otherwise from
 * the remaining top-level keys.
 */
const TOOL_NAME_KEYS = ["name", "tool", "function", "action", "tool_name"] as const;
const TOOL_ARGS_KEYS = ["arguments", "parameters", "args", "input"] as const;

function parseSerializedToolCall(
  raw: string,
): { name: string; args: Record<string, unknown> } | null {
  let text = raw.trim();
  // Strip an optional ```json … ``` (or bare ```) fence.
  if (text.startsWith("```")) {
    text = text.replace(/^```[a-zA-Z]*\s*/, "").replace(/```\s*$/, "").trim();
  }
  if (!text.startsWith("{")) return null;

  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;

  const rec = obj as Record<string, unknown>;

  // Resolve the tool name under any of the keys Sarvam is known to use.
  let name: string | null = null;
  let nameKey: string | null = null;
  for (const k of TOOL_NAME_KEYS) {
    const v = rec[k];
    if (typeof v === "string" && v.length > 0) {
      name = v;
      nameKey = k;
      break;
    }
  }
  if (!name) return null;

  // Resolve args from an explicit wrapper key if present.
  let args: Record<string, unknown> = {};
  let argsResolved = false;
  let argsKey: string | null = null;
  for (const k of TOOL_ARGS_KEYS) {
    const rawArgs = rec[k];
    if (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)) {
      args = rawArgs as Record<string, unknown>;
      argsResolved = true;
      argsKey = k;
      break;
    }
    if (typeof rawArgs === "string" && rawArgs.trim().length > 0) {
      try {
        const parsedArgs = JSON.parse(rawArgs);
        if (parsedArgs && typeof parsedArgs === "object" && !Array.isArray(parsedArgs)) {
          args = parsedArgs as Record<string, unknown>;
          argsResolved = true;
          argsKey = k;
          break;
        }
      } catch {
        // malformed nested JSON — keep looking / fall through to bare-keys path
      }
    }
  }

  // No explicit args wrapper: treat the remaining top-level keys (e.g. `reason`)
  // as the args object so envelopes like {"tool": "...", "reason": "..."} carry
  // their payload through to the executor.
  if (!argsResolved) {
    const rest: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) {
      if (k === nameKey || k === argsKey) continue;
      rest[k] = v;
    }
    args = rest;
  }

  return { name, args };
}

/**
 * Parse a serialized tool call that Sarvam emitted as a BRACKET / key-value text
 * envelope in delta.content instead of structured delta.tool_calls or a JSON
 * blob. Observed shape (production Call #945):
 *
 *   [transfer_to_human]
 *   reason: Caller requested connection to a senior executive
 *
 * The tool name is the bracketed token on the first line; any following
 * `key: value` (or `key = value`) lines become the args. If there is residual
 * text after the bracket but no key:value pairs are found, the whole remainder
 * is captured under `reason` so the payload still reaches the executor. Returns
 * null when the text is not a bracket envelope.
 */
function parseBracketToolCall(
  raw: string,
): { name: string; args: Record<string, unknown> } | null {
  let text = raw.trim();
  // Strip an optional ```…``` fence in case the model wrapped the bracket form.
  if (text.startsWith("```")) {
    text = text.replace(/^```[a-zA-Z]*\s*/, "").replace(/```\s*$/, "").trim();
  }
  const m = /^\[\s*([a-zA-Z][a-zA-Z0-9_-]*)\s*\]/.exec(text);
  if (!m || !m[1]) return null;
  const name = m[1];

  const rest = text.slice(m[0].length).trim();
  const args: Record<string, unknown> = {};
  if (rest) {
    for (const line of rest.split(/\r?\n/)) {
      const kv = /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*[:=]\s*(.*)$/.exec(line);
      if (kv && kv[1]) args[kv[1]] = (kv[2] ?? "").trim();
    }
    // No structured key:value lines — keep the residual text as the reason so a
    // bare `[tool_name]\n<free text>` envelope still carries its payload.
    if (Object.keys(args).length === 0) args["reason"] = rest;
  }
  return { name, args };
}

export type ToolEnvelopeFormat = "json" | "bracket";

/**
 * Unified serialized-tool-call parser. Sarvam does not commit to a single
 * envelope shape, so we try each known textual form in turn (JSON content
 * envelope, then bracket/key-value envelope) and return the first that yields a
 * tool name. When `validNames` is supplied, the resolved name MUST be one of the
 * tools offered this turn — this prevents ordinary text that merely starts with
 * `{`/`[` from being misclassified as a tool call (false positives are spoken as
 * text instead). New textual shapes can be added by appending another parser to
 * the chain below.
 */
export function parseToolEnvelope(
  raw: string,
  validNames?: Set<string>,
): { name: string; args: Record<string, unknown>; format: ToolEnvelopeFormat } | null {
  const nameOk = (n: string) => !validNames || validNames.size === 0 || validNames.has(n);

  const json = parseSerializedToolCall(raw);
  if (json && nameOk(json.name)) return { ...json, format: "json" };

  const bracket = parseBracketToolCall(raw);
  if (bracket && nameOk(bracket.name)) return { ...bracket, format: "bracket" };

  return null;
}

export class SarvamLLM implements LLMAdapter {
  private key: string;
  private model: string;
  private genParams: LLMGenerationParams;
  /** Correlation id for diagnostic logging only; never used for request logic. */
  private callId?: number;

  constructor(apiKey: string, model: string | null, genParams?: LLMGenerationParams, callId?: number) {
    this.key = apiKey;
    this.genParams = genParams ?? {};
    this.callId = callId;
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
      onToolDetected?: (info: { format: "structured" | "json" | "bracket" | "function_tag" }) => void;
      onToolParsed?: (info: { name: string; format: "structured" | "json" | "bracket" | "function_tag"; args: Record<string, unknown> }) => void;
      onUsage?: (usage: LLMUsage) => void;
    }
  ): Promise<void> {
    const supportsTools = TOOL_CAPABLE_MODELS.has(this.model);
    const hasTools = supportsTools && (options?.tools?.length ?? 0) > 0;

    // Names of the tools offered this turn — used to validate a parsed envelope
    // so ordinary text that merely starts with `{`/`[` is not misfired as a tool.
    const validToolNames = new Set<string>((options?.tools ?? []).map((t) => t.name));

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

    // Buffered serialized-tool-call sniffing (tools-enabled turns only). When the
    // first non-whitespace reply content begins with `{` or a code fence, the turn
    // may be a tool call emitted as JSON text (Sarvam streaming is unreliable); we
    // withhold ALL content from onToken/TTS and resolve it at end-of-stream.
    let jsonSniffDecided = false; // first-content JSON-vs-text decision made?
    let bufferingJson = false;    // withholding content as a possible tool call?
    let jsonBuffer = "";          // accumulated content while buffering

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

        // Buffer-and-sniff serialized tool calls (tools-enabled turns only).
        // Sarvam's streaming endpoint sometimes emits a tool call as plain text in
        // delta.content instead of structured delta.tool_calls — observed shapes:
        // a JSON blob (`{…}`, optionally ```json-fenced) and a bracket/key-value
        // envelope (`[transfer_to_human]\nreason: …`, Call #945). If the FIRST
        // non-whitespace content of the turn begins with `{`, a code fence, or
        // `[`, withhold ALL content from onToken/TTS and resolve it at
        // end-of-stream (parsed by the unified parseToolEnvelope). Replies that
        // don't start with one of those markers stream normally, preserving TTFT
        // for ordinary conversation.
        if (hasTools) {
          if (bufferingJson) {
            jsonBuffer += token;
            return;
          }
          if (!jsonSniffDecided) {
            const peek = (jsonBuffer + token).replace(/^\s+/, "");
            if (peek === "") {
              // Only whitespace so far — hold it and wait for real content.
              jsonBuffer += token;
              return;
            }
            jsonSniffDecided = true;
            const firstChar = peek[0];
            if (firstChar === "{" || firstChar === "`" || firstChar === "[") {
              bufferingJson = true;
              jsonBuffer += token;
              return;
            }
            // Not a serialized tool call — stream normally from the cleaned peek
            // onward (drops the held leading whitespace, like the check below).
            jsonBuffer = "";
            token = peek;
          }
        }

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

    // Tool turn (structured path): dispatch the first (lowest-index) tool call.
    if (toolAcc.size > 0 && options?.onToolCall) {
      const picked = [...toolAcc.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, v]) => v)
        .find((v) => v.name);
      if (picked?.name) {
        options.onToolDetected?.({ format: "structured" });
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(picked.args || "{}") as Record<string, unknown>;
        } catch {
          // malformed args — call with empty args
        }
        options.onToolParsed?.({ name: picked.name, format: "structured", args });
        options.onToolCall(picked.name, args);
        return; // exactly one terminal callback — do NOT also call onDone
      }
    }

    // Buffered serialized-tool-call fallback: Sarvam emitted the tool call as
    // plain text in delta.content instead of structured delta.tool_calls (none of
    // it was forwarded to TTS). Resolve the withheld buffer through the unified
    // parser (JSON envelope OR bracket/key-value envelope), validating the name
    // against the tools offered this turn; on success execute the tool, otherwise
    // speak it as genuine text — never silently drop it.
    if (bufferingJson) {
      const parsedCall = options?.onToolCall
        ? parseToolEnvelope(jsonBuffer, validToolNames)
        : null;
      if (parsedCall) options?.onToolDetected?.({ format: parsedCall.format });
      if (rawSseDebugEnabled()) {
        logger.warn(
          {
            evt: "sarvam_raw_sse_json_in_content",
            callId: this.callId,
            model: this.model,
            sawToolDelta,
            parseSucceeded: parsedCall !== null,
            resolvedToolName: parsedCall?.name ?? null,
            resolvedFormat: parsedCall?.format ?? null,
            fellBackToText: parsedCall === null,
            jsonBufferLength: jsonBuffer.length,
            jsonBuffer:
              jsonBuffer.length > RAW_SSE_DIAG_MAX_BUFFER
                ? `${jsonBuffer.slice(0, RAW_SSE_DIAG_MAX_BUFFER)}…[truncated]`
                : jsonBuffer,
          },
          "Sarvam raw SSE diagnostic: tool call emitted as text in delta.content",
        );
      }
      if (parsedCall && options?.onToolCall) {
        options.onToolParsed?.({ name: parsedCall.name, format: parsedCall.format, args: parsedCall.args });
        options.onToolCall(parsedCall.name, parsedCall.args);
        return; // exactly one terminal callback — do NOT also call onDone
      }
      onDone(jsonBuffer, usage);
      return;
    }

    // Plain text reply — but first check for a trailing <function>name</function> tag.
    // Sarvam occasionally emits the tool call AFTER conversational text (third emission
    // format, distinct from the structured delta.tool_calls path and the JSON-buffer path):
    //   "சரி, connect பண்றேன்!\n\n<function>transfer_to_human</function>"
    // The buffer-and-sniff above won't catch it because the first char is not `{`/`[`/`` ` ``.
    // The existing tool-tail TTS-leak guard strips the tag from TTS, but onToolCall is never
    // fired — so the tool call is silently dropped. Detect it here, at end-of-stream, on the
    // plain-text path only (not when bufferingJson / sawToolDelta already handled it).
    if (!sawToolDelta && !bufferingJson && options?.onToolCall && validToolNames.size > 0) {
      const fnTagMatch = /^([\s\S]*?)\s*<function>([^<]+)<\/function>\s*$/.exec(full);
      if (fnTagMatch) {
        const textBefore = fnTagMatch[1] ?? "";
        const toolName   = (fnTagMatch[2] ?? "").trim();
        if (validToolNames.has(toolName)) {
          // The tag was streamed character-by-character via onToken; the TTS sentence
          // extractor's tool-tail guard strips it from audio. Fire onToolCall so the
          // pipeline actually executes the tool (which was previously silently dropped).
          options.onToolDetected?.({ format: "function_tag" });
          options.onToolParsed?.({ name: toolName, format: "function_tag", args: {} });
          options.onToolCall(toolName, {});
          return; // exactly one terminal callback — do NOT also call onDone
        }
        // Tag found but not a recognised tool — strip the tag and speak the clean text.
        full = textBefore.trim();
      }
    }

    onDone(full, usage);
  }
}
