import { pgTable, serial, integer, text, timestamp, json, boolean, jsonb, decimal } from "drizzle-orm/pg-core";
import { campaignsTable, campaignBatchesTable, campaignLeadsTable } from "./campaigns";
import { callsTable } from "./calls";

// ── Timeline event types (complete — all interaction + CRM events) ────────────
export type TimelineEventType =
  | "imported"
  | "queued"
  | "call_started"
  | "call_connected"
  | "call_ended"
  | "call_failed"
  | "no_pickup"
  | "retry_scheduled"
  | "retry_fired"
  | "disposition_set"
  | "analysis_completed"
  | "sentiment_set"
  | "transfer_triggered"
  | "transfer_completed"
  | "booking_created"
  | "booking_cancelled"
  | "booking_completed"
  | "callback_detected"
  | "callback_completed"
  | "callback_missed"
  | "incoming_call"
  | "incoming_call_ended"
  | "dnc_added"
  | "dnc_removed"
  | "note_added"
  | "task_created"
  | "task_completed"
  | "status_changed"
  | "manual_retry"
  | "owner_assigned"
  | "tag_added"
  | "tag_removed"
  | "score_updated"
  | "operational_outcome_set";

// ── Call Executions ───────────────────────────────────────────────────────────
// Represents one outbound call attempt for a lead.
// Conversation intelligence fields (sentiment, intent, topics, summary)
// are populated asynchronously after call completion — never during the call.

export const callExecutionsTable = pgTable("call_executions", {
  id:              serial("id").primaryKey(),
  campaignId:      integer("campaign_id").references(() => campaignsTable.id, { onDelete: "cascade" }).notNull(),
  batchId:         integer("batch_id").references(() => campaignBatchesTable.id, { onDelete: "set null" }),
  leadId:          integer("lead_id").references(() => campaignLeadsTable.id, { onDelete: "cascade" }).notNull(),
  callId:          integer("call_id").references(() => callsTable.id, { onDelete: "set null" }),
  attemptNumber:   integer("attempt_number").notNull().default(1),
  outcome:         text("outcome"),
  // Async AI analysis — populated by background job after transcript is saved
  callSummary:     text("call_summary"),
  sentiment:       text("sentiment"),
  detectedIntent:  text("detected_intent"),
  keyTopics:       jsonb("key_topics").$type<string[]>().default([]),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CallExecution = typeof callExecutionsTable.$inferSelect;
export type InsertCallExecution = typeof callExecutionsTable.$inferInsert;

// ── Lead Timeline ─────────────────────────────────────────────────────────────
// Immutable audit log. Every state change and CRM action writes a row here.

export const leadTimelineTable = pgTable("lead_timeline", {
  id:         serial("id").primaryKey(),
  leadId:     integer("lead_id").references(() => campaignLeadsTable.id, { onDelete: "cascade" }).notNull(),
  campaignId: integer("campaign_id").references(() => campaignsTable.id, { onDelete: "cascade" }).notNull(),
  eventType:  text("event_type").notNull(),
  data:       json("data").$type<Record<string, unknown>>(),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LeadTimeline = typeof leadTimelineTable.$inferSelect;
export type InsertLeadTimeline = typeof leadTimelineTable.$inferInsert;

// ── Call Retries ──────────────────────────────────────────────────────────────

export type RetryStatus = "pending" | "fired" | "cancelled";
export type RetryReason = "no_answer" | "busy" | "failed" | "voicemail" | "manual";

export const callRetriesTable = pgTable("call_retries", {
  id:            serial("id").primaryKey(),
  leadId:        integer("lead_id").references(() => campaignLeadsTable.id, { onDelete: "cascade" }).notNull(),
  campaignId:    integer("campaign_id").references(() => campaignsTable.id, { onDelete: "cascade" }).notNull(),
  attemptNumber: integer("attempt_number").notNull().default(1),
  scheduledAt:   timestamp("scheduled_at", { withTimezone: true }).notNull(),
  status:        text("status").notNull().default("pending"),
  reason:        text("reason"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CallRetry = typeof callRetriesTable.$inferSelect;
export type InsertCallRetry = typeof callRetriesTable.$inferInsert;

// ── Call Callbacks ────────────────────────────────────────────────────────────
// A callback is a lead's request to be called back at a specific time.
// response_due_by enforces SLA — overdue callbacks surface in the Callback Queue.

export type CallbackStatus = "pending" | "completed" | "cancelled" | "missed";

export const callCallbacksTable = pgTable("call_callbacks", {
  id:             serial("id").primaryKey(),
  leadId:         integer("lead_id").references(() => campaignLeadsTable.id, { onDelete: "cascade" }).notNull(),
  campaignId:     integer("campaign_id").references(() => campaignsTable.id, { onDelete: "cascade" }).notNull(),
  callId:         integer("call_id").references(() => callsTable.id, { onDelete: "set null" }),
  callbackAt:     timestamp("callback_at", { withTimezone: true }),
  responseDueBy:  timestamp("response_due_by", { withTimezone: true }),
  reason:         text("reason"),
  rawExtract:     text("raw_extract"),
  status:         text("status").notNull().default("pending"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CallCallback = typeof callCallbacksTable.$inferSelect;
export type InsertCallCallback = typeof callCallbacksTable.$inferInsert;

// ── Incoming Calls ────────────────────────────────────────────────────────────
// Tracks leads that call back inbound. Does not change the lead's call_status —
// logged as a separate Interaction.

export const incomingCallsTable = pgTable("incoming_calls", {
  id:                 serial("id").primaryKey(),
  userId:             text("user_id").notNull(),
  phone:              text("phone").notNull(),
  normalizedPhone:    text("normalized_phone"),
  campaignId:         integer("campaign_id").references(() => campaignsTable.id, { onDelete: "set null" }),
  batchId:            integer("batch_id").references(() => campaignBatchesTable.id, { onDelete: "set null" }),
  leadId:             integer("lead_id").references(() => campaignLeadsTable.id, { onDelete: "set null" }),
  callId:             integer("call_id").references(() => callsTable.id, { onDelete: "set null" }),
  incomingCallStatus: text("incoming_call_status").notNull().default("unreviewed"),
  incomingCallReason: text("incoming_call_reason"),
  matchedAt:          timestamp("matched_at", { withTimezone: true }),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type IncomingCall = typeof incomingCallsTable.$inferSelect;
export type InsertIncomingCall = typeof incomingCallsTable.$inferInsert;

// ── Call Bookings ─────────────────────────────────────────────────────────────
// A booking created during or after a call.
// scheduling_booking_id links to the existing Scheduling module — no separate ecosystem.
// revenue_value is reserved for future pipeline tracking (insurance, real estate, education).

export const callBookingsTable = pgTable("call_bookings", {
  id:                  serial("id").primaryKey(),
  leadId:              integer("lead_id").references(() => campaignLeadsTable.id, { onDelete: "cascade" }).notNull(),
  campaignId:          integer("campaign_id").references(() => campaignsTable.id, { onDelete: "cascade" }).notNull(),
  batchId:             integer("batch_id").references(() => campaignBatchesTable.id, { onDelete: "set null" }),
  callId:              integer("call_id").references(() => callsTable.id, { onDelete: "set null" }),
  schedulingBookingId: integer("scheduling_booking_id"),
  meetingTime:         timestamp("meeting_time", { withTimezone: true }),
  meetingLink:         text("meeting_link"),
  meetingStatus:       text("meeting_status").notNull().default("scheduled"),
  calendarProvider:    text("calendar_provider"),
  bookingSource:       text("booking_source"),
  bookedBy:            text("booked_by"),
  notes:               text("notes"),
  revenueValue:        decimal("revenue_value", { precision: 12, scale: 2 }),
  createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type CallBooking = typeof callBookingsTable.$inferSelect;
export type InsertCallBooking = typeof callBookingsTable.$inferInsert;

// ── Workspace DNC ─────────────────────────────────────────────────────────────
// Workspace-scoped (per SnapServe account). Always match on normalized_phone.

export const workspaceDncTable = pgTable("workspace_dnc", {
  id:              serial("id").primaryKey(),
  userId:          text("user_id").notNull(),
  phone:           text("phone").notNull(),
  normalizedPhone: text("normalized_phone").notNull(),
  reason:          text("reason"),
  source:          text("source"),
  isActive:        boolean("is_active").notNull().default(true),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WorkspaceDnc = typeof workspaceDncTable.$inferSelect;
export type InsertWorkspaceDnc = typeof workspaceDncTable.$inferInsert;
