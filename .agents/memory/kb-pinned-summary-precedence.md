---
name: KB pinned summary + system-prompt precedence
description: How KB injection ordering, pinned entries, and precedence disclaimers work after the retrieval-reliability tuning
---

# KB pinned summary + system-prompt precedence

- **Prompt order rule:** the agent system prompt comes FIRST; every KB block (baked in session.ts AND per-turn in pipeline.ts) is APPENDED after it with a fixed precedence disclaimer ("system prompt takes precedence"). Never prepend KB again — agents override KB facts (custom hours/app names) via their prompt.
  - **Why:** KB reference data was overriding agent-specific configuration; also positional recency made weak models trust the KB over instructions.
  - Gemini cache safety: `cacheBaseForTurn` is captured from the final system prompt BEFORE any per-turn volatile append, so the reorder is cache-safe — but keep it that way.
- **Pinned entries** (`knowledge_entries.pinned`, migration 0048): sort first in every full-dump injection (`dumpEntries` orders `pinned DESC, id`); dump has a fallback retry WITHOUT pinned ordering for DBs missing the column. A curated ~4k-char master summary is seeded pinned so cap truncation never drops broad coverage.
- **Curated summary is production DATA, not code:** content lives in `scripts/src/galaxy-kb-summary-content.ts`; the idempotent seeder upserts by exact title marker and resets `embedding=NULL` on content change (the single re-embed signal). Must be manually reviewed when source docs change.
- **Race-budget invariant:** the prefetch fallback's inner wait budget MUST stay below the outer per-turn race (`KB_TURN_RETRIEVAL_BUDGET_MS 200 < KB_CONTEXT_RACE_MS 300`) or the fallback is structurally dead. The fallback dump is capped (8k) only at the per-turn prefetch site — the call-start baked path keeps its own separate 4k cap in session.ts.
- **Per-turn Knowledge exec-log event** fires every turn of a KB agent (hit, source fts/vector/hybrid/dump/prefetch/baked/none, latencyMs, contextChars, cached, raceTimedOut) — use it to confirm caps hold on real calls.
- Pure non-Latin (e.g. Tamil-only) queries skip FTS (vector only); code-mixed queries still run FTS. LRU query cache keyed sourceIds+normalized query (10-min TTL) — never query text alone (cross-tenant leak).
