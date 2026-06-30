ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "trigger_mode" text NOT NULL DEFAULT 'batch';
