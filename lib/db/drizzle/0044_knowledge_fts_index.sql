-- GIN index for full-text search over knowledge_entries
-- Supports ts_rank_cd retrieval via to_tsvector on (title || content || keywords)
CREATE INDEX IF NOT EXISTS knowledge_entries_fts_idx
  ON knowledge_entries
  USING GIN (
    to_tsvector(
      'english',
      coalesce(title, '') || ' ' || content || ' ' || coalesce(keywords, '')
    )
  );
