/**
 * Scheduled email jobs:
 *  - Onboarding Day 1 (24h after signup): nudge to create first agent
 *  - Onboarding Day 3 (72h after signup): nudge to launch first campaign
 *  - Monthly summary: sent on the 1st of each month to all users with activity
 *
 * Sent-state is tracked in platform_settings using stable (non-transient) keys
 * so emails are never duplicated across restarts.
 */

import { db, usersTable, platformSettingsTable, callsTable, agentsTable } from "@workspace/db";
import { eq, and, lt, gte, sql, isNotNull, isNull, ne } from "drizzle-orm";
import { sendBrevoEmail } from "./brevo.js";
import {
  onboardingDay1Email,
  onboardingDay3Email,
  monthlySummaryEmail,
  type MonthlySummaryStats,
  noAgentDay2Email,
  noAgentDay4Email,
  noAgentDay7Email,
  noAgentDay14Email,
  noAgentDay21Email,
} from "./email-templates.js";
import { logger } from "../lib/logger.js";

const TICK_MS = 60 * 60 * 1000; // check every hour

// ── Helpers ───────────────────────────────────────────────────────────────────

async function hasSent(key: string): Promise<boolean> {
  const [row] = await db
    .select({ v: platformSettingsTable.value })
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.key, key));
  return !!row;
}

async function markSent(key: string): Promise<void> {
  await db
    .insert(platformSettingsTable)
    .values({ key, value: new Date().toISOString() })
    .onConflictDoNothing();
}

// ── Onboarding drip ───────────────────────────────────────────────────────────

async function runOnboardingDrip(): Promise<void> {
  const now = Date.now();

  // Fetch users who signed up between 24h and 96h ago (window for both Day 1 and Day 3)
  const cutoffLo = new Date(now - 96 * 60 * 60 * 1000); // 96h ago — oldest we care about
  const cutoffHi = new Date(now - 24 * 60 * 60 * 1000); // 24h ago — newest eligible

  const users = await db
    .select({
      id:        usersTable.id,
      email:     usersTable.email,
      name:      usersTable.name,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .where(
      and(
        isNotNull(usersTable.email),
        ne(usersTable.email, ""),
        gte(usersTable.createdAt, cutoffLo),
        lt(usersTable.createdAt, new Date(now)), // exclude future (sanity)
      ),
    );

  for (const user of users) {
    if (!user.email || !user.createdAt) continue;
    const ageMs = now - new Date(user.createdAt).getTime();

    // ── Day 1 (24–48h window) ─────────────────────────────────────────────
    if (ageMs >= 24 * 60 * 60 * 1000 && ageMs < 48 * 60 * 60 * 1000) {
      const key = `email:onboard:d1:${user.id}`;
      if (!(await hasSent(key))) {
        try {
          await sendBrevoEmail(
            user.email,
            "Create your first voice agent on SnapServe",
            onboardingDay1Email(user.name ?? "there"),
          );
          await markSent(key);
          logger.info({ userId: user.id }, "Onboarding Day 1 email sent");
        } catch (err) {
          logger.warn({ err, userId: user.id }, "Onboarding Day 1 email failed");
        }
      }
    }

    // ── Day 3 (72–96h window) ─────────────────────────────────────────────
    if (ageMs >= 72 * 60 * 60 * 1000 && ageMs < 96 * 60 * 60 * 1000) {
      const key = `email:onboard:d3:${user.id}`;
      if (!(await hasSent(key))) {
        try {
          await sendBrevoEmail(
            user.email,
            "Ready to launch your first campaign?",
            onboardingDay3Email(user.name ?? "there"),
          );
          await markSent(key);
          logger.info({ userId: user.id }, "Onboarding Day 3 email sent");
        } catch (err) {
          logger.warn({ err, userId: user.id }, "Onboarding Day 3 email failed");
        }
      }
    }
  }
}

// ── Zero-agent re-engagement drip ─────────────────────────────────────────────
//
// Fires for users who completed onboarding but never created an agent.
// Steps: Day 2 (credit hook) | Day 4 (prior-platform hook) | Day 7 (use-case)
//        | Day 14 (personal check-in) | Day 21 (final urgency)
// Each step sends once per user, tracked with email:noagent:<step>:<userId>.

interface OnboardingData {
  role?: string;
  referralSource?: string;
  priorPlatforms?: string[];
  usedVoiceAgents?: boolean;
}

async function runZeroAgentDrip(): Promise<void> {
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  // Users who signed up between 2 and 22 days ago with zero agents
  const cutoffLo = new Date(now - 22 * DAY);
  const cutoffHi = new Date(now - 2 * DAY);

  const users = await db
    .select({
      id:             usersTable.id,
      email:          usersTable.email,
      name:           usersTable.name,
      createdAt:      usersTable.createdAt,
      onboardingData: usersTable.onboardingData,
    })
    .from(usersTable)
    .leftJoin(agentsTable, eq(agentsTable.userId, usersTable.clerkId))
    .where(
      and(
        isNull(agentsTable.id),
        isNotNull(usersTable.email),
        ne(usersTable.email, ""),
        gte(usersTable.createdAt, cutoffLo),
        lt(usersTable.createdAt, cutoffHi),
      ),
    );

  for (const user of users) {
    if (!user.email || !user.createdAt) continue;

    const ageMs = now - new Date(user.createdAt).getTime();
    const name  = user.name ?? "there";
    const od    = (user.onboardingData ?? {}) as OnboardingData;
    const priorPlatform = od.priorPlatforms?.[0];
    const usedBefore    = od.usedVoiceAgents ?? (od.priorPlatforms?.length ?? 0) > 0;

    const trySend = async (step: string, subject: string, html: string) => {
      const key = `email:noagent:${step}:${user.id}`;
      if (await hasSent(key)) return;
      try {
        await sendBrevoEmail(user.email!, subject, html);
        await markSent(key);
        logger.info({ userId: user.id, step }, "Zero-agent drip email sent");
      } catch (err) {
        logger.warn({ err, userId: user.id, step }, "Zero-agent drip email failed");
      }
    };

    if (ageMs >= 2 * DAY && ageMs < 3 * DAY) {
      await trySend(
        "d2",
        "You still have $5 waiting in your SnapServe wallet",
        noAgentDay2Email(name),
      );
    } else if (ageMs >= 4 * DAY && ageMs < 5 * DAY) {
      const subject = usedBefore
        ? "You know voice agents \u2014 here is what SnapServe does differently"
        : "Build your first voice agent \u2014 here is how";
      await trySend("d4", subject, noAgentDay4Email(name, priorPlatform));
    } else if (ageMs >= 7 * DAY && ageMs < 8 * DAY) {
      await trySend(
        "d7",
        "A real voice agent in under 10 minutes \u2014 here is the setup",
        noAgentDay7Email(name),
      );
    } else if (ageMs >= 14 * DAY && ageMs < 15 * DAY) {
      await trySend(
        "d14",
        "Is something getting in the way?",
        noAgentDay14Email(name),
      );
    } else if (ageMs >= 21 * DAY && ageMs < 22 * DAY) {
      await trySend(
        "d21",
        "Your $5 credit \u2014 last chance",
        noAgentDay21Email(name),
      );
    }
  }
}

// ── Monthly summary ───────────────────────────────────────────────────────────

async function runMonthlySummary(): Promise<void> {
  const now = new Date();
  // Only run on the 1st of the month (within the first tick window)
  if (now.getDate() !== 1) return;

  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // Previous month date range
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthStart = new Date(prevMonth.getFullYear(), prevMonth.getMonth(), 1);
  const prevMonthEnd   = new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 1);
  const prevMonthLabel = prevMonth.toLocaleString("en-US", { month: "long", year: "numeric" });

  const users = await db
    .select({ id: usersTable.id, clerkId: usersTable.clerkId, email: usersTable.email, name: usersTable.name })
    .from(usersTable)
    .where(isNotNull(usersTable.email));

  for (const user of users) {
    if (!user.email) continue;

    const sentKey = `email:monthly:${user.id}:${thisMonth}`;
    if (await hasSent(sentKey)) continue;

    try {
      // Aggregate last month's calls for this user
      const callRows = await db
        .select({
          count:        sql<number>`count(*)::int`,
          totalSeconds: sql<number>`coalesce(sum(${callsTable.durationSeconds}),0)::int`,
          totalCostCents: sql<number>`coalesce(sum(${callsTable.costCents}),0)::int`,
        })
        .from(callsTable)
        .where(
          and(
            eq(callsTable.userId, user.clerkId),
            gte(callsTable.createdAt, prevMonthStart),
            lt(callsTable.createdAt, prevMonthEnd),
          ),
        );

      const activeAgentRows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(agentsTable)
        .where(
          and(
            eq(agentsTable.userId, user.clerkId),
            eq(agentsTable.status, "active"),
          ),
        );

      // Top agent by call count
      const topAgentRows = await db
        .select({ name: agentsTable.name, cnt: sql<number>`count(*)::int` })
        .from(callsTable)
        .innerJoin(agentsTable, eq(callsTable.agentId, agentsTable.id))
        .where(
          and(
            eq(callsTable.userId, user.clerkId),
            gte(callsTable.createdAt, prevMonthStart),
            lt(callsTable.createdAt, prevMonthEnd),
          ),
        )
        .groupBy(agentsTable.id, agentsTable.name)
        .orderBy(sql`count(*) desc`)
        .limit(1);

      const stats: MonthlySummaryStats = {
        month:          prevMonthLabel,
        totalCalls:     callRows[0]?.count ?? 0,
        totalMinutes:   Math.round((callRows[0]?.totalSeconds ?? 0) / 60),
        totalCostCents: callRows[0]?.totalCostCents ?? 0,
        activeAgents:   activeAgentRows[0]?.count ?? 0,
        topAgentName:   topAgentRows[0]?.name ?? undefined,
      };

      await sendBrevoEmail(
        user.email,
        `Your ${prevMonthLabel} summary — SnapServe`,
        monthlySummaryEmail(user.name ?? "there", stats),
      );
      await markSent(sentKey);
      logger.info({ userId: user.id, month: prevMonthLabel }, "Monthly summary email sent");
    } catch (err) {
      logger.warn({ err, userId: user.id }, "Monthly summary email failed");
    }
  }
}

// ── Start scheduler ───────────────────────────────────────────────────────────

export function startEmailScheduler(): void {
  // Run immediately on startup (catches missed windows after a restart)
  void runOnboardingDrip().catch(err => logger.warn({ err }, "Onboarding drip startup run failed"));
  void runZeroAgentDrip().catch(err => logger.warn({ err }, "Zero-agent drip startup run failed"));
  void runMonthlySummary().catch(err => logger.warn({ err }, "Monthly summary startup run failed"));

  setInterval(() => {
    void runOnboardingDrip().catch(err => logger.warn({ err }, "Onboarding drip tick failed"));
    void runZeroAgentDrip().catch(err => logger.warn({ err }, "Zero-agent drip tick failed"));
    void runMonthlySummary().catch(err => logger.warn({ err }, "Monthly summary tick failed"));
  }, TICK_MS);

  logger.info("Email scheduler started (onboarding drip + monthly summary)");
}
