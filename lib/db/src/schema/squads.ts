import { pgTable, serial, integer, text, timestamp, jsonb, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";
import { callsTable } from "./calls";

/**
 * Agent Squads — reusable teams of existing agents with a supervisor,
 * specialists, shared run context, and live-call warm handoffs.
 */

export type SquadStatus = "draft" | "active" | "paused";

export type SquadLimits = {
  maxSteps?: number;
  maxRetriesPerStep?: number;
  maxCallMinutes?: number;
  maxRuntimeMinutes?: number;
};

export const DEFAULT_SQUAD_LIMITS: Required<SquadLimits> = {
  maxSteps: 10,
  maxRetriesPerStep: 2,
  maxCallMinutes: 30,
  maxRuntimeMinutes: 60,
};

/** Spoken by the departing agent before every live teammate handoff. */
export const DEFAULT_SQUAD_HANDOFF_MESSAGE =
  "One moment — I'm connecting you to a teammate who can help with this.";

/** Spoken by the receiving agent after a live handoff. */
export const DEFAULT_SQUAD_HANDOFF_GREETING =
  "Hi — I've been briefed on your conversation so far. How can I help?";

export const squadsTable = pgTable("squads", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").$type<SquadStatus>().notNull().default("draft"),
  supervisorAgentId: integer("supervisor_agent_id").references(() => agentsTable.id, { onDelete: "set null" }),
  /** Default member that answers inbound / campaign dials for this squad. */
  entryMemberId: integer("entry_member_id"),
  limits: jsonb("limits").$type<SquadLimits>().notNull().default({}),
  /**
   * Line spoken by the *current* agent before a live teammate handoff.
   * Always played (and drained) so the caller never hears a mid-sentence cut.
   */
  handoffMessage: text("handoff_message").default(DEFAULT_SQUAD_HANDOFF_MESSAGE),
  /** Warm line spoken by the receiving agent after a live handoff. */
  handoffGreeting: text("handoff_greeting").default(DEFAULT_SQUAD_HANDOFF_GREETING),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("squads_user_id_idx").on(t.userId),
  index("squads_status_idx").on(t.status),
]);

export type SquadMemberRole = "supervisor" | "specialist";

export const squadMembersTable = pgTable("squad_members", {
  id: serial("id").primaryKey(),
  squadId: integer("squad_id").notNull().references(() => squadsTable.id, { onDelete: "cascade" }),
  agentId: integer("agent_id").notNull().references(() => agentsTable.id, { onDelete: "cascade" }),
  roleName: text("role_name").notNull(),
  roleType: text("role_type").$type<SquadMemberRole>().notNull().default("specialist"),
  instructions: text("instructions"),
  /** Tool names this member may use during a squad run (empty = agent defaults). */
  allowedTools: jsonb("allowed_tools").$type<string[]>().default([]),
  sortOrder: integer("sort_order").notNull().default(0),
  /** May receive automatic live-call handoffs from other members. */
  handoffEnabled: boolean("handoff_enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("squad_members_squad_agent_uidx").on(t.squadId, t.agentId),
  index("squad_members_squad_id_idx").on(t.squadId),
  index("squad_members_agent_id_idx").on(t.agentId),
]);

export type SquadRunStatus =
  | "pending"
  | "running"
  | "awaiting_approval"
  | "waiting_call"
  | "live_call"
  | "completed"
  | "failed"
  | "cancelled";

export type SquadRunTrigger =
  | "manual"
  | "inbound"
  | "campaign"
  | "test";

export type SquadRunKind = "task" | "live_call";

export type SquadRunContext = Record<string, unknown>;

export const squadRunsTable = pgTable("squad_runs", {
  id: serial("id").primaryKey(),
  squadId: integer("squad_id").notNull().references(() => squadsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  kind: text("kind").$type<SquadRunKind>().notNull().default("task"),
  status: text("status").$type<SquadRunStatus>().notNull().default("pending"),
  goal: text("goal").notNull().default(""),
  context: jsonb("context").$type<SquadRunContext>().notNull().default({}),
  currentStepIndex: integer("current_step_index").notNull().default(0),
  activeMemberId: integer("active_member_id").references(() => squadMembersTable.id, { onDelete: "set null" }),
  activeCallId: integer("active_call_id").references(() => callsTable.id, { onDelete: "set null" }),
  campaignId: integer("campaign_id"),
  campaignLeadId: integer("campaign_lead_id"),
  phoneNumberId: integer("phone_number_id"),
  triggeredBy: text("triggered_by").$type<SquadRunTrigger>().notNull().default("manual"),
  attemptCount: integer("attempt_count").notNull().default(0),
  billableMinutes: integer("billable_minutes").notNull().default(0),
  finalResult: text("final_result"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("squad_runs_squad_id_idx").on(t.squadId),
  index("squad_runs_user_status_idx").on(t.userId, t.status),
  index("squad_runs_active_call_idx").on(t.activeCallId),
  index("squad_runs_campaign_lead_idx").on(t.campaignLeadId),
]);

export type SquadStepType =
  | "agent_reason"
  | "make_call"
  | "wait_approval"
  | "send_webhook"
  | "supervisor_review"
  | "live_call"
  | "handoff_agent";

export type SquadStepStatus =
  | "pending"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled";

export type SquadStepPayload = {
  memberId?: number;
  objective?: string;
  requiredInputs?: string[];
  successCriteria?: string;
  requireApproval?: boolean;
  phoneField?: string;
  url?: string;
  targetMemberId?: number;
  handoffReason?: string;
  idempotencyKey?: string;
  [key: string]: unknown;
};

export const squadRunStepsTable = pgTable("squad_run_steps", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull().references(() => squadRunsTable.id, { onDelete: "cascade" }),
  stepIndex: integer("step_index").notNull(),
  type: text("type").$type<SquadStepType>().notNull(),
  status: text("status").$type<SquadStepStatus>().notNull().default("pending"),
  memberId: integer("member_id").references(() => squadMembersTable.id, { onDelete: "set null" }),
  input: jsonb("input").$type<SquadStepPayload>().notNull().default({}),
  output: jsonb("output").$type<Record<string, unknown>>().notNull().default({}),
  retryCount: integer("retry_count").notNull().default(0),
  callId: integer("call_id").references(() => callsTable.id, { onDelete: "set null" }),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("squad_run_steps_run_idx").on(t.runId, t.stepIndex),
  index("squad_run_steps_status_idx").on(t.runId, t.status),
]);

export type SquadEventType =
  | "run_started"
  | "plan_created"
  | "step_started"
  | "step_completed"
  | "step_failed"
  | "approval_requested"
  | "approval_resolved"
  | "handoff"
  | "call_linked"
  | "note"
  | "run_completed"
  | "run_failed"
  | "run_cancelled"
  | "error";

export const squadRunEventsTable = pgTable("squad_run_events", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull().references(() => squadRunsTable.id, { onDelete: "cascade" }),
  type: text("type").$type<SquadEventType>().notNull(),
  message: text("message"),
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("squad_run_events_run_created_idx").on(t.runId, t.createdAt),
]);

/**
 * Squad tasks — lightweight records of work passed between squad members.
 *  - "handoff":   a mid-call transfer that already happened (audit trail).
 *  - "follow_up": a scheduled call the target agent must make later
 *                 (backed by a scheduled_callbacks row that auto-dials).
 */
export type SquadTaskType = "handoff" | "follow_up";

export type SquadTaskStatus =
  | "pending"
  | "scheduled"
  | "completed"
  | "failed"
  | "cancelled";

export const squadTasksTable = pgTable("squad_tasks", {
  id: serial("id").primaryKey(),
  squadId: integer("squad_id").notNull().references(() => squadsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  type: text("type").$type<SquadTaskType>().notNull(),
  status: text("status").$type<SquadTaskStatus>().notNull().default("pending"),
  fromAgentId: integer("from_agent_id").references(() => agentsTable.id, { onDelete: "set null" }),
  toAgentId: integer("to_agent_id").references(() => agentsTable.id, { onDelete: "set null" }),
  callId: integer("call_id").references(() => callsTable.id, { onDelete: "set null" }),
  callerPhone: text("caller_phone"),
  title: text("title").notNull().default(""),
  note: text("note"),
  /** Short conversation summary captured when the task was created. */
  contextSummary: text("context_summary"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  /** Backing scheduled_callbacks row that dials the follow-up call. */
  scheduledCallbackId: integer("scheduled_callback_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("squad_tasks_squad_created_idx").on(t.squadId, t.createdAt),
  index("squad_tasks_user_status_idx").on(t.userId, t.status),
  index("squad_tasks_to_agent_idx").on(t.toAgentId),
]);

export type Squad = typeof squadsTable.$inferSelect;
export type InsertSquad = typeof squadsTable.$inferInsert;
export type SquadMember = typeof squadMembersTable.$inferSelect;
export type InsertSquadMember = typeof squadMembersTable.$inferInsert;
export type SquadRun = typeof squadRunsTable.$inferSelect;
export type InsertSquadRun = typeof squadRunsTable.$inferInsert;
export type SquadRunStep = typeof squadRunStepsTable.$inferSelect;
export type SquadRunEvent = typeof squadRunEventsTable.$inferSelect;
export type SquadTask = typeof squadTasksTable.$inferSelect;
export type InsertSquadTask = typeof squadTasksTable.$inferInsert;
