-- Align seeded customer voice list price with live product flat rate (₹5.00/min)
-- so enabling effective-dated billing does not surprise-cut revenue.
UPDATE "customer_pricing_rates"
SET
  "rate" = 5.000000,
  "notes" = 'Aligned to product flat rate ₹5/min (Admin V2 Phase 8)',
  "updated_at" = now()
WHERE "service" = 'voice'
  AND "billing_unit" = 'per_minute'
  AND "plan" = 'standard'
  AND "segment" = 'default'
  AND "effective_to" IS NULL
  AND coalesce("notes", '') ILIKE 'Seeded from Admin V2%';
