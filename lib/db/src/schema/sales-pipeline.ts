import { sql } from "drizzle-orm";
import { pgTable, serial, integer, text, timestamp, jsonb, boolean, uniqueIndex, index } from "drizzle-orm/pg-core";

export const salesCompaniesTable = pgTable("sales_companies", {
  id: serial("id").primaryKey(),
  isDemo: boolean("is_demo").notNull().default(false),
  name: text("name").notNull(),
  nameNormalized: text("name_normalized").notNull(),
  domainNormalized: text("domain_normalized"),
  website: text("website"),
  sector: text("sector"),
  city: text("city"),
  area: text("area"),
  address: text("address"),
  mapLink: text("map_link"),
  ownerId: integer("owner_id"),
  source: text("source"),
  sourceCampaign: text("source_campaign"),
  originalSource: text("original_source"),
  originalSourceCampaign: text("original_source_campaign"),
  originalEnquiryAt: timestamp("original_enquiry_at", { withTimezone: true }),
  contactPermissionEvidence: text("contact_permission_evidence"),
  priority: text("priority").notNull().default("medium"),
  callingVolume: integer("calling_volume"),
  currentCallingTeam: text("current_calling_team"),
  painPoint: text("pain_point"),
  budgetFit: text("budget_fit").notNull().default("unknown"),
  decisionMaker: text("decision_maker"),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
  nextAction: text("next_action"),
  nextActionDueAt: timestamp("next_action_due_at", { withTimezone: true }),
  firstPaidAt: timestamp("first_paid_at", { withTimezone: true }),
  duplicateOfCompanyId: integer("duplicate_of_company_id"),
  needsDedupeReview: boolean("needs_dedupe_review").notNull().default(false),
  internalNotes: text("internal_notes"),
  customerNotes: text("customer_notes"),
  isInbound: boolean("is_inbound").notNull().default(false),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("sales_companies_domain_uq").on(t.domainNormalized).where(sql`${t.domainNormalized} IS NOT NULL AND ${t.isDemo} = false`),
  index("sales_companies_name_norm_idx").on(t.nameNormalized),
  index("sales_companies_owner_idx").on(t.ownerId),
]);

export const salesContactsTable = pgTable("sales_contacts", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => salesCompaniesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull().default(""),
  role: text("role"),
  phone: text("phone"),
  phoneNormalized: text("phone_normalized"),
  email: text("email"),
  emailNormalized: text("email_normalized"),
  preferredChannel: text("preferred_channel"),
  isDecisionMaker: boolean("is_decision_maker").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("sales_contacts_company_idx").on(t.companyId),
  index("sales_contacts_phone_idx").on(t.phoneNormalized),
  index("sales_contacts_email_idx").on(t.emailNormalized),
]);

export const salesOpportunitiesTable = pgTable("sales_opportunities", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => salesCompaniesTable.id, { onDelete: "cascade" }),
  stage: text("stage").notNull().default("Identified"),
  stageChangedAt: timestamp("stage_changed_at", { withTimezone: true }).notNull().defaultNow(),
  ownerId: integer("owner_id"),
  qualification: jsonb("qualification"),
  demoBuyerContactId: integer("demo_buyer_contact_id"),
  demoAt: timestamp("demo_at", { withTimezone: true }),
  pilotReadiness: jsonb("pilot_readiness"),
  review: jsonb("review"),
  terms: jsonb("terms"),
  laterReason: text("later_reason"),
  laterActionAt: timestamp("later_action_at", { withTimezone: true }),
  lostReason: text("lost_reason"),
  bypassReason: text("bypass_reason"),
  bypassBy: integer("bypass_by"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("sales_opportunities_open_uq").on(t.companyId).where(sql`${t.stage} NOT IN ('Lost', 'Live')`),
  index("sales_opportunities_stage_idx").on(t.stage),
]);

export const salesStageHistoryTable = pgTable("sales_stage_history", {
  id: serial("id").primaryKey(),
  opportunityId: integer("opportunity_id").notNull().references(() => salesOpportunitiesTable.id, { onDelete: "cascade" }),
  fromStage: text("from_stage"),
  toStage: text("to_stage").notNull(),
  changedBy: integer("changed_by"),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  evidence: jsonb("evidence"),
  bypass: boolean("bypass").notNull().default(false),
  note: text("note"),
}, (t) => [index("sales_stage_history_opp_idx").on(t.opportunityId)]);

export const salesActivitiesTable = pgTable("sales_activities", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => salesCompaniesTable.id, { onDelete: "cascade" }),
  opportunityId: integer("opportunity_id"),
  contactId: integer("contact_id"),
  ownerId: integer("owner_id"),
  type: text("type").notNull(),
  status: text("status").notNull().default("completed"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  flagVisit: boolean("flag_visit").notNull().default(false),
  flagFirstVisit: boolean("flag_first_visit").notNull().default(false),
  flagBuyerConversation: boolean("flag_buyer_conversation").notNull().default(false),
  flagDemo: boolean("flag_demo").notNull().default(false),
  flagPilotStarted: boolean("flag_pilot_started").notNull().default(false),
  outcome: text("outcome"),
  notes: text("notes"),
  nextAction: text("next_action"),
  nextActionDueAt: timestamp("next_action_due_at", { withTimezone: true }),
  isDemo: boolean("is_demo").notNull().default(false),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("sales_activities_company_idx").on(t.companyId),
  index("sales_activities_occurred_idx").on(t.occurredAt),
  index("sales_activities_scheduled_idx").on(t.scheduledAt),
]);

export const salesTasksTable = pgTable("sales_tasks", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => salesCompaniesTable.id, { onDelete: "cascade" }),
  opportunityId: integer("opportunity_id"),
  pilotId: integer("pilot_id"),
  subscriptionId: integer("subscription_id"),
  ownerId: integer("owner_id"),
  title: text("title").notNull(),
  kind: text("kind").notNull().default("follow_up"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  status: text("status").notNull().default("open"),
  outcome: text("outcome"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  completedBy: integer("completed_by"),
  dedupeKey: text("dedupe_key"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("sales_tasks_dedupe_key_uq").on(t.dedupeKey),
  index("sales_tasks_owner_status_idx").on(t.ownerId, t.status),
  index("sales_tasks_company_idx").on(t.companyId),
]);

/** Every enquiry for a company: the original source plus repeat webhook/import/manual enquiries. */
export const salesTouchpointsTable = pgTable("sales_touchpoints", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => salesCompaniesTable.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  source: text("source"),
  campaign: text("campaign"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  eventId: text("event_id"),
  permissionEvidence: text("permission_evidence"),
  details: jsonb("details"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("sales_touchpoints_company_idx").on(t.companyId),
  uniqueIndex("sales_touchpoints_event_id_uq").on(t.eventId),
]);

export type SalesCompany = typeof salesCompaniesTable.$inferSelect;
export type SalesTouchpoint = typeof salesTouchpointsTable.$inferSelect;
export type SalesContact = typeof salesContactsTable.$inferSelect;
export type SalesOpportunity = typeof salesOpportunitiesTable.$inferSelect;
export type SalesStageHistory = typeof salesStageHistoryTable.$inferSelect;
export type SalesActivity = typeof salesActivitiesTable.$inferSelect;
export type SalesTask = typeof salesTasksTable.$inferSelect;
