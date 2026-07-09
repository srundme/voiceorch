import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";

export const vibeChatSessionsTable = pgTable("vibe_chat_sessions", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  agentId: integer("agent_id").references(() => agentsTable.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("vibe_chat_sessions_user_updated_idx").on(t.userId, t.updatedAt),
  index("vibe_chat_sessions_agent_updated_idx").on(t.agentId, t.updatedAt),
]);

export const vibeChatMessagesTable = pgTable("vibe_chat_messages", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => vibeChatSessionsTable.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("vibe_chat_messages_session_created_idx").on(t.sessionId, t.createdAt),
]);

export type VibeChatSession = typeof vibeChatSessionsTable.$inferSelect;
export type VibeChatMessage = typeof vibeChatMessagesTable.$inferSelect;
