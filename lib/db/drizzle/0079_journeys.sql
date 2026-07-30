-- Agent-first journeys: product layer above workflows for cross-channel flows.
CREATE TABLE IF NOT EXISTS "journeys" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "agent_id" integer NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "status" text DEFAULT 'draft' NOT NULL,
  "preset_id" text DEFAULT 'custom' NOT NULL,
  "trigger" jsonb NOT NULL,
  "steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "workflow_id" integer,
  "public_token" text,
  "total_runs" integer DEFAULT 0 NOT NULL,
  "last_run_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "journeys" ADD CONSTRAINT "journeys_agent_id_agents_id_fk"
    FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "journeys" ADD CONSTRAINT "journeys_workflow_id_workflows_id_fk"
    FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "journeys_public_token_unique" ON "journeys" ("public_token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journeys_user_id_idx" ON "journeys" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journeys_agent_id_idx" ON "journeys" ("agent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journeys_status_idx" ON "journeys" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journeys_workflow_id_idx" ON "journeys" ("workflow_id");
