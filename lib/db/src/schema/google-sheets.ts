import {
  pgTable, text, timestamp, integer, boolean, jsonb, uuid, index, unique,
} from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";

/**
 * User-owned Google Sheets OAuth connections (platform Google OAuth app).
 * Multiple Google accounts per SnapServe user are allowed.
 */
export const googleSheetsConnectionsTable = pgTable("google_sheets_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  email: text("email").notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull().default(""),
  tokenExpiry: timestamp("token_expiry", { withTimezone: true }),
  grantedScopes: text("granted_scopes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  unique("google_sheets_connections_user_email_unique").on(t.userId, t.email),
  index("google_sheets_connections_user_id_idx").on(t.userId),
]);

export type SheetUseCase = "lookup" | "call_log" | "outcome" | "custom";

/**
 * Agent ↔ spreadsheet bindings. One agent can have many sheets for different
 * use cases (lookup vs call log vs outcome). Runtime: session-start lookup
 * inject + post-call call_log append / outcome upsert.
 */
export const agentSheetBindingsTable = pgTable("agent_sheet_bindings", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  agentId: integer("agent_id").notNull().references(() => agentsTable.id, { onDelete: "cascade" }),
  connectionId: uuid("connection_id").notNull().references(() => googleSheetsConnectionsTable.id, { onDelete: "cascade" }),
  /** User-facing label, e.g. "Leads lookup" / "Call outcomes". */
  label: text("label").notNull(),
  useCase: text("use_case").$type<SheetUseCase>().notNull().default("custom"),
  spreadsheetId: text("spreadsheet_id").notNull(),
  spreadsheetTitle: text("spreadsheet_title"),
  sheetName: text("sheet_name").notNull().default("Sheet1"),
  sheetGid: integer("sheet_gid"),
  /** SnapServe field → sheet header. Filled in Phase 02 mapping UI. */
  columnMap: jsonb("column_map").$type<Record<string, string>>().notNull().default({}),
  matchColumn: text("match_column"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("agent_sheet_bindings_agent_id_idx").on(t.agentId),
  index("agent_sheet_bindings_user_id_idx").on(t.userId),
  index("agent_sheet_bindings_connection_id_idx").on(t.connectionId),
]);

export type GoogleSheetsConnection = typeof googleSheetsConnectionsTable.$inferSelect;
export type InsertGoogleSheetsConnection = typeof googleSheetsConnectionsTable.$inferInsert;
export type AgentSheetBinding = typeof agentSheetBindingsTable.$inferSelect;
export type InsertAgentSheetBinding = typeof agentSheetBindingsTable.$inferInsert;
