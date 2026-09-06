-- Admin V2: effective-dated provider costs and customer pricing (never overwrite history)
CREATE TABLE IF NOT EXISTS "provider_cost_rates" (
  "id" serial PRIMARY KEY NOT NULL,
  "provider" text NOT NULL,
  "service" text NOT NULL,
  "billing_unit" text NOT NULL,
  "rate" numeric(18, 6) NOT NULL,
  "currency" text NOT NULL DEFAULT 'INR',
  "effective_from" timestamptz NOT NULL,
  "effective_to" timestamptz,
  "created_by" text,
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "provider_cost_rates_lookup_idx" ON "provider_cost_rates" ("provider", "service", "effective_from");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "provider_cost_rates_active_idx" ON "provider_cost_rates" ("effective_to");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer_pricing_rates" (
  "id" serial PRIMARY KEY NOT NULL,
  "plan" text NOT NULL DEFAULT 'standard',
  "segment" text NOT NULL DEFAULT 'default',
  "service" text NOT NULL,
  "billing_unit" text NOT NULL,
  "rate" numeric(18, 6) NOT NULL,
  "currency" text NOT NULL DEFAULT 'INR',
  "effective_from" timestamptz NOT NULL,
  "effective_to" timestamptz,
  "created_by" text,
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_pricing_rates_lookup_idx" ON "customer_pricing_rates" ("plan", "segment", "service", "effective_from");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_pricing_rates_active_idx" ON "customer_pricing_rates" ("effective_to");
--> statement-breakpoint
-- Seed active customer voice rate from typical list price if empty (₹3.00 / min)
INSERT INTO "customer_pricing_rates" ("plan", "segment", "service", "billing_unit", "rate", "currency", "effective_from", "notes")
SELECT 'standard', 'default', 'voice', 'per_minute', 3.000000, 'INR', now(), 'Seeded from Admin V2 default list price'
WHERE NOT EXISTS (SELECT 1 FROM "customer_pricing_rates" LIMIT 1);
--> statement-breakpoint
-- Seed provider costs from provider_minute_rates (rate_cents_per_min is USD cents historically — store INR approx note)
INSERT INTO "provider_cost_rates" ("provider", "service", "billing_unit", "rate", "currency", "effective_from", "notes")
SELECT
  lower(provider_name),
  CASE category
    WHEN 'asr' THEN 'stt'
    WHEN 'tts' THEN 'tts'
    WHEN 'llm' THEN 'llm'
    WHEN 'telephony' THEN 'telephony'
    ELSE category
  END,
  'per_minute',
  (rate_cents_per_min::numeric / 100.0),
  'USD',
  now(),
  'Seeded from provider_minute_rates (USD per minute)'
FROM provider_minute_rates
WHERE NOT EXISTS (SELECT 1 FROM "provider_cost_rates" LIMIT 1);
