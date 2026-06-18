/**
 * wallet-auto-debit.ts — Server-initiated recurring charge via Razorpay token.
 *
 * Called by calls.ts when a user's balance drops below their auto-pay threshold
 * and they have a stored Razorpay mandate token.
 */
import Razorpay from "razorpay";
import { db } from "@workspace/db";
import { usersTable, walletTransactionsTable, platformSettingsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";

function getRazorpay() {
  return new Razorpay({
    key_id:    process.env.RAZORPAY_KEY_ID!,
    key_secret: process.env.RAZORPAY_KEY_SECRET!,
  });
}

let _inrRateCache: { rate: number; expiresAt: number } | null = null;
async function getUsdToInrRate(): Promise<number> {
  if (_inrRateCache && Date.now() < _inrRateCache.expiresAt) return _inrRateCache.rate;
  const [row] = await db
    .select({ value: platformSettingsTable.value })
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.key, "usd_to_inr_rate"));
  const rate = row ? parseFloat(row.value) || 85 : 85;
  _inrRateCache = { rate, expiresAt: Date.now() + 5 * 60 * 1000 };
  return rate;
}

/**
 * Poll Razorpay for a payment's status up to maxAttempts times.
 * Returns true if the payment is captured/authorized, false otherwise.
 */
async function pollPaymentStatus(
  razorpay: Razorpay,
  paymentId: string,
  maxAttempts = 6,
  delayMs = 2000,
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const payment = await (razorpay.payments as any).fetch(paymentId);
      if (payment.status === "captured" || payment.status === "authorized") return true;
      if (payment.status === "failed") return false;
    } catch {
      // ignore transient fetch errors
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

/**
 * Trigger an automatic wallet top-up using the user's stored Razorpay mandate.
 * Fire-and-forget — never throws; logs errors internally.
 */
export async function triggerAutoDebit(
  userId: number,
  clerkId: string,
  amountCents: number,
): Promise<void> {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) return;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user?.razorpayCustomerId || !user?.razorpayTokenId) {
    logger.info({ userId }, "Auto-debit skipped — no Razorpay mandate token");
    return;
  }

  const usdToInr  = await getUsdToInrRate();
  const amountPaise = Math.round(amountCents * usdToInr);
  const razorpay  = getRazorpay();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let order: any;
  try {
    order = await razorpay.orders.create({
      amount:          amountPaise,
      currency:        "INR",
      receipt:         `autopay_${userId}_${Date.now()}`,
      notes:           { userId: String(userId), clerkId, type: "auto_topup" },
      payment_capture: 1,
    } as any);
  } catch (err) {
    logger.error({ err, userId }, "Auto-debit: failed to create Razorpay order");
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let payment: any;
  try {
    payment = await (razorpay.payments as any).createRecurringPayment({
      email:            user.email ?? `user_${userId}@snapserve.ai`,
      contact:          "9999999999",
      amount:           amountPaise,
      currency:         "INR",
      order_id:         order.id,
      customer_id:      user.razorpayCustomerId,
      token_id:         user.razorpayTokenId,
      recurring:        1,
      description:      `Auto top-up $${(amountCents / 100).toFixed(2)}`,
      notify:           { sms: false, email: true },
      reminder_enable:  false,
    });
  } catch (err) {
    logger.error({ err, userId, orderId: order.id }, "Auto-debit: createRecurringPayment failed");
    return;
  }

  const paymentId = payment?.razorpay_payment_id ?? payment?.id;
  if (!paymentId) {
    logger.warn({ userId, payment }, "Auto-debit: no payment_id in response");
    return;
  }

  const captured = await pollPaymentStatus(razorpay, paymentId);
  if (!captured) {
    logger.warn({ userId, paymentId }, "Auto-debit: payment not captured within timeout");
    return;
  }

  // Credit the wallet
  await db
    .update(usersTable)
    .set({ walletBalanceCents: user.walletBalanceCents + amountCents })
    .where(eq(usersTable.id, userId));

  await db.insert(walletTransactionsTable).values({
    userId,
    type:             "auto_topup",
    amountCents,
    description:      `Auto top-up $${(amountCents / 100).toFixed(2)}`,
    status:           "completed",
    razorpayOrderId:  order.id,
    razorpayPaymentId: paymentId,
  });

  logger.info({ userId, amountCents, paymentId }, "Auto-debit: wallet credited successfully");
}
