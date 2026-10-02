import { pgTable, text, serial, timestamp, integer, jsonb, boolean, index } from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";

export const simulationTestCasesTable = pgTable("simulation_test_cases", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").notNull().references(() => agentsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  personaPrompt: text("persona_prompt").notNull(),
  goal: text("goal").notNull(),
  successCriteria: text("success_criteria").array().notNull().default([]),
  variables: jsonb("variables"),
  kbSourceId: integer("kb_source_id"),
  maxTurns: integer("max_turns").notNull().default(20),
  // ── AI Test Calls (real phone) ──
  /** BCP-47 language the caller persona speaks (e.g. "en-IN", "hi-IN"). */
  language: text("language"),
  /** "easy" | "medium" | "hard" */
  difficulty: text("difficulty"),
  /** Scenario tag, e.g. "happy_path", "dnc_request", "hallucination_probe". */
  scenario: text("scenario"),
  /** "female" | "male" — picks the caller persona voice. */
  callerGender: text("caller_gender"),
  maxDurationSeconds: integer("max_duration_seconds").notNull().default(300),
  createdBy: text("created_by"),
  archived: boolean("archived").notNull().default(false),
  /** Hidden caller agent (agents.is_test_persona) reused across runs of this case. */
  callerAgentId: integer("caller_agent_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const simulationRunsTable = pgTable("simulation_runs", {
  id: serial("id").primaryKey(),
  /** Target agent under test. */
  agentId: integer("agent_id").notNull().references(() => agentsTable.id, { onDelete: "cascade" }),
  testCaseId: integer("test_case_id").references(() => simulationTestCasesTable.id, { onDelete: "set null" }),
  userId: text("user_id").notNull(),
  /** queued | dialing | in_call | evaluating | passed | failed | error | cancelled */
  status: text("status").notNull().default("pending"),
  score: integer("score"),
  result: jsonb("result"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  // ── AI Test Calls (real phone) ──
  batchId: text("batch_id"),
  callerAgentId: integer("caller_agent_id"),
  callerCallId: integer("caller_call_id"),
  calleeCallId: integer("callee_call_id"),
  /** Target agent's inbound DID that the caller persona dials. */
  targetNumber: text("target_number"),
  /** Caller ID the persona leg dialed from — used to correlate the inbound leg. */
  callerFromNumber: text("caller_from_number"),
  dialStartedAt: timestamp("dial_started_at", { withTimezone: true }),
  /** "pass" | "fail" */
  verdict: text("verdict"),
  error: text("error"),
  costCents: integer("cost_cents"),
  /** Test case name/goal/criteria as they were when the run was queued. */
  testCaseSnapshot: jsonb("test_case_snapshot"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("simulation_runs_agent_created_idx").on(t.agentId, t.createdAt),
  index("simulation_runs_status_idx").on(t.status),
]);

export const simulationMessagesTable = pgTable("simulation_messages", {
  id: serial("id").primaryKey(),
  simulationRunId: integer("simulation_run_id").notNull().references(() => simulationRunsTable.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SimulationTestCase = typeof simulationTestCasesTable.$inferSelect;
export type SimulationRun = typeof simulationRunsTable.$inferSelect;
