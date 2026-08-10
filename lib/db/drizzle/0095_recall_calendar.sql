-- Recall Calendar V2: per-user Google calendar connect + opt-in event bots
CREATE TABLE IF NOT EXISTS "recall_calendar_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "email" text NOT NULL,
  "platform_email" text,
  "recall_calendar_id" text NOT NULL,
  "status" text DEFAULT 'connecting' NOT NULL,
  "oauth_scopes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "recall_calendar_connections_user_unique"
  ON "recall_calendar_connections" ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "recall_calendar_connections_recall_id_unique"
  ON "recall_calendar_connections" ("recall_calendar_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recall_calendar_connections_user_idx"
  ON "recall_calendar_connections" ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recall_calendar_event_bots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "recall_calendar_id" text NOT NULL,
  "recall_event_id" text NOT NULL,
  "recall_bot_id" text,
  "agent_id" integer REFERENCES "agents"("id") ON DELETE set null,
  "enabled" boolean DEFAULT true NOT NULL,
  "meeting_url" text,
  "starts_at" timestamp with time zone,
  "event_title" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "recall_calendar_event_bots_event_unique"
  ON "recall_calendar_event_bots" ("user_id", "recall_event_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recall_calendar_event_bots_cal_idx"
  ON "recall_calendar_event_bots" ("recall_calendar_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recall_calendar_event_bots_user_idx"
  ON "recall_calendar_event_bots" ("user_id");
