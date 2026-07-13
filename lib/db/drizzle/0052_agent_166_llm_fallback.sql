-- Agent 166 (vikram): faster Krutrim model as TTFT/availability fallback when
-- the primary model (gemma-4-E4B-it) is slow or errors before first token.
UPDATE agents
SET llm_fallback_provider = 'krutrim',
    llm_fallback_model    = 'gpt-oss-20b'
WHERE id = 166
  AND (llm_fallback_provider IS NULL OR btrim(llm_fallback_provider) = '');
