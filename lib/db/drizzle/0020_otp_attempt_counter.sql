ALTER TABLE "password_reset_otps" ADD COLUMN IF NOT EXISTS "attempts" integer NOT NULL DEFAULT 0;
