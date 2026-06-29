---
name: LLM fallback chain pattern
description: How the P0-B LLM fallback is wired in pipeline.ts and webcall.ts
---

## Rule
The fallback LLM fires only when: (1) primary LLM throws, AND (2) no tokens were received yet (`llmFirstTokenAt === null` / `_tLlmFirstToken === null`). If the primary produced partial output and then died mid-stream, we do NOT retry (caller already heard something; retry would duplicate content).

## Why
Mid-stream retries would restart the response from scratch, causing the caller to hear duplicate sentences. The safe window for retry is zero-token failures only (auth errors, network errors, provider outages).

## How to apply
- pipeline.ts: `this.fallbackLlm` is a class field, initialised in constructor from `agent.fallbackLlmProvider` + providerKeys map.
- webcall.ts: reads `(agent as any).llmFallbackProvider` from the raw DB row (no AgentConfig wrapper); creates adapter inline in the catch block.
- Both paths reset `llmResponse`/`tokenBuf` to `""` before calling fallback so no partial content bleeds through.
- DB columns: `llm_fallback_provider`, `llm_fallback_model` (nullable text) on agents table.

## Ancillary in-call LLM calls must also use the fallback
Any in-call LLM call OTHER than the main turn loop (e.g. the warm-transfer operator-briefing summary in `executeCallTransfer`) must route primary→fallback too — a bare `this.llm.chat` there silently dies when the primary model is unavailable (retired Anthropic model → 404) and the feature degrades invisibly (warm transfer became a context-free cold transfer). For the briefing specifically there is also a last-resort raw-transcript briefing (last 6 user/assistant turns, capped ~1000 chars) so the operator always gets some context even if every LLM is down.
**Why:** the turn loop's fallback kept conversations alive, masking that the briefing had no fallback — so the agent talked fine but the operator handoff lost all context, and the swallowed error made it look like a transfer-config bug.
