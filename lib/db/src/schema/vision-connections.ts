import { pgTable, serial, text, integer, jsonb, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";

/**
 * External API connections for vision agents.
 * Allows agents to pull/push data from external apps and custom databases
 * during vision tool execution (e.g. look up a customer by face match result).
 *
 * Supported types:
 *  - rest_api    → call an external REST endpoint (GET/POST) with the vision result
 *  - webhook     → fire-and-forget POST on any vision event
 *  - database    → connect to an external PostgreSQL/MySQL via a connection string
 */
export const visionConnectionsTable = pgTable("vision_connections", {
  id:          serial("id").primaryKey(),
  agentId:     integer("agent_id").notNull().references(() => agentsTable.id, { onDelete: "cascade" }),
  userId:      text("user_id").notNull(),
  name:        text("name").notNull(),
  description: text("description"),
  type:        text("type").notNull(), // 'rest_api' | 'webhook' | 'database'
  active:      boolean("active").notNull().default(true),

  /**
   * Type-specific configuration (encrypted at rest via app-level encryption):
   *
   * rest_api: { url, method, headers: {k:v}, authType: "none"|"bearer"|"api_key"|"basic",
   *             authValue, bodyTemplate, responseMapping: {fieldPath→varName} }
   *
   * webhook:  { url, method, headers: {k:v}, events: ["media_received","extract_complete",...],
   *             bodyTemplate, signingSecret }
   *
   * database: { connectionString (encrypted), query, paramMapping: {paramName→visionVar} }
   */
  config:      jsonb("config").notNull().default({}),

  /** Last time this connection was successfully used */
  lastUsedAt:  timestamp("last_used_at", { withTimezone: true }),
  /** Last error string if connection test failed */
  lastError:   text("last_error"),

  createdAt:   timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("vision_conn_agent_idx").on(t.agentId),
]);

export type VisionConnection       = typeof visionConnectionsTable.$inferSelect;
export type InsertVisionConnection = typeof visionConnectionsTable.$inferInsert;
