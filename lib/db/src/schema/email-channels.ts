import { pgTable, serial, integer, text, timestamp, boolean, index, jsonb } from "drizzle-orm/pg-core";

/**
 * Per-user email messaging channel.
 *
 * - managed: SnapServe sends via platform Brevo as SnapServe brand
 * - brevo_byo: user pastes Brevo API key + from identity + content templates
 *
 * SMS is intentionally not a messaging channel. OTP SMS stays separate.
 */

export type EmailChannelMode = "managed" | "brevo_byo";

export interface EmailContentTemplate {
  /** Subject with {{variables}}, e.g. "Thanks {{name}} — next steps" */
  subject: string;
  /**
   * HTML or plain text body with {{variables}}.
   * Supported vars: name, phone, email, summary, disposition, meet_link,
   * agent_name, business_name, call_status, callback_at
   */
  body: string;
  /** When true, wrap managed sends in a light SnapServe shell. BYO sends raw body. */
  wrapManagedShell?: boolean;
}

export const emailChannelsTable = pgTable("email_channels", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  mode: text("mode").$type<EmailChannelMode>().notNull().default("managed"),

  /** AES-encrypted Brevo API key (BYO only). */
  brevoApiKeyEncrypted: text("brevo_api_key_encrypted"),
  /** Last 4 of key for UI display. */
  brevoApiKeyLast4: text("brevo_api_key_last4"),

  fromName: text("from_name"),
  fromEmail: text("from_email"),

  /** Default pasteable content used by journey send_email when step has no override. */
  defaultTemplate: jsonb("default_template").$type<EmailContentTemplate>().notNull().default({
    subject: "Thanks {{name}} — following up from our call",
    body: "<p>Hi {{name}},</p><p>Thanks for speaking with us.</p><p>{{summary}}</p><p>— {{agent_name}}</p>",
    wrapManagedShell: true,
  }),

  active: boolean("active").notNull().default(true),
  lastError: text("last_error"),
  lastSentAt: timestamp("last_sent_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("email_channels_mode_idx").on(t.mode),
]);

export const emailMessagesTable = pgTable("email_messages", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  channelId: integer("channel_id"),
  toEmail: text("to_email").notNull(),
  subject: text("subject").notNull(),
  bodyPreview: text("body_preview"),
  status: text("status").notNull().default("pending"), // pending | sent | failed | skipped
  error: text("error"),
  mode: text("mode").$type<EmailChannelMode>(),
  callId: integer("call_id"),
  journeyRunHint: text("journey_run_hint"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("email_messages_user_id_idx").on(t.userId),
  index("email_messages_created_at_idx").on(t.createdAt),
]);

export type EmailChannel = typeof emailChannelsTable.$inferSelect;
export type InsertEmailChannel = typeof emailChannelsTable.$inferInsert;
export type EmailMessage = typeof emailMessagesTable.$inferSelect;
