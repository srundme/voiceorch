import type { ConversationTurn, LLMAdapter, LLMGenerationParams, LLMUsage, ToolDefinition } from "../../types.js";
import { toOpenAIMessages } from "./openai-messages.js";
import { logger } from "../../../lib/logger.js";
import { toOpenAiToolChoice } from "./tool-choice.js";

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

/** Flagship reasoning model — complex / agentic / analytics (not the voice default). */
export const SARVAM_FLAGSHIP_MODEL = "sarvam-105b" as const;
/** Post-trained dialogue model — voice agents & real-time chat (/v1 only). */
export const SARVAM_CONVERSATIONS_MODEL = "sarvam-105b-conversations" as const;

/** Models that support Sarvam's function-calling interface */
const TOOL_CAPABLE_MODELS = new Set([
  "sarvam-30b",
  SARVAM_FLAGSHIP_MODEL,
  SARVAM_CONVERSATIONS_MODEL,
  // Sarvam-hosted open-source models on /v2 (beta; key must be whitelisted).
  "gemma4",
  "glm5.2",
]);

/** Open-source models served on POST /v2/chat/completions (not /v1). */
const OPEN_SOURCE_MODELS = new Set(["gemma4", "glm5.2"]);

export function isSarvamOpenSourceModel(model: string): boolean {
  return OPEN_SOURCE_MODELS.has(model);
}

export function isSarvamConversationsModel(model: string): boolean {
  return model === SARVAM_CONVERSATIONS_MODEL;
}

export function sarvamChatCompletionsUrl(model: string): string {
  // Docs: sarvam-105b-conversations is /v1 only; open-source hosts use /v2.
  return isSarvamOpenSourceModel(model)
    ? "https://api.sarvam.ai/v2/chat/completions"
    : "https://api.sarvam.ai/v1/chat/completions";
}

/** Normalize playground / docs aliases to the wire model ids. */
export function normalizeSarvamLlmModel(model: string | null | undefined): string {
  const ALIASES: Record<string, string> = {
    // Retired / playground aliases → voice conversations model (docs: voice agents).
    "sarvam-m": SARVAM_CONVERSATIONS_MODEL,
    "sarvam-2b": SARVAM_CONVERSATIONS_MODEL,
    "sarvam-2b-v0.5": SARVAM_CONVERSATIONS_MODEL,
    "sarvam-m1": SARVAM_CONVERSATIONS_MODEL,
    "sarvam-30b-16k": SARVAM_CONVERSATIONS_MODEL,
    "sarvam-105b-32k": SARVAM_FLAGSHIP_MODEL,
    "sarvam-30b": SARVAM_CONVERSATIONS_MODEL,
    // Conversational aliases
    "sarvam-105b-conversation": SARVAM_CONVERSATIONS_MODEL,
    "sarvam-105b-chat": SARVAM_CONVERSATIONS_MODEL,
    "sarvam-conversations": SARVAM_CONVERSATIONS_MODEL,
    // Open-source beta ids (playground label "Gemma 4" → gemma4).
    "gemma-4": "gemma4",
    "gemma-4-31b": "gemma4",
    "gemma4-31b": "gemma4",
    "glm-5.2": "glm5.2",
    "glm5-2": "glm5.2",
    "glm-5-2": "glm5.2",
  };
  const raw = (model ?? SARVAM_CONVERSATIONS_MODEL).trim();
  const key = raw.toLowerCase();
  return ALIASES[key] ?? ALIASES[raw] ?? raw;
}

/** Abort hang / dead stream if first bytes never arrive (matches Google adapter). */
const REQUEST_TIMEOUT_MS = Math.max(8_000, Number(process.env.SARVAM_REQUEST_TIMEOUT_MS) || 12_000);

/**
 * Soft ceiling for Gemma 4 voice turns. Sarvam's /v2 default is 2048 if omitted,
 * which is far too long for spoken replies. Session already defaults Sarvam to
 * 500; this clamps runaway agent configs so a 31B model cannot sit generating
 * for seconds after the useful answer.
 */
const GEMMA4_VOICE_MAX_TOKENS = Math.max(
  128,
  Number(process.env.SARVAM_GEMMA4_VOICE_MAX_TOKENS) || 400,
);

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

export type ToolEnvelopeFormat = "structured" | "json" | "bracket" | "function_tag" | "function_call" | "xml";

/**
 * Sarvam-105b-conversations (and some Gemma/Groq prompts) emit tools as XML
 * in delta.content instead of delta.tool_calls:
 *
 *   <tool_call>next_service_suggestion
 *   <arg_key>offering_type</arg_key>
 *   <arg_value>B2B portal</arg_value>
 *   </tool_call>
 *
 * parseSerializedToolCall only understands JSON, so this used to stream to TTS,
 * get stripped as a tool artifact, and leave the caller in dead air (call 12705).
 */
export function parseXmlToolCall(raw: string): { name: string; args: Record<string, unknown> } | null {
  if (!raw) return null;
  const text = raw.trim();
  const block = /<tool_call>\s*([A-Za-z][\w]*)\s*([\s\S]*?)(?:<\/tool_call>|$)/i.exec(text);
  if (!block) return null;
  const name = block[1]!.trim();
  if (!name) return null;
  const body = block[2] ?? "";
  const args: Record<string, unknown> = {};
  const pairRe = /<arg_key>\s*([^<]+?)\s*<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/gi;
  let pair: RegExpExecArray | null;
  while ((pair = pairRe.exec(body)) !== null) {
    const key = pair[1]!.trim();
    if (key) args[key] = pair[2]!.trim();
  }
  return { name, args };
}

/** True when streamed content is (or might still become) an XML tool envelope. */
export function xmlToolSniff(peek: string): "yes" | "no" | "hold" {
  const p = peek.replace(/^\s+/, "").toLowerCase();
  if (!p.startsWith("<")) return "no";
  if (p.startsWith("<tool_call") || p.startsWith("<arg_key") || p.startsWith("<function")) return "yes";
  const maybe = ["<tool_call", "<arg_key", "<function"];
  if (maybe.some((m) => m.startsWith(p))) return "hold";
  return "no";
}

export function parseSerializedToolCall(raw: string): { name: string; args: Record<string, unknown> } | null {
  if (!raw) return null;
  let text = raw.trim();

  // Strip code fences if present: ```json ... ``` or ``` ... ```
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  if (fenceMatch) text = fenceMatch[1]!.trim();

  // Handle case where model prepends arbitrary text before the JSON object
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) return null;

  const candidate = text.slice(jsonStart, jsonEnd + 1);

  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>;

    // Shape 1: { name: "tool_name", arguments: { ... } } or { name: "tool_name", parameters: { ... } }
    if (typeof parsed["name"] === "string" && parsed["name"].trim().length > 0) {
      const name = parsed["name"].trim();
      const rawArgs = parsed["arguments"] ?? parsed["parameters"] ?? {};
      const args = typeof rawArgs === "object" && rawArgs !== null ? (rawArgs as Record<string, unknown>) : {};
      return { name, args };
    }

    // Shape 2: { tool: "tool_name", args: { ... } }
    if (typeof parsed["tool"] === "string" && parsed["tool"].trim().length > 0) {
      const name = parsed["tool"].trim();
      const rawArgs = parsed["args"] ?? {};
      const args = typeof rawArgs === "object" && rawArgs !== null ? (rawArgs as Record<string, unknown>) : {};
      return { name, args };
    }
  } catch {
    // Parsing failed
  }

  return null;
}

export function parseBracketToolCall(
  raw: string,
  validNames?: Set<string>,
): { name: string; args: Record<string, unknown> } | null {
  if (!raw) return null;
  const text = raw.trim();

  const match = /^\[([a-zA-Z0-9_-]+)\][\s\r\n]*([\s\S]*)$/.exec(text);
  if (!match) return null;

  const name = match[1]!;
  if (validNames && validNames.size > 0 && !validNames.has(name)) return null;

  const body = match[2]?.trim() ?? "";
  const args: Record<string, unknown> = {};

  if (body.length > 0) {
    const kvRegex = /([a-zA-Z0-9_-]+)\s*:\s*(?:"([^"]*)"|'([^']*)'|([^,\}\r\n]+))/g;
    let kv: RegExpExecArray | null;
    while ((kv = kvRegex.exec(body)) !== null) {
      const key = kv[1]!;
      const val = (kv[2] ?? kv[3] ?? kv[4] ?? "").trim();
      args[key] = val;
    }
  }

  return { name, args };
}

export function parseFunctionCallNotation(
  raw: string,
  validNames?: Set<string>,
): { name: string; args: Record<string, unknown> } | null {
  if (!raw) return null;
  const text = raw.trim();

  // Find tool_name(...) anywhere in the string
  const namesPattern = validNames && validNames.size > 0
    ? Array.from(validNames).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")
    : "[a-zA-Z0-9_-]+";

  const fnRegex = new RegExp(`\\b(${namesPattern})\\s*\\(([\\s\\S]*?)\\)`, "i");
  const match = fnRegex.exec(text);
  if (!match) return null;

  const name = match[1]!.trim();
  const body = match[2]?.trim() ?? "";
  if (body.length === 0) return { name, args: {} };

  // 1. Try key=value format (e.g. email="foo@bar.com", date="today")
  const args: Record<string, unknown> = {};
  const kvRegex = /([a-zA-Z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^,\s]+))/g;
  let kv: RegExpExecArray | null;
  let hasKv = false;
  while ((kv = kvRegex.exec(body)) !== null) {
    hasKv = true;
    const key = kv[1]!;
    const rawVal = (kv[2] ?? kv[3] ?? kv[4] ?? "").trim();
    if (rawVal === "true") args[key] = true;
    else if (rawVal === "false") args[key] = false;
    else if (!isNaN(Number(rawVal)) && rawVal !== "") args[key] = Number(rawVal);
    else args[key] = rawVal;
  }

  if (hasKv) return { name, args };

  // 2. Try JSON format inside parens (e.g. {"email": "foo@bar.com"})
  try {
    const wrappedJson = `{${body}}`;
    const parsed = JSON.parse(wrappedJson) as Record<string, unknown>;
    if (typeof parsed === "object" && parsed !== null) return { name, args: parsed };
  } catch {
    // Fall back to positional comma-separated parsing
  }

  // 3. Positional comma-separated values (e.g. karthikeyan@theaitel.com, Karthikeyan, today)
  const posValues = body.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  if (posValues.length > 0) {
    if (name.includes("book") || name.includes("appointment")) {
      for (const val of posValues) {
        if (val.includes("@")) {
          args["attendee_email"] = val;
          args["email"] = val;
        } else if (/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|pm|am|\d{1,2}:\d{2})\b/i.test(val)) {
          args["preferred_date"] = val;
          args["date_time"] = val;
          args["start_time"] = val;
          args["slot"] = val;
        } else {
          args["attendee_name"] = val;
          args["name"] = val;
        }
      }
    } else {
      posValues.forEach((val, idx) => {
        args[`arg${idx + 1}`] = val;
      });
    }
  }

  return { name, args };
}

export function parseToolEnvelope(
  raw: string,
  validNames?: Set<string>,
): { name: string; args: Record<string, unknown>; format: ToolEnvelopeFormat } | null {
  const nameOk = (n: string) => !validNames || validNames.size === 0 || validNames.has(n);

  // XML is unambiguous even when the tool name is hallucinated — dispatch it
  // so the pipeline can return "tool not available" instead of going silent.
  const xml = parseXmlToolCall(raw);
  if (xml) return { ...xml, format: "xml" };

  const json = parseSerializedToolCall(raw);
  if (json && nameOk(json.name)) return { ...json, format: "json" };

  const bracket = parseBracketToolCall(raw, validNames);
  if (bracket && nameOk(bracket.name)) return { ...bracket, format: "bracket" };

  const fnCall = parseFunctionCallNotation(raw, validNames);
  if (fnCall && nameOk(fnCall.name)) return { ...fnCall, format: "function_call" };

  return null;
}

/**
 * Sarvam AI LLM Adapter (OpenAI-Compatible endpoint)
 * Handles retries on rate limits (429/503), reasoning token fallbacks, special token stripping.
 */
export class SarvamLLM implements LLMAdapter {
  private key: string;
  private model: string;
  private genParams: LLMGenerationParams;
  private callId?: number;
  private abortController: AbortController | null = null;

  constructor(apiKey: string, model: string | null, genParams?: LLMGenerationParams, callId?: number) {
    this.key = apiKey;
    this.genParams = genParams ?? {};
    this.callId = callId;
    this.model = normalizeSarvamLlmModel(model);
  }

  /**
   * Abort the in-flight streaming HTTP body on barge-in so Gemma/Sarvam stop
   * generating tokens the caller will never hear. Without this the stream runs
   * to completion in the background and delays the next turn.
   */
  cancelInFlight(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  private buildGenerationBody(): Record<string, unknown> {
    const p = this.genParams;
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    const openSource = isSarvamOpenSourceModel(this.model);

    // Voice calls: thinking OFF by default. Sarvam's /v1 API defaults to
    // "medium" (docs 2026-08), which streams chain-of-thought before content
    // and can exhaust max_tokens with empty spoken replies. Explicit null
    // disables. low/medium/high remain available for agents that opt in.
    // gemma4 never reasons — do not send reasoning_effort at all (no-op + noise).
    // glm5.2 always reasons unless extra_body.chat_template_kwargs.enable_thinking=false.
    const body: Record<string, unknown> = {};
    if (this.model !== "gemma4") {
      if (p.reasoningEffort === null) {
        body["reasoning_effort"] = null;
      } else if (p.reasoningEffort === "low" || p.reasoningEffort === "medium" || p.reasoningEffort === "high") {
        body["reasoning_effort"] = p.reasoningEffort;
      } else if (!openSource) {
        // Native Sarvam models (/v1): always send null for voice unless opted in.
        // Omitting the field leaves the API default ("medium") ON.
        body["reasoning_effort"] = null;
      }
    }

    if (typeof p.temperature === "number" && Number.isFinite(p.temperature)) {
      body["temperature"] = clamp(p.temperature, 0, 2);
    } else if (this.model === SARVAM_CONVERSATIONS_MODEL) {
      // Docs: sarvam-105b-conversations voice example uses temperature 1
      // (https://docs.sarvam.ai/api/getting-started/models/sarvam-105b).
      // Omitting it with reasoning_effort=null would fall back to 0.2.
      body["temperature"] = 1;
    }
    if (typeof p.topP === "number" && Number.isFinite(p.topP)) {
      body["top_p"] = clamp(p.topP, 0, 1);
    } else if (this.model === SARVAM_CONVERSATIONS_MODEL) {
      body["top_p"] = 1;
    }

    let maxTokens =
      typeof p.maxTokens === "number" && Number.isFinite(p.maxTokens) && p.maxTokens > 0
        ? Math.floor(p.maxTokens)
        : this.model === SARVAM_CONVERSATIONS_MODEL
          // Spoken range in Sarvam voice guidance is 100–500; 100 clips Indic.
          ? 500
          : undefined;
    // Gemma 4 answers directly with no thinking pass — keep the spoken budget
    // tight so TTFT + full-turn latency stay voice-friendly.
    if (this.model === "gemma4") {
      maxTokens = Math.min(maxTokens ?? GEMMA4_VOICE_MAX_TOKENS, GEMMA4_VOICE_MAX_TOKENS);
    }
    if (typeof maxTokens === "number") body["max_tokens"] = maxTokens;

    if (typeof p.presencePenalty === "number" && Number.isFinite(p.presencePenalty))
      body["presence_penalty"] = clamp(p.presencePenalty, -2, 2);
    if (typeof p.frequencyPenalty === "number" && Number.isFinite(p.frequencyPenalty))
      body["frequency_penalty"] = clamp(p.frequencyPenalty, -2, 2);
    if (typeof p.seed === "number" && Number.isFinite(p.seed))
      body["seed"] = Math.trunc(p.seed);
    // wiki_grounding is Sarvam-native /v1 only — /v2 rejects it.
    if (!openSource && typeof p.wikiGrounding === "boolean")
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
      onToolDetected?: (info: { format: ToolEnvelopeFormat }) => void;
      onToolParsed?: (info: { name: string; format: ToolEnvelopeFormat; args: Record<string, unknown> }) => void;
      onUsage?: (usage: LLMUsage) => void;
    }
  ): Promise<void> {
    const supportsTools = TOOL_CAPABLE_MODELS.has(this.model);
    const hasTools = supportsTools && (options?.tools?.length ?? 0) > 0;
    const openSource = isSarvamOpenSourceModel(this.model);
    const validToolNames = new Set<string>((options?.tools ?? []).map((t) => t.name));
    const sanitized = sanitizeForAlternation(messages);

    const genBody = this.buildGenerationBody();

    // Reasoning tokens count toward max_tokens. Floor the budget whenever
    // thinking is on so content is not empty after the hidden trace (Sarvam gotcha).
    // Skip for gemma4 (never reasons) and for glm5.2 when we disable thinking below.
    if (genBody["reasoning_effort"] != null && !openSource) {
      const mt = genBody["max_tokens"];
      if (typeof mt !== "number" || mt < 500) genBody["max_tokens"] = 500;
    }

    // Tool calling uses structured `tools` + XML fallback in the stream
    // parser. Do NOT force reasoning_effort="low" just because tools exist —
    // that re-enables CoT on every voice turn, burns max_tokens, and can
    // return empty spoken `content` (Sarvam gotcha). Agents that want
    // thinking set reasoningEffort explicitly.

    // glm5.2 reasons before every answer by default; that burns max_tokens and
    // adds seconds of silence on voice. Turn thinking off for live calls unless
    // the agent explicitly opted into medium/high reasoning_effort.
    if (this.model === "glm5.2") {
      const effort = genBody["reasoning_effort"];
      const keepThinking = effort === "medium" || effort === "high";
      if (!keepThinking) {
        delete genBody["reasoning_effort"];
        genBody["extra_body"] = {
          chat_template_kwargs: { enable_thinking: false },
        };
      }
    }

    const effectiveSystemPrompt = hasTools
      ? `[TOOL GUIDANCE] You have tools available. Use them naturally:
1. When you have ALL required information from the caller, call the tool IMMEDIATELY without emitting preambles or spoken confirmations first.
2. If the caller says yes/ok/confirm and you already have their details, call the tool — don't ask for confirmation again.
3. If you're MISSING required information, ask for it conversationally. Don't call a tool with incomplete data.

${systemPrompt}`
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

    if (hasTools && options?.tools) {
      body["tools"] = options.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      body["tool_choice"] = toOpenAiToolChoice(options?.toolChoice, options.tools);
    }

    const endpoint = sarvamChatCompletionsUrl(this.model);

    // Cancel any prior in-flight stream (barge-in / overlapping turns) before
    // opening a new one, then arm a fresh AbortController for this call.
    this.abortController?.abort();
    const abort = new AbortController();
    this.abortController = abort;
    // Timeout covers connect + first headers only — clear once the SSE body is
    // open so a long spoken reply is not cut mid-sentence.
    let connectTimedOut = false;
    let connectTimer: ReturnType<typeof setTimeout> | null = setTimeout(
      () => {
        connectTimedOut = true;
        abort.abort();
      },
      REQUEST_TIMEOUT_MS,
    );
    const clearConnectTimer = () => {
      if (connectTimer) {
        clearTimeout(connectTimer);
        connectTimer = null;
      }
    };

    // Fetch with up to 2 retries for transient 429 rate limit or 5xx server errors
    let resp: Response | null = null;
    let attempts = 0;
    const maxAttempts = 3;
    let lastErr = "";

    try {
      while (attempts < maxAttempts) {
        if (abort.signal.aborted) {
          if (connectTimedOut) throw new Error("Sarvam LLM connect timeout");
          return; // barge-in
        }
        attempts++;
        try {
          resp = await fetch(endpoint, {
            method: "POST",
            headers: {
              "api-subscription-key": this.key,
              Authorization: `Bearer ${this.key}`,
              "Content-Type": "application/json",
              Accept: "text/event-stream",
            },
            body: JSON.stringify(body),
            signal: abort.signal,
          });

          if (resp.ok) break;

          lastErr = await resp.text();
          if ((resp.status === 429 || resp.status >= 500) && attempts < maxAttempts) {
            const delay = attempts * 300;
            logger.warn(
              { status: resp.status, attempt: attempts, delay, model: this.model, endpoint, evt: "sarvam_llm_retry" },
              `Sarvam LLM returned ${resp.status}, retrying in ${delay}ms...`
            );
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
          throw new Error(`Sarvam LLM error ${resp.status}: ${lastErr}`);
        } catch (err) {
          if (abort.signal.aborted) {
            if (connectTimedOut) throw new Error("Sarvam LLM connect timeout");
            return; // barge-in cancel — not an error
          }
          if (attempts >= maxAttempts) throw err;
        }
      }

      if (!resp || !resp.ok) {
        throw new Error(`Sarvam LLM request failed: ${lastErr}`);
      }

      clearConnectTimer(); // headers received — let the stream run for voice length

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let full = "";
      let finishReason: string | null = null;
      let sawDone = false;
      let reasoningBuffer = "";
      let usage: LLMUsage | undefined;

      const toolAcc = new Map<number, { id: string; name: string; args: string }>();
      let sawToolDelta = false;
      let sawRealContent = false;
      let jsonSniffDecided = false;
      let bufferingJson = false;
      let jsonBuffer = "";

      const handleData = (data: string): void => {
        if (data === "[DONE]") { sawDone = true; return; }
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

          if (parsed.usage) {
            usage = {
              inputTokens: parsed.usage.prompt_tokens ?? 0,
              outputTokens: parsed.usage.completion_tokens ?? 0,
            };
          }

          if (parsed.choices?.[0]?.finish_reason) finishReason = parsed.choices[0].finish_reason;
          const delta = parsed.choices?.[0]?.delta;
          if (!delta) return;

          // Collect reasoning trace as fallback
          if (delta.reasoning_content) {
            reasoningBuffer += delta.reasoning_content;
          }

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

          if (sawToolDelta) return;

          let token = delta.content ?? "";
          if (!token) return;

          // Comprehensive special token stripping for Sarvam thinking tokens
          token = token.replace(/<\|(?:message|thinking|endofthinking|endofmessage|im_start|im_end|thought|[a-z_]+)\|>/gi, "");
          if (!token) return;

          if (hasTools) {
            if (bufferingJson) {
              jsonBuffer += token;
              return;
            }
            if (!jsonSniffDecided) {
              const peek = (jsonBuffer + token).replace(/^\s+/, "");
              if (peek === "") {
                jsonBuffer += token;
                return;
              }
              const firstChar = peek[0];
              if (firstChar === "{" || firstChar === "`" || firstChar === "[") {
                jsonSniffDecided = true;
                bufferingJson = true;
                jsonBuffer += token;
                return;
              }
              const xmlSniff = xmlToolSniff(peek);
              if (xmlSniff === "hold") {
                jsonBuffer += token;
                return;
              }
              if (xmlSniff === "yes") {
                jsonSniffDecided = true;
                bufferingJson = true;
                jsonBuffer += jsonBuffer ? token : peek;
                return;
              }
              jsonSniffDecided = true;
              jsonBuffer = "";
              token = peek;
            }
          }

          if (!sawRealContent && /^\s*$/.test(token)) return;

          // Call 14160: the model spoke a few words, then dumped <tool_call> XML.
          // Start-of-stream sniff had already committed to speech, so XML used to
          // reach TTS, get stripped, and leave empty-LLM recovery ("I didn't hear you").
          if (hasTools && jsonSniffDecided && !bufferingJson && !sawToolDelta) {
            const hay = full + token;
            const xmlAt = hay.search(/<tool_call\b/i);
            if (xmlAt >= 0) {
              const extraSpeech = xmlAt > full.length ? hay.slice(full.length, xmlAt) : "";
              if (extraSpeech) {
                sawRealContent = true;
                full += extraSpeech;
                onToken(extraSpeech);
              }
              bufferingJson = true;
              jsonBuffer = hay.slice(xmlAt);
              return;
            }
          }

          sawRealContent = true;
          full += token;
          onToken(token);
        } catch {
          // Skip malformed chunk
        }
      };

      let buffer = "";
      try {
        while (true) {
          if (abort.signal.aborted) break;
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          let nl: number;
          while ((nl = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (line.startsWith("data:")) handleData(line.slice(5).trimStart());
          }
        }

        if (!abort.signal.aborted) {
          buffer += decoder.decode();
          const tail = buffer.trim();
          if (tail.startsWith("data:")) handleData(tail.slice(5).trimStart());
        }
      } catch (err) {
        if (abort.signal.aborted) {
          try { await reader.cancel(); } catch { /* noop */ }
          return;
        }
        throw err;
      }

      if (abort.signal.aborted) {
        try { await reader.cancel(); } catch { /* noop */ }
        return;
      }

      // A truncated stream is not a completed answer. Repair speech only, once,
      // without exposing tools or repeating already streamed text. Exact-prefix
      // validation deliberately rejects rewrites (which would duplicate speech).
      const incomplete = finishReason === "length" || (!finishReason && !sawDone);
      if (incomplete && (sawToolDelta || bufferingJson)) {
        throw new Error(`Sarvam tool response ended before completion (${finishReason ?? "unexpected EOF"}); tool not executed`);
      }
      if (incomplete && full.trim() && !sawToolDelta && !bufferingJson && !jsonBuffer) {
        const repairAbort = new AbortController();
        const timer = setTimeout(() => repairAbort.abort(), 3000);
        let repaired = false;
        try {
          const repairBody: Record<string, unknown> = { ...body, stream: false };
          // Reproducing the prefix consumes tokens too. Allow a small bounded
          // suffix budget on this one recovery request, not on normal turns.
          repairBody["max_tokens"] = Math.min(4096, Number(body["max_tokens"] ?? 500) + 128);
          delete repairBody["tools"];
          delete repairBody["tool_choice"];
          repairBody["messages"] = [
            ...(body["messages"] as Array<Record<string, unknown>>),
            { role: "assistant", content: full },
            { role: "user", content: "The preceding assistant reply was cut off by the transport. Return that exact reply verbatim, including its exact prefix, and finish only its interrupted sentence. Do not add a new question, action, tool call, or claim that any new action was performed." },
          ];
          const result = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", "api-subscription-key": this.key, Authorization: `Bearer ${this.key}` },
            body: JSON.stringify(repairBody),
            signal: AbortSignal.any([abort.signal, repairAbort.signal]),
          });
          if (result.ok) {
            const data = await result.json() as { choices?: Array<{ finish_reason?: string; message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
            if (data.usage) options?.onUsage?.({ inputTokens: data.usage.prompt_tokens ?? 0, outputTokens: data.usage.completion_tokens ?? 0 });
            const choice = data.choices?.[0];
            const completed = choice?.message?.content;
            if (!abort.signal.aborted && choice?.finish_reason === "stop" && completed?.startsWith(full) && completed.length > full.length && !parseToolEnvelope(completed)) {
              const suffix = completed.slice(full.length);
              full = completed;
              onToken(suffix);
              repaired = true;
            }
          }
        } catch { /* Keep already delivered speech; never replay it on repair failure. */ }
        finally { clearTimeout(timer); }
        if (abort.signal.aborted) return;
        logger.warn({ callId: this.callId, model: this.model, finishReason, sawDone, repaired, evt: "sarvam_incomplete_response" }, "Sarvam incomplete response repair result");
      }

      if (usage) options?.onUsage?.(usage);

      // Stream ended while still holding a possible XML prefix ("<", "<tool") —
      // flush it as speech rather than dropping it.
      if (!sawToolDelta && !bufferingJson && jsonBuffer) {
        const leftover = jsonBuffer.replace(/^\s+/, "") || jsonBuffer;
        jsonBuffer = "";
        if (leftover) {
          sawRealContent = true;
          full += leftover;
          onToken(leftover);
        }
      }

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
            logger.warn(
              { model: this.model, argsSnippet: (picked.args || "").slice(0, 200) },
              "Sarvam tool args JSON parse failed — using empty object",
            );
            args = {};
          }
          options.onToolParsed?.({ name: picked.name, format: "structured", args });
          options.onToolCall(picked.name, args);
          return;
        }
      }

      if (bufferingJson) {
        const parsedCall = options?.onToolCall
          ? parseToolEnvelope(jsonBuffer, validToolNames)
          : null;
        if (parsedCall) options?.onToolDetected?.({ format: parsedCall.format });

        if (parsedCall && options?.onToolCall) {
          options.onToolParsed?.({ name: parsedCall.name, format: parsedCall.format, args: parsedCall.args });
          options.onToolCall(parsedCall.name, parsedCall.args);
          return;
        }
        // Withheld content was not a tool after all — speak it. onDone("") here
        // is the silent-turn bug (call 12705): XML tool tags got buffered, failed
        // JSON parse, and the caller heard nothing.
        onDone(jsonBuffer, usage);
        return;
      }

      if (!sawToolDelta && !bufferingJson && options?.onToolCall) {
        const midStreamXml = parseToolEnvelope(full, validToolNames);
        if (midStreamXml) {
          options.onToolDetected?.({ format: midStreamXml.format });
          options.onToolParsed?.({
            name: midStreamXml.name,
            format: midStreamXml.format,
            args: midStreamXml.args,
          });
          options.onToolCall(midStreamXml.name, midStreamXml.args);
          return;
        }
      }

      if (!sawToolDelta && !bufferingJson && options?.onToolCall && validToolNames.size > 0) {
        const fnTagMatch = /^([\s\S]*?)\s*<function>([^<]+)<\/function>\s*$/.exec(full);
        if (fnTagMatch) {
          const textBefore = fnTagMatch[1] ?? "";
          const toolName = (fnTagMatch[2] ?? "").trim();
          if (validToolNames.has(toolName)) {
            options.onToolDetected?.({ format: "function_tag" });
            options.onToolParsed?.({ name: toolName, format: "function_tag", args: {} });
            options.onToolCall(toolName, {});
            return;
          }
          full = textBefore.trim();
        }
      }

      // Never speak reasoning_content. When thinking eats the token budget,
      // content can be empty — falling back to the reasoning trace made the
      // agent literally read its chain-of-thought aloud (call 5646).
      if (!full.trim() && reasoningBuffer.trim()) {
        logger.warn(
          {
            model: this.model,
            evt: "sarvam_content_null_reasoning_dropped",
            reasoningChars: reasoningBuffer.length,
          },
          "Sarvam content was null after reasoning; not speaking reasoning_content",
        );
      }

      onDone(full, usage);
    } finally {
      clearConnectTimer();
      if (this.abortController === abort) this.abortController = null;
    }
  }
}
