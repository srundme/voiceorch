-- Idempotent catch-all for columns that were in 0001_production_schema_sync
-- but may have been skipped on DBs where 0001 was seeded-not-run by
-- bootstrapMigrationJournal. All statements use IF NOT EXISTS.

ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "snapserve_agent_id" text;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "context_window_turns" integer;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "token_summarization_enabled" boolean DEFAULT false;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "token_summarization_threshold_turns" integer;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "staged_prompt_enabled" boolean DEFAULT false;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "staged_prompt_stages" jsonb;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "staged_prompt_core_identity" text;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "inbound_phone_number_id" integer;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "outbound_phone_number_id" integer;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "first_speaker" text DEFAULT 'assistant';
--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "tokens_saved" integer;
