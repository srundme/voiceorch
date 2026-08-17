-- White-label help/legal links so managed clients never see SnapServe support.
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "support_email" text;
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "support_url" text;
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "docs_url" text;
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "terms_url" text;
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "privacy_url" text;
