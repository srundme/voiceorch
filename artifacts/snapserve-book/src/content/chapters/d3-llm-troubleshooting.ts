import type { Chapter } from "../types";

export const llmTroubleshooting: Chapter = {
  slug: "llm-troubleshooting",
  moduleId: "d3",
  number: "19.6",
  title: "LLM Troubleshooting & Tuning Playbook",
  summary:
    "Symptom → cause → exact fix: wrong language, translated brand names, repeated questions, silent turns, spoken tool tags, hallucinations, and slow first token — mapped to real files and dashboard settings.",
  estMinutes: 22,
  fileRef: "artifacts/api-server/src/orchestration/pipeline.ts",
  prerequisites: [
    "llm-pipeline-path",
    "prompt-assembly",
    "gemini-adapter-complete",
    "openai-compat-adapters",
    "fallback-and-retry",
  ],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "How to use this playbook",
      paragraphs: [
        "This is a lookup table for the most common LLM complaints. Each callout is one symptom: what the operator or caller reports, what actually causes it in the code, and the exact file, function, or dashboard setting to change. Start from the symptom that matches, then jump to the referenced chapter for the full explanation.",
        "Two habits first. (1) Always read the **execution log** for the call — the LLM adapters log named events (`llm_reply_truncated`, `gemini_unexpected_thinking`, `Tool Envelope Suppressed`, `First Token Received` with `slow_ttft`) that usually point straight at the cause. (2) Change ONE thing at a time and re-test on a real call; prompt and model changes interact.",
      ],
    },
    {
      kind: "callout",
      variant: "warning",
      title: "Symptom: the agent replies in the wrong language",
      body: [
        "**Cause.** The language guard isn't firing, or is being overpowered. The strict/multilingual rule is built in `session.ts` (`[LANGUAGE RULE]` / `[STRICT LANGUAGE RULE]`), and the per-turn guard is `buildLangGuard()` in `pipeline.ts`, sandwiched at the top AND bottom of the prompt plus a compact reminder appended to the last user turn.",
        "**Fix.** In the dashboard, check the Transcriber **Language** dropdown and the **Auto-detect** toggle. Auto-detect ON = 'follow the caller' (switching allowed); OFF = strict single language. If the agent should never switch, turn Auto-detect OFF so the STRICT rule fires from turn 1. Confirm `effectiveAgentLang` resolution in `session.ts` — a non-English value in EITHER the Language or ASR-Language field wins, so a stale `asrLanguage` can flip the language.",
        "**Also check.** A speculative-prefill replay built for the old language is treated as a miss (`_specLangStale` in `pipeline.ts`); if you see wrong-language turn-1 replies, look for the `Speculative LLM invalidated` log — if it's NOT firing, the language switch wasn't detected in time.",
      ],
    },
    {
      kind: "callout",
      variant: "warning",
      title: "Symptom: a brand or product name gets translated/transliterated",
      body: [
        "**Cause.** The proper-noun EXCEPTION in the language rule isn't strong enough for this model, OR the name resembles a common word in the target language and the model 'helpfully' localized it.",
        "**Fix.** Both language rules in `session.ts` already end with 'keep all proper nouns … EXACTLY as written; never translate or transliterate them, even when part of a name resembles a common word.' If a specific name still slips, add it explicitly to the agent's system prompt (e.g. 'Always write the product name as \"Gala Fit\" in Latin script.').",
        "**Gender salutation variant.** 'Sir'/'Ma'am' getting transliterated is the same bug — handled by the `[CALLER GENDER — MANDATORY]` directive in `pipeline.ts`, which marks the salutation as a proper noun that OVERRIDES the language rule. If it still translates, verify the gender directive is actually being appended (check `effectiveGender()` resolved a value).",
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Symptom: the agent repeats the same question or line",
      body: [
        "**Cause.** Two possibilities. (1) At low temperature with zero repetition penalties, OpenAI-compatible models (incl. Sarvam) emit byte-identical replies turn after turn (this looped on call 548). (2) The per-turn anti-repeat nudge isn't reaching the model.",
        "**Fix.** `session.ts` applies a mild default `presencePenalty: 0.3` and `frequencyPenalty: 0.3` when the agent hasn't set one — verify the agent config didn't override these to 0. The anti-repeat nudge (`buildAntiRepeatNudge` in `pipeline.ts`) quotes the agent's previous line onto the last user turn and forbids a verbatim repeat, escalating after `consecutiveRepeats >= 1`.",
        "**Also.** The conversation-discipline block enforces one-step-at-a-time delivery; if the agent restarts a greeting/pitch after a barge-in, that's the interruption-hint path (`[INTERRUPTED — DO NOT RESTART]`), not the repeat path.",
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Symptom: silent turns (the agent says nothing)",
      body: [
        "**Cause (Sarvam).** Reasoning tokens count toward `max_tokens`. On a tool turn with a small cap, the hidden reasoning trace consumes the entire budget and the model returns `content: null` — a silent turn. This is exactly why `sarvam.ts` enforces a 500-token floor when reasoning runs with tools, and uses `reasoning_effort: \"low\"` (not medium/high) on 30b/105b tool turns.",
        "**Fix.** Raise the agent's **LLM Max Output Tokens** (dashboard → Advanced Settings) above 500, or lower `reasoningEffort` to `low`/`null` in the agent config. `session.ts` reads `reasoningEffort` (null | low | medium | high).",
        "**Cause (Gemini 2.x).** The model thought despite `thinkingBudget: 0` (common on Flash-Lite for Indic inputs), burning latency. Look for the `gemini_unexpected_thinking` warning in the log; switch to a model that respects the budget or to Gemini 3.x.",
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Symptom: the caller hears tool tags or JSON spoken aloud",
      body: [
        "**Cause.** An adapter leaked a serialized tool call into the token stream instead of resolving it via `onToolCall`. Sarvam is the usual culprit — it has four tool-call formats (structured, JSON-in-content, `[bracket]` envelope, trailing `<function>` tag).",
        "**Fix — mostly automatic.** `sarvam.ts` buffer-and-sniffs a leading `{`/fence/`[` and withholds it, and `pipeline.ts` runs a defense-in-depth `envelopeGuard.filter()` on every token so a leaked envelope never reaches TTS. If you see `Tool Envelope Suppressed` in the log, the guard did its job — the caller heard nothing wrong, but investigate why the adapter leaked.",
        "**If it still leaks.** Confirm the tool NAME is in the tools offered this turn — the guard/parser validate against `validToolNames`, so a tool the model invented (not in the agent config) won't be recognized as a tool and may be spoken. Add or correct the tool in the agent's config.",
      ],
    },
    {
      kind: "callout",
      variant: "warning",
      title: "Symptom: the agent hallucinates facts, prices, or slot times",
      body: [
        "**Cause.** The model is answering from training data instead of the knowledge base or tool results, OR the KB context didn't make it into the prompt this turn.",
        "**Fix — KB.** Ensure a knowledge base is attached; `session.ts` auto-injects the `[KB_TRUST]` instruction ('do not guess or invent product details, pricing, policies') whenever a KB is attached. Check the per-turn `KB Context` execution-log event: `hit: false` or `contextChars: 0` means retrieval found nothing — the model then has nothing to ground on. Raise `KB_INJECT_MAX_CHARS` or check the source is indexed.",
        "**Fix — scheduling.** For invented slot times, the `[BOOKING TOOL GUIDE]` / `[SCHEDULING TOOL GUIDE]` blocks in `pipeline.ts` already say 'NEVER invent or guess slot times — you MUST call check_availability first.' If the model still invents times, force tool use: on Groq, scheduling tools trigger `tool_choice: \"required\"` (see `groq.ts`); on Sarvam the `[TOOL USE — MANDATORY]` injection does the same.",
      ],
    },
    {
      kind: "callout",
      variant: "warning",
      title: "Symptom: replies are cut off mid-sentence",
      body: [
        "**Cause.** The reply hit the output-token cap. On Gemini this logs `llm_reply_truncated` with `finishReason: MAX_TOKENS`. Indic scripts use 2–4× more tokens per word than English, so a cap sized for English clips Tamil/Hinglish.",
        "**Fix.** Raise the agent's **LLM Max Output Tokens** (dashboard → Advanced Settings). The voice default is 200 (`VOICE_DEFAULT_MAX_TOKENS` in `session.ts`), chosen because 80 and 160 both clipped Indic replies. On Gemini 3.x the adapter pads the wire cap by `GEMINI3_THINKING_HEADROOM` (256) so thought tokens don't eat the spoken budget — if you're on 3.x and still truncating, raise the configured cap further.",
      ],
    },
    {
      kind: "callout",
      variant: "tip",
      title: "Symptom: slow first token (long silence before the agent speaks)",
      body: [
        "**Cause & fix — model choice.** TTFT is dominated by the model and provider. Use a fast provider/model per agent: Groq `llama-3.1-8b-instant` (~50% faster than 70b), Gemini `gemini-3.5-flash-lite`, or Krutrim `gpt-oss-20b` (Bangalore-hosted, lowest RTT for Indian callers). Set this in the dashboard **Model** dropdown.",
        "**Fix — thinking.** Thinking adds 2–5 s of TTFT. Gemini is silenced by `geminiThinkingConfig` (google.ts); Krutrim Qwen needs `chat_template_kwargs:{enable_thinking:false}` (krutrim.ts); Sarvam keeps `reasoning_effort: null` for non-tool turns. If `First Token Received` logs `slow_ttft`, thinking or a heavy model is the likely cause.",
        "**Fix — caching.** Gemini's explicit context cache and OpenAI-style prompt caching cut TTFT after turn 1 — but ONLY if the static prefix stays byte-identical. If cache hits aren't climbing (check the per-turn `cachedTokens` log), something volatile crept above the date/time tail; see the prompt-assembly chapter.",
        "**Fix — safety net.** Configure a **Fallback LLM** provider so a stalled primary is cancelled after `LLM_TTFT_FALLBACK_MS` (1200 ms) and the fallback answers instead of leaving dead air.",
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "Tuning knobs cheat-sheet (where each lives)",
      body: [
        "**Language / switching:** dashboard Transcriber Language + Auto-detect toggle → `session.ts` + `buildLangGuard()`.",
        "**Max output tokens:** dashboard Advanced Settings 'LLM Max Output Tokens' → `session.ts` `VOICE_DEFAULT_MAX_TOKENS` (200 default).",
        "**Reasoning effort (Sarvam):** agent config `reasoningEffort` (null | low | medium | high) → `sarvam.ts` `buildGenerationBody`.",
        "**Repetition:** `presencePenalty` / `frequencyPenalty` (0.3 default) → `session.ts`.",
        "**KB grounding:** attach a KB (auto `[KB_TRUST]`), `KB_INJECT_MAX_CHARS` env, per-turn `KB Context` log → `session.ts` + `pipeline.ts`.",
        "**Provider / model per agent:** dashboard Model dropdown → `createLLMAdapter` in `adapters/llm/index.ts`.",
        "**Fallback provider:** dashboard Fallback LLM → `fallbackLlmProvider` in `session.ts`, wired in `pipeline.ts`.",
      ],
    },
    {
      kind: "connections",
      title: "Where each fix lives",
      nodes: [
        { id: "session", label: "session.ts", sublabel: "language, KB, max tokens", chapterSlug: "prompt-assembly" },
        { id: "pipeline", label: "pipeline.ts", sublabel: "guards, nudges, fallback", chapterSlug: "llm-pipeline-path" },
        { id: "google", label: "google.ts", sublabel: "thinking, cache, truncation log", chapterSlug: "gemini-adapter-complete" },
        { id: "sarvam", label: "sarvam.ts", sublabel: "reasoning floor, tool sniff", chapterSlug: "openai-compat-adapters" },
        { id: "fallback", label: "retry/fallback", sublabel: "TTFT timer, second provider", chapterSlug: "fallback-and-retry" },
        { id: "troubleshoot", label: "This playbook", sublabel: "symptom → fix", current: true },
      ],
      edges: [
        { from: "troubleshoot", to: "session", label: "wrong language / hallucination" },
        { from: "troubleshoot", to: "pipeline", label: "repeats / tool tags" },
        { from: "troubleshoot", to: "google", label: "truncation / slow TTFT" },
        { from: "troubleshoot", to: "sarvam", label: "silent turns" },
        { from: "troubleshoot", to: "fallback", label: "dead air" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "A Sarvam agent goes silent on tool turns. What is the most likely cause and fix?",
          choices: [
            "The network dropped — restart the call.",
            "Reasoning tokens consumed the whole max_tokens budget, leaving content:null; raise LLM Max Output Tokens above 500 or lower reasoningEffort.",
            "The TTS provider failed.",
            "The caller was muted.",
          ],
          correctIndex: 1,
          explanation:
            "On tool turns reasoning counts toward max_tokens; too small a cap leaves an empty reply. sarvam.ts enforces a 500 floor, and raising the dashboard cap or lowering reasoningEffort fixes it.",
        },
        {
          prompt: "The execution log shows `llm_reply_truncated` / `finishReason: MAX_TOKENS`. What do you change?",
          choices: [
            "Switch STT providers.",
            "Raise the agent's LLM Max Output Tokens in Advanced Settings — the reply hit the output cap (Indic scripts use 2–4× more tokens/word).",
            "Disable the knowledge base.",
            "Turn off Auto-detect.",
          ],
          correctIndex: 1,
          explanation:
            "MAX_TOKENS means the reply hit the cap and was cut mid-sentence; raising the cap (default 200) is the direct fix, especially for Indic-language agents.",
        },
        {
          prompt: "The caller hears the agent read out `{\"name\": \"transfer_to_human\"...}`. Which layer normally prevents this and where do you look if it still leaks?",
          choices: [
            "The STT adapter; check the microphone.",
            "The `envelopeGuard.filter()` in pipeline.ts (and Sarvam's buffer-and-sniff); if it still leaks, confirm the tool name is in the agent's configured tools so validation recognizes it.",
            "The TTS voice; change the voice.",
            "Nothing prevents it; it's expected.",
          ],
          correctIndex: 1,
          explanation:
            "The tool-envelope guard withholds serialized tool calls from TTS, validated against the tools offered this turn — an invented/unconfigured tool name won't be recognized and may be spoken.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Wrong language → check the dashboard Language dropdown + Auto-detect toggle; the rule lives in session.ts and buildLangGuard() in pipeline.ts.",
        "Translated brand names / salutations → the proper-noun EXCEPTION and gender directive already override the language rule; pin stubborn names in the agent prompt.",
        "Repeated questions → presence/frequency penalties (0.3 default in session.ts) and the anti-repeat nudge in pipeline.ts.",
        "Silent turns → Sarvam reasoning eating max_tokens; raise LLM Max Output Tokens or lower reasoningEffort. Gemini 2.x unexpected thinking logs gemini_unexpected_thinking.",
        "Tool tags spoken → envelopeGuard + Sarvam buffer-and-sniff withhold them; ensure the tool is in the agent config so it's recognized.",
        "Hallucinations → attach a KB ([KB_TRUST] auto-injected), check the KB Context log, and force tool use for scheduling; truncation → raise max tokens; slow TTFT → faster model, disable thinking, keep the cache prefix stable, configure a fallback LLM.",
      ],
    },
  ],
};
