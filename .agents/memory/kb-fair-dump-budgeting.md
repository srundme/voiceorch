---
name: KB multi-source fair budgeting
description: Why KB dump/baked blocks must budget per-source with rollover, and why the vector-only retrieval budget must be measured, not guessed
---

**Rule:** When joining KB content from multiple sources under a char/entry cap (prefetch dump, baked system-prompt block), split the budget fairly across sources with rollover (unused budget flows to sources that need it), pinned-first WITHIN each source. Never build the joined block first and slice post-hoc.

**Why:** Post-hoc slicing means source 1's entries consume the entire cap and source 2 never reaches the LLM at all — observed in production (call 2159: 8/8 turns answered from source 1's truncated dump; source 2's content never injected, agent claimed ignorance of topics it had a whole KB source for). The starvation is silent: no error, retrieval "succeeds".

**How to apply:** Any new KB injection path (or cap) must go through the fair allocator (`buildFairDump` / `buildKnowledgeBaseBlockEx` in kb-retrieval.ts) and log `contributingSourceIds` + `truncated` + per-source stats so starvation is diagnosable from prod logs.

**Starvation can also happen one layer earlier, at the DB fetch.** A single global `LIMIT` across all sources' rows lets one source's rows (especially many pinned/low-id rows) fill the entire fetch window before the allocator ever sees the other sources — the allocator can't fairly split what it never received. Fix: fetch per-source with a `row_number() over (partition by source_id order by ...)` window function + `WHERE rn <= cap`, never a flat `LIMIT cap*sourceCount`. A code reviewer caught this after the allocator fix alone passed all unit tests — the allocator tests used pre-fetched entries and couldn't see the fetch-stage bug.

**Related lesson — retrieval time budgets must be measured:** pure non-Latin (Tamil) turns skip FTS and are vector-only, so they must wait for the query embed. gemini-embedding-001 Tamil embed latency measured 2026-07-10: p50=510ms / p90=548ms / p99=1112ms — a flat 200ms budget meant the semantic path lost the race to the truncated dump on EVERY Tamil turn. Budget is now split: 200ms default / 800ms skipFts (`resolveKbTurnBudgetMs`), and the embed path logs rolling p50/p90/p99 (`kb_embed_latency_stats`) so the budget can be re-validated from prod logs instead of guessed.
