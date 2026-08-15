/**
 * User-defined campaign analytics report definitions.
 * Blocks drive both the dashboard Results view and Brevo HTML emails.
 */
import {
  pgTable, serial, integer, text, timestamp, jsonb, boolean, index,
} from "drizzle-orm/pg-core";
import { campaignsTable } from "./campaigns";

export type ReportBlockType =
  | "kpis"
  | "dispositions"
  | "deep_sentiment"
  | "purchase_funnel"
  | "objections"
  | "agent_performance"
  | "custom_questions"
  | "hot_leads"
  | "nl_insight"
  | "narrative";

export type ReportBlock = {
  type: ReportBlockType;
  metrics?: string[];
  questionIds?: string[];
  filter?: {
    minPurchaseScore?: number;
    intents?: string[];
  };
  prompt?: string;
};

export type ReportEmailConfig = {
  enabled: boolean;
  recipients: string[];
  trigger: "manual" | "batch_complete" | "schedule";
  /** Cron-like hint for schedule trigger, e.g. "weekly_monday" | "daily". */
  cron?: string | null;
};

export type ReportFilters = {
  dispositions?: string[];
  dateFrom?: string | null;
  dateTo?: string | null;
};

export const campaignReportDefinitionsTable = pgTable("campaign_report_definitions", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  campaignId: integer("campaign_id").notNull().references(() => campaignsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  scope: text("scope").notNull().default("campaign"), // campaign | batch
  blocks: jsonb("blocks").$type<ReportBlock[]>().notNull().default([]),
  filters: jsonb("filters").$type<ReportFilters>().notNull().default({}),
  email: jsonb("email").$type<ReportEmailConfig>().notNull().default({
    enabled: false,
    recipients: [],
    trigger: "manual",
    cron: null,
  }),
  /** When true, used as the default report for batch_complete emails. */
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("campaign_report_defs_campaign_idx").on(t.campaignId),
  index("campaign_report_defs_user_idx").on(t.userId),
]);

export type CampaignReportDefinition = typeof campaignReportDefinitionsTable.$inferSelect;
export type InsertCampaignReportDefinition = typeof campaignReportDefinitionsTable.$inferInsert;
