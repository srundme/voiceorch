ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "source_form_id" text;
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "source_page_id" text;
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "last_validation_error" json;
