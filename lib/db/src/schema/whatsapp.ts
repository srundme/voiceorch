import {
  pgTable, text, timestamp, integer, boolean, uuid, index, jsonb,
} from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";
import { campaignsTable } from "./campaigns";

/**
 * WhatsApp webhook connection (provider-agnostic).
 * - Inbound: BSP / Zapier POSTs button clicks → SnapServe dials the AI agent.
 * - Outbound: after each call, SnapServe POSTs call.ended to the customer's URL
 *   so they can send a WhatsApp template via their own BSP.
 */
export const whatsappConnectionsTable = pgTable("whatsapp_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  name: text("name").notNull().default("WhatsApp"),
  agentId: integer("agent_id").notNull().references(() => agentsTable.id, { onDelete: "cascade" }),
  /** Optional campaign for lead tracking; dial still uses agent when null. */
  campaignId: integer("campaign_id").references(() => campaignsTable.id, { onDelete: "set null" }),
  /** Public inbound token: POST /api/webhooks/whatsapp/:token */
  inboundToken: text("inbound_token").notNull().unique(),
  /** Customer HTTPS URL that sends WhatsApp templates (BSP / Zapier / n8n). */
  outboundWebhookUrl: text("outbound_webhook_url"),
  /** Optional HMAC secret for outbound POSTs (X-SnapServe-Signature). */
  outboundSecret: text("outbound_secret"),
  requestCallEnabled: boolean("request_call_enabled").notNull().default(true),
  postCallEnabled: boolean("post_call_enabled").notNull().default(true),
  /**
   * Button ids that trigger a dial (case-insensitive).
   * Default covers common "Request a Call" labels.
   */
  buttonIds: jsonb("button_ids").$type<string[]>().notNull().default([
    "request_a_call",
    "request_call",
    "request call",
    "call_me",
    "call me",
  ]),
  active: boolean("active").notNull().default(true),
  lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
  lastOutboundAt: timestamp("last_outbound_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("whatsapp_connections_user_id_idx").on(t.userId),
  index("whatsapp_connections_agent_id_idx").on(t.agentId),
  index("whatsapp_connections_inbound_token_idx").on(t.inboundToken),
]);

export type WhatsappConnection = typeof whatsappConnectionsTable.$inferSelect;
export type InsertWhatsappConnection = typeof whatsappConnectionsTable.$inferInsert;
