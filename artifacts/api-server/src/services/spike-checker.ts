import { db, callsTable, usersTable, platformSettingsTable, usageSpikeNotificationsTable } from "@workspace/db";
import { eq, gt, sql, count, desc } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { sendSpikeAlertEmail } from "./spike-alerts.js";

const SPIKE_THRESHOLD_KEY = "usage_spike_daily_threshold";
const SPIKE_ALERT_EMAIL_KEY = "usage_spike_admin_email";
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes

async function checkSpikes(): Promise<void> {
  try {
    const [thresholdRow, adminEmailRow] = await Promise.all([
      db
        .select({ value: platformSettingsTable.value })
        .from(platformSettingsTable)
        .where(eq(platformSettingsTable.key, SPIKE_THRESHOLD_KEY))
        .then(([r]) => r),
      db
        .select({ value: platformSettingsTable.value })
        .from(platformSettingsTable)
        .where(eq(platformSettingsTable.key, SPIKE_ALERT_EMAIL_KEY))
        .then(([r]) => r),
    ]);

    const threshold = thresholdRow ? Number(thresholdRow.value) : null;
    const adminEmail = adminEmailRow?.value ?? null;

    if (threshold === null || !adminEmail) {
      return;
    }

    const todayStr = new Date().toISOString().slice(0, 10);

    const [spikes, notifications] = await Promise.all([
      db
        .select({
          clerkId: callsTable.userId,
          email: usersTable.email,
          callCount: count(),
        })
        .from(callsTable)
        .leftJoin(usersTable, eq(callsTable.userId, usersTable.clerkId))
        .where(gt(callsTable.createdAt, sql`current_date::timestamptz`))
        .groupBy(callsTable.userId, usersTable.email)
        .orderBy(desc(count())),
      db
        .select({ clerkId: usageSpikeNotificationsTable.clerkId })
        .from(usageSpikeNotificationsTable)
        .where(eq(usageSpikeNotificationsTable.notifiedDate, todayStr)),
    ]);

    const notifiedSet = new Set(notifications.map((n) => n.clerkId));

    const newBreaches = spikes.filter(
      (r) => r.clerkId && Number(r.callCount) >= threshold && !notifiedSet.has(r.clerkId),
    );

    if (newBreaches.length === 0) return;

    logger.info({ count: newBreaches.length, threshold, adminEmail }, "Spike checker: new breaches detected");

    for (const breach of newBreaches) {
      try {
        const sent = await sendSpikeAlertEmail({
          adminEmail,
          userEmail: breach.email,
          userClerkId: breach.clerkId!,
          callCount: Number(breach.callCount),
          threshold,
        });
        if (sent) {
          await db
            .insert(usageSpikeNotificationsTable)
            .values({ clerkId: breach.clerkId!, notifiedDate: todayStr })
            .onConflictDoNothing();
          logger.info({ clerkId: breach.clerkId }, "Spike checker: notification recorded");
        } else {
          logger.info({ clerkId: breach.clerkId }, "Spike checker: email skipped (no credentials), not marking as notified");
        }
      } catch (err) {
        logger.warn({ err, clerkId: breach.clerkId }, "Spike checker: email send failed, will retry next cycle");
      }
    }
  } catch (err) {
    logger.warn({ err }, "Spike checker: unexpected error");
  }
}

export function startSpikeChecker(): void {
  logger.info({ intervalMs: CHECK_INTERVAL_MS }, "Spike checker started");
  void checkSpikes();
  setInterval(() => void checkSpikes(), CHECK_INTERVAL_MS);
}
