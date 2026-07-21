import { pgTable, serial, integer, text, timestamp, json, boolean, uniqueIndex, index } from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";

export type CampaignFieldMappings = {
  phone: string;
  name?: string;
  email?: string;
  [extraField: string]: string | undefined;
};

export type BatchLeadSource = "csv" | "meta" | "webhook";

export type CampaignLeadSource = "csv" | "webhook" | "meta_ads" | "crm" | "google_sheets";
export type CampaignTriggerMode = "instant" | "batch";

export type DuplicatePolicy = "ignore" | "skip" | "reject_with_report";

// ── Operational Outcome (system-generated, immutable) ─────────────────────────
// Set by the lifecycle engine. Never written by clients.
// This is the canonical truth for funnel analytics — not disposition.
export type OperationalOutcome =
  | "pending"
  | "booking_created"
  | "transfer_completed"
  | "callback_requested"
  | "interest_confirmed"
  | "no_contact"
  | "dnc_blocked"
  | "failed";

export type CampaignValidationError = {
  receivedFormId: string;
  expectedFormId: string | null;
  receivedPageId?: string | null;
  expectedPageId?: string | null;
  webhookToken: string;
  timestamp: string;
  reason: string;
};

export const campaignsTable = pgTable("campaigns", {
  id:                   serial("id").primaryKey(),
  userId:               text("user_id").notNull(),
  name:                 text("name").notNull(),
  description:          text("description"),
  agentId:              integer("agent_id").references(() => agentsTable.id, { onDelete: "set null" }),
  /** When set, dials start a Squad live run (agentId remains the entry member). */
  squadId:              integer("squad_id"),
  status:               text("status").notNull().default("draft"),
  webhookToken:         text("webhook_token").notNull().unique(),
  fieldMappings:        json("field_mappings").$type<CampaignFieldMappings>().notNull().default({ phone: "phone" }),
  fromNumber:           text("from_number"),
  callDelaySeconds:     integer("call_delay_seconds").notNull().default(5),
  maxAttempts:          integer("max_attempts").notNull().default(1),
  retryDelayMinutes:    integer("retry_delay_minutes").notNull().default(60),
  totalLeads:           integer("total_leads").notNull().default(0),
  calledLeads:          integer("called_leads").notNull().default(0),
  concurrentCallLimit:  integer("concurrent_call_limit").notNull().default(20),
  isActive:             boolean("is_active").notNull().default(false),
  hmacSecret:           text("hmac_secret"),
  lastWebhookAt:        timestamp("last_webhook_at", { withTimezone: true }),
  lastWebhookStatus:    text("last_webhook_status"),
  leadSource:           text("lead_source").notNull().default("csv"),
  triggerMode:          text("trigger_mode").notNull().default("batch"),
  timezone:             text("timezone"),
  businessHoursStart:   integer("business_hours_start"),
  businessHoursEnd:     integer("business_hours_end"),
  isCallingHoursEnabled: boolean("is_calling_hours_enabled").notNull().default(true),
  // ── Source validation (layer-2 isolation) ─────────────────────────────────
  // sourceFormId: the expected lead-form ID from the source platform (e.g. Meta form_id).
  // Incoming webhooks whose form_id doesn't match are rejected before lead creation.
  // Generic naming keeps this reusable for LinkedIn, TikTok, Google Lead Forms etc.
  sourceFormId:         text("source_form_id"),
  sourcePageId:         text("source_page_id"),
  // lastValidationError: stores the most recent form_id mismatch audit record.
  // Null = no validation failures since last successful lead or form cleared.
  lastValidationError:  json("last_validation_error").$type<CampaignValidationError | null>(),
  // metaPageAccessToken: AES-256-GCM encrypted Page Access Token used to fetch
  // lead field_data from the Meta Graph API after receiving a leadgen notification.
  // Meta webhooks only carry the leadgen_id — the actual fields (phone, name, email)
  // must be retrieved via GET /{leadgen_id}?fields=field_data&access_token=...
  metaPageAccessToken:  text("meta_page_access_token"),
  createdAt:            timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:            timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const campaignBatchesTable = pgTable("campaign_batches", {
  id:                 serial("id").primaryKey(),
  campaignId:         integer("campaign_id").references(() => campaignsTable.id, { onDelete: "cascade" }).notNull(),
  name:               text("name").notNull(),
  description:        text("description"),
  status:             text("status").notNull().default("draft"),
  leadSource:         text("lead_source").notNull().default("csv"),
  scheduledStartAt:   timestamp("scheduled_start_at", { withTimezone: true }),
  scheduledEndAt:     timestamp("scheduled_end_at", { withTimezone: true }),
  totalLeads:         integer("total_leads").notNull().default(0),
  calledLeads:        integer("called_leads").notNull().default(0),
  fieldMappings:      json("field_mappings").$type<CampaignFieldMappings>(),
  callDelaySeconds:   integer("call_delay_seconds").notNull().default(5),
  maxAttempts:        integer("max_attempts").notNull().default(1),
  retryDelayMinutes:  integer("retry_delay_minutes").notNull().default(60),
  timezone:           text("timezone"),
  businessHoursStart: integer("business_hours_start"),
  businessHoursEnd:   integer("business_hours_end"),
  maxDailyCalls:      integer("max_daily_calls"),
  // Duplicate detection policy — applied at import time for this batch
  duplicatePolicy:    text("duplicate_policy").notNull().default("skip"),
  // Lead source used for this batch — references lead_sources.id (nullable, set by Batch Wizard)
  leadSourceId:       integer("lead_source_id"),
  // Per-batch field mapping override: { sourceField → agentVariableName }.
  // If set, overrides the source-level default fieldMapping for this batch only.
  batchFieldMapping:  json("batch_field_mapping").$type<Record<string, string>>(),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, t => [
  index("campaign_batches_campaign_id_idx").on(t.campaignId),
  index("campaign_batches_status_idx").on(t.status),
]);

// ── Batch Daily Metrics ───────────────────────────────────────────────────────
// Updated by lifecycle engine. One row per batch per UTC day.
// Pre-aggregated so Phase 7 Analytics can avoid expensive historical scans.
export const batchDailyMetricsTable = pgTable("batch_daily_metrics", {
  id:            serial("id").primaryKey(),
  batchId:       integer("batch_id").notNull().references(() => campaignBatchesTable.id, { onDelete: "cascade" }),
  date:          text("date").notNull(), // YYYY-MM-DD (UTC)
  leadsImported: integer("leads_imported").notNull().default(0),
  connected:     integer("connected").notNull().default(0),
  booked:        integer("booked").notNull().default(0),
  transferred:   integer("transferred").notNull().default(0),
  failed:        integer("failed").notNull().default(0),
  callbacks:     integer("callbacks").notNull().default(0),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, t => [
  uniqueIndex("batch_daily_metrics_batch_date_idx").on(t.batchId, t.date),
  index("batch_daily_metrics_batch_idx").on(t.batchId),
]);

export type BatchDailyMetric = typeof batchDailyMetricsTable.$inferSelect;
export type InsertBatchDailyMetric = typeof batchDailyMetricsTable.$inferInsert;

export const campaignLeadsTable = pgTable("campaign_leads", {
  id:               serial("id").primaryKey(),
  campaignId:       integer("campaign_id").references(() => campaignsTable.id, { onDelete: "cascade" }).notNull(),
  batchId:          integer("batch_id").references(() => campaignBatchesTable.id, { onDelete: "set null" }),
  // lead_source_id: set at import time — references lead_sources table
  // (FK declared in campaign-ops.ts to avoid circular imports)
  leadSourceId:     integer("lead_source_id"),
  phone:            text("phone").notNull(),
  normalizedPhone:  text("normalized_phone"),
  name:             text("name"),
  email:            text("email"),
  leadData:         json("lead_data").$type<Record<string, string>>().notNull().default({}),
  callStatus:       text("call_status").notNull().default("pending"),
  // operationalOutcome: system-generated by lifecycle engine, never set by clients
  operationalOutcome: text("operational_outcome").notNull().default("pending"),
  disposition:      text("disposition"),
  callId:           integer("call_id"),
  callAttempts:     integer("call_attempts").notNull().default(0),
  lastAttemptAt:    timestamp("last_attempt_at", { withTimezone: true }),
  source:           text("source").notNull().default("webhook"),
  externalLeadId:   text("external_lead_id"),
  notes:            text("notes"),
  // CRM fields
  ownerID:          text("owner_id"),
  ownerType:        text("owner_type").default("unassigned"),
  leadScore:        integer("lead_score"),
  // Duplicate detection
  duplicateOfLeadId: integer("duplicate_of_lead_id"),
  duplicateStatus:  text("duplicate_status"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  index("campaign_leads_campaign_id_idx").on(t.campaignId),
  index("campaign_leads_batch_id_idx").on(t.batchId),
  index("campaign_leads_call_status_idx").on(t.callStatus),
  index("campaign_leads_operational_outcome_idx").on(t.operationalOutcome),
  index("campaign_leads_normalized_phone_idx").on(t.normalizedPhone),
  index("campaign_leads_campaign_status_idx").on(t.campaignId, t.callStatus),
]);
