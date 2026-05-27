import { pgTable, text, serial, timestamp, jsonb } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * One row per SnapServe user — their Vobiz sub-account provisioned under the
 * platform partner umbrella. Required to initiate a KYC session because each
 * sub-account can only have one active KYC session at a time.
 */
export const vobizAccountsTable = pgTable("vobiz_accounts", {
  id:                       serial("id").primaryKey(),
  userId:                   text("user_id").notNull().unique().references(() => usersTable.clerkId, { onDelete: "cascade" }),
  vobizAuthId:              text("vobiz_auth_id").notNull(),
  vobizAuthTokenEncrypted:  text("vobiz_auth_token_encrypted").notNull(),
  kycStatus:                text("kyc_status").notNull().default("pending"), // pending | completed | failed
  verifiedData:             jsonb("verified_data"),
  createdAt:                timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:                timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

/**
 * One row per KYC attempt (redirect-flow sessions). A new session auto-revokes
 * any previous active session on Vobiz's side.
 */
export const vobizKycSessionsTable = pgTable("vobiz_kyc_sessions", {
  id:                   serial("id").primaryKey(),
  userId:               text("user_id").notNull().references(() => usersTable.clerkId, { onDelete: "cascade" }),
  vobizSessionId:       text("vobiz_session_id").notNull().unique(),
  vobizAccountAuthId:   text("vobiz_account_auth_id").notNull(),
  flowType:             text("flow_type").notNull().default("redirect"),
  status:               text("status").notNull().default("link_ready"),
  widgetUrl:            text("widget_url"),
  redirectUrl:          text("redirect_url"),
  completedAt:          timestamp("completed_at", { withTimezone: true }),
  createdAt:            timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type VobizAccount    = typeof vobizAccountsTable.$inferSelect;
export type VobizKycSession = typeof vobizKycSessionsTable.$inferSelect;
