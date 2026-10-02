import { and, eq, gte, inArray, lte } from "drizzle-orm";
import {
  salesActivitiesTable,
  salesCompaniesTable,
  salesExpensesTable,
  salesOpportunitiesTable,
  salesPaymentAdjustmentsTable,
  salesPaymentsTable,
  salesPilotsTable,
  salesSubscriptionsTable,
  salesTargetsTable,
  salesUsersTable,
  type SalesCompany,
} from "@workspace/db/schema";
import type { SalesDb } from "./db.js";
import { cashCollected, countActivityFlags, mrrSummary, NEW_PILOT_RULE, rate, ratio, type ActivityFlagRow } from "./metrics.js";
import { ACTIVE_PILOT_STATUSES } from "./opportunity-service.js";
import { latestSnapshots } from "./pilot-service.js";
import { FIRST_PAID_RULE } from "./revenue-core.js";
import type { ReportsQuery } from "./schemas.js";
import type { SalesConfig } from "./settings-schema.js";
import { addDays, inPeriod, isoWeekday, localDateString, periodFromDates, type Period } from "./time.js";

const AGE_BUCKETS = [
  { label: "0-7", max: 7 },
  { label: "8-14", max: 14 },
  { label: "15-30", max: 30 },
  { label: "31+", max: Infinity },
] as const;
const DAY_MS = 86_400_000;

type GroupBy = NonNullable<ReportsQuery["groupBy"]>;

function cohortKey(dateStr: string, kind: "week" | "month"): string {
  return kind === "month" ? `${dateStr.slice(0, 7)}-01` : addDays(dateStr, 1 - isoWeekday(dateStr));
}

function emptyCounts() {
  return { visits: 0, firstVisits: 0, conversations: 0, demos: 0, pilotsStarted: 0, newPaid: 0 };
}

export async function getReports(db: SalesDb, q: ReportsQuery, config: SalesConfig, now = new Date()) {
  const tz = config.timezone;
  const period: Period = periodFromDates(q.from, q.to, tz);
  const today = localDateString(now, tz);
  const asOf = new Date(Math.min(period.end.getTime(), now.getTime()));
  const asOfDate = q.to < today ? q.to : today;
  const demo = q.demo;

  const companies = await db.select().from(salesCompaniesTable).where(eq(salesCompaniesTable.isDemo, demo));
  const byId = new Map(companies.map((c) => [c.id, c]));
  const users = await db.select({ id: salesUsersTable.id, name: salesUsersTable.name, email: salesUsersTable.email }).from(salesUsersTable);
  const userName = new Map(users.map((u) => [u.id, u.name || u.email]));
  const groupKey = (c: SalesCompany | undefined, by: GroupBy): string => {
    if (!c) return "(unknown)";
    if (by === "city") return c.city ?? "(no city)";
    if (by === "sector") return c.sector ?? "(no sector)";
    if (by === "source") return c.originalSource ?? "(no source)";
    return c.ownerId ? userName.get(c.ownerId) ?? `user ${c.ownerId}` : "(unassigned)";
  };

  const activities = await db
    .select({
      companyId: salesActivitiesTable.companyId,
      status: salesActivitiesTable.status,
      occurredAt: salesActivitiesTable.occurredAt,
      flagVisit: salesActivitiesTable.flagVisit,
      flagFirstVisit: salesActivitiesTable.flagFirstVisit,
      flagBuyerConversation: salesActivitiesTable.flagBuyerConversation,
      flagDemo: salesActivitiesTable.flagDemo,
    })
    .from(salesActivitiesTable)
    .where(and(
      eq(salesActivitiesTable.isDemo, demo),
      eq(salesActivitiesTable.status, "completed"),
      gte(salesActivitiesTable.occurredAt, period.start),
      lte(salesActivitiesTable.occurredAt, period.end),
    ));
  const pilots = await db.select().from(salesPilotsTable).where(eq(salesPilotsTable.isDemo, demo));
  const startedPilots = pilots.filter((p) => inPeriod(p.onboardingStartedAt, period));
  const newPaid = companies.filter((c) => inPeriod(c.firstPaidAt, period));

  const activityTotals = { ...countActivityFlags(activities, period), pilotsStarted: startedPilots.length, newPaid: newPaid.length };
  let activityGroups: Array<{ key: string } & ReturnType<typeof emptyCounts>> | null = null;
  if (q.groupBy) {
    const by = q.groupBy;
    const groups = new Map<string, ReturnType<typeof emptyCounts>>();
    const bucket = (key: string) => groups.get(key) ?? groups.set(key, emptyCounts()).get(key)!;
    const rowsByKey = new Map<string, ActivityFlagRow[]>();
    for (const a of activities) {
      const key = groupKey(byId.get(a.companyId), by);
      (rowsByKey.get(key) ?? rowsByKey.set(key, []).get(key)!).push(a);
    }
    for (const [key, rows] of rowsByKey) Object.assign(bucket(key), countActivityFlags(rows, period));
    for (const p of startedPilots) bucket(groupKey(byId.get(p.companyId), by)).pilotsStarted++;
    for (const c of newPaid) bucket(groupKey(c, by)).newPaid++;
    activityGroups = [...groups.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => a.key.localeCompare(b.key));
  }

  const steps = [
    ["Visits", activityTotals.visits],
    ["Buyer conversations", activityTotals.conversations],
    ["Demos", activityTotals.demos],
    ["New pilots", activityTotals.pilotsStarted],
    ["New paying companies", activityTotals.newPaid],
  ] as const;
  const funnel = {
    note: "Counts of events inside the period (not a cohort). Each step shows its rate against the previous step with numerator and denominator.",
    steps: steps.map(([stage, count], i) => ({
      stage,
      count,
      fromPrevious: i === 0 ? null : rate(count, steps[i - 1]![1], `${stage} of ${steps[i - 1]![0].toLowerCase()}`),
    })),
  };

  const opps = await db.select().from(salesOpportunitiesTable).where(eq(salesOpportunitiesTable.isDemo, demo));
  const ageing = new Map<string, { stage: string; total: number; buckets: Record<string, number> }>();
  for (const o of opps) {
    if (o.stage === "Lost" || o.stage === "Live") continue;
    const days = Math.max(0, Math.floor((asOf.getTime() - o.stageChangedAt.getTime()) / DAY_MS));
    const label = AGE_BUCKETS.find((b) => days <= b.max)!.label;
    const row = ageing.get(o.stage) ?? ageing.set(o.stage, { stage: o.stage, total: 0, buckets: Object.fromEntries(AGE_BUCKETS.map((b) => [b.label, 0])) }).get(o.stage)!;
    row.total++;
    row.buckets[label]!++;
  }
  const lossCounts = new Map<string, number>();
  for (const o of opps) {
    if (o.stage !== "Lost" || !inPeriod(o.closedAt, period)) continue;
    const reason = o.lostReason?.trim() || "(no reason)";
    lossCounts.set(reason, (lossCounts.get(reason) ?? 0) + 1);
  }

  const expenses = await db
    .select()
    .from(salesExpensesTable)
    .where(and(eq(salesExpensesTable.isDemo, demo), gte(salesExpensesTable.date, q.from), lte(salesExpensesTable.date, q.to)));
  const latest = await latestSnapshots(db, startedPilots.map((p) => p.id));
  const snapshotCostPaise = startedPilots.reduce((n, p) => n + (latest.get(p.id)?.costPaise ?? 0), 0);
  const pilotExpensePaise = expenses.filter((e) => e.category === "pilot_cost").reduce((n, e) => n + e.amountPaise, 0);
  const pilotCostTotal = snapshotCostPaise + pilotExpensePaise;
  const pilotCosts = {
    pilotsStarted: startedPilots.length,
    snapshotCostPaise,
    pilotCostExpensesPaise: pilotExpensePaise,
    totalPaise: pilotCostTotal,
    perPilotPaise: startedPilots.length ? Math.round(pilotCostTotal / startedPilots.length) : null,
    rule: "Latest snapshot cost of pilots whose onboarding started in the period, plus expenses in category pilot_cost dated in the period.",
  };

  const payments = await db.select().from(salesPaymentsTable).where(eq(salesPaymentsTable.isDemo, demo));
  const adjustments = payments.length
    ? await db
        .select({
          paymentId: salesPaymentAdjustmentsTable.paymentId,
          createdAt: salesPaymentAdjustmentsTable.createdAt,
          feeDeltaPaise: salesPaymentAdjustmentsTable.feeDeltaPaise,
          taxDeltaPaise: salesPaymentAdjustmentsTable.taxDeltaPaise,
        })
        .from(salesPaymentAdjustmentsTable)
        .where(inArray(salesPaymentAdjustmentsTable.paymentId, payments.map((p) => p.id)))
    : [];
  const statusOf = new Map(payments.map((p) => [p.id, p.status]));
  const kindOf = new Map(payments.map((p) => [p.id, p.kind]));
  const adjRows = adjustments.map((a) => ({ ...a, paymentStatus: statusOf.get(a.paymentId) ?? "recorded" }));
  const byKind = Object.fromEntries(
    [...new Set(payments.map((p) => p.kind))].map((kind) => [
      kind,
      cashCollected(payments.filter((p) => p.kind === kind), adjRows.filter((a) => kindOf.get(a.paymentId) === kind), period),
    ]),
  );
  const cash = {
    ...cashCollected(payments, adjRows, period),
    byKind,
    rule: "Verified payments received in the period plus corrections/refunds recorded in the period; fee and tax are kept separate.",
  };

  const subs = await db.select().from(salesSubscriptionsTable).where(eq(salesSubscriptionsTable.isDemo, demo));
  const mrr = { asOfDate, ...mrrSummary(subs, asOfDate) };
  const newLive = subs
    .filter((s) => inPeriod(s.liveAt, period))
    .sort((a, b) => a.liveAt!.getTime() - b.liveAt!.getTime());
  const renewalDue = subs.filter((s) => (s.status === "active" || s.status === "paused") && s.renewalDate && s.renewalDate >= q.from && s.renewalDate <= q.to);
  const renewalPayments = payments.filter((p) => p.kind === "renewal" && p.status === "verified" && inPeriod(p.receivedAt, period));
  const renewals = {
    dueInPeriod: renewalDue.length,
    overdue: renewalDue.filter((s) => s.renewalDate! < today && s.status === "active").length,
    upcoming: renewalDue.filter((s) => s.renewalDate! >= today).length,
    verifiedRenewalPayments: renewalPayments.length,
    verifiedRenewalFeePaise: renewalPayments.reduce((n, p) => n + p.feePaise, 0),
    items: renewalDue
      .sort((a, b) => a.renewalDate!.localeCompare(b.renewalDate!))
      .map((s) => ({
        subscriptionId: s.id,
        companyId: s.companyId,
        companyName: byId.get(s.companyId)?.name ?? null,
        renewalDate: s.renewalDate,
        monthlyFeePaise: s.monthlyFeePaise,
        status: s.status !== "active" ? s.status : s.renewalDate! < today ? "overdue" : "upcoming",
      })),
    rule: "A verified renewal payment moves the renewal date forward one month, so a renewal date in the past means the renewal is still unpaid.",
  };

  const cohorts = new Map<string, typeof startedPilots>();
  for (const p of startedPilots) {
    const key = cohortKey(localDateString(p.onboardingStartedAt!, tz), q.cohort);
    (cohorts.get(key) ?? cohorts.set(key, []).get(key)!).push(p);
  }
  const pilotCohorts = {
    kind: q.cohort,
    rule: `${NEW_PILOT_RULE} Converted means the company's first_paid_at is on or after the pilot's onboarding start. An extension stays inside its original pilot and never creates a new pilot or cohort entry.`,
    cohorts: [...cohorts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cohortStart, list]) => {
        const converted = list.filter((p) => {
          const paid = byId.get(p.companyId)?.firstPaidAt;
          return paid != null && paid.getTime() >= p.onboardingStartedAt!.getTime();
        });
        const convertedIds = new Set(converted.map((p) => p.id));
        return {
          cohortStart,
          cohortAgeDays: Math.max(0, Math.floor((Date.parse(`${asOfDate}T00:00:00Z`) - Date.parse(`${cohortStart}T00:00:00Z`)) / DAY_MS)),
          started: list.length,
          active: list.filter((p) => (ACTIVE_PILOT_STATUSES as readonly string[]).includes(p.status)).length,
          completed: list.filter((p) => p.status === "Completed").length,
          cancelled: list.filter((p) => p.status === "Cancelled").length,
          converted: converted.length,
          pending: list.filter((p) => !convertedIds.has(p.id) && p.status !== "Cancelled").length,
          extensions: list.filter((p) => p.extensionAttempts != null).length,
          conversionRate: rate(converted.length, list.length, "converted of pilots started"),
        };
      }),
  };

  const acquisitionExpenses = expenses.filter((e) => e.isAcquisition);
  const includedExpenseCategories = [...new Set(acquisitionExpenses.map((e) => e.category))].sort();
  const sources = [...new Set([...config.sources, ...newPaid.map((c) => c.originalSource ?? "(no source)"), ...acquisitionExpenses.map((e) => e.source ?? "(unattributed)")])];
  const acquisitionCost = {
    includedExpenseCategories,
    label: `Acquisition spend = expenses marked isAcquisition dated in the period${includedExpenseCategories.length ? ` (categories: ${includedExpenseCategories.join(", ")})` : " (none recorded)"}, attributed by expense source. New paying companies are counted by original lead source.`,
    bySource: sources.map((source) => {
      const spendPaise = acquisitionExpenses.filter((e) => (e.source ?? "(unattributed)") === source).reduce((n, e) => n + e.amountPaise, 0);
      const paid = newPaid.filter((c) => (c.originalSource ?? "(no source)") === source).length;
      return { source, spendPaise, newPaid: paid, costPerNewPaidPaise: paid > 0 ? Math.round(spendPaise / paid) : null };
    }),
  };

  const dailyTargets = await db
    .select()
    .from(salesTargetsTable)
    .where(and(eq(salesTargetsTable.kind, "daily"), gte(salesTargetsTable.date, q.from), lte(salesTargetsTable.date, q.to)));
  const sum = (key: "visits" | "conversations" | "demos" | "pilots") => dailyTargets.reduce((n, t) => n + t[key], 0);
  const targets = {
    note: "Targets are plans, kept separate from actual results.",
    days: dailyTargets.length,
    visits: { target: sum("visits"), actual: activityTotals.visits, progress: ratio(activityTotals.visits, sum("visits"), "Visits vs target") },
    conversations: { target: sum("conversations"), actual: activityTotals.conversations, progress: ratio(activityTotals.conversations, sum("conversations"), "Conversations vs target") },
    demos: { target: sum("demos"), actual: activityTotals.demos, progress: ratio(activityTotals.demos, sum("demos"), "Demos vs target") },
    pilots: { target: sum("pilots"), actual: activityTotals.pilotsStarted, progress: ratio(activityTotals.pilotsStarted, sum("pilots"), "New pilots vs target") },
    goals: config.goals,
  };

  const assumption = (key: string) => config.forecast.assumptions.find((a) => a.key === key)?.value ?? null;
  const chain = ["visitToConversation", "conversationToDemo", "demoToPilot", "pilotToPaid"];
  const missing = chain.filter((k) => assumption(k) == null);
  const forecastStart = today > config.sprint.start ? addDays(today, 1) : config.sprint.start;
  const remainingTargets = await db
    .select({ visits: salesTargetsTable.visits })
    .from(salesTargetsTable)
    .where(and(eq(salesTargetsTable.kind, "daily"), gte(salesTargetsTable.date, forecastStart), lte(salesTargetsTable.date, config.sprint.end)));
  const remainingVisits = remainingTargets.reduce((n, t) => n + t.visits, 0);
  const activeNow = pilots.filter((p) => (ACTIVE_PILOT_STATUSES as readonly string[]).includes(p.status)).length;
  let projected: Record<string, number> | null = null;
  if (!missing.length) {
    const conversations = remainingVisits * assumption("visitToConversation")!;
    const demos = conversations * assumption("conversationToDemo")!;
    const newPilots = demos * assumption("demoToPilot")!;
    const paidFromNew = newPilots * assumption("pilotToPaid")!;
    const paidFromActive = activeNow * assumption("pilotToPaid")!;
    projected = {
      conversations: Math.round(conversations * 10) / 10,
      demos: Math.round(demos * 10) / 10,
      newPilots: Math.round(newPilots * 10) / 10,
      newPaidFromNewPilots: Math.round(paidFromNew * 10) / 10,
      newPaidFromActivePilots: Math.round(paidFromActive * 10) / 10,
      totalAdditionalNewPaid: Math.round((paidFromNew + paidFromActive) * 10) / 10,
    };
  }
  const forecast = {
    label: "Forecast — derived only from the assumptions listed here; it is not an actual result.",
    assumptions: config.forecast.assumptions,
    inputs: {
      remainingSprintFrom: forecastStart,
      sprintEnd: config.sprint.end,
      remainingTargetVisits: remainingVisits,
      activePilotsNow: activeNow,
      method: "remaining target visits × visit→conversation × conversation→demo × demo→pilot × pilot→paid, plus active pilots × pilot→paid",
    },
    missingAssumptions: missing,
    projected,
  };

  return {
    from: q.from,
    to: q.to,
    timezone: tz,
    demo,
    groupBy: q.groupBy ?? null,
    activity: { totals: activityTotals, groups: activityGroups, newPilotRule: NEW_PILOT_RULE },
    funnel,
    stageAgeing: { asOf, buckets: AGE_BUCKETS.map((b) => b.label), stages: [...ageing.values()] },
    lossReasons: [...lossCounts.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    pilotCosts,
    cash,
    newPaidClients: {
      count: newPaid.length,
      rule: FIRST_PAID_RULE,
      items: newPaid.map((c) => ({ companyId: c.id, name: c.name, firstPaidAt: c.firstPaidAt, source: c.originalSource })),
    },
    newLive: {
      count: newLive.length,
      rule: "Subscriptions whose live date falls in the period. Paying (first verified payment) and live (customer switched on) are counted separately.",
      items: newLive.map((s) => ({
        subscriptionId: s.id,
        companyId: s.companyId,
        name: byId.get(s.companyId)?.name ?? null,
        liveAt: s.liveAt,
        status: s.status,
      })),
    },
    mrr,
    renewals,
    pilotCohorts,
    acquisitionCost,
    targets,
    forecast,
  };
}
