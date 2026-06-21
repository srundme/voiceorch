-- Change the column-level default from 'UTC' to 'Asia/Kolkata' so new calendars
-- created without an explicit timezone always land on the correct default.
ALTER TABLE "scheduling_calendars"
  ALTER COLUMN "timezone" SET DEFAULT 'Asia/Kolkata';

-- One-time backfill: update existing calendars that still have timezone='UTC'
-- (all calendars created before this migration). Idempotent — safe to re-run.
UPDATE "scheduling_calendars"
SET "timezone" = 'Asia/Kolkata'
WHERE "timezone" = 'UTC';
