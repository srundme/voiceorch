---
name: KB Retrieval Architecture (hybrid vector + FTS)
description: KB retrieval is now hybrid pgvector semantic search + PostgreSQL FTS fused via RRF, with a total-fallback capability latch; PDF ingest is Gemini multimodal with pdf-parse fallback
---

## Rule
KB per-turn retrieval (`orchestration/kb-retrieval.ts`) is HYBRID: pgvector cosine search over `gemini-embedding-001` vectors (768-dim MRL truncation, re-normalized) fused with PostgreSQL FTS (plainto_tsquery/ts_rank) via reciprocal-rank fusion. Vector and FTS run concurrently; ANY vector failure (latch off, no key, embed timeout, SQL error) degrades to pure FTS the same turn — exactly the pre-vector behavior. The dashboard test-panel search route deliberately stays Qwen-reads-all (no vectors).

## The vectorReady capability latch (the fallback guarantee)
- Migration 0045 soft-fails inside `DO $$` with a WARNING when pgvector is unavailable (e.g. self-hosted `postgres:16-alpine`), so `migrate()` never crashes.
- `probeKbVectorSupport()` (services/kb-embeddings.ts) checks information_schema at startup for the actual `embedding` column; every embed/kick/vector path no-ops when the latch is false → FTS-only, zero regression.
- **Because the column may not exist**, EVERY select/returning on `knowledge_entries` must use explicit columns (`entryCols`), never `select()` — `select *` would break all KB routes on a soft-failed DB, and vectors must never serialize to the frontend.

## Embedding worker convention
- `embedding = NULL` is the single "needs embedding" signal. All content write paths reset it to NULL (gated on the latch) + `kickKbEmbedWorker()`. ONE central worker back-fills; no per-path embedding hooks.
- Worker UPDATE is guarded on `embedding IS NULL AND content = <embedded content>` so a concurrent edit never gets a stale vector.
- `startKbEmbedMaintenance()` (index.ts, after migrate): probe→kick, 10-min re-kick, plus a 15-min sweep marking sources stuck in processing/crawling/validating as failed (orphaned background PDF jobs).
- **Watch item (poison batch):** worker always selects NULL rows in id order (limit 32); one persistently-failing row blocks all later rows (FTS still works). If "KB embed worker run failed" recurs in prod, add per-row error skipping.
- Title/keyword-only edits don't reset the embedding (content-only trigger) — minor accepted staleness.

## PDF ingestion (Gemini multimodal)
- Upload route responds 201 immediately (`status: processing`), then background `extractPdfChunksWithGemini` (gemini-2.5-flash inlineData, ≤14MB, JSON response mode) → semantic chunks with title/keywords, tables preserved as markdown; falls back to legacy pdf-parse text chunking on any failure; total failure → status failed.
- Delete-during-background-job is safe: cascade delete makes entry inserts throw FK, caught, status update no-ops.

## Tables / linkage (unchanged from FTS era)
- `knowledge_sources` + `knowledge_entries` (now + embedding vector(768), embedding_model, embedded_at; HNSW index when pgvector present); GIN FTS index unchanged.
- **Union-everywhere convention:** effective attached-source set is always `agent_knowledge_sources ∪ legacy agents.knowledge_base_id` — duplicated across routes AND all 3 orchestration paths.

## Env knobs
`KB_EMBED_QUERY_TIMEOUT_MS` (default 1500) bounds the per-turn query embed. Self-hosted compose now ships `pgvector/pgvector:pg16` (drop-in for postgres:16; plain postgres still works, FTS-only).

**Why:** multilingual (Tamil/Hinglish) callers paraphrase — FTS keyword matching missed semantically-equivalent queries ("money back guarantee" vs "refund policy"). gemini-embedding-001 (the earlier 404s were wrong model names / old API surface) is multilingual and works with the managed Gemini key.

**How to apply:** never bypass the latch; never add `select()` on knowledge_entries; all new KB content write paths must reset embedding→NULL + kick the worker, nothing else.
