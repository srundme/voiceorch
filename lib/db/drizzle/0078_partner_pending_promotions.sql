-- Admin-created partner setups for emails with no account yet; applied
-- automatically the moment that email signs up (services/partner-promotion.ts).
CREATE TABLE IF NOT EXISTS "partner_pending_promotions" (
"id" serial PRIMARY KEY NOT NULL,
"email" text NOT NULL,
"company_name" text NOT NULL,
"base_rate_cents_per_min" integer DEFAULT 500 NOT NULL,
"default_client_rate_cents_per_min" integer DEFAULT 500 NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
CONSTRAINT "partner_pending_promotions_email_unique" UNIQUE("email")
);
