ALTER TABLE "users" ALTER COLUMN "concurrent_limit" SET DEFAULT 15;
--> statement-breakpoint
UPDATE "users" SET "concurrent_limit" = 15 WHERE "concurrent_limit" < 15;
