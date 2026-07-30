-- User email messaging channels (managed SnapServe Brevo OR BYO Brevo).
-- SMS is not a messaging channel — do not add SMS tables here.
CREATE TABLE IF NOT EXISTS "email_channels" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "mode" text DEFAULT 'managed' NOT NULL,
  "brevo_api_key_encrypted" text,
  "brevo_api_key_last4" text,
  "from_name" text,
  "from_email" text,
  "default_template" jsonb DEFAULT '{"subject":"Thanks {{name}} — following up from our call","body":"<p>Hi {{name}},</p><p>Thanks for speaking with us.</p><p>{{summary}}</p><p>— {{agent_name}}</p>","wrapManagedShell":true}'::jsonb NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "last_error" text,
  "last_sent_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "email_channels_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_channels_mode_idx" ON "email_channels" ("mode");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_messages" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "channel_id" integer,
  "to_email" text NOT NULL,
  "subject" text NOT NULL,
  "body_preview" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "error" text,
  "mode" text,
  "call_id" integer,
  "journey_run_hint" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_messages_user_id_idx" ON "email_messages" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_messages_created_at_idx" ON "email_messages" ("created_at");
