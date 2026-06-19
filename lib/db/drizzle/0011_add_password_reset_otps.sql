CREATE TABLE IF NOT EXISTS "password_reset_otps" (
"id" serial PRIMARY KEY NOT NULL,
"user_id" integer NOT NULL,
"otp_hash" text NOT NULL,
"expires_at" timestamp with time zone NOT NULL,
"used_at" timestamp with time zone,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "password_reset_otps" ADD CONSTRAINT "password_reset_otps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
