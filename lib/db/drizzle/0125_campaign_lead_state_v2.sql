-- Phase 1 campaign lead state: sticky answered-ever + latest attempt technical status.
-- Does not rewrite existing call_status values.

ALTER TABLE "campaign_leads"
  ADD COLUMN IF NOT EXISTS "answered_ever" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "last_attempt_status" text;

UPDATE "campaign_leads"
SET "answered_ever" = true
WHERE "call_id" IS NOT NULL
  AND "answered_ever" = false;

-- Safe denorm: latest known calls.status for the answered call_id, else the
-- current parked call_status when it already is an attempt terminal.
UPDATE "campaign_leads" AS l
SET "last_attempt_status" = COALESCE(
  (SELECT c."status" FROM "calls" AS c WHERE c."id" = l."call_id"),
  CASE
    WHEN l."call_status" IN ('pending', 'queued', 'calling') THEN NULL
    WHEN l."call_status" = 'connected' THEN 'answered'
    ELSE l."call_status"
  END
)
WHERE l."last_attempt_status" IS NULL;

CREATE INDEX IF NOT EXISTS "campaign_leads_answered_ever_idx"
  ON "campaign_leads" ("batch_id")
  WHERE "answered_ever";
