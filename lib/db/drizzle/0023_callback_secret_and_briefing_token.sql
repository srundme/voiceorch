-- Auto-redial columns + security tokens for scheduled_callbacks and call_transfers
-- These were added to the Drizzle schema without a matching migration file.

ALTER TABLE "scheduled_callbacks"
  ADD COLUMN IF NOT EXISTS "reason" text DEFAULT 'callback_requested',
  ADD COLUMN IF NOT EXISTS "attempt_count" integer DEFAULT 1 NOT NULL,
  ADD COLUMN IF NOT EXISTS "max_attempts" integer DEFAULT 5 NOT NULL,
  ADD COLUMN IF NOT EXISTS "redial_interval_minutes" integer DEFAULT 30 NOT NULL,
  ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp,
  ADD COLUMN IF NOT EXISTS "notes" text,
  ADD COLUMN IF NOT EXISTS "callback_secret" text;
--> statement-breakpoint
ALTER TABLE "call_transfers"
  ADD COLUMN IF NOT EXISTS "briefing_token" text;
