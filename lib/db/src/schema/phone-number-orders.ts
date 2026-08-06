import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { phoneNumbersTable } from "./phone-numbers";

// Payment-gated phone-number purchase orders. A number is only provisioned
// AFTER a real Razorpay payment is verified — see routes/phone-numbers.ts
// (purchase/initiate creates the row + Razorpay order, purchase/confirm
// verifies the signature and provisions the number). Renewal charges are
// billed separately from the user's wallet balance (see services/phone-renewal.ts)
// and do NOT create rows here.
export const phoneNumberOrdersTable = pgTable("phone_number_orders", {
  id:             serial("id").primaryKey(),
  userId:         text("user_id").notNull().references(() => usersTable.clerkId, { onDelete: "cascade" }),
  number:         text("number").notNull(),
  countryCode:    text("country_code").notNull(),
  region:         text("region"),
  numberType:     text("number_type").notNull().default("local"),
  amountCents:    integer("amount_cents").notNull(),
  /** Chosen at checkout: 'autopay' | 'wallet' — copied onto phone_numbers on confirm. */
  renewalMode:    text("renewal_mode").notNull().default("wallet"),
  // pending -> processing -> completed | failed | cancelled
  status:         text("status").notNull().default("pending"),
  razorpayOrderId:   text("razorpay_order_id").unique(),
  razorpayPaymentId: text("razorpay_payment_id").unique(),
  phoneNumberId:  integer("phone_number_id").references(() => phoneNumbersTable.id, { onDelete: "set null" }),
  failureReason:  text("failure_reason"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type PhoneNumberOrder = typeof phoneNumberOrdersTable.$inferSelect;
export type InsertPhoneNumberOrder = typeof phoneNumberOrdersTable.$inferInsert;
