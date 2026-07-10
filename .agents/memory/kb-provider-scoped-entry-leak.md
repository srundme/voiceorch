---
name: Provider-scoped auto-generated KB entries must be excluded elsewhere
description: A KB entry generated for one LLM provider's benefit (e.g. Krutrim auto-summary) leaks to every other agent sharing that knowledge source unless explicitly excluded
---

**Rule:** If a background job writes a synthetic/derived entry into `knowledge_entries` for the benefit of one provider (or any other narrow scope), every KB retrieval path (baked full-dump AND per-turn hybrid retrieval) must accept an `excludeTitles`-style filter and apply it whenever the calling agent is outside that scope. `agent_knowledge_sources` is many-to-many — a source is not provider-exclusive just because it was created for one provider's agent.

**Why:** Caught by code review, not by initial manual testing — a Krutrim-only auto-generated summary entry was inserted directly into the shared `knowledge_entries` table. Any non-Krutrim agent attached to the same source silently gained that entry in both its baked system-prompt block and its live per-turn retrieval, which is an undocumented behavior change for providers the task explicitly said "must not touch."

**How to apply:** Thread the exclusion list end-to-end — every retrieval leg, the cache key, and every call site that assembles agent context — computed once per agent from its provider field, not per source.

**Also required — event-driven refresh, not sweep-only:** a periodic sweep alone leaves up to one full interval of staleness after ingestion/edit/attach. Fire the same regeneration kick (non-blocking) from every mutation path, not just the sweep.

**Also required — handle the zero-content case explicitly:** if the regeneration job skips early when a source has no real entries left (e.g. `if (entries.length === 0) return`), a stale synthetic/derived entry + its content hash persist forever after the user deletes all real content — the provider keeps getting facts from deleted data. The empty-state branch must delete the synthetic row and reset the hash, not just skip.
