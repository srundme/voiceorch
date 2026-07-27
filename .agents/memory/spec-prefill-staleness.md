---
name: Speculative prefill prompt staleness
description: State baked into an eager/speculative LLM prefill (langGuard etc.) must be snapshot at launch and re-validated at consumption
---

**Rule:** Any pipeline state that shapes the speculative/eager LLM prefill prompt (currentLang → langGuard, language latch, gender) must be snapshot into `_specLlmState` at launch and compared at consumption. Mismatch = miss (abort prefill, fall through to the real `llm.chat` with the rebuilt prompt).

**Why:** Prod call 4814 — caller opened in Tamil, agent answered turn 1 in English. The prefill launched at VAD speech_end (~35ms before the coalesced final transcript triggered the en→ta auto-detect switch). `isSpeculativeHit()` only compared partial-vs-final TEXT, so the stale English-langGuard prefill was replayed; the rebuilt Tamil prompt was logged for the real request path but never used (replay mock adapter). Symptom pattern: exec log shows correct-language directive in the LLM request payload, wrong-language reply, `Speculative LLM Hit` event on the same turn.

**How to apply:** The final transcript ITSELF can change pipeline state (language auto-detect runs in handleStreamingTranscript before processTurn consumes the prefill). Whenever new state feeds `buildCacheBase`/`buildLangGuard`, add it to the launch snapshot + consumption check. Cost of invalidation is one lost prefill (~400ms) on switch turns — correctness wins. Invalidation logs "Speculative LLM invalidated — caller language switched after prefill launch".
