-- Vector RAG for the knowledge base (pgvector).
-- Soft-fail by design: on databases without the pgvector extension (e.g.
-- self-hosted postgres:16-alpine), this migration logs a WARNING and applies
-- nothing — the server boots normally and KB retrieval stays FTS-only.
-- Runtime code probes for the "embedding" column and latches vector search
-- on/off accordingly (isKbVectorReady in kb-embeddings.ts).
DO $$
BEGIN
  BEGIN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS vector';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'pgvector extension unavailable — KB vector search stays disabled: %', SQLERRM;
  END;

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    BEGIN
      EXECUTE 'ALTER TABLE "knowledge_entries" ADD COLUMN IF NOT EXISTS "embedding" vector(768)';
      EXECUTE 'ALTER TABLE "knowledge_entries" ADD COLUMN IF NOT EXISTS "embedding_model" text';
      EXECUTE 'ALTER TABLE "knowledge_entries" ADD COLUMN IF NOT EXISTS "embedded_at" timestamp with time zone';
      EXECUTE 'CREATE INDEX IF NOT EXISTS "knowledge_entries_embedding_hnsw" ON "knowledge_entries" USING hnsw ("embedding" vector_cosine_ops)';
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'KB vector columns/index skipped: %', SQLERRM;
    END;
  END IF;
END $$;
