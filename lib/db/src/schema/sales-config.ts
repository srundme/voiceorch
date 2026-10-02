import { pgTable, serial, integer, text, timestamp, jsonb, date, uniqueIndex, index } from "drizzle-orm/pg-core";

export const salesSettingsTable = pgTable("sales_settings", {
  id: integer("id").primaryKey(),
  config: jsonb("config").notNull(),
  updatedBy: integer("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const salesTargetsTable = pgTable("sales_targets", {
  id: serial("id").primaryKey(),
  date: date("date", { mode: "string" }).notNull(),
  kind: text("kind").notNull(),
  dayType: text("day_type").notNull().default("selling"),
  visits: integer("visits").notNull().default(0),
  conversations: integer("conversations").notNull().default(0),
  demos: integer("demos").notNull().default(0),
  pilots: integer("pilots").notNull().default(0),
  operatingPaid: integer("operating_paid").notNull().default(0),
  stretchPaid: integer("stretch_paid").notNull().default(0),
  note: text("note"),
}, (t) => [uniqueIndex("sales_targets_date_kind_uq").on(t.date, t.kind)]);

export const salesAuditTable = pgTable("sales_audit", {
  id: serial("id").primaryKey(),
  actorUserId: integer("actor_user_id"),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  action: text("action").notNull(),
  before: jsonb("before"),
  after: jsonb("after"),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("sales_audit_entity_idx").on(t.entity, t.entityId)]);

export const salesWebhookEventsTable = pgTable("sales_webhook_events", {
  id: serial("id").primaryKey(),
  eventId: text("event_id").notNull(),
  source: text("source").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  payload: jsonb("payload"),
  status: text("status").notNull().default("received"),
  companyId: integer("company_id"),
  error: text("error"),
}, (t) => [uniqueIndex("sales_webhook_events_event_id_uq").on(t.eventId)]);

export const salesImportsTable = pgTable("sales_imports", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  filename: text("filename"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  summary: jsonb("summary"),
});

export type SalesSettingsRow = typeof salesSettingsTable.$inferSelect;
export type SalesTarget = typeof salesTargetsTable.$inferSelect;
export type SalesAuditEntry = typeof salesAuditTable.$inferSelect;
