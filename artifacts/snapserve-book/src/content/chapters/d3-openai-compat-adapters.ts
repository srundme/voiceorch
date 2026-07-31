import type { Chapter } from "../types";

export const openaiCompatAdapters: Chapter = {
  slug: "openai-compat-adapters",
  moduleId: "d3",
  number: "19.4",
  title: "OpenAI-Compatible Adapters: Groq, Krutrim, Sarvam",
  summary:
    "The shared streaming drain, and the per-provider quirks: Groq's service_tier and tool-model gating, Krutrim's thinking knobs and abort, and Sarvam's buffer-and-sniff tool-call recovery.",
  estMinutes: 24,
  fileRef: "artifacts/api-server/src/orchestration/adapters/llm/openai-compat.ts",
  prerequisites: ["llm-pipeline-path", "adapter-pattern"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "Most LLM providers speak the **OpenAI Chat Completions** protocol: send messages, get back a stream of chunks with `delta.content` (reply text) or `delta.tool_calls` (tool fragments). Groq, DeepSeek, Mistral, Qwen, Krutrim, Sarvam, and others all use it. So the codebase has ONE shared drain loop (`openai-compat.ts`) and each provider is a thin adapter around it — until the provider misbehaves, at which point the adapter grows quirks.",
        "This chapter reads the shared drain first, then walks the three most interesting adapters: **Groq** (fast, clean), **Krutrim** (Indic-focused, thinking-model knobs), and **Sarvam** (Indic specialist with famously unreliable tool-call streaming). Sarvam is where the real war stories live.",
      ],
    },
    {
      kind: "concept",
      title: "delta.content vs delta.tool_calls",
      body: [
        "In the OpenAI streaming protocol each chunk has a `delta`. If `delta.content` is present, that's reply text to speak. If `delta.tool_calls` is present, that's a fragment of a tool call.",
        "Tool-call fragments arrive in pieces: the first fragment carries the tool `name`, later fragments carry chunks of the JSON `arguments` string that must be **concatenated by index**. Only at end-of-stream do you have the full name and args.",
        "A well-behaved provider emits EITHER content OR tool_calls, never both. The trouble starts when a provider (Sarvam) sometimes emits a tool call as plain text INSIDE `delta.content` — which, if spoken, means the caller hears raw JSON.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/llm/openai-compat.ts",
      language: "typescript",
      intro:
        "The shared drain, used by every well-behaved OpenAI-compatible provider. It forwards text, accumulates tool fragments, and dispatches exactly one terminal callback.",
      code: `  let full = "";
  let toolCallName = "";
  let toolCallArgs = "";
  let isToolCall = false;
  let usage: LLMUsage | undefined;

  for await (const chunk of stream) {
    if (chunk.usage) {
      usage = {
        inputTokens: chunk.usage.prompt_tokens,
        outputTokens: chunk.usage.completion_tokens,
        cachedTokens: chunk.usage.prompt_tokens_details?.cached_tokens,
      };
    }
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) continue;
    const token = delta.content ?? "";
    if (token) { full += token; onToken(token); }
    if (delta.tool_calls) {
      isToolCall = true;
      for (const tc of delta.tool_calls) {
        if (tc.function?.name) toolCallName += tc.function.name;
        if (tc.function?.arguments) toolCallArgs += tc.function.arguments;
      }
    }
  }`,
      lines: [
        {
          lines: "8-14",
          label: "usage",
          explanation:
            "When a chunk carries usage, capture input/output tokens and — if the provider reports it — `cached_tokens` (prompt-cache hits). Providers that don't report it leave `cachedTokens` undefined, which is fine.",
        },
        {
          lines: "17-18",
          label: "forward text immediately",
          explanation:
            "`delta.content` is appended to `full` (the running reply) and streamed straight to `onToken` for low latency — this is the fast path for ordinary replies.",
        },
        {
          lines: "19-24",
          label: "accumulate tool fragments",
          explanation:
            "Tool-call fragments are collected: names and argument-string chunks are concatenated across chunks. `isToolCall` flips true so the terminal dispatch knows to fire `onToolCall` instead of `onDone`.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/llm/openai-compat.ts",
      language: "typescript",
      intro:
        "The terminal dispatch: exactly one of onToolCall or onDone. The args JSON is parsed defensively.",
      code: `  if (usage) options?.onUsage?.(usage);

  if (isToolCall && toolCallName && options?.onToolCall) {
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(toolCallArgs || "{}") as Record<string, unknown>; } catch { /* keep {} on malformed */ }
    options.onToolCall(toolCallName, args);
  } else {
    onDone(full, usage);
  }`,
      lines: [
        {
          lines: "3-6",
          label: "tool path",
          explanation:
            "If a tool was requested, parse the accumulated args string. A malformed JSON blob falls back to `{}` rather than throwing — the tool still fires, just with empty args.",
        },
        {
          lines: "7-8",
          label: "text path",
          explanation:
            "Otherwise the turn was a plain reply: fire `onDone(full)`. Exactly one terminal callback runs — never both.",
        },
      ],
    },
    {
      kind: "prose",
      heading: "Groq: fast, with tool-model gating",
      paragraphs: [
        "Groq runs models on LPU hardware for ultra-low latency, so it's a favourite for voice. Its adapter is mostly configuration. The two things worth reading: it gates tools by model (not every Groq model supports function calling), and it sets `service_tier: \"on_demand\"` and a `max_tokens` cap for latency.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/llm/groq.ts",
      language: "typescript",
      intro:
        "Groq gates tools by model and forces scheduling tools with tool_choice:\"required\".",
      code: `    const supportsTools = TOOL_CAPABLE_MODELS.has(this.model);
    if (!supportsTools && options?.tools?.length) {
      logger.warn(
        { model: this.model, toolCount: options.tools.length },
        "Groq: model does not support function calling — tools stripped. " +
          "Switch to llama-3.3-70b-versatile or llama-3.1-8b-instant for tool support.",
      );
    }
    const groqTools = supportsTools && options?.tools?.length
      ? options.tools.map((t) => ({
          type: "function" as const,
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }))
      : undefined;
    const hasSchedulingTools = options?.tools?.some(
      (t) => SCHEDULING_TOOL_NAME_PATTERNS.some((pattern) => t.name.includes(pattern)),
    ) ?? false;
    const toolChoice = groqTools ? (hasSchedulingTools ? "required" : "auto") : undefined;`,
      lines: [
        {
          lines: "1-8",
          label: "tool-model gate",
          explanation:
            "If the chosen model isn't in `TOOL_CAPABLE_MODELS` (e.g. `gemma2-9b-it`), tools are STRIPPED and a warning names the models to switch to. Better than silently sending tools the model will ignore.",
        },
        {
          lines: "15-18",
          label: "required vs auto",
          explanation:
            "If any scheduling tool (book/check/cancel) is present, `tool_choice: \"required\"` forces the model to call a tool this turn. Otherwise `\"auto\"` lets it decide. This stops the model from chatting when it should be booking.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/llm/groq.ts",
      language: "typescript",
      intro:
        "The Groq request: on_demand tier for no queueing, a max_tokens cap, then hand off to the shared drain.",
      code: `    const stream = await this.client.chat.completions.create({
      model:          this.model,
      stream:         true,
      stream_options: { include_usage: true },
      service_tier:   "on_demand" as any,
      ...(this.maxTokens ? { max_tokens: this.maxTokens } : {}),
      ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
      messages: [
        { role: "system", content: systemPrompt },
        ...toOpenAIMessages(messages),
      ] as any,
      ...(groqTools ? { tools: groqTools, tool_choice: toolChoice } : {}),
    });
    await drainOpenAICompatibleStream(stream as any, onToken, onDone, options);`,
      lines: [
        {
          lines: "5",
          label: "service_tier on_demand",
          explanation:
            "Guarantees dedicated LPU resources with no queue wait — critical for real-time voice turn latency.",
        },
        {
          lines: "6",
          label: "max_tokens cap",
          explanation:
            "Capping output directly reduces decoding time (Total Latency = TTFT + output_tokens/speed + network). Voice turns rarely need more than 150–200 tokens.",
        },
        {
          lines: "14",
          label: "shared drain",
          explanation:
            "Groq is well-behaved, so it just calls the shared `drainOpenAICompatibleStream` — no per-provider drain quirks needed.",
        },
      ],
    },
    {
      kind: "prose",
      heading: "Krutrim: Indic-hosted, with thinking-model knobs",
      paragraphs: [
        "Krutrim is a Bangalore-hosted OpenAI-compatible gateway — lowest round-trip time for Indian callers. Its quirks: some models are 'thinking' models that must be silenced via a non-standard `chat_template_kwargs` knob (the standard `enable_thinking` is ignored), and it uses a per-request timeout plus an `AbortController` so a slow request can be cancelled for the pipeline's fallback.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/llm/krutrim.ts",
      language: "typescript",
      intro:
        "Krutrim's request body: max_tokens, and the non-standard thinking-disable knob for Qwen models.",
      code: `    const body: Parameters<typeof this.client.chat.completions.create>[0] & Record<string, unknown> = {
      model: this.model,
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        ...toOpenAIMessages(messages),
      ],
      ...(this.maxTokens ? { max_tokens: this.maxTokens } : {}),
      ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
      ...(NO_THINK_MODELS.has(this.model) ? { chat_template_kwargs: { enable_thinking: false } } : {}),
    };`,
      lines: [
        {
          lines: "8",
          label: "max_tokens default",
          explanation:
            "Krutrim's `maxTokens` defaults to `VOICE_DEFAULT_MAX_TOKENS` (200) — aligned with session.ts so Indic-script replies aren't clipped on paths that construct the adapter without gen params.",
        },
        {
          lines: "10",
          label: "chat_template_kwargs",
          explanation:
            "For Qwen3.5/3.6 models (`NO_THINK_MODELS`), thinking is on by default on Krutrim. The top-level `enable_thinking` param is IGNORED — the only working knob is `chat_template_kwargs: { enable_thinking: false }` (verified by live probing).",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/llm/krutrim.ts",
      language: "typescript",
      intro:
        "Krutrim uses an AbortController + hard timeout so the pipeline's TTFT fallback can cancel a stalled request. It has its own inline drain (not the shared one) to strip thinking delimiters.",
      code: `    this.abortController?.abort();
    const abortController = new AbortController();
    this.abortController = abortController;

    const stream = await this.client.chat.completions.create(
      { ...body, stream: true },
      { timeout: REQUEST_TIMEOUT_MS, signal: abortController.signal },
    );
    // ...inside the for-await drain loop:
      const cleaned = token
        .replace(/<\\|(?:think|\\/think)\\|>/g, "")
        .replace(/<\\/?think>/g, "");
      if (!cleaned) continue;
      full += cleaned;
      onToken(cleaned);`,
      lines: [
        {
          lines: "1-3",
          label: "cancellable",
          explanation:
            "Each call aborts any prior in-flight request and installs a fresh `AbortController`. `cancelInFlight()` (called by the pipeline's TTFT-fallback timer) aborts this so the fallback LLM can take over.",
        },
        {
          lines: "5-8",
          label: "hard timeout",
          explanation:
            "`REQUEST_TIMEOUT_MS` (default 15 s) is a hard per-request bound so a stalled Krutrim connection fails fast instead of hanging the call.",
        },
        {
          lines: "10-15",
          label: "strip thinking delimiters",
          explanation:
            "Krutrim's own drain strips leaked `<|think|>` / `<think>` delimiter tokens from the content before forwarding — a safety net on top of the thinking-disable knob.",
        },
      ],
    },
    {
      kind: "prose",
      heading: "Sarvam: buffer-and-sniff tool-call recovery",
      paragraphs: [
        "Sarvam is the Indic-language LLM specialist, and its streaming tool-call support is unreliable. Sometimes it emits a proper structured `delta.tool_calls`. Sometimes it dumps the tool call as a JSON blob inside `delta.content`. Sometimes it uses a `[bracket]` key-value envelope. Sometimes it puts a `<function>name</function>` tag AFTER the reply text. Each of these, if spoken, means the caller hears garbage. The adapter defends against all four.",
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Sarvam streams tool calls as plain text — so we buffer-and-sniff",
      body: [
        "When tools are enabled, Sarvam's adapter watches the FIRST non-whitespace reply character. If it's `{`, a code fence, or `[`, the turn MIGHT be a tool call emitted as text — so it WITHHOLDS all content from TTS and buffers it, resolving at end-of-stream.",
        "At end-of-stream, `parseToolEnvelope` tries the JSON envelope, then the bracket envelope, validating the parsed name against the tools offered this turn. On success it fires `onToolCall`; on failure it treats the buffer as genuine text via `onDone` — never silently dropped. Ordinary replies (not starting with those markers) stream normally, preserving TTFT.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/llm/sarvam.ts",
      language: "typescript",
      intro:
        "Sarvam's reasoning_effort knob and the tool-turn floor. Reasoning tokens count toward max_tokens, so a small cap plus reasoning = a silent turn.",
      code: `    if (hasTools && genBody["reasoning_effort"] === null) {
      genBody["reasoning_effort"] = "low";
    }
    if (hasTools && genBody["reasoning_effort"] != null) {
      const mt = genBody["max_tokens"];
      if (typeof mt === "number" && mt < 500) genBody["max_tokens"] = 500;
    }`,
      lines: [
        {
          lines: "1-3",
          label: "reasoning ON for tool turns",
          explanation:
            "Sarvam defaults `reasoning_effort` to null (thinking off) for voice latency. But with tools, the model needs reasoning to DECIDE whether to call a tool — with it off it just replies conversationally and never calls the tool. So tool turns get `\"low\"`.",
        },
        {
          lines: "4-7",
          label: "the 500-token floor",
          explanation:
            "Reasoning tokens count toward `max_tokens`. A small agent cap can be consumed ENTIRELY by the hidden reasoning trace, leaving `content: null` — a silent turn. So whenever reasoning runs with tools, enforce a 500-token floor.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/llm/sarvam.ts",
      language: "typescript",
      intro:
        "The buffer-and-sniff decision: on the FIRST real content, decide whether this is a serialized tool call (withhold) or normal text (stream).",
      code: `        if (hasTools) {
          if (bufferingJson) { jsonBuffer += token; return; }
          if (!jsonSniffDecided) {
            const peek = (jsonBuffer + token).replace(/^\\s+/, "");
            if (peek === "") { jsonBuffer += token; return; }
            jsonSniffDecided = true;
            const firstChar = peek[0];
            if (firstChar === "{" || firstChar === "\`" || firstChar === "[") {
              bufferingJson = true;
              jsonBuffer += token;
              return;
            }
            jsonBuffer = "";
            token = peek;
          }
        }`,
      lines: [
        {
          lines: "2",
          label: "already buffering",
          explanation:
            "Once we've decided this looks like a serialized tool call, every subsequent token is added to `jsonBuffer` and withheld from TTS.",
        },
        {
          lines: "3-5",
          label: "wait for real content",
          explanation:
            "Leading whitespace is held (not decided on) until real content appears, so a stray `\\n` artifact doesn't force a wrong decision.",
        },
        {
          lines: "7-12",
          label: "the sniff",
          explanation:
            "If the first real char is `{`, a code fence, or `[`, flip to buffering — this is probably a tool call as text. Withhold and resolve at end-of-stream.",
        },
        {
          lines: "13-14",
          label: "normal text",
          explanation:
            "Otherwise it's a normal reply: clear the buffer and stream from the cleaned peek onward. TTFT is preserved for ordinary conversation.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "The trailing <function> tag: a fourth Sarvam format",
      body: [
        "Sarvam also sometimes emits conversational text FOLLOWED by a `<function>transfer_to_human</function>` tag. The buffer-and-sniff won't catch it (the first char is a normal letter), and the streaming tool-tail filter strips the tag from TTS — but `onToolCall` was never fired, so the tool was silently dropped.",
        "So at end-of-stream, on the plain-text path only, the adapter runs a regex for a trailing `<function>…</function>` tag, validates the name against the offered tools, and fires `onToolCall` if it matches. Four different tool-call formats, all funnelled into the same single `onToolCall`.",
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      nodes: [
        { id: "pipeline", label: "processTurn()", sublabel: "calls chat()", chapterSlug: "llm-pipeline-path" },
        { id: "shared", label: "drainOpenAICompatibleStream", sublabel: "openai-compat.ts — THIS FILE", current: true },
        { id: "groq", label: "GroqLLM", sublabel: "uses shared drain", current: true },
        { id: "krutrim", label: "KrutrimLLM", sublabel: "own drain + abort", current: true },
        { id: "sarvam", label: "SarvamLLM", sublabel: "buffer-and-sniff", current: true },
        { id: "fallback", label: "Fallback + retry", sublabel: "cancelInFlight()", chapterSlug: "fallback-and-retry" },
      ],
      edges: [
        { from: "pipeline", to: "groq", label: "chat()" },
        { from: "groq", to: "shared", label: "drains via" },
        { from: "pipeline", to: "krutrim", label: "chat()" },
        { from: "pipeline", to: "sarvam", label: "chat()" },
        { from: "krutrim", to: "fallback", label: "abort on timeout" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "In the shared drain, how are streaming tool-call arguments reconstructed?",
          choices: [
            "They arrive complete in one chunk.",
            "Argument-string fragments are concatenated across chunks, then JSON.parsed once at end-of-stream (falling back to {} if malformed).",
            "They are read from the system prompt.",
            "They are ignored.",
          ],
          correctIndex: 1,
          explanation:
            "Tool calls stream as fragments; the drain accumulates the name and args-string across chunks and parses the full args once the stream ends.",
        },
        {
          prompt: "Why does Sarvam's adapter bump `max_tokens` to at least 500 on tool turns?",
          choices: [
            "To make replies longer.",
            "Reasoning tokens count toward max_tokens, so a small cap can be entirely consumed by the hidden reasoning trace, leaving an empty (silent) turn.",
            "Sarvam requires 500 minimum.",
            "To match Groq.",
          ],
          correctIndex: 1,
          explanation:
            "With reasoning active alongside tools, too small a cap gets eaten by reasoning and produces content:null — a silent turn. The 500 floor prevents that.",
        },
        {
          prompt: "What triggers Sarvam's buffer-and-sniff (withholding content from TTS)?",
          choices: [
            "Any reply over 100 characters.",
            "When tools are enabled AND the first non-whitespace reply character is `{`, a code fence, or `[` — signalling a possible tool call emitted as text.",
            "Every Sarvam turn.",
            "When the caller speaks Tamil.",
          ],
          correctIndex: 1,
          explanation:
            "That leading marker means the model may be dumping a tool call as text; the adapter withholds it and resolves it as a tool call or plain text at end-of-stream.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "OpenAI-compatible providers share one drain (`openai-compat.ts`): forward `delta.content`, accumulate `delta.tool_calls` fragments, fire exactly one of `onToolCall`/`onDone`.",
        "Groq gates tools by model (stripping them with a warning on unsupported models), forces `tool_choice:\"required\"` for scheduling tools, and uses `service_tier:\"on_demand\"` + a max_tokens cap for latency.",
        "Krutrim silences Qwen thinking via the non-standard `chat_template_kwargs:{enable_thinking:false}`, defaults maxTokens to 200, and supports `cancelInFlight()` via an AbortController + hard timeout.",
        "Sarvam turns reasoning ON for tool turns (`\"low\"`) and enforces a 500-token floor so reasoning doesn't produce a silent turn.",
        "Sarvam handles FOUR tool-call formats: structured, JSON-in-content, `[bracket]` envelope, and a trailing `<function>` tag — all funnelled into one `onToolCall`, never spoken aloud.",
        "The buffer-and-sniff withholds content from TTS only when a tool call as text is likely; ordinary replies stream normally to preserve TTFT.",
      ],
    },
  ],
};
