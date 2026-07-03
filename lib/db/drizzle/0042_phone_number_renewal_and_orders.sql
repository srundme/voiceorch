-- Migration: phone number renewal fields + phone_number_orders table
-- Adds recurring monthly renewal tracking to phone_numbers (billed on the
-- purchase-date anniversary from wallet balance, see services/phone-renewal.ts)
-- and a new phone_number_orders table tracking payment-gated Razorpay
-- purchase orders (see routes/phone-numbers.ts purchase/initiate + confirm).
ALTER TABLE "phone_numbers" ADD COLUMN IF NOT EXISTS "renewal_rate_cents" integer NOT NULL DEFAULT 800;
ALTER TABLE "phone_numbers" ADD COLUMN IF NOT EXISTS "next_renewal_at" timestamp with time zone;
ALTER TABLE "phone_numbers" ADD COLUMN IF NOT EXISTS "last_renewal_at" timestamp with time zone;

CREATE TABLE IF NOT EXISTS "phone_number_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"number" text NOT NULL,
	"country_code" text NOT NULL,
	"region" text,
	"number_type" text DEFAULT 'local' NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"razorpay_order_id" text,
	"razorpay_payment_id" text,
	"phone_number_id" integer,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "phone_number_orders_razorpay_order_id_unique" UNIQUE("razorpay_order_id"),
	CONSTRAINT "phone_number_orders_razorpay_payment_id_unique" UNIQUE("razorpay_payment_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "phone_number_orders" ADD CONSTRAINT "phone_number_orders_user_id_users_clerk_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("clerk_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "phone_number_orders" ADD CONSTRAINT "phone_number_orders_phone_number_id_phone_numbers_id_fk" FOREIGN KEY ("phone_number_id") REFERENCES "public"."phone_numbers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
