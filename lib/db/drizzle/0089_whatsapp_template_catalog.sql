-- Persist full WhatsApp template catalogs + per-agent native template picks.
ALTER TABLE "whatsapp_connections" ADD COLUMN IF NOT EXISTS "template_catalog" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "whatsapp_channels" ADD COLUMN IF NOT EXISTS "template_catalog" jsonb DEFAULT '[]'::jsonb NOT NULL;

CREATE TABLE IF NOT EXISTS "whatsapp_agent_templates" (
  "agent_id" integer PRIMARY KEY NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL,
  "templates" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "wa_agent_templates_user_id_idx" ON "whatsapp_agent_templates" ("user_id");
