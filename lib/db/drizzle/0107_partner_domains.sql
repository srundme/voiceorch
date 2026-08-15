ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "slug" text;
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "custom_domain" text;
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "custom_domain_status" text DEFAULT 'none' NOT NULL;
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "domain_verify_token" text;
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "custom_domain_verified_at" timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS "partners_slug_unique" ON "partners" ("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "partners_custom_domain_unique" ON "partners" ("custom_domain");
