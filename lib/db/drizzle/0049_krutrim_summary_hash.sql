-- 0049: content-hash column used to detect when a Krutrim agent's attached
-- knowledge source has changed since its auto-generated pinned summary was
-- last produced (kb-source-summary.ts). NULL = summary never generated.
ALTER TABLE "knowledge_sources" ADD COLUMN IF NOT EXISTS "krutrim_summary_hash" text;
