CREATE TABLE IF NOT EXISTS "deployment_events" (
  "id"                  serial PRIMARY KEY NOT NULL,
  "railway_deploy_id"   text,
  "project_id"          text,
  "service_id"          text,
  "service_name"        text,
  "environment"         text,
  "status"              text NOT NULL,
  "deploy_url"          text,
  "commit_message"      text,
  "commit_hash"         text,
  "triggered_by"        text,
  "payload"             jsonb DEFAULT '{}',
  "created_at"          timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "deployment_events_status_idx"     ON "deployment_events" ("status");
CREATE INDEX IF NOT EXISTS "deployment_events_created_at_idx" ON "deployment_events" ("created_at");
CREATE INDEX IF NOT EXISTS "deployment_events_service_idx"    ON "deployment_events" ("service_name");
