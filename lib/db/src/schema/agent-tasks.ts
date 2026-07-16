import { pgTable, text, serial, timestamp, integer, boolean, jsonb, index } from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";
import { callsTable } from "./calls";

export type AgentTaskStatus =
  | "draft"
  | "running"
  | "awaiting_approval"
  | "calling"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentTaskDialPolicy = "auto" | "approval";

export type AgentTaskPrefs = {
  query?: string;
  location?: string;
  lat?: number;
  lng?: number;
  radiusMeters?: number;
  timePrefs?: string;
  category?: string;
  maxCandidates?: number;
  maxDialAttempts?: number;
};

export const agentTasksTable = pgTable("agent_tasks", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  agentId: integer("agent_id").notNull().references(() => agentsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  goal: text("goal").notNull(),
  status: text("status").notNull().default("draft").$type<AgentTaskStatus>(),
  dialPolicy: text("dial_policy").notNull().default("approval").$type<AgentTaskDialPolicy>(),
  prefs: jsonb("prefs").$type<AgentTaskPrefs>().default({}),
  resultSummary: text("result_summary"),
  errorMessage: text("error_message"),
  dialAttempts: integer("dial_attempts").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("agent_tasks_user_updated_idx").on(t.userId, t.updatedAt),
  index("agent_tasks_user_status_idx").on(t.userId, t.status),
  index("agent_tasks_agent_updated_idx").on(t.agentId, t.updatedAt),
]);

export const agentTaskMessagesTable = pgTable("agent_task_messages", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull().references(() => agentTasksTable.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // user | assistant | system
  content: text("content").notNull(),
  meta: jsonb("meta").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("agent_task_messages_task_created_idx").on(t.taskId, t.createdAt),
]);

export type AgentTaskStepType = "lookup" | "await_approval" | "outbound_call" | "summarize";
export type AgentTaskStepStatus = "pending" | "running" | "waiting" | "completed" | "failed" | "skipped";

export const agentTaskStepsTable = pgTable("agent_task_steps", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull().references(() => agentTasksTable.id, { onDelete: "cascade" }),
  stepIndex: integer("step_index").notNull(),
  type: text("type").notNull().$type<AgentTaskStepType>(),
  status: text("status").notNull().default("pending").$type<AgentTaskStepStatus>(),
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
  result: jsonb("result").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("agent_task_steps_task_idx").on(t.taskId, t.stepIndex),
]);

export const agentTaskCandidatesTable = pgTable("agent_task_candidates", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull().references(() => agentTasksTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  phone: text("phone"),
  address: text("address"),
  sourceUrl: text("source_url"),
  placeId: text("place_id"),
  rank: integer("rank").notNull().default(0),
  selected: boolean("selected").notNull().default(false),
  meta: jsonb("meta").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("agent_task_candidates_task_rank_idx").on(t.taskId, t.rank),
]);

export const agentTaskCallsTable = pgTable("agent_task_calls", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull().references(() => agentTasksTable.id, { onDelete: "cascade" }),
  callId: integer("call_id").references(() => callsTable.id, { onDelete: "set null" }),
  candidateId: integer("candidate_id").references(() => agentTaskCandidatesTable.id, { onDelete: "set null" }),
  toNumber: text("to_number").notNull(),
  outcome: text("outcome"),
  summary: text("summary"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("agent_task_calls_task_idx").on(t.taskId),
  index("agent_task_calls_call_idx").on(t.callId),
]);

export type AgentTask = typeof agentTasksTable.$inferSelect;
export type AgentTaskMessage = typeof agentTaskMessagesTable.$inferSelect;
export type AgentTaskStep = typeof agentTaskStepsTable.$inferSelect;
export type AgentTaskCandidate = typeof agentTaskCandidatesTable.$inferSelect;
export type AgentTaskCall = typeof agentTaskCallsTable.$inferSelect;
