CREATE TABLE IF NOT EXISTS "trai_suppression_list" (
"id" serial PRIMARY KEY NOT NULL,
"phone_number" text NOT NULL,
"status" text NOT NULL,
"category_blocked" text,
"source" text,
"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trai_call_compliance_log" (
"id" serial PRIMARY KEY NOT NULL,
"agent_id" integer,
"call_id" integer,
"phone_number" text NOT NULL,
"pre_dial_status" text,
"block_reason" text,
"opt_out_detected" boolean DEFAULT false NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "trai_suppression_phone_idx" ON "trai_suppression_list" USING btree ("phone_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trai_compliance_log_agent_idx" ON "trai_call_compliance_log" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trai_compliance_log_phone_idx" ON "trai_call_compliance_log" USING btree ("phone_number");