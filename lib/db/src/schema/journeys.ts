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
  /** Send email after a completed call (managed SnapServe or BYO Brevo). */
  sendEmailAfterCall?: boolean;
  /** Optional subject override for journey email step (supports {{vars}}). */
  emailSubject?: string | null;
  /** Optional body override for journey email step (supports {{vars}}). */
  emailBody?: string | null;
  /**
   * Call plans — which people list this plan runs against.
   * Engines stay campaigns / sheets; this is product metadata only.
   */
  peopleSource?: "campaign" | "manual" | "sheet";
  /** Dial-flow / CSV campaign whose leads are walked on Start once. */
  campaignId?: number | null;
  /** Google Sheets Automatic Calls pipeline id (UUID). */
  sheetPipelineId?: string | null;
  /** once = Start once only; live = new sheet rows keep entering from step 1. */
  runMode?: "once" | "live";
  /** 1-based sheet row cursor for Keep live (header = 1). */
  sheetCursorRow?: number;
  /** Next Start once offset into the people source (after a capped batch). */
  startOffset?: number;
  /** Last known people count in the source list for Continue UX. */
  startSourceTotal?: number;
  /**
   * When true, the worker keeps feeding people from the source into the dial
   * queue (account concurrentLimit) until the source is exhausted or the plan
   * is paused. Set on Start once; Clear when source done / Pause.
   */
  autoFeed?: boolean;
  /** Pasted phones for manual Start (kept so auto-feed can continue the list). */
  manualPhones?: string[];
  /**
   * Calling hours — synced onto the hidden workflow campaign so the campaign
   * dial gate (`isCampaignDialable`) holds the queue outside this window.
   */
  isCallingHoursEnabled?: boolean;
  /** Hour 0–23 inclusive start (local to timezone). */
  businessHoursStart?: number | null;
  /** Hour 0–23 exclusive end. */
  businessHoursEnd?: number | null;
  /** IANA timezone for the window (default Asia/Kolkata when unset). */
  timezone?: string | null;
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
