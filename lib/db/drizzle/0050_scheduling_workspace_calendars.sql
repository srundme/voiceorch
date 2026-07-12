-- Phase 1: Convert scheduling_calendars from agent-owned to workspace-owned
--
-- 1. Make agent_id nullable — a calendar no longer requires an agent.
--    The 1:1 constraint (UNIQUE + NOT NULL) that forced one calendar per agent is dropped.
-- 2. Drop the unique constraint on agent_id.
-- 3. Add description column — lets users label workspace calendars (e.g. "Dr. John's Calendar").
-- 4. Add google_calendar_id column — the specific Google Calendar ID string within a connected
--    Google Account (e.g. "primary", "abc@group.calendar.google.com"). NULL = use primary (backward compat).
--
-- This is a fully non-destructive migration: all existing rows retain their agent_id value
-- (now nullable), and existing behavior is unchanged until the Phase 2 backend code ships.
--> statement-breakpoint
ALTER TABLE "scheduling_calendars" ALTER COLUMN "agent_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "scheduling_calendars" DROP CONSTRAINT IF EXISTS "scheduling_calendars_agent_id_unique";
--> statement-breakpoint
ALTER TABLE "scheduling_calendars" ADD COLUMN IF NOT EXISTS "description" text;
--> statement-breakpoint
ALTER TABLE "scheduling_calendars" ADD COLUMN IF NOT EXISTS "google_calendar_id" text;
