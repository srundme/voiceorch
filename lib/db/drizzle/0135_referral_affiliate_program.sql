-- Migration 0135: Affiliate & Referral Program with Option A (10 user milestone unlock)
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "referral_attribution_days" integer DEFAULT 60 NOT NULL;
--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "referral_commission_percent" integer DEFAULT 10 NOT NULL;
--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "referral_commission_months" integer DEFAULT 6 NOT NULL;
--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "referral_min_recharged_users" integer DEFAULT 10 NOT NULL;
--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "referral_audience_bonus_percent" integer DEFAULT 10 NOT NULL;
--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "referral_audience_free_minutes" integer DEFAULT 100 NOT NULL;
--> statement-breakpoint
ALTER TABLE "partner_referrals" ADD COLUMN IF NOT EXISTS "first_recharge_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "partner_referrals" ADD COLUMN IF NOT EXISTS "recharge_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "partner_referrals" ADD COLUMN IF NOT EXISTS "total_recharged_paise" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "partner_referrals" ADD COLUMN IF NOT EXISTS "total_earned_paise" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "partner_referral_earnings" (
	"id" serial PRIMARY KEY NOT NULL,
	"partner_id" integer NOT NULL,
	"referral_id" integer,
	"user_id" text NOT NULL,
	"recharge_txn_id" integer,
	"recharge_amount_paise" integer NOT NULL,
	"commission_percent" integer DEFAULT 10 NOT NULL,
	"earned_paise" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"credited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "partner_referral_earnings" ADD CONSTRAINT "partner_referral_earnings_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object OR duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "partner_referral_earnings" ADD CONSTRAINT "partner_referral_earnings_referral_id_partner_referrals_id_fk" FOREIGN KEY ("referral_id") REFERENCES "partner_referrals"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object OR duplicate_table THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "partner_referral_earnings_partner_id_idx" ON "partner_referral_earnings" ("partner_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "partner_referral_earnings_user_id_idx" ON "partner_referral_earnings" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "partner_referral_earnings_status_idx" ON "partner_referral_earnings" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "partner_referrals_user_id_idx" ON "partner_referrals" ("user_id");
