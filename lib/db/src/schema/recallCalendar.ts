import { pgTable, text, timestamp, uuid, integer, boolean, unique, index } from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";

/**
 * Per-user Recall Calendar V2 connection (Google OAuth handoff).
 * Refresh token is NOT stored long-term — Recall owns token refresh after create.
 */
export const recallCalendarConnectionsTable = pgTable("recall_calendar_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  email: text("email").notNull(),
  platformEmail: text("platform_email"),
  recallCalendarId: text("recall_calendar_id").notNull(),
  /** connecting | connected | disconnected */
  status: text("status").notNull().default("connecting"),
  oauthScopes: text("oauth_scopes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  unique("recall_calendar_connections_user_unique").on(t.userId),
  unique("recall_calendar_connections_recall_id_unique").on(t.recallCalendarId),
  index("recall_calendar_connections_user_idx").on(t.userId),
]);

/** Opt-in bots scheduled onto Recall calendar events. */
export const recallCalendarEventBotsTable = pgTable("recall_calendar_event_bots", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  recallCalendarId: text("recall_calendar_id").notNull(),
  recallEventId: text("recall_event_id").notNull(),
  recallBotId: text("recall_bot_id"),
  agentId: integer("agent_id").references(() => agentsTable.id, { onDelete: "set null" }),
  enabled: boolean("enabled").notNull().default(true),
  meetingUrl: text("meeting_url"),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  eventTitle: text("event_title"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  unique("recall_calendar_event_bots_event_unique").on(t.userId, t.recallEventId),
  index("recall_calendar_event_bots_cal_idx").on(t.recallCalendarId),
  index("recall_calendar_event_bots_user_idx").on(t.userId),
]);
