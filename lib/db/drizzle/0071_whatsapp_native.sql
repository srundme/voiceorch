-- Native VoBiz WhatsApp: per-user channel enrollment (shared/own tier),
-- message log with delivery statuses, webhook event dedupe.
-- Idempotent — safe via Railway SQL console or drizzle migrate.

CREATE TABLE IF NOT EXISTS "whatsapp_channels" (
"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
"user_id" text NOT NULL,
"mode" text DEFAULT 'shared' NOT NULL,
"business_name" text DEFAULT '' NOT NULL,
"notify_booking_confirmed" boolean DEFAULT true NOT NULL,
"notify_call_summary" boolean DEFAULT true NOT NULL,
"notify_callback_scheduled" boolean DEFAULT true NOT NULL,
"inbound_agent_id" integer,
"daily_cap" integer DEFAULT 50 NOT NULL,
"vobiz_channel_id" text,
"waba_id" text,
"phone_number_id" text,
"phone_e164" text,
"access_token_last4" text,
"status" text DEFAULT 'active' NOT NULL,
"last_error" text,
"active" boolean DEFAULT true NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
CONSTRAINT "wa_channels_user_unique" UNIQUE("user_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "whatsapp_channels" ADD CONSTRAINT "wa_channels_inbound_agent_fk" FOREIGN KEY ("inbound_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wa_channels_mode_idx" ON "whatsapp_channels" ("mode");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whatsapp_messages" (
"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
"user_id" text NOT NULL,
"channel_id" uuid NOT NULL,
"call_id" integer,
"direction" text DEFAULT 'outbound' NOT NULL,
"phone" text NOT NULL,
"msg_type" text DEFAULT 'template' NOT NULL,
"template_name" text,
"body_preview" text,
"status" text DEFAULT 'pending' NOT NULL,
"vobiz_message_id" text,
"meta_message_id" text,
"error_message" text,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "wa_messages_channel_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."whatsapp_channels"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wa_messages_user_created_idx" ON "whatsapp_messages" ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wa_messages_vobiz_id_idx" ON "whatsapp_messages" ("vobiz_message_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wa_messages_meta_id_idx" ON "whatsapp_messages" ("meta_message_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wa_messages_phone_created_idx" ON "whatsapp_messages" ("phone","created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whatsapp_events" (
"event_id" text PRIMARY KEY NOT NULL,
"event_type" text NOT NULL,
"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
