import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";

export const agentVersionsTable = pgTable("agent_versions", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").notNull().references(() => agentsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  versionNumber: text("version_number").notNull(),
  versionName: text("version_name").notNull(),
  commitDescription: text("commit_description").notNull(),
  releaseNotes: text("release_notes"),
  status: text("status").notNull().default("draft"),
  snapshot: jsonb("snapshot").notNull(),
  publishedBy: text("published_by"),
  restoredFromVersionId: integer("restored_from_version_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AgentVersion = typeof agentVersionsTable.$inferSelect;
