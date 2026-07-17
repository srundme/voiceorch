-- Workflow maker: workflows, workflow_runs, google_sheets_connections
-- Idempotent — safe to run multiple times / via the Railway SQL console.

CREATE TABLE IF NOT EXISTS "workflows" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"trigger" jsonb NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"public_token" text,
	"hmac_secret" text,
	"trigger_state" jsonb DEFAULT '{}'::jsonb,
	"total_runs" integer DEFAULT 0 NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflows_public_token_unique" UNIQUE("public_token")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflows_user_id_idx" ON "workflows" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflows_status_idx" ON "workflows" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"current_step_index" integer DEFAULT 0 NOT NULL,
	"lead_id" integer,
	"call_id" integer,
	"resume_at" timestamp with time zone,
	"triggered_by" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_runs_workflow_id_idx" ON "workflow_runs" ("workflow_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_runs_status_idx" ON "workflow_runs" ("status","updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_runs_lead_id_idx" ON "workflow_runs" ("lead_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "google_sheets_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text DEFAULT '' NOT NULL,
	"token_expiry" timestamp with time zone,
	"granted_scopes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "google_sheets_connections_user_email_unique" UNIQUE("user_id","email")
);
