---
name: LLM transient-error same-provider retry
description: Turn-loop retries the primary LLM on transient 503/429/5xx/network errors before falling back or failing the call
---

# LLM transient-error same-provider retry (turn loop)

A single momentary provider error (e.g. Google Gemini `503 Service Unavailable —
high demand, try again later`) used to drop the WHOLE call: the turn loop went
straight from the primary `this.llm.chat(...)` catch to the fallback-or-fatal
branch. Agents with NO `fallbackLlmProvider` had no recovery at all — one 503 =
dead call (call 1296).

**Fix:** the primary LLM call is wrapped in a bounded retry loop
(`MAX_LLM_ATTEMPTS = 3` → 1 initial + 2 retries, 300ms·(n-1) backoff) in
`pipeline.ts` turn loop. Retry fires ONLY when `isRetryableLlmError(err)` (a
module-level helper matching 429/5xx + network faults; excludes deterministic
4xx like auth/bad-request/quota) AND `llmFirstTokenAt === null`.

**Why the `llmFirstTokenAt === null` gate is load-bearing:** if any LLM token has
already streamed, its sentence(s) were enqueued to TTS and may have been spoken —
restarting the stream would double-speak the reply. Only when no token has
streamed is a clean restart safe. On each retry, reset `llmResponse=""`,
`pendingText=""`, and defensively `triggeredToolName=null`/`triggeredToolArgs={}`
(an adapter could invoke a tool callback with no text before a later throw).

**Why the line survives the retry window:** the ambient/keepalive audio pump runs
on its own interval and fills silence during LLM generation (`isSendingTtsAudio`
false between turns), so the carrier (VoBiz drops after ~2s silence) stays alive
through the sub-second retry backoff. The dead-air `fillerTimer` is cleared on
catch and intentionally NOT re-armed per retry.

**Control flow:** `for` loop wraps the `try`; success does `llmErr=null; break`;
catch stores `llmErr=err` then `continue` (retryable + pre-token + attempts left)
or `break`; the EXISTING fallback-LLM-or-fatal block runs post-loop under
`if (llmErr) { … }` and still `throw llmErr` on the fatal path. `llmErr` is an
outer `let` (not the catch param) so the post-loop block sees the final error.

**Retry runs BEFORE the configured fallback** — same-provider recovery is
preferred over switching providers; the backoff is small. If ultra-low latency
ever matters more than same-provider recovery, make this policy configurable.

**Scope:** turn loop only. The greeting LLM path (~line 1477) is separately
resilient (see pre-greeting-drop-resilience.md) — do not touch it here. A
managed-Groq emergency fallback for agents with no configured fallback is a
larger, separate change (follow-up, not implemented here).
