/**
 * Revenue wallets directory for Admin V2.
 */
import { Router } from "express";
import { db, usersTable, walletTransactionsTable } from "@workspace/db";
import { desc, sql, count } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { logger } from "../lib/logger.js";

const router = Router();
router.use("/admin/revenue", requireAdmin);

router.get("/admin/revenue/wallets", async (_req, res): Promise<void> => {
  try {
    const users = await db
      .select({
        id: usersTable.id,
        clerkId: usersTable.clerkId,
        email: usersTable.email,
        name: usersTable.name,
        status: usersTable.status,
        isTest: usersTable.isTest,
        walletBalanceCents: usersTable.walletBalanceCents,
        createdAt: usersTable.createdAt,
      })
      .from(usersTable)
      .where(sql`${usersTable.status} <> 'deleted'`)
      .orderBy(desc(usersTable.walletBalanceCents))
      .limit(500);

    const txCounts = await db
      .select({
        userId: walletTransactionsTable.userId,
        txCount: count(),
        lastTx: sql<string>`max(${walletTransactionsTable.createdAt})`,
      })
      .from(walletTransactionsTable)
      .groupBy(walletTransactionsTable.userId);

    const txMap = new Map(txCounts.map((r) => [r.userId, r]));

    const wallets = users.map((u) => {
      const t = txMap.get(u.id);
      return {
        ...u,
        txCount: Number(t?.txCount ?? 0),
        lastTransactionAt: t?.lastTx ?? null,
      };
    });

    const totalLiability = wallets.reduce((n, w) => n + (w.walletBalanceCents ?? 0), 0);
    const negative = wallets.filter((w) => (w.walletBalanceCents ?? 0) < 0).length;
    const zero = wallets.filter((w) => (w.walletBalanceCents ?? 0) === 0).length;

    res.json({
      generatedAt: new Date().toISOString(),
      kpis: {
        wallets: wallets.length,
        totalLiabilityPaise: totalLiability,
        negativeBalances: negative,
        zeroBalances: zero,
      },
      wallets,
    });
  } catch (err) {
    logger.error({ err }, "revenue/wallets failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
