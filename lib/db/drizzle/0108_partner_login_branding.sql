-- Partner white-label login gateway copy (logo already exists on partners).
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "login_title" text;
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "login_subtitle" text;
