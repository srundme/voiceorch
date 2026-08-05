import { pgTable, serial, integer, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";

/**
 * No-code automation workflows.
 *
 * A workflow is a single trigger followed by an ordered list of steps. Users
 * build them by chatting with an AI (see routes/workflows.ts), which emits the
 * structured `trigger` + `steps` config persisted here. The execution engine
 * (services/workflow-engine.ts) runs a workflow_run per firing.
 */

export type WorkflowStatus = "draft" | "active" | "paused";

export type WorkflowTriggerType =
  | "form_lead"        // website / embedded form lead (public token)
  | "instagram_lead"   // Meta/Instagram lead ad (public token, HMAC)
  | "manual";          // fired from the dashboard / API

export interface WorkflowTrigger {
  type: WorkflowTriggerType;
  /**
   * Optional mapping of incoming field name -> canonical context key.
   * For form/instagram leads this maps posted field names. Unmapped fields
   * are still copied into context verbatim.
   */
  fieldMap?: Record<string, string>;
}

export type WorkflowStepType =
  | "make_call"
  | "condition"
  | "delay"
  | "send_webhook"
  | "schedule_callback"
  | "send_whatsapp"
  | "send_email"
  /** Call plans Phase 3 — dispatch Meet/Zoom/Teams bot. */
  | "join_meeting"
  /** Call plans Phase 3 — write status back to the linked Sheet row. */
  | "update_sheet";

export interface WorkflowStep {
  /** Stable id within the workflow (used for run bookkeeping). */
  id: string;
  type: WorkflowStepType;

  // ── make_call ──────────────────────────────────────────────────────────────
  agentId?: number;
  /** Context key holding the phone number (default: "phone"). */
  phoneField?: string;
  /**
   * Optional Agent Squad for this dial. When set, the hidden workflow campaign
   * carries squadId so createSession opens a live squad run (handoffs + shared memory).
   */
  squadId?: number;

  // ── condition (continue only if it evaluates true, else the run stops) ────────
  field?: string;                          // context path, e.g. "call.disposition.interested"
  op?: "eq" | "neq" | "contains" | "exists" | "gt" | "lt";
  value?: string;

  // ── delay ────────────────────────────────────────────────────────────────────
  delaySeconds?: number;

  // ── send_webhook ──────────────────────────────────────────────────────────────
  url?: string;

  // ── schedule_callback (telephony auto-dial via callbackScheduler) ───────────
  /** Absolute delay before the callback fires. Prefer callbackDelayDays for journeys. */
  callbackDelayDays?: number;
  notes?: string;

  // ── send_whatsapp (native VoBiz / Meta template send) ───────────────────────
  /**
   * SnapServe send-moment hint (NOT a Meta template name). Used for param
   * defaults and to look up the agent's mapped template when whatsappTemplate
   * is unset. Real Meta names come from the user's catalog.
   */
  whatsappHint?: "call_summary" | "booking_confirmed" | "callback_scheduled";
  /**
   * Explicit approved template from the user's WABA catalog (any name/language).
   * When set, this wins over hint → agent slot mapping.
   */
  whatsappTemplate?: { name: string; language: string; paramCount?: number };
  /** Optional body params; defaults are derived from call context. Supports {{vars}}. */
  whatsappParams?: string[];

  // ── send_email (managed SnapServe or BYO Brevo) ─────────────────────────────
  /** Context key for recipient email (default: "email"). */
  emailField?: string;
  emailSubject?: string;
  emailBody?: string;

  // ── join_meeting ────────────────────────────────────────────────────────────
  /** Context key for Meet/Zoom/Teams URL (default tries meetingUrl, meetLink). */
  meetingUrlField?: string;

  // ── update_sheet ────────────────────────────────────────────────────────────
  /** Header name to write (default "Status"). */
  sheetStatusColumn?: string;
  /** Literal status, or leave blank to use call disposition / step label. */
  sheetStatusValue?: string;
}

export const workflowsTable = pgTable("workflows", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").$type<WorkflowStatus>().notNull().default("draft"),

  trigger: jsonb("trigger").$type<WorkflowTrigger>().notNull(),
  steps: jsonb("steps").$type<WorkflowStep[]>().notNull().default([]),

  /** Public token for form_lead / instagram_lead intake (POST /api/workflows/hook/:token). */
  publicToken: text("public_token").unique(),
  /** Optional HMAC secret for verifying instagram_lead payloads. */
  hmacSecret: text("hmac_secret"),

  /** Mutable checkpoint for trigger polling / cursors. */
  triggerState: jsonb("trigger_state").$type<Record<string, unknown>>().default({}),

  totalRuns: integer("total_runs").notNull().default(0),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("workflows_user_id_idx").on(t.userId),
  index("workflows_status_idx").on(t.status),
]);

export type WorkflowRunStatus =
  | "pending"
  | "running"
  | "waiting_call"
  | "waiting_delay"
  | "completed"
  | "failed";

export const workflowRunsTable = pgTable("workflow_runs", {
  id: serial("id").primaryKey(),
  workflowId: integer("workflow_id").notNull().references(() => workflowsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  status: text("status").$type<WorkflowRunStatus>().notNull().default("pending"),
  /** Accumulated data: trigger fields + { call: {...} } after a make_call step. */
  context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
  /** Index of the NEXT step to execute. */
  currentStepIndex: integer("current_step_index").notNull().default(0),
  /** Set while status = waiting_call (the campaign lead being dialed). */
  leadId: integer("lead_id"),
  callId: integer("call_id"),
  /** Set while status = waiting_delay. */
  resumeAt: timestamp("resume_at", { withTimezone: true }),
  /** How this run was started (form_lead | instagram_lead | manual | test). */
  triggeredBy: text("triggered_by"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("workflow_runs_workflow_id_idx").on(t.workflowId),
  index("workflow_runs_status_idx").on(t.status, t.updatedAt),
  index("workflow_runs_lead_id_idx").on(t.leadId),
]);

export type Workflow = typeof workflowsTable.$inferSelect;
export type InsertWorkflow = typeof workflowsTable.$inferInsert;
export type WorkflowRun = typeof workflowRunsTable.$inferSelect;
export type InsertWorkflowRun = typeof workflowRunsTable.$inferInsert;
