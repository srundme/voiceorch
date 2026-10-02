-- Sales pipeline phase 3: lead touchpoints (original source + repeat enquiries) and scheduled demo
-- activities for opportunities already in "Demo booked".

CREATE TABLE IF NOT EXISTS "sales_touchpoints" (
  "id" serial PRIMARY KEY,
  "company_id" integer NOT NULL REFERENCES "sales_companies"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "source" text,
  "campaign" text,
  "occurred_at" timestamptz NOT NULL DEFAULT now(),
  "event_id" text,
  "permission_evidence" text,
  "details" jsonb,
  "is_demo" boolean NOT NULL DEFAULT false,
  "created_by" integer,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_touchpoints_company_idx" ON "sales_touchpoints" ("company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_touchpoints_event_id_uq" ON "sales_touchpoints" ("event_id");
--> statement-breakpoint
INSERT INTO "sales_touchpoints" ("company_id", "kind", "source", "campaign", "occurred_at", "permission_evidence", "is_demo", "created_by")
SELECT c."id", 'original', c."original_source", c."original_source_campaign", coalesce(c."original_enquiry_at", c."created_at"),
       c."contact_permission_evidence", c."is_demo", c."created_by"
FROM "sales_companies" c
WHERE NOT EXISTS (SELECT 1 FROM "sales_touchpoints" t WHERE t."company_id" = c."id" AND t."kind" = 'original');
--> statement-breakpoint
INSERT INTO "sales_touchpoints" ("company_id", "kind", "source", "campaign", "occurred_at", "event_id", "is_demo")
SELECT e."company_id", 'webhook', e."source", e."payload"->>'campaign', e."received_at", e."event_id", false
FROM "sales_webhook_events" e
JOIN "sales_companies" c ON c."id" = e."company_id"
WHERE e."status" = 'matched'
ON CONFLICT ("event_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "sales_activities" ("company_id", "opportunity_id", "contact_id", "owner_id", "type", "status", "scheduled_at", "flag_demo", "is_demo", "created_by")
SELECT o."company_id", o."id", o."demo_buyer_contact_id", coalesce(o."owner_id", c."owner_id"), 'demo', 'scheduled', o."demo_at", true, o."is_demo", o."owner_id"
FROM "sales_opportunities" o
JOIN "sales_companies" c ON c."id" = o."company_id"
WHERE o."stage" = 'Demo booked' AND o."demo_at" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "sales_activities" a
    WHERE a."company_id" = o."company_id" AND a."type" = 'demo' AND a."status" IN ('scheduled', 'completed')
      AND (a."opportunity_id" = o."id" OR a."opportunity_id" IS NULL)
      AND a."scheduled_at" = o."demo_at"
  );
--> statement-breakpoint
INSERT INTO "sales_tasks" ("company_id", "opportunity_id", "owner_id", "title", "kind", "due_at", "dedupe_key", "is_demo")
SELECT a."company_id", a."opportunity_id", a."owner_id", 'Demo with ' || c."name", 'demo', a."scheduled_at",
       'activity:' || a."id" || ':appointment', a."is_demo"
FROM "sales_activities" a
JOIN "sales_companies" c ON c."id" = a."company_id"
WHERE a."type" = 'demo' AND a."status" = 'scheduled' AND a."scheduled_at" IS NOT NULL
ON CONFLICT ("dedupe_key") DO NOTHING;
