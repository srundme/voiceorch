---
name: LLM prompt-cache prompt ordering
description: Why per-turn-dynamic system-prompt content (datetime) must go at the END, and the staged-prompt rebuild gotcha
---

# System-prompt ordering for provider prompt caching

**Rule:** Any content that changes every turn (esp. the `[CURRENT DATE & TIME]`
injection from `datetimeInject.ts`, which changes down to the minute) MUST be
appended at the **very end** of the per-turn system prompt, never near the top.

**Why:** OpenAI (and OpenAI-compatible) prompt caching only reuses an *exact,
unbroken token prefix*. VoiceOrch's base system prompt already contains the
~7000-token static block (language rules + `=== CALLER MEMORY ===` injected once
at session setup in `session.ts` + tool guides). If a per-minute datetime line
sits before that block, the entire block is a cache MISS every turn → high /
variable LLM TTFT on voice calls. Putting datetime last keeps everything before
it byte-identical across turns so it caches after turn 1.

**How to apply (in `pipeline.ts` `processTurn`):**
- Build `dtInjection` but do NOT concatenate it into the top prefix. The prefix
  is `langGuard + base + langGuard` (langGuard = language rule, mostly stable
  within a call).
- Append `systemPromptForTurn += "\n\n" + dtInjection` at the true tail — i.e.
  **AFTER the Layer-4 staged-prompt block**, because that block does
  `systemPromptForTurn = core + stage.content` which **fully REPLACES** the
  prompt and would otherwise drop anything appended earlier. (Side effect:
  staged mode now includes the datetime it previously lost — desired.)
- Nothing must mutate `systemPromptForTurn` between that append and the
  `this.llm.chat(historyForLlm, systemPromptForTurn, …)` send.

**Verification:** `LLMUsage.cachedTokens` is populated from
`chunk.usage.prompt_tokens_details.cached_tokens` in the OpenAI adapter; the
pipeline logs a per-turn `"LLM prompt cache"` line with `cachedTokens` +
`cacheHitRatio`. cachedTokens should climb toward `inputTokens` on turns 2+.

**Residual:** dynamic KB-context retrieval is still appended before some static
tool-guide text, so those trailing tool-guide tokens won't cache when KB varies.
The big win (base + caller memory) is fixed; leave KB reordering alone unless
measured — moving it risks recency-sensitive behavior changes.
