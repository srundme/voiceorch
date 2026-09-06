-- Admin V2 Phase 4: managed key health checks + audit
CREATE TABLE IF NOT EXISTS "managed_key_health_checks" (
  "id" serial PRIMARY KEY NOT NULL,
  "credential_key" text NOT NULL,
  "status" text NOT NULL,
  "latency_ms" integer,
  "error_code" text,
  "error_message_safe" text,
  "checked_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "managed_key_health_cred_idx" ON "managed_key_health_checks" ("credential_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "managed_key_health_checked_idx" ON "managed_key_health_checks" ("checked_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "managed_key_audit" (
  "id" serial PRIMARY KEY NOT NULL,
  "credential_key" text NOT NULL,
  "action" text NOT NULL,
  "admin_id" text NOT NULL DEFAULT 'admin',
  "previous_status" text,
  "new_status" text,
  "metadata" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "managed_key_audit_cred_idx" ON "managed_key_audit" ("credential_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "managed_key_audit_created_idx" ON "managed_key_audit" ("created_at");
