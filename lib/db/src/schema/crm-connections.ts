import { pgTable, serial, text, timestamp, jsonb, integer, index, uniqueIndex } from "drizzle-orm/pg-core";

export type CrmProvider = "hubspot" | "zoho";

export interface CrmTokenPayload {
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO timestamp
  accountsServer?: string; // e.g. "https://accounts.zoho.in" — Zoho regional auth server
  apiDomain?: string;      // e.g. "https://www.zohoapis.in"  — Zoho regional API base
}

export const crmConnectionsTable = pgTable("crm_connections", {
  id:                 serial("id").primaryKey(),
  userId:             text("user_id").notNull(),
  provider:           text("provider").notNull(), // "hubspot" | "zoho"
  accountId:          text("account_id").notNull(),
  accountName:        text("account_name"),
  encryptedTokens:    text("encrypted_tokens").notNull(),
  fieldMapping:       jsonb("field_mapping").$type<Record<string, string>>().default({}),
  webhookSecret:      text("webhook_secret"),
  webhookCampaignId:  integer("webhook_campaign_id"),
  webhookAgentId:     integer("webhook_agent_id"),
  lastSyncAt:         timestamp("last_sync_at",    { withTimezone: true }),
  lastErrorAt:        timestamp("last_error_at",   { withTimezone: true }),
  lastError:          text("last_error"),
  createdAt:          timestamp("created_at",      { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at",      { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, t => [
  index("crm_connections_user_id_idx").on(t.userId),
  uniqueIndex("crm_connections_user_provider_account_idx").on(t.userId, t.provider, t.accountId),
]);

export type CrmConnection    = typeof crmConnectionsTable.$inferSelect;
export type InsertCrmConnection = typeof crmConnectionsTable.$inferInsert;
