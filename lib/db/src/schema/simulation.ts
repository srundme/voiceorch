import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const simulationRunsTable = pgTable("simulation_runs", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").notNull().references(() => agentsTable.id, { onDelete: "cascade" }),
  testCaseId: integer("test_case_id").references(() => simulationTestCasesTable.id, { onDelete: "set null" }),
  userId: text("user_id").notNull(),
  status: text("status").notNull().default("pending"),
  score: integer("score"),
  result: jsonb("result"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const simulationMessagesTable = pgTable("simulation_messages", {
  id: serial("id").primaryKey(),
  simulationRunId: integer("simulation_run_id").notNull().references(() => simulationRunsTable.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
