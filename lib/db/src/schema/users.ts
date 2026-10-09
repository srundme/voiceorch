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
  concurrentLimit: integer("concurrent_limit").notNull().default(1),
  onboardingCompleted: boolean("onboarding_completed").notNull().default(false),
  onboardingData: jsonb("onboarding_data"),
  preferences: jsonb("preferences").$type<{ theme?: "light" | "dark" | "system"; agentLimit?: number }>(),
  status: text("status").notNull().default("active"),
  // Internal / QA accounts we create for testing. Excluded from real-user
  // analytics by default. Set manually from the admin Users page (or auto-set
  // on signup when INTERNAL_EMAIL_PATTERNS matches).
  isTest: boolean("is_test").notNull().default(false),
  /** Admin grant: skip managed-outbound daily trial cap for this account. */
  unlimitedManagedTrial: boolean("unlimited_managed_trial").notNull().default(false),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  suspendedReason: text("suspended_reason"),
  // Partner (reseller) linkage — set when this user is a client onboarded by a partner.
  partnerId: integer("partner_id").references(() => partnersTable.id, { onDelete: "set null" }),
  /** Code entered or clicked at signup (e.g. "SANJAY"). */
  referredByCode: text("referred_by_code"),
  /** Original signup source attribution (e.g. "referral:SANJAY", "linkedin", "google"). */
  signupSource: text("signup_source"),
  /** Per-minute rate (paise) this client is billed at, set by their partner; null → partner default. */
  partnerRateCentsPerMin: integer("partner_rate_cents_per_min"),
  /**
   * When true, this managed client may create/edit/save agents in their own
   * dashboard. Default false: partner-only agent management.
   */
  /** Legacy flag — always treated as true for managed clients (full workspace). */
  partnerAllowAgentEdit: boolean("partner_allow_agent_edit").notNull().default(true),
  /** Failed email/password attempts on the partner portal (managed clients only). */
  portalLoginFailedAttempts: integer("portal_login_failed_attempts").notNull().default(0),
  /** When set, managed-client portal login is locked until admin/partner unlocks. */
  portalLoginLockedAt: timestamp("portal_login_locked_at", { withTimezone: true }),
  portalLoginLockedReason: text("portal_login_locked_reason"),
  /**
   * Granular section & action permissions set by partner for managed clients.
   * e.g. { navVisibility: { agents: true, campaigns: true, phoneNumbers: false }, mode: "full" | "read_only" }
   */
  partnerPermissions: jsonb("partner_permissions").$type<{
    navVisibility?: {
      agents?: boolean;
      knowledge?: boolean;
      squads?: boolean;
      phoneNumbers?: boolean;
      campaigns?: boolean;
      flows?: boolean;
      connections?: boolean;
      bookings?: boolean;
      callLogs?: boolean;
      analytics?: boolean;
      developers?: boolean;
      settings?: boolean;
      billing?: boolean;
    };
    mode?: "full" | "read_only";
  }>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("users_partner_id_idx").on(t.partnerId),
  index("users_referred_by_code_idx").on(t.referredByCode),
  index("users_portal_login_locked_at_idx").on(t.portalLoginLockedAt),
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
