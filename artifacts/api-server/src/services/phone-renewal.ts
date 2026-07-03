/**
 * phone-renewal.ts — Monthly (30-day, anniversary-based) auto-renewal charge
 * for purchased phone numbers.
 *
 * Renewal is charged FROM THE WALLET BALANCE, not via a new Razorpay
 * checkout — this matches the "monthly deduction" billing model (the $10
 * first purchase is the only step that requires an actual completed
 * payment). If the wallet balance can't cover the renewal, we attempt a
 * best-effort auto top-up via the user's saved Razorpay mandate (if any)
 * before retrying the debit once. On continued failure we leave
 * `nextRenewalAt` unchanged so the daily sweep retries the same charge the
 * next day — the number is NOT auto-released; deletion is user-initiated
 * only, at which point `status` flips to "released" and the query below
 * naturally excludes it, stopping all future renewal charges for that number.
 */
import { and, eq, lte, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { phoneNumbersTable, usersTable, walletTransactionsTable } from "@workspace/db/schema";
import { logger } from "../lib/logger.js";
import { triggerAutoDebit } from "./wallet-auto-debit.js";

let started = false;

const RENEWAL_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Attempts to renew a single phone number: debit the wallet, or if the
 * balance is insufficient, try an auto top-up via the saved mandate then
 * retry once. Returns true if the renewal was charged, false otherwise
 * (row is left untouched so it's retried on the next sweep).
 */
async function renewOne(row: typeof phoneNumbersTable.$inferSelect): Promise<boolean> {
  const renewalCents = row.renewalRateCents;
  if (!renewalCents || renewalCents <= 0) return true; // nothing to charge; just advance below

  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, row.userId));
  if (!user) {
    logger.warn({ phoneNumberId: row.id, userId: row.userId }, "Phone renewal: user not found, skipping");
    return false;
  }

  // Atomic conditional debit — only succeeds if balance currently covers the charge.
  const tryDebit = async (): Promise<boolean> => {
    const [updated] = await db
      .update(usersTable)
      .set({ walletBalanceCents: sql`${usersTable.walletBalanceCents} - ${renewalCents}` })
      .where(and(eq(usersTable.id, user.id), sql`${usersTable.walletBalanceCents} >= ${renewalCents}`))
      .returning({ id: usersTable.id });
    return !!updated;
  };

  let debited = await tryDebit();

  if (!debited && user.autoPayEnabled && user.razorpayCustomerId && user.razorpayTokenId) {
    logger.info({ userId: user.id, phoneNumberId: row.id }, "Phone renewal: balance insufficient, attempting auto top-up");
    try {
      await triggerAutoDebit(user.id, row.userId, user.autoPayAmountCents);
    } catch (err) {
      logger.warn({ err, userId: user.id }, "Phone renewal: auto top-up threw");
    }
    debited = await tryDebit();
  }

  if (!debited) {
    logger.warn(
      { userId: user.id, phoneNumberId: row.id, number: row.number, renewalCents },
      "Phone renewal: insufficient balance, will retry on next sweep",
    );
    return false;
  }

  await db.insert(walletTransactionsTable).values({
    userId:      user.id,
    type:        "debit",
    amountCents: -renewalCents,
    description: `Phone number ${row.number} monthly renewal ($${(renewalCents / 100).toFixed(2)})`,
    status:      "completed",
  });

  const now = new Date();
  await db
    .update(phoneNumbersTable)
    .set({ lastRenewalAt: now, nextRenewalAt: new Date(now.getTime() + RENEWAL_INTERVAL_MS) })
    .where(eq(phoneNumbersTable.id, row.id));

  logger.info({ userId: user.id, phoneNumberId: row.id, number: row.number, renewalCents }, "Phone number renewed");
  return true;
}

async function sweepDuePhoneRenewals(): Promise<void> {
  const now = new Date();
  const due = await db
    .select()
    .from(phoneNumbersTable)
    .where(and(eq(phoneNumbersTable.status, "active"), lte(phoneNumbersTable.nextRenewalAt, now)));

  if (due.length === 0) return;

  logger.info({ count: due.length }, "Phone renewal sweep: processing due renewals");
  for (const row of due) {
    try {
      await renewOne(row);
    } catch (err) {
      logger.error({ err, phoneNumberId: row.id }, "Phone renewal: unexpected error processing renewal");
    }
  }
}

/**
 * Starts a daily sweep that charges the $8 monthly renewal fee for every
 * active phone number whose 30-day anniversary has arrived. Deleting a
 * number (status → "released") automatically excludes it from this query,
 * so no separate "stop renewal" step is needed.
 */
export function startPhoneRenewalSweep(): void {
  if (started) return;
  started = true;

  const tick = (): void => {
    void sweepDuePhoneRenewals().catch((err) => {
      logger.warn({ err }, "Phone renewal sweep tick failed");
    });
  };

  setTimeout(tick, 90_000);
  setInterval(tick, 24 * 60 * 60 * 1000);

  logger.info("Phone number renewal sweep started");
}
