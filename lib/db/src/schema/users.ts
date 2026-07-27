import { pgTable, text, serial, timestamp, integer, boolean, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { partnersTable } from "./partners";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  clerkId: text("clerk_id").notNull().unique(),
  email: text("email"),
  name: text("name"),
  walletBalanceCents: integer("wallet_balance_cents").notNull().default(0),
  freeCreditsGranted: boolean("free_credits_granted").notNull().default(false),
  autoPayEnabled: boolean("auto_pay_enabled").notNull().default(false),
  autoPayThresholdCents: integer("auto_pay_threshold_cents").notNull().default(10000), // ₹100
  autoPayAmountCents: integer("auto_pay_amount_cents").notNull().default(50000), // ₹500
  razorpayCustomerId: text("razorpay_customer_id"),
  razorpayTokenId: text("razorpay_token_id"),
  passwordHash: text("password_hash"),
  apiKey: text("api_key").unique(),
  orgKey: text("org_key").unique(),
  concurrentLimit: integer("concurrent_limit").notNull().default(10),
  onboardingCompleted: boolean("onboarding_completed").notNull().default(false),
  onboardingData: jsonb("onboarding_data"),
  preferences: jsonb("preferences").$type<{ theme?: "light" | "dark" | "system" }>(),
  status: text("status").notNull().default("active"),
  // Internal / QA accounts we create for testing. Excluded from real-user
  // analytics by default. Set manually from the admin Users page (or auto-set
  // on signup when INTERNAL_EMAIL_PATTERNS matches).
  isTest: boolean("is_test").notNull().default(false),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  suspendedReason: text("suspended_reason"),
  // Partner (reseller) linkage — set when this user is a client onboarded by a partner.
  partnerId: integer("partner_id").references(() => partnersTable.id, { onDelete: "set null" }),
  /** Per-minute rate (paise) this client is billed at, set by their partner; null → partner default. */
  partnerRateCentsPerMin: integer("partner_rate_cents_per_min"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("users_partner_id_idx").on(t.partnerId),
]);

export const walletTransactionsTable = pgTable("wallet_transactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  amountCents: integer("amount_cents").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull().default("completed"),
  razorpayOrderId: text("razorpay_order_id").unique(),
  razorpayPaymentId: text("razorpay_payment_id").unique(),
  callId: integer("call_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Idempotency backstop (migration 0077): at most ONE partner_earning ledger
  // row per call, so racing end-of-call paths can never double-credit a partner.
  uniqueIndex("wallet_tx_partner_earning_call_uniq")
    .on(t.callId)
    .where(sql`type = 'partner_earning' and call_id is not null`),
]);

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
export type WalletTransaction = typeof walletTransactionsTable.$inferSelect;
