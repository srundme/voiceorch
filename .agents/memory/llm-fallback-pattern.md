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
