import type { Chapter } from "../types";

export const promptAssembly: Chapter = {
  slug: "prompt-assembly",
  moduleId: "d3",
  number: "19.2",
  title: "Building the System Prompt",
  summary:
    "How session.ts and pipeline.ts assemble the system prompt: base instructions, language rule, KB injection with a char cap, and the volatile date/time tail placed LAST for cache stability.",
  estMinutes: 20,
  fileRef: "artifacts/api-server/src/orchestration/session.ts",
  prerequisites: ["llm-pipeline-path", "knowledge-base"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "The **system prompt** is the block of instructions we put in front of the LLM before every reply. It tells the agent who it is, what language to speak, what it knows, and how to behave. Get the order wrong and two things break: the agent misbehaves, or the provider's **prompt cache** never hits and every turn costs full price and full latency.",
        "Assembly happens in two places. `session.ts` builds the **static base** ONCE when the call starts: the agent's prompt, the language rule, TTS output rules, compliance disclosures, guardrails, and the baked knowledge base. Then, on every turn, `pipeline.ts` wraps that base with the per-turn **volatile tail**: the language guard, retrieved KB context, gender directive, tool guides, and — dead last — the current date and time.",
        "This chapter reads the real assembly code. The single most important rule to internalize: **the thing that changes most often goes LAST**, because prompt caches only reuse an exact, unbroken prefix of tokens.",
      ],
    },
    {
      kind: "concept",
      title: "Prompt caching and why order matters",
      body: [
        "Providers like OpenAI and Gemini can **cache** the processing of your prompt. If turn 2's prompt starts with the exact same tokens as turn 1's, the provider reuses the work — cheaper and faster.",
        "But the cache only matches an **unbroken prefix**. The moment a single character differs, everything from that point on is a cache miss and must be reprocessed.",
        "So if you put the current time (which changes every minute) near the TOP, you invalidate the entire large static block below it on every turn. Put it at the very BOTTOM and the big static prefix stays byte-identical and cacheable. That one placement decision is worth real money and real milliseconds at scale.",
      ],
    },
    {
      kind: "analogy",
      title: "A printed manual with a sticky note on the last page",
      body: [
        "Imagine a thick printed onboarding manual. The pages never change — you can photocopy them once and reuse the copy forever. That's the static base prompt.",
        "Now imagine the only thing that changes each day is a sticky note with today's date. If you glue the sticky note to page 1, you have to reprint the whole manual daily. Stick it on the last page and you reprint one page. The date/time injection is that sticky note — and the code puts it on the last page on purpose.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/session.ts",
      language: "typescript",
      intro:
        "In session.ts, the base prompt starts from the agent's configured prompt. The language rule is appended based on the agent's effective language and whether it's multilingual.",
      code: `  let effectiveSystemPrompt = agent.generatedPrompt ?? agent.systemPrompt;
  effectiveSystemPrompt += \`\\n\\n[DATE/TIME CONTEXT] Today is \${dateCtxParts}. Current time is \${timeCtxParts} (\${agentTimezone}).\`;
  const isMultilingual =
    (Array.isArray(agentCfg["secondaryLanguages"]) && (agentCfg["secondaryLanguages"] as string[]).length > 0) ||
    agentCfg["languageAutoDetect"] === true;
  // ...
      if (isMultilingual) {
        effectiveSystemPrompt += \`\\n\\n[LANGUAGE RULE] Your primary language is \${langName}. Always follow the caller's language ... EXCEPTION — keep all proper nouns (brand names, product names, company names, people's names) EXACTLY as written in your instructions; never translate or transliterate them.\${scriptNote ? " " + scriptNote : ""}\`;
      } else {
        effectiveSystemPrompt += \`\\n\\n[STRICT LANGUAGE RULE] You MUST respond ONLY in \${langName} at ALL times. Never switch ... EXCEPTION — keep all proper nouns (brand names, product names, company names, and people's names) EXACTLY as written in your instructions; never translate, localize, or transliterate them, even when part of a name resembles a common \${langName} word.\${scriptNote ? " " + scriptNote : ""}\`;
      }`,
      lines: [
        {
          lines: "1",
          label: "start from the agent prompt",
          explanation:
            "`generatedPrompt` (an AI-built prompt) is preferred if present, otherwise the human-written `systemPrompt`. This is the seed the rest is appended onto.",
        },
        {
          lines: "3-5",
          label: "multilingual detection",
          explanation:
            "An agent is 'multilingual' if it has any secondary languages OR the `languageAutoDetect` flag is on. This picks which of the two language rules gets appended.",
        },
        {
          lines: "7-8",
          label: "the FOLLOW-caller rule",
          explanation:
            "Multilingual agents get a soft rule: follow whatever language the caller uses, match a Hinglish mix, but keep proper nouns exact. Switching is allowed — it's the whole point.",
        },
        {
          lines: "9-11",
          label: "the STRICT single-language rule",
          explanation:
            "Non-multilingual agents get an ABSOLUTE rule: respond ONLY in the one configured language, never switch. Both rules carry the same critical EXCEPTION clause — see the callout.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "warning",
      title: "The proper-noun exemption exists so brand names survive",
      body: [
        "Both language rules end with an EXCEPTION: keep proper nouns (brand names, product names, company names, people's names) EXACTLY as written, never translate or transliterate. Without this, a strict-Tamil agent will happily 'translate' your company name into Tamil script and the caller hears a garbled version of your brand.",
        "The strict rule even spells out the nastiest case: keep the name exact 'even when part of a name resembles a common word' in the target language. If your product is 'Gala Fit' and 'gala' means something in Tamil, the model must not localize it.",
      ],
    },
    {
      kind: "prose",
      paragraphs: [
        "After the language rule, `session.ts` appends more static layers that we'll skim: TTS output rules (provider-aware — Cartesia gets SSML-like tags, everyone else is forbidden from emitting tags), the conversation-discipline block (one step at a time, wait for a response), compliance disclosures (DPDP, TRAI, IRDAI), and the security guardrails. All static, all cacheable.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/session.ts",
      language: "typescript",
      intro:
        "The voice max-tokens default lives in session.ts too — a protective cap, not a target. Note the comment: it exists because Indic scripts use 2–4× more tokens per word than English.",
      code: `  // 80 was too tight for Tamil/Hinglish — call 2643 hit the cap mid-sentence
  // twice ...; 160 still clipped occasionally (Indic scripts run 2-4× English
  // tokens/word), so the voice default is now 200. This is a protective cap,
  // not a target — typical turns end naturally at 30-80 tokens, so raising it
  // does not slow normal replies; it only stops long ones being cut mid-sentence.
  const VOICE_DEFAULT_MAX_TOKENS = Number(process.env.VOICE_DEFAULT_MAX_TOKENS ?? 200);
  const configuredLlmMaxTokens = "llmMaxTokens" in agentCfg
    ? agentCfg["llmMaxTokens"]
    : agentCfg["maxTokens"];`,
      lines: [
        {
          lines: "1-6",
          label: "why 200",
          explanation:
            "The cap is 200 tokens because Tamil and Hinglish replies use far more tokens than the same English sentence. Too low and replies get cut mid-word (see the field note about call 2643).",
        },
        {
          lines: "7-9",
          label: "llmMaxTokens vs legacy maxTokens",
          explanation:
            "The dashboard writes `llmMaxTokens`. A present-but-null value means 'reset to default', so the code checks the KEY existence — `null ?? legacy` would wrongly resurrect a stale cap.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/session.ts",
      language: "typescript",
      intro:
        "The baked knowledge base has a character cap that depends on the provider — Gemini gets a bigger budget because it caches the big static prefix cheaply.",
      code: `  const KB_INJECT_DEFAULT_GEMINI_CHARS = 8000;
  const KB_INJECT_DEFAULT_ALL_CHARS = 4000;
  const kbMaxEnv = process.env["KB_INJECT_MAX_CHARS"];
  const kbMaxCharsRaw =
    kbMaxEnv !== undefined && kbMaxEnv.trim() !== ""
      ? Number.parseInt(kbMaxEnv, 10)
      : agent.llmProvider?.toLowerCase() === "google"
        ? KB_INJECT_DEFAULT_GEMINI_CHARS
        : KB_INJECT_DEFAULT_ALL_CHARS;
  const kbBakedMaxChars =
    Number.isFinite(kbMaxCharsRaw) && kbMaxCharsRaw > 0 ? kbMaxCharsRaw : undefined;`,
      lines: [
        {
          lines: "1-2",
          label: "provider-specific caps",
          explanation:
            "Gemini agents get 8000 chars of baked KB; every other provider gets 4000. The larger Gemini budget is safe because its explicit context cache makes the big static prefix cheap after turn 1.",
        },
        {
          lines: "3-9",
          label: "env override",
          explanation:
            "`KB_INJECT_MAX_CHARS` lets ops override the cap globally. If unset, the provider default applies.",
        },
        {
          lines: "10-11",
          label: "sanity guard",
          explanation:
            "A non-finite or non-positive value falls back to `undefined` (no cap enforced here) rather than silently injecting garbage.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/session.ts",
      language: "typescript",
      intro:
        "The baked KB is APPENDED to the system prompt (never prepended) so agent instructions keep precedence, and is wrapped with a precedence disclaimer.",
      code: `    const kbBlock = [
      "=== KNOWLEDGE BASE (reference material) ===",
      "The following is reference knowledge base content. If any detail here conflicts with instructions already given above in the system prompt, the system prompt takes precedence — do not override agent-specific configuration with this reference material.",
      "Use the following information to answer questions accurately, and prefer it over your general training data for topics the system prompt does not already define.",
      "",
      kbInjectText,
      "=== END KNOWLEDGE BASE ===",
    ].join("\\n\\n");
    agentConfig.systemPrompt = \`\${agentConfig.systemPrompt}\\n\\n\${kbBlock}\`;`,
      lines: [
        {
          lines: "2-4",
          label: "precedence disclaimer",
          explanation:
            "The KB is explicitly labelled REFERENCE material: if it conflicts with the agent's instructions, the instructions win. This stops a stale KB entry from overriding configured behaviour.",
        },
        {
          lines: "9",
          label: "append, not prepend",
          explanation:
            "The KB block goes AFTER the agent's own prompt. Position = priority for LLMs, so keeping the agent's instructions first preserves their authority, and appending keeps the static prefix stable for caching.",
        },
      ],
    },
    {
      kind: "prose",
      heading: "Per-turn assembly in pipeline.ts",
      paragraphs: [
        "Everything above is built once. Now the per-turn side. In `processTurn()`, `pipeline.ts` takes that static base and adds the volatile pieces. The first is the **language guard** — placed at BOTH the top and bottom of the prompt so it survives both long prompts (top = high attention) and recency bias (bottom).",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "The langGuard sandwich, and the deliberate note about where date/time does NOT go.",
      code: `    const langGuard = this.buildLangGuard();
    // NOTE: dtInjection ([CURRENT DATE & TIME]) is deliberately NOT placed here.
    // It changes every minute, so keeping it near the top would invalidate the
    // OpenAI prompt cache for the entire static block that follows ...
    systemPromptForTurn = langGuard
      ? \`\${langGuard}\\n\\n\${systemPromptForTurn}\\n\\n\${langGuard}\`
      : systemPromptForTurn;`,
      lines: [
        {
          lines: "1",
          label: "buildLangGuard()",
          explanation:
            "Produces the per-turn language directive from `currentLang` and any explicit caller request (e.g. 'speak English'). Empty string when no language is established yet.",
        },
        {
          lines: "2-4",
          label: "the placement comment",
          explanation:
            "An explicit warning: the date/time injection is NOT added near the top precisely because it would break the cache prefix. This is the rule from the concept box, written into the code.",
        },
        {
          lines: "5-7",
          label: "the sandwich",
          explanation:
            "The langGuard wraps the whole prompt — same text top and bottom. Top gets attention in long prompts; bottom wins on recency right before generation.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "The Gemini cache base is captured BEFORE the volatile tail, then per-turn KB context is appended with its own precedence disclaimer.",
      code: `    const cacheBaseForTurn = systemPromptForTurn;
    // ...retrieve kbContext with a time budget...
    if (kbContext) {
      systemPromptForTurn = \`\${systemPromptForTurn}\\n\\n## Relevant Knowledge Base Context\\n\\nThe following is reference knowledge base content. If any detail here conflicts with instructions already given above ... \${kbContext}\`;
    }`,
      lines: [
        {
          lines: "1",
          label: "capture the cache base",
          explanation:
            "`cacheBaseForTurn` is the static prefix (language guard + base + baked KB) captured BEFORE the per-turn appends. The Google adapter registers this as a `CachedContent` and only re-sends the small volatile tail per turn.",
        },
        {
          lines: "3-5",
          label: "per-turn KB context",
          explanation:
            "Live per-turn retrieval (vector + full-text search against the actual transcript) is appended here, again with a precedence disclaimer. It runs under a time budget so a slow embed never stalls the turn.",
        },
      ],
    },
    {
      kind: "prose",
      paragraphs: [
        "After KB context come more volatile appends: the gender-salutation directive (marked verbatim so the language rule can't translate 'Sir'/'Ma'am'), the scheduling/booking tool guides, the `[TOOL CALLING — MANDATORY]` block, and — only when Layer-4 staged prompts are enabled — a full REPLACEMENT of the system prompt with the active stage's content plus the discipline block. Staged prompts break the cache prefix on purpose, and the Gemini adapter's `startsWith()` check safely detects this and falls back to the uncached path.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "The grand finale: date/time appended LAST, for prompt-cache stability. This is the payoff of everything above.",
      code: `    // ── [CURRENT DATE & TIME] — appended LAST for prompt-cache stability ──────
    // This is the only element that changes on every single turn (down to the
    // minute). Appending it here — after the base prompt, KB context, gender
    // directive, tool guides AND the staged-prompt rebuild above — keeps every
    // token before it byte-identical across turns, so OpenAI prompt caching can
    // serve the large static block ... from cache instead of reprocessing it.
    systemPromptForTurn += \`\\n\\n\${dtInjection}\`;`,
      lines: [
        {
          lines: "1-6",
          label: "the comment IS the lesson",
          explanation:
            "Date/time is the ONLY per-minute-changing element, so it goes dead last. Every token before it stays identical turn-over-turn, which is exactly what OpenAI/Gemini prompt caching needs to hit.",
        },
        {
          lines: "7",
          label: "the append",
          explanation:
            "`dtInjection` (the `[CURRENT DATE & TIME]` block) is glued to the very end, immediately before the conversation history that `chat()` appends after it.",
        },
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro: "Prompt assembly spans a once-per-call static build and a per-turn volatile wrap.",
      nodes: [
        { id: "session", label: "session.ts", sublabel: "static base (once)", current: true },
        { id: "kb", label: "buildKnowledgeBaseBlockEx", sublabel: "baked KB + char cap", chapterSlug: "knowledge-base" },
        { id: "pipeline", label: "processTurn()", sublabel: "per-turn wrap", chapterSlug: "llm-pipeline-path" },
        { id: "cache", label: "cacheBaseForTurn", sublabel: "Gemini context cache", chapterSlug: "gemini-adapter-complete" },
        { id: "staged", label: "Staged prompts", sublabel: "Layer 4 override", chapterSlug: "staged-prompts" },
      ],
      edges: [
        { from: "session", to: "pipeline", label: "static base" },
        { from: "kb", to: "session", label: "baked block" },
        { from: "pipeline", to: "cache", label: "captured prefix" },
        { from: "staged", to: "pipeline", label: "replaces prompt" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "Why is the `[CURRENT DATE & TIME]` block appended at the very END of the system prompt?",
          choices: [
            "Because the LLM reads bottom-up.",
            "Because it changes every minute; keeping every token before it byte-identical lets the provider's prompt cache reuse the big static prefix each turn.",
            "To hide it from the caller.",
            "Because the time zone is unknown until the end.",
          ],
          correctIndex: 1,
          explanation:
            "Prompt caches only reuse an unbroken prefix. Putting the per-minute date/time last keeps everything before it stable and cacheable.",
        },
        {
          prompt: "What does the proper-noun EXCEPTION in both language rules prevent?",
          choices: [
            "The agent speaking too fast.",
            "Brand names, product names, and people's names being translated or transliterated into the target language.",
            "The LLM using too many tokens.",
            "The caller switching languages.",
          ],
          correctIndex: 1,
          explanation:
            "Without it, a strict-language agent would 'translate' your company/product names, so the caller hears a garbled brand. The exception keeps proper nouns exact.",
        },
        {
          prompt: "Why does the baked KB get an 8000-char budget for Gemini but 4000 for other providers?",
          choices: [
            "Gemini charges less per character.",
            "Gemini's explicit context cache makes the large static prefix cheap after turn 1, so a bigger baked KB is affordable.",
            "Other providers can't read 8000 characters.",
            "It's an arbitrary number.",
          ],
          correctIndex: 1,
          explanation:
            "Because Gemini caches the static prefix server-side, the larger baked KB only costs full price on the first turn, making the bigger budget worthwhile.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "The static base prompt is built ONCE in session.ts (agent prompt + language rule + TTS rules + discipline + compliance + guardrails + baked KB); the volatile tail is added per turn in pipeline.ts.",
        "Prompt caches only reuse an unbroken token prefix, so the per-minute date/time injection is appended LAST — after KB, gender, tool guides, and even staged-prompt rebuilds.",
        "Both language rules carry a proper-noun EXCEPTION so brand/product/people names are never translated or transliterated.",
        "The baked KB is appended (not prepended) with a precedence disclaimer, capped at 8000 chars for Gemini and 4000 for others.",
        "`cacheBaseForTurn` is captured before the volatile tail and handed to the Google adapter as its context-cache prefix; staged prompts break the prefix and safely fall back to uncached.",
        "The voice max-tokens default is 200 — a protective cap sized for Indic scripts, not a target for normal replies.",
      ],
    },
  ],
};
