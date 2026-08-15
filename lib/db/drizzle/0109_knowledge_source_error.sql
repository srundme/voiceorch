-- Store the real reason a KB import failed (scanned/encrypted/corrupt PDF, etc.)
ALTER TABLE "knowledge_sources" ADD COLUMN IF NOT EXISTS "error_message" text;
