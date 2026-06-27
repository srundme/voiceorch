-- Migration 0018 was skipped on production because its `when` timestamp in
-- _journal.json (1782371989332) was older than 0017 (1782900000000). Drizzle's
-- migrate() only runs migrations where folderMillis > lastApplied.created_at,
-- so 0018 was permanently skipped. This migration adds the column with IF NOT
-- EXISTS to fix all production databases that missed it.
ALTER TABLE "caller_profiles" ADD COLUMN IF NOT EXISTS "preferred_language" text;
