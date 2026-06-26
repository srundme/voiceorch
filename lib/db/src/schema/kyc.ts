import { pgTable, text, serial, timestamp, jsonb, index } from "drizzle-orm/pg-core";
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
  verifiedData:             jsonb("verified_data"),   // raw payload from VoBiz
  extractedData:            jsonb("extracted_data"),  // structured OCR: { panNumber, name, dob, gstin, ... }
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
  webhookToken:         text("webhook_token"), // per-session secret appended to webhook URL for auth
  webhookPayload:       jsonb("webhook_payload"), // last raw webhook body received
  completedAt:          timestamp("completed_at", { withTimezone: true }),
  createdAt:            timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Append-only audit log for every KYC-related event per user.
 * Events: session_created | session_opened | webhook_received | status_changed | callback_received
 */
export const kycAuditLogsTable = pgTable(
  "kyc_audit_logs",
  {
    id:         serial("id").primaryKey(),
    userId:     text("user_id").references(() => usersTable.clerkId, { onDelete: "cascade" }),
    sessionId:  text("session_id"),
    eventType:  text("event_type").notNull(),
    eventData:  jsonb("event_data"),
    ipAddress:  text("ip_address"),
    createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("kyc_audit_logs_user_id_idx").on(t.userId, t.createdAt)],
);

export type VobizAccount    = typeof vobizAccountsTable.$inferSelect;
export type VobizKycSession = typeof vobizKycSessionsTable.$inferSelect;
export type KycAuditLog     = typeof kycAuditLogsTable.$inferSelect;
