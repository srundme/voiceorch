-- Portal login lockout for managed clients on partner white-label hosts.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "portal_login_failed_attempts" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "portal_login_locked_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "portal_login_locked_reason" text;

CREATE INDEX IF NOT EXISTS "users_portal_login_locked_at_idx"
  ON "users" ("portal_login_locked_at")
  WHERE "portal_login_locked_at" IS NOT NULL;
