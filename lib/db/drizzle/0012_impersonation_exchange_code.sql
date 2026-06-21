ALTER TABLE "admin_impersonation_sessions" ADD COLUMN IF NOT EXISTS "exchange_code" text;
--> statement-breakpoint
ALTER TABLE "admin_impersonation_sessions" ADD COLUMN IF NOT EXISTS "exchange_code_expires_at" timestamp with time zone;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'admin_impersonation_sessions_exchange_code_unique'
  ) THEN
    ALTER TABLE "admin_impersonation_sessions" ADD CONSTRAINT "admin_impersonation_sessions_exchange_code_unique" UNIQUE("exchange_code");
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_impersonation_sessions_exchange_code_idx" ON "admin_impersonation_sessions" ("exchange_code") WHERE exchange_code IS NOT NULL;
