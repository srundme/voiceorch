import { pgTable, serial, integer, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

export const salesUsersTable = pgTable("sales_users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull().default(""),
  role: text("role").notNull(),
  passwordHash: text("password_hash"),
  status: text("status").notNull().default("active"),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("sales_users_email_uq").on(t.email)]);

export const salesInvitesTable = pgTable("sales_invites", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  role: text("role").notNull(),
  tokenHash: text("token_hash").notNull(),
  invitedBy: integer("invited_by"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("sales_invites_token_hash_uq").on(t.tokenHash),
  index("sales_invites_email_idx").on(t.email),
]);

export const salesSessionsTable = pgTable("sales_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => salesUsersTable.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  ip: text("ip"),
  userAgent: text("user_agent"),
}, (t) => [
  uniqueIndex("sales_sessions_token_hash_uq").on(t.tokenHash),
  index("sales_sessions_user_idx").on(t.userId),
]);

export type SalesUser = typeof salesUsersTable.$inferSelect;
export type SalesInvite = typeof salesInvitesTable.$inferSelect;
export type SalesSession = typeof salesSessionsTable.$inferSelect;
