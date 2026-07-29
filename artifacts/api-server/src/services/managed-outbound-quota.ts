/**
 * Daily quota for platform-managed outbound test calls.
 *
 * Users without a purchased SnapServe number get a small free trial pool so
 * they can hear the agent once — then they must buy a number for unlimited
 * outbound + inbound. Hackathon / sales conversion lever.
 */

import { and, eq, gte, ne, sql, inArray } from "drizzle-orm";
import {
  db,
  callsTable,
  phoneNumbersTable,
  platformSettingsTable,
} from "@workspace/db";

const SETTING_KEY = "managed_outbound_daily_limit";
const DEFAULT_DAILY_LIMIT = 3;

/** Start of "today" in Asia/Kolkata (SnapServe primary market / hackathons). */
export function startOfTodayIst(): Date {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const day = fmt.format(new Date()); // YYYY-MM-DD
  // 00:00 IST = previous day 18:30 UTC
  return new Date(`${day}T00:00:00+05:30`);
}

async function getDailyLimit(): Promise<number> {
  const [row] = await db.select({ value: platformSettingsTable.value })
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.key, SETTING_KEY))
    .limit(1);
  const n = row?.value ? Number(row.value) : DEFAULT_DAILY_LIMIT;
  if (!Number.isFinite(n) || n < 0) return DEFAULT_DAILY_LIMIT;
  return Math.floor(n);
}

export async function getManagedPhonePool(): Promise<string[]> {
  const [row] = await db.select({ value: platformSettingsTable.value })
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.key, "managed_phone_numbers"))
    .limit(1);
  if (!row?.value) return [];
  try {
    const parsed = JSON.parse(row.value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export async function userHasPurchasedNumber(userId: string): Promise<boolean> {
  const [row] = await db.select({ id: phoneNumbersTable.id })
    .from(phoneNumbersTable)
    .where(and(
      eq(phoneNumbersTable.userId, userId),
      eq(phoneNumbersTable.status, "active"),
      ne(phoneNumbersTable.service, "whatsapp"),
    ))
    .limit(1);
  return !!row;
}

export type ManagedOutboundQuota = {
  limit: number;
  used: number;
  remaining: number;
  hasOwnNumber: boolean;
  /** True when this user is still on the managed trial pool (no purchase). */
  limited: boolean;
  resetsAt: string;
};

export async function getManagedOutboundQuota(userId: string): Promise<ManagedOutboundQuota> {
  const limit = await getDailyLimit();
  const hasOwnNumber = await userHasPurchasedNumber(userId);
  const dayStart = startOfTodayIst();
  // Next midnight IST
  const resetsAt = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000).toISOString();

  if (hasOwnNumber) {
    return {
      limit,
      used: 0,
      remaining: limit,
      hasOwnNumber: true,
      limited: false,
      resetsAt,
    };
  }

  const pool = await getManagedPhonePool();
  if (pool.length === 0) {
    return { limit, used: 0, remaining: limit, hasOwnNumber: false, limited: true, resetsAt };
  }

  const [agg] = await db.select({ count: sql<number>`count(*)::int` })
    .from(callsTable)
    .where(and(
      eq(callsTable.userId, userId),
      gte(callsTable.createdAt, dayStart),
      inArray(callsTable.fromNumber, pool),
    ));

  const used = Number(agg?.count ?? 0);
  const remaining = Math.max(0, limit - used);
  return {
    limit,
    used,
    remaining,
    hasOwnNumber: false,
    limited: true,
    resetsAt,
  };
}

/**
 * Enforce quota when dialing from the managed pool (no purchased number).
 * Returns an error payload if blocked; null if allowed.
 */
export async function enforceManagedOutboundQuota(userId: string): Promise<{
  blocked: true;
  status: 429;
  body: {
    error: string;
    code: "MANAGED_OUTBOUND_LIMIT";
    quota: ManagedOutboundQuota;
  };
} | null> {
  const quota = await getManagedOutboundQuota(userId);
  if (!quota.limited) return null;
  if (quota.remaining > 0) return null;
  return {
    blocked: true,
    status: 429,
    body: {
      error: `You've used all ${quota.limit} free trial calls for today. Buy your own phone number to keep calling — and to receive inbound calls.`,
      code: "MANAGED_OUTBOUND_LIMIT",
      quota,
    },
  };
}
