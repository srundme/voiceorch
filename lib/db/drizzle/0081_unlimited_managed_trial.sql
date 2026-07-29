ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "unlimited_managed_trial" boolean DEFAULT false NOT NULL;
