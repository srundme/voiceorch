import {
  pgTable, text, timestamp, integer, jsonb, uuid, index, unique,
} from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";
import { campaignsTable } from "./campaigns";
import { googleSheetsConnectionsTable } from "./google-sheets";

export type SheetAutoStartMode = "new_only" | "backfill_then_watch";
export type SheetAutoWritebackMode = "same_sheet" | "call_log" | "both";
export type SheetAutoPipelineStatus = "draft" | "running" | "paused" | "stopped";

/** Header names on the source sheet. `phone` is required. */
export type SheetAutoColumnMap = {
  phone: string;
  name?: string;
  email?: string;
  [extra: string]: string | undefined;
};

export type SheetAutoStatusColumns = {
  status?: string;
  lastCallAt?: string;
  disposition?: string;
  summary?: string;
  callId?: string;
  recording?: string;
  nextFollowUp?: string;
  meetingTime?: string;
};

/**
 * Automatic Calls pipeline: watch a Google Sheet for leads, dial via an
 * internal campaign, write results back to same sheet and/or a call log.
 */
export const sheetAutoCallPipelinesTable = pgTable("sheet_auto_call_pipelines", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  connectionId: uuid("connection_id").notNull().references(() => googleSheetsConnectionsTable.id, { onDelete: "cascade" }),
  agentId: integer("agent_id").notNull().references(() => agentsTable.id, { onDelete: "cascade" }),
  campaignId: integer("campaign_id").references(() => campaignsTable.id, { onDelete: "set null" }),
  spreadsheetId: text("spreadsheet_id").notNull(),
  spreadsheetTitle: text("spreadsheet_title"),
  sheetName: text("sheet_name").notNull().default("Sheet1"),
  sheetGid: integer("sheet_gid"),
  columnMap: jsonb("column_map").$type<SheetAutoColumnMap>().notNull(),
  startMode: text("start_mode").$type<SheetAutoStartMode>().notNull().default("new_only"),
  writebackMode: text("writeback_mode").$type<SheetAutoWritebackMode>().notNull().default("same_sheet"),
  callLogSpreadsheetId: text("call_log_spreadsheet_id"),
  callLogSheetName: text("call_log_sheet_name"),
  sameSheetStatusColumns: jsonb("same_sheet_status_columns").$type<SheetAutoStatusColumns>().notNull().default({
    status: "Status",
    lastCallAt: "Last Call At",
    disposition: "Disposition",
    summary: "Summary",
    callId: "Call ID",
    recording: "Recording",
    nextFollowUp: "Follow-up",
  }),
  fromNumber: text("from_number"),
  concurrentCallLimit: integer("concurrent_call_limit").notNull().default(5),
  /** Last sheet data row index that has been seen (1-based; header is row 1). */
  cursorRowIndex: integer("cursor_row_index").notNull().default(1),
  status: text("status").$type<SheetAutoPipelineStatus>().notNull().default("draft"),
  lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
  lastError: text("last_error"),
  enqueuedCount: integer("enqueued_count").notNull().default(0),
  dialedCount: integer("dialed_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("sheet_auto_call_pipelines_user_id_idx").on(t.userId),
  index("sheet_auto_call_pipelines_status_idx").on(t.status),
  index("sheet_auto_call_pipelines_campaign_id_idx").on(t.campaignId),
]);

export type SheetAutoRowStatus =
  | "pending"
  | "enqueued"
  | "dialing"
  | "completed"
  | "failed"
  | "skipped";

export const sheetAutoCallRowStateTable = pgTable("sheet_auto_call_row_state", {
  id: uuid("id").primaryKey().defaultRandom(),
  pipelineId: uuid("pipeline_id").notNull().references(() => sheetAutoCallPipelinesTable.id, { onDelete: "cascade" }),
  sheetRowIndex: integer("sheet_row_index").notNull(),
  phoneNormalized: text("phone_normalized").notNull(),
  leadId: integer("lead_id"),
  callId: integer("call_id"),
  status: text("status").$type<SheetAutoRowStatus>().notNull().default("pending"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  unique("sheet_auto_call_row_state_pipeline_row_unique").on(t.pipelineId, t.sheetRowIndex),
  index("sheet_auto_call_row_state_pipeline_id_idx").on(t.pipelineId),
  index("sheet_auto_call_row_state_phone_idx").on(t.pipelineId, t.phoneNormalized),
  index("sheet_auto_call_row_state_lead_id_idx").on(t.leadId),
]);

export type SheetAutoCallPipeline = typeof sheetAutoCallPipelinesTable.$inferSelect;
export type InsertSheetAutoCallPipeline = typeof sheetAutoCallPipelinesTable.$inferInsert;
export type SheetAutoCallRowState = typeof sheetAutoCallRowStateTable.$inferSelect;
