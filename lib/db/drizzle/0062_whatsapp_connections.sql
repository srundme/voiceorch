-- WhatsApp webhook connections: inbound Request-a-Call + outbound post-call notify.
-- Idempotent — safe via Railway SQL console or drizzle migrate.

CREATE TABLE IF NOT EXISTS "whatsapp_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text DEFAULT 'WhatsApp' NOT NULL,
	"agent_id" integer NOT NULL,
	"campaign_id" integer,
	"inbound_token" text NOT NULL,
	"outbound_webhook_url" text,
	"outbound_secret" text,
	"request_call_enabled" boolean DEFAULT true NOT NULL,
	"post_call_enabled" boolean DEFAULT true NOT NULL,
	"button_ids" jsonb DEFAULT '["request_a_call","request_call","request call","call_me","call me"]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_inbound_at" timestamp with time zone,
	"last_outbound_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_connections_inbound_token_unique" UNIQUE("inbound_token")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "whatsapp_connections" ADD CONSTRAINT "whatsapp_connections_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "whatsapp_connections" ADD CONSTRAINT "whatsapp_connections_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_connections_user_id_idx" ON "whatsapp_connections" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_connections_agent_id_idx" ON "whatsapp_connections" ("agent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_connections_inbound_token_idx" ON "whatsapp_connections" ("inbound_token");
