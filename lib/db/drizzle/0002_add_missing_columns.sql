-- Adds columns present in the Drizzle schema but absent from migrations 0000/0001.
-- All statements use IF NOT EXISTS so this is fully idempotent regardless of DB state.

ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "llm_fallback_provider" text;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "llm_fallback_model" text;
