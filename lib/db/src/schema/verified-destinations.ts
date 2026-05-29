import { pgTable, text, serial, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Tracks phone numbers a user has OTP-verified as call destinations.
 * Required for outbound calls when the user has no KYC — they must verify
 * each destination number before it can be called via managed platform numbers.
 * Verifications expire after 30 days.
 */
export const verifiedPhoneDestinationsTable = pgTable(
  "verified_phone_destinations",
  {
    id:          serial("id").primaryKey(),
    userId:      text("user_id").notNull().references(() => usersTable.clerkId, { onDelete: "cascade" }),
    phoneNumber: text("phone_number").notNull(),
    verifiedAt:  timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt:   timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("vpd_user_phone_idx").on(t.userId, t.phoneNumber)],
);

export type VerifiedPhoneDestination = typeof verifiedPhoneDestinationsTable.$inferSelect;
