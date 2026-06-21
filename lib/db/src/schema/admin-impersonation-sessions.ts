import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";

export const adminImpersonationSessionsTable = pgTable("admin_impersonation_sessions", {
  id: serial("id").primaryKey(),
  sessionToken: text("session_token").notNull().unique(),
  adminId: text("admin_id").notNull(),
  targetUserId: text("target_user_id").notNull(),
  targetUserEmail: text("target_user_email"),
  targetUserName: text("target_user_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  exchangeCode: text("exchange_code").unique(),
  exchangeCodeExpiresAt: timestamp("exchange_code_expires_at", { withTimezone: true }),
});

export type AdminImpersonationSession = typeof adminImpersonationSessionsTable.$inferSelect;
