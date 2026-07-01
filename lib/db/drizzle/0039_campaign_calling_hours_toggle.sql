-- Migration: Add calling-hours enabled toggle to campaigns table
-- Issue: allow users to disable calling hours without losing schedule

ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "is_calling_hours_enabled" boolean DEFAULT true NOT NULL;

-- Existing rows get true (calling hours ARE enabled by default, preserving current behavior)
UPDATE "campaigns" SET "is_calling_hours_enabled" = true;
