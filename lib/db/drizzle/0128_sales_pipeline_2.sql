-- Sales pipeline phase 2: inbound flag, customer-facing notes, proposal lifecycle timestamps.

ALTER TABLE "sales_companies" ADD COLUMN IF NOT EXISTS "is_inbound" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "sales_companies" ADD COLUMN IF NOT EXISTS "customer_notes" text;
--> statement-breakpoint
UPDATE "sales_companies" SET "is_inbound" = true
WHERE "is_inbound" = false AND "original_source" IS NOT NULL AND "original_source" <> 'field_visit';
--> statement-breakpoint
ALTER TABLE "sales_proposals" ADD COLUMN IF NOT EXISTS "sent_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "sales_proposals" ADD COLUMN IF NOT EXISTS "declined_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "sales_proposals" ADD COLUMN IF NOT EXISTS "decline_reason" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_companies_inbound_idx" ON "sales_companies" ("is_inbound") WHERE "is_inbound" = true;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_payments_status_idx" ON "sales_payments" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_subscriptions_status_idx" ON "sales_subscriptions" ("status");
