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
 */

/** Campaign statuses that mean "do not dial / do not refill". */
export const NON_DIALABLE_CAMPAIGN_STATUSES = new Set<string>(["paused", "completed", "cancelled"]);

/**
 * True when a campaign should keep dialing (initial wave, rolling refill,
 * retries). Anything that is not explicitly paused/completed/cancelled counts
 * as dialable — including `draft`, so a started batch is never starved waiting
 * for the legacy `is_active` flag that may never be set.
 */
export function isCampaignDialable(campaign: { status: string | null } | null | undefined): boolean {
  if (!campaign) return false;
  return !NON_DIALABLE_CAMPAIGN_STATUSES.has(campaign.status ?? "");
}
