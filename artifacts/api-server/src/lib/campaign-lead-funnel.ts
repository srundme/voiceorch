/**
 * LEGACY production lead-funnel SQL.
 *
 * Campaign analytics, batch workspace KPIs, and overview tiles still use this
 * until a later phase switches cards. Do not change these expressions here.
 *
 * Canonical four-layer reporting (answered_ever, lifecycle, retries, business)
 * lives in `services/campaign-lead-reporting.ts` and is additive only.
 *
 * Overview tiles must not mix Live Queue meanings (connected-in-progress vs
 * failed=exhausted) into these buckets.
 */
import { sql } from "drizzle-orm";

export const CONNECTED_CALL_STATUSES = ["connected", "completed", "transferred"] as const;
export const SUCCESS_OUTCOMES = ["interest_confirmed", "booking_created", "transfer_completed"] as const;

/** Drizzle select shape — same expressions on campaign-wide and batch-scoped queries. */
export function campaignLeadFunnelSelect() {
  return {
    imported: sql<number>`count(*)::int`,
    called: sql<number>`count(*) filter (where call_attempts > 0)::int`,
    connected: sql<number>`count(*) filter (where call_status in ('connected','completed','transferred'))::int`,
    interested: sql<number>`count(*) filter (where operational_outcome in ('interest_confirmed','booking_created','transfer_completed'))::int`,
    booked: sql<number>`count(*) filter (where operational_outcome = 'booking_created')::int`,
    transferred: sql<number>`count(*) filter (where operational_outcome = 'transfer_completed')::int`,
    failed: sql<number>`count(*) filter (where call_status = 'failed')::int`,
    busy: sql<number>`count(*) filter (where call_status = 'busy')::int`,
    noPickup: sql<number>`count(*) filter (where call_status = 'no_pickup')::int`,
    voicemail: sql<number>`count(*) filter (where call_status = 'voicemail')::int`,
    pending: sql<number>`count(*) filter (where call_status = 'pending')::int`,
    firstAttemptAt: sql<string | null>`min(last_attempt_at)::text`,
  };
}

export function funnelFromRow(row: {
  imported?: number;
  called?: number;
  connected?: number;
  interested?: number;
  booked?: number;
  transferred?: number;
  failed?: number;
  busy?: number;
  noPickup?: number;
  voicemail?: number;
  pending?: number;
} | undefined) {
  const imported = row?.imported ?? 0;
  const called = row?.called ?? 0;
  const interested = row?.interested ?? 0;
  return {
    imported,
    called,
    connected: row?.connected ?? 0,
    interested,
    booked: row?.booked ?? 0,
    transferred: row?.transferred ?? 0,
    failed: row?.failed ?? 0,
    busy: row?.busy ?? 0,
    noPickup: row?.noPickup ?? 0,
    voicemail: row?.voicemail ?? 0,
    pending: row?.pending ?? 0,
    successRate: called > 0 ? Math.round((interested / called) * 100) : 0,
  };
}
