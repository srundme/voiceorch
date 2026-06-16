---
name: KB FTS Architecture
description: AI Knowledge system replaced with PostgreSQL Full Text Search — no embeddings, no pgvector
---

## Rule
The AI Knowledge system uses PostgreSQL FTS (plainto_tsquery / ts_rank / GIN index). There are NO embeddings, no pgvector, no similarity calculations anywhere.

## Tables
- `knowledge_sources` — id, user_id, name, type (faq/text/website), status, entry_count
- `knowledge_entries` — id, source_id, user_id, title, content, keywords + GIN index on tsvector

## GIN Index
```sql
CREATE INDEX knowledge_entries_fts_idx ON knowledge_entries
USING GIN (to_tsvector('english', coalesce(title, '') || ' ' || content || ' ' || coalesce(keywords, '')));
```

## Agent linkage
`agents.knowledge_base_id` (integer) points to `knowledge_sources.id`, kept for backward compat. Agents are now M:N with sources via the `agent_knowledge_sources` join table (composite PK, cascade FKs).

**Union-everywhere convention:** the effective attached-source set is always `join table ∪ legacy knowledge_base_id`. Any code that reads attached sources must compute this union — never trust the legacy column or the join table alone. This union is duplicated across routes (agents get/list/create/patch) AND all 3 orchestration paths (session.ts, pipeline.ts ×3 sites, webcall.ts via kb-retrieval `getAttachedSourceIds`/`retrieveKbContextMulti`). Old agents with stale IDs get empty context silently.

## Pipeline retrieval
`orchestration/kb-retrieval.ts` → `retrieveKbContext(knowledgeSourceId, query, topK)` runs plainto_tsquery and returns top-K entries as a prompt-injectable string.

## Test panel search
`POST /knowledge-sources/:id/search` → runs FTS, calls Gemini 1.5 Flash for LLM answer, returns `{ answer, matchedEntries[{ entry, rank, snippet }] }`.

**Why:** Gemini embedding models returned 404 for all model names. FTS is simpler, faster, zero external dependency, and fully reliable.

**How to apply:** Never add embedding calls to the KB system. If semantic search is needed later, add a separate flag-gated path rather than reverting the whole system.
