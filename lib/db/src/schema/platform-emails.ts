import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";

export const platformEmailsTable = pgTable("platform_emails", {
  id: serial("id").primaryKey(),
  toEmail: text("to_email").notNull(),
  toUserId: text("to_user_id"),
  toName: text("to_name"),
  subject: text("subject").notNull(),
  htmlBody: text("html_body").notNull(),
  sentBy: text("sent_by").notNull().default("system"),
  emailType: text("email_type").notNull().default("manual"),
  status: text("status").notNull().default("sent"),
  errorMessage: text("error_message"),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PlatformEmail = typeof platformEmailsTable.$inferSelect;
