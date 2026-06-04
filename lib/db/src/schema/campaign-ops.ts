import {
  pgTable, serial, integer, text, timestamp, boolean, decimal, jsonb
} from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";
import { campaignsTable, campaignBatchesTable, campaignLeadsTable } from "./campaigns";
import { callExecutionsTable } from "./campaign-crm";

// ── Lead Sources ─────────────────────────────────────────────────────────────
// Formal source entity. Every batch creates one; all leads in the batch
// reference it. Enables single-JOIN source analytics.

export type LeadSourceType = "csv" | "meta_form" | "webhook" | "manual" | "api";

export const leadSourcesTable = pgTable("lead_sources", {
  id:           serial("id").primaryKey(),
  // Workspace owner — sources are user-scoped, not campaign-scoped, so they can be reused.
  userId:       text("user_id").notNull(),
  // Optional: records which campaign first created this source (informational only, not exclusive ownership).
  campaignId:   integer("campaign_id").references(() => campaignsTable.id, { onDelete: "set null" }),
  sourceType:   text("source_type").notNull(),
  sourceName:   text("source_name").notNull(),
  metaFormId:   text("meta_form_id"),
  webhookId:    integer("webhook_id"),
  // Default field mapping for this source: { sourceField → agentVariableName }.
  // Each batch can store its own override in campaign_batches.batch_field_mapping.
  fieldMapping: jsonb("field_mapping").$type<Record<string, string>>().default({}),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LeadSource = typeof leadSourcesTable.$inferSelect;
export type InsertLeadSource = typeof leadSourcesTable.$inferInsert;

// ── Lead Transfers ────────────────────────────────────────────────────────────
// A transfer is a separate Interaction (not an extension of a call).
// The originating call execution is completed first, then this record is created.

export type TransferOutcome = "completed" | "no_answer" | "failed" | "unknown";

export const leadTransfersTable = pgTable("lead_transfers", {
  id:               serial("id").primaryKey(),
  leadId:           integer("lead_id").references(() => campaignLeadsTable.id, { onDelete: "cascade" }).notNull(),
  campaignId:       integer("campaign_id").references(() => campaignsTable.id, { onDelete: "cascade" }).notNull(),
  batchId:          integer("batch_id").references(() => campaignBatchesTable.id, { onDelete: "set null" }),
  callExecutionId:  integer("call_execution_id").references(() => callExecutionsTable.id, { onDelete: "set null" }),
  transferredTo:    text("transferred_to").notNull(),
  outcome:          text("outcome"),
  durationSeconds:  integer("duration_seconds"),
  transferTime:     timestamp("transfer_time", { withTimezone: true }).notNull().defaultNow(),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LeadTransfer = typeof leadTransfersTable.$inferSelect;
export type InsertLeadTransfer = typeof leadTransfersTable.$inferInsert;

// ── Lead Notes ────────────────────────────────────────────────────────────────

export const leadNotesTable = pgTable("lead_notes", {
  id:         serial("id").primaryKey(),
  leadId:     integer("lead_id").references(() => campaignLeadsTable.id, { onDelete: "cascade" }).notNull(),
  campaignId: integer("campaign_id").references(() => campaignsTable.id, { onDelete: "cascade" }).notNull(),
  body:       text("body").notNull(),
  createdBy:  text("created_by").notNull(),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LeadNote = typeof leadNotesTable.$inferSelect;
export type InsertLeadNote = typeof leadNotesTable.$inferInsert;

// ── Lead Tasks ────────────────────────────────────────────────────────────────

export type TaskStatus = "open" | "done";

export const leadTasksTable = pgTable("lead_tasks", {
  id:              serial("id").primaryKey(),
  leadId:          integer("lead_id").references(() => campaignLeadsTable.id, { onDelete: "cascade" }).notNull(),
  campaignId:      integer("campaign_id").references(() => campaignsTable.id, { onDelete: "cascade" }).notNull(),
  title:           text("title").notNull(),
  dueAt:           timestamp("due_at", { withTimezone: true }),
  status:          text("status").notNull().default("open"),
  assignedToId:    text("assigned_to_id"),
  assignedToType:  text("assigned_to_type").default("user"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt:     timestamp("completed_at", { withTimezone: true }),
});

export type LeadTask = typeof leadTasksTable.$inferSelect;
export type InsertLeadTask = typeof leadTasksTable.$inferInsert;

// ── Lead Tags ─────────────────────────────────────────────────────────────────

export const leadTagsTable = pgTable("lead_tags", {
  id:         serial("id").primaryKey(),
  leadId:     integer("lead_id").references(() => campaignLeadsTable.id, { onDelete: "cascade" }).notNull(),
  campaignId: integer("campaign_id").references(() => campaignsTable.id, { onDelete: "cascade" }).notNull(),
  tag:        text("tag").notNull(),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LeadTag = typeof leadTagsTable.$inferSelect;
export type InsertLeadTag = typeof leadTagsTable.$inferInsert;

// ── Batch Import Runs ─────────────────────────────────────────────────────────
// Every CSV / Meta / Webhook import into a batch is logged here.
// Enables import history, validation reports, and rollback audit.

export type ImportRunStatus = "processing" | "completed" | "failed";

export const batchImportRunsTable = pgTable("batch_import_runs", {
  id:               serial("id").primaryKey(),
  batchId:          integer("batch_id").references(() => campaignBatchesTable.id, { onDelete: "cascade" }).notNull(),
  sourceId:         integer("source_id").references(() => leadSourcesTable.id, { onDelete: "set null" }),
  // For CSV: original filename. For webhook/meta: descriptive label.
  fileName:         text("file_name"),
  status:           text("status").notNull().default("processing"),
  totalRows:        integer("total_rows").notNull().default(0),
  validRows:        integer("valid_rows").notNull().default(0),
  invalidRows:      integer("invalid_rows").notNull().default(0),
  duplicateRows:    integer("duplicate_rows").notNull().default(0),
  createdRows:      integer("created_rows").notNull().default(0),
  processingTimeMs: integer("processing_time_ms"),
  // JSON array of { phone, reason, rowIndex } for invalid/duplicate rows
  errorReport:      jsonb("error_report").$type<Array<{
    phone?: string;
    normalizedPhone?: string;
    reason: string;
    existingLeadId?: number;
    rowIndex?: number;
  }>>(),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BatchImportRun = typeof batchImportRunsTable.$inferSelect;
export type InsertBatchImportRun = typeof batchImportRunsTable.$inferInsert;

// ── Agent Variable Registry ───────────────────────────────────────────────────
// Declares variables an agent expects from lead data.
// Drives CSV column mapping, Meta form mapping, and pre-call variable injection.

export type VariableDataType = "string" | "number" | "date" | "boolean";

export const agentVariablesTable = pgTable("agent_variables", {
  id:            serial("id").primaryKey(),
  agentId:       integer("agent_id").references(() => agentsTable.id, { onDelete: "cascade" }).notNull(),
  variableName:  text("variable_name").notNull(),
  displayLabel:  text("display_label").notNull(),
  isRequired:    boolean("is_required").notNull().default(false),
  defaultValue:  text("default_value"),
  dataType:      text("data_type").notNull().default("string"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AgentVariable = typeof agentVariablesTable.$inferSelect;
export type InsertAgentVariable = typeof agentVariablesTable.$inferInsert;

// ── Batch Health Snapshots ────────────────────────────────────────────────────
// Point-in-time snapshot of a batch's operational health.
// Written at: batch creation, every 15 min while active, batch completion,
// and on-demand manual refresh.
// Powers the Command Center trend cards without expensive re-aggregations.

export const batchHealthSnapshotsTable = pgTable("batch_health_snapshots", {
  id:                          serial("id").primaryKey(),
  batchId:                     integer("batch_id").references(() => campaignBatchesTable.id, { onDelete: "cascade" }).notNull(),
  campaignId:                  integer("campaign_id").references(() => campaignsTable.id, { onDelete: "cascade" }).notNull(),
  snapshotTime:                timestamp("snapshot_time", { withTimezone: true }).notNull().defaultNow(),
  // Lead counts at snapshot time
  totalLeads:                  integer("total_leads").notNull().default(0),
  validLeads:                  integer("valid_leads").notNull().default(0),
  duplicates:                  integer("duplicates").notNull().default(0),
  // Call-status breakdown
  queued:                      integer("queued").notNull().default(0),
  calling:                     integer("calling").notNull().default(0),
  connected:                   integer("connected").notNull().default(0),
  completed:                   integer("completed").notNull().default(0),
  // Operational outcome breakdown
  callbacks:                   integer("callbacks").notNull().default(0),
  incomingCalls:               integer("incoming_calls").notNull().default(0),
  booked:                      integer("booked").notNull().default(0),
  transferred:                 integer("transferred").notNull().default(0),
  failed:                      integer("failed").notNull().default(0),
  noPickup:                    integer("no_pickup").notNull().default(0),
  interested:                  integer("interested").notNull().default(0),
  // Full breakdown keyed by operationalOutcome value → count
  operationalOutcomeBreakdown: jsonb("operational_outcome_breakdown").$type<Record<string, number>>(),
  createdAt:                   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BatchHealthSnapshot    = typeof batchHealthSnapshotsTable.$inferSelect;
export type InsertBatchHealthSnapshot = typeof batchHealthSnapshotsTable.$inferInsert;
