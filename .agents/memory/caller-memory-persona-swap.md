---
name: Caller-memory persona-swap invalidation
description: When an agent is repurposed (system prompt changes), retiring stale caller memory must clear THREE inputs, not just the DB rows.
---

When `computePersonaHash(agent.systemPrompt)` at call start differs from the stored `__agent_persona_hash` marker fact, `updateCallerProfile` treats it as a persona swap and must retire the old domain's memory so it can neither resurface on later calls nor re-pollute the new persona at this call's end.

The invariant — a persona swap must clear ALL THREE of these before the post-call LLM extraction (`runLLMExtraction`) runs:
1. `priorFacts` (in-memory facts fed to extraction) → `[]`
2. DB rows → supersede old facts (except the marker), null the profile's predictedIntent/summary/riskScore/sentimentTrend, and null pre-swap archive summaries/sentiment (keeping THIS call's archive row)
3. `priorContext` (the prior-summary string passed into `runLLMExtraction`) → `""`

**Why:** clearing only #1 and #2 still leaks. `priorContext` is computed from `existing?.summary` and handed to the extraction LLM with a "merge with any prior context above" instruction, so the very first post-swap call regenerates a new summary containing the retired domain's content and saves it as fresh memory — silently undoing the gate. Caught in architect review of the call-548 fixes.

**How to apply:** any change to the persona-swap block in `callerMemory.ts` must keep all three clears in lockstep. `priorContext` is declared `let` (not `const`) specifically so the swap block can blank it. Live-call suppression is a separate mechanism (`loadCallerContext` flags `personaChanged`; `injectEnhancedMemory` gates domain memory while preserving the caller name) — both layers are needed.
