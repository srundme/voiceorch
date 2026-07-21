ALTER TABLE "voiceathon_teams" ADD COLUMN IF NOT EXISTS "name_normalized" text;
--> statement-breakpoint
UPDATE "voiceathon_teams"
SET "name_normalized" = lower(regexp_replace(trim("name"), '\s+', ' ', 'g'))
WHERE "name_normalized" IS NULL;
--> statement-breakpoint
WITH ranked AS (
  SELECT "id", row_number() OVER (
    PARTITION BY "event_id", "name_normalized" ORDER BY "id"
  ) AS rn
  FROM "voiceathon_teams"
)
UPDATE "voiceathon_teams" t
SET "name_normalized" = t."name_normalized" || '-' || t."id"
FROM ranked r
WHERE t."id" = r."id" AND r.rn > 1;
--> statement-breakpoint
ALTER TABLE "voiceathon_teams" ALTER COLUMN "name_normalized" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "voiceathon_teams" ADD COLUMN IF NOT EXISTS "leader_linkedin_url" text;
--> statement-breakpoint
UPDATE "voiceathon_teams"
SET "leader_linkedin_url" = 'https://www.linkedin.com/'
WHERE "leader_linkedin_url" IS NULL;
--> statement-breakpoint
ALTER TABLE "voiceathon_teams" ALTER COLUMN "leader_linkedin_url" SET NOT NULL;
--> statement-breakpoint
UPDATE "voiceathon_teams" SET "leader_phone" = '' WHERE "leader_phone" IS NULL;
--> statement-breakpoint
ALTER TABLE "voiceathon_teams" ALTER COLUMN "leader_phone" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "voiceathon_teams" ALTER COLUMN "status" SET DEFAULT 'pending';
--> statement-breakpoint
ALTER TABLE "voiceathon_teams" ADD COLUMN IF NOT EXISTS "phone_verified_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "voiceathon_teams" ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "voiceathon_teams" ADD COLUMN IF NOT EXISTS "reviewed_by" text;
--> statement-breakpoint
ALTER TABLE "voiceathon_teams" ADD COLUMN IF NOT EXISTS "rejection_reason" text;
--> statement-breakpoint
ALTER TABLE "voiceathon_teams" ADD COLUMN IF NOT EXISTS "ticket_code" text;
--> statement-breakpoint
ALTER TABLE "voiceathon_teams" ADD COLUMN IF NOT EXISTS "ticket_issued_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "voiceathon_team_members" ADD COLUMN IF NOT EXISTS "linkedin_url" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "voiceathon_phone_otps" (
  "id" serial PRIMARY KEY NOT NULL,
  "event_id" integer NOT NULL,
  "phone_normalized" text NOT NULL,
  "code_hash" text NOT NULL,
  "verification_token_hash" text,
  "attempts" integer DEFAULT 0 NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "verified_at" timestamp with time zone,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "voiceathon_phone_otps" ADD CONSTRAINT "voiceathon_phone_otps_event_id_voiceathon_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."voiceathon_events"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voiceathon_phone_otps_event_phone_idx" ON "voiceathon_phone_otps" USING btree ("event_id","phone_normalized");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voiceathon_phone_otps_expires_idx" ON "voiceathon_phone_otps" USING btree ("expires_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "voiceathon_teams_event_name_uidx" ON "voiceathon_teams" USING btree ("event_id","name_normalized");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "voiceathon_teams_ticket_code_uidx" ON "voiceathon_teams" USING btree ("ticket_code");
