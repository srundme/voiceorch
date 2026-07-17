CREATE TABLE IF NOT EXISTS "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_number" text NOT NULL,
	"user_id" integer NOT NULL,
	"type" text NOT NULL,
	"description" text NOT NULL,
	"hsn_sac" text,
	"base_cents" integer NOT NULL,
	"cgst_cents" integer DEFAULT 0 NOT NULL,
	"sgst_cents" integer DEFAULT 0 NOT NULL,
	"igst_cents" integer DEFAULT 0 NOT NULL,
	"gst_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"gst_rate_bps" integer DEFAULT 1800 NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"seller_gstin" text,
	"buyer_name" text,
	"buyer_email" text,
	"buyer_gstin" text,
	"place_of_supply" text,
	"razorpay_order_id" text,
	"razorpay_payment_id" text,
	"status" text DEFAULT 'issued' NOT NULL,
	"emailed_at" timestamp with time zone,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_invoice_number_unique" UNIQUE("invoice_number"),
	CONSTRAINT "invoices_razorpay_payment_id_unique" UNIQUE("razorpay_payment_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "invoices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_user_id_idx" ON "invoices" ("user_id");
