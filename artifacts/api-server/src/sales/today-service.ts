import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, lte, notInArray, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import {
  salesActivitiesTable,
  salesCompaniesTable,
  salesOpportunitiesTable,
  salesPaymentAdjustmentsTable,
  salesPaymentsTable,
  salesPilotsTable,
  salesSubscriptionsTable,
  salesTargetsTable,
  salesTasksTable,
} from "@workspace/db/schema";
import { firstResponseDueAt } from "./company-service.js";
import { isFounder, type SalesActor, type SalesDb } from "./db.js";
import { cashCollected, countActivityFlags, countInPeriod, goalProgress, mrrSummary, nearestMilestone, ratio } from "./metrics.js";
import { ACTIVE_PILOT_STATUSES } from "./opportunity-service.js";
import type { TodayQuery } from "./schemas.js";
import { getSettings } from "./settings-service.js";
import { addDays, businessMinutesBetween, isoWeekday, localDateString, periodBounds } from "./time.js";

const LIST_LIMIT = 50;
const RENEWAL_WINDOW_DAYS = 14;

export async function getToday(db: SalesDb, actor: SalesActor, q: TodayQuery, now = new Date()) {
  const { config } = await getSettings(db);
  const tz = config.timezone;
  const date = q.date ?? localDateString(now, tz);
  const scope = q.scope ?? (isFounder(actor) ? "team" : "mine");
  const ownerId = scope === "mine" ? actor.id : q.ownerId ?? null;
  const demo = q.demo;
  const day = periodBounds("day", date, { tz });
  const sprintToDate = periodBounds("sprint_to_date", date, { tz, sprint: config.sprint });
  const owned = (col: PgColumn): SQL[] => (ownerId ? [eq(col, ownerId)] : []);

  const paidRows = await db
    .select({ firstPaidAt: salesCompaniesTable.firstPaidAt })
    .from(salesCompaniesTable)
    .where(and(eq(salesCompaniesTable.isDemo, demo), isNotNull(salesCompaniesTable.firstPaidAt), ...owned(salesCompaniesTable.ownerId)));
  const paidInstants = paidRows.map((r) => r.firstPaidAt);
  const paidSprintToDate = countInPeriod(paidInstants, sprintToDate);
  const cumulativeTargets = await db
    .select()
    .from(salesTargetsTable)
    .where(and(eq(salesTargetsTable.kind, "cumulative_paid"), gte(salesTargetsTable.date, config.sprint.start), lte(salesTargetsTable.date, config.sprint.end)));
  const milestone = nearestMilestone(cumulativeTargets, date);

  const newPaying = {
    sprintToDate: paidSprintToDate,
    selectedDay: countInPeriod(paidInstants, day),
    period: { from: sprintToDate.from, to: sprintToDate.to },
    operating: goalProgress(paidSprintToDate, config.goals.operatingNewPaid, "New paying companies vs operating goal"),
    stretch: goalProgress(paidSprintToDate, config.goals.stretchNewPaid, "New paying companies vs stretch goal"),
    milestone: milestone
      ? {
          date: milestone.date,
          operatingPaid: milestone.operatingPaid,
          stretchPaid: milestone.stretchPaid,
          operatingProgress: ratio(paidSprintToDate, milestone.operatingPaid, "New paying companies vs milestone (operating)"),
          stretchProgress: ratio(paidSprintToDate, milestone.stretchPaid, "New paying companies vs milestone (stretch)"),
        }
      : null,
  };

  const subs = await db
    .select({
      status: salesSubscriptionsTable.status,
      monthlyFeePaise: salesSubscriptionsTable.monthlyFeePaise,
      renewalDate: salesSubscriptionsTable.renewalDate,
    })
    .from(salesSubscriptionsTable)
    .where(and(eq(salesSubscriptionsTable.isDemo, demo), eq(salesSubscriptionsTable.status, "active"), ...owned(salesSubscriptionsTable.customerOwnerId)));
  const mrr = mrrSummary(subs, date);

  const cashFrom = day.start < sprintToDate.start ? day.start : sprintToDate.start;
  const cashTo = day.end > sprintToDate.end ? day.end : sprintToDate.end;
  const payments = await db
    .select({
      status: salesPaymentsTable.status,
      receivedAt: salesPaymentsTable.receivedAt,
      feePaise: salesPaymentsTable.feePaise,
      taxPaise: salesPaymentsTable.taxPaise,
    })
    .from(salesPaymentsTable)
    .innerJoin(salesCompaniesTable, eq(salesCompaniesTable.id, salesPaymentsTable.companyId))
    .where(and(
      eq(salesPaymentsTable.isDemo, demo),
      eq(salesPaymentsTable.status, "verified"),
      gte(salesPaymentsTable.receivedAt, cashFrom),
      lt(salesPaymentsTable.receivedAt, cashTo),
      ...owned(salesCompaniesTable.ownerId),
    ));
  const adjustments = await db
    .select({
      createdAt: salesPaymentAdjustmentsTable.createdAt,
      feeDeltaPaise: salesPaymentAdjustmentsTable.feeDeltaPaise,
      taxDeltaPaise: salesPaymentAdjustmentsTable.taxDeltaPaise,
      paymentStatus: salesPaymentsTable.status,
    })
    .from(salesPaymentAdjustmentsTable)
    .innerJoin(salesPaymentsTable, eq(salesPaymentsTable.id, salesPaymentAdjustmentsTable.paymentId))
    .innerJoin(salesCompaniesTable, eq(salesCompaniesTable.id, salesPaymentsTable.companyId))
    .where(and(
      eq(salesPaymentsTable.isDemo, demo),
      gte(salesPaymentAdjustmentsTable.createdAt, cashFrom),
      lt(salesPaymentAdjustmentsTable.createdAt, cashTo),
      ...owned(salesCompaniesTable.ownerId),
    ));

  const revenue = {
    ...mrr,
    stretchMrr: goalProgress(mrr.activeMrrPaise, config.goals.stretchMrrPaise, "Active MRR vs stretch MRR goal"),
    cashCollected: {
      sprintToDate: cashCollected(payments, adjustments, sprintToDate),
      selectedDay: cashCollected(payments, adjustments, day),
    },
  };

  const activityRows = await db
    .select({
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
      gte(salesActivitiesTable.occurredAt, day.start),
      lt(salesActivitiesTable.occurredAt, day.end),
      ...owned(salesActivitiesTable.ownerId),
    ));
  const counts = countActivityFlags(activityRows, day);
  const pilotsStarted = await db
    .select({ id: salesPilotsTable.id })
    .from(salesPilotsTable)
    .where(and(
      eq(salesPilotsTable.isDemo, demo),
      gte(salesPilotsTable.onboardingStartedAt, day.start),
      lt(salesPilotsTable.onboardingStartedAt, day.end),
      ...owned(salesPilotsTable.ownerId),
    ));
  const [targetRow] = await db
    .select()
    .from(salesTargetsTable)
    .where(and(eq(salesTargetsTable.kind, "daily"), eq(salesTargetsTable.date, date)));
  const isSundayReview = config.sundayIsReview && isoWeekday(date) === 7;
  const dayType = targetRow?.dayType ?? (isSundayReview ? "review" : null);
  const actual = { visits: counts.visits, firstVisits: counts.firstVisits, conversations: counts.conversations, demos: counts.demos, pilots: pilotsStarted.length };
  const target = targetRow
    ? { visits: targetRow.visits, conversations: targetRow.conversations, demos: targetRow.demos, pilots: targetRow.pilots }
    : null;

  const activity = {
    date,
    dayType,
    isReviewDay: dayType === "review",
    actual,
    target,
    ranges: {
      conversations: { min: config.dailyTargets.conversationsMin, max: config.dailyTargets.conversationsMax },
      demos: { min: config.dailyTargets.demosMin, max: config.dailyTargets.demosMax },
    },
    progress: {
      visits: ratio(actual.visits, target?.visits ?? 0, "Visits vs target"),
      conversations: ratio(actual.conversations, target?.conversations ?? 0, "Buyer conversations vs target"),
      demos: ratio(actual.demos, target?.demos ?? 0, "Demos vs target"),
      pilots: ratio(actual.pilots, target?.pilots ?? 0, "New pilots vs target"),
    },
  };

  const activePilotRows = await db
    .select({ ownerId: salesPilotsTable.ownerId })
    .from(salesPilotsTable)
    .where(and(eq(salesPilotsTable.isDemo, demo), inArray(salesPilotsTable.status, [...ACTIVE_PILOT_STATUSES])));
  const teamActive = activePilotRows.length;
  const activePilots = {
    count: ownerId ? activePilotRows.filter((p) => p.ownerId === ownerId).length : teamActive,
    teamCount: teamActive,
    capacity: config.pilot.activeCapacity,
    utilization: ratio(teamActive, config.pilot.activeCapacity, "Active pilots vs capacity"),
    atCapacity: teamActive >= config.pilot.activeCapacity,
  };

  const overdueRows = await db
    .select({ task: salesTasksTable, companyName: salesCompaniesTable.name })
    .from(salesTasksTable)
    .leftJoin(salesCompaniesTable, eq(salesCompaniesTable.id, salesTasksTable.companyId))
    .where(and(
      eq(salesTasksTable.isDemo, demo),
      eq(salesTasksTable.status, "open"),
      lt(salesTasksTable.dueAt, now),
      ...owned(salesTasksTable.ownerId),
    ))
    .orderBy(asc(salesTasksTable.dueAt))
    .limit(LIST_LIMIT);
  const overdueFollowUps = overdueRows.map((r) => ({
    id: r.task.id,
    title: r.task.title,
    kind: r.task.kind,
    dueAt: r.task.dueAt,
    ownerId: r.task.ownerId,
    companyId: r.task.companyId,
    companyName: r.companyName,
    overdueMinutes: r.task.dueAt ? Math.floor((now.getTime() - r.task.dueAt.getTime()) / 60_000) : null,
  }));

  const scheduledRows = await db
    .select({ activity: salesActivitiesTable, companyName: salesCompaniesTable.name })
    .from(salesActivitiesTable)
    .innerJoin(salesCompaniesTable, eq(salesCompaniesTable.id, salesActivitiesTable.companyId))
    .where(and(
      eq(salesActivitiesTable.isDemo, demo),
      eq(salesActivitiesTable.status, "scheduled"),
      gte(salesActivitiesTable.scheduledAt, day.start),
      lt(salesActivitiesTable.scheduledAt, day.end),
      ...owned(salesActivitiesTable.ownerId),
    ));
  const pilotReviewRows = await db
    .select({ pilot: salesPilotsTable, companyName: salesCompaniesTable.name })
    .from(salesPilotsTable)
    .innerJoin(salesCompaniesTable, eq(salesCompaniesTable.id, salesPilotsTable.companyId))
    .where(and(
      eq(salesPilotsTable.isDemo, demo),
      notInArray(salesPilotsTable.status, ["Completed", "Cancelled"]),
      gte(salesPilotsTable.reviewAt, day.start),
      lt(salesPilotsTable.reviewAt, day.end),
      ...owned(salesPilotsTable.ownerId),
    ));
  const todaysAppointments = [
    ...scheduledRows.map((r) => ({
      kind: r.activity.type === "demo" ? "demo" : r.activity.type === "meeting" ? "meeting" : r.activity.type,
      activityId: r.activity.id as number | null,
      pilotId: null as number | null,
      at: r.activity.scheduledAt!,
      ownerId: r.activity.ownerId,
      companyId: r.activity.companyId,
      companyName: r.companyName,
      contactId: r.activity.contactId,
    })),
    ...pilotReviewRows.map((r) => ({
      kind: "pilot_review",
      activityId: null as number | null,
      pilotId: r.pilot.id as number | null,
      at: r.pilot.reviewAt!,
      ownerId: r.pilot.ownerId,
      companyId: r.pilot.companyId,
      companyName: r.companyName,
      contactId: null as number | null,
    })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  const inboundRows = await db
    .select({
      id: salesCompaniesTable.id,
      name: salesCompaniesTable.name,
      source: salesCompaniesTable.source,
      sourceCampaign: salesCompaniesTable.sourceCampaign,
      city: salesCompaniesTable.city,
      originalEnquiryAt: salesCompaniesTable.originalEnquiryAt,
      createdAt: salesCompaniesTable.createdAt,
    })
    .from(salesCompaniesTable)
    .where(and(
      eq(salesCompaniesTable.isDemo, demo),
      isNull(salesCompaniesTable.ownerId),
      isNull(salesCompaniesTable.lastActivityAt),
      eq(salesCompaniesTable.isInbound, true),
    ))
    .orderBy(asc(salesCompaniesTable.originalEnquiryAt), asc(salesCompaniesTable.id))
    .limit(LIST_LIMIT);
  const unassignedInbound = inboundRows.map((r) => {
    const enquiredAt = r.originalEnquiryAt ?? r.createdAt;
    const ageMinutes = Math.max(0, Math.floor((now.getTime() - enquiredAt.getTime()) / 60_000));
    const businessAgeMinutes = businessMinutesBetween(enquiredAt, now, config.businessHours, tz);
    return {
      ...r,
      enquiredAt,
      ageMinutes,
      businessAgeMinutes,
      responseDueAt: firstResponseDueAt(enquiredAt, config),
      breachedResponseTarget: businessAgeMinutes > config.responseTargetMinutes,
    };
  });

  const renewalRows = await db
    .select({ subscription: salesSubscriptionsTable, companyName: salesCompaniesTable.name })
    .from(salesSubscriptionsTable)
    .innerJoin(salesCompaniesTable, eq(salesCompaniesTable.id, salesSubscriptionsTable.companyId))
    .where(and(
      eq(salesSubscriptionsTable.isDemo, demo),
      eq(salesSubscriptionsTable.status, "active"),
      gte(salesSubscriptionsTable.renewalDate, date),
      lte(salesSubscriptionsTable.renewalDate, addDays(date, RENEWAL_WINDOW_DAYS)),
      ...owned(salesSubscriptionsTable.customerOwnerId),
    ))
    .orderBy(asc(salesSubscriptionsTable.renewalDate));
  const upcomingRenewals = renewalRows.map((r) => ({
    subscriptionId: r.subscription.id,
    companyId: r.subscription.companyId,
    companyName: r.companyName,
    renewalDate: r.subscription.renewalDate,
    monthlyFeePaise: r.subscription.monthlyFeePaise,
    customerOwnerId: r.subscription.customerOwnerId,
  }));

  const [nextActionHealth] = await db
    .select({
      missing: sql<number>`count(*) FILTER (WHERE coalesce(trim(${salesCompaniesTable.nextAction}), '') = '' OR ${salesCompaniesTable.nextActionDueAt} IS NULL)::int`,
      overdue: sql<number>`count(*) FILTER (WHERE coalesce(trim(${salesCompaniesTable.nextAction}), '') <> '' AND ${salesCompaniesTable.nextActionDueAt} < ${now.toISOString()}::timestamptz)::int`,
    })
    .from(salesCompaniesTable)
    .where(and(
      eq(salesCompaniesTable.isDemo, demo),
      sql`EXISTS (SELECT 1 FROM ${salesOpportunitiesTable} o WHERE o.company_id = ${salesCompaniesTable.id} AND o.stage NOT IN ('Lost', 'Live', 'Later'))`,
      ...owned(salesCompaniesTable.ownerId),
    ));
  const nextActions = {
    missing: Number(nextActionHealth?.missing ?? 0),
    overdue: Number(nextActionHealth?.overdue ?? 0),
    rule: "Companies with an open opportunity (not Lost, Live or Later). Missing means no next action or no due date.",
  };

  const actions = [
    ...overdueFollowUps.map((t) => ({
      priority: 1,
      kind: "overdue_task" as const,
      title: t.title,
      companyId: t.companyId,
      companyName: t.companyName,
      taskId: t.id as number | null,
      activityId: null as number | null,
      pilotId: null as number | null,
      at: t.dueAt,
      ageMinutes: t.overdueMinutes,
    })),
    ...todaysAppointments.map((a) => ({
      priority: 2,
      kind: "appointment" as const,
      title: `${a.kind === "pilot_review" ? "Pilot review" : a.kind === "demo" ? "Demo" : a.kind === "meeting" ? "Meeting" : a.kind} — ${a.companyName}`,
      companyId: a.companyId,
      companyName: a.companyName,
      taskId: null as number | null,
      activityId: a.activityId,
      pilotId: a.pilotId,
      at: a.at as Date | null,
      ageMinutes: null as number | null,
    })),
    ...unassignedInbound.map((l) => ({
      priority: 3,
      kind: "inbound_lead" as const,
      title: `Respond to new enquiry — ${l.name}`,
      companyId: l.id as number | null,
      companyName: l.name as string | null,
      taskId: null as number | null,
      activityId: null as number | null,
      pilotId: null as number | null,
      at: l.enquiredAt as Date | null,
      ageMinutes: l.ageMinutes as number | null,
    })),
  ];

  return {
    date,
    timezone: tz,
    scope,
    ownerId,
    demo,
    sprint: config.sprint,
    newPaying,
    revenue,
    activity,
    activePilots,
    overdueFollowUps,
    todaysAppointments,
    unassignedInbound,
    upcomingRenewals,
    nextActions,
    actions,
  };
}
