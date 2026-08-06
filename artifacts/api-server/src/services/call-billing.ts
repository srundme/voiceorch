/**
 * Pure call-debit helpers (no DB). Used by telephony endSession and HTTP /calls/:id/end.
 */

/**
 * Per-second pro-rata wallet debit in paise.
 * Example @ ₹5/min (500 paise): 9s → 75, 30s → 250, 60s → 500.
 * Never rounds up to a full minute. Minimum 1 paise when there is any billable time.
 */
export function computeProRataDebitCents(
  durationSeconds: number,
  rateCentsPerMin: number,
): number {
  if (!(durationSeconds > 0) || !(rateCentsPerMin > 0)) return 0;
  return Math.max(1, Math.round((durationSeconds / 60) * rateCentsPerMin));
}

/** Outcomes that consumed no real conversation — do not debit the wallet. */
export function isNonBillableCallStatus(status: string | null | undefined): boolean {
  return status === "no_pickup" || status === "busy" || status === "failed" || status === "cancelled";
}
