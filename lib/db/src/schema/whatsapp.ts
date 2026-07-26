import {
  pgTable, text, timestamp, integer, boolean, uuid, index, jsonb, uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
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

/* ── Native VoBiz WhatsApp (first-party sends, no BYO-BSP needed) ────────── */

/**
 * Per-user native WhatsApp enrollment. One row per user.
 * - mode 'shared': messages go out from the platform's SnapServe channel
 *   (master VoBiz creds + platform_settings channel config). Zero user setup.
 * - mode 'own': user's own WABA/number connected as a VoBiz channel under
 *   their creds. The Meta access token is passed through to VoBiz at connect
 *   time and NEVER stored here (VoBiz treats it as write-only).
 */
export const whatsappChannelsTable = pgTable("whatsapp_channels", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().unique("wa_channels_user_unique"),
  mode: text("mode").notNull().default("shared"), // 'shared' | 'own'
  /** Business name substituted into shared-tier templates. */
  businessName: text("business_name").notNull().default(""),
  notifyBookingConfirmed: boolean("notify_booking_confirmed").notNull().default(true),
  notifyCallSummary: boolean("notify_call_summary").notNull().default(true),
  notifyCallbackScheduled: boolean("notify_callback_scheduled").notNull().default(true),
  /** Agent dialed when a customer replies asking for a call; null = no dial. */
  inboundAgentId: integer("inbound_agent_id").references(() => agentsTable.id, { onDelete: "set null" }),
  /** Shared-tier abuse control: max business-initiated sends per day. */
  dailyCap: integer("daily_cap").notNull().default(50),
  /* own-channel fields (null on shared tier) */
  vobizChannelId: text("vobiz_channel_id"),
  wabaId: text("waba_id"),
  phoneNumberId: text("phone_number_id"),
  phoneE164: text("phone_e164"),
  accessTokenLast4: text("access_token_last4"),
  status: text("status").notNull().default("active"), // active | pending | error | disabled
  lastError: text("last_error"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("wa_channels_mode_idx").on(t.mode),
  // A VoBiz channel id may be claimed by at most one user (cross-tenant guard).
  uniqueIndex("wa_channels_vobiz_channel_unique").on(t.vobizChannelId)
    .where(sql`vobiz_channel_id is not null`),
]);

/** Native WhatsApp message log + delivery-status tracking (✓✓ in dashboard). */
export const whatsappMessagesTable = pgTable("whatsapp_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  channelId: uuid("channel_id").notNull().references(() => whatsappChannelsTable.id, { onDelete: "cascade" }),
  callId: integer("call_id"),
  direction: text("direction").notNull().default("outbound"), // outbound | inbound
  /** Counterparty phone: recipient for outbound, sender for inbound. */
  phone: text("phone").notNull(),
  msgType: text("msg_type").notNull().default("template"), // template | text | media
  templateName: text("template_name"),
  bodyPreview: text("body_preview"),
  status: text("status").notNull().default("pending"), // pending|sent|delivered|read|failed|received
  vobizMessageId: text("vobiz_message_id"),
  metaMessageId: text("meta_message_id"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("wa_messages_user_created_idx").on(t.userId, t.createdAt),
  index("wa_messages_vobiz_id_idx").on(t.vobizMessageId),
  index("wa_messages_meta_id_idx").on(t.metaMessageId),
  index("wa_messages_phone_created_idx").on(t.phone, t.createdAt),
]);

/** VoBiz webhook event dedupe (deliveries are retried; Meta events repeat). */
export const whatsappEventsTable = pgTable("whatsapp_events", {
  eventId: text("event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WhatsappChannel = typeof whatsappChannelsTable.$inferSelect;
export type InsertWhatsappChannel = typeof whatsappChannelsTable.$inferInsert;
export type WhatsappMessage = typeof whatsappMessagesTable.$inferSelect;
export type InsertWhatsappMessage = typeof whatsappMessagesTable.$inferInsert;
