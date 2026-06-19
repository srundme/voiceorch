CREATE TABLE IF NOT EXISTS "campaign_consent_basis" (
"id" serial PRIMARY KEY NOT NULL,
"campaign_id" integer NOT NULL,
"basis_type" text NOT NULL,
"attested_by" text,
"attested_at" timestamp with time zone DEFAULT now() NOT NULL,
"consent_source" text,
"consent_date_range" text,
"proof_reference" text,
"notes" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dpdp_call_compliance_log" (
"id" serial PRIMARY KEY NOT NULL,
"agent_id" integer,
"call_id" integer,
"phone_number" text NOT NULL,
"pii_detected" boolean DEFAULT false NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dpdp_erasure_requests" (
"id" serial PRIMARY KEY NOT NULL,
"phone_number" text NOT NULL,
"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
"status" text DEFAULT 'completed' NOT NULL,
"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dpdp_consent_basis_campaign_idx" ON "campaign_consent_basis" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dpdp_compliance_log_agent_idx" ON "dpdp_call_compliance_log" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dpdp_compliance_log_call_idx" ON "dpdp_call_compliance_log" USING btree ("call_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dpdp_compliance_log_phone_idx" ON "dpdp_call_compliance_log" USING btree ("phone_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dpdp_erasure_phone_idx" ON "dpdp_erasure_requests" USING btree ("phone_number");