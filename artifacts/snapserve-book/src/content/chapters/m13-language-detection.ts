import type { Chapter } from "../types";

export const languageDetection: Chapter = {
  slug: "language-detection",
  moduleId: "m13",
  number: "14.1",
  title: "Multi-Language Detection & Continuous LID",
  summary:
    "How SnapServe agents handle callers who switch languages mid-call — Azure's Continuous Language Identification, the language-rule prompt injection, and proper-noun exemptions.",
  estMinutes: 15,
  fileRef: "artifacts/api-server/src/orchestration/stt/azure.ts",
  prerequisites: ["stt-adapters", "session-and-pipeline"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "The multi-language challenge",
      paragraphs: [
        "A voice agent serving Indian callers faces a linguistic reality that English-only STT systems were never designed for: callers routinely mix languages mid-sentence. A Tamil caller might greet in English, ask their question in Tamil, insert an English brand name, and confirm in Tamil again — all in a 30-second turn.",
        "SnapServe solves this at two layers. First, the STT adapter uses Azure's **Continuous Language Identification** (Continuous LID) to detect and transcribe multiple languages without requiring a restart between speakers. Second, the LLM system prompt carries a language rule that tells the model which language(s) to respond in — with a critical exemption for proper nouns.",
        "These two layers are independent: LID is an audio-processing concern (handled by the Azure STT adapter), while the language rule is a prompt-engineering concern (handled by `session.ts` when building the system prompt). Both must be configured correctly for a seamless experience.",
      ],
    },
    {
      kind: "concept",
      title: "Azure STT: at-start vs Continuous LID",
      body: [
        "Azure Speech Services supports two language identification modes. **At-start** (the default) detects the language from the first few seconds of audio and locks onto it for the duration of the session. This works well for callers who speak one language consistently.",
        "**Continuous** mode re-evaluates the language on every utterance. If the caller switches from English to Tamil mid-call, the STT engine recognises the switch and transcribes subsequent audio in Tamil. Azure supports up to 4 candidate languages per continuous session — configured via the `languageId.languages` array.",
        "To enable Continuous mode, every WebSocket frame (both text and binary audio frames) must include an `X-RequestId` header and the `speech.context` message must specify `languageId: { mode: 'Continuous', languages: [...] }`. Omitting `mode: 'Continuous'` defaults to at-start — a silent gotcha that causes the agent to 'go deaf' when the caller switches languages.",
      ],
    },
    {
      kind: "code",
      filename: "orchestration/stt/azure.ts",
      language: "typescript",
      intro: "Sending the `speech.context` with Continuous LID mode when multiple candidate languages are configured.",
      code: `const candidateLanguages = config.asrLanguage
  ? [config.asrLanguage, ...(config.candidateLanguages ?? [])]
  : ["en-US"];

const speechContext = {
  context: {
    languageId: candidateLanguages.length > 1
      ? {
          mode:      "Continuous",
          priority:  "PrioritizeLatency",
          languages: candidateLanguages,
        }
      : undefined,
    phraseList: config.vocabularyHints ?? [],
  },
};

ws.send(JSON.stringify({
  type: "speech.context",
  ...speechContext,
}));`,
      lines: [
        {
          lines: "1-4",
          label: "candidate language list",
          explanation:
            "`asrLanguage` is the primary language (e.g. `ta-IN`). `candidateLanguages` is an optional list of fallbacks (e.g. `['en-US', 'hi-IN']`). Azure supports up to 4 candidates in Continuous mode. The primary is always first.",
        },
        {
          lines: "6-11",
          label: "mode: Continuous only when needed",
          explanation:
            "Continuous LID is only enabled when more than one candidate language exists. For single-language agents (e.g. English only), `languageId` is `undefined` — Azure defaults to at-start LID, which is faster and cheaper.",
        },
        {
          lines: "8",
          label: "PrioritizeLatency",
          explanation:
            "`priority: 'PrioritizeLatency'` tells Azure to produce transcripts faster at the cost of slightly lower accuracy. For real-time voice conversations, latency is more important than marginal accuracy gains.",
        },
      ],
    },
    {
      kind: "prose",
      heading: "The language rule in the system prompt",
      paragraphs: [
        "Even with the STT handling multi-language input, the LLM needs to know which language(s) to respond in. `session.ts` injects a language rule near the top of the system prompt, below the agent's persona but above the tool descriptions.",
        "For a single-language agent (`language = 'ta-IN'`, `asrLanguage` not set or same), the rule is simple: *'Respond only in Tamil. Do not switch languages.'* For multi-language agents, it lists the candidate languages and their weights.",
        "The rule is injected via `asrLanguage ?? language` — NOT just `language`. This matters because `language` defaults to `en-US` for agents created before multi-language support was added. If `asrLanguage = 'ta-IN'` but `language = 'en-US'`, using only `language` would inject an 'English only' rule that contradicts the Tamil ASR config, causing the LLM to respond in English while the caller speaks Tamil.",
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Strict language rules translate brand names",
      body: [
        "A single-language injection like 'Respond only in Tamil' causes weak LLMs to translate proper nouns. A company named 'PolicyFy' becomes 'நீதிஃபை' (a phonetic transliteration attempt) or literally 'நீதி-ஃபை' (policy-fy). This confuses callers who know the brand in English.",
        "The fix: the language rule must include a proper-noun exemption: *'Respond only in Tamil. Keep proper nouns, brand names, and technical terms in their original language.'* This is added as a standard suffix to all strict single-language rules in `session.ts`.",
      ],
    },
    {
      kind: "connections",
      title: "Language support layers",
      nodes: [
        { id: "caller", label: "Caller Audio", sublabel: "multi-language" },
        { id: "azure", label: "Azure STT", sublabel: "Continuous LID", current: true },
        { id: "transcript", label: "Transcript", sublabel: "correctly transcribed" },
        { id: "session", label: "session.ts", sublabel: "builds system prompt" },
        { id: "rule", label: "Language Rule", sublabel: "injected into prompt", current: true },
        { id: "llm", label: "LLM", sublabel: "responds in correct language" },
        { id: "tts", label: "TTS", sublabel: "synthesises in correct language" },
      ],
      edges: [
        { from: "caller", to: "azure", label: "audio frames" },
        { from: "azure", to: "transcript", label: "Continuous LID" },
        { from: "transcript", to: "llm", label: "user turn" },
        { from: "session", to: "rule", label: "injects" },
        { from: "rule", to: "llm", label: "system prompt" },
        { from: "llm", to: "tts", label: "reply text" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "An agent has `asrLanguage: 'ta-IN'` and `language: 'en-US'` (the default). Which should `session.ts` use when building the language rule?",
          choices: [
            "`language` ('en-US') — it's the agent's configured language",
            "`asrLanguage` ('ta-IN') — it reflects what the STT is actually transcribing",
            "`asrLanguage ?? language` — prefer `asrLanguage` when set",
            "Both — inject rules for both languages",
          ],
          correctIndex: 2,
          explanation:
            "`asrLanguage ?? language` is correct. `asrLanguage` reflects the actual language the STT is set up for. Using only `language` when `asrLanguage = 'ta-IN'` injects 'English only' — a language rule that contradicts the STT config and makes the LLM respond in English to a Tamil caller.",
        },
        {
          prompt: "What happens if you omit `mode: 'Continuous'` in the `speech.context` for a multi-language session?",
          choices: [
            "Azure returns an error and closes the WebSocket",
            "Azure defaults to at-start LID — it locks onto the first language and goes deaf to subsequent switches",
            "Azure uses Continuous mode by default — the explicit setting is just documentation",
            "The agent responds correctly but STT accuracy is reduced",
          ],
          correctIndex: 1,
          explanation:
            "At-start LID (the default) locks onto the detected language from the first few seconds. If the caller starts in English then switches to Tamil, Azure continues trying to transcribe Tamil audio as English — producing garbled or empty transcripts. The agent 'goes deaf' to language switches.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Azure STT has two LID modes: at-start (lock to first language) and Continuous (re-evaluate each utterance)",
        "Continuous mode requires `mode: 'Continuous'` in `speech.context` — omitting it silently falls back to at-start",
        "Every Azure WebSocket frame must include `X-RequestId` — omitting it causes a 1002 close",
        "Language rule in system prompt uses `asrLanguage ?? language` — not just `language`",
        "Add proper-noun exemptions to strict language rules or weak LLMs translate brand names",
      ],
    },
  ],
};
