CREATE TABLE IF NOT EXISTS "partners" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"company_name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"base_rate_cents_per_min" integer DEFAULT 500 NOT NULL,
	"default_client_rate_cents_per_min" integer DEFAULT 500 NOT NULL,
	"logo_data" bytea,
	"logo_mime" text,
	"logo_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partners_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "partners_logo_token_unique" UNIQUE("logo_token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "partner_invites" (
	"id" serial PRIMARY KEY NOT NULL,
	"partner_id" integer NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"rate_cents_per_min" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"token" text NOT NULL,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_user_id" text,
	CONSTRAINT "partner_invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "partner_id" integer;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "partner_rate_cents_per_min" integer;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "partner_invites" ADD CONSTRAINT "partner_invites_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_partner_id_idx" ON "users" ("partner_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "partner_invites_partner_id_idx" ON "partner_invites" ("partner_id");
