import { pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const teamMembersTable = pgTable("team_members", {
  id: serial("id").primaryKey(),
  ownerUserId: text("owner_user_id").notNull(),
  memberUserId: text("member_user_id"),
  email: text("email").notNull(),
  name: text("name"),
  role: text("role").notNull().default("member"),
  status: text("status").notNull().default("pending"),
  /** Unguessable invite secret used in /app/join?token=… */
  token: text("token"),
  invitedAt: timestamp("invited_at", { withTimezone: true }).defaultNow().notNull(),
  joinedAt: timestamp("joined_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("team_members_token_unique").on(t.token),
]);
