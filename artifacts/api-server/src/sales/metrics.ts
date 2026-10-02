import { inPeriod, type Period } from "./time.js";

export interface Ratio {
  value: number | null;
  label: string;
}

export function ratio(numerator: number, denominator: number, label: string): Ratio {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return { value: null, label: `${label}: no data (denominator is 0)` };
  }
  return { value: numerator / denominator, label };
}

export interface ActivityFlagRow {
  status: string;
  occurredAt: Date | null;
  flagVisit: boolean;
  flagFirstVisit: boolean;
  flagBuyerConversation: boolean;
  flagDemo: boolean;
}

export interface ActivityCounts {
  visits: number;
  firstVisits: number;
  conversations: number;
  demos: number;
}

export const NEW_PILOT_RULE =
  "A new pilot is counted once, on the Asia/Kolkata day its onboarding started (sales_pilots.onboarding_started_at). The activity flag_pilot_started is informational only and never counted.";

export function countActivityFlags(rows: ActivityFlagRow[], period: Period): ActivityCounts {
  const counts: ActivityCounts = { visits: 0, firstVisits: 0, conversations: 0, demos: 0 };
  for (const row of rows) {
    if (row.status !== "completed" || !inPeriod(row.occurredAt, period)) continue;
    if (row.flagVisit) counts.visits++;
    if (row.flagVisit && row.flagFirstVisit) counts.firstVisits++;
    if (row.flagBuyerConversation) counts.conversations++;
    if (row.flagDemo) counts.demos++;
  }
  return counts;
}

export const MRR_RULE =
  "MRR is the sum of monthly fees of non-demo subscriptions with status 'active'. Paused and cancelled subscriptions are excluded. Active subscriptions whose renewal date has passed without a verified renewal payment stay in MRR but are flagged overdue and counted separately.";

export interface MrrSubscriptionRow {
  status: string;
  monthlyFeePaise: number;
  renewalDate: string | null;
}

export function mrrSummary(subs: MrrSubscriptionRow[], dateStr: string) {
  const active = subs.filter((s) => s.status === "active");
  const overdue = active.filter((s) => s.renewalDate != null && s.renewalDate < dateStr);
  return {
    activeMrrPaise: active.reduce((n, s) => n + s.monthlyFeePaise, 0),
    activeSubscriptions: active.length,
    overdueMrrPaise: overdue.reduce((n, s) => n + s.monthlyFeePaise, 0),
    overdueSubscriptions: overdue.length,
    mrrRule: MRR_RULE,
  };
}

export interface Rate {
  value: number | null;
  numerator: number;
  denominator: number;
  label: string;
}

export function rate(numerator: number, denominator: number, label: string): Rate {
  return { value: denominator > 0 ? numerator / denominator : null, numerator, denominator, label };
}

export interface SnapshotMetrics {
  attempts: number;
  distinctRecords: number;
  answered: number;
  meaningful: number;
  qualifiedPeople: number;
  acceptedOutcomes: number;
  callbackRequests: number;
  confirmedAppointments: number;
  connectedMinutes: number;
  costPaise: number;
}

export const SNAPSHOT_METRIC_KEYS: Array<keyof SnapshotMetrics> = [
  "attempts",
  "distinctRecords",
  "answered",
  "meaningful",
  "qualifiedPeople",
  "acceptedOutcomes",
  "callbackRequests",
  "confirmedAppointments",
  "connectedMinutes",
  "costPaise",
];

export function snapshotConsistencyErrors(m: SnapshotMetrics): string[] {
  const errors: string[] = [];
  for (const key of SNAPSHOT_METRIC_KEYS) {
    if (!Number.isInteger(m[key]) || m[key] < 0) errors.push(`${key} must be a whole number >= 0`);
  }
  if (errors.length) return errors;
  const le = (a: keyof SnapshotMetrics, b: keyof SnapshotMetrics) => {
    if (m[a] > m[b]) errors.push(`${a} (${m[a]}) cannot exceed ${b} (${m[b]})`);
  };
  le("distinctRecords", "attempts");
  le("answered", "attempts");
  le("meaningful", "answered");
  le("qualifiedPeople", "meaningful");
  le("acceptedOutcomes", "answered");
  le("callbackRequests", "answered");
  le("confirmedAppointments", "answered");
  return errors;
}

export function pilotRates(m: SnapshotMetrics | null) {
  const s = m ?? { attempts: 0, answered: 0, meaningful: 0, qualifiedPeople: 0, acceptedOutcomes: 0, callbackRequests: 0, confirmedAppointments: 0 };
  return {
    answerRate: rate(s.answered, s.attempts, "answered of call attempts"),
    meaningfulRate: rate(s.meaningful, s.answered, "meaningful conversations of answered calls"),
    qualifiedRate: rate(s.qualifiedPeople, s.meaningful, "qualified people of meaningful conversations"),
    acceptedRate: rate(s.acceptedOutcomes, s.answered, "accepted outcomes of answered calls"),
    callbackRate: rate(s.callbackRequests, s.answered, "callback requests of answered calls"),
    appointmentRate: rate(s.confirmedAppointments, s.answered, "confirmed appointments of answered calls"),
  };
}

export interface AllowanceInput {
  attemptAllowance: number;
  extensionAttempts: number | null;
}

export function pilotAllowance(pilot: AllowanceInput, attemptsUsed: number | null) {
  const extension = pilot.extensionAttempts ?? 0;
  const revised = pilot.attemptAllowance + extension;
  const used = attemptsUsed ?? 0;
  return {
    baseAllowance: pilot.attemptAllowance,
    extensionAttempts: pilot.extensionAttempts,
    revisedAllowance: revised,
    attemptsUsed: attemptsUsed,
    remaining: Math.max(0, revised - used),
    overAllowance: used > revised,
    overBy: Math.max(0, used - revised),
    note: "Attempt allowance is a commercial limit for reporting; actual results beyond it are retained and flagged, not discarded.",
  };
}

export function proposalAmounts(p: { monthlyFeePaise: number; setupFeePaise: number; gstRateBps: number }) {
  const monthlyTaxPaise = Math.round((p.monthlyFeePaise * p.gstRateBps) / 10_000);
  const setupTaxPaise = Math.round((p.setupFeePaise * p.gstRateBps) / 10_000);
  return {
    monthlyFeePaise: p.monthlyFeePaise,
    monthlyTaxPaise,
    monthlyTotalPaise: p.monthlyFeePaise + monthlyTaxPaise,
    setupFeePaise: p.setupFeePaise,
    setupTaxPaise,
    setupTotalPaise: p.setupFeePaise + setupTaxPaise,
    firstInvoiceTotalPaise: p.monthlyFeePaise + monthlyTaxPaise + p.setupFeePaise + setupTaxPaise,
  };
}

export interface FirstMonthPaymentRow {
  id: number;
  receivedAt: Date;
  netFeePaise: number;
}

export function qualifyingFirstPaidAt(payments: FirstMonthPaymentRow[], thresholdPaise: number | null): Date | null {
  if (thresholdPaise == null || thresholdPaise <= 0) return null;
  const sorted = [...payments].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime() || a.id - b.id);
  let cumulative = 0;
  for (const p of sorted) {
    cumulative += p.netFeePaise;
    if (cumulative >= thresholdPaise) return p.receivedAt;
  }
  return null;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export interface CashPaymentRow {
  status: string;
  receivedAt: Date;
  feePaise: number;
  taxPaise: number;
}

export interface CashAdjustmentRow {
  createdAt: Date;
  feeDeltaPaise: number;
  taxDeltaPaise: number;
  paymentStatus: string;
}

export interface CashTotals {
  feePaise: number;
  taxPaise: number;
  totalPaise: number;
}

export function cashCollected(
  payments: CashPaymentRow[],
  adjustments: CashAdjustmentRow[],
  period: Period,
): CashTotals {
  let fee = 0;
  let tax = 0;
  for (const p of payments) {
    if (p.status !== "verified" || !inPeriod(p.receivedAt, period)) continue;
    fee += p.feePaise;
    tax += p.taxPaise;
  }
  for (const a of adjustments) {
    if (a.paymentStatus !== "verified" || !inPeriod(a.createdAt, period)) continue;
    fee += a.feeDeltaPaise;
    tax += a.taxDeltaPaise;
  }
  return { feePaise: fee, taxPaise: tax, totalPaise: fee + tax };
}

export function countInPeriod(instants: Array<Date | null>, period: Period): number {
  return instants.reduce((n, d) => (inPeriod(d, period) ? n + 1 : n), 0);
}

export interface CumulativeTarget {
  date: string;
  operatingPaid: number;
  stretchPaid: number;
}

export function nearestMilestone(targets: CumulativeTarget[], dateStr: string): CumulativeTarget | null {
  const sorted = [...targets].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.find((t) => t.date >= dateStr) ?? sorted[sorted.length - 1] ?? null;
}

export interface GoalProgress {
  actual: number;
  target: number;
  remaining: number;
  progress: Ratio;
}

export function goalProgress(actual: number, target: number, label: string): GoalProgress {
  return { actual, target, remaining: Math.max(0, target - actual), progress: ratio(actual, target, label) };
}

export function netPaymentFeePaise(feePaise: number, adjustments: Array<{ feeDeltaPaise: number }>): number {
  return adjustments.reduce((n, a) => n + a.feeDeltaPaise, feePaise);
}
