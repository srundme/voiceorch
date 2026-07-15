import { Router } from "express";
import crypto from "crypto";
import Razorpay from "razorpay";
import { db } from "@workspace/db";
import { usersTable, walletTransactionsTable } from "@workspace/db/schema";
import { eq, desc, sql, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";
import { logger } from "../lib/logger.js";
import { sendBrevoEmail } from "../services/brevo.js";
import { walletTopUpEmail } from "../services/email-templates.js";
import {
  CURRENCY_INR,
  GST_RATE,
  MIN_TOPUP_PAISE,
  formatInr,
  gstPortionPaise,
  withGstPaise,
} from "../lib/money-inr.js";

const router = Router();

function getRazorpay() {
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID!,
    key_secret: process.env.RAZORPAY_KEY_SECRET!,
  });
}

async function getDbUser(clerkId: string) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  return user ?? null;
}

function walletInfoPayload(user: typeof usersTable.$inferSelect) {
  return {
    balanceCents:          user.walletBalanceCents,
    balanceInr:            user.walletBalanceCents / 100,
    /** @deprecated use balanceInr — kept for older clients */
    balanceUsd:            user.walletBalanceCents / 100,
    currency:              CURRENCY_INR,
    freeCreditsGranted:    user.freeCreditsGranted,
    autoPayEnabled:        user.autoPayEnabled,
    autoPayThresholdCents: user.autoPayThresholdCents,
    autoPayAmountCents:    user.autoPayAmountCents,
    mandateActive:         !!(user.razorpayCustomerId && user.razorpayTokenId),
    gstRate:               GST_RATE,
  };
}

// GET /api/wallet
router.get("/wallet", requireAuth, async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const user = await getDbUser(clerkId);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(walletInfoPayload(user));
});

// POST /api/wallet/topup — create Razorpay INR order (base credit + 18% GST payable)
router.post("/wallet/topup", requireAuth, async (req, res) => {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    res.status(503).json({ error: "Payment gateway not configured" });
    return;
  }
  const clerkId = (req as any).clerkUserId as string;
  const { amountCents, setupMandate } = req.body as { amountCents: number; setupMandate?: boolean };
  // amountCents = wallet credit in paise (pre-GST)
  if (!amountCents || amountCents < MIN_TOPUP_PAISE) {
    res.status(400).json({ error: `Minimum top-up is ${formatInr(MIN_TOPUP_PAISE)}` });
    return;
  }
  const user = await getDbUser(clerkId);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const basePaise = Math.round(amountCents);
  const gstPaise = gstPortionPaise(basePaise);
  const payablePaise = withGstPaise(basePaise);
  const currency = CURRENCY_INR;

  const razorpay = getRazorpay();

  let customerId = user.razorpayCustomerId ?? null;
  if (!customerId) {
    try {
      const customer = await (razorpay.customers as any).create({
        name:  user.name  ?? user.email ?? "User",
        email: user.email ?? `user_${user.id}@snapserve.ai`,
        contact: "",
        fail_existing: 0,
      });
      customerId = customer.id as string;
      await db.update(usersTable)
        .set({ razorpayCustomerId: customerId })
        .where(eq(usersTable.id, user.id));
    } catch (err) {
      logger.warn({ err }, "Failed to create Razorpay customer — proceeding without mandate");
      customerId = null;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let order: any;
  try {
    const orderPayload: Record<string, unknown> = {
      amount:          payablePaise,
      currency,
      receipt:         `uid_${user.id}_${Date.now()}`,
      notes:           {
        userId: String(user.id),
        clerkId,
        basePaise: String(basePaise),
        gstPaise: String(gstPaise),
        gstRate: String(GST_RATE),
      },
      payment_capture: 1,
    };
    if (setupMandate && customerId) {
      orderPayload.customer_id = customerId;
      orderPayload.method = "upi";
    }
    order = await razorpay.orders.create(orderPayload as any);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Razorpay error";
    res.status(502).json({ error: `Failed to create payment order: ${msg}` });
    return;
  }

  await db.insert(walletTransactionsTable).values({
    userId:         user.id,
    type:           "topup",
    amountCents:    basePaise, // credit wallet with base only; GST is charged on payment
    description:    `Wallet top-up ${formatInr(basePaise)} + GST ${formatInr(gstPaise)} (pay ${formatInr(payablePaise)})`,
    status:         "pending",
    razorpayOrderId: order.id,
  });

  res.json({
    orderId:     order.id,
    amountCents: basePaise,
    amount:      payablePaise,
    basePaise,
    gstPaise,
    payablePaise,
    gstRate:     GST_RATE,
    currency,
    keyId:       process.env.RAZORPAY_KEY_ID,
    customerId:  setupMandate ? customerId : null,
    preferUpi:   true,
  });
});

// POST /api/wallet/verify-payment — verify signature, save mandate token, credit wallet
router.post("/wallet/verify-payment", requireAuth, async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body as {
    razorpayOrderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
  };

  const secret = process.env.RAZORPAY_KEY_SECRET!;
  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");

  if (expectedSig !== razorpaySignature) {
    res.status(400).json({ error: "Invalid payment signature" });
    return;
  }

  const user = await getDbUser(clerkId);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const [claimed] = await db
    .update(walletTransactionsTable)
    .set({ status: "completed", razorpayPaymentId })
    .where(
      and(
        eq(walletTransactionsTable.razorpayOrderId, razorpayOrderId),
        eq(walletTransactionsTable.userId, user.id),
        eq(walletTransactionsTable.status, "pending"),
      ),
    )
    .returning();

  if (!claimed) {
    res.status(400).json({ error: "Order not found or already processed" });
    return;
  }

  let tokenId: string | undefined;
  try {
    const razorpay = getRazorpay();
    const payment = await (razorpay.payments as any).fetch(razorpayPaymentId);
    tokenId = payment?.token_id as string | undefined;
  } catch (err) {
    logger.warn({ err, razorpayPaymentId }, "Could not fetch Razorpay payment details for token");
  }

  if (tokenId) {
    await db.update(usersTable)
      .set({ razorpayTokenId: tokenId })
      .where(eq(usersTable.id, user.id));
    logger.info({ userId: user.id, tokenId }, "Razorpay mandate token saved");
  }

  const [updated] = await db
    .update(usersTable)
    .set({ walletBalanceCents: sql`${usersTable.walletBalanceCents} + ${claimed.amountCents}` })
    .where(eq(usersTable.id, user.id))
    .returning();

  logger.info(
    { userId: user.id, razorpayOrderId, razorpayPaymentId, amountCents: claimed.amountCents },
    "Wallet credited via verify-payment",
  );

  if (user.email) {
    sendBrevoEmail(
      user.email,
      "Payment received — SnapServe wallet topped up",
      walletTopUpEmail(
        user.name ?? user.email.split("@")[0]!,
        claimed.amountCents,
        updated?.walletBalanceCents ?? 0,
        razorpayPaymentId,
      ),
    ).catch(err => logger.warn({ err, userId: user.id }, "Top-up receipt email failed"));
  }

  res.json(walletInfoPayload(updated));
});

// GET /api/wallet/transactions
router.get("/wallet/transactions", requireAuth, async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const limit  = Math.min(Number(req.query.limit  ?? 20), 100);
  const offset = Number(req.query.offset ?? 0);
  const user   = await getDbUser(clerkId);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const txns = await db
    .select()
    .from(walletTransactionsTable)
    .where(eq(walletTransactionsTable.userId, user.id))
    .orderBy(desc(walletTransactionsTable.createdAt))
    .limit(limit)
    .offset(offset);

  res.json(
    txns.map((t) => ({
      id:               t.id,
      type:             t.type,
      amountCents:      t.amountCents,
      amountInr:        t.amountCents / 100,
      /** @deprecated use amountInr */
      amountUsd:        t.amountCents / 100,
      currency:         CURRENCY_INR,
      description:      t.description,
      status:           t.status,
      razorpayOrderId:  t.razorpayOrderId,
      razorpayPaymentId: t.razorpayPaymentId,
      callId:           t.callId,
      createdAt:        t.createdAt,
    })),
  );
});

// PATCH /api/wallet/autopay
router.patch("/wallet/autopay", requireAuth, async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const { autoPayEnabled, autoPayThresholdCents, autoPayAmountCents } = req.body as {
    autoPayEnabled?: boolean;
    autoPayThresholdCents?: number;
    autoPayAmountCents?: number;
  };
  const user = await getDbUser(clerkId);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (autoPayAmountCents !== undefined && autoPayAmountCents < MIN_TOPUP_PAISE) {
    res.status(400).json({ error: `Auto top-up amount must be at least ${formatInr(MIN_TOPUP_PAISE)}` });
    return;
  }
  const [updated] = await db
    .update(usersTable)
    .set({
      ...(autoPayEnabled !== undefined && { autoPayEnabled }),
      ...(autoPayThresholdCents !== undefined && { autoPayThresholdCents }),
      ...(autoPayAmountCents !== undefined && { autoPayAmountCents }),
    })
    .where(eq(usersTable.id, user.id))
    .returning();

  res.json(walletInfoPayload(updated));
});

// POST /api/wallet/webhook — Razorpay server-to-server webhook
router.post("/wallet/webhook", async (req, res) => {
  res.sendStatus(200);

  const signature = req.headers["x-razorpay-signature"] as string | undefined;
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (webhookSecret) {
    if (!signature) {
      logger.warn("Razorpay webhook: RAZORPAY_WEBHOOK_SECRET set but no signature header — ignoring");
      return;
    }
    const expectedSig = crypto
      .createHmac("sha256", webhookSecret)
      .update(JSON.stringify(req.body))
      .digest("hex");
    if (expectedSig !== signature) {
      logger.warn({ signature }, "Razorpay webhook: invalid signature — ignoring");
      return;
    }
  }

  const event = (req.body as { event?: string; payload?: Record<string, unknown> }).event;
  if (event !== "payment.captured" && event !== "payment.failed") return;

  const payment = (req.body as any)?.payload?.payment?.entity as Record<string, unknown> | undefined;
  const orderId   = typeof payment?.order_id  === "string" ? payment.order_id  : null;
  const paymentId = typeof payment?.id        === "string" ? payment.id        : null;

  if (!orderId) {
    logger.warn({ event, payment }, "Razorpay webhook: missing order_id — ignoring");
    return;
  }

  try {
    const [txn] = await db
      .select()
      .from(walletTransactionsTable)
      .where(eq(walletTransactionsTable.razorpayOrderId, orderId));

    if (!txn) {
      logger.warn({ orderId, event }, "Razorpay webhook: order not found in DB — ignoring");
      return;
    }

    if (event === "payment.failed") {
      if (txn.status === "failed") {
        logger.info({ orderId }, "Razorpay webhook: order already marked failed — skipping");
        return;
      }
      await db
        .update(walletTransactionsTable)
        .set({ status: "failed", razorpayPaymentId: paymentId ?? undefined })
        .where(eq(walletTransactionsTable.id, txn.id));
      logger.info({ orderId, paymentId, userId: txn.userId }, "Wallet topup marked failed via Razorpay webhook");
      return;
    }

    if (!paymentId) {
      logger.warn({ event, payment }, "Razorpay webhook payment.captured: missing payment id");
      return;
    }

    let verifiedPayment: { status?: string; order_id?: string; amount?: number } | undefined;
    try {
      const razorpay = getRazorpay();
      verifiedPayment = await (razorpay.payments as any).fetch(paymentId);
    } catch (err) {
      logger.error({ err, orderId, paymentId }, "Razorpay webhook: could not verify payment via Razorpay API — refusing to credit");
      return;
    }
    if (!verifiedPayment || verifiedPayment.status !== "captured" || verifiedPayment.order_id !== orderId) {
      logger.warn(
        { orderId, paymentId, verifiedStatus: verifiedPayment?.status, verifiedOrderId: verifiedPayment?.order_id },
        "Razorpay webhook: payment.captured event failed independent verification — possible forged webhook, refusing to credit",
      );
      return;
    }

    await db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(walletTransactionsTable)
        .set({ status: "completed", razorpayPaymentId: paymentId })
        .where(and(
          eq(walletTransactionsTable.id, txn.id),
          eq(walletTransactionsTable.status, "pending"),
        ))
        .returning({ id: walletTransactionsTable.id });

      if (!claimed) {
        logger.info({ orderId, paymentId }, "Razorpay webhook: order already completed — skipping (idempotent)");
        return;
      }

      await tx
        .update(usersTable)
        .set({ walletBalanceCents: sql`${usersTable.walletBalanceCents} + ${txn.amountCents}` })
        .where(eq(usersTable.id, txn.userId));

      logger.info({ orderId, paymentId, userId: txn.userId, amountCents: txn.amountCents },
        "Wallet credited via Razorpay webhook payment.captured");
    });
  } catch (err) {
    logger.error({ err, orderId, paymentId, event }, "Razorpay webhook: error processing event");
  }
});

export default router;
