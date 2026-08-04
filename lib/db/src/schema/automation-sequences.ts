import { pgTable, serial, integer, text, timestamp, boolean, json } from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";

export type AutomationStepConfig = {
  // e.g., "delay", "fixed_date", "day_of_month"
  type: "delay" | "fixed_date" | "day_of_month";
  // specific parameters based on type
  delayDays?: number;
  fixedDate?: string; // YYYY-MM-DD
  dayOfMonth?: number;
  // Time of day to execute this step (e.g., "09:00")
  timeOfDay?: string;
  timezone?: string;
};

export const automationSequencesTable = pgTable("automation_sequences", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const automationSequenceStepsTable = pgTable("automation_sequence_steps", {
  id: serial("id").primaryKey(),
  sequenceId: integer("sequence_id").references(() => automationSequencesTable.id, { onDelete: "cascade" }).notNull(),
  // Order of the step (1, 2, 3...)
  stepOrder: integer("step_order").notNull(),
  // Configuration for timing (delay, specific date, etc)
  config: json("config").$type<AutomationStepConfig>().notNull(),
  // The agent to use for this specific step
  agentId: integer("agent_id").references(() => agentsTable.id, { onDelete: "set null" }),
  // Alternative prompt/instructions for this specific step (overrides agent default if provided)
  promptOverride: text("prompt_override"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const automationSequenceLeadsTable = pgTable("automation_sequence_leads", {
  id: serial("id").primaryKey(),
  sequenceId: integer("sequence_id").references(() => automationSequencesTable.id, { onDelete: "cascade" }).notNull(),
  phone: text("phone").notNull(),
  name: text("name"),
  email: text("email"),
  // Custom variables passed via CSV upload
  metadata: json("metadata").$type<Record<string, any>>(),
  // The current step the lead is on. Starts at 1.
  currentStepOrder: integer("current_step_order").notNull().default(1),
  // Status of the lead in the sequence
  status: text("status").notNull().default("active"), // active | completed | cancelled | failed
  // When the next step is calculated to occur
  nextExecutionAt: timestamp("next_execution_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
