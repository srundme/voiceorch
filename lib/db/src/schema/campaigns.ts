import { pgTable, serial, integer, text, timestamp, json, boolean } from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";

export type CampaignFieldMappings = {
  phone: string;
  name?: string;
  email?: string;
  [extraField: string]: string | undefined;
};

export const campaignsTable = pgTable("campaigns", {
  id:                   serial("id").primaryKey(),
  userId:               text("user_id").notNull(),
  name:                 text("name").notNull(),
  description:          text("description"),
  agentId:              integer("agent_id").references(() => agentsTable.id, { onDelete: "set null" }),
  status:               text("status").notNull().default("draft"),
  webhookToken:         text("webhook_token").notNull().unique(),
  fieldMappings:        json("field_mappings").$type<CampaignFieldMappings>().notNull().default({ phone: "phone" }),
  fromNumber:           text("from_number"),
  callDelaySeconds:     integer("call_delay_seconds").notNull().default(5),
  maxAttempts:          integer("max_attempts").notNull().default(1),
  retryDelayMinutes:    integer("retry_delay_minutes").notNull().default(60),
  totalLeads:           integer("total_leads").notNull().default(0),
  calledLeads:          integer("called_leads").notNull().default(0),
  isActive:             boolean("is_active").notNull().default(false),
  createdAt:            timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:            timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const campaignBatchesTable = pgTable("campaign_batches", {
  id:               serial("id").primaryKey(),
  campaignId:       integer("campaign_id").references(() => campaignsTable.id, { onDelete: "cascade" }).notNull(),
  name:             text("name").notNull(),
  status:           text("status").notNull().default("draft"),
  scheduledStartAt: timestamp("scheduled_start_at", { withTimezone: true }),
  totalLeads:       integer("total_leads").notNull().default(0),
  calledLeads:      integer("called_leads").notNull().default(0),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const campaignLeadsTable = pgTable("campaign_leads", {
  id:               serial("id").primaryKey(),
  campaignId:       integer("campaign_id").references(() => campaignsTable.id, { onDelete: "cascade" }).notNull(),
  batchId:          integer("batch_id").references(() => campaignBatchesTable.id, { onDelete: "set null" }),
  phone:            text("phone").notNull(),
  name:             text("name"),
  email:            text("email"),
  leadData:         json("lead_data").$type<Record<string, string>>().notNull().default({}),
  callStatus:       text("call_status").notNull().default("pending"),
  disposition:      text("disposition"),
  callId:           integer("call_id"),
  callAttempts:     integer("call_attempts").notNull().default(0),
  lastAttemptAt:    timestamp("last_attempt_at", { withTimezone: true }),
  source:           text("source").notNull().default("webhook"),
  externalLeadId:   text("external_lead_id"),
  notes:            text("notes"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
