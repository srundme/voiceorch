-- Book progress: anonymous per-device progress for "The SnapServe Book".
-- One row per device UUID (generated client-side, stored in localStorage).
-- Idempotent (IF NOT EXISTS) so migrate() can safely (re)apply it on every DB.
CREATE TABLE IF NOT EXISTS "book_progress" (
	"device_id" text PRIMARY KEY NOT NULL,
	"completed_chapters" text[] DEFAULT '{}'::text[] NOT NULL,
	"quiz_answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
