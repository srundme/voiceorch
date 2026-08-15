-- User-defined campaign analytics report definitions (builder + email).
CREATE TABLE IF NOT EXISTS "campaign_report_definitions" (
  "id" serial PRIMARY KEY,
  "user_id" text NOT NULL,
  "campaign_id" integer NOT NULL REFERENCES "campaigns"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "scope" text NOT NULL DEFAULT 'campaign',
  "blocks" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "filters" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "email" jsonb NOT NULL DEFAULT '{"enabled":false,"recipients":[],"trigger":"manual","cron":null}'::jsonb,
  "is_default" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "campaign_report_defs_campaign_idx" ON "campaign_report_definitions" ("campaign_id");
CREATE INDEX IF NOT EXISTS "campaign_report_defs_user_idx" ON "campaign_report_definitions" ("user_id");
