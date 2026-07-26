-- WhatsApp expansion: BYON voice-number enablement, brochure assets, AI chatbot
CREATE TABLE IF NOT EXISTS "whatsapp_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" text DEFAULT 'brochure' NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"data" bytea NOT NULL,
	"public_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wa_assets_public_token_unique" UNIQUE("public_token")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wa_assets_user_id_idx" ON "whatsapp_assets" ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whatsapp_byon_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"phone_number_id" integer,
	"phone_e164" text NOT NULL,
	"status" text DEFAULT 'armed' NOT NULL,
	"method" text DEFAULT 'voice' NOT NULL,
	"vobiz_verification_id" text,
	"otp_code" text,
	"recording_url" text,
	"transcript" text,
	"armed_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wa_byon_user_id_idx" ON "whatsapp_byon_verifications" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wa_byon_phone_e164_idx" ON "whatsapp_byon_verifications" ("phone_e164");
--> statement-breakpoint
ALTER TABLE "whatsapp_channels" ADD COLUMN IF NOT EXISTS "chatbot_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "whatsapp_channels" ADD COLUMN IF NOT EXISTS "chatbot_agent_id" integer;
--> statement-breakpoint
ALTER TABLE "whatsapp_channels" ADD COLUMN IF NOT EXISTS "brochure_asset_id" uuid;
--> statement-breakpoint
ALTER TABLE "whatsapp_channels" ADD COLUMN IF NOT EXISTS "brochure_auto_send" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "whatsapp_channels" ADD CONSTRAINT "wa_channels_chatbot_agent_fk"
		FOREIGN KEY ("chatbot_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
