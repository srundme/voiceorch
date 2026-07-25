import { pgTable, serial, text, integer, jsonb, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";

/**
 * Per-vision-agent custom database — schema definitions.
 * Each schema is a named collection (like a table) with typed fields.
 * Example: a "customers" schema with fields [name, phone, status, notes].
 */
export const visionAgentDbSchemasTable = pgTable("vision_agent_db_schemas", {
  id:          serial("id").primaryKey(),
  agentId:     integer("agent_id").notNull().references(() => agentsTable.id, { onDelete: "cascade" }),
  userId:      text("user_id").notNull(),
  name:        text("name").notNull(),        // e.g. "customers", "products"
  description: text("description"),
  /** Field definitions: [{ name, type: "text"|"number"|"boolean"|"date", required, description }] */
  fields:      jsonb("fields").notNull().default([]),
  /** If true, vision tools can write records (extract → save). If false, read-only lookup. */
  writeable:   boolean("writeable").notNull().default(true),
  createdAt:   timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("vadb_schema_agent_idx").on(t.agentId),
]);

/**
 * Actual records stored in the per-agent custom database.
 */
export const visionAgentDbRecordsTable = pgTable("vision_agent_db_records", {
  id:        serial("id").primaryKey(),
  schemaId:  integer("schema_id").notNull().references(() => visionAgentDbSchemasTable.id, { onDelete: "cascade" }),
  agentId:   integer("agent_id").notNull().references(() => agentsTable.id, { onDelete: "cascade" }),
  /** The actual record data — must conform to the parent schema's fields */
  data:      jsonb("data").notNull().default({}),
  /** Optional: call that created this record */
  callId:    integer("call_id"),
  /** Optional: phone/session that triggered creation */
  phone:     text("phone"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("vadb_record_schema_idx").on(t.schemaId),
  index("vadb_record_agent_idx").on(t.agentId),
]);

export type VisionAgentDbSchema       = typeof visionAgentDbSchemasTable.$inferSelect;
export type InsertVisionAgentDbSchema = typeof visionAgentDbSchemasTable.$inferInsert;
export type VisionAgentDbRecord       = typeof visionAgentDbRecordsTable.$inferSelect;
export type InsertVisionAgentDbRecord = typeof visionAgentDbRecordsTable.$inferInsert;
