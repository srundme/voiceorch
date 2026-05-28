import { Router } from "express";
import { db, usersTable, walletTransactionsTable, callsTable, agentsTable, scheduledCallbacksTable, bookingsTable, eventTypesTable, schedulingCalendarsTable, platformSettingsTable, usageSpikeDismissalsTable, usageSpikeNotificationsTable, alertNotificationLogTable } from "@workspace/db";
import { eq, sql, count, sum, desc, lt, gt, and, inArray } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { getAllSessions } from "../orchestration/session.js";
import { logger } from "../lib/logger.js";
import { sendTestAlertNotification, getAlertCooldownStats, resetAlertSuppressedCount, getAlertCooldownStatus } from "../services/alert-notifications.js";

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

    const [callCounts, agentCounts, spentAmounts, callDurations] = await Promise.all([
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
      db
        .select({
          clerkId: callsTable.userId,
          totalDurationSeconds: sql<number>`coalesce(sum(duration_seconds), 0)`,
        })
        .from(callsTable)
        .where(inArray(callsTable.userId, clerkIds))
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
      .select({
        id: callsTable.id,
        userId: callsTable.userId,
        agentId: callsTable.agentId,
        agentName: agentsTable.name,
        status: callsTable.status,
        errorMessage: callsTable.errorMessage,
        createdAt: callsTable.createdAt,
      })
      .from(callsTable)
      .leftJoin(agentsTable, eq(callsTable.agentId, agentsTable.id))
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

export default router;
