-- Migration 0136: Affiliate & Referral Program 5,000-minute recurring milestones
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "referral_target_minutes" integer DEFAULT 5000 NOT NULL;
--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "referral_reward_minutes" integer DEFAULT 500 NOT NULL;
--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "referral_completed_cycles" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "partner_referral_earnings" ADD COLUMN IF NOT EXISTS "cycle_number" integer DEFAULT 1;
