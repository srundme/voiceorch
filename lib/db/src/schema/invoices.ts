import { pgTable, serial, integer, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * GST tax invoices issued for every paid purchase (wallet top-up, phone number,
 * concurrent slot). One row per taxable supply. Amounts are stored in paise.
 *
 * `invoiceNumber` is a human-facing, consecutive series (e.g. "SS/2026-27/00042")
 * derived from the row id so it stays unique and monotonic per GST rules.
 */
export const invoicesTable = pgTable("invoices", {
  id: serial("id").primaryKey(),
  invoiceNumber: text("invoice_number").notNull().unique(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  // wallet_topup | phone_number | concurrent_slot
  type: text("type").notNull(),
  description: text("description").notNull(),
  hsnSac: text("hsn_sac"),

  // Taxable value + tax (paise). CGST+SGST for intra-state, IGST for inter-state.
  baseCents: integer("base_cents").notNull(),
  cgstCents: integer("cgst_cents").notNull().default(0),
  sgstCents: integer("sgst_cents").notNull().default(0),
  igstCents: integer("igst_cents").notNull().default(0),
  gstCents: integer("gst_cents").notNull(),
  totalCents: integer("total_cents").notNull(),
  gstRateBps: integer("gst_rate_bps").notNull().default(1800), // 1800 = 18.00%
  currency: text("currency").notNull().default("INR"),

  // Seller/buyer snapshot at issue time (so historical invoices stay stable).
  sellerGstin: text("seller_gstin"),
  buyerName: text("buyer_name"),
  buyerEmail: text("buyer_email"),
  buyerGstin: text("buyer_gstin"),
  placeOfSupply: text("place_of_supply"),

  razorpayOrderId: text("razorpay_order_id"),
  razorpayPaymentId: text("razorpay_payment_id").unique(),

  status: text("status").notNull().default("issued"),
  emailedAt: timestamp("emailed_at", { withTimezone: true }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Invoice = typeof invoicesTable.$inferSelect;
export type InsertInvoice = typeof invoicesTable.$inferInsert;
