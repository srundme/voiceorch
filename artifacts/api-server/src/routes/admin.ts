import { Router } from "express";
import { db, usersTable, walletTransactionsTable, callsTable, agentsTable, scheduledCallbacksTable, bookingsTable, eventTypesTable, schedulingCalendarsTable } from "@workspace/db";
import { eq, sql, count, sum, desc, lt, gt, and, inArray } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { getAllSessions } from "../orchestration/session.js";
import { logger } from "../lib/logger.js";

const router = Router();

router.use("/admin", requireAdmin);

// ─── Overview ────────────────────────────────────────────────────────────────

router.get("/admin/overview", async (req, res): Promise<void> => {
  try {
    const [[{ totalUsers }], [{ totalCalls }], [{ totalRevenueCents }], [{ pendingCallbacks }], [{ recentCalls }]] =
      await Promise.all([
        db.select({ totalUsers: count() }).from(usersTable),
        db.select({ totalCalls: count() }).from(callsTable),
        db
          .select({ totalRevenueCents: sql<number>`coalesce(sum(amount_cents), 0)` })
          .from(walletTransactionsTable)
          .where(eq(walletTransactionsTable.type, "topup")),
        db
          .select({ pendingCallbacks: count() })
          .from(scheduledCallbacksTable)
          .where(eq(scheduledCallbacksTable.status, "pending")),
        db
          .select({ recentCalls: count() })
          .from(callsTable)
          .where(gt(callsTable.createdAt, sql`now() - interval '24 hours'`)),
      ]);

    const activeCalls = getAllSessions().length;

    res.json({
      totalUsers,
      totalCalls,
      activeCalls,
      totalRevenueCents,
      pendingCallbacks,
      recentCalls,
    });
  } catch (err) {
    req.log.error({ err }, "admin/overview failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Users ────────────────────────────────────────────────────────────────────

router.get("/admin/users", async (req, res): Promise<void> => {
  try {
    const users = await db.select().from(usersTable).orderBy(desc(usersTable.createdAt)).limit(500);
    const clerkIds = users.map((u) => u.clerkId);

    if (clerkIds.length === 0) {
      res.json([]);
      return;
    }

    const [callCounts, agentCounts, spentAmounts] = await Promise.all([
      db
        .select({ clerkId: callsTable.userId, callCount: count() })
        .from(callsTable)
        .where(inArray(callsTable.userId, clerkIds))
        .groupBy(callsTable.userId),
      db
        .select({ clerkId: agentsTable.userId, agentCount: count() })
        .from(agentsTable)
        .where(inArray(agentsTable.userId, clerkIds))
        .groupBy(agentsTable.userId),
      db
        .select({
          userId: walletTransactionsTable.userId,
          totalSpentCents: sql<number>`coalesce(sum(abs(amount_cents)), 0)`,
        })
        .from(walletTransactionsTable)
        .where(
          and(
            inArray(
              walletTransactionsTable.userId,
              users.map((u) => u.id),
            ),
            lt(walletTransactionsTable.amountCents, 0),
          ),
        )
        .groupBy(walletTransactionsTable.userId),
    ]);

    const callCountMap = new Map(callCounts.map((r) => [r.clerkId, r.callCount]));
    const agentCountMap = new Map(agentCounts.map((r) => [r.clerkId, r.agentCount]));
    const spentMap = new Map(spentAmounts.map((r) => [r.userId, Number(r.totalSpentCents)]));

    const result = users.map((u) => ({
      id: u.id,
      clerkId: u.clerkId,
      email: u.email,
      name: u.name,
      walletBalanceCents: u.walletBalanceCents,
      freeCreditsGranted: u.freeCreditsGranted,
      onboardingCompleted: u.onboardingCompleted,
      callCount: callCountMap.get(u.clerkId) ?? 0,
      agentCount: agentCountMap.get(u.clerkId) ?? 0,
      totalSpentCents: spentMap.get(u.id) ?? 0,
      createdAt: u.createdAt,
    }));

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "admin/users failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/users/:clerkId", async (req, res): Promise<void> => {
  try {
    const { clerkId } = req.params;
    const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId!));
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const [calls, walletTransactions, agents] = await Promise.all([
      db
        .select()
        .from(callsTable)
        .where(eq(callsTable.userId, clerkId!))
        .orderBy(desc(callsTable.createdAt))
        .limit(50),
      db
        .select()
        .from(walletTransactionsTable)
        .where(eq(walletTransactionsTable.userId, user.id))
        .orderBy(desc(walletTransactionsTable.createdAt))
        .limit(50),
      db.select().from(agentsTable).where(eq(agentsTable.userId, clerkId!)),
    ]);

    res.json({ user, calls, walletTransactions, agents });
  } catch (err) {
    req.log.error({ err }, "admin/users/:clerkId failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/admin/users/:clerkId/wallet", async (req, res): Promise<void> => {
  try {
    const { clerkId } = req.params;
    const { adjustmentCents, description } = req.body as { adjustmentCents: number; description: string };

    if (typeof adjustmentCents !== "number" || isNaN(adjustmentCents)) {
      res.status(400).json({ error: "adjustmentCents must be a number" });
      return;
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId!));
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const [updated] = await db
      .update(usersTable)
      .set({ walletBalanceCents: user.walletBalanceCents + adjustmentCents })
      .where(eq(usersTable.clerkId, clerkId!))
      .returning({ walletBalanceCents: usersTable.walletBalanceCents });

    await db.insert(walletTransactionsTable).values({
      userId: user.id,
      type: adjustmentCents >= 0 ? "admin_credit" : "admin_debit",
      amountCents: adjustmentCents,
      description: description ?? "Admin wallet adjustment",
      status: "completed",
    });

    logger.info({ clerkId, adjustmentCents }, "Admin wallet adjustment");
    res.json({ newBalanceCents: updated?.walletBalanceCents });
  } catch (err) {
    req.log.error({ err }, "admin/users/:clerkId/wallet failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Finance ─────────────────────────────────────────────────────────────────

router.get("/admin/finance/summary", async (req, res): Promise<void> => {
  try {
    const [[totalRevenue], [monthlyRevenue], [topupCount]] = await Promise.all([
      db
        .select({ totalRevenueCents: sql<number>`coalesce(sum(amount_cents), 0)` })
        .from(walletTransactionsTable)
        .where(eq(walletTransactionsTable.type, "topup")),
      db
        .select({ monthlyRevenueCents: sql<number>`coalesce(sum(amount_cents), 0)` })
        .from(walletTransactionsTable)
        .where(
          and(
            eq(walletTransactionsTable.type, "topup"),
            gt(walletTransactionsTable.createdAt, sql`now() - interval '30 days'`),
          ),
        ),
      db
        .select({ count: count() })
        .from(walletTransactionsTable)
        .where(eq(walletTransactionsTable.type, "topup")),
    ]);

    const uniquePayers = await db
      .selectDistinct({ userId: walletTransactionsTable.userId })
      .from(walletTransactionsTable)
      .where(eq(walletTransactionsTable.type, "topup"));

    res.json({
      totalRevenueCents: Number(totalRevenue?.totalRevenueCents ?? 0),
      monthlyRevenueCents: Number(monthlyRevenue?.monthlyRevenueCents ?? 0),
      totalTopups: topupCount?.count ?? 0,
      uniquePayingUsers: uniquePayers.length,
    });
  } catch (err) {
    req.log.error({ err }, "admin/finance/summary failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/finance/transactions", async (req, res): Promise<void> => {
  try {
    const limit = Math.min(Number(req.query["limit"] ?? 100), 500);
    const offset = Number(req.query["offset"] ?? 0);

    const transactions = await db
      .select({
        id: walletTransactionsTable.id,
        userId: walletTransactionsTable.userId,
        type: walletTransactionsTable.type,
        amountCents: walletTransactionsTable.amountCents,
        description: walletTransactionsTable.description,
        status: walletTransactionsTable.status,
        razorpayPaymentId: walletTransactionsTable.razorpayPaymentId,
        createdAt: walletTransactionsTable.createdAt,
        userEmail: usersTable.email,
        userName: usersTable.name,
        userClerkId: usersTable.clerkId,
      })
      .from(walletTransactionsTable)
      .leftJoin(usersTable, eq(walletTransactionsTable.userId, usersTable.id))
      .orderBy(desc(walletTransactionsTable.createdAt))
      .limit(limit)
      .offset(offset);

    res.json(transactions);
  } catch (err) {
    req.log.error({ err }, "admin/finance/transactions failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Platform / Engineering ───────────────────────────────────────────────────

router.get("/admin/platform/active", async (_req, res): Promise<void> => {
  try {
    const sessions = getAllSessions();
    res.json({ activeSessions: sessions, count: sessions.length });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/platform/callbacks", async (req, res): Promise<void> => {
  try {
    const callbacks = await db
      .select({
        id: scheduledCallbacksTable.id,
        agentId: scheduledCallbacksTable.agentId,
        toNumber: scheduledCallbacksTable.toNumber,
        scheduledAt: scheduledCallbacksTable.scheduledAt,
        status: scheduledCallbacksTable.status,
        triggeredAt: scheduledCallbacksTable.triggeredAt,
        createdAt: scheduledCallbacksTable.createdAt,
        createdFromCallId: scheduledCallbacksTable.createdFromCallId,
        agentName: agentsTable.name,
      })
      .from(scheduledCallbacksTable)
      .leftJoin(agentsTable, eq(scheduledCallbacksTable.agentId, agentsTable.id))
      .orderBy(desc(scheduledCallbacksTable.createdAt))
      .limit(200);

    res.json(callbacks);
  } catch (err) {
    req.log.error({ err }, "admin/platform/callbacks failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/platform/failed-calls", async (req, res): Promise<void> => {
  try {
    const failed = await db
      .select()
      .from(callsTable)
      .where(eq(callsTable.status, "failed"))
      .orderBy(desc(callsTable.createdAt))
      .limit(100);

    res.json(failed);
  } catch (err) {
    req.log.error({ err }, "admin/platform/failed-calls failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Growth ──────────────────────────────────────────────────────────────────

router.get("/admin/growth/funnel", async (_req, res): Promise<void> => {
  try {
    const [allUsers, usersWithAgent, usersWithCall] = await Promise.all([
      db.select({ count: count() }).from(usersTable),
      db.selectDistinct({ userId: agentsTable.userId }).from(agentsTable),
      db.selectDistinct({ userId: callsTable.userId }).from(callsTable),
    ]);

    res.json({
      totalUsers: allUsers[0]?.count ?? 0,
      usersWithAgent: usersWithAgent.length,
      usersWithCall: usersWithCall.length,
    });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/growth/top-users", async (_req, res): Promise<void> => {
  try {
    const topUsers = await db
      .select({
        clerkId: callsTable.userId,
        callCount: count(),
        email: usersTable.email,
        name: usersTable.name,
        walletBalanceCents: usersTable.walletBalanceCents,
      })
      .from(callsTable)
      .leftJoin(usersTable, eq(callsTable.userId, usersTable.clerkId))
      .groupBy(callsTable.userId, usersTable.email, usersTable.name, usersTable.walletBalanceCents)
      .orderBy(desc(count()))
      .limit(20);

    res.json(topUsers);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Scheduling ──────────────────────────────────────────────────────────────

router.get("/admin/scheduling/bookings", async (req, res): Promise<void> => {
  try {
    const { status, startDate, endDate, agentId } = req.query as Record<string, string>;
    const conditions: any[] = [];
    if (status && status !== "all") {
      conditions.push(eq(bookingsTable.status, status as any));
    }
    if (startDate) {
      conditions.push(sql`${bookingsTable.slotStart} >= ${startDate}::timestamptz`);
    }
    if (endDate) {
      conditions.push(sql`${bookingsTable.slotStart} <= ${endDate}::timestamptz + interval '1 day'`);
    }
    if (agentId) {
      conditions.push(eq(schedulingCalendarsTable.agentId, parseInt(agentId)));
    }
    const rows = await db
      .select({
        id: bookingsTable.id,
        attendeeName: bookingsTable.attendeeName,
        attendeeEmail: bookingsTable.attendeeEmail,
        slotStart: bookingsTable.slotStart,
        slotEnd: bookingsTable.slotEnd,
        status: bookingsTable.status,
        bookedVia: bookingsTable.bookedVia,
        userId: schedulingCalendarsTable.userId,
        agentId: schedulingCalendarsTable.agentId,
        calendarName: schedulingCalendarsTable.name,
        createdAt: bookingsTable.createdAt,
      })
      .from(bookingsTable)
      .leftJoin(eventTypesTable, eq(bookingsTable.eventTypeId, eventTypesTable.id))
      .leftJoin(schedulingCalendarsTable, eq(eventTypesTable.calendarId, schedulingCalendarsTable.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(bookingsTable.createdAt))
      .limit(500);
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "admin/scheduling/bookings failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/growth/inactive", async (_req, res): Promise<void> => {
  try {
    const activeClerkIds = await db
      .selectDistinct({ userId: callsTable.userId })
      .from(callsTable)
      .where(gt(callsTable.createdAt, sql`now() - interval '7 days'`));

    const activeSet = new Set(activeClerkIds.map((r) => r.userId).filter(Boolean));

    const users = await db.select().from(usersTable).orderBy(desc(usersTable.createdAt)).limit(500);
    const inactive = users.filter((u) => !activeSet.has(u.clerkId));

    res.json(inactive.slice(0, 100));
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
