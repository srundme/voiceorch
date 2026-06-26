import { pgTable, text, serial, timestamp, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  clerkId: text("clerk_id").notNull().unique(),
  email: text("email"),
  name: text("name"),
  walletBalanceCents: integer("wallet_balance_cents").notNull().default(0),
  freeCreditsGranted: boolean("free_credits_granted").notNull().default(false),
  autoPayEnabled: boolean("auto_pay_enabled").notNull().default(false),
  autoPayThresholdCents: integer("auto_pay_threshold_cents").notNull().default(100),
  autoPayAmountCents: integer("auto_pay_amount_cents").notNull().default(1000),
  razorpayCustomerId: text("razorpay_customer_id"),
  razorpayTokenId: text("razorpay_token_id"),
  passwordHash: text("password_hash"),
  apiKey: text("api_key").unique(),
  orgKey: text("org_key").unique(),
  concurrentLimit: integer("concurrent_limit").notNull().default(15),
  onboardingCompleted: boolean("onboarding_completed").notNull().default(false),
  onboardingData: jsonb("onboarding_data"),
  preferences: jsonb("preferences").$type<{ theme?: "light" | "dark" | "system" }>(),
  status: text("status").notNull().default("active"),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  suspendedReason: text("suspended_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const walletTransactionsTable = pgTable("wallet_transactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  amountCents: integer("amount_cents").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull().default("completed"),
  razorpayOrderId: text("razorpay_order_id"),
  razorpayPaymentId: text("razorpay_payment_id").unique(),
  callId: integer("call_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
export type WalletTransaction = typeof walletTransactionsTable.$inferSelect;
