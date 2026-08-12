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

/** Models that support Sarvam's function-calling interface */
const TOOL_CAPABLE_MODELS = new Set([
  "sarvam-30b",
  "sarvam-105b",
  // Sarvam-hosted open-source models on /v2 (beta; key must be whitelisted).
  "gemma4",
  "glm5.2",
]);

/** Open-source models served on POST /v2/chat/completions (not /v1). */
const OPEN_SOURCE_MODELS = new Set(["gemma4", "glm5.2"]);

export function isSarvamOpenSourceModel(model: string): boolean {
  return OPEN_SOURCE_MODELS.has(model);
}

export function sarvamChatCompletionsUrl(model: string): string {
  return isSarvamOpenSourceModel(model)
    ? "https://api.sarvam.ai/v2/chat/completions"
    : "https://api.sarvam.ai/v1/chat/completions";
}

/** Normalize playground / docs aliases to the wire model ids. */
export function normalizeSarvamLlmModel(model: string | null | undefined): string {
  const ALIASES: Record<string, string> = {
    "sarvam-m": "sarvam-105b",
    "sarvam-2b": "sarvam-105b",
    "sarvam-2b-v0.5": "sarvam-105b",
    "sarvam-m1": "sarvam-105b",
    "sarvam-30b-16k": "sarvam-105b",
    "sarvam-105b-32k": "sarvam-105b",
    "sarvam-30b": "sarvam-105b",
    // Open-source beta ids (playground label "Gemma 4" → gemma4).
    "gemma-4": "gemma4",
    "gemma-4-31b": "gemma4",
    "gemma4-31b": "gemma4",
    "glm-5.2": "glm5.2",
    "glm5-2": "glm5.2",
    "glm-5-2": "glm5.2",
  };
  const raw = (model ?? "sarvam-105b").trim();
  const key = raw.toLowerCase();
  return ALIASES[key] ?? ALIASES[raw] ?? raw;
}

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

export type ToolEnvelopeFormat = "structured" | "json" | "bracket" | "function_tag" | "function_call";

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

  constructor(apiKey: string, model: string | null, genParams?: LLMGenerationParams, callId?: number) {
    this.key = apiKey;
    this.genParams = genParams ?? {};
    this.callId = callId;
    this.model = normalizeSarvamLlmModel(model);
  }

  private buildGenerationBody(): Record<string, unknown> {
    const p = this.genParams;
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    const openSource = isSarvamOpenSourceModel(this.model);

    // Voice calls: thinking OFF by default. Sarvam's API defaults to "low", which
    // streams English chain-of-thought into `content` and gets spoken by TTS
    // (call 5646: "The user wants me to act as… Let me analyze the constraints").
    // Explicit null disables. medium/high remain available for agents that opt in.
    // Open-source note: gemma4 never reasons; glm5.2 always reasons unless
    // extra_body.chat_template_kwargs.enable_thinking=false (set below).
    const body: Record<string, unknown> = {};
    if (!openSource || this.model === "glm5.2") {
      if (p.reasoningEffort === null) {
        body["reasoning_effort"] = null;
      } else if (p.reasoningEffort === "low" || p.reasoningEffort === "medium" || p.reasoningEffort === "high") {
        body["reasoning_effort"] = p.reasoningEffort;
      } else if (!openSource) {
        body["reasoning_effort"] = null;
      }
    }

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

    if (hasTools && !openSource) {
      if (genBody["reasoning_effort"] == null) {
        genBody["reasoning_effort"] = "low";
        const mt = genBody["max_tokens"];
        if (typeof mt !== "number" || mt < 500) genBody["max_tokens"] = 500;
      }
    }

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
      body["tool_choice"] = "auto";
    }

    const endpoint = sarvamChatCompletionsUrl(this.model);

    // Fetch with up to 2 retries for transient 429 rate limit or 5xx server errors
    let resp: Response | null = null;
    let attempts = 0;
    const maxAttempts = 3;
    let lastErr = "";

    while (attempts < maxAttempts) {
      attempts++;
      try {
        resp = await fetch(endpoint, {
          method: "POST",
          headers: {
            "api-subscription-key": this.key,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
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
        if (attempts >= maxAttempts) throw err;
      }
    }

    if (!resp || !resp.ok) {
      throw new Error(`Sarvam LLM request failed: ${lastErr}`);
    }

    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let full = "";
    let reasoningBuffer = "";
    let usage: LLMUsage | undefined;

    const toolAcc = new Map<number, { id: string; name: string; args: string }>();
    let sawToolDelta = false;
    let sawRealContent = false;
    let jsonSniffDecided = false;
    let bufferingJson = false;
    let jsonBuffer = "";

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

        if (parsed.usage) {
          usage = {
            inputTokens: parsed.usage.prompt_tokens ?? 0,
            outputTokens: parsed.usage.completion_tokens ?? 0,
          };
        }

        const delta = parsed.choices[0]?.delta;
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
            jsonSniffDecided = true;
            const firstChar = peek[0];
            if (firstChar === "{" || firstChar === "`" || firstChar === "[") {
              bufferingJson = true;
              jsonBuffer += token;
              return;
            }
            jsonBuffer = "";
            token = peek;
          }
        }

        if (!sawRealContent && /^\s*$/.test(token)) return;

        sawRealContent = true;
        full += token;
        onToken(token);
      } catch {
        // Skip malformed chunk
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

    if (usage) options?.onUsage?.(usage);

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
          // Empty args on JSON parse error
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
      onDone("", usage);
      return;
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
  }
}
