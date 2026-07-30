import {
  pgTable, text, timestamp, integer, boolean, uuid, index, jsonb, uniqueIndex, customType,
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

/** Template names the user created in their BSP, keyed by SnapServe hint. */
export type WhatsappConnectionTemplates = {
  call_summary?: string;
  booking_confirmed?: string;
  callback_scheduled?: string;
};

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
  /**
   * Names of templates the user approved in their BSP.
   * Included as `template_name` on outbound webhooks so Zapier/BSP can send without remapping hints.
   */
  templates: jsonb("templates").$type<WhatsappConnectionTemplates>().notNull().default({}),
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
  /** AI chatbot: auto-reply to inbound WhatsApp texts using this agent's persona. */
  chatbotEnabled: boolean("chatbot_enabled").notNull().default(false),
  chatbotAgentId: integer("chatbot_agent_id").references(() => agentsTable.id, { onDelete: "set null" }),
  /** Brochure/catalog asset auto-sent when a customer asks for it (whatsapp_assets.id). */
  brochureAssetId: uuid("brochure_asset_id"),
  brochureAutoSend: boolean("brochure_auto_send").notNull().default(true),
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

/** Raw binary column (PostgreSQL `bytea`) stored/returned as a Node Buffer. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/**
 * User-uploaded WhatsApp media assets (brochures/catalogs). Bytes live in
 * Postgres (Railway prod has no object storage) and are served publicly via
 * an unguessable token URL so Meta can fetch them at send time.
 */
export const whatsappAssetsTable = pgTable("whatsapp_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  kind: text("kind").notNull().default("brochure"),
  filename: text("filename").notNull(),
  mime: text("mime").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  data: bytea("data").notNull(),
  publicToken: text("public_token").notNull().unique("wa_assets_public_token_unique"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("wa_assets_user_id_idx").on(t.userId),
]);

export type WhatsappAsset = typeof whatsappAssetsTable.$inferSelect;
export type InsertWhatsappAsset = typeof whatsappAssetsTable.$inferInsert;

/**
 * BYON (bring-your-own-number) WhatsApp verification state for a user's
 * existing voice DID. Verification OTPs (from Meta Business Manager or the
 * VoBiz BYON verify API) arrive as calls/SMS to the DID — which routes to OUR
 * answer webhook, so the platform auto-captures the spoken code via a
 * <Record> + transcription flow and surfaces it in the dashboard.
 * status: armed | code_captured | confirmed | expired | failed
 */
export const whatsappByonVerificationsTable = pgTable("whatsapp_byon_verifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  /** phone_numbers.id of the voice DID being WhatsApp-enabled (no FK: app-enforced). */
  phoneNumberId: integer("phone_number_id"),
  phoneE164: text("phone_e164").notNull(),
  status: text("status").notNull().default("armed"),
  method: text("method").notNull().default("voice"),
  vobizVerificationId: text("vobiz_verification_id"),
  otpCode: text("otp_code"),
  recordingUrl: text("recording_url"),
  transcript: text("transcript"),
  armedUntil: timestamp("armed_until", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("wa_byon_user_id_idx").on(t.userId),
  index("wa_byon_phone_e164_idx").on(t.phoneE164),
]);

export type WhatsappByonVerification = typeof whatsappByonVerificationsTable.$inferSelect;
export type InsertWhatsappByonVerification = typeof whatsappByonVerificationsTable.$inferInsert;
