import { pgTable, uuid, text, timestamp, unique } from "drizzle-orm/pg-core";

/**
 * Google OAuth connections scoped to the Sheets + Drive scopes used by the
 * workflow maker. Separate from `google_calendar_connections` because the
 * granted scopes differ (spreadsheets + drive.readonly vs calendar).
 *
 * Access / refresh tokens are stored AES-256-GCM encrypted (see lib/crypto.ts).
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
}, (t) => [unique("google_sheets_connections_user_email_unique").on(t.userId, t.email)]);

export type GoogleSheetsConnection = typeof googleSheetsConnectionsTable.$inferSelect;
export type InsertGoogleSheetsConnection = typeof googleSheetsConnectionsTable.$inferInsert;
