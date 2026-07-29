import { pgTable, serial, integer, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";
import { workflowsTable, type WorkflowTrigger, type WorkflowStep } from "./workflows";

/**
 * Product-facing Journey entity.
 *
 * A Journey sits above workflows/campaigns/callbacks/WhatsApp and describes the
 * business flow an agent should run: lead intake → first contact → follow-ups
 * → outcomes. Execution is delegated to a linked workflow (workflowId) whose
 * steps include the extended cross-channel actions (schedule_callback,
 * send_whatsapp) handled by the workflow engine.
 */

export type JourneyStatus = "draft" | "active" | "paused";

export type JourneyPresetId =
  | "event_outreach"
  | "inbound_booking"
  | "lead_qualification"
  | "collections_reminder"
  | "custom";

/** Journey steps are workflow steps plus product metadata for the builder UI. */
export type JourneyStep = WorkflowStep & {
  /** Plain-English label shown in the builder. */
  label?: string;
};

export interface JourneySettings {
  /** Days to wait before auto-callback on no-answer / asked-later. */
  callbackDelayDays?: number;
  /** WhatsApp template hint used by send_whatsapp steps. */
  whatsappHint?: "call_summary" | "booking_confirmed" | "callback_scheduled";
  /** Optional external webhook URL compiled into a send_webhook step. */
  webhookUrl?: string | null;
  /** Schedule a telephony callback when the call did not connect. */
  followUpOnNoAnswer?: boolean;
  /** Schedule a callback when disposition looks interested / callback-requested. */
  followUpOnInterested?: boolean;
  /** Send WhatsApp after a completed call. */
  sendWhatsappAfterCall?: boolean;
}

export const journeysTable = pgTable("journeys", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  agentId: integer("agent_id").notNull().references(() => agentsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").$type<JourneyStatus>().notNull().default("draft"),
  presetId: text("preset_id").$type<JourneyPresetId>().notNull().default("custom"),

  trigger: jsonb("trigger").$type<WorkflowTrigger>().notNull(),
  steps: jsonb("steps").$type<JourneyStep[]>().notNull().default([]),
  settings: jsonb("settings").$type<JourneySettings>().notNull().default({}),

  /** Backing workflow that actually executes the journey. */
  workflowId: integer("workflow_id").references(() => workflowsTable.id, { onDelete: "set null" }),

  /** Public intake token (shared with the backing workflow when present). */
  publicToken: text("public_token").unique(),

  totalRuns: integer("total_runs").notNull().default(0),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("journeys_user_id_idx").on(t.userId),
  index("journeys_agent_id_idx").on(t.agentId),
  index("journeys_status_idx").on(t.status),
  index("journeys_workflow_id_idx").on(t.workflowId),
]);

export type Journey = typeof journeysTable.$inferSelect;
export type InsertJourney = typeof journeysTable.$inferInsert;
