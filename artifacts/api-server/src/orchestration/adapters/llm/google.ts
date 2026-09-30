import { GoogleGenAI, FunctionCallingConfigMode } from "@google/genai";
import type { Content, GenerateContentConfig, CachedContent, GenerateContentResponseUsageMetadata, Tool } from "@google/genai";
import { logger } from "../../../lib/logger.js";
import type { ConversationTurn, LLMAdapter, LLMGenerationParams, LLMUsage, ToolDefinition } from "../../types.js";
import { toGeminiLiveTools } from "../live/gemini-tools.js";
import { isGeminiQuotaError, loadManagedGeminiKeys, markGeminiKeyExhausted, maskGeminiKey, pickGeminiKeyFromList } from "../../../lib/gemini-key-pool.js";

// ── Gemini-scoped reasoning/preamble backstop (GEMINI ONLY) ──────────────────
/** A COMPLETE leading bracketed state/context line, e.g. "[DATE/TIME CONTEXT] …\n". */
const GEMINI_BRACKET_LINE_RE = /^[ \t]*\[[^\]\n]+\][^\n]*\r?\n/;
/** Planning→reply handoff marker. */
const GEMINI_HANDOFF_RE = /\bnew response\b[^:\n]*:[ \t]*/i;
/** First-person planning cues that gate the handoff cut. */
const GEMINI_PLANNING_CUE_RE =
  /\b(the user|the caller|i should|i will|i'?ll|let me|based on|acknowledge|i need to|i'?m going to)\b/i;

/**
 * Parses serialized <tool_call>tool_name{key: "val"}</tool_call> tags from Gemini plain text responses.
 */
export function parseGeminiTagToolCall(raw: string): { name: string; args: Record<string, unknown> } | null {
  if (!raw) return null;
  const match = /<tool_call>\s*([a-zA-Z0-9_-]+)\s*(\{[\s\S]*?\})\s*<\/tool_call>/i.exec(raw);
  if (!match) return null;
  const name = match[1]!;
  const body = match[2]!;

  try {
    const args = JSON.parse(body);
    if (typeof args === "object" && args !== null) return { name, args: args as Record<string, unknown> };
  } catch { /* proceed to key: val parser */ }

  const args: Record<string, unknown> = {};
  const kvRegex = /([a-zA-Z0-9_-]+)\s*:\s*(?:"([^"]*)"|'([^']*)'|([^,\}\s]+))/g;
  let kv: RegExpExecArray | null;
  while ((kv = kvRegex.exec(body)) !== null) {
    args[kv[1]!] = kv[2] ?? kv[3] ?? kv[4];
  }

  return { name, args };
}

/**
 * Parses Gemini's occasional plain-text imitation of a tool call, for example
 * "[called goto_slide(4)]" or "[called next_slide]".
 */
export function parseGeminiBracketToolCall(raw: string): { name: string; args: Record<string, unknown> } | null {
  if (!raw) return null;
  const match = /\[called\s+([a-zA-Z0-9_-]+)(?:\(([\s\S]*?)\))?\]/i.exec(raw);
  if (!match) return null;

  const name = match[1]!;
  const body = match[2]?.trim() ?? "";
  if (!body) return { name, args: {} };

  try {
    const parsed = JSON.parse(body);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return { name, args: parsed as Record<string, unknown> };
    }
    if (name === "goto_slide" && (typeof parsed === "number" || typeof parsed === "string")) {
      return { name, args: { slide: parsed } };
    }
  } catch {
    // Accept the compact positional form observed in call logs.
    if (name === "goto_slide" && /^\d+(?:\.\d+)?$/.test(body)) {
      return { name, args: { slide: Number(body) } };
    }
  }

  const args: Record<string, unknown> = {};
  const kvRegex = /([a-zA-Z0-9_-]+)\s*[:=]\s*(?:"([^"]*)"|'([^']*)'|([^,\s]+))/g;
  let kv: RegExpExecArray | null;
  while ((kv = kvRegex.exec(body)) !== null) {
    const value = kv[2] ?? kv[3] ?? kv[4]!;
    args[kv[1]!] = /^-?\d+(?:\.\d+)?$/.test(value) ? Number(value) : value;
  }
  return Object.keys(args).length > 0 ? { name, args } : null;
}

function parseStoredToolArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

/**
 * Whole-string strip of Gemini thinking/planning preamble before it reaches TTS.
 */
export function stripGeminiThinkingPreamble(text: string): string {
  if (!text) return text;
  let out = text;

  out = out.replace(/\[(?:LANGUAGE RULE|LANGUAGE|Language|Reminder|DATE NOTE|ACKNOWLEDGMENT FILLERS|CONTEXT)[^\]]*\][^\n.]*(\n|$)?/gi, "");

  for (;;) {
    const m = out.match(GEMINI_BRACKET_LINE_RE);
    if (!m) break;
    out = out.slice(m[0].length);
  }
  const h = out.match(GEMINI_HANDOFF_RE);
  if (h && h.index !== undefined) {
    const before = out.slice(0, h.index);
    const after = out.slice(h.index + h[0].length);
    if (after.trim() && GEMINI_PLANNING_CUE_RE.test(before)) {
      out = after;
    }
  }
  return out.replace(/^\s+/, "");
}

/**
 * Streaming preamble guard — strips planning traces token-by-token without delaying real replies.
 */
export function makeGeminiPreambleGuard(): (token: string) => string {
  let committed = false;
  let buf = "";
  const OPEN_BRACKET_WAIT_LIMIT = 100;
  return function guard(token: string): string {
    if (committed) return token;
    buf += token;
    for (;;) {
      const m = buf.match(GEMINI_BRACKET_LINE_RE);
      if (!m) break;
      buf = buf.slice(m[0].length);
    }
    const lead = buf.replace(/^\s+/, "");
    if (lead === "") return "";
    if (lead.startsWith("[") && !lead.includes("\n") && buf.length < OPEN_BRACKET_WAIT_LIMIT) {
      return "";
    }
    const h = buf.match(GEMINI_HANDOFF_RE);
    if (h && h.index !== undefined && GEMINI_PLANNING_CUE_RE.test(buf.slice(0, h.index))) {
      const after = buf.slice(h.index + h[0].length);
      committed = true;
      buf = "";
      return after.replace(/^\s+/, "");
    }
    committed = true;
    buf = "";
    return lead;
  };
}

// ── Context caching configuration ────────────────────────────────────────────
const CACHE_ENABLED = process.env.GEMINI_CACHE_ENABLED !== "false" && process.env.GEMINI_CACHE_ENABLED !== "0";
const CACHE_MIN_CHARS = Number(process.env.GEMINI_CACHE_MIN_CHARS) || 1024;
const CACHE_TTL_SECONDS = Number(process.env.GEMINI_CACHE_TTL_SECONDS) || 900;
// Distinct cache bases warmed per call. A code-switching caller needs one per
// language guard variant, so 3 was too tight for bilingual Indic presentations.
const CACHE_MAX_WARMS = Number(process.env.GEMINI_CACHE_MAX_WARMS) || 6;
const CACHE_WARM_WAIT_MS = Number(process.env.GEMINI_CACHE_WARM_WAIT_MS) || 250;
const REQUEST_TIMEOUT_MS = Math.max(10000, Number(process.env.GEMINI_REQUEST_TIMEOUT_MS) || 12000);
const GEMINI3_THINKING_HEADROOM = Number(process.env.GEMINI3_THINKING_HEADROOM) || 256;

/** Google 404s `gemini-2.5-flash` / `*-8b` and tells callers to use 3.6 Flash. */
export const DEFAULT_GOOGLE_LLM_MODEL = "gemini-3.6-flash";

const RETIRED_GOOGLE_LLM: Record<string, string> = {
  "gemini-2.5-flash": DEFAULT_GOOGLE_LLM_MODEL,
  "gemini-2.5-flash-8b": DEFAULT_GOOGLE_LLM_MODEL,
  "gemini-2.5-flash-lite": "gemini-3.5-flash-lite",
  "gemini-2.5-flash-preview-05-20": DEFAULT_GOOGLE_LLM_MODEL,
};

/** Map a saved agent model id to one the current Gemini API still serves. */
export function resolveGoogleLlmModel(raw: string | null | undefined): string {
  const t = (raw ?? "").trim().replace(/^models\//, "");
  if (!t) return DEFAULT_GOOGLE_LLM_MODEL;
  const aliased = RETIRED_GOOGLE_LLM[t];
  if (aliased) return aliased;
  if (/^gemini-2\.5-flash(-8b)?(-preview|$)/i.test(t)) return DEFAULT_GOOGLE_LLM_MODEL;
  return t;
}

/** Model-aware thinking config.
 *  Gemini 3.x: thinkingLevel:"minimal" (cannot fully disable).
 *  Gemini 2.x: thinkingBudget:0 (fully disables thinking). */
export function geminiThinkingConfig(model: string): Record<string, unknown> {
  return /^gemini-3(\.|-)/.test(model)
    ? { thinkingLevel: "minimal", includeThoughts: false }
    : { thinkingBudget: 0, includeThoughts: false };
}

/**
 * Google Gemini LLM adapter — uses current @google/genai SDK (not deprecated @google/generative-ai).
 *
 * Tool calling: function calls arrive as structured parts in the streaming response.
 * Detected via `part.functionCall` in each chunk's candidates[0].content.parts.
 * Fallback: <tool_call> text tag parser for models that serialize instead of using native calls.
 */
export class GoogleLLM implements LLMAdapter {
  private ai: GoogleGenAI;
  private apiKey: string;
  private model: string;
  private temperature: number | undefined;
  private maxTokens: number | undefined;

  // ── Per-call context-cache state ─────────────────────────────────────────
  // Keyed by cache base rather than a single slot: the pipeline bakes the
  // language guard into the base, so a caller who code-switches (very common on
  // Indic calls) produces two or three distinct bases. A single slot made those
  // bases evict each other and, once the warm budget ran out, disabled caching
  // for the rest of the call — every later turn then paid the full uncached
  // prompt. Keeping one CachedContent per base lets language flips hit cache.
  private caches = new Map<string, CachedContent>();
  private warmPromises = new Map<string, Promise<void>>();
  private cacheDisabled = false;
  private warmCount = 0;
  private cacheErrLogged = false;
  private cacheCreatedLogged = false;

  constructor(apiKey: string, model: string | null, genParams?: LLMGenerationParams) {
    this.apiKey = apiKey;
    this.ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: REQUEST_TIMEOUT_MS } });
    this.model = resolveGoogleLlmModel(model);
    const t = genParams?.temperature;
    this.temperature = typeof t === "number" && Number.isFinite(t) ? Math.min(2, Math.max(0, t)) : undefined;
    const mt = genParams?.maxTokens;
    this.maxTokens = typeof mt === "number" && Number.isFinite(mt) && mt > 0 ? Math.floor(mt) : undefined;
  }

  private toGeminiTools(tools?: ToolDefinition[]) {
    return toGeminiLiveTools(tools);
  }

  private buildGenerationConfig(): Partial<GenerateContentConfig> {
    const thinkingConfig = geminiThinkingConfig(this.model);
    return {
      thinkingConfig: thinkingConfig as GenerateContentConfig["thinkingConfig"],
      ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
      ...(this.maxTokens !== undefined
        ? { maxOutputTokens: this.maxTokens + (/^gemini-3(\.|-)/.test(this.model) ? GEMINI3_THINKING_HEADROOM : 0) }
        : {}),
    };
  }

  /** Map ConversationTurn[] → Content[] history + current message string. */
  private buildContents(messages: ConversationTurn[]): {
    history: Content[];
    currentContent: string;
  } {
    // Build history from all turns except the last.
    // Tool results remain plain user text because Gemini rejects functionResponse in
    // user-role messages. Model tool calls can still use native functionCall parts,
    // which avoids teaching Gemini to imitate a "[called ...]" text placeholder.
    const rawHistory = messages.slice(0, -1).map((m): Content => {
      if (m.role === "tool") {
        return { role: "user", parts: [{ text: `[Tool "${m.toolName ?? "tool"}" result: ${m.content}]` }] };
      }
      if (m.role === "assistant" && m.toolCalls?.length) {
        return {
          role: "model",
          parts: [
            ...(m.content?.trim() ? [{ text: m.content.trim() }] : []),
            ...m.toolCalls.map((tc) => ({
              functionCall: {
                name: tc.name,
                args: parseStoredToolArgs(tc.args),
              },
            })),
          ],
        };
      }
      return { role: m.role === "user" ? "user" : "model", parts: [{ text: m.content }] };
    });

    // Gemini requires history to start with 'user' role.
    const firstUser = rawHistory.findIndex((h) => h.role === "user");
    const history = firstUser === -1 ? [] : rawHistory.slice(firstUser);

    const lastTurn = messages[messages.length - 1];
    const currentContent = lastTurn?.role === "tool"
      ? `[Tool "${lastTurn.toolName ?? "tool"}" result: ${lastTurn.content}]`
      : (lastTurn?.content ?? "");

    return { history, currentContent };
  }

  private async drainStream(
    stream: AsyncGenerator<import("@google/genai").GenerateContentResponse>,
    onToken: (token: string) => void,
    onDone: (fullText: string, usage?: LLMUsage) => void,
    options?: {
      onToolCall?: (name: string, args: Record<string, unknown>) => void;
      onUsage?: (usage: LLMUsage) => void;
    }
  ): Promise<void> {
    let full = "";
    let usageMeta: GenerateContentResponseUsageMetadata | undefined;
    const preambleGuard = makeGeminiPreambleGuard();
    let toolCallName: string | undefined;
    let toolCallArgs: Record<string, unknown> | undefined;

    for await (const chunk of stream) {
      if (chunk.usageMetadata) usageMeta = chunk.usageMetadata;

      const parts = chunk.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        // Skip thought parts — never speak reasoning traces aloud.
        if ((part as { thought?: boolean }).thought === true) continue;

        // Structured function call — PRIMARY detection path.
        if (part.functionCall) {
          if (part.functionCall.name) toolCallName = part.functionCall.name;
          if (part.functionCall.args && Object.keys(part.functionCall.args).length > 0) {
            toolCallArgs = part.functionCall.args as Record<string, unknown>;
          }
        }

        if (part.text) {
          full += part.text;
          // Don't stream <tool_call> tags or tool call narration to TTS.
          if (!toolCallName && !/<tool_call>/i.test(full)) {
            const visible = preambleGuard(part.text);
            if (visible) onToken(visible);
          }
        }
      }
    }

    // Compute usage.
    const metaAny = usageMeta as Record<string, number | undefined> | undefined;
    const thoughtTokens = metaAny?.thoughtsTokenCount ?? 0;
    const usage: LLMUsage | undefined = usageMeta
      ? {
          inputTokens: usageMeta.promptTokenCount ?? 0,
          outputTokens: usageMeta.candidatesTokenCount ?? 0,
          cachedTokens: metaAny?.cachedContentTokenCount ?? 0,
        }
      : undefined;

    if (usage) options?.onUsage?.(usage);

    if (thoughtTokens > 0 && !/^gemini-3(\.|-)/.test(this.model)) {
      logger.warn(
        { model: this.model, thoughtTokens, evt: "gemini_unexpected_thinking" },
        "Gemini returned thought tokens despite thinkingBudget:0"
      );
    }

    // Dispatch tool call if detected.
    if (toolCallName && options?.onToolCall) {
      options.onToolCall(toolCallName, toolCallArgs ?? {});
      return;
    }

    // Fallbacks for models that serialize tool calls instead of returning native parts.
    const serializedCall = parseGeminiTagToolCall(full) ?? parseGeminiBracketToolCall(full);
    if (serializedCall && options?.onToolCall) {
      options.onToolCall(serializedCall.name, serializedCall.args);
      return;
    }

    onDone(stripGeminiThinkingPreamble(full), usage);
  }

  /**
   * `lastIsTool` turns the cache off for tool-result turns. The cached path
   * relocates the volatile tail into a synthetic `Caller: <content>` message,
   * which on a tool-result turn would attribute the tool's own output to the
   * caller. On presentation calls (a slide tool then a spoken follow-up) that
   * misattribution lands on every single slide change.
   */
  private cacheEligible(cacheBase: string | undefined, systemPrompt: string, lastIsTool: boolean): boolean {
    return (
      CACHE_ENABLED &&
      !this.cacheDisabled &&
      !lastIsTool &&
      this.model.startsWith("gemini") &&
      !!cacheBase &&
      cacheBase.length >= CACHE_MIN_CHARS &&
      systemPrompt.startsWith(cacheBase)
    );
  }

  private ensureCache(base: string, tools: Tool[] | undefined): void {
    if (this.cacheDisabled) return;
    if (this.caches.has(base) || this.warmPromises.has(base)) return;
    // Budget exhausted: stop warming NEW bases but keep serving the ones already
    // created. Disabling caching outright here is what made long multilingual
    // calls run fully uncached after the first few language switches.
    if (this.warmCount >= CACHE_MAX_WARMS) return;
    this.warmCount++;
    const warm = (async () => {
      try {
        const cc = await this.ai.caches.create({
          model: this.model,
          config: {
            systemInstruction: base,
            contents: [],
            ...(tools ? { tools } : {}),
            ttl: `${CACHE_TTL_SECONDS}s`,
            displayName: `voiceorch-${Date.now()}`,
          },
        });
        this.caches.set(base, cc);
        if (!this.cacheCreatedLogged) {
          this.cacheCreatedLogged = true;
          logger.info(
            { model: this.model, baseChars: base.length, cacheName: cc.name, ttlSeconds: CACHE_TTL_SECONDS, evt: "gemini_context_cache_created" },
            "Gemini context cache created"
          );
        }
      } catch (e) {
        this.handleCacheError(e);
      } finally {
        this.warmPromises.delete(base);
      }
    })();
    this.warmPromises.set(base, warm);
  }

  private bindClient(apiKey: string): void {
    this.apiKey = apiKey;
    this.ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: REQUEST_TIMEOUT_MS } });
    this.caches.clear();
    this.warmPromises.clear();
    this.cacheDisabled = false;
  }

  private async failoverIfQuota(err: unknown): Promise<boolean> {
    if (!isGeminiQuotaError(err)) return false;
    const pool = await loadManagedGeminiKeys();
    if (!pool.includes(this.apiKey)) return false;
    markGeminiKeyExhausted(this.apiKey);
    const next = pickGeminiKeyFromList(pool);
    if (!next || next === this.apiKey) return false;
    logger.warn(
      { from: maskGeminiKey(this.apiKey), to: maskGeminiKey(next), evt: "gemini_key_rotated" },
      "Gemini quota exhausted — switched to the next pool key",
    );
    this.bindClient(next);
    return true;
  }

  private handleCacheError(e: unknown): void {
    this.cacheDisabled = true;
    this.caches.clear();
    this.warmPromises.clear();
    if (!this.cacheErrLogged) {
      this.cacheErrLogged = true;
      logger.warn(
        { model: this.model, err: e instanceof Error ? e.message : String(e), evt: "gemini_context_cache_disabled" },
        "Gemini context caching disabled — falling back to uncached (expected on free-tier keys)"
      );
    }
  }

  warmContextCache(base: string, tools?: ToolDefinition[]): void {
    if (!CACHE_ENABLED || this.cacheDisabled) return;
    if (!this.model.startsWith("gemini")) return;
    if (!base || base.length < CACHE_MIN_CHARS) return;
    this.ensureCache(base, this.toGeminiTools(tools));
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
      cacheBase?: string;
    }
  ): Promise<void> {
    const geminiTools = this.toGeminiTools(options?.tools);
    const { history, currentContent } = this.buildContents(messages);

    // Tool config — AUTO lets the model decide when to call functions.
    const toolConfig = geminiTools
      ? { toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } } }
      : {};

    // ── Cached path ──────────────────────────────────────────────────────────
    const lastIsTool = messages[messages.length - 1]?.role === "tool";
    if (this.cacheEligible(options?.cacheBase, systemPrompt, lastIsTool)) {
      const base = options!.cacheBase!;
      this.ensureCache(base, geminiTools);

      const warm = this.warmPromises.get(base);
      if (warm) {
        try {
          await Promise.race([
            warm,
            new Promise<void>((r) => setTimeout(r, CACHE_WARM_WAIT_MS)),
          ]);
        } catch { /* handled inside ensureCache */ }
      }

      const cached = this.caches.get(base);
      if (cached?.name) {
        // Move volatile tail (per-turn KB, date/time, tool guides) to current message
        // so it has maximum recency; model sees identical text in a different position.
        const tail = systemPrompt.slice(base.length).replace(/^\s+/, "");
        const tailedContent = tail
          ? `[SYSTEM CONTEXT: ${tail}]\n\nCaller: ${currentContent}`
          : currentContent;

        const cachedContents: Content[] = [
          ...history,
          { role: "user", parts: [{ text: tailedContent }] },
        ];

        try {
          const stream = await this.ai.models.generateContentStream({
            model: this.model,
            contents: cachedContents,
            config: {
              ...this.buildGenerationConfig(),
              cachedContent: cached.name,
              ...(geminiTools ? { tools: geminiTools } : {}),
              ...toolConfig,
            },
          });
          await this.drainStream(stream, onToken, onDone, options);
          return;
        } catch (e) {
          this.handleCacheError(e);
          await this.failoverIfQuota(e);
          // Fall through to uncached path below.
        }
      }
    }

    // ── Uncached path ────────────────────────────────────────────────────────
    const contents: Content[] = [
      ...history,
      { role: "user", parts: [{ text: currentContent }] },
    ];

    const request = {
      model: this.model,
      contents,
      config: {
        ...this.buildGenerationConfig(),
        systemInstruction: systemPrompt,
        ...(geminiTools ? { tools: geminiTools } : {}),
        ...toolConfig,
      },
    };
    try {
      const stream = await this.ai.models.generateContentStream(request);
      await this.drainStream(stream, onToken, onDone, options);
    } catch (e) {
      if (!(await this.failoverIfQuota(e))) throw e;
      const stream = await this.ai.models.generateContentStream(request);
      await this.drainStream(stream, onToken, onDone, options);
    }
  }
}
