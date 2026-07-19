-- Google Sheets Phase 01: OAuth connections + multi-sheet agent bindings.
-- Idempotent — safe via Railway SQL console or drizzle migrate.

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
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "google_sheets_connections_user_id_idx" ON "google_sheets_connections" ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_sheet_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"agent_id" integer NOT NULL,
	"connection_id" uuid NOT NULL,
	"label" text NOT NULL,
	"use_case" text DEFAULT 'custom' NOT NULL,
	"spreadsheet_id" text NOT NULL,
	"spreadsheet_title" text,
	"sheet_name" text DEFAULT 'Sheet1' NOT NULL,
	"sheet_gid" integer,
	"column_map" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"match_column" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_sheet_bindings" ADD CONSTRAINT "agent_sheet_bindings_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_sheet_bindings" ADD CONSTRAINT "agent_sheet_bindings_connection_id_google_sheets_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."google_sheets_connections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_sheet_bindings_agent_id_idx" ON "agent_sheet_bindings" ("agent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_sheet_bindings_user_id_idx" ON "agent_sheet_bindings" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_sheet_bindings_connection_id_idx" ON "agent_sheet_bindings" ("connection_id");
