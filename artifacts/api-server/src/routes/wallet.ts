import { Router } from "express";
import crypto from "crypto";
import Razorpay from "razorpay";
import { db } from "@workspace/db";
import { usersTable, walletTransactionsTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";

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

// GET /api/wallet
router.get("/wallet", requireAuth, async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const user = await getDbUser(clerkId);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({
    balanceCents: user.walletBalanceCents,
    balanceUsd: user.walletBalanceCents / 100,
    freeCreditsGranted: user.freeCreditsGranted,
    autoPayEnabled: user.autoPayEnabled,
    autoPayThresholdCents: user.autoPayThresholdCents,
    autoPayAmountCents: user.autoPayAmountCents,
  });
});

// POST /api/wallet/topup — create Razorpay order
router.post("/wallet/topup", requireAuth, async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const { amountCents } = req.body as { amountCents: number };
  if (!amountCents || amountCents < 1000) {
    res.status(400).json({ error: "Minimum top-up is $10 (1000 cents)" });
    return;
  }
  const user = await getDbUser(clerkId);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const razorpay = getRazorpay();
  const order = await razorpay.orders.create({
    amount: amountCents,
    currency: "USD",
    receipt: `uid_${user.id}_${Date.now()}`,
    notes: { userId: String(user.id), clerkId },
  });

  // Create pending transaction
  await db.insert(walletTransactionsTable).values({
    userId: user.id,
    type: "topup",
    amountCents,
    description: `Wallet top-up $${(amountCents / 100).toFixed(2)}`,
    status: "pending",
    razorpayOrderId: order.id,
  });

  res.json({
    orderId: order.id,
    amountCents,
    currency: "USD",
    keyId: process.env.RAZORPAY_KEY_ID,
  });
});

// POST /api/wallet/verify-payment — verify signature and credit wallet
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

  // Find pending transaction for this order
  const [txn] = await db
    .select()
    .from(walletTransactionsTable)
    .where(eq(walletTransactionsTable.razorpayOrderId, razorpayOrderId));

  if (!txn || txn.status === "completed") {
    res.status(400).json({ error: "Order not found or already processed" });
    return;
  }

  // Credit wallet and mark transaction completed atomically
  const [updated] = await db
    .update(usersTable)
    .set({ walletBalanceCents: user.walletBalanceCents + txn.amountCents })
    .where(eq(usersTable.id, user.id))
    .returning();

  await db
    .update(walletTransactionsTable)
    .set({ status: "completed", razorpayPaymentId })
    .where(eq(walletTransactionsTable.id, txn.id));

  res.json({
    balanceCents: updated.walletBalanceCents,
    balanceUsd: updated.walletBalanceCents / 100,
    freeCreditsGranted: updated.freeCreditsGranted,
    autoPayEnabled: updated.autoPayEnabled,
    autoPayThresholdCents: updated.autoPayThresholdCents,
    autoPayAmountCents: updated.autoPayAmountCents,
  });
});

// GET /api/wallet/transactions
router.get("/wallet/transactions", requireAuth, async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const limit = Math.min(Number(req.query.limit ?? 20), 100);
  const offset = Number(req.query.offset ?? 0);
  const user = await getDbUser(clerkId);
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
      id: t.id,
      type: t.type,
      amountCents: t.amountCents,
      amountUsd: t.amountCents / 100,
      description: t.description,
      status: t.status,
      razorpayOrderId: t.razorpayOrderId,
      razorpayPaymentId: t.razorpayPaymentId,
      callId: t.callId,
      createdAt: t.createdAt,
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

  res.json({
    balanceCents: updated.walletBalanceCents,
    balanceUsd: updated.walletBalanceCents / 100,
    freeCreditsGranted: updated.freeCreditsGranted,
    autoPayEnabled: updated.autoPayEnabled,
    autoPayThresholdCents: updated.autoPayThresholdCents,
    autoPayAmountCents: updated.autoPayAmountCents,
  });
});

export default router;
