/**
 * Canonical campaign reporting types and URL helpers for the operations workspace.
 * Counts and lead filters must use the same `view` query as GET /lead-reporting.
 */

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

export type CampaignReportingLead = {
  leadId: number;
  batchId: number | null;
  phone: string | null;
  name: string | null;
  answeredEver: boolean;
  lifecycleStatus: string;
  lastAttemptStatus: string | null;
  operationalOutcome: string;
  disposition: string | null;
  dispositionBucket?: string | null;
  callAttempts: number;
  latestCallId: number | null;
  latestAnsweredCallId: number | null;
  latestAnsweredDuration: number | null;
  retryPending: boolean;
  retryScheduledAt: string | null;
  retryReason: string | null;
  retryCount: number;
  retryAttemptNumber?: number | null;
  callbackRequested: boolean;
  bookingCreated: boolean;
  transferCompleted: boolean;
  contactState: CampaignContactState;
  workState: CampaignWorkState;
  source?: string | null;
};

export type CampaignReportingPayload = {
  campaignId: number;
  campaignName?: string;
  batchId?: number;
  funnel: {
    imported: number;
    attempted: number;
    answered: number;
    interested: number;
    booked: number;
    transferred: number;
  };
  liveFloor: {
    queued: number;
    calling: number;
    talking: number;
    slotsUsed: number;
    concurrencyLimit: number;
    availableConcurrency: number;
    platformCap: number | null;
  };
  workTechnical: {
    retryPending: number;
    retryRowCount: number;
    callbacks: number;
    callbackTableLeads?: number;
    noPickup: number;
    busy: number;
    voicemail: number;
    technicalFailed: number;
  };
  rates: {
    answerRate: number;
    interestRate: number;
    conversionRate: number;
    answerRatePct: number;
    interestRatePct: number;
    conversionRatePct: number;
    legacySuccessRate: number;
  };
  compare?: {
    failedVsTechnicalFailed?: { legacyFailed: number; canonicalTechnicalFailed: number };
    callbackSources?: { operationalOutcome: number; callbackTables: number };
    connectedVsAnswered?: { legacyConnected: number; canonicalAnswered: number };
  };
  batches?: Array<{
    batchId: number | null;
    name: string;
    status: string;
    imported: number;
    attempted: number;
    answered: number;
    interested: number;
    retryPending: number;
    progressPct: number;
  }>;
  dispositions?: Array<{ bucket: string; count: number }>;
};

export type CampaignReportingFilter = {
  view?: CampaignReportingView | null;
  disposition?: string | null;
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

export const PRIMARY_LEAD_VIEWS: { id: CampaignReportingView | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "interested", label: "Interested" },
  { id: "callback", label: "Callback" },
  { id: "answered", label: "Answered" },
  { id: "voicemail", label: "Voicemail" },
  { id: "no_pickup", label: "No Pickup" },
  { id: "busy", label: "Busy" },
  { id: "retry", label: "Retry" },
  { id: "technical_failed", label: "Technical Failed" },
];

/** Compact list filters that are not already a disposition chip. */
export const WORK_LEAD_VIEWS: { id: CampaignReportingView; label: string }[] = [
  { id: "answered", label: "Answered" },
  { id: "retry", label: "Retry" },
  { id: "technical_failed", label: "Failed" },
];

export const OUTCOME_CARDS: { view: CampaignReportingView; label: string; empty: string }[] = [
  { view: "interested", label: "Interested", empty: "No leads have been marked interested yet." },
  { view: "callback", label: "Callback", empty: "No callback requests yet." },
  { view: "retry", label: "Retry", empty: "There are no scheduled retries." },
  { view: "no_pickup", label: "No Pickup", empty: "No never-answered no-pickup leads." },
  { view: "busy", label: "Busy", empty: "No never-answered busy leads." },
  { view: "voicemail", label: "Voicemail", empty: "No voicemail attempts." },
  { view: "technical_failed", label: "Technical Failed", empty: "No never-answered technical failures." },
];

export const PRIMARY_CAMPAIGN_TABS = ["overview", "leads", "analytics", "settings"] as const;
export type PrimaryCampaignTab = (typeof PRIMARY_CAMPAIGN_TABS)[number];

const LEGACY_TAB_REDIRECT: Record<string, { tab: PrimaryCampaignTab; view?: CampaignReportingView; operationalOutcome?: string }> = {
  "live-queue": { tab: "overview" },
  incoming: { tab: "leads" },
  callbacks: { tab: "leads", view: "callback" },
  transfers: { tab: "leads", operationalOutcome: "transfer_completed" },
  bookings: { tab: "leads", operationalOutcome: "booking_created" },
  config: { tab: "settings" },
};

export function isLegacyCampaignTab(raw: string | null | undefined): boolean {
  return !!raw && raw in LEGACY_TAB_REDIRECT;
}

export function resolveCampaignTab(raw: string | null): {
  tab: PrimaryCampaignTab;
  view?: CampaignReportingView;
  operationalOutcome?: string;
} {
  if (!raw || raw === "overview") return { tab: "overview" };
  if ((PRIMARY_CAMPAIGN_TABS as readonly string[]).includes(raw)) {
    return { tab: raw as PrimaryCampaignTab };
  }
  return LEGACY_TAB_REDIRECT[raw] ?? { tab: "overview" };
}

export function isCampaignReportingView(value: string | null | undefined): value is CampaignReportingView {
  return !!value && (CAMPAIGN_REPORTING_VIEWS as readonly string[]).includes(value);
}

export function parseLeadsSearch(search: string): CampaignReportingFilter {
  const sp = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const viewRaw = sp.get("view");
  const answeredRaw = (sp.get("answeredEver") ?? "").toLowerCase();
  const retryRaw = (sp.get("retryPending") ?? "").toLowerCase();
  const batchRaw = sp.get("batchId");
  const batchId = batchRaw ? Number(batchRaw) : NaN;
  return {
    view: isCampaignReportingView(viewRaw) ? viewRaw : null,
    disposition: sp.get("disposition") || null,
    dispositionBucket: sp.get("dispositionBucket") || null,
    operationalOutcome: sp.get("operationalOutcome") || null,
    answeredEver: answeredRaw === "true" || answeredRaw === "1" ? true
      : answeredRaw === "false" || answeredRaw === "0" ? false
      : null,
    lifecycleStatus: sp.get("lifecycleStatus") || null,
    lastAttemptStatus: sp.get("lastAttemptStatus") || null,
    retryPending: retryRaw === "true" || retryRaw === "1" ? true
      : retryRaw === "false" || retryRaw === "0" ? false
      : null,
    batchId: Number.isInteger(batchId) && batchId > 0 ? batchId : null,
    source: sp.get("source") || null,
    search: sp.get("search") || null,
  };
}

export function leadsSearchFromFilter(filter: CampaignReportingFilter, tab = "leads"): string {
  const sp = new URLSearchParams();
  if (tab && tab !== "overview") sp.set("tab", tab);
  if (filter.view) sp.set("view", filter.view);
  if (filter.disposition) sp.set("disposition", filter.disposition);
  if (filter.dispositionBucket) sp.set("dispositionBucket", filter.dispositionBucket);
  if (filter.operationalOutcome) sp.set("operationalOutcome", filter.operationalOutcome);
  if (filter.answeredEver != null) sp.set("answeredEver", String(filter.answeredEver));
  if (filter.lifecycleStatus) sp.set("lifecycleStatus", filter.lifecycleStatus);
  if (filter.lastAttemptStatus) sp.set("lastAttemptStatus", filter.lastAttemptStatus);
  if (filter.retryPending != null) sp.set("retryPending", String(filter.retryPending));
  if (filter.batchId != null) sp.set("batchId", String(filter.batchId));
  if (filter.source) sp.set("source", filter.source);
  if (filter.search) sp.set("search", filter.search);
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

export function campaignLeadsHref(campaignId: number, filter: CampaignReportingFilter): string {
  return `/app/campaigns/${campaignId}${leadsSearchFromFilter(filter)}`;
}

export function batchLeadsHref(campaignId: number, batchId: number, filter: CampaignReportingFilter): string {
  return `/app/campaigns/${campaignId}/batches/${batchId}${leadsSearchFromFilter(filter, "")}`;
}

export function reportingLeadsQuery(filter: CampaignReportingFilter, page: number, limit: number): string {
  const sp = new URLSearchParams();
  if (filter.view) sp.set("view", filter.view);
  if (filter.disposition) sp.set("disposition", filter.disposition);
  if (filter.dispositionBucket) sp.set("dispositionBucket", filter.dispositionBucket);
  if (filter.operationalOutcome) sp.set("operationalOutcome", filter.operationalOutcome);
  if (filter.answeredEver != null) sp.set("answeredEver", String(filter.answeredEver));
  if (filter.lifecycleStatus) sp.set("lifecycleStatus", filter.lifecycleStatus);
  if (filter.lastAttemptStatus) sp.set("lastAttemptStatus", filter.lastAttemptStatus);
  if (filter.retryPending != null) sp.set("retryPending", String(filter.retryPending));
  if (filter.batchId != null) sp.set("batchId", String(filter.batchId));
  if (filter.source) sp.set("source", filter.source);
  if (filter.search) sp.set("search", filter.search);
  sp.set("page", String(page));
  sp.set("limit", String(limit));
  return sp.toString();
}

export function contactStateLabel(state: CampaignContactState): string {
  if (state === "answered") return "Answered";
  if (state === "attempted") return "Attempted";
  return "Never Attempted";
}

export function businessOutcomeLabel(outcome: string | null | undefined): string {
  switch (outcome) {
    case "interest_confirmed": return "Interested";
    case "callback_requested": return "Callback";
    case "booking_created": return "Booked";
    case "transfer_completed": return "Transferred";
    case "not_interested": return "Not Interested";
    case "dnc_blocked": return "DNC";
    case "no_contact": return "No Contact";
    case "failed": return "Failed";
    case "pending": return "Pending";
    default: return outcome ? outcome.replace(/_/g, " ") : "—";
  }
}

export function displayDispositionLabel(bucket: string | null | undefined): string {
  if (!bucket || bucket === "unlabeled") return "No label";
  return bucket.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function attemptStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  const key = status.trim().toLowerCase();
  const map: Record<string, string> = {
    answered: "Answered",
    calling: "Calling",
    connected: "Talking",
    completed: "Completed",
    caller_hangup: "Caller Hangup",
    agent_end: "Completed",
    busy: "Busy",
    no_pickup: "No Pickup",
    voicemail: "Voicemail",
    dropped: "Dropped",
    dial_error: "Dial Error",
    failed: "Failed",
    transferred: "Transferred",
    stuck_calling: "Stuck Calling",
  };
  return map[key] ?? status.replace(/_/g, " ");
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  return m > 0 ? `${m}m ${seconds % 60}s` : `${seconds}s`;
}

export function formatRetryAt(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { hour: "numeric", minute: "2-digit", weekday: "short" });
}

export function nextWorkLabel(lead: Pick<CampaignReportingLead, "workState" | "retryScheduledAt" | "callbackRequested">): string {
  if (lead.workState === "live") return "Live";
  if (lead.workState === "retry_scheduled") {
    const when = formatRetryAt(lead.retryScheduledAt);
    return when ? `Retry ${when}` : "Retry scheduled";
  }
  if (lead.workState === "callback_due" || lead.callbackRequested) return "Callback due";
  if (lead.workState === "terminal") return "Terminal";
  return "—";
}

/** Historical answered+failed must never present as a primary Failed badge. */
export function primaryLeadTone(lead: Pick<CampaignReportingLead, "answeredEver" | "contactState" | "operationalOutcome" | "lifecycleStatus">): "default" | "attention" {
  if (lead.answeredEver) return "default";
  if (lead.operationalOutcome === "dnc_blocked") return "attention";
  if (!lead.answeredEver && (lead.lifecycleStatus === "failed" || lead.lifecycleStatus === "exhausted")) {
    return "attention";
  }
  return "default";
}
