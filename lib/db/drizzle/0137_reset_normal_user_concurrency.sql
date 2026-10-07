-- Migration 0137: Reset normal users concurrent limit to 1
ALTER TABLE "users" ALTER COLUMN "concurrent_limit" SET DEFAULT 1;
--> statement-breakpoint
UPDATE "users"
SET "concurrent_limit" = 1
WHERE "partner_id" IS NULL
  AND "clerk_id" NOT IN (
    SELECT "user_id" FROM "partners" WHERE "user_id" IS NOT NULL
  );
