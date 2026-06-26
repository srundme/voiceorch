import { Router } from "express";
import crypto from "crypto";
import Razorpay from "razorpay";
import { db } from "@workspace/db";
import { usersTable, walletTransactionsTable, platformSettingsTable } from "@workspace/db/schema";
import { eq, desc, sql, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";
import { logger } from "../lib/logger.js";

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

// Cache the USD→INR rate for 5 minutes to avoid per-request DB hits
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

function walletInfoPayload(user: typeof usersTable.$inferSelect) {
  return {
    balanceCents:          user.walletBalanceCents,
    balanceUsd:            user.walletBalanceCents / 100,
    freeCreditsGranted:    user.freeCreditsGranted,
    autoPayEnabled:        user.autoPayEnabled,
    autoPayThresholdCents: user.autoPayThresholdCents,
    autoPayAmountCents:    user.autoPayAmountCents,
    mandateActive:         !!(user.razorpayCustomerId && user.razorpayTokenId),
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

// POST /api/wallet/topup — create Razorpay order (INR, optionally recurring for mandate setup)
router.post("/wallet/topup", requireAuth, async (req, res) => {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    res.status(503).json({ error: "Payment gateway not configured" });
    return;
  }
  const clerkId = (req as any).clerkUserId as string;
  const { amountCents, setupMandate } = req.body as { amountCents: number; setupMandate?: boolean };
  if (!amountCents || amountCents < 1000) {
    res.status(400).json({ error: "Minimum top-up is $10 (1000 cents)" });
    return;
  }
  const user = await getDbUser(clerkId);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const usdToInr = await getUsdToInrRate();
  const amountPaise = Math.round(amountCents * usdToInr);

  const razorpay = getRazorpay();

  // Get or create Razorpay customer (needed for recurring mandate)
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
      amount:          amountPaise,
      currency:        "INR",
      receipt:         `uid_${user.id}_${Date.now()}`,
      notes:           { userId: String(user.id), clerkId },
      payment_capture: 1,
    };
    if (setupMandate && customerId) {
      orderPayload.customer_id = customerId;
      orderPayload.method      = "upi";
    }
    order = await razorpay.orders.create(orderPayload as any);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Razorpay error";
    res.status(502).json({ error: `Failed to create payment order: ${msg}` });
    return;
  }

  await db.insert(walletTransactionsTable).values({
    userId:         user.id,
    type:           setupMandate ? "topup" : "topup",
    amountCents,
    description:    `Wallet top-up $${(amountCents / 100).toFixed(2)}`,
    status:         "pending",
    razorpayOrderId: order.id,
  });

  res.json({
    orderId:    order.id,
    amountCents,
    amountPaise,
    currency:   "INR",
    keyId:      process.env.RAZORPAY_KEY_ID,
    customerId: setupMandate ? customerId : null,
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

  const [txn] = await db
    .select()
    .from(walletTransactionsTable)
    .where(eq(walletTransactionsTable.razorpayOrderId, razorpayOrderId));

  if (!txn || txn.status === "completed") {
    res.status(400).json({ error: "Order not found or already processed" });
    return;
  }

  // Try to fetch payment details to extract recurring token_id (outside the tx — network call)
  let tokenId: string | undefined;
  try {
    const razorpay = getRazorpay();
    const payment = await (razorpay.payments as any).fetch(razorpayPaymentId);
    tokenId = payment?.token_id as string | undefined;
  } catch (err) {
    logger.warn({ err, razorpayPaymentId }, "Could not fetch Razorpay payment details for token");
  }

  // Atomically claim the transition pending→completed.  If another concurrent
  // request already flipped the row, the conditional UPDATE returns 0 rows and
  // we reject immediately — the wallet is never double-credited.
  let updated: typeof usersTable.$inferSelect | undefined;
  await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(walletTransactionsTable)
      .set({ status: "completed", razorpayPaymentId })
      .where(and(
        eq(walletTransactionsTable.id, txn.id),
        eq(walletTransactionsTable.status, "pending"),
      ))
      .returning({ id: walletTransactionsTable.id });

    if (!claimed) {
      // Race lost — another request already completed this order
      return;
    }

    // Save mandate token if present
    if (tokenId) {
      await tx.update(usersTable)
        .set({ razorpayTokenId: tokenId })
        .where(eq(usersTable.id, user.id));
      logger.info({ userId: user.id, tokenId }, "Razorpay mandate token saved");
    }

    [updated] = await tx
      .update(usersTable)
      .set({ walletBalanceCents: sql`${usersTable.walletBalanceCents} + ${txn.amountCents}` })
      .where(eq(usersTable.id, user.id))
      .returning();
  });

  if (!updated) {
    res.status(400).json({ error: "Order not found or already processed" });
    return;
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
      amountUsd:        t.amountCents / 100,
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
// Handles async payment confirmation (UPI, netbanking) that may not trigger
// the client-side handler callback. No auth — verified by signature instead.
// Register this URL in Razorpay Dashboard → Webhooks → payment.captured
router.post("/wallet/webhook", async (req, res) => {
  res.sendStatus(200); // Ack fast — Razorpay retries on non-2xx

  const signature = req.headers["x-razorpay-signature"] as string | undefined;
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (webhookSecret && signature) {
    const expectedSig = crypto
      .createHmac("sha256", webhookSecret)
      .update(JSON.stringify(req.body))
      .digest("hex");
    if (expectedSig !== signature) {
      logger.warn({ signature }, "Razorpay webhook: invalid signature — ignoring");
      return;
    }
  } else if (webhookSecret && !signature) {
    logger.warn("Razorpay webhook: RAZORPAY_WEBHOOK_SECRET set but no signature header — ignoring");
    return;
  }
  // If RAZORPAY_WEBHOOK_SECRET is not set, we accept all webhooks (less secure but functional)

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

    // payment.captured
    if (!paymentId) {
      logger.warn({ event, payment }, "Razorpay webhook payment.captured: missing payment id");
      return;
    }

    // Atomically claim the pending→completed transition.  If already completed
    // (by the client-side verify-payment or a prior webhook delivery), the
    // conditional UPDATE returns 0 rows and we skip the credit — idempotent.
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
