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
  campaignId:   integer("campaign_id").references(() => campaignsTable.id, { onDelete: "cascade" }).notNull(),
  batchId:      integer("batch_id").references(() => campaignBatchesTable.id, { onDelete: "cascade" }),
  sourceType:   text("source_type").notNull(),
  sourceName:   text("source_name").notNull(),
  metaFormId:   text("meta_form_id"),
  webhookId:    integer("webhook_id"),
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
