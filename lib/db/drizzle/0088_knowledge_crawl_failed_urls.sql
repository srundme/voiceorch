-- Persist failed website crawl URLs for retry + Needs-attention UI.
ALTER TABLE "knowledge_sources" ADD COLUMN IF NOT EXISTS "crawl_failed_urls" text;
