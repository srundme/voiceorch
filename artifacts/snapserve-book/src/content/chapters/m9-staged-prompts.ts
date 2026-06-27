import type { Chapter } from "../types";

export const stagedPrompts: Chapter = {
  slug: "staged-prompts",
  moduleId: "m9",
  number: "10.3",
  title: "Staged Prompts & Context Windows",
  summary:
    "How SnapServe assembles the LLM system prompt at runtime — the ordering, priority, and size limits that keep every turn under the model's context budget.",
  estMinutes: 15,
  fileRef: "artifacts/api-server/src/orchestration/session.ts",
  prerequisites: ["knowledge-base", "session-and-pipeline"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "The system prompt is not just the user's instructions",
      paragraphs: [
        "When an agent operator writes a system prompt in the dashboard, they're filling in one piece of a larger prompt assembly. Before the LLM is called, SnapServe constructs the final system prompt by layering multiple components in a specific order. Getting this order wrong produces an agent that ignores its own knowledge base, forgets to follow the operator's instructions, or uses the wrong language.",
        "This chapter walks through the staged prompt assembly — what goes in, in what order, and why each section exists.",
      ],
    },
    {
      kind: "concept",
      title: "Staged prompt sections: the full list",
      body: [
        "**1. Operator system prompt** — the text the user wrote in the agent builder. This is the agent's core personality, goals, and constraints.",
        "**2. Language rule** — if `agentLanguage` is set, a strict instruction: 'Always respond in [language]. Never switch, regardless of what the caller says.' Proper nouns (brand names) are explicitly exempted to prevent the LLM from translating 'SnapServe' into a localised phonetic equivalent.",
        "**3. Knowledge base** — `[KNOWLEDGE BASE]` block with the top 5 retrieved chunks for the current caller message. Injected only when a KB is configured and a retrieval finds relevant entries.",
        "**4. Compliance injections** — TRAI DND, IRDAI disclosures, DPDP data-collection warnings. These are stored in `platform_settings` and injected verbatim. Operators cannot override them.",
        "**5. Caller context** — `[CALLER CONTEXT]` with the caller's name, last-call summary, known facts, and returning-caller greeting if the caller has called before.",
        "**6. Tool definitions** — appended after the system prompt as the `tools` parameter array in the API call. The LLM sees these as a separate JSON structure, not in the prompt text.",
        "**7. Scheduling / booking guide** — injected only when the agent has booking tools. Tells the LLM the calendar timezone, event type name, duration, and how to collect booking details from the caller.",
      ],
    },
    {
      kind: "code",
      filename: "orchestration/session.ts",
      language: "typescript",
      intro:
        "The `buildSystemPrompt` function assembles the final system prompt. Each section is a conditional append.",
      code: `function buildSystemPrompt(ctx: SessionBuildContext): string {
  const parts: string[] = [];

  // 1. Operator prompt
  parts.push(ctx.agent.systemPrompt ?? "You are a helpful assistant.");

  // 2. Language rule (exempt proper nouns)
  if (ctx.agent.agentLanguage && ctx.agent.agentLanguage !== "en-US") {
    parts.push(
      \`Always respond in \${ctx.agent.agentLanguageName ?? ctx.agent.agentLanguage}. \` +
      \`Do not translate brand names or proper nouns. \` +
      \`Never switch languages even if the caller speaks a different language.\`
    );
  }

  // 3. Knowledge base (injected per-turn in the LLM call, not here)

  // 4. Compliance injections
  for (const injection of ctx.complianceInjections) {
    parts.push(injection);
  }

  // 5. Caller context
  if (ctx.callerContext) {
    parts.push("[CALLER CONTEXT]");
    if (ctx.callerContext.name) {
      parts.push(\`The caller's name is \${ctx.callerContext.name}.\`);
    }
    if (ctx.callerContext.priorFacts.length > 0) {
      parts.push(
        "Known facts about this caller:\\n" +
        ctx.callerContext.priorFacts.map(f => \`- \${f}\`).join("\\n")
      );
    }
  }

  return parts.join("\\n\\n");
}`,
      lines: [
        {
          lines: "4-5",
          label: "operator prompt first",
          explanation:
            "The operator's system prompt goes first. LLMs are more likely to follow instructions that appear early in the context window — a phenomenon sometimes called 'primacy bias'. Putting the operator prompt first ensures their intentions are seen before any injected boilerplate.",
        },
        {
          lines: "7-13",
          label: "language rule",
          explanation:
            "The language rule is a hard constraint, not a preference. 'Always respond in Tamil' is much more effective than 'prefer Tamil'. The proper-noun exemption prevents the model from translating brand names — without it, 'SnapServe' might become 'स्नैपसर्व' in Hindi output.",
        },
        {
          lines: "17-20",
          label: "compliance injections",
          explanation:
            "These are fetched from `platform_settings` at session build time. They can include TRAI DND disclosures, IRDAI mandate language, DPDP data-collection consent notices. They're platform-controlled — operators can add their own but cannot remove the platform's injections.",
        },
      ],
    },
    {
      kind: "prose",
      heading: "The context window budget",
      paragraphs: [
        "LLMs have a maximum context window — the total number of tokens they'll accept (system prompt + conversation history + response). Common sizes: GPT-4o = 128k tokens, Llama-70B via Groq = 8k tokens, DeepSeek-V3 = 64k tokens.",
        "If the conversation history grows long enough to fill the window, the LLM starts seeing truncated history. This is catastrophic for a voice agent — the model forgets what was said earlier in the call and starts hallucinating context.",
        "SnapServe manages this with **conversational pruning**: the pipeline keeps the last N turns of conversation, where N is configured per agent (`agentConfig.maxContextTurns`, default 20). Older turns are dropped from the in-memory history. The system prompt and the current turn are always preserved — only the middle of the conversation is pruned.",
      ],
    },
    {
      kind: "callout",
      variant: "warning",
      title: "KB retrieval doesn't expand the context budget",
      body: [
        "Injecting 5 KB chunks per turn consumes tokens on every LLM call. A KB chunk of 300 words ≈ 400 tokens; five chunks ≈ 2,000 tokens. On an 8k-token model, that's 25% of the entire context budget — leaving only 6k for system prompt, conversation history, and the current turn.",
        "For models with small context windows, consider: reducing `KB_CHUNKS_PER_TURN` from 5 to 2-3, or using a larger-context model as the primary LLM when a KB is attached.",
      ],
    },
    {
      kind: "concept",
      title: "Caller context: the personalisation layer",
      body: [
        "Before each call, `loadCallerContext` queries `caller_profiles` and `caller_facts` to build a caller-context object. This includes the caller's name (if previously collected), known facts (e.g. `prefers_english: true`, `premium_subscriber: true`), and a summary of the previous call.",
        "The caller context is injected into the system prompt under `[CALLER CONTEXT]`. The agent can reference it in its greeting: 'Welcome back, Priya!' — even on the first turn, before the caller has said anything.",
        "This is personalisation at the LLM level, not via rigid if-else logic. The operator's prompt might say: 'Use the caller context to personalise your greeting and skip questions you already know the answer to.' The LLM handles the rest.",
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "Why is the operator's system prompt placed FIRST in the assembled prompt?",
          choices: [
            "For alphabetical ordering",
            "LLMs exhibit primacy bias — early instructions are more likely to be followed",
            "So the compliance injections can override it at the end",
            "Because the language rule depends on content in the operator prompt",
          ],
          correctIndex: 1,
          explanation:
            "LLMs tend to weight instructions that appear earlier in the context more heavily — a known characteristic sometimes called primacy bias. Placing the operator prompt first ensures their core intent is established before any boilerplate injections.",
        },
        {
          prompt: "What happens to conversation history when the context window starts to fill up?",
          choices: [
            "The call is ended automatically to prevent errors",
            "The system prompt is compressed to make room",
            "Older conversation turns are pruned, keeping the most recent N turns",
            "The pipeline switches to a model with a larger context window",
          ],
          correctIndex: 2,
          explanation:
            "The pipeline keeps the last `maxContextTurns` turns (default 20) and drops older turns. The system prompt and the current turn are always preserved.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "The LLM system prompt is assembled from 5+ staged sections: operator prompt, language rule, KB, compliance, caller context",
        "Operator prompt goes first (primacy bias); compliance injections are platform-controlled and non-overridable",
        "Language rule must explicitly exempt proper nouns or weak models translate brand names",
        "Context window budget is finite — 5 KB chunks ≈ 2,000 tokens, significant on small-context models",
        "Older conversation turns are pruned at `maxContextTurns` to prevent context overflow",
      ],
    },
  ],
};
