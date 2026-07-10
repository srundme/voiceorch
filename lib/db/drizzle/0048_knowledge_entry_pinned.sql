-- 0048: pinned flag for knowledge entries.
-- Pinned entries sort FIRST in the KB full-dump injection paths (call-start
-- baked block + per-turn prefetch fallback in kb-retrieval.ts), so a curated
-- summary entry can lead the injected context ahead of insertion-order entries.
ALTER TABLE "knowledge_entries" ADD COLUMN IF NOT EXISTS "pinned" boolean NOT NULL DEFAULT false;
