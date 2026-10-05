ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "referral_code" text;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "partners" ADD CONSTRAINT "partners_referral_code_unique" UNIQUE("referral_code");
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "partners_pending_promotions" ADD COLUMN IF NOT EXISTS "referral_code" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referred_by_code" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "signup_source" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "partner_referrals" (
	"id" serial PRIMARY KEY NOT NULL,
	"partner_id" integer NOT NULL,
	"referral_code" text NOT NULL,
	"user_id" text NOT NULL,
	"user_email" text,
	"user_name" text,
	"status" text DEFAULT 'signed_up' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "partner_referrals" ADD CONSTRAINT "partner_referrals_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "partner_referrals_partner_id_idx" ON "partner_referrals" ("partner_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "partner_referrals_code_idx" ON "partner_referrals" ("referral_code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_referred_by_code_idx" ON "users" ("referred_by_code");
