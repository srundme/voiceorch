import { Router } from "express";
import { db, usersTable, walletTransactionsTable, callsTable, agentsTable, scheduledCallbacksTable, bookingsTable, eventTypesTable, schedulingCalendarsTable, platformSettingsTable, usageSpikeDismissalsTable, usageSpikeNotificationsTable, alertNotificationLogTable, providerMinuteRatesTable, bookInternsTable, bookProgressTable, bookExamAttemptsTable, partnersTable, phoneNumberOrdersTable } from "@workspace/db";
import { invalidateMinuteRatesCache } from "../services/minute-rates.js";
import { sendTestEmail } from "../services/scheduling/notifications.js";
import { eq, sql, count, sum, desc, lt, gt, gte, and, inArray, ilike, like, type SQL, type AnyColumn } from "drizzle-orm";
import { TRACK_PARAMS } from "../orchestration/ambient.js";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { getAllSessions } from "../orchestration/session.js";
import { logger } from "../lib/logger.js";
import { sendTestAlertNotification, getAlertCooldownStats, resetAlertSuppressedCount, getAlertCooldownStatus } from "../services/alert-notifications.js";
import { getAllCampaignConcurrency } from "../services/batchScheduler.js";
import { processErasureRequest } from "../services/dpdp/index.js";
import { getVobizWalletStatus } from "../services/vobiz-wallet-monitor.js";
import { getRedis } from "../lib/redis.js";
import { pool } from "@workspace/db";

const router = Router();

router.use("/admin", requireAdmin);

// ─── User segmentation (real vs. test/internal) ───────────────────────────────
// "real"  → excludes test/internal accounts (default for all analytics)
// "test"  → only test/internal accounts
// "all"   → no filter
type UserSegment = "real" | "test" | "all";

function parseSegment(raw: unknown): UserSegment {
  return raw === "test" ? "test" : raw === "all" ? "all" : "real";
}

/** Restrict a clerkId (text) column to users in the given segment. */
function segByClerkId(col: AnyColumn, seg: UserSegment): SQL | undefined {
  if (seg === "all") return undefined;
  return sql`${col} in (select clerk_id from users where is_test = ${seg === "test"})`;
}

/** Restrict a users.id (integer) column to users in the given segment. */
function segByUserId(col: AnyColumn, seg: UserSegment): SQL | undefined {
  if (seg === "all") return undefined;
  return sql`${col} in (select id from users where is_test = ${seg === "test"})`;
}

// ─── Overview ────────────────────────────────────────────────────────────────

router.get("/admin/overview", async (req, res): Promise<void> => {
  try {
    const segment = parseSegment(req.query.segment);
    const usersSeg = segment === "all" ? undefined : eq(usersTable.isTest, segment === "test");
    const callsSeg = segByClerkId(callsTable.userId, segment);

    // Indian calendar day: 12:00 AM IST inclusive → next 12:00 AM IST exclusive.
    const todayIstStart = sql`(date_trunc('day', timezone('Asia/Kolkata', now())) AT TIME ZONE 'Asia/Kolkata')`;
    const todayCallWhere = and(
      gte(callsTable.createdAt, todayIstStart),
      lt(callsTable.createdAt, sql`${todayIstStart} + interval '1 day'`),
      callsSeg,
    );

    const [
      [{ totalUsers }],
      [{ totalCalls }],
      [{ totalRevenueCents }],
      [{ pendingCallbacks }],
      [{ recentCalls }],
      [{ totalDurationSeconds }],
      [{ successfulCalls }],
      [{ callsToday, durationTodaySeconds }],
      topMinutesToday,
    ] =
      await Promise.all([
        db.select({ totalUsers: count() }).from(usersTable).where(usersSeg),
        db.select({ totalCalls: count() }).from(callsTable).where(callsSeg),
        db
          .select({ totalRevenueCents: sql<number>`coalesce(sum(amount_cents), 0)` })
          .from(walletTransactionsTable)
          .where(and(eq(walletTransactionsTable.type, "topup"), segByUserId(walletTransactionsTable.userId, segment))),
        db
          .select({ pendingCallbacks: count() })
          .from(scheduledCallbacksTable)
          .where(and(eq(scheduledCallbacksTable.status, "pending"), segByClerkId(scheduledCallbacksTable.userId, segment))),
        db
          .select({ recentCalls: count() })
          .from(callsTable)
          .where(and(gt(callsTable.createdAt, sql`now() - interval '24 hours'`), callsSeg)),
        db
          // Clamp each call to a sane ceiling (2h) before summing so a stray
          // stuck/lingering call with an inflated duration_seconds can't distort
          // the aggregate. coalesce(..,0) first so NULL durations count as 0
          // (least(NULL, x) would otherwise return x).
          .select({
            totalDurationSeconds: sql<number>`coalesce(sum(least(coalesce(duration_seconds, 0), 7200)), 0)`,
          })
          .from(callsTable)
          .where(callsSeg),
        db
          .select({ successfulCalls: count() })
          .from(callsTable)
          .where(and(eq(callsTable.status, "completed"), callsSeg)),
        db
          .select({
            callsToday: count(),
            durationTodaySeconds: sql<number>`coalesce(sum(least(coalesce(duration_seconds, 0), 7200)), 0)`,
          })
          .from(callsTable)
          .where(todayCallWhere),
        db
          .select({
            clerkId: callsTable.userId,
            email: usersTable.email,
            name: usersTable.name,
            callCount: count(),
            durationSeconds: sql<number>`coalesce(sum(least(coalesce(${callsTable.durationSeconds}, 0), 7200)), 0)`,
          })
          .from(callsTable)
          .leftJoin(usersTable, eq(callsTable.userId, usersTable.clerkId))
          .where(todayCallWhere)
          .groupBy(callsTable.userId, usersTable.email, usersTable.name)
          .orderBy(sql`sum(least(coalesce(${callsTable.durationSeconds}, 0), 7200)) desc`)
          .limit(5),
      ]);

    const activeCalls = getAllSessions().length;
    const totalMinutes = Math.round(Number(totalDurationSeconds) / 60);
    const minutesToday = Math.round(Number(durationTodaySeconds) / 60);
    const topMinutesUsers = topMinutesToday.map((row) => ({
      clerkId: row.clerkId,
      email: row.email,
      name: row.name,
      callCount: Number(row.callCount),
      minutes: Math.round(Number(row.durationSeconds) / 60),
    }));

    res.json({
      segment,
      totalUsers,
      totalCalls,
      successfulCalls,
      activeCalls,
      totalRevenueCents,
      pendingCallbacks,
      recentCalls,
      totalDurationSeconds: Number(totalDurationSeconds),
      totalMinutes,
      callsToday: Number(callsToday),
      minutesToday,
      topMinutesUsers,
    });
  } catch (err) {
    req.log.error({ err }, "admin/overview failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Users ────────────────────────────────────────────────────────────────────

router.get("/admin/users", async (req, res): Promise<void> => {
  try {
    // Returns every account. Aggregates are grouped across the whole table
    // rather than filtered by an IN list, which would otherwise grow one bind
    // parameter per user and eventually exceed Postgres' parameter limit.
    const users = await db.select().from(usersTable).orderBy(desc(usersTable.createdAt));

    if (users.length === 0) {
      res.json([]);
      return;
    }

    const [callCounts, agentCounts, spentAmounts, callDurations] = await Promise.all([
      db
        .select({ clerkId: callsTable.userId, callCount: count() })
        .from(callsTable)
        .groupBy(callsTable.userId),
      db
        .select({ clerkId: agentsTable.userId, agentCount: count() })
        .from(agentsTable)
        .groupBy(agentsTable.userId),
      db
        .select({
          userId: walletTransactionsTable.userId,
          totalSpentCents: sql<number>`coalesce(sum(abs(amount_cents)), 0)`,
        })
        .from(walletTransactionsTable)
        .where(lt(walletTransactionsTable.amountCents, 0))
        .groupBy(walletTransactionsTable.userId),
      db
        .select({
          clerkId: callsTable.userId,
          totalDurationSeconds: sql<number>`coalesce(sum(duration_seconds), 0)`,
        })
        .from(callsTable)
        .groupBy(callsTable.userId),
    ]);

    const callCountMap = new Map(callCounts.map((r) => [r.clerkId, r.callCount]));
    const agentCountMap = new Map(agentCounts.map((r) => [r.clerkId, r.agentCount]));
    const spentMap = new Map(spentAmounts.map((r) => [r.userId, Number(r.totalSpentCents)]));
    const durationMap = new Map(
      callDurations.map((r) => [r.clerkId, Number(r.totalDurationSeconds)]),
    );

    const result = users.map((u) => ({
      id: u.id,
      clerkId: u.clerkId,
      email: u.email,
      name: u.name,
      walletBalanceCents: u.walletBalanceCents,
      freeCreditsGranted: u.freeCreditsGranted,
      onboardingCompleted: u.onboardingCompleted,
      onboardingData: u.onboardingData,
      isTest: u.isTest,
      callCount: callCountMap.get(u.clerkId) ?? 0,
      agentCount: agentCountMap.get(u.clerkId) ?? 0,
      totalDurationSeconds: durationMap.get(u.clerkId) ?? 0,
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

    const [calls, walletTransactions, agents, partnerRows] = await Promise.all([
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
      // Lets the admin UI show partner status instead of offering "Make Partner"
      // for someone who already is one (the POST would just 409).
      db
        .select({
          id: partnersTable.id,
          companyName: partnersTable.companyName,
          status: partnersTable.status,
          baseRateCentsPerMin: partnersTable.baseRateCentsPerMin,
        })
        .from(partnersTable)
        .where(eq(partnersTable.userId, clerkId!))
        .limit(1),
    ]);

    res.json({ user, calls, walletTransactions, agents, partner: partnerRows[0] ?? null });
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

router.patch("/admin/users/:clerkId/concurrent-limit", async (req, res): Promise<void> => {
  try {
    const { clerkId } = req.params;
    const { concurrentLimit } = req.body as { concurrentLimit: number };

    if (typeof concurrentLimit !== "number" || !Number.isInteger(concurrentLimit) || concurrentLimit < 1) {
      res.status(400).json({ error: "concurrentLimit must be a positive integer >= 1" });
      return;
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId!));
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const [updated] = await db
      .update(usersTable)
      .set({ concurrentLimit })
      .where(eq(usersTable.clerkId, clerkId!))
      .returning({ concurrentLimit: usersTable.concurrentLimit });

    logger.info({ clerkId, concurrentLimit }, "Admin set concurrent call limit");
    res.json({ concurrentLimit: updated?.concurrentLimit });
  } catch (err) {
    req.log.error({ err }, "admin/users/:clerkId/concurrent-limit failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Mark / unmark a user as a test/internal account (excluded from real analytics).
router.patch("/admin/users/:clerkId/test-flag", async (req, res): Promise<void> => {
  try {
    const { clerkId } = req.params;
    const { isTest } = req.body as { isTest: boolean };

    if (typeof isTest !== "boolean") {
      res.status(400).json({ error: "isTest must be a boolean" });
      return;
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId!));
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const [updated] = await db
      .update(usersTable)
      .set({ isTest })
      .where(eq(usersTable.clerkId, clerkId!))
      .returning({ isTest: usersTable.isTest });

    logger.info({ clerkId, isTest }, "Admin set user test flag");
    res.json({ isTest: updated?.isTest });
  } catch (err) {
    req.log.error({ err }, "admin/users/:clerkId/test-flag failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Grant / revoke unlimited managed outbound trial for a specific account.
router.patch("/admin/users/:clerkId/unlimited-trial", async (req, res): Promise<void> => {
  try {
    const { clerkId } = req.params;
    const { unlimited } = req.body as { unlimited: boolean };

    if (typeof unlimited !== "boolean") {
      res.status(400).json({ error: "unlimited must be a boolean" });
      return;
    }

    const { setUserUnlimitedManagedTrial } = await import("../services/managed-outbound-quota.js");
    const result = await setUserUnlimitedManagedTrial(clerkId!, unlimited);
    if (result === null) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    logger.info({ clerkId, unlimited }, "Admin set user unlimited managed trial");
    res.json({ unlimitedManagedTrial: result });
  } catch (err) {
    req.log.error({ err }, "admin/users/:clerkId/unlimited-trial failed");
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

// Recent wallet recharges (top-ups only) joined with the paying user. Powers the
// admin "Recharges" page so the owner can see who paid and when at a glance.
router.get("/admin/finance/recharges", async (req, res): Promise<void> => {
  try {
    const limit = Math.min(Number(req.query["limit"] ?? 100), 500);
    const offset = Number(req.query["offset"] ?? 0);
    // Default to only successful recharges; pass ?status=all to include pending/failed.
    const statusFilter = String(req.query["status"] ?? "completed");

    const conds = [inArray(walletTransactionsTable.type, ["topup", "auto_topup"])];
    if (statusFilter !== "all") {
      conds.push(eq(walletTransactionsTable.status, statusFilter));
    }

    const [rows, [totals]] = await Promise.all([
      db
        .select({
          id: walletTransactionsTable.id,
          userId: walletTransactionsTable.userId,
          type: walletTransactionsTable.type,
          amountCents: walletTransactionsTable.amountCents,
          description: walletTransactionsTable.description,
          status: walletTransactionsTable.status,
          razorpayOrderId: walletTransactionsTable.razorpayOrderId,
          razorpayPaymentId: walletTransactionsTable.razorpayPaymentId,
          createdAt: walletTransactionsTable.createdAt,
          userEmail: usersTable.email,
          userName: usersTable.name,
          userClerkId: usersTable.clerkId,
          userIsTest: usersTable.isTest,
        })
        .from(walletTransactionsTable)
        .leftJoin(usersTable, eq(walletTransactionsTable.userId, usersTable.id))
        .where(and(...conds))
        .orderBy(desc(walletTransactionsTable.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({
          total: count(),
          amountCents: sum(walletTransactionsTable.amountCents),
        })
        .from(walletTransactionsTable)
        .where(and(...conds)),
    ]);

    res.json({
      rows,
      total: Number(totals?.total ?? 0),
      totalAmountCents: Number(totals?.amountCents ?? 0),
    });
  } catch (err) {
    req.log.error({ err }, "admin/finance/recharges failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Phone number purchase orders — who bought which number, how, and for how much.
// Source of truth is phone_number_orders (Razorpay card + wallet purchases).
router.get("/admin/phone-purchases", async (req, res): Promise<void> => {
  try {
    const limit = Math.min(Number(req.query["limit"] ?? 200), 500);
    const offset = Number(req.query["offset"] ?? 0);
    // Default to completed purchases; pass ?status=all for pending/failed/cancelled too.
    const statusFilter = String(req.query["status"] ?? "completed");
    const numberTypeFilter = String(req.query["numberType"] ?? "all"); // local | whatsapp | all

    const conds: SQL[] = [];
    if (statusFilter !== "all") {
      conds.push(eq(phoneNumberOrdersTable.status, statusFilter));
    }
    if (numberTypeFilter !== "all") {
      conds.push(eq(phoneNumberOrdersTable.numberType, numberTypeFilter));
    }
    const where = conds.length ? and(...conds) : undefined;

    const [rows, [totals]] = await Promise.all([
      db
        .select({
          id: phoneNumberOrdersTable.id,
          userId: phoneNumberOrdersTable.userId,
          number: phoneNumberOrdersTable.number,
          countryCode: phoneNumberOrdersTable.countryCode,
          region: phoneNumberOrdersTable.region,
          numberType: phoneNumberOrdersTable.numberType,
          amountCents: phoneNumberOrdersTable.amountCents,
          promoCode: phoneNumberOrdersTable.promoCode,
          discountPaise: phoneNumberOrdersTable.discountPaise,
          renewalMode: phoneNumberOrdersTable.renewalMode,
          status: phoneNumberOrdersTable.status,
          razorpayOrderId: phoneNumberOrdersTable.razorpayOrderId,
          razorpayPaymentId: phoneNumberOrdersTable.razorpayPaymentId,
          phoneNumberId: phoneNumberOrdersTable.phoneNumberId,
          failureReason: phoneNumberOrdersTable.failureReason,
          createdAt: phoneNumberOrdersTable.createdAt,
          updatedAt: phoneNumberOrdersTable.updatedAt,
          userEmail: usersTable.email,
          userName: usersTable.name,
          userClerkId: usersTable.clerkId,
          userIsTest: usersTable.isTest,
        })
        .from(phoneNumberOrdersTable)
        .leftJoin(usersTable, eq(phoneNumberOrdersTable.userId, usersTable.clerkId))
        .where(where)
        .orderBy(desc(phoneNumberOrdersTable.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({
          total: count(),
          amountCents: sum(phoneNumberOrdersTable.amountCents),
        })
        .from(phoneNumberOrdersTable)
        .where(
          and(
            eq(phoneNumberOrdersTable.status, "completed"),
            numberTypeFilter !== "all"
              ? eq(phoneNumberOrdersTable.numberType, numberTypeFilter)
              : undefined,
          ),
        ),
    ]);

    res.json({
      rows,
      total: Number(totals?.total ?? 0),
      totalAmountCents: Number(totals?.amountCents ?? 0),
    });
  } catch (err) {
    req.log.error({ err }, "admin/phone-purchases failed");
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

router.get("/admin/platform/failed-calls/by-reason", async (req, res): Promise<void> => {
  try {
    // Aggregate over the same 100-row window as /platform/failed-calls.
    // Truncate at 120 chars before grouping so long variable messages (e.g. stack
    // traces with embedded request IDs) collapse into a single bucket.
    const rows = await db.execute<{ reason: string; count: number }>(sql`
      WITH recent_failed AS (
        SELECT error_message
        FROM calls
        WHERE status = 'failed'
        ORDER BY created_at DESC
        LIMIT 100
      ),
      labelled AS (
        SELECT
          CASE
            WHEN error_message ILIKE 'STT error%'       THEN 'STT error'
            WHEN error_message ILIKE 'LLM error%'       THEN 'LLM error'
            WHEN error_message ILIKE 'TTS error%'       THEN 'TTS error'
            WHEN error_message ILIKE 'Telephony error%' THEN 'Telephony error'
            WHEN error_message = 'Call timeout'
              OR error_message ILIKE 'timeout%'         THEN 'Call timeout'
            WHEN error_message IS NULL
              OR trim(error_message) = ''               THEN 'Unknown'
            ELSE coalesce(nullif(trim(left(error_message, 80)), ''), 'Unknown')
          END AS reason
        FROM recent_failed
      )
      SELECT reason, count(*)::int AS count
      FROM labelled
      GROUP BY reason
      ORDER BY count(*) DESC
      LIMIT 5
    `);

    res.json(rows.rows);
  } catch (err) {
    req.log.error({ err }, "admin/platform/failed-calls/by-reason failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/platform/failed-calls", async (req, res): Promise<void> => {
  try {
    const pageSize = Math.min(Math.max(Number(req.query["limit"] ?? 50), 1), 200);
    const page = Math.max(Number(req.query["page"] ?? 1), 1);
    const offset = (page - 1) * pageSize;

    const agentIdRaw = req.query["agentId"];
    const userIdRaw = req.query["userId"];
    const reasonRaw = req.query["reason"];

    const agentId = agentIdRaw ? Number(agentIdRaw) : null;
    const userId = typeof userIdRaw === "string" && userIdRaw.trim() ? userIdRaw.trim() : null;
    const reason = typeof reasonRaw === "string" && reasonRaw.trim() ? reasonRaw.trim() : null;

    const conditions = [eq(callsTable.status, "failed")];
    if (agentId !== null && !isNaN(agentId)) {
      conditions.push(eq(callsTable.agentId, agentId));
    }
    if (userId !== null) {
      conditions.push(ilike(callsTable.userId, `%${userId}%`));
    }
    if (reason !== null) {
      conditions.push(ilike(callsTable.errorMessage, `%${reason}%`));
    }

    const where = and(...conditions);

    const [failedCalls, [{ total }]] = await Promise.all([
      db
        .select({
          id: callsTable.id,
          userId: callsTable.userId,
          userEmail: usersTable.email,
          userName: usersTable.name,
          agentId: callsTable.agentId,
          agentName: agentsTable.name,
          status: callsTable.status,
          errorMessage: callsTable.errorMessage,
          createdAt: callsTable.createdAt,
        })
        .from(callsTable)
        .leftJoin(agentsTable, eq(callsTable.agentId, agentsTable.id))
        .leftJoin(usersTable, eq(callsTable.userId, usersTable.clerkId))
        .where(where)
        .orderBy(desc(callsTable.createdAt))
        .limit(pageSize)
        .offset(offset),
      db
        .select({ total: count() })
        .from(callsTable)
        .where(where),
    ]);

    res.json({ data: failedCalls, total, page, pageSize });
  } catch (err) {
    req.log.error({ err }, "admin/platform/failed-calls failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/platform/failed-calls/agents", async (req, res): Promise<void> => {
  try {
    const agents = await db
      .selectDistinct({
        id: agentsTable.id,
        name: agentsTable.name,
      })
      .from(callsTable)
      .innerJoin(agentsTable, eq(callsTable.agentId, agentsTable.id))
      .where(eq(callsTable.status, "failed"))
      .orderBy(agentsTable.name);

    res.json(agents);
  } catch (err) {
    req.log.error({ err }, "admin/platform/failed-calls/agents failed");
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

// ─── Growth Analytics v2 ──────────────────────────────────────────────────────

router.get("/admin/growth/funnel-v2", async (_req, res): Promise<void> => {
  try {
    const result = await pool.query(`
      WITH
        total           AS (SELECT COUNT(*)                                                          AS n FROM users),
        has_agent       AS (SELECT COUNT(DISTINCT user_id)                                           AS n FROM agents),
        has_provider    AS (SELECT COUNT(DISTINCT user_id)                                           AS n FROM providers),
        has_telephony   AS (SELECT COUNT(DISTINCT user_id)                                           AS n FROM agents WHERE telephony_provider IS NOT NULL AND telephony_provider <> ''),
        has_call        AS (SELECT COUNT(DISTINCT user_id)                                           AS n FROM calls),
        has_5calls      AS (SELECT COUNT(*)                                                          AS n FROM (SELECT user_id FROM calls GROUP BY user_id HAVING COUNT(*) >= 5)  s),
        has_20calls     AS (SELECT COUNT(*)                                                          AS n FROM (SELECT user_id FROM calls GROUP BY user_id HAVING COUNT(*) >= 20) s),
        t2a             AS (SELECT AVG(EXTRACT(EPOCH FROM (a.first_agent - u.created_at)) / 3600)   AS hours
                            FROM users u JOIN (SELECT user_id, MIN(created_at) AS first_agent FROM agents GROUP BY user_id) a ON a.user_id = u.clerk_id),
        t2c             AS (SELECT AVG(EXTRACT(EPOCH FROM (c.first_call  - u.created_at)) / 3600)   AS hours
                            FROM users u JOIN (SELECT user_id, MIN(created_at) AS first_call  FROM calls  GROUP BY user_id) c ON c.user_id = u.clerk_id),
        new7d           AS (SELECT COUNT(*) AS n FROM users WHERE created_at > NOW() - INTERVAL '7 days'),
        active7d        AS (SELECT COUNT(DISTINCT user_id) AS n FROM calls WHERE created_at > NOW() - INTERVAL '7 days'),
        new30d          AS (SELECT COUNT(*) AS n FROM users WHERE created_at > NOW() - INTERVAL '30 days'),
        active30d       AS (SELECT COUNT(DISTINCT user_id) AS n FROM calls WHERE created_at > NOW() - INTERVAL '30 days')
      SELECT
        total.n       AS total_users,
        has_agent.n   AS users_with_agent,
        has_provider.n AS users_with_provider,
        has_telephony.n AS users_with_telephony,
        has_call.n    AS users_with_call,
        has_5calls.n  AS users_with_5_calls,
        has_20calls.n AS users_with_20_calls,
        ROUND(t2a.hours::numeric, 1) AS avg_hours_to_first_agent,
        ROUND(t2c.hours::numeric, 1) AS avg_hours_to_first_call,
        new7d.n       AS new_users_7d,
        active7d.n    AS active_users_7d,
        new30d.n      AS new_users_30d,
        active30d.n   AS active_users_30d
      FROM total, has_agent, has_provider, has_telephony, has_call, has_5calls, has_20calls, t2a, t2c, new7d, active7d, new30d, active30d
    `);
    res.json(result.rows[0] ?? {});
  } catch (err) {
    logger.error({ err }, "growth/funnel-v2 failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/growth/cohorts", async (_req, res): Promise<void> => {
  try {
    const result = await pool.query(`
      WITH cohorts AS (
        SELECT date_trunc('week', created_at)::date AS week, COUNT(*) AS signups
        FROM users
        WHERE created_at > NOW() - INTERVAL '13 weeks'
        GROUP BY 1
      ),
      activations AS (
        SELECT date_trunc('week', u.created_at)::date AS week, COUNT(DISTINCT c.user_id) AS activated
        FROM users u
        JOIN (SELECT user_id, MIN(created_at) AS first_call FROM calls GROUP BY user_id) c ON c.user_id = u.clerk_id
        WHERE u.created_at > NOW() - INTERVAL '13 weeks'
        GROUP BY 1
      )
      SELECT
        c.week,
        c.signups,
        COALESCE(a.activated, 0) AS activated,
        ROUND(COALESCE(a.activated, 0) * 100.0 / NULLIF(c.signups, 0), 1) AS activation_rate
      FROM cohorts c
      LEFT JOIN activations a ON a.week = c.week
      ORDER BY c.week
    `);
    res.json(result.rows);
  } catch (err) {
    logger.error({ err }, "growth/cohorts failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/growth/user-journeys", async (req, res): Promise<void> => {
  try {
    const stage = (req.query.stage as string) || "all";
    const stageFilter = stage !== "all"
      ? `HAVING CASE
          WHEN COALESCE(c.call_count,0) >= 20 THEN 'power_user'
          WHEN COALESCE(c.call_count,0) >= 5  THEN 'active'
          WHEN COALESCE(c.call_count,0) >= 1  THEN 'made_call'
          WHEN COALESCE(ta.has_tele, false)   THEN 'has_telephony'
          WHEN COALESCE(p.provider_count,0) > 0 THEN 'has_provider'
          WHEN COALESCE(a.agent_count,0) > 0  THEN 'has_agent'
          ELSE 'signed_up'
        END = $1`
      : "";
    const params = stage !== "all" ? [stage] : [];
    const result = await pool.query(`
      SELECT
        u.clerk_id,
        u.email,
        u.name,
        u.created_at,
        ROUND(EXTRACT(EPOCH FROM (NOW() - u.created_at)) / 86400)::int AS days_since_signup,
        COALESCE(a.agent_count, 0)    AS agent_count,
        COALESCE(p.provider_count, 0) AS provider_count,
        COALESCE(ta.has_tele, false)  AS has_telephony,
        COALESCE(c.call_count, 0)     AS call_count,
        c.last_call_at,
        u.wallet_balance_cents,
        CASE
          WHEN COALESCE(c.call_count,0) >= 20  THEN 'power_user'
          WHEN COALESCE(c.call_count,0) >= 5   THEN 'active'
          WHEN COALESCE(c.call_count,0) >= 1   THEN 'made_call'
          WHEN COALESCE(ta.has_tele, false)    THEN 'has_telephony'
          WHEN COALESCE(p.provider_count,0) > 0 THEN 'has_provider'
          WHEN COALESCE(a.agent_count,0) > 0   THEN 'has_agent'
          ELSE 'signed_up'
        END AS stage
      FROM users u
      LEFT JOIN (SELECT user_id, COUNT(*) AS agent_count FROM agents GROUP BY user_id) a ON a.user_id = u.clerk_id
      LEFT JOIN (SELECT user_id, COUNT(*) AS provider_count FROM providers GROUP BY user_id) p ON p.user_id = u.clerk_id
      LEFT JOIN (SELECT user_id, bool_or(telephony_provider IS NOT NULL AND telephony_provider <> '') AS has_tele FROM agents GROUP BY user_id) ta ON ta.user_id = u.clerk_id
      LEFT JOIN (SELECT user_id, COUNT(*) AS call_count, MAX(created_at) AS last_call_at FROM calls GROUP BY user_id) c ON c.user_id = u.clerk_id
      GROUP BY u.clerk_id, u.email, u.name, u.created_at, u.wallet_balance_cents,
        a.agent_count, p.provider_count, ta.has_tele, c.call_count, c.last_call_at
      ${stageFilter}
      ORDER BY u.created_at DESC
      LIMIT 300
    `, params);
    res.json(result.rows);
  } catch (err) {
    logger.error({ err }, "growth/user-journeys failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/growth/dropoff-reasons", async (_req, res): Promise<void> => {
  try {
    const result = await pool.query(`
      WITH ud AS (
        SELECT
          u.clerk_id,
          COALESCE(a.agent_count, 0) > 0                              AS has_agent,
          COALESCE(p.provider_count, 0) > 0                           AS has_provider,
          COALESCE(ta.has_tele, false)                                 AS has_telephony,
          COALESCE(c.call_count, 0) > 0                               AS has_call,
          COALESCE(c.call_count, 0) >= 5                              AS is_active,
          COALESCE(vibe.vibe_count, 0) > 0                            AS used_vibe
        FROM users u
        LEFT JOIN (SELECT user_id, COUNT(*) AS agent_count    FROM agents    GROUP BY user_id) a  ON a.user_id  = u.clerk_id
        LEFT JOIN (SELECT user_id, COUNT(*) AS provider_count FROM providers GROUP BY user_id) p  ON p.user_id  = u.clerk_id
        LEFT JOIN (SELECT user_id, bool_or(telephony_provider IS NOT NULL AND telephony_provider <> '') AS has_tele FROM agents GROUP BY user_id) ta ON ta.user_id = u.clerk_id
        LEFT JOIN (SELECT user_id, COUNT(*) AS call_count     FROM calls     GROUP BY user_id) c  ON c.user_id  = u.clerk_id
        LEFT JOIN (SELECT user_id, COUNT(*) AS vibe_count FROM analytics_events WHERE event_name = 'vibe_started' GROUP BY user_id) vibe ON vibe.user_id = u.clerk_id
      )
      SELECT
        COUNT(*)                                                 AS total,
        COUNT(*) FILTER (WHERE NOT has_agent AND NOT used_vibe)  AS cold_dropoff,
        COUNT(*) FILTER (WHERE NOT has_agent AND used_vibe)      AS vibe_abandoned,
        COUNT(*) FILTER (WHERE has_agent AND NOT has_provider)   AS no_provider,
        COUNT(*) FILTER (WHERE has_agent AND has_provider AND NOT has_telephony AND NOT has_call) AS no_telephony,
        COUNT(*) FILTER (WHERE has_agent AND has_provider AND has_telephony AND NOT has_call)     AS configured_no_call,
        COUNT(*) FILTER (WHERE has_call AND NOT is_active)       AS one_and_done,
        COUNT(*) FILTER (WHERE is_active)                        AS active_users
      FROM ud
    `);
    res.json(result.rows[0] ?? {});
  } catch (err) {
    logger.error({ err }, "growth/dropoff-reasons failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/growth/event-stats", async (_req, res): Promise<void> => {
  try {
    const result = await pool.query(`
      SELECT
        event_name,
        COUNT(*)                                                                AS total,
        COUNT(DISTINCT user_id)                                                 AS unique_users,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')         AS last_7d,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')       AS last_24h
      FROM analytics_events
      GROUP BY event_name
      ORDER BY total DESC
    `);
    res.json(result.rows);
  } catch (err) {
    logger.error({ err }, "growth/event-stats failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Signups / Lifecycle Report ──────────────────────────────────────────────
// Per-user lifecycle timeline: when they signed up, acquisition channel + auth
// method, login history, activation, last-seen, and whether they ghosted
// (never activated / went inactive) or closed (suspended / deleted).
router.get("/admin/reports/signups", async (req, res): Promise<void> => {
  try {
    const segment = parseSegment(req.query.segment);
    // Validated segment → safe to build the WHERE clause; still parameterised.
    const where =
      segment === "all" ? "" : "WHERE u.is_test = $1";
    const params = segment === "all" ? [] : [segment === "test"];

    const result = await pool.query(`
      WITH ev AS (
        SELECT user_id,
          COUNT(*) FILTER (WHERE event_name = 'login')            AS login_count,
          MIN(created_at) FILTER (WHERE event_name = 'login')     AS first_login_at,
          MAX(created_at) FILTER (WHERE event_name = 'login')     AS last_login_at,
          MIN(created_at) FILTER (WHERE event_name = 'vibe_started') AS first_vibe_at
        FROM analytics_events
        GROUP BY user_id
      ),
      ag AS (
        SELECT user_id, COUNT(*) AS agent_count,
          MIN(created_at) AS first_agent_at, MAX(created_at) AS last_agent_at
        FROM agents GROUP BY user_id
      ),
      ca AS (
        SELECT user_id, COUNT(*) AS call_count,
          MIN(created_at) AS first_call_at, MAX(created_at) AS last_call_at,
          COALESCE(SUM(duration_seconds), 0) AS total_duration_seconds
        FROM calls GROUP BY user_id
      )
      SELECT
        u.clerk_id,
        u.email,
        u.name,
        u.is_test,
        u.status,
        u.suspended_at,
        u.suspended_reason,
        u.onboarding_completed,
        u.onboarding_data->>'role'           AS role,
        u.onboarding_data->>'referralSource' AS referral_source,
        CASE WHEN u.password_hash IS NOT NULL THEN 'password' ELSE 'google' END AS auth_method,
        u.created_at                          AS signed_up_at,
        COALESCE(ev.login_count, 0)           AS login_count,
        ev.first_login_at,
        ev.last_login_at,
        ev.first_vibe_at,
        COALESCE(ag.agent_count, 0)           AS agent_count,
        ag.first_agent_at,
        COALESCE(ca.call_count, 0)            AS call_count,
        ca.first_call_at,
        ca.last_call_at,
        COALESCE(ca.total_duration_seconds, 0) AS total_duration_seconds,
        GREATEST(
          u.created_at,
          COALESCE(ev.last_login_at, u.created_at),
          COALESCE(ca.last_call_at,  u.created_at),
          COALESCE(ag.last_agent_at, u.created_at)
        ) AS last_seen_at,
        CASE
          WHEN u.status = 'deleted'   THEN 'closed'
          WHEN u.status = 'suspended' THEN 'suspended'
          WHEN NOT u.onboarding_completed AND COALESCE(ag.agent_count,0) = 0 AND COALESCE(ca.call_count,0) = 0
            THEN 'never_activated'
          WHEN GREATEST(
                 u.created_at,
                 COALESCE(ev.last_login_at, u.created_at),
                 COALESCE(ca.last_call_at,  u.created_at),
                 COALESCE(ag.last_agent_at, u.created_at)
               ) < NOW() - INTERVAL '7 days'
            THEN 'inactive'
          ELSE 'active'
        END AS lifecycle
      FROM users u
      LEFT JOIN ev ON ev.user_id = u.clerk_id
      LEFT JOIN ag ON ag.user_id = u.clerk_id
      LEFT JOIN ca ON ca.user_id = u.clerk_id
      ${where}
      ORDER BY u.created_at DESC
      LIMIT 1000
    `, params);

    // Lifecycle rollup so the UI can show summary counts without re-querying.
    const summary = { total: 0, active: 0, inactive: 0, never_activated: 0, suspended: 0, closed: 0 } as Record<string, number>;
    for (const row of result.rows) {
      summary.total += 1;
      const key = String(row.lifecycle);
      if (key in summary) summary[key] += 1;
    }

    res.json({ summary, rows: result.rows });
  } catch (err) {
    logger.error({ err }, "reports/signups failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Alert Notification Settings ─────────────────────────────────────────────

const ALERT_NOTIFICATION_EMAIL_KEY = "alert_notification_email";
const ALERT_SLACK_WEBHOOK_KEY = "alert_slack_webhook_url";
const ALERT_MIN_SEVERITY_KEY = "alert_min_severity";
const ALERT_COOLDOWN_KEY = "alert_notification_cooldown_minutes";
const VALID_SEVERITIES = ["info", "warning", "critical"] as const;

router.get("/admin/settings/alert-email", async (req, res): Promise<void> => {
  try {
    const [row] = await db
      .select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, ALERT_NOTIFICATION_EMAIL_KEY));
    res.json({ email: row?.value ?? null });
  } catch (err) {
    req.log.error({ err }, "admin/settings/alert-email GET failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/admin/settings/alert-email", async (req, res): Promise<void> => {
  try {
    const { email } = req.body as { email: string | null };
    if (email === null || email === "") {
      await db.delete(platformSettingsTable).where(eq(platformSettingsTable.key, ALERT_NOTIFICATION_EMAIL_KEY));
      res.json({ email: null });
      return;
    }
    if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: "email must be a valid email address or null to clear" });
      return;
    }
    await db
      .insert(platformSettingsTable)
      .values({ key: ALERT_NOTIFICATION_EMAIL_KEY, value: email })
      .onConflictDoUpdate({
        target: platformSettingsTable.key,
        set: { value: email, updatedAt: new Date() },
      });
    res.json({ email });
  } catch (err) {
    req.log.error({ err }, "admin/settings/alert-email PUT failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/settings/alert-slack-webhook", async (req, res): Promise<void> => {
  try {
    const [row] = await db
      .select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, ALERT_SLACK_WEBHOOK_KEY));
    res.json({ webhookUrl: row?.value ?? null });
  } catch (err) {
    req.log.error({ err }, "admin/settings/alert-slack-webhook GET failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/admin/settings/alert-slack-webhook", async (req, res): Promise<void> => {
  try {
    const { webhookUrl } = req.body as { webhookUrl: string | null };
    if (webhookUrl === null || webhookUrl === "") {
      await db.delete(platformSettingsTable).where(eq(platformSettingsTable.key, ALERT_SLACK_WEBHOOK_KEY));
      res.json({ webhookUrl: null });
      return;
    }
    if (typeof webhookUrl !== "string" || !webhookUrl.startsWith("https://")) {
      res.status(400).json({ error: "webhookUrl must be a valid https URL or null to clear" });
      return;
    }
    await db
      .insert(platformSettingsTable)
      .values({ key: ALERT_SLACK_WEBHOOK_KEY, value: webhookUrl })
      .onConflictDoUpdate({
        target: platformSettingsTable.key,
        set: { value: webhookUrl, updatedAt: new Date() },
      });
    res.json({ webhookUrl });
  } catch (err) {
    req.log.error({ err }, "admin/settings/alert-slack-webhook PUT failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/settings/alert-min-severity", async (req, res): Promise<void> => {
  try {
    const [row] = await db
      .select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, ALERT_MIN_SEVERITY_KEY));
    res.json({ minSeverity: row?.value ?? "warning" });
  } catch (err) {
    req.log.error({ err }, "admin/settings/alert-min-severity GET failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

const TEST_NOTIF_MAX = 3;
const TEST_NOTIF_WINDOW_MS = 60_000;

function testNotifRateLimitKey(ip: string): string {
  return `test_notif_rate_limit:${ip}`;
}

router.post("/admin/settings/alert-notifications/test", async (req, res): Promise<void> => {
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const key = testNotifRateLimitKey(ip);
  const now = Date.now();

  const [existing] = await db
    .select({ value: platformSettingsTable.value })
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.key, key));

  const raw: unknown = existing?.value ? JSON.parse(existing.value) : [];
  const timestamps = (Array.isArray(raw) ? (raw as number[]) : []).filter(
    (t) => now - t < TEST_NOTIF_WINDOW_MS,
  );

  if (timestamps.length >= TEST_NOTIF_MAX) {
    const retryAfterSec = Math.ceil((TEST_NOTIF_WINDOW_MS - (now - timestamps[0]!)) / 1000);
    res.setHeader("Retry-After", String(retryAfterSec));
    res.status(429).json({ error: `Too many test notifications. Wait ${retryAfterSec} seconds before trying again.` });
    return;
  }
  timestamps.push(now);

  await db
    .insert(platformSettingsTable)
    .values({ key, value: JSON.stringify(timestamps) })
    .onConflictDoUpdate({
      target: platformSettingsTable.key,
      set: { value: JSON.stringify(timestamps), updatedAt: new Date() },
    });

  try {
    const result = await sendTestAlertNotification();
    if (!result.email && !result.slack) {
      res.status(422).json({ error: "No notification channels configured. Set an alert email or Slack webhook first." });
      return;
    }
    const parts: string[] = [];
    if (result.email) parts.push("email");
    if (result.slack) parts.push("Slack");
    res.json({ ok: true, sent: parts, message: `Test notification sent via ${parts.join(" and ")}.` });
  } catch (err) {
    req.log.warn({ err }, "admin/settings/alert-notifications/test failed");
    const message = err instanceof Error ? err.message : "Failed to send test notification";
    res.status(500).json({ error: message });
  }
});

router.put("/admin/settings/alert-min-severity", async (req, res): Promise<void> => {
  try {
    const { minSeverity } = req.body as { minSeverity: string };
    if (!VALID_SEVERITIES.includes(minSeverity as (typeof VALID_SEVERITIES)[number])) {
      res.status(400).json({ error: `minSeverity must be one of: ${VALID_SEVERITIES.join(", ")}` });
      return;
    }
    await db
      .insert(platformSettingsTable)
      .values({ key: ALERT_MIN_SEVERITY_KEY, value: minSeverity })
      .onConflictDoUpdate({
        target: platformSettingsTable.key,
        set: { value: minSeverity, updatedAt: new Date() },
      });
    res.json({ minSeverity });
  } catch (err) {
    req.log.error({ err }, "admin/settings/alert-min-severity PUT failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/settings/alert-notification-cooldown", async (req, res): Promise<void> => {
  try {
    const [row] = await db
      .select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, ALERT_COOLDOWN_KEY));
    const parsed = row?.value ? parseInt(row.value, 10) : NaN;
    const cooldownMinutes = Number.isFinite(parsed) && parsed >= 0 ? parsed : 10;
    res.json({ cooldownMinutes });
  } catch (err) {
    req.log.error({ err }, "admin/settings/alert-notification-cooldown GET failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/admin/settings/alert-notification-cooldown", async (req, res): Promise<void> => {
  try {
    const { cooldownMinutes } = req.body as { cooldownMinutes: number };
    if (typeof cooldownMinutes !== "number" || !Number.isFinite(cooldownMinutes) || cooldownMinutes < 0 || !Number.isInteger(cooldownMinutes)) {
      res.status(400).json({ error: "cooldownMinutes must be a non-negative integer" });
      return;
    }
    await db
      .insert(platformSettingsTable)
      .values({ key: ALERT_COOLDOWN_KEY, value: String(cooldownMinutes) })
      .onConflictDoUpdate({
        target: platformSettingsTable.key,
        set: { value: String(cooldownMinutes), updatedAt: new Date() },
      });
    res.json({ cooldownMinutes });
  } catch (err) {
    req.log.error({ err }, "admin/settings/alert-notification-cooldown PUT failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/settings/alert-notification-cooldown/stats", (req, res): void => {
  const stats = getAlertCooldownStats();
  res.json(stats);
});

router.post("/admin/settings/alert-notification-cooldown/stats/reset", (req, res): void => {
  resetAlertSuppressedCount();
  req.log.info("Alert suppressed-notification counter reset by admin");
  res.json({ ok: true });
});

// ─── Spike Alert Settings ─────────────────────────────────────────────────────

const SPIKE_THRESHOLD_KEY = "usage_spike_daily_threshold";
const SPIKE_ALERT_EMAIL_KEY = "usage_spike_admin_email";

router.get("/admin/settings/spike-threshold", async (req, res): Promise<void> => {
  try {
    const [row] = await db
      .select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, SPIKE_THRESHOLD_KEY));
    res.json({ threshold: row ? Number(row.value) : null });
  } catch (err) {
    req.log.error({ err }, "admin/settings/spike-threshold GET failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/admin/settings/spike-threshold", async (req, res): Promise<void> => {
  try {
    const { threshold } = req.body as { threshold: number | null };
    if (threshold === null || threshold === undefined) {
      await db.delete(platformSettingsTable).where(eq(platformSettingsTable.key, SPIKE_THRESHOLD_KEY));
      res.json({ threshold: null });
      return;
    }
    if (typeof threshold !== "number" || !Number.isInteger(threshold) || threshold < 1) {
      res.status(400).json({ error: "threshold must be a positive integer or null to clear" });
      return;
    }
    await db
      .insert(platformSettingsTable)
      .values({ key: SPIKE_THRESHOLD_KEY, value: String(threshold) })
      .onConflictDoUpdate({
        target: platformSettingsTable.key,
        set: { value: String(threshold), updatedAt: new Date() },
      });
    res.json({ threshold });
  } catch (err) {
    req.log.error({ err }, "admin/settings/spike-threshold PUT failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/settings/spike-email", async (req, res): Promise<void> => {
  try {
    const [row] = await db
      .select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, SPIKE_ALERT_EMAIL_KEY));
    res.json({ email: row?.value ?? null });
  } catch (err) {
    req.log.error({ err }, "admin/settings/spike-email GET failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/admin/settings/spike-email", async (req, res): Promise<void> => {
  try {
    const { email } = req.body as { email: string | null };
    if (email === null || email === "") {
      await db.delete(platformSettingsTable).where(eq(platformSettingsTable.key, SPIKE_ALERT_EMAIL_KEY));
      res.json({ email: null });
      return;
    }
    if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: "email must be a valid email address or null" });
      return;
    }
    await db
      .insert(platformSettingsTable)
      .values({ key: SPIKE_ALERT_EMAIL_KEY, value: email })
      .onConflictDoUpdate({
        target: platformSettingsTable.key,
        set: { value: email, updatedAt: new Date() },
      });
    res.json({ email });
  } catch (err) {
    req.log.error({ err }, "admin/settings/spike-email PUT failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Spike Alerts ─────────────────────────────────────────────────────────────

router.get("/admin/alerts/spikes", async (req, res): Promise<void> => {
  try {
    const [thresholdRow] = await db
      .select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, SPIKE_THRESHOLD_KEY));

    const threshold = thresholdRow ? Number(thresholdRow.value) : null;
    const todayStr = new Date().toISOString().slice(0, 10);

    const spikes = await db
      .select({
        clerkId: callsTable.userId,
        email: usersTable.email,
        name: usersTable.name,
        callCount: count(),
      })
      .from(callsTable)
      .leftJoin(usersTable, eq(callsTable.userId, usersTable.clerkId))
      .where(gt(callsTable.createdAt, sql`current_date::timestamptz`))
      .groupBy(callsTable.userId, usersTable.email, usersTable.name)
      .orderBy(desc(count()));

    const [dismissals, notifications] = await Promise.all([
      db
        .select({ clerkId: usageSpikeDismissalsTable.clerkId })
        .from(usageSpikeDismissalsTable)
        .where(eq(usageSpikeDismissalsTable.dismissedDate, todayStr)),
      db
        .select({ clerkId: usageSpikeNotificationsTable.clerkId })
        .from(usageSpikeNotificationsTable)
        .where(eq(usageSpikeNotificationsTable.notifiedDate, todayStr)),
    ]);

    const dismissedSet = new Set(dismissals.map((d) => d.clerkId));
    const notifiedSet = new Set(notifications.map((n) => n.clerkId));

    const alerts = spikes
      .filter((r) => threshold !== null && Number(r.callCount) >= threshold)
      .map((r) => ({
        clerkId: r.clerkId,
        email: r.email,
        name: r.name,
        callCount: Number(r.callCount),
        dismissed: dismissedSet.has(r.clerkId ?? ""),
        notified: notifiedSet.has(r.clerkId ?? ""),
      }));

    res.json({ threshold, alerts });
  } catch (err) {
    req.log.error({ err }, "admin/alerts/spikes failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/alerts/spikes/:clerkId/dismiss", async (req, res): Promise<void> => {
  try {
    const { clerkId } = req.params;
    const todayStr = new Date().toISOString().slice(0, 10);
    await db
      .insert(usageSpikeDismissalsTable)
      .values({ clerkId: clerkId!, dismissedDate: todayStr })
      .onConflictDoNothing();
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "admin/alerts/spikes/:clerkId/dismiss failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Alert Cooldown Status ────────────────────────────────────────────────────

router.get("/admin/alerts/cooldown-status", async (req, res): Promise<void> => {
  try {
    const status = await getAlertCooldownStatus();
    res.json(status);
  } catch (err) {
    req.log.error({ err }, "admin/alerts/cooldown-status GET failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Alert Notification Delivery Log ─────────────────────────────────────────

router.get("/admin/alert-notification-log", async (req, res): Promise<void> => {
  try {
    const limitParam = req.query["limit"];
    const limit = Math.min(Number(limitParam) || 50, 200);

    const rows = await db
      .select()
      .from(alertNotificationLogTable)
      .orderBy(desc(alertNotificationLogTable.createdAt))
      .limit(limit);

    const lastSentEmail = rows.find((r) => r.channel === "email" && r.status === "sent")?.createdAt ?? null;
    const lastFailedEmail = rows.find((r) => r.channel === "email" && r.status === "failed")?.createdAt ?? null;
    const lastSentSlack = rows.find((r) => r.channel === "slack" && r.status === "sent")?.createdAt ?? null;
    const lastFailedSlack = rows.find((r) => r.channel === "slack" && r.status === "failed")?.createdAt ?? null;

    res.json({
      summary: {
        email: { lastSentAt: lastSentEmail, lastFailedAt: lastFailedEmail },
        slack: { lastSentAt: lastSentSlack, lastFailedAt: lastFailedSlack },
      },
      entries: rows,
    });
  } catch (err) {
    req.log.error({ err }, "admin/alert-notification-log GET failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Per-minute reseller rates ─────────────────────────────────────────────────

router.get("/admin/minute-rates", async (req, res): Promise<void> => {
  try {
    const rows = await db
      .select()
      .from(providerMinuteRatesTable)
      .orderBy(providerMinuteRatesTable.category, providerMinuteRatesTable.providerName);
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "admin/minute-rates GET failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/admin/minute-rates", async (req, res): Promise<void> => {
  const { category, providerName, rateCentsPerMin, label } = req.body as {
    category?: string;
    providerName?: string;
    rateCentsPerMin?: number;
    label?: string;
  };
  if (!category || !providerName || typeof rateCentsPerMin !== "number") {
    res.status(400).json({ error: "category, providerName, and rateCentsPerMin are required" });
    return;
  }
  const validCategories = ["llm", "asr", "tts", "telephony"];
  if (!validCategories.includes(category)) {
    res.status(400).json({ error: `category must be one of: ${validCategories.join(", ")}` });
    return;
  }
  try {
    const [row] = await db
      .insert(providerMinuteRatesTable)
      .values({ category, providerName: providerName.toLowerCase(), rateCentsPerMin, label: label ?? null })
      .onConflictDoUpdate({
        target: [providerMinuteRatesTable.category, providerMinuteRatesTable.providerName],
        set: {
          rateCentsPerMin,
          label: label ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();
    invalidateMinuteRatesCache();
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "admin/minute-rates PUT failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

async function checkDb(): Promise<{ status: string; detail?: string }> {
  const client = await pool.connect();
  try {
    await client.query("SELECT 1");
    return { status: "ok", detail: `pool: ${pool.totalCount} / ${pool.options.max}` };
  } catch (err) {
    return { status: "error", detail: err instanceof Error ? err.message : String(err) };
  } finally {
    client.release();
  }
}

router.get("/admin/health", async (req, res): Promise<void> => {
  const checks: Record<string, { status: string; detail?: string }> = {};
  let overall = "ok";

  // DB connectivity
  checks["db"] = await checkDb();
  if (checks["db"].status === "error") overall = "degraded";

  // Redis
  try {
    const redis = getRedis();
    if (redis) {
      await redis.ping();
      checks["redis"] = { status: "ok" };
    } else {
      checks["redis"] = { status: "warn", detail: "Redis not configured" };
    }
  } catch (err) {
    checks["redis"] = { status: "error", detail: err instanceof Error ? err.message : String(err) };
    overall = "degraded";
  }

  // Active calls — warn at 100, degrade at 150
  const activeSessions = getAllSessions();
  const activeCalls = activeSessions.length;
  checks["activeCalls"] = { status: "ok", detail: `${activeCalls} active calls` };
  if (activeCalls > 150) {
    checks["activeCalls"].status = "warn";
    overall = "degraded";
  } else if (activeCalls > 100) {
    checks["activeCalls"].status = "warn";
  }

  // Campaign concurrency
  const campaignConcurrency = getAllCampaignConcurrency();
  const campaignDetails = Array.from(campaignConcurrency.entries()).map(([id, count]) => `campaign ${id}: ${count}`).join(", ");
  checks["campaignConcurrency"] = { status: "ok", detail: campaignDetails || "none" };

  checks["load"] = { status: "ok", detail: `${activeCalls} active / ${activeSessions.length} sessions` };
  if (activeCalls > 200) {
    checks["load"].status = "warn";
    overall = "degraded";
  }

  res.json({ status: overall, checks, timestamp: new Date().toISOString() });
});

router.delete("/admin/minute-rates/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] ?? "");
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(providerMinuteRatesTable).where(eq(providerMinuteRatesTable.id, id));
    invalidateMinuteRatesCache();
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "admin/minute-rates DELETE failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Vobiz master wallet balance ───────────────────────────────────────────────

router.get("/admin/vobiz-balance", async (req, res): Promise<void> => {
  const authId    = process.env["VOBIZ_AUTH_ID"];
  const authToken = process.env["VOBIZ_AUTH_TOKEN"];
  if (!authId || !authToken) {
    res.status(503).json({ error: "VOBIZ_AUTH_ID / VOBIZ_AUTH_TOKEN not configured on the server" });
    return;
  }
  try {
    // Vobiz Account-level API uses HTTP Basic Auth, NOT X-Auth headers.
    const basicCreds = Buffer.from(`${authId}:${authToken}`).toString("base64");
    const headers = { "Authorization": `Basic ${basicCreds}`, "Accept": "application/json" };

    const resp = await fetch(
      `https://api.vobiz.ai/api/v1/Account/${authId}/balance/INR`,
      { headers },
    );
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      req.log.warn({ status: resp.status, body }, "Vobiz balance fetch failed");
      res.status(502).json({ error: `Vobiz API returned ${resp.status}`, detail: body });
      return;
    }
    const data = await resp.json() as Record<string, unknown>;
    res.json({
      balance:          data["balance"]           ?? null,
      availableBalance: data["available_balance"] ?? null,
      currency:         (data["currency"] as string) ?? "INR",
      lowBalanceThreshold: data["low_balance_threshold"] ?? null,
      status:           data["status"] ?? null,
      raw:              data,
    });
  } catch (err) {
    req.log.error({ err }, "admin/vobiz-balance failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── VoBiz wallet monitor status (for admin dashboard) ────────────────────────
router.get("/admin/vobiz-wallet-status", requireAdmin, async (req, res): Promise<void> => {
  try {
    const status = await getVobizWalletStatus();
    res.json(status);
  } catch (err) {
    req.log.error({ err }, "admin/vobiz-wallet-status failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Railway Deployment Log ────────────────────────────────────────────────────

router.get("/admin/deployments", requireAdmin, async (_req, res): Promise<void> => {
  try {
    const result = await pool.query(`
      SELECT id, railway_deploy_id AS "railwayDeployId", project_id AS "projectId",
             service_id AS "serviceId", service_name AS "serviceName",
             environment, status, deploy_url AS "deployUrl",
             commit_message AS "commitMessage", commit_hash AS "commitHash",
             triggered_by AS "triggeredBy", created_at AS "createdAt"
      FROM deployment_events
      ORDER BY created_at DESC
      LIMIT 200
    `);
    res.json(result.rows);
  } catch (err) {
    logger.error({ err }, "admin/deployments failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Ambient Sounds ────────────────────────────────────────────────────────────
// Returns the built-in synthesized ambient tracks so the Family agent form can
// show a dropdown.  Each entry matches the AmbientSound interface in the frontend.
router.get("/admin/ambient-sounds", requireAdmin, (_req, res) => {
  const LABELS: Record<string, string> = {
    "office-ambience": "Office Ambience",
    "cafe":            "Café",
    "coffee-shop":     "Coffee Shop",
    "convention-hall": "Convention Hall",
    "home":            "Home",
    "outdoor":         "Outdoor",
    "restaurant":      "Restaurant",
  };
  const sounds = Object.keys(TRACK_PARAMS).map(id => ({
    id,
    name: LABELS[id] ?? id,
    mimeType: "audio/pcm-synthesized",
    fileSize: 0,
    durationSeconds: null,
  }));
  res.json(sounds);
});

// ── Family Agent Provision ────────────────────────────────────────────────────
// Creates or updates a VoiceOrch agent record from a Family localStorage agent config.
// Returns the integer agentId so the webcall WebSocket can connect to it.
router.post("/admin/family/provision", async (req, res): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;
    const familyAgentId = body["familyAgentId"] as string | undefined;
    if (!familyAgentId) { res.status(400).json({ error: "familyAgentId required" }); return; }

    const asrProvider       = (body["asrProvider"] as string) || "sarvam";
    const llmProvider       = (body["llmProvider"] as string) || "qwen";
    const ttsProvider       = (body["ttsProvider"] as string) || "sarvam";
    const telephonyProvider = (body["telephonyProvider"] as string) || "vobiz";
    const ambientSoundId    = (body["ambientSoundId"] as string | undefined) ?? null;

    const agentConfigPayload = {
      familyAgentId,
      isTestAgent: true,
      ...(ambientSoundId ? { ambientNoiseEnabled: true, ambientNoiseTrack: ambientSoundId } : {}),
    };

    const agentData = {
      name:            (body["name"] as string) || "Family Test Agent",
      agentMode:       "managed" as const,
      agentType:       "general" as const,
      status:          "testing",
      systemPrompt:    (body["systemPrompt"] as string) || "",
      asrProvider,
      asrModel:        (body["asrModel"] as string | undefined) ?? null,
      asrLanguage:     (body["asrLanguage"] as string | undefined) ?? null,
      asrBackgroundDenoising: Boolean(body["asrBackgroundDenoising"]),
      asrConfidenceThreshold: typeof body["asrConfidenceThreshold"] === "number" ? body["asrConfidenceThreshold"] as number : null,
      asrEndOfTurnConfidence: typeof body["asrEndOfTurnConfidence"] === "number" ? body["asrEndOfTurnConfidence"] as number : null,
      asrEndOfTurnTimeout:    typeof body["asrEndOfTurnTimeout"]    === "number" ? body["asrEndOfTurnTimeout"]    as number : null,
      asrKeyterms:     (body["asrKeyterms"] as string | undefined) ?? null,
      asrSmartEndpointing: (body["asrSmartEndpointing"] as string | undefined) ?? "off",
      asrAutoFallback: Boolean(body["asrAutoFallback"]),
      llmProvider,
      llmModel:        (body["llmModel"]   as string | undefined) ?? null,
      ttsProvider,
      ttsVoice:        (body["ttsVoice"]   as string | undefined) ?? null,
      ttsModel:        (body["ttsModel"]   as string | undefined) ?? null,
      telephonyProvider,
      temperature:     typeof body["temperature"]   === "number" ? body["temperature"]   as number : null,
      maxDuration:     typeof body["maxDuration"]    === "number" ? body["maxDuration"]    as number : null,
      greetingMessage: (body["greetingMessage"]  as string | undefined) ?? null,
      endCallPhrases:  (body["endCallPhrases"]   as string | undefined) ?? null,
      language:        (body["language"]          as string | undefined) ?? null,
      backchannelingEnabled:   Boolean(body["backchannelingEnabled"]),
      backchannelingFrequency: typeof body["backchannelingFrequency"] === "number" ? body["backchannelingFrequency"] as number : null,
      noiseCancellationEnabled: Boolean(body["noiseCancellationEnabled"]),
      inactivityMessage:        (body["inactivityMessage"] as string | undefined) ?? null,
      webhookUrl:               (body["webhookUrl"]        as string | undefined) ?? null,
      silenceTimeoutSeconds:    typeof body["silenceTimeoutSeconds"] === "number" ? body["silenceTimeoutSeconds"] as number : null,
      dispositionSchema:        Array.isArray(body["dispositionSchema"]) ? body["dispositionSchema"] as { key: string; label: string; type: "text" | "number" | "boolean" | "choice"; options?: string[]; required?: boolean }[] : null,
      agentConfig:              agentConfigPayload as Record<string, unknown>,
      userId:                   null,
    };

    // Find existing agent provisioned for this family agent
    const [existing] = await db.select({ id: agentsTable.id })
      .from(agentsTable)
      .where(sql`agent_config->>'familyAgentId' = ${familyAgentId}`)
      .limit(1);

    if (existing) {
      await db.update(agentsTable).set(agentData).where(eq(agentsTable.id, existing.id));
      res.json({ agentId: existing.id });
    } else {
      const [created] = await db.insert(agentsTable).values(agentData).returning({ id: agentsTable.id });
      res.json({ agentId: created!.id });
    }
  } catch (err) {
    req.log.error({ err }, "admin/family/provision failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Token Optimization Kill Switch ──────────────────────────────────────────

const TOKEN_OPT_KEY = "token_optimization_enabled";

router.get("/admin/settings/token-optimization", async (req, res): Promise<void> => {
  try {
    const [row] = await db
      .select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, TOKEN_OPT_KEY));
    const enabled = row?.value !== "false";
    res.json({ enabled });
  } catch (err) {
    req.log.error({ err }, "admin/settings/token-optimization GET failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/admin/settings/token-optimization", async (req, res): Promise<void> => {
  try {
    const { enabled } = req.body as { enabled: boolean };
    if (typeof enabled !== "boolean") {
      res.status(400).json({ error: "enabled must be a boolean" });
      return;
    }
    await db
      .insert(platformSettingsTable)
      .values({ key: TOKEN_OPT_KEY, value: String(enabled) })
      .onConflictDoUpdate({
        target: platformSettingsTable.key,
        set: { value: String(enabled), updatedAt: new Date() },
      });
    res.json({ enabled });
  } catch (err) {
    req.log.error({ err }, "admin/settings/token-optimization PUT failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── DPDP Erasure (right to be forgotten) ─────────────────────────────────────
// Admin-triggered only. Anonymizes all call PII for a given phone number and
// records an erasure-request audit row. Never automatic; never affects dialing.
router.post("/admin/dpdp/erasure", async (req, res): Promise<void> => {
  try {
    const phoneNumber = typeof req.body?.phoneNumber === "string" ? req.body.phoneNumber.trim() : "";
    if (!phoneNumber) { res.status(400).json({ error: "phoneNumber is required" }); return; }
    const result = await processErasureRequest(phoneNumber);
    res.json({ ok: true, anonymizedCalls: result.anonymizedCalls });
  } catch (err) {
    req.log.error({ err }, "admin/dpdp/erasure failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Test Email ───────────────────────────────────────────────────────────────

router.post("/admin/test-email", async (req, res): Promise<void> => {
  const gmailUser = process.env["GMAIL_USER"];
  const gmailPass = process.env["GMAIL_APP_PASSWORD"];

  if (!gmailUser || !gmailPass) {
    res.status(503).json({ ok: false, message: "GMAIL_USER or GMAIL_APP_PASSWORD not configured" });
    return;
  }

  const { to } = req.body as { to?: string };
  if (!to || typeof to !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())) {
    res.status(400).json({ ok: false, message: "Invalid or missing 'to' email address" });
    return;
  }

  const recipient = to.trim();

  try {
    await sendTestEmail(recipient);

    res.json({ ok: true, message: `Test email sent to ${recipient}` });
  } catch (err) {
    req.log.error({ err }, "admin/test-email failed");
    res.status(500).json({ ok: false, message: "SMTP error — check server logs for details" });
  }
});

// ─── GitHub Sync Status ───────────────────────────────────────────────────────

router.get("/admin/github-sync", async (req, res): Promise<void> => {
  const token = process.env["GITHUB_PERSONAL_ACCESS_TOKEN"];
  const repo  = "srundme/voiceorch";
  try {
    const ghRes = await fetch(`https://api.github.com/repos/${repo}/commits/main`, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "VoiceOrch-Admin",
        ...(token ? { Authorization: `token ${token}` } : {}),
      },
    });
    if (!ghRes.ok) {
      res.status(502).json({ error: `GitHub API returned ${ghRes.status}` });
      return;
    }
    const data = await ghRes.json() as {
      sha: string;
      commit: {
        message: string;
        author: { name: string; date: string };
      };
      html_url: string;
    };
    res.json({
      sha:       data.sha,
      shortSha:  data.sha.slice(0, 7),
      message:   data.commit.message.split("\n")[0],
      author:    data.commit.author.name,
      pushedAt:  data.commit.author.date,
      url:       data.html_url,
      repo,
    });
  } catch (err) {
    req.log.error({ err }, "admin/github-sync failed");
    res.status(502).json({ error: "Failed to reach GitHub API" });
  }
});

// ── Google Calendar Connections diagnostic ────────────────────────────────────

router.get("/admin/gcal-connections", async (req, res): Promise<void> => {
  try {
    const rows = await db.execute(
      sql`
        SELECT
          gcc.id,
          gcc.email AS connected_email,
          gcc.granted_scopes,
          gcc.token_expiry,
          gcc.updated_at,
          u.email AS user_email
        FROM google_calendar_connections gcc
        LEFT JOIN users u ON u.clerk_id = gcc.user_id
        ORDER BY gcc.updated_at DESC
        LIMIT 1000
      `
    );

    // Only the full calendar scope supports conferenceDataVersion=1 (Meet link creation).
    // calendar.events is insufficient; legacy NULL connections are also treated as invalid.
    const FULL_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

    const data = (rows.rows as any[]).map((r: any) => {
      const scopeValid = !!(r.granted_scopes && (r.granted_scopes as string).split(/\s+/).includes(FULL_CALENDAR_SCOPE));
      return {
        id: r.id,
        userEmail: r.user_email ?? null,
        connectedEmail: r.connected_email,
        grantedScopes: r.granted_scopes ?? null,
        scopeValid,
        tokenExpiry: r.token_expiry ? new Date(r.token_expiry).toISOString() : null,
        updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
      };
    });

    res.json(data);
  } catch (err) {
    req.log.error({ err }, "admin/gcal-connections failed");
    res.status(500).json({ error: "Failed to load Google Calendar connections" });
  }
});

// GET /api/admin/book/interns — list all registered interns with progress
router.get("/admin/book/interns", async (req, res): Promise<void> => {
  try {
    const interns = await db
      .select()
      .from(bookInternsTable)
      .orderBy(desc(bookInternsTable.registeredAt));

    const result = await Promise.all(
      interns.map(async (intern) => {
        const [progress] = intern.deviceId
          ? await db
              .select({ completedChapters: bookProgressTable.completedChapters })
              .from(bookProgressTable)
              .where(eq(bookProgressTable.deviceId, intern.deviceId))
              .limit(1)
          : [undefined];

        const examRows = intern.deviceId
          ? await db
              .select({ passed: bookExamAttemptsTable.passed, score: bookExamAttemptsTable.score })
              .from(bookExamAttemptsTable)
              .where(eq(bookExamAttemptsTable.deviceId, intern.deviceId))
          : [];

        return {
          id: intern.id,
          name: intern.name,
          email: intern.email,
          deviceId: intern.deviceId,
          registeredAt: intern.registeredAt.toISOString(),
          lastActivityAt: intern.lastActivityAt.toISOString(),
          completedChapters: progress?.completedChapters?.length ?? 0,
          examPassed: examRows.some((r) => r.passed),
          examScore: examRows.length > 0 ? examRows.reduce((m, r) => Math.max(m, r.score), 0) : null,
        };
      }),
    );

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "admin/book/interns failed");
    res.status(500).json({ error: "Failed to load book interns" });
  }
});

export default router;
