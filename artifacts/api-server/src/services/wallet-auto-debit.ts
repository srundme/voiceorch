/**
 * wallet-auto-debit.ts — Server-initiated recurring charge via Razorpay token.
 *
 * Called when a user's balance drops below their auto-pay threshold and they
 * have a stored Razorpay card mandate token. Charges INR (base + 18% GST);
 * credits the wallet with the base amount only.
 */
import Razorpay from "razorpay";
import { db } from "@workspace/db";
import { usersTable, walletTransactionsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { issueInvoice } from "./invoice.js";
import {
  CURRENCY_INR,
  GST_RATE,
  formatInr,
  gstPortionPaise,
  withGstPaise,
} from "../lib/money-inr.js";

function getRazorpay() {
  return new Razorpay({
    key_id:    process.env.RAZORPAY_KEY_ID!,
    key_secret: process.env.RAZORPAY_KEY_SECRET!,
  });
}

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
 * `amountCents` is the base wallet credit in paise (pre-GST).
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

  const basePaise = Math.round(amountCents);
  const gstPaise = gstPortionPaise(basePaise);
  const payablePaise = withGstPaise(basePaise);
  const razorpay = getRazorpay();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let order: any;
  try {
    order = await razorpay.orders.create({
      amount:          payablePaise,
      currency:        CURRENCY_INR,
      receipt:         `autopay_${userId}_${Date.now()}`,
      notes:           {
        userId: String(userId),
        clerkId,
        type: "auto_topup",
        basePaise: String(basePaise),
        gstPaise: String(gstPaise),
        gstRate: String(GST_RATE),
      },
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
      amount:           payablePaise,
      currency:         CURRENCY_INR,
      order_id:         order.id,
      customer_id:      user.razorpayCustomerId,
      token_id:         user.razorpayTokenId,
      recurring:        1,
      description:      `Auto top-up ${formatInr(basePaise)} + GST ${formatInr(gstPaise)}`,
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

  await db
    .update(usersTable)
    .set({ walletBalanceCents: user.walletBalanceCents + basePaise })
    .where(eq(usersTable.id, userId));

  await db.insert(walletTransactionsTable).values({
    userId,
    type:             "auto_topup",
    amountCents:      basePaise,
    description:      `Auto top-up ${formatInr(basePaise)} + GST ${formatInr(gstPaise)} (paid ${formatInr(payablePaise)})`,
    status:           "completed",
    razorpayOrderId:  order.id,
    razorpayPaymentId: paymentId,
  });

  // GST tax invoice cum receipt (base credit + 18% GST) with PDF attached.
  void issueInvoice({
    user: { id: user.id, name: user.name, email: user.email },
    type: "wallet_topup",
    description: "Wallet auto top-up — prepaid calling credit",
    hsnSac: "998413",
    amountCents: basePaise,
    gstInclusive: false,
    razorpayOrderId: order.id,
    razorpayPaymentId: paymentId,
  });

  logger.info({ userId, basePaise, payablePaise, paymentId }, "Auto-debit: wallet credited successfully");
}
