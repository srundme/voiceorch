-- Automatic Calls from Google Sheets: pipelines + per-row state.
-- Idempotent — safe via Railway SQL console or drizzle migrate.

CREATE TABLE IF NOT EXISTS "sheet_auto_call_pipelines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"agent_id" integer NOT NULL,
	"campaign_id" integer,
	"spreadsheet_id" text NOT NULL,
	"spreadsheet_title" text,
	"sheet_name" text DEFAULT 'Sheet1' NOT NULL,
	"sheet_gid" integer,
	"column_map" jsonb NOT NULL,
	"start_mode" text DEFAULT 'new_only' NOT NULL,
	"writeback_mode" text DEFAULT 'same_sheet' NOT NULL,
	"call_log_spreadsheet_id" text,
	"call_log_sheet_name" text,
	"same_sheet_status_columns" jsonb DEFAULT '{"status":"Status","lastCallAt":"Last Call At","disposition":"Disposition","summary":"Summary","callId":"Call ID","recording":"Recording"}'::jsonb NOT NULL,
	"from_number" text,
	"concurrent_call_limit" integer DEFAULT 5 NOT NULL,
	"cursor_row_index" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"last_polled_at" timestamp with time zone,
	"last_error" text,
	"enqueued_count" integer DEFAULT 0 NOT NULL,
	"dialed_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sheet_auto_call_pipelines" ADD CONSTRAINT "sheet_auto_call_pipelines_connection_id_google_sheets_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."google_sheets_connections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sheet_auto_call_pipelines" ADD CONSTRAINT "sheet_auto_call_pipelines_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sheet_auto_call_pipelines" ADD CONSTRAINT "sheet_auto_call_pipelines_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sheet_auto_call_pipelines_user_id_idx" ON "sheet_auto_call_pipelines" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sheet_auto_call_pipelines_status_idx" ON "sheet_auto_call_pipelines" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sheet_auto_call_pipelines_campaign_id_idx" ON "sheet_auto_call_pipelines" ("campaign_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sheet_auto_call_row_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"sheet_row_index" integer NOT NULL,
	"phone_normalized" text NOT NULL,
	"lead_id" integer,
	"call_id" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sheet_auto_call_row_state_pipeline_row_unique" UNIQUE("pipeline_id","sheet_row_index")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sheet_auto_call_row_state" ADD CONSTRAINT "sheet_auto_call_row_state_pipeline_id_sheet_auto_call_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."sheet_auto_call_pipelines"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sheet_auto_call_row_state_pipeline_id_idx" ON "sheet_auto_call_row_state" ("pipeline_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sheet_auto_call_row_state_phone_idx" ON "sheet_auto_call_row_state" ("pipeline_id","phone_normalized");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sheet_auto_call_row_state_lead_id_idx" ON "sheet_auto_call_row_state" ("lead_id");
