import { GoogleGenAI, Type, FunctionCallingConfigMode } from "@google/genai";
import type { Content, Tool, FunctionDeclaration, Schema, GenerateContentConfig, CachedContent, GenerateContentResponseUsageMetadata } from "@google/genai";
import { logger } from "../../../lib/logger.js";
import type { ConversationTurn, LLMAdapter, LLMGenerationParams, LLMUsage, ToolDefinition } from "../../types.js";

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
const CACHE_MAX_WARMS = Number(process.env.GEMINI_CACHE_MAX_WARMS) || 3;
const CACHE_WARM_WAIT_MS = 3000;
const REQUEST_TIMEOUT_MS = Math.max(10000, Number(process.env.GEMINI_REQUEST_TIMEOUT_MS) || 12000);
const GEMINI3_THINKING_HEADROOM = Number(process.env.GEMINI3_THINKING_HEADROOM) || 256;

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
  private model: string;
  private temperature: number | undefined;
  private maxTokens: number | undefined;

  // ── Per-call context-cache state ─────────────────────────────────────────
  private cachedContent: CachedContent | null = null;
  private cachedBase: string | null = null;
  private warmPromise: Promise<void> | null = null;
  private cacheDisabled = false;
  private warmCount = 0;
  private cacheErrLogged = false;
  private cacheCreatedLogged = false;

  constructor(apiKey: string, model: string | null, genParams?: LLMGenerationParams) {
    this.ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: REQUEST_TIMEOUT_MS } });
    this.model = model ?? "gemini-3.6-flash";
    const t = genParams?.temperature;
    this.temperature = typeof t === "number" && Number.isFinite(t) ? Math.min(2, Math.max(0, t)) : undefined;
    const mt = genParams?.maxTokens;
    this.maxTokens = typeof mt === "number" && Number.isFinite(mt) && mt > 0 ? Math.floor(mt) : undefined;
  }

  /**
   * Convert our ToolDefinition[] to new SDK Tool[]/FunctionDeclaration[] format.
   * New SDK Type enum: uppercase strings ("STRING", "OBJECT", "INTEGER", etc.)
   */
  private toGeminiTools(tools?: ToolDefinition[]): Tool[] | undefined {
    if (!tools?.length) return undefined;
    const declarations: FunctionDeclaration[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: {
        type: Type.OBJECT,
        properties: Object.fromEntries(
          Object.entries(t.parameters.properties).map(([key, val]) => [
            key,
            {
              type: (Type as Record<string, Type>)[(val.type || "string").toUpperCase()] ?? Type.STRING,
              description: val.description,
              ...(val.enum ? { enum: val.enum, format: "enum" } : {}),
            } as Schema,
          ])
        ),
        required: t.parameters.required ?? [],
      } as Schema,
    }));
    return [{ functionDeclarations: declarations }];
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
    // Tool turns flattened to plain text (functionResponse in user role causes API errors).
    const rawHistory = messages.slice(0, -1).map((m): Content => {
      if (m.role === "tool") {
        return { role: "user", parts: [{ text: `[Tool "${m.toolName ?? "tool"}" result: ${m.content}]` }] };
      }
      if (m.role === "assistant" && m.toolCalls?.length) {
        const spokenText = m.content?.trim() || `[called ${m.toolCalls.map((tc) => tc.name).join(", ")}]`;
        return { role: "model", parts: [{ text: spokenText }] };
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

    // Fallback: <tool_call> text tag (e.g. gemini-3.5-flash-lite serializes instead of native calls).
    const tagParsed = parseGeminiTagToolCall(full);
    if (tagParsed && options?.onToolCall) {
      options.onToolCall(tagParsed.name, tagParsed.args);
      return;
    }

    onDone(stripGeminiThinkingPreamble(full), usage);
  }

  private cacheEligible(cacheBase: string | undefined, systemPrompt: string): boolean {
    return (
      CACHE_ENABLED &&
      !this.cacheDisabled &&
      this.model.startsWith("gemini") &&
      !!cacheBase &&
      cacheBase.length >= CACHE_MIN_CHARS &&
      systemPrompt.startsWith(cacheBase)
    );
  }

  private ensureCache(base: string, tools: Tool[] | undefined): void {
    if (this.cacheDisabled) return;
    if (this.cachedContent && this.cachedBase === base) return;
    if (this.warmPromise) return;
    if (this.warmCount >= CACHE_MAX_WARMS) { this.cacheDisabled = true; return; }
    this.warmCount++;
    this.warmPromise = (async () => {
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
        this.cachedContent = cc;
        this.cachedBase = base;
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
        this.warmPromise = null;
      }
    })();
  }

  private handleCacheError(e: unknown): void {
    this.cacheDisabled = true;
    this.cachedContent = null;
    this.cachedBase = null;
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
    if (this.cacheEligible(options?.cacheBase, systemPrompt)) {
      const base = options!.cacheBase!;
      this.ensureCache(base, geminiTools);

      if (this.warmPromise) {
        try {
          await Promise.race([
            this.warmPromise,
            new Promise<void>((r) => setTimeout(r, CACHE_WARM_WAIT_MS)),
          ]);
        } catch { /* handled inside ensureCache */ }
      }

      if (this.cachedContent?.name && this.cachedBase === base) {
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
              cachedContent: this.cachedContent.name,
              ...(geminiTools ? { tools: geminiTools } : {}),
              ...toolConfig,
            },
          });
          await this.drainStream(stream, onToken, onDone, options);
          return;
        } catch (e) {
          this.handleCacheError(e);
          // Fall through to uncached path below.
        }
      }
    }

    // ── Uncached path ────────────────────────────────────────────────────────
    const contents: Content[] = [
      ...history,
      { role: "user", parts: [{ text: currentContent }] },
    ];

    const stream = await this.ai.models.generateContentStream({
      model: this.model,
      contents,
      config: {
        ...this.buildGenerationConfig(),
        systemInstruction: systemPrompt,
        ...(geminiTools ? { tools: geminiTools } : {}),
        ...toolConfig,
      },
    });
    await this.drainStream(stream, onToken, onDone, options);
  }
}
