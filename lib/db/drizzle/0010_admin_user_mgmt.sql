ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "suspended_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "suspended_reason" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admin_audit_logs" (
  "id" serial PRIMARY KEY NOT NULL,
  "admin_id" text NOT NULL,
  "target_user_id" text,
  "target_resource_type" text,
  "target_resource_id" text,
  "action" text NOT NULL,
  "before_value" jsonb,
  "after_value" jsonb,
  "ip_address" text,
  "user_agent" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admin_impersonation_sessions" (
  "id" serial PRIMARY KEY NOT NULL,
  "session_token" text NOT NULL,
  "admin_id" text NOT NULL,
  "target_user_id" text NOT NULL,
  "target_user_email" text,
  "target_user_name" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "ended_at" timestamp with time zone,
  CONSTRAINT "admin_impersonation_sessions_session_token_unique" UNIQUE("session_token")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_logs_target_user_idx" ON "admin_audit_logs" ("target_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_logs_created_at_idx" ON "admin_audit_logs" ("created_at" DESC);
