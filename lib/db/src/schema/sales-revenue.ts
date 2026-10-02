import { pgTable, serial, integer, text, timestamp, jsonb, boolean, date, index } from "drizzle-orm/pg-core";
import { salesCompaniesTable } from "./sales-pipeline";

export const salesProposalsTable = pgTable("sales_proposals", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => salesCompaniesTable.id, { onDelete: "cascade" }),
  opportunityId: integer("opportunity_id"),
  monthlyFeePaise: integer("monthly_fee_paise").notNull(),
  setupFeePaise: integer("setup_fee_paise").notNull().default(0),
  includedMinutes: integer("included_minutes").notNull().default(0),
  scope: text("scope"),
  gstRateBps: integer("gst_rate_bps").notNull().default(1800),
  status: text("status").notNull().default("draft"),
  termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
  termsAcceptedBy: text("terms_accepted_by"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  declinedAt: timestamp("declined_at", { withTimezone: true }),
  declineReason: text("decline_reason"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("sales_proposals_company_idx").on(t.companyId)]);

export const salesSubscriptionsTable = pgTable("sales_subscriptions", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => salesCompaniesTable.id, { onDelete: "cascade" }),
  proposalId: integer("proposal_id"),
  monthlyFeePaise: integer("monthly_fee_paise").notNull(),
  includedMinutes: integer("included_minutes").notNull().default(0),
  customerOwnerId: integer("customer_owner_id"),
  status: text("status").notNull().default("active"),
  startDate: date("start_date", { mode: "string" }),
  liveAt: timestamp("live_at", { withTimezone: true }),
  renewalDate: date("renewal_date", { mode: "string" }),
  onboardingChecks: jsonb("onboarding_checks"),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelReason: text("cancel_reason"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("sales_subscriptions_company_idx").on(t.companyId)]);

export const salesPaymentsTable = pgTable("sales_payments", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => salesCompaniesTable.id, { onDelete: "cascade" }),
  proposalId: integer("proposal_id"),
  subscriptionId: integer("subscription_id"),
  kind: text("kind").notNull(),
  feePaise: integer("fee_paise").notNull(),
  taxPaise: integer("tax_paise").notNull().default(0),
  reference: text("reference"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("recorded"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  verifiedBy: integer("verified_by"),
  refundedPaise: integer("refunded_paise").notNull().default(0),
  notes: text("notes"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("sales_payments_company_idx").on(t.companyId)]);

export const salesPaymentAdjustmentsTable = pgTable("sales_payment_adjustments", {
  id: serial("id").primaryKey(),
  paymentId: integer("payment_id").notNull().references(() => salesPaymentsTable.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  feeDeltaPaise: integer("fee_delta_paise").notNull().default(0),
  taxDeltaPaise: integer("tax_delta_paise").notNull().default(0),
  reason: text("reason").notNull(),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("sales_payment_adjustments_payment_idx").on(t.paymentId)]);

export const salesExpensesTable = pgTable("sales_expenses", {
  id: serial("id").primaryKey(),
  date: date("date", { mode: "string" }).notNull(),
  category: text("category").notNull(),
  isAcquisition: boolean("is_acquisition").notNull().default(false),
  source: text("source"),
  sourceCampaign: text("source_campaign"),
  amountPaise: integer("amount_paise").notNull(),
  description: text("description"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SalesProposal = typeof salesProposalsTable.$inferSelect;
export type SalesSubscription = typeof salesSubscriptionsTable.$inferSelect;
export type SalesPayment = typeof salesPaymentsTable.$inferSelect;
export type SalesPaymentAdjustment = typeof salesPaymentAdjustmentsTable.$inferSelect;
export type SalesExpense = typeof salesExpensesTable.$inferSelect;
