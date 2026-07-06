import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type { FunctionDeclarationSchema, FunctionDeclarationSchemaProperty, Part, Tool, CachedContent } from "@google/generative-ai";
import { GoogleAICacheManager } from "@google/generative-ai/server";
import { logger } from "../../../lib/logger.js";
import type { ConversationTurn, LLMAdapter, LLMGenerationParams, LLMUsage, ToolDefinition } from "../../types.js";

// ── Gemini-scoped reasoning/preamble backstop (GEMINI ONLY) ──────────────────
// Defense-in-depth for the rare case where Gemini emits its planning narration as
// plain UNTAGGED content (i.e. NOT flagged `thought:true` and NOT wrapped in any
// <think>/<reasoning> tag), so neither the adapter's thought-part discard nor the
// shared pipeline reasoning filters catch it. These helpers strip the leading
// planning preamble Gemini 2.5 tends to leak — bracketed state/context lines and a
// "New response …:" planning→reply handoff — before it reaches TTS/transcript.
//
// This MUST stay scoped to the Gemini adapter. Do NOT move it into the shared
// reasoningFilter used by every provider. It is deliberately conservative: it only
// touches a LEADING preamble and never holds back or truncates real reply text.

/** A COMPLETE leading bracketed state/context line, e.g. "[DATE/TIME CONTEXT] …\n". */
const GEMINI_BRACKET_LINE_RE = /^[ \t]*\[[^\]\n]+\][^\n]*\r?\n/;
/** Planning→reply handoff marker, matched AT the phrase so planning narration before it is captured. */
const GEMINI_HANDOFF_RE = /\bnew response\b[^:\n]*:[ \t]*/i;
/** First-person planning cues that gate the handoff cut (so a normal reply is never cut). */
const GEMINI_PLANNING_CUE_RE =
  /\b(the user|the caller|i should|i will|i'?ll|let me|based on|acknowledge|i need to|i'?m going to)\b/i;

/**
 * Whole-string strip used for the final assembled reply (transcript/history). Removes
 * leading bracketed state/context lines and, when planning narration precedes it, cuts
 * everything up to and including a "New response …:" handoff. Conservative: a bracketed
 * token or the phrase appearing inside a genuine reply is never touched.
 */
export function stripGeminiThinkingPreamble(text: string): string {
  if (!text) return text;
  let out = text;
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
 * Streaming counterpart of stripGeminiThinkingPreamble. Returns the visible (spoken)
 * portion of each token. State is retained across calls; create one per generation.
 *
 * Safety contract — it NEVER holds back or truncates real reply text:
 *   • Strips COMPLETE leading bracketed lines as they finish.
 *   • If a "New response …:" handoff is ALREADY visible (with planning cues before it),
 *     drops the preamble up to it, then passes the rest through.
 *   • Otherwise releases reply text immediately and switches to pass-through. It never
 *     waits for a handoff that may not arrive, so a legitimate reply is never delayed.
 */
export function makeGeminiPreambleGuard(): (token: string) => string {
  let committed = false;
  let buf = "";
  // Bound on how long we wait for an unterminated leading bracket line to close.
  const OPEN_BRACKET_WAIT_LIMIT = 200;
  return function guard(token: string): string {
    if (committed) return token;
    buf += token;
    // Strip any COMPLETE leading bracketed lines as they finish.
    for (;;) {
      const m = buf.match(GEMINI_BRACKET_LINE_RE);
      if (!m) break;
      buf = buf.slice(m[0].length);
    }
    const lead = buf.replace(/^\s+/, "");
    // Only whitespace / stripped brackets so far → wait for more.
    if (lead === "") return "";
    // Still building an unterminated leading bracket line → wait so we can strip it,
    // but give up (release as-is) past the bound so a reply can never be truncated.
    if (lead.startsWith("[") && !lead.includes("\n") && buf.length < OPEN_BRACKET_WAIT_LIMIT) {
      return "";
    }
    // A handoff marker is already visible and planning narration precedes it → drop it.
    const h = buf.match(GEMINI_HANDOFF_RE);
    if (h && h.index !== undefined && GEMINI_PLANNING_CUE_RE.test(buf.slice(0, h.index))) {
      const after = buf.slice(h.index + h[0].length);
      committed = true;
      buf = "";
      return after.replace(/^\s+/, "");
    }
    // Real reply text — release now and pass everything through from here on.
    committed = true;
    buf = "";
    return lead;
  };
}

// ── Gemini explicit context caching (GEMINI ONLY) ────────────────────────────
// Gemini reprocesses the ENTIRE system instruction on every turn. For a voice
// agent that instruction is a large static block (baked KB + base language/
// instruction rules + caller-memory + tool declarations) that is byte-identical
// turn-over-turn, so paying to re-encode it each turn is the single biggest,
// most controllable slice of LLM TTFT.
//
// We register that static prefix ONCE per call as a `CachedContent` and reuse it
// via getGenerativeModelFromCachedContent(). Only the small volatile tail
// (per-turn KB slice, gender directive, tool guides, [TOOL CALLING] block, and
// [CURRENT DATE & TIME]) is sent per turn — prepended to the current user message
// so no history-role alternation is disturbed. The total instruction TEXT the
// model sees is unchanged; only the cached prefix moves from the systemInstruction
// slot to a server-side cache, and the volatile tail moves from the end of the
// systemInstruction to the start of the current user turn (better recency for the
// date/time + retrieved KB context, no change for language enforcement which stays
// in the cached prefix).
//
// EVERYTHING here is best-effort and gated: on ANY cache-create/lookup failure
// (notably free-tier keys where TotalCachedContentStorageTokensPerModelFreeTier
// = 0, which returns 429), caching disables itself for the rest of the call and
// the adapter falls back to the exact uncached path — ZERO behaviour change.
const CACHE_ENABLED = process.env.GEMINI_CACHE_ENABLED !== "false" && process.env.GEMINI_CACHE_ENABLED !== "0";
// gemini-2.5-flash requires a minimum cached-content size (~1024 tokens); below
// this a create call errors, so skip caching for tiny prompts. ~4096 chars is a
// safe floor (well above the token minimum) — real agent prompts are far larger.
const CACHE_MIN_CHARS = Number(process.env.GEMINI_CACHE_MIN_CHARS) || 4096;
// TTL sized to comfortably outlast a typical call; on expiry mid-call the next
// cached generation fails and we transparently fall back to uncached.
const CACHE_TTL_SECONDS = Number(process.env.GEMINI_CACHE_TTL_SECONDS) || 900;
// Cap how many times a single call will (re)create a cache. The base only changes
// when the per-turn language guard flips (auto-detect agents on caller code-switch);
// after a few flips we give up and stay uncached rather than churn the cache API.
const CACHE_MAX_WARMS = Number(process.env.GEMINI_CACHE_MAX_WARMS) || 3;

/**
 * Google Gemini — streaming generative AI with function calling
 * Models: gemini-2.5-flash-lite (fastest), gemini-2.5-flash (recommended), gemini-2.5-pro, gemini-1.5-flash
 *
 * Tool calling: supported on all Gemini 1.5+ and 2.x models.
 * Gemini uses its own FunctionDeclaration format (type values are uppercase).
 * Function calls are not streamed token-by-token — they arrive in the final
 * response after the stream completes, so we check response.functionCalls()
 * after draining the stream.
 */
export class GoogleLLM implements LLMAdapter {
  private genAI: GoogleGenerativeAI;
  private apiKey: string;
  private model: string;
  private temperature: number | undefined;

  // ── Per-call context-cache state ───────────────────────────────────────────
  private cacheManager: GoogleAICacheManager | null = null;
  private cachedContent: CachedContent | null = null;
  /** The exact systemInstruction text currently held in `cachedContent`. */
  private cachedBase: string | null = null;
  /** In-flight warm so concurrent turns don't create duplicate caches. */
  private warmPromise: Promise<void> | null = null;
  /** Latch: once true, all cache logic is skipped for the rest of the call. */
  private cacheDisabled = false;
  private warmCount = 0;
  private cacheErrLogged = false;
  private cacheCreatedLogged = false;

  constructor(apiKey: string, model: string | null, genParams?: LLMGenerationParams) {
    this.apiKey = apiKey;
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = model ?? "gemini-2.5-flash";
    const t = genParams?.temperature;
    this.temperature = typeof t === "number" && Number.isFinite(t) ? Math.min(2, Math.max(0, t)) : undefined;
  }

  /** Convert our ToolDefinition[] to Gemini's FunctionDeclaration (Tool[]) format.
   *  Gemini requires property types to be uppercase ("STRING", "NUMBER", etc.)
   *  and uses "OBJECT" not "object" for the top-level parameters type. */
  private toGeminiTools(tools?: ToolDefinition[]): Tool[] | undefined {
    if (!tools?.length) return undefined;
    return [{
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: {
          type: SchemaType.OBJECT,
          properties: Object.fromEntries(
            Object.entries(t.parameters.properties).map(([key, val]) => [
              key,
              {
                type: (SchemaType as Record<string, SchemaType>)[val.type.toUpperCase()] ?? SchemaType.STRING,
                description: val.description,
                ...(val.enum ? { enum: val.enum, format: "enum" } : {}),
              } as FunctionDeclarationSchemaProperty,
            ])
          ) as FunctionDeclarationSchema["properties"],
          required: t.parameters.required ?? [],
        } as FunctionDeclarationSchema,
      })),
    }];
  }

  private get generationConfig() {
    // Disable thinking for voice — adds 2–5 s TTFT with no benefit for short
    // conversational turns. thinkingBudget:0 turns thinking off; includeThoughts:
    // false guarantees the API never returns reasoning ("thought") parts. Both are
    // passed through to the REST endpoint by the legacy SDK (which does not type them).
    return {
      thinkingConfig: { thinkingBudget: 0, includeThoughts: false },
      ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
    } as Record<string, unknown>;
  }

  /** Map ConversationTurn[] → Gemini history + current message (shared by both
   *  the cached and uncached paths so their behaviour is identical). */
  private buildHistory(messages: ConversationTurn[]): {
    history: { role: "user" | "model"; parts: Part[] }[];
    lastMessage: string | Part[];
    lastIsTool: boolean;
  } {
    // Build chat history (all turns except the last) — map tool turns to
    // Gemini's functionCall/functionResponse format so chained tool calls work.
    const rawHistory = messages.slice(0, -1).map((m) => {
      if (m.role === "tool") {
        return {
          role: "user" as const,
          parts: [{ functionResponse: { name: m.toolName ?? "tool", response: { result: m.content } } }] as Part[],
        };
      }
      if (m.role === "assistant" && m.toolCalls?.length) {
        return {
          role: "model" as const,
          parts: m.toolCalls.map((tc) => ({
            functionCall: {
              name: tc.name,
              args: (() => { try { return JSON.parse(tc.args || "{}") as Record<string, unknown>; } catch { return {}; } })(),
            },
          })) as Part[],
        };
      }
      return {
        role: m.role === "user" ? ("user" as const) : ("model" as const),
        parts: [{ text: m.content }] as Part[],
      };
    });

    // Gemini requires history to start with 'user' role.
    // If the agent sent a greeting before any user turn, drop leading model
    // entries so startChat() doesn't throw.
    const firstUser = rawHistory.findIndex((h) => h.role === "user");
    const history = firstUser === -1 ? [] : rawHistory.slice(firstUser);

    // Build the "current" message — if it's a tool result, send as a FunctionResponse part.
    const lastTurn = messages[messages.length - 1];
    const lastIsTool = lastTurn?.role === "tool";
    const lastMessage: string | Part[] = lastIsTool
      ? [{ functionResponse: { name: lastTurn.toolName ?? "tool", response: { result: lastTurn.content } } }]
      : (lastTurn?.content ?? "");

    return { history, lastMessage, lastIsTool };
  }

  /** Drain the streaming response — identical for cached and uncached paths. */
  private async drainResult(
    result: { stream: AsyncGenerator<import("@google/generative-ai").EnhancedGenerateContentResponse>; response: Promise<import("@google/generative-ai").EnhancedGenerateContentResponse> },
    onToken: (token: string) => void,
    onDone: (fullText: string, usage?: LLMUsage) => void,
    options?: {
      onToolCall?: (name: string, args: Record<string, unknown>) => void;
      onUsage?: (usage: LLMUsage) => void;
    }
  ): Promise<void> {
    let full = "";
    const preambleGuard = makeGeminiPreambleGuard();
    for await (const chunk of result.stream) {
      const parts = chunk.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        // Gemini returns reasoning as parts flagged `thought:true`. They are NOT
        // reply text — never accumulate them and never forward them to onToken, or
        // the model's chain-of-thought gets spoken and shown in the transcript.
        // (The SDK type omits `thought`, so read it defensively.)
        if ((part as { thought?: boolean }).thought === true) continue;
        if (part.text) {
          full += part.text;
          // Gemini-scoped backstop for untagged planning narration leaking as plain
          // content. Yields nothing while suppressing a leading preamble.
          const visible = preambleGuard(part.text);
          if (visible) onToken(visible);
        }
        // part.functionCall is handled below via response.functionCalls()
      }
    }

    // After stream, resolve the final response and check for function calls
    const response = await result.response;
    const functionCalls = response.functionCalls();

    const meta = response.usageMetadata;
    const usage: LLMUsage | undefined = meta
      ? {
          inputTokens: meta.promptTokenCount ?? 0,
          outputTokens: meta.candidatesTokenCount ?? 0,
          // Populated on both the explicit-cache path and Gemini implicit caching,
          // so the pipeline's "LLM prompt cache" instrumentation reflects hits.
          cachedTokens: (meta as { cachedContentTokenCount?: number }).cachedContentTokenCount ?? 0,
        }
      : undefined;

    if (usage) options?.onUsage?.(usage);

    if (functionCalls?.length && options?.onToolCall) {
      const fc = functionCalls[0];
      options.onToolCall(fc.name, (fc.args ?? {}) as Record<string, unknown>);
    } else {
      // Strip any leading planning preamble from the final assembled reply so the
      // stored transcript/history matches the (already-guarded) spoken stream.
      onDone(stripGeminiThinkingPreamble(full), usage);
    }
  }

  /** Is the cached path usable for this turn? */
  private cacheEligible(cacheBase: string | undefined, systemPrompt: string, lastIsTool: boolean): cacheBase is string {
    return (
      CACHE_ENABLED &&
      !this.cacheDisabled &&
      this.model.startsWith("gemini") &&
      !!cacheBase &&
      cacheBase.length >= CACHE_MIN_CHARS &&
      // Guaranteed by the caller, re-checked defensively: the volatile tail is
      // exactly systemPrompt.slice(cacheBase.length).
      systemPrompt.startsWith(cacheBase) &&
      // Tool-result turns send a FunctionResponse as the current message; keep
      // them on the exact uncached path rather than mixing text + functionResponse.
      !lastIsTool
    );
  }

  /** Best-effort, non-blocking (de-duplicated) creation of the context cache. */
  private ensureCache(base: string, tools: Tool[] | undefined): void {
    if (this.cacheDisabled) return;
    if (this.cachedContent && this.cachedBase === base) return; // already warm for this base
    if (this.warmPromise) return; // in-flight
    if (this.warmCount >= CACHE_MAX_WARMS) { this.cacheDisabled = true; return; }
    this.warmCount++;
    this.warmPromise = (async () => {
      try {
        if (!this.cacheManager) this.cacheManager = new GoogleAICacheManager(this.apiKey);
        const cc = await this.cacheManager.create({
          model: this.model,
          systemInstruction: base,
          contents: [],
          ...(tools ? { tools } : {}),
          ttlSeconds: CACHE_TTL_SECONDS,
          displayName: `voiceorch-${Date.now()}`,
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

  /** Any cache-create/lookup failure disables caching for the rest of the call.
   *  The most common cause is a free-tier key (limit=0 → 429); disabling avoids
   *  hammering the API and guarantees the uncached path runs unchanged. */
  private handleCacheError(e: unknown): void {
    this.cacheDisabled = true;
    this.cachedContent = null;
    this.cachedBase = null;
    if (!this.cacheErrLogged) {
      this.cacheErrLogged = true;
      logger.warn(
        { model: this.model, err: e instanceof Error ? e.message : String(e), evt: "gemini_context_cache_disabled" },
        "Gemini context caching disabled for this call — falling back to uncached (this is expected on free-tier keys)"
      );
    }
  }

  /** Pre-create the cache before turn 1 (called from the pipeline during the
   *  greeting) so the first real turn already benefits. Best-effort, non-blocking. */
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
    const { history, lastMessage, lastIsTool } = this.buildHistory(messages);

    // ── Cached path (Gemini explicit context caching) ──────────────────────────
    if (this.cacheEligible(options?.cacheBase, systemPrompt, lastIsTool)) {
      const base = options!.cacheBase!;
      // Kick off (or reuse) the cache. Non-blocking: this turn only uses it if a
      // previous warm already completed for this exact base.
      this.ensureCache(base, geminiTools);
      if (this.cachedContent && this.cachedBase === base) {
        // Volatile tail = everything after the cached static prefix (per-turn KB
        // slice, gender directive, tool guides, [TOOL CALLING], date/time). Move
        // it to the front of the current user message — same text, same order
        // relative to the cached prefix, now with better recency next to the query.
        const tail = systemPrompt.slice(base.length).replace(/^\s+/, "");
        const currentText = typeof lastMessage === "string" ? lastMessage : "";
        const cachedMsg = tail ? `${tail}\n\n${currentText}` : currentText;

        let result: Awaited<ReturnType<import("@google/generative-ai").ChatSession["sendMessageStream"]>> | null = null;
        try {
          // Model, tools and systemInstruction all come from the cache — pass only
          // generationConfig (the SDK forbids re-declaring what the cache holds).
          const model = this.genAI.getGenerativeModelFromCachedContent(this.cachedContent, {
            generationConfig: this.generationConfig as never,
          });
          const chat = model.startChat({ history });
          // Setup / first-byte errors (e.g. cache expired) surface here BEFORE any
          // token is emitted, so falling back to the uncached path cannot double-speak.
          result = await chat.sendMessageStream(cachedMsg);
        } catch (e) {
          this.handleCacheError(e);
          result = null; // fall through to uncached path below
        }
        if (result) {
          // Mid-stream errors here propagate unchanged (the pipeline's retry/fallback
          // handles them); we do NOT retry uncached once tokens may have streamed.
          await this.drainResult(result, onToken, onDone, options);
          return;
        }
      }
    }

    // ── Uncached path (unchanged behaviour) ────────────────────────────────────
    const gemini = this.genAI.getGenerativeModel({
      model: this.model,
      systemInstruction: systemPrompt,
      ...(geminiTools ? { tools: geminiTools } : {}),
      generationConfig: this.generationConfig as never,
    });
    const chat = gemini.startChat({ history });
    const result = await chat.sendMessageStream(lastMessage);
    await this.drainResult(result, onToken, onDone, options);
  }
}
