/**
 * phone-renewal.ts — Monthly (30-day, anniversary-based) auto-renewal charge
 * for purchased phone numbers.
 *
 * Renewal is charged FROM THE WALLET BALANCE. Funding mode:
 * - renewalMode === 'autopay': if balance is short, top up via Razorpay mandate
 *   sized to cover the shortfall, then debit.
 * - renewalMode === 'wallet': wallet only (no mandate top-up).
 *
 * On failure: set a 7-day grace deadline (once). While in grace the daily sweep
 * retries. After grace expires without payment, the number is auto-released.
 */
import { and, eq, lte, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { phoneNumbersTable, usersTable, walletTransactionsTable } from "@workspace/db/schema";
import { logger } from "../lib/logger.js";
import { formatInr, phonePurchaseBasePaise, withGstPaise } from "../lib/money-inr.js";
import { triggerAutoDebit } from "./wallet-auto-debit.js";
import { releasePhoneNumberRecord } from "./phone-number-release.js";

let started = false;

const RENEWAL_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const GRACE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days after first failed renewal

function renewalChargePaise(row: typeof phoneNumbersTable.$inferSelect): number {
  if (!row.renewalRateCents || row.renewalRateCents <= 0) return 0;
  // Voice DIDs: renewal = SAME price as first purchase (tiered monthly + ₹100 + GST).
  // WhatsApp numbers keep their stored flat renewal rate.
  return row.numberType === "whatsapp"
    ? row.renewalRateCents
    : withGstPaise(phonePurchaseBasePaise(row.number));
}

/**
 * Attempts to renew a single phone number. Returns true if charged (or free).
 * On unpaid failure past grace, releases the number and returns false.
 */
async function renewOne(row: typeof phoneNumbersTable.$inferSelect): Promise<boolean> {
  const renewalCents = renewalChargePaise(row);
  if (renewalCents <= 0) {
    const now = new Date();
    await db
      .update(phoneNumbersTable)
      .set({
        lastRenewalAt: now,
        nextRenewalAt: new Date(now.getTime() + RENEWAL_INTERVAL_MS),
        renewalGraceUntil: null,
      })
      .where(eq(phoneNumbersTable.id, row.id));
    return true;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, row.userId));
  if (!user) {
    logger.warn({ phoneNumberId: row.id, userId: row.userId }, "Phone renewal: user not found, skipping");
    return false;
  }

  const tryDebit = async (): Promise<boolean> => {
    const [updated] = await db
      .update(usersTable)
      .set({ walletBalanceCents: sql`${usersTable.walletBalanceCents} - ${renewalCents}` })
      .where(and(eq(usersTable.id, user.id), sql`${usersTable.walletBalanceCents} >= ${renewalCents}`))
      .returning({ id: usersTable.id });
    return !!updated;
  };

  let debited = await tryDebit();

  const useAutopay = row.renewalMode === "autopay";
  if (
    !debited &&
    useAutopay &&
    user.autoPayEnabled &&
    user.razorpayCustomerId &&
    user.razorpayTokenId
  ) {
    // Wallet credit is base (pre-GST). Size top-up so credited base covers the
    // GST-inclusive renewal shortfall (and honour the user's configured amount).
    const [fresh] = await db
      .select({ walletBalanceCents: usersTable.walletBalanceCents })
      .from(usersTable)
      .where(eq(usersTable.id, user.id));
    const balance = fresh?.walletBalanceCents ?? 0;
    const shortfall = Math.max(0, renewalCents - balance);
    const topUpBase = Math.max(user.autoPayAmountCents ?? 0, shortfall);
    if (topUpBase > 0) {
      logger.info(
        { userId: user.id, phoneNumberId: row.id, topUpBase, shortfall },
        "Phone renewal: balance insufficient, attempting autopay top-up",
      );
      try {
        await triggerAutoDebit(user.id, row.userId, topUpBase);
      } catch (err) {
        logger.warn({ err, userId: user.id }, "Phone renewal: auto top-up threw");
      }
      debited = await tryDebit();
    }
  }

  if (!debited) {
    const now = new Date();
    if (!row.renewalGraceUntil) {
      const graceUntil = new Date(now.getTime() + GRACE_MS);
      await db
        .update(phoneNumbersTable)
        .set({ renewalGraceUntil: graceUntil })
        .where(eq(phoneNumbersTable.id, row.id));
      logger.warn(
        {
          userId: user.id,
          phoneNumberId: row.id,
          number: row.number,
          renewalCents,
          renewalMode: row.renewalMode,
          graceUntil,
        },
        "Phone renewal: unpaid — grace period started",
      );
      return false;
    }

    if (row.renewalGraceUntil.getTime() <= now.getTime()) {
      logger.warn(
        { userId: user.id, phoneNumberId: row.id, number: row.number, renewalCents },
        "Phone renewal: unpaid past grace — releasing number",
      );
      await releasePhoneNumberRecord(row, { reason: "renewal_unpaid" });
      return false;
    }

    logger.warn(
      {
        userId: user.id,
        phoneNumberId: row.id,
        number: row.number,
        renewalCents,
        graceUntil: row.renewalGraceUntil,
      },
      "Phone renewal: still in grace, will retry on next sweep",
    );
    return false;
  }

  await db.insert(walletTransactionsTable).values({
    userId: user.id,
    type: "debit",
    amountCents: -renewalCents,
    description: `Phone number ${row.number} monthly renewal (${formatInr(renewalCents)} incl. GST)`,
    status: "completed",
  });

  const now = new Date();
  await db
    .update(phoneNumbersTable)
    .set({
      lastRenewalAt: now,
      nextRenewalAt: new Date(now.getTime() + RENEWAL_INTERVAL_MS),
      renewalGraceUntil: null,
    })
    .where(eq(phoneNumbersTable.id, row.id));

  logger.info(
    { userId: user.id, phoneNumberId: row.id, number: row.number, renewalCents },
    "Phone number renewed",
  );
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
 * Starts a daily sweep that charges renewals for every active phone number
 * whose 30-day anniversary has arrived. Unpaid numbers past grace are released.
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
