/**
 * Campaign "is running" gate — single source of truth.
 * ──────────────────────────────────────────────────────────────────────────
 * The rolling-concurrency refill, the backstop poll, and the retry engine all
 * need to answer one question: "should this campaign keep dialing right now?".
 *
 * Historically this was gated on `campaigns.is_active`, but that boolean
 * defaults to `false` and is NOT set when a batch is started (the dashboard
 * Start button only flips the *batch* to `running`, and the campaign
 * pause/resume control writes `campaigns.status`, not `is_active`). The result
 * was a campaign whose batch is running while `is_active` stayed `false`, so
 * `fireStartBatch` (which has no gate) fired the first wave but every
 * event-driven refill silently no-oped.
 *
 * The reliable signal is `campaigns.status`: the UI drives it (draft → active →
 * paused) and pausing always sets it to "paused". A campaign should keep
 * dialing unless it has been explicitly paused or has completed. A `draft`
 * campaign with a running batch is dialable — the running batch is the real
 * "calls should be flowing" signal, enforced by the per-batch claim.
 *
 * Business hours are also enforced here: if businessHoursStart / businessHoursEnd
 * are configured on the campaign, dialing is suppressed outside those hours.
 * The 60 s backstop poll naturally resumes at the next tick after hours open.
 */

/** Campaign statuses that mean "do not dial / do not refill". */
export const NON_DIALABLE_CAMPAIGN_STATUSES = new Set<string>(["paused", "stopped", "completed", "cancelled"]);

type DialableFields = {
  status:                  string | null;
  isCallingHoursEnabled?:  boolean;
  businessHoursStart?:     number | null;
  businessHoursEnd?:       number | null;
  timezone?:               string | null;
};

/**
 * True when a campaign should keep dialing (initial wave, rolling refill,
 * retries). Anything that is not explicitly paused/completed/cancelled counts
 * as dialable — including `draft`, so a started batch is never starved waiting
 * for the legacy `is_active` flag that may never be set.
 *
 * If businessHoursStart/End are set, dialing is additionally gated on the
 * current hour being within [start, end) in the campaign's timezone.
 */
export function isCampaignDialable(campaign: DialableFields | null | undefined): boolean {
  if (!campaign) return false;
  if (NON_DIALABLE_CAMPAIGN_STATUSES.has(campaign.status ?? "")) return false;

  // When calling-hours are disabled, skip the business-hours check (24/7 dialing)
  if (campaign.isCallingHoursEnabled === false) return true;

  const start = campaign.businessHoursStart;
  const end   = campaign.businessHoursEnd;
  if (start != null && end != null) {
    const tz       = campaign.timezone ?? "Asia/Kolkata";
    const nowLocal = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
    const hour     = nowLocal.getHours();
    if (!(start <= hour && hour < end)) return false;
  }

  return true;
}

/**
 * CSV / batch create: start dialing unless the user picked a future Run At
 * or explicitly set autoStart=false (hold as draft).
 * Omitting autoStart (simple Create Batch) starts now — "Launch" must not
 * leave leads queued until the 60s poll (call CSV campaigns stuck in queue).
 */
export function csvBatchShouldStartNow(opts: {
  autoStart?: boolean;
  scheduledStartAt?: Date | null;
  now?: Date;
}): boolean {
  const now = opts.now ?? new Date();
  const startAt = opts.scheduledStartAt ?? null;
  if (startAt != null && startAt.getTime() > now.getTime()) return false;
  return opts.autoStart !== false;
}
