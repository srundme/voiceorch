import { pgTable, serial, integer, text, timestamp, json, boolean } from "drizzle-orm/pg-core";
import { campaignsTable, campaignBatchesTable, campaignLeadsTable } from "./campaigns";
import { callsTable } from "./calls";

export type TimelineEventType =
  | "imported"
  | "call_started"
  | "call_ended"
  | "call_failed"
  | "retry_scheduled"
  | "retry_fired"
  | "callback_detected"
  | "callback_completed"
  | "incoming_call"
  | "disposition_set"
  | "dnc_blocked"
  | "manual_retry";

export const callExecutionsTable = pgTable("call_executions", {
  id:             serial("id").primaryKey(),
  campaignId:     integer("campaign_id").references(() => campaignsTable.id, { onDelete: "cascade" }).notNull(),
  batchId:        integer("batch_id").references(() => campaignBatchesTable.id, { onDelete: "set null" }),
  leadId:         integer("lead_id").references(() => campaignLeadsTable.id, { onDelete: "cascade" }).notNull(),
  callId:         integer("call_id").references(() => callsTable.id, { onDelete: "set null" }),
  attemptNumber:  integer("attempt_number").notNull().default(1),
  outcome:        text("outcome"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const leadTimelineTable = pgTable("lead_timeline", {
  id:          serial("id").primaryKey(),
  leadId:      integer("lead_id").references(() => campaignLeadsTable.id, { onDelete: "cascade" }).notNull(),
  campaignId:  integer("campaign_id").references(() => campaignsTable.id, { onDelete: "cascade" }).notNull(),
  eventType:   text("event_type").notNull(),
  data:        json("data").$type<Record<string, unknown>>(),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RetryStatus = "pending" | "fired" | "cancelled";
export type RetryReason = "no_answer" | "busy" | "failed" | "voicemail" | "manual";

export const callRetriesTable = pgTable("call_retries", {
  id:             serial("id").primaryKey(),
  leadId:         integer("lead_id").references(() => campaignLeadsTable.id, { onDelete: "cascade" }).notNull(),
  campaignId:     integer("campaign_id").references(() => campaignsTable.id, { onDelete: "cascade" }).notNull(),
  attemptNumber:  integer("attempt_number").notNull().default(1),
  scheduledAt:    timestamp("scheduled_at", { withTimezone: true }).notNull(),
  status:         text("status").notNull().default("pending"),
  reason:         text("reason"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CallbackStatus = "pending" | "completed" | "cancelled";

export const callCallbacksTable = pgTable("call_callbacks", {
  id:              serial("id").primaryKey(),
  leadId:          integer("lead_id").references(() => campaignLeadsTable.id, { onDelete: "cascade" }).notNull(),
  campaignId:      integer("campaign_id").references(() => campaignsTable.id, { onDelete: "cascade" }).notNull(),
  callId:          integer("call_id").references(() => callsTable.id, { onDelete: "set null" }),
  callbackAt:      timestamp("callback_at", { withTimezone: true }),
  reason:          text("reason"),
  rawExtract:      text("raw_extract"),
  status:          text("status").notNull().default("pending"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workspaceDncTable = pgTable("workspace_dnc", {
  id:               serial("id").primaryKey(),
  userId:           text("user_id").notNull(),
  phone:            text("phone").notNull(),
  normalizedPhone:  text("normalized_phone").notNull(),
  reason:           text("reason"),
  isActive:         boolean("is_active").notNull().default(true),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
