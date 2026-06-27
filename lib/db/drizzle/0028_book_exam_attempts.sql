-- Book exam attempts: one immutable row per final-exam submission for
-- "The SnapServe Book". Keyed by the same anonymous device UUID as book_progress.
-- Grading is server-side, so score/passed here are authoritative.
-- Idempotent (IF NOT EXISTS) so migrate() can safely (re)apply it on every DB.
CREATE TABLE IF NOT EXISTS "book_exam_attempts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "device_id" text NOT NULL,
        "score" integer NOT NULL,
        "total" integer NOT NULL,
        "passed" boolean NOT NULL,
        "duration_seconds" integer,
        "answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "book_exam_attempts_device_idx" ON "book_exam_attempts" ("device_id");
