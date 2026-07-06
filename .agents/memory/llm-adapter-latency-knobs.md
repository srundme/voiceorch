---
name: LLM adapter latency knobs — maxTokens + request timeout
description: Two latency/reliability levers that were present on some LLM adapters (Groq, Qwen) but missing on others (Gemini) — check all adapters when auditing for parity.
---

`maxTokens`/`max_tokens` (bounding output length) directly bounds total
per-turn latency (`Total Latency = TTFT + output_tokens/generation_speed +
network`), and an explicit per-request timeout lets a stalled provider
connection fail fast into the pipeline's existing same-provider retry /
fallback-LLM logic instead of hanging the call. Groq and Qwen adapters had
both; the Gemini adapter had neither until it was audited and given parity
(mapped to Gemini's `maxOutputTokens` + SDK `requestOptions.timeout`).

**Why:** `LLMGenerationParams.maxTokens` is a generic, already-plumbed field
(from agent config → `createLLMAdapter`) — when a new provider adapter is
added or an existing one is audited, it's easy to only wire the fields you
were originally asked for and silently miss ones sibling adapters already
established as best practice.

**How to apply:** when adding a new LLM adapter or asked to "improve
latency" on an existing one, diff it against the other adapters in
`orchestration/adapters/llm/` for: `maxTokens` support, an explicit request
timeout, and (if streaming) whether provider "priority"/dedicated-resource
tiers exist and are being used. Don't assume one adapter's optimizations
have propagated to the others.
