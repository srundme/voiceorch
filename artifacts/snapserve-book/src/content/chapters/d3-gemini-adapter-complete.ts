import type { Chapter } from "../types";

export const geminiAdapterComplete: Chapter = {
  slug: "gemini-adapter-complete",
  moduleId: "d3",
  number: "19.3",
  title: "The Gemini Adapter, Top to Bottom",
  summary:
    "google.ts walked completely: model-aware thinking config, explicit context caching, functionResponse flattening, the streaming drain, and thought-part discard.",
  estMinutes: 24,
  fileRef: "artifacts/api-server/src/orchestration/adapters/llm/google.ts",
  prerequisites: ["llm-pipeline-path", "prompt-assembly"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "Gemini is Google's LLM family, and its adapter (`google.ts`) is the most complex LLM adapter in the codebase. Why? Because Gemini's SDK does not use the OpenAI shape, it 'thinks' by default (which adds latency), it reprocesses the whole system prompt every turn (which costs money and time), and it rejects the natural way of representing tool results. Each of those forced a workaround, and this chapter reads every one of them.",
        "We walk the file roughly top to bottom, skipping only the import list. By the end you'll understand the four big themes: (1) model-aware **thinking config**, (2) explicit **context caching**, (3) **functionResponse flattening**, and (4) the shared **streaming drain** with thought-part discard.",
      ],
    },
    {
      kind: "concept",
      title: "Four Gemini quirks that shaped this adapter",
      body: [
        "**Thinking.** Gemini 'thinks' (internal reasoning) before replying. For a chatty voice turn that's 2–5 seconds of pure latency for no benefit. Gemini 2.x can turn it off (`thinkingBudget: 0`); Gemini 3.x cannot fully disable it (`thinkingLevel: \"minimal\"` is the floor).",
        "**Context caching.** Gemini reprocesses the ENTIRE system instruction every turn. For a voice agent that's a large static block. We register that block once as a server-side `CachedContent` and reuse it.",
        "**functionResponse rejection.** Current Gemini rejects `functionResponse` parts inside a `user` message. So tool-call turns are flattened into plain text.",
        "**Thought parts.** Gemini streams its reasoning back as parts flagged `thought: true`. If we forwarded those, the caller would hear the model's chain-of-thought.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/llm/google.ts",
      language: "typescript",
      intro:
        "The model-aware thinking config. The two fields are INCOMPATIBLE — sending the wrong one (or both) errors — so this helper is the single source of truth for every Gemini call site.",
      code: `export function geminiThinkingConfig(model: string): Record<string, unknown> {
  return /^gemini-3(\\.|-)/.test(model)
    ? { thinkingLevel: "minimal", includeThoughts: false }
    : { thinkingBudget: 0, includeThoughts: false };
}`,
      lines: [
        {
          lines: "2-3",
          label: "Gemini 3.x branch",
          explanation:
            "A model id starting `gemini-3.` or `gemini-3-` uses the newer `thinkingLevel` knob. `\"minimal\"` is the lowest — 3.x cannot be fully silenced, so a small amount of thinking is expected.",
        },
        {
          lines: "4",
          label: "Gemini 2.x branch",
          explanation:
            "Older 2.x models use the numeric `thinkingBudget: 0`, which turns thinking off entirely. Mixing the two fields errors, which is why this decision is centralized.",
        },
        {
          lines: "2-4",
          label: "includeThoughts: false",
          explanation:
            "Both branches set `includeThoughts: false`, so the API won't return reasoning ('thought') parts. That's a second line of defense on top of the streaming discard we'll see later.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "On Gemini 3.x, thought tokens eat your reply budget",
      body: [
        "On 3.x, thought tokens COUNT toward `maxOutputTokens`, and thinking can't be fully disabled. If you send the agent's configured cap as-is, the model spends some of it thinking and the visible reply gets cut mid-sentence — exactly the bug that appeared after the 2.x→3.x upgrade.",
        "The fix: pad the wire-level cap on 3.x by `GEMINI3_THINKING_HEADROOM` (default 256 tokens) so the configured value approximates the SPOKEN-reply budget. On 2.x, thinking is off, so the exact value is sent.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/llm/google.ts",
      language: "typescript",
      intro:
        "The generationConfig getter assembles thinking config, temperature, and the padded maxOutputTokens.",
      code: `  private get generationConfig() {
    const thinkingConfig = geminiThinkingConfig(this.model);
    return {
      thinkingConfig,
      ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
      ...(this.maxTokens !== undefined
        ? { maxOutputTokens: this.maxTokens + (/^gemini-3(\\.|-)/.test(this.model) ? GEMINI3_THINKING_HEADROOM : 0) }
        : {}),
    } as Record<string, unknown>;
  }`,
      lines: [
        {
          lines: "2-4",
          label: "thinking + temperature",
          explanation:
            "The thinking config is always present; temperature is only included when the agent configured one (otherwise Gemini's own default applies).",
        },
        {
          lines: "6-8",
          label: "the headroom pad",
          explanation:
            "When a cap is set, 3.x models get `maxTokens + 256` on the wire so thought tokens don't steal from the spoken reply. 2.x gets the exact `maxTokens`.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/llm/google.ts",
      language: "typescript",
      intro:
        "Tool conversion. Gemini uses its OWN FunctionDeclaration format, with UPPERCASE type names — nothing like OpenAI's schema.",
      code: `  private toGeminiTools(tools?: ToolDefinition[]): Tool[] | undefined {
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
  }`,
      lines: [
        {
          lines: "8",
          label: "OBJECT, not object",
          explanation:
            "Gemini's top-level parameters type must be the uppercase `SchemaType.OBJECT`. Lowercase `\"object\"` (OpenAI style) is rejected.",
        },
        {
          lines: "13",
          label: "uppercasing property types",
          explanation:
            "Each property's type is looked up by uppercasing our type name (`\"string\"` → `\"STRING\"`). Anything unknown safely defaults to `STRING` rather than crashing.",
        },
        {
          lines: "14",
          label: "enum → JSON-mode-ish format",
          explanation:
            "When a parameter has an enum, both `enum` and `format: \"enum\"` are set so Gemini constrains the value to the allowed list — Gemini's flavour of constrained/JSON-mode output for tool args.",
        },
      ],
    },
    {
      kind: "prose",
      heading: "Context caching",
      paragraphs: [
        "The single biggest, most controllable slice of Gemini's first-token latency is re-encoding the large static system instruction every turn. The adapter registers that static prefix once per call as a `CachedContent` and reuses it. Only the small volatile tail is sent per turn. Everything here is best-effort: on ANY cache failure (notably free-tier keys, which return 429), caching disables itself and the adapter falls back to the exact uncached path with zero behaviour change.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/llm/google.ts",
      language: "typescript",
      intro:
        "The cache-eligibility check. The volatile tail must be EXACTLY the suffix after the cached base — enforced by a startsWith guard.",
      code: `  private cacheEligible(cacheBase: string | undefined, systemPrompt: string, lastIsTool: boolean): cacheBase is string {
    return (
      CACHE_ENABLED &&
      !this.cacheDisabled &&
      this.model.startsWith("gemini") &&
      !!cacheBase &&
      cacheBase.length >= CACHE_MIN_CHARS &&
      systemPrompt.startsWith(cacheBase) &&
      !lastIsTool
    );
  }`,
      lines: [
        {
          lines: "3-4",
          label: "gates",
          explanation:
            "Caching must be enabled, not already disabled for this call, and the model must be Gemini. Any of these false → skip caching.",
        },
        {
          lines: "7",
          label: "minimum size",
          explanation:
            "`gemini-2.5-flash` requires a minimum cached-content size (~1024 tokens); below `CACHE_MIN_CHARS` a create call errors, so tiny prompts skip caching.",
        },
        {
          lines: "8",
          label: "the startsWith guard",
          explanation:
            "The crucial check: the full system prompt must START WITH the cached base. If a staged prompt replaced the prompt (breaking the prefix), this is false and the turn safely runs uncached — no crash, no wrong cache.",
        },
        {
          lines: "9",
          label: "not a tool result",
          explanation:
            "Tool-result turns send a different current message; they stay on the exact uncached path rather than mixing text with a cache.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/llm/google.ts",
      language: "typescript",
      intro:
        "Any cache failure latches caching off for the rest of the call. This is why free-tier keys still work perfectly — they just run uncached.",
      code: `  private handleCacheError(e: unknown): void {
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
  }`,
      lines: [
        {
          lines: "2-4",
          label: "latch off",
          explanation:
            "`cacheDisabled = true` is a one-way latch: once any create/lookup fails, no more cache logic runs this call. The cached content and base are cleared.",
        },
        {
          lines: "5-11",
          label: "log once",
          explanation:
            "The warning fires only once per call (`cacheErrLogged`) so a free-tier key doesn't spam the logs every turn. The message explicitly says free-tier failure is expected.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/llm/google.ts",
      language: "typescript",
      intro:
        "The cached path in chat(): the volatile tail is moved to the FRONT of the current user message, so the cached prefix's text order is preserved but the tail gets better recency.",
      code: `      const tail = systemPrompt.slice(base.length).replace(/^\\s+/, "");
      const currentText = typeof lastMessage === "string" ? lastMessage : "";
      const cachedMsg = tail ? \`[SYSTEM CONTEXT: \${tail}]\\n\\nCaller: \${currentText}\` : currentText;
      // ...
      const model = this.genAI.getGenerativeModelFromCachedContent(
        this.cachedContent,
        { generationConfig: this.generationConfig as never },
        this.requestOptions
      );
      const chat = model.startChat({ history });
      result = await chat.sendMessageStream(cachedMsg);`,
      lines: [
        {
          lines: "1-3",
          label: "volatile tail → user message",
          explanation:
            "The tail (per-turn KB, gender directive, tool guides, date/time) is everything after the cached base. It's prefixed to the current user message as `[SYSTEM CONTEXT: …]` so it isn't lost — same text, better recency next to the query.",
        },
        {
          lines: "5-9",
          label: "model FROM cached content",
          explanation:
            "`getGenerativeModelFromCachedContent` builds a model bound to the cache. Model, tools, and systemInstruction all come from the cache — the SDK forbids re-declaring them, so only `generationConfig` is passed.",
        },
        {
          lines: "10-11",
          label: "stream it",
          explanation:
            "Setup and first-byte errors surface HERE, before any token streams, so a fall-back to uncached can't double-speak.",
        },
      ],
    },
    {
      kind: "prose",
      heading: "functionResponse flattening",
      paragraphs: [
        "Gemini requires a strict user→model→user alternation and rejects `functionResponse` parts inside a `user` message. So `buildHistory()` flattens tool turns into plain text: an assistant-with-toolCalls turn becomes model text (its spoken filler, or a bracketed placeholder), and a tool-result turn becomes user text `[Tool \"name\" result: …]`. The tool-result message already contains the full instruction, so the model responds correctly.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/llm/google.ts",
      language: "typescript",
      intro:
        "The history flattening. Each tool-related turn is converted to a plain text part so the alternation constraint always holds.",
      code: `    const rawHistory = messages.slice(0, -1).map((m) => {
      if (m.role === "tool") {
        return {
          role: "user" as const,
          parts: [{ text: \`[Tool "\${m.toolName ?? "tool"}" result: \${m.content}]\` }] as Part[],
        };
      }
      if (m.role === "assistant" && m.toolCalls?.length) {
        const spokenText = m.content?.trim() || \`[called \${m.toolCalls.map((tc) => tc.name).join(", ")}]\`;
        return { role: "model" as const, parts: [{ text: spokenText }] as Part[] };
      }
      return {
        role: m.role === "user" ? ("user" as const) : ("model" as const),
        parts: [{ text: m.content }] as Part[],
      };
    });`,
      lines: [
        {
          lines: "2-6",
          label: "tool result → user text",
          explanation:
            "A tool-result turn becomes a plain `user` message `[Tool \"name\" result: …]`. This dodges the 'functionResponse in user role' rejection entirely.",
        },
        {
          lines: "8-10",
          label: "tool call → model text",
          explanation:
            "An assistant turn that called a tool becomes a `model` text turn — its spoken filler if any, else a bracketed `[called …]` label so the model turn is never empty (some SDK versions also reject empty model turns).",
        },
        {
          lines: "12-15",
          label: "ordinary turns",
          explanation:
            "Plain user/assistant turns map straight to `user`/`model` text parts.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/llm/google.ts",
      language: "typescript",
      intro:
        "The streaming drain — shared by cached and uncached paths. Note the thought-part discard and the preamble guard.",
      code: `    let full = "";
    const preambleGuard = makeGeminiPreambleGuard();
    for await (const chunk of result.stream) {
      const parts = chunk.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        if ((part as { thought?: boolean }).thought === true) continue;
        if (part.text) {
          full += part.text;
          const visible = preambleGuard(part.text);
          if (visible) onToken(visible);
        }
      }
    }
    const response = await result.response;
    const functionCalls = response.functionCalls();`,
      lines: [
        {
          lines: "6",
          label: "discard thought parts",
          explanation:
            "Gemini returns reasoning as parts flagged `thought: true`. These are NEVER reply text — accumulating or forwarding them would speak the model's chain-of-thought. The SDK type omits `thought`, so it's read defensively.",
        },
        {
          lines: "7-10",
          label: "accumulate + guard + emit",
          explanation:
            "Real text is added to `full` (for the transcript), then run through `preambleGuard` — a Gemini-only backstop that strips leaked planning narration (bracketed state lines, 'New response …:' handoffs). Only the visible remainder reaches `onToken`.",
        },
        {
          lines: "14-15",
          label: "tool calls after the stream",
          explanation:
            "Gemini does NOT stream tool calls token-by-token; they arrive in the FINAL response. So after draining the stream we resolve `response.functionCalls()` and dispatch the first one via `onToolCall`.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "MAX_TOKENS is surfaced, not hidden",
      body: [
        "After the stream, the adapter reads `finishReason`. If it's `MAX_TOKENS`, the caller heard the reply cut mid-sentence, so a warning is logged (`llm_reply_truncated`) telling ops to raise the agent's 'LLM Max Output Tokens'.",
        "It also checks `thoughtsTokenCount`: on 2.x, any non-zero count means the model thought despite `thinkingBudget: 0` (common on Flash-Lite for Tamil/Indic inputs, adding 5–7 s of silent latency) and logs `gemini_unexpected_thinking`. On 3.x a small count is expected, so no warning fires. These logs are how we diagnose slow or truncated Gemini turns.",
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      nodes: [
        { id: "pipeline", label: "processTurn()", sublabel: "calls chat()", chapterSlug: "llm-pipeline-path" },
        { id: "assembly", label: "cacheBaseForTurn", sublabel: "the cached prefix", chapterSlug: "prompt-assembly" },
        { id: "google", label: "GoogleLLM", sublabel: "google.ts — THIS FILE", current: true },
        { id: "cache", label: "GoogleAICacheManager", sublabel: "server-side CachedContent" },
        { id: "fallback", label: "Fallback + retry", sublabel: "timeout → take over", chapterSlug: "fallback-and-retry" },
      ],
      edges: [
        { from: "pipeline", to: "google", label: "chat()" },
        { from: "assembly", to: "google", label: "cacheBase" },
        { from: "google", to: "cache", label: "create/reuse" },
        { from: "google", to: "fallback", label: "on timeout" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "Why does the adapter pad `maxOutputTokens` by 256 on Gemini 3.x but not on 2.x?",
          choices: [
            "3.x is a bigger model.",
            "On 3.x, thought tokens count toward the cap and thinking can't be fully disabled, so padding keeps the configured value ≈ the spoken-reply budget; on 2.x thinking is off.",
            "To make replies longer.",
            "It's a bug.",
          ],
          correctIndex: 1,
          explanation:
            "Without the pad, 3.x spends part of the cap thinking and cuts the visible reply — the exact regression after the 2.x→3.x upgrade.",
        },
        {
          prompt: "How does the adapter avoid Gemini's 'functionResponse in user role' rejection?",
          choices: [
            "It disables tools.",
            "It flattens tool turns to plain text — tool results become user text `[Tool \"name\" result: …]` and tool-call turns become model text.",
            "It uses a different API.",
            "It retries until it works.",
          ],
          correctIndex: 1,
          explanation:
            "Flattening keeps the strict user→model alternation valid; the tool-result text already carries the full instruction so the model still responds correctly.",
        },
        {
          prompt: "What happens when context-cache creation fails (e.g. a free-tier 429)?",
          choices: [
            "The call crashes.",
            "`handleCacheError` latches caching off for the rest of the call and the adapter runs the exact uncached path — zero behaviour change.",
            "The agent switches providers.",
            "The caller is dropped.",
          ],
          correctIndex: 1,
          explanation:
            "Caching is best-effort and gated; any failure disables it for the call and falls back to uncached, so free-tier keys work fine, just without the cache speed-up.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "`geminiThinkingConfig` picks `thinkingLevel:\"minimal\"` for 3.x (can't fully disable) or `thinkingBudget:0` for 2.x; the two fields are incompatible.",
        "3.x thought tokens share the output cap, so `maxOutputTokens` is padded by `GEMINI3_THINKING_HEADROOM` (256) to protect the spoken reply.",
        "Explicit context caching registers the static prefix once as `CachedContent`; only the volatile tail is sent per turn, prefixed onto the user message. Any failure latches caching off and falls back to uncached.",
        "`cacheEligible` requires `systemPrompt.startsWith(cacheBase)`, so a staged-prompt turn safely runs uncached.",
        "Tool turns are flattened to plain text (`buildHistory`) to satisfy Gemini's user→model alternation and dodge functionResponse rejection.",
        "The drain discards `thought:true` parts, guards leaked planning preamble, and resolves tool calls from the FINAL response (Gemini doesn't stream them); MAX_TOKENS and unexpected thinking are logged for triage.",
      ],
    },
  ],
};
