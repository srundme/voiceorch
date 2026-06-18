/**
 * minute-rates.ts — flat per-minute billing rates
 *
 * Two tiers:
 *   managed — $0.050 / min  (5 cents)   agent uses platform-provided keys
 *   byop    — $0.035 / min  (3.5 cents) agent uses the user's own API keys
 *
 * Rates are exposed via GET /billing/rates and used in both the telephony
 * call-end path (calls.ts) and the webcall path (webcall.ts).
 */

export const MANAGED_RATE_CENTS_PER_MIN = 5;    // $0.050 / min
export const BYOP_RATE_CENTS_PER_MIN    = 3.5;  // $0.035 / min

/**
 * Returns the flat per-minute charge in cents for an agent based on its mode.
 * Unrecognised / null modes default to the BYOP rate.
 */
export function getFlatRateCentsPerMin(agentMode: string | null | undefined): number {
  return agentMode === "managed" ? MANAGED_RATE_CENTS_PER_MIN : BYOP_RATE_CENTS_PER_MIN;
}

/** Invalidate cache shim — kept for callers that still import it; now a no-op. */
export function invalidateMinuteRatesCache(): void {}
