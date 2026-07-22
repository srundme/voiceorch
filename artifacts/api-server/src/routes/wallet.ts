import { Router } from "express";
import crypto from "crypto";
import Razorpay from "razorpay";
import { db } from "@workspace/db";
import { usersTable, walletTransactionsTable, invoicesTable } from "@workspace/db/schema";
import { eq, desc, sql, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";
import { logger } from "../lib/logger.js";
import { getAppOrigins } from "../lib/app-domain.js";
import { issueInvoice, renderInvoiceHtml, renderInvoicePdf } from "../services/invoice.js";
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
      orderPayload.method = "card";
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
    preferCard:  true,
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

  // GST tax invoice cum receipt (base credit + 18% GST) with PDF attached.
  // This single document replaces the old separate receipt email. Idempotent.
  void issueInvoice({
    user: { id: user.id, name: user.name, email: user.email },
    type: "wallet_topup",
    description: "Wallet top-up — prepaid calling credit",
    hsnSac: "998413",
    amountCents: claimed.amountCents,
    gstInclusive: false,
    razorpayOrderId,
    razorpayPaymentId,
  });

  res.json(walletInfoPayload(updated));
});

/**
 * Credit a wallet top-up from a verified order, identifying the user via the
 * pending transaction row (no session needed). Atomic + idempotent: only the
 * first caller to flip `pending → completed` credits the balance, so the
 * redirect callback, the handler verify path and the webhook can all race
 * safely. Issues the GST invoice (idempotent per payment id).
 */
async function creditTopupByOrder(orderId: string, paymentId: string): Promise<void> {
  const [txn] = await db
    .select()
    .from(walletTransactionsTable)
    .where(eq(walletTransactionsTable.razorpayOrderId, orderId));
  if (!txn) {
    logger.warn({ orderId }, "payment-callback: order not found in DB — cannot credit");
    return;
  }

  let credited = false;
  await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(walletTransactionsTable)
      .set({ status: "completed", razorpayPaymentId: paymentId })
      .where(and(
        eq(walletTransactionsTable.id, txn.id),
        eq(walletTransactionsTable.status, "pending"),
      ))
      .returning({ id: walletTransactionsTable.id });
    if (!claimed) return;
    await tx
      .update(usersTable)
      .set({ walletBalanceCents: sql`${usersTable.walletBalanceCents} + ${txn.amountCents}` })
      .where(eq(usersTable.id, txn.userId));
    credited = true;
  });

  if (!credited) {
    logger.info({ orderId, paymentId }, "payment-callback: order already processed — skipping (idempotent)");
    return;
  }

  logger.info(
    { orderId, paymentId, userId: txn.userId, amountCents: txn.amountCents },
    "Wallet credited via payment-callback (redirect flow)",
  );

  const [invUser] = await db.select().from(usersTable).where(eq(usersTable.id, txn.userId));
  if (invUser) {
    void issueInvoice({
      user: { id: invUser.id, name: invUser.name, email: invUser.email },
      type: "wallet_topup",
      description: "Wallet top-up — prepaid calling credit",
      hsnSac: "998413",
      amountCents: txn.amountCents,
      gstInclusive: false,
      razorpayOrderId: orderId,
      razorpayPaymentId: paymentId,
    });
  }
}

/**
 * Validate the `return` URL supplied by the client against trusted origins to
 * prevent an open redirect, and append the top-up status. Falls back to the
 * request's own origin + /wallet.
 */
function resolveReturnUrl(raw: string | null, req: { protocol: string; get(name: string): string | undefined }, status: "success" | "failed"): string {
  const requestOrigin = `${req.protocol}://${req.get("host") ?? ""}`;
  const allowed = new Set<string>([...getAppOrigins(), "https://app.snapserve.ai", requestOrigin]);
  const isDev = process.env["NODE_ENV"] !== "production";

  let base = `${requestOrigin}/wallet`;
  if (raw) {
    try {
      const u = new URL(raw);
      if (isDev || allowed.has(u.origin)) {
        u.search = "";
        u.hash = "";
        base = u.toString();
      }
    } catch {
      // ignore malformed return URL, use fallback
    }
  }
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}topup=${status}`;
}

// POST /api/wallet/payment-callback — Razorpay redirect-mode return target.
// Razorpay does a top-level form POST here after net banking / UPI / card
// redirects (redirect mode avoids the about:blank popup that breaks net
// banking). We verify the signature, credit idempotently, then 302 back to the
// dashboard wallet page. Public (no session): the user is identified via the
// signed order, not a bearer token.
router.post("/wallet/payment-callback", async (req, res) => {
  const returnRaw = typeof req.query.return === "string" ? req.query.return : null;
  const body = (req.body ?? {}) as Record<string, string>;
  const razorpayOrderId = body.razorpay_order_id;
  const razorpayPaymentId = body.razorpay_payment_id;
  const razorpaySignature = body.razorpay_signature;

  const fail = (reason: string, extra?: Record<string, unknown>) => {
    logger.warn({ reason, razorpayOrderId, razorpayPaymentId, ...extra }, "payment-callback: not credited");
    res.redirect(302, resolveReturnUrl(returnRaw, req, "failed"));
  };

  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    // User cancelled or payment failed — Razorpay posts error[...] fields here.
    fail("missing success fields", { error: body["error[description]"] });
    return;
  }

  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) { fail("gateway not configured"); return; }

  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");
  if (expectedSig !== razorpaySignature) { fail("invalid signature"); return; }

  try {
    await creditTopupByOrder(razorpayOrderId, razorpayPaymentId);
  } catch (err) {
    // Payment is signature-verified; the webhook will reconcile crediting if
    // this failed. Still send the user to the success page.
    logger.error({ err, razorpayOrderId, razorpayPaymentId }, "payment-callback: crediting error (webhook will reconcile)");
  }
  res.redirect(302, resolveReturnUrl(returnRaw, req, "success"));
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

    // GST tax invoice (idempotent per payment id — no-op if verify path issued it).
    const [invUser] = await db.select().from(usersTable).where(eq(usersTable.id, txn.userId));
    if (invUser) {
      void issueInvoice({
        user: { id: invUser.id, name: invUser.name, email: invUser.email },
        type: "wallet_topup",
        description: "Wallet top-up — prepaid calling credit",
        hsnSac: "998413",
        amountCents: txn.amountCents,
        gstInclusive: false,
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
      });
    }
  } catch (err) {
    logger.error({ err, orderId, paymentId, event }, "Razorpay webhook: error processing event");
  }
});

// GET /api/wallet/invoices — list the authenticated user's tax invoices
router.get("/wallet/invoices", requireAuth, async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const limit  = Math.min(Number(req.query.limit  ?? 50), 200);
  const offset = Number(req.query.offset ?? 0);
  const user = await getDbUser(clerkId);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const rows = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.userId, user.id))
    .orderBy(desc(invoicesTable.createdAt))
    .limit(limit)
    .offset(offset);

  res.json(
    rows.map((r) => ({
      id:            r.id,
      invoiceNumber: r.invoiceNumber,
      type:          r.type,
      description:   r.description,
      baseCents:     r.baseCents,
      gstCents:      r.gstCents,
      totalCents:    r.totalCents,
      totalInr:      r.totalCents / 100,
      currency:      r.currency,
      status:        r.status,
      createdAt:     r.createdAt,
    })),
  );
});

// GET /api/wallet/invoices/:id — rendered HTML invoice (printable / save as PDF)
router.get("/wallet/invoices/:id", requireAuth, async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId!, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const user = await getDbUser(clerkId);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const [invoice] = await db
    .select()
    .from(invoicesTable)
    .where(and(eq(invoicesTable.id, id), eq(invoicesTable.userId, user.id)));

  if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }
  res.set("Content-Type", "text/html").send(renderInvoiceHtml(invoice));
});

// GET /api/wallet/invoices/:id/pdf — downloadable PDF invoice
router.get("/wallet/invoices/:id/pdf", requireAuth, async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId!, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const user = await getDbUser(clerkId);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const [invoice] = await db
    .select()
    .from(invoicesTable)
    .where(and(eq(invoicesTable.id, id), eq(invoicesTable.userId, user.id)));

  if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }

  try {
    const pdf = await renderInvoicePdf(invoice);
    res.set("Content-Type", "application/pdf");
    res.set("Content-Disposition", `attachment; filename="${invoice.invoiceNumber.replace(/\//g, "-")}.pdf"`);
    res.send(pdf);
  } catch (err) {
    logger.error({ err, invoiceId: id }, "Failed to render invoice PDF");
    res.status(500).json({ error: "Failed to generate PDF" });
  }
});

export default router;
