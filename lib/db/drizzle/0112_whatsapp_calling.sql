-- WhatsApp calling + wallet messaging support columns.
ALTER TABLE "whatsapp_channels" ADD COLUMN IF NOT EXISTS "calling_enabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "whatsapp_channels" ADD COLUMN IF NOT EXISTS "calling_agent_id" integer REFERENCES "agents"("id") ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS "whatsapp_calls" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" text NOT NULL,
  "channel_id" uuid NOT NULL REFERENCES "whatsapp_channels"("id") ON DELETE CASCADE,
  "agent_id" integer REFERENCES "agents"("id") ON DELETE SET NULL,
  "orchestration_call_id" integer,
  "direction" text NOT NULL,
  "from_number" text,
  "to_number" text,
  "status" text NOT NULL DEFAULT 'initiated',
  "vobiz_call_id" text,
  "meta_call_id" text,
  "offer_sdp" text,
  "answer_sdp" text,
  "duration_seconds" integer,
  "billed_paise" integer,
  "hangup_cause" text,
  "last_error" text,
  "started_at" timestamptz,
  "answered_at" timestamptz,
  "ended_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "wa_calls_user_created_idx" ON "whatsapp_calls" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "wa_calls_vobiz_id_idx" ON "whatsapp_calls" ("vobiz_call_id");
CREATE INDEX IF NOT EXISTS "wa_calls_channel_idx" ON "whatsapp_calls" ("channel_id");
