-- Phone renewal mode (autopay vs wallet-only) + grace deadline before auto-release.
ALTER TABLE "phone_numbers" ADD COLUMN IF NOT EXISTS "renewal_mode" text DEFAULT 'wallet' NOT NULL;
ALTER TABLE "phone_numbers" ADD COLUMN IF NOT EXISTS "renewal_grace_until" timestamp with time zone;

ALTER TABLE "phone_number_orders" ADD COLUMN IF NOT EXISTS "renewal_mode" text DEFAULT 'wallet' NOT NULL;
