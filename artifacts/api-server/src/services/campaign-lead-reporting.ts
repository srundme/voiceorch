/**
 * Canonical campaign reporting (Phase 3).
 *
 * Four layers — never collapse them into `call_status`:
 *   1. Contact truth     → answered_ever
 *   2. Live lifecycle    → call_status
 *   3. Retry/work left   → call_retries (distinct leads)
 *   4. Business result   → operational_outcome + disposition
 *
 * Production KPI cards still read `lib/campaign-lead-funnel.ts`. This module is
 * the single definition future Campaign UI/API surfaces should consume.
 * Do not remap historical call_status. Do not change the V2 writer from here.
 */

import { eq, ilike, or, sql, type SQL } from "drizzle-orm";
import {
  campaignLeadsTable,
  callRetriesTable,
  callsTable,
} from "@workspace/db";
import { SUCCESS_OUTCOMES } from "../lib/campaign-lead-funnel.js";
import {
  canonicalDispositionFromLabel,
  dispositionBucketSql,
} from "../lib/disposition/canonical.js";

export const CAMPAIGN_REPORTING_VIEWS = [
  "interested",
  "callback",
  "retry",
  "answered",
  "no_pickup",
  "busy",
  "voicemail",
  "technical_failed",
] as const;

export type CampaignReportingView = (typeof CAMPAIGN_REPORTING_VIEWS)[number];

export type CampaignContactState = "never_attempted" | "attempted" | "answered";
export type CampaignWorkState = "live" | "retry_scheduled" | "callback_due" | "terminal";

export type CampaignReportingLeadInput = {
  id: number;
  batchId?: number | null;
  phone?: string | null;
  name?: string | null;
  source?: string | null;
  answeredEver: boolean;
  callStatus: string;
  lastAttemptStatus?: string | null;
  operationalOutcome?: string | null;
  disposition?: string | null;
  callAttempts: number;
  callId?: number | null;
  latestAnsweredDuration?: number | null;
  retryPending?: boolean;
  retryScheduledAt?: string | Date | null;
  retryReason?: string | null;
  retryCount?: number;
  retryAttemptNumber?: number | null;
};

export type CampaignReportingFilter = {
  view?: CampaignReportingView | null;
  disposition?: string | null;
  /** Canonical bucket, e.g. "voicemail" | "no pickup" | "unlabeled". */
  dispositionBucket?: string | null;
  operationalOutcome?: string | null;
  answeredEver?: boolean | null;
  lifecycleStatus?: string | null;
  lastAttemptStatus?: string | null;
  retryPending?: boolean | null;
  batchId?: number | null;
  source?: string | null;
  search?: string | null;
};

const NO_PICKUP_TECHNICAL = new Set(["no_pickup", "no_answer"]);
const BUSY_TECHNICAL = new Set(["busy"]);
const VOICEMAIL_TECHNICAL = new Set(["voicemail"]);
const TECHNICAL_FAILED = new Set(["failed", "exhausted", "dial_error", "stuck_calling"]);
const LIVE_LIFECYCLE = new Set(["calling", "connected"]);
const QUEUED_LIFECYCLE = new Set(["pending", "queued"]);

export function isCampaignReportingView(value: string | null | undefined): value is CampaignReportingView {
  return !!value && (CAMPAIGN_REPORTING_VIEWS as readonly string[]).includes(value);
}

export function latestTechnicalStatus(lead: {
  lastAttemptStatus?: string | null;
  callStatus: string;
}): string {
  const last = (lead.lastAttemptStatus ?? "").trim();
  return last || lead.callStatus;
}

/**
 * What operators should see as the disposition chip.
 * Technical voicemail wins over an LLM "no pickup" stamp.
 */
export function displayDispositionBucket(lead: {
  disposition?: string | null;
  lastAttemptStatus?: string | null;
  callStatus: string;
}): string {
  if (latestTechnicalStatus(lead) === "voicemail") return "voicemail";
  return canonicalDispositionFromLabel(lead.disposition);
}

/** Collapse raw disposition + technical status rows into hero chips. Do not GROUP BY the SQL CASE. */
export function summarizeDispositionHero(
  rows: Array<{
    disposition?: string | null;
    lastAttemptStatus?: string | null;
    callStatus: string;
    count: number;
  }>,
): Array<{ bucket: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const bucket = displayDispositionBucket(row).trim() || "unlabeled";
    counts.set(bucket, (counts.get(bucket) ?? 0) + row.count);
  }
  return [...counts.entries()]
    .map(([bucket, count]) => ({ bucket, count }))
    .filter((row) => row.count > 0)
    .sort((a, b) => {
      const rank = (bucket: string) => {
        if (bucket === "interested") return 0;
        if (bucket === "callback requested") return 1;
        if (bucket === "voicemail") return 2;
        if (bucket === "not interested") return 3;
        if (bucket === "unlabeled") return 99;
        return 10;
      };
      const d = rank(a.bucket) - rank(b.bucket);
      return d !== 0 ? d : b.count - a.count;
    });
}

export function campaignContactState(lead: {
  answeredEver: boolean;
  callAttempts: number;
}): CampaignContactState {
  if (lead.answeredEver) return "answered";
  if (lead.callAttempts > 0) return "attempted";
  return "never_attempted";
}

export function campaignWorkState(lead: {
  callStatus: string;
  retryPending?: boolean;
  operationalOutcome?: string | null;
}): CampaignWorkState {
  if (LIVE_LIFECYCLE.has(lead.callStatus)) return "live";
  if (lead.retryPending) return "retry_scheduled";
  if (lead.operationalOutcome === "callback_requested") return "callback_due";
  return "terminal";
}

export function isImported(_lead: CampaignReportingLeadInput): boolean {
  return true;
}

export function isAttempted(lead: CampaignReportingLeadInput): boolean {
  return lead.callAttempts > 0;
}

export function isAnswered(lead: CampaignReportingLeadInput): boolean {
  return lead.answeredEver === true;
}

export function isTalkingNow(lead: CampaignReportingLeadInput): boolean {
  return lead.callStatus === "connected";
}

export function isCallingNow(lead: CampaignReportingLeadInput): boolean {
  return lead.callStatus === "calling";
}

export function isQueuedNow(lead: CampaignReportingLeadInput): boolean {
  return QUEUED_LIFECYCLE.has(lead.callStatus);
}

export function isInterested(lead: CampaignReportingLeadInput): boolean {
  return lead.operationalOutcome === "interest_confirmed";
}

export function isBooked(lead: CampaignReportingLeadInput): boolean {
  return lead.operationalOutcome === "booking_created";
}

export function isTransferred(lead: CampaignReportingLeadInput): boolean {
  return lead.operationalOutcome === "transfer_completed";
}

export function isCallback(lead: CampaignReportingLeadInput): boolean {
  return lead.operationalOutcome === "callback_requested";
}

export function isRetryPending(lead: CampaignReportingLeadInput): boolean {
  return lead.retryPending === true;
}

export function isNoPickup(lead: CampaignReportingLeadInput): boolean {
  return !lead.answeredEver && NO_PICKUP_TECHNICAL.has(latestTechnicalStatus(lead));
}

export function isBusy(lead: CampaignReportingLeadInput): boolean {
  return !lead.answeredEver && BUSY_TECHNICAL.has(latestTechnicalStatus(lead));
}

export function isVoicemail(lead: CampaignReportingLeadInput): boolean {
  return VOICEMAIL_TECHNICAL.has(latestTechnicalStatus(lead));
}

export function isTechnicalFailed(lead: CampaignReportingLeadInput): boolean {
  return !lead.answeredEver && TECHNICAL_FAILED.has(latestTechnicalStatus(lead));
}

/** Old funnel "interested" = success outcomes. Kept for compare only. */
export function isLegacyInterested(lead: CampaignReportingLeadInput): boolean {
  return (SUCCESS_OUTCOMES as readonly string[]).includes(lead.operationalOutcome ?? "");
}

export function isLegacyConnected(lead: CampaignReportingLeadInput): boolean {
  return lead.callStatus === "connected"
    || lead.callStatus === "completed"
    || lead.callStatus === "transferred";
}

export function isLegacyFailed(lead: CampaignReportingLeadInput): boolean {
  return lead.callStatus === "failed";
}

const VIEW_PREDICATE: Record<CampaignReportingView, (lead: CampaignReportingLeadInput) => boolean> = {
  interested: isInterested,
  callback: isCallback,
  retry: isRetryPending,
  answered: isAnswered,
  no_pickup: isNoPickup,
  busy: isBusy,
  voicemail: isVoicemail,
  technical_failed: isTechnicalFailed,
};

export function leadMatchesReportingView(
  lead: CampaignReportingLeadInput,
  view: CampaignReportingView,
): boolean {
  return VIEW_PREDICATE[view](lead);
}

export function leadMatchesReportingFilter(
  lead: CampaignReportingLeadInput,
  filter: CampaignReportingFilter = {},
): boolean {
  if (filter.view && !leadMatchesReportingView(lead, filter.view)) return false;
  if (filter.disposition != null && filter.disposition !== "" && lead.disposition !== filter.disposition) {
    return false;
  }
  if (filter.dispositionBucket != null && filter.dispositionBucket !== "") {
    const bucket = displayDispositionBucket(lead);
    if (filter.dispositionBucket === "unlabeled") {
      if (bucket) return false;
    } else if (bucket !== filter.dispositionBucket) {
      return false;
    }
  }
  if (filter.operationalOutcome != null && filter.operationalOutcome !== ""
    && lead.operationalOutcome !== filter.operationalOutcome) {
    return false;
  }
  if (filter.answeredEver != null && lead.answeredEver !== filter.answeredEver) return false;
  if (filter.lifecycleStatus != null && filter.lifecycleStatus !== ""
    && lead.callStatus !== filter.lifecycleStatus) {
    return false;
  }
  if (filter.lastAttemptStatus != null && filter.lastAttemptStatus !== ""
    && (lead.lastAttemptStatus ?? "") !== filter.lastAttemptStatus) {
    return false;
  }
  if (filter.retryPending != null && isRetryPending(lead) !== filter.retryPending) return false;
  if (filter.batchId != null && lead.batchId !== filter.batchId) return false;
  if (filter.source != null && filter.source !== "" && lead.source !== filter.source) return false;
  if (filter.search != null && filter.search.trim() !== "") {
    const q = filter.search.trim().toLowerCase();
    const name = (lead.name ?? "").toLowerCase();
    const phone = (lead.phone ?? "").toLowerCase();
    if (!name.includes(q) && !phone.includes(q)) return false;
  }
  return true;
}

export function countReportingMetric(
  leads: CampaignReportingLeadInput[],
  metric: CampaignReportingView | "imported" | "attempted" | "talking" | "calling" | "queued" | "booked" | "transferred" | "voicemail",
): number {
  const pred =
    metric === "imported" ? isImported :
    metric === "attempted" ? isAttempted :
    metric === "talking" ? isTalkingNow :
    metric === "calling" ? isCallingNow :
    metric === "queued" ? isQueuedNow :
    metric === "booked" ? isBooked :
    metric === "transferred" ? isTransferred :
    metric === "voicemail" ? isVoicemail :
    VIEW_PREDICATE[metric];
  return leads.filter(pred).length;
}

export function campaignReportingRates(counts: {
  attempted: number;
  answered: number;
  interested: number;
  legacyInterested?: number;
}) {
  const attempted = counts.attempted;
  const answered = counts.answered;
  const interested = counts.interested;
  const legacyInterested = counts.legacyInterested ?? interested;
  return {
    answerRate: attempted > 0 ? answered / attempted : 0,
    interestRate: answered > 0 ? interested / answered : 0,
    conversionRate: attempted > 0 ? interested / attempted : 0,
    answerRatePct: attempted > 0 ? Math.round((answered / attempted) * 100) : 0,
    interestRatePct: answered > 0 ? Math.round((interested / answered) * 100) : 0,
    conversionRatePct: attempted > 0 ? Math.round((interested / attempted) * 100) : 0,
    /** Old production "Success Rate" = success-outcomes / attempted. Do not rename. */
    legacySuccessRate: attempted > 0 ? Math.round((legacyInterested / attempted) * 100) : 0,
  };
}

export function projectCampaignLeadReporting(lead: CampaignReportingLeadInput) {
  return {
    leadId: lead.id,
    batchId: lead.batchId ?? null,
    phone: lead.phone ?? null,
    name: lead.name ?? null,
    answeredEver: lead.answeredEver,
    lifecycleStatus: lead.callStatus,
    lastAttemptStatus: lead.lastAttemptStatus ?? null,
    operationalOutcome: lead.operationalOutcome ?? "pending",
    disposition: lead.disposition ?? null,
    callAttempts: lead.callAttempts,
    latestCallId: lead.callId ?? null,
    latestAnsweredCallId: lead.answeredEver ? (lead.callId ?? null) : null,
    latestAnsweredDuration: lead.latestAnsweredDuration ?? null,
    dispositionBucket: displayDispositionBucket(lead),
    retryPending: isRetryPending(lead),
    retryScheduledAt: lead.retryScheduledAt ? String(lead.retryScheduledAt) : null,
    retryReason: lead.retryReason ?? null,
    retryCount: lead.retryCount ?? (lead.retryPending ? 1 : 0),
    retryAttemptNumber: lead.retryAttemptNumber ?? null,
    callbackRequested: isCallback(lead),
    bookingCreated: isBooked(lead),
    transferCompleted: isTransferred(lead),
    contactState: campaignContactState(lead),
    workState: campaignWorkState(lead),
  };
}

export function summarizeCampaignReporting(leads: CampaignReportingLeadInput[]) {
  const imported = leads.length;
  const attempted = countReportingMetric(leads, "attempted");
  const answered = countReportingMetric(leads, "answered");
  const interested = countReportingMetric(leads, "interested");
  const booked = countReportingMetric(leads, "booked");
  const transferred = countReportingMetric(leads, "transferred");
  const talking = countReportingMetric(leads, "talking");
  const calling = countReportingMetric(leads, "calling");
  const queued = countReportingMetric(leads, "queued");
  const retryPending = countReportingMetric(leads, "retry");
  const callbacks = countReportingMetric(leads, "callback");
  const noPickup = countReportingMetric(leads, "no_pickup");
  const busy = countReportingMetric(leads, "busy");
  const voicemail = countReportingMetric(leads, "voicemail");
  const technicalFailed = countReportingMetric(leads, "technical_failed");
  const legacyInterested = leads.filter(isLegacyInterested).length;
  const slotsUsed = calling + talking;
  return {
    funnel: { imported, attempted, answered, interested, booked, transferred },
    liveFloor: {
      queued,
      calling,
      talking,
      slotsUsed,
    },
    workTechnical: {
      retryPending,
      callbacks,
      noPickup,
      busy,
      voicemail,
      technicalFailed,
    },
    rates: campaignReportingRates({ attempted, answered, interested, legacyInterested }),
    legacy: {
      called: attempted,
      connected: leads.filter(isLegacyConnected).length,
      failed: leads.filter(isLegacyFailed).length,
      interested: legacyInterested,
      busy: leads.filter((l) => l.callStatus === "busy").length,
      noPickup: leads.filter((l) => l.callStatus === "no_pickup").length,
      voicemail: leads.filter((l) => l.callStatus === "voicemail").length,
    },
  };
}

// ── SQL fragments (must match the JS predicates above) ───────────────────────

const latestTechnicalSql = sql`coalesce(nullif(btrim(coalesce(${campaignLeadsTable.lastAttemptStatus}, '')), ''), ${campaignLeadsTable.callStatus})`;

export const campaignReportingSql = {
  attempted: sql`${campaignLeadsTable.callAttempts} > 0`,
  answered: sql`${campaignLeadsTable.answeredEver} is true`,
  talking: sql`${campaignLeadsTable.callStatus} = 'connected'`,
  calling: sql`${campaignLeadsTable.callStatus} = 'calling'`,
  queued: sql`${campaignLeadsTable.callStatus} in ('pending','queued')`,
  interested: sql`${campaignLeadsTable.operationalOutcome} = 'interest_confirmed'`,
  booked: sql`${campaignLeadsTable.operationalOutcome} = 'booking_created'`,
  transferred: sql`${campaignLeadsTable.operationalOutcome} = 'transfer_completed'`,
  callbacks: sql`${campaignLeadsTable.operationalOutcome} = 'callback_requested'`,
  retryPending: sql`exists (select 1 from ${callRetriesTable} r where r.lead_id = ${campaignLeadsTable.id} and r.status = 'pending')`,
  retryRowCount: sql`(select count(*)::int from ${callRetriesTable} r where r.lead_id = ${campaignLeadsTable.id} and r.status = 'pending')`,
  retryScheduledAt: sql`(select min(r.scheduled_at) from ${callRetriesTable} r where r.lead_id = ${campaignLeadsTable.id} and r.status = 'pending')`,
  retryReason: sql`(select r.reason from ${callRetriesTable} r where r.lead_id = ${campaignLeadsTable.id} and r.status = 'pending' order by r.scheduled_at asc, r.id asc limit 1)`,
  retryAttemptNumber: sql`(select r.attempt_number from ${callRetriesTable} r where r.lead_id = ${campaignLeadsTable.id} and r.status = 'pending' order by r.scheduled_at asc, r.id asc limit 1)`,
  noPickup: sql`${campaignLeadsTable.answeredEver} is not true and ${latestTechnicalSql} in ('no_pickup','no_answer')`,
  busy: sql`${campaignLeadsTable.answeredEver} is not true and ${latestTechnicalSql} = 'busy'`,
  voicemail: sql`${latestTechnicalSql} = 'voicemail'`,
  technicalFailed: sql`${campaignLeadsTable.answeredEver} is not true and ${latestTechnicalSql} in ('failed','exhausted','dial_error','stuck_calling')`,
  historicalAnsweredFailed: sql`${campaignLeadsTable.answeredEver} is true and ${campaignLeadsTable.callStatus} = 'failed'`,
  slotsUsed: sql`${campaignLeadsTable.callStatus} in ('calling','connected')`,
};

/** SQL twin of displayDispositionBucket. Voicemail attempt beats a no-pickup label. */
export function campaignDispositionHeroSql(): SQL<string> {
  return sql<string>`(case
    when ${latestTechnicalSql} = 'voicemail' then 'voicemail'
    else ${dispositionBucketSql(campaignLeadsTable.disposition)}
  end)`;
}

const VIEW_SQL: Record<CampaignReportingView, SQL> = {
  interested: campaignReportingSql.interested,
  callback: campaignReportingSql.callbacks,
  retry: campaignReportingSql.retryPending,
  answered: campaignReportingSql.answered,
  no_pickup: campaignReportingSql.noPickup,
  busy: campaignReportingSql.busy,
  voicemail: campaignReportingSql.voicemail,
  technical_failed: campaignReportingSql.technicalFailed,
};

export function campaignReportingViewSql(view: CampaignReportingView): SQL {
  return VIEW_SQL[view];
}

/** Same predicates as KPI counts. AND-composed so Interested-N always lists N rows. */
export function campaignReportingFilterSql(filter: CampaignReportingFilter): SQL[] {
  const parts: SQL[] = [];
  if (filter.view) parts.push(campaignReportingViewSql(filter.view));
  if (filter.disposition) parts.push(eq(campaignLeadsTable.disposition, filter.disposition));
  if (filter.dispositionBucket === "unlabeled") {
    parts.push(sql`coalesce(${campaignDispositionHeroSql()}, '') = ''`);
  } else if (filter.dispositionBucket) {
    parts.push(sql`${campaignDispositionHeroSql()} = ${filter.dispositionBucket}`);
  }
  if (filter.operationalOutcome) {
    parts.push(eq(campaignLeadsTable.operationalOutcome, filter.operationalOutcome));
  }
  if (filter.answeredEver === true) parts.push(campaignReportingSql.answered);
  if (filter.answeredEver === false) parts.push(sql`${campaignLeadsTable.answeredEver} is not true`);
  if (filter.lifecycleStatus) parts.push(eq(campaignLeadsTable.callStatus, filter.lifecycleStatus));
  if (filter.lastAttemptStatus) {
    parts.push(eq(campaignLeadsTable.lastAttemptStatus, filter.lastAttemptStatus));
  }
  if (filter.retryPending === true) parts.push(campaignReportingSql.retryPending);
  if (filter.retryPending === false) parts.push(sql`not (${campaignReportingSql.retryPending})`);
  if (filter.batchId != null) parts.push(eq(campaignLeadsTable.batchId, filter.batchId));
  if (filter.source) parts.push(eq(campaignLeadsTable.source, filter.source));
  if (filter.search) {
    const q = `%${filter.search}%`;
    parts.push(or(
      ilike(campaignLeadsTable.name, q),
      ilike(campaignLeadsTable.phone, q),
    )!);
  }
  return parts;
}

/** One select shape — campaign-wide or batch-scoped. Counts leads, never retry/booking rows. */
export function campaignReportingKpiSelect() {
  return {
    imported: sql<number>`count(*)::int`,
    attempted: sql<number>`count(*) filter (where ${campaignReportingSql.attempted})::int`,
    answered: sql<number>`count(*) filter (where ${campaignReportingSql.answered})::int`,
    talking: sql<number>`count(*) filter (where ${campaignReportingSql.talking})::int`,
    calling: sql<number>`count(*) filter (where ${campaignReportingSql.calling})::int`,
    queued: sql<number>`count(*) filter (where ${campaignReportingSql.queued})::int`,
    interested: sql<number>`count(*) filter (where ${campaignReportingSql.interested})::int`,
    booked: sql<number>`count(*) filter (where ${campaignReportingSql.booked})::int`,
    transferred: sql<number>`count(*) filter (where ${campaignReportingSql.transferred})::int`,
    callbacks: sql<number>`count(*) filter (where ${campaignReportingSql.callbacks})::int`,
    retryPending: sql<number>`count(*) filter (where ${campaignReportingSql.retryPending})::int`,
    noPickup: sql<number>`count(*) filter (where ${campaignReportingSql.noPickup})::int`,
    busy: sql<number>`count(*) filter (where ${campaignReportingSql.busy})::int`,
    voicemail: sql<number>`count(*) filter (where ${campaignReportingSql.voicemail})::int`,
    technicalFailed: sql<number>`count(*) filter (where ${campaignReportingSql.technicalFailed})::int`,
    historicalAnsweredFailed: sql<number>`count(*) filter (where ${campaignReportingSql.historicalAnsweredFailed})::int`,
    slotsUsed: sql<number>`count(*) filter (where ${campaignReportingSql.slotsUsed})::int`,
  };
}

export function campaignReportingLeadProjectionSelect() {
  return {
    id: campaignLeadsTable.id,
    batchId: campaignLeadsTable.batchId,
    phone: campaignLeadsTable.phone,
    name: campaignLeadsTable.name,
    source: campaignLeadsTable.source,
    answeredEver: campaignLeadsTable.answeredEver,
    callStatus: campaignLeadsTable.callStatus,
    lastAttemptStatus: campaignLeadsTable.lastAttemptStatus,
    operationalOutcome: campaignLeadsTable.operationalOutcome,
    disposition: campaignLeadsTable.disposition,
    callAttempts: campaignLeadsTable.callAttempts,
    callId: campaignLeadsTable.callId,
    latestAnsweredDuration: sql<number | null>`${callsTable.durationSeconds}`,
    retryPending: sql<boolean>`${campaignReportingSql.retryPending}`,
    retryScheduledAt: sql<string | null>`${campaignReportingSql.retryScheduledAt}::text`,
    retryReason: sql<string | null>`${campaignReportingSql.retryReason}`,
    retryCount: sql<number>`${campaignReportingSql.retryRowCount}`,
    retryAttemptNumber: sql<number | null>`${campaignReportingSql.retryAttemptNumber}`,
  };
}

export function parseCampaignReportingFilter(query: Record<string, unknown>): CampaignReportingFilter {
  const viewRaw = String(query["view"] ?? "").trim();
  const answeredRaw = String(query["answeredEver"] ?? "").trim().toLowerCase();
  const retryRaw = String(query["retryPending"] ?? "").trim().toLowerCase();
  const batchRaw = String(query["batchId"] ?? "").trim();
  const batchId = batchRaw ? Number(batchRaw) : NaN;
  return {
    view: isCampaignReportingView(viewRaw) ? viewRaw : null,
    disposition: String(query["disposition"] ?? "").trim() || null,
    dispositionBucket: String(query["dispositionBucket"] ?? "").trim() || null,
    operationalOutcome: String(query["operationalOutcome"] ?? "").trim() || null,
    answeredEver: answeredRaw === "true" || answeredRaw === "1" ? true
      : answeredRaw === "false" || answeredRaw === "0" ? false
      : null,
    lifecycleStatus: String(query["lifecycleStatus"] ?? "").trim() || null,
    lastAttemptStatus: String(query["lastAttemptStatus"] ?? "").trim() || null,
    retryPending: retryRaw === "true" || retryRaw === "1" ? true
      : retryRaw === "false" || retryRaw === "0" ? false
      : null,
    batchId: Number.isInteger(batchId) && batchId > 0 ? batchId : null,
    source: String(query["source"] ?? "").trim() || null,
    search: String(query["search"] ?? "").trim() || null,
  };
}

export const LEGACY_CAMPAIGN_KPI_SURFACES = [
  "GET /campaigns/:id/analytics (campaignLeadFunnelSelect)",
  "GET /campaigns/:id/batches/:batchId/workspace/kpis",
  "GET /campaigns/:id/batches/:batchId/workspace/funnel",
  "GET /campaigns/:id/batches/:batchId/workspace/leads (status=connected includes completed/transferred)",
  "GET /campaigns/:id/batches/:batchId/analytics",
  "GET /campaigns/:id/live-queue (failed tab = call_status failed)",
  "GET /campaigns command-center",
  "dashboard campaign overview tiles (resolveCampaignOverviewMetrics)",
  "dashboard batch workspace KPI cards",
  "platform-analytics.ts (separate operational_outcome vocabulary)",
] as const;
