-- Fix schema drift: users.is_test exists in schema.ts (and prod, added via
-- raw SQL) but no migration ever created it — fresh databases broke the
-- VoBiz wallet monitor. Idempotent.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_test" boolean DEFAULT false NOT NULL;
