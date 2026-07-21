CREATE TABLE IF NOT EXISTS "voiceathon_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"tagline" text,
	"description" text,
	"banner_url" text,
	"mode" text DEFAULT 'online' NOT NULL,
	"venue" text,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"registration_opens_at" timestamp with time zone,
	"registration_closes_at" timestamp with time zone,
	"event_starts_at" timestamp with time zone,
	"event_ends_at" timestamp with time zone,
	"submission_opens_at" timestamp with time zone,
	"submission_closes_at" timestamp with time zone,
	"judging_opens_at" timestamp with time zone,
	"judging_closes_at" timestamp with time zone,
	"min_team_size" integer DEFAULT 1 NOT NULL,
	"max_team_size" integer DEFAULT 4 NOT NULL,
	"max_teams" integer,
	"rules" text,
	"eligibility" text,
	"prizes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"faq" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rubric" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"leaderboard_published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voiceathon_events_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "voiceathon_teams" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"name" text NOT NULL,
	"reference_code" text NOT NULL,
	"institution" text,
	"city" text,
	"leader_name" text NOT NULL,
	"leader_email" text NOT NULL,
	"leader_email_normalized" text NOT NULL,
	"leader_phone" text,
	"status" text DEFAULT 'registered' NOT NULL,
	"claimed_by_user_id" text,
	"claimed_at" timestamp with time zone,
	"placement" text DEFAULT 'participant' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voiceathon_teams_reference_code_unique" UNIQUE("reference_code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "voiceathon_team_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"email_normalized" text,
	"phone" text,
	"role" text DEFAULT 'member' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "voiceathon_submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"agent_id" integer,
	"agent_version_id" integer,
	"webcall_link_id" integer,
	"project_title" text,
	"project_summary" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp with time zone,
	"submitted_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "voiceathon_judges" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_normalized" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'invited' NOT NULL,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_access_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voiceathon_judges_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "voiceathon_judge_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"judge_id" integer NOT NULL,
	"submission_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "voiceathon_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"judge_id" integer NOT NULL,
	"submission_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"criteria_scores" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total_score" integer DEFAULT 0 NOT NULL,
	"private_feedback" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "voiceathon_announcements" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"subject" text NOT NULL,
	"body_html" text NOT NULL,
	"audience" text DEFAULT 'all_teams' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "voiceathon_certificates" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"member_id" integer NOT NULL,
	"type" text DEFAULT 'participation' NOT NULL,
	"verification_code" text NOT NULL,
	"recipient_name" text NOT NULL,
	"team_name" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voiceathon_certificates_verification_code_unique" UNIQUE("verification_code")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "voiceathon_teams" ADD CONSTRAINT "voiceathon_teams_event_id_voiceathon_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."voiceathon_events"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "voiceathon_team_members" ADD CONSTRAINT "voiceathon_team_members_team_id_voiceathon_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."voiceathon_teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "voiceathon_submissions" ADD CONSTRAINT "voiceathon_submissions_event_id_voiceathon_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."voiceathon_events"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "voiceathon_submissions" ADD CONSTRAINT "voiceathon_submissions_team_id_voiceathon_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."voiceathon_teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "voiceathon_submissions" ADD CONSTRAINT "voiceathon_submissions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "voiceathon_submissions" ADD CONSTRAINT "voiceathon_submissions_agent_version_id_agent_versions_id_fk" FOREIGN KEY ("agent_version_id") REFERENCES "public"."agent_versions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "voiceathon_submissions" ADD CONSTRAINT "voiceathon_submissions_webcall_link_id_webcall_links_id_fk" FOREIGN KEY ("webcall_link_id") REFERENCES "public"."webcall_links"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "voiceathon_judges" ADD CONSTRAINT "voiceathon_judges_event_id_voiceathon_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."voiceathon_events"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "voiceathon_judge_assignments" ADD CONSTRAINT "voiceathon_judge_assignments_event_id_voiceathon_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."voiceathon_events"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "voiceathon_judge_assignments" ADD CONSTRAINT "voiceathon_judge_assignments_judge_id_voiceathon_judges_id_fk" FOREIGN KEY ("judge_id") REFERENCES "public"."voiceathon_judges"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "voiceathon_judge_assignments" ADD CONSTRAINT "voiceathon_judge_assignments_submission_id_voiceathon_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."voiceathon_submissions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "voiceathon_scores" ADD CONSTRAINT "voiceathon_scores_event_id_voiceathon_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."voiceathon_events"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "voiceathon_scores" ADD CONSTRAINT "voiceathon_scores_judge_id_voiceathon_judges_id_fk" FOREIGN KEY ("judge_id") REFERENCES "public"."voiceathon_judges"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "voiceathon_scores" ADD CONSTRAINT "voiceathon_scores_submission_id_voiceathon_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."voiceathon_submissions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "voiceathon_scores" ADD CONSTRAINT "voiceathon_scores_team_id_voiceathon_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."voiceathon_teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "voiceathon_announcements" ADD CONSTRAINT "voiceathon_announcements_event_id_voiceathon_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."voiceathon_events"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "voiceathon_certificates" ADD CONSTRAINT "voiceathon_certificates_event_id_voiceathon_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."voiceathon_events"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "voiceathon_certificates" ADD CONSTRAINT "voiceathon_certificates_team_id_voiceathon_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."voiceathon_teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "voiceathon_certificates" ADD CONSTRAINT "voiceathon_certificates_member_id_voiceathon_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."voiceathon_team_members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voiceathon_events_user_id_idx" ON "voiceathon_events" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voiceathon_events_status_idx" ON "voiceathon_events" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voiceathon_teams_event_id_idx" ON "voiceathon_teams" USING btree ("event_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voiceathon_teams_leader_email_idx" ON "voiceathon_teams" USING btree ("event_id","leader_email_normalized");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voiceathon_teams_claimed_by_idx" ON "voiceathon_teams" USING btree ("claimed_by_user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "voiceathon_teams_event_leader_uidx" ON "voiceathon_teams" USING btree ("event_id","leader_email_normalized");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voiceathon_team_members_team_id_idx" ON "voiceathon_team_members" USING btree ("team_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "voiceathon_submissions_team_uidx" ON "voiceathon_submissions" USING btree ("team_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voiceathon_submissions_event_id_idx" ON "voiceathon_submissions" USING btree ("event_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voiceathon_submissions_status_idx" ON "voiceathon_submissions" USING btree ("event_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voiceathon_judges_event_id_idx" ON "voiceathon_judges" USING btree ("event_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "voiceathon_judges_event_email_uidx" ON "voiceathon_judges" USING btree ("event_id","email_normalized");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "voiceathon_judge_assignments_uidx" ON "voiceathon_judge_assignments" USING btree ("judge_id","submission_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voiceathon_judge_assignments_event_idx" ON "voiceathon_judge_assignments" USING btree ("event_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "voiceathon_scores_judge_submission_uidx" ON "voiceathon_scores" USING btree ("judge_id","submission_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voiceathon_scores_event_idx" ON "voiceathon_scores" USING btree ("event_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voiceathon_scores_team_idx" ON "voiceathon_scores" USING btree ("team_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voiceathon_announcements_event_idx" ON "voiceathon_announcements" USING btree ("event_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voiceathon_certificates_event_idx" ON "voiceathon_certificates" USING btree ("event_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "voiceathon_certificates_member_type_uidx" ON "voiceathon_certificates" USING btree ("member_id","type");
