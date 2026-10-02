import { and, eq, gte, inArray, lt, lte, ne, notLike, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import {
  salesActivitiesTable,
  salesCompaniesTable,
  salesPilotsTable,
  salesSubscriptionsTable,
  salesTargetsTable,
  salesTasksTable,
} from "@workspace/db/schema";
import { SalesError, type SalesActor, type SalesDb } from "./db.js";
import type { CalendarQuery } from "./schemas.js";
import { periodFromDates, startOfLocalDay } from "./time.js";

export interface CalendarEvent {
  type: string;
  key: string;
  title: string;
  start: Date;
  allDay: boolean;
  date: string | null;
  status: string | null;
  ownerId: number | null;
  companyId: number | null;
  companyName: string | null;
  activityId?: number;
  pilotId?: number;
  taskId?: number;
  subscriptionId?: number;
  details?: Record<string, unknown>;
}

const MAX_RANGE_DAYS = 120;

export async function getCalendar(db: SalesDb, actor: SalesActor, q: CalendarQuery, tz: string) {
  const days = (Date.parse(`${q.to}T00:00:00Z`) - Date.parse(`${q.from}T00:00:00Z`)) / 86_400_000;
  if (days < 0 || days > MAX_RANGE_DAYS) {
    throw new SalesError(400, `Calendar range must be 0–${MAX_RANGE_DAYS} days with from <= to`);
  }
  const period = periodFromDates(q.from, q.to, tz);
  const ownerId = q.scope === "mine" ? actor.id : q.ownerId ?? null;
  const owned = (col: PgColumn): SQL[] => (ownerId ? [eq(col, ownerId)] : []);
  const want = new Set(q.types);
  const events: CalendarEvent[] = [];

  if (want.has("activity")) {
    const when = sql<Date>`coalesce(${salesActivitiesTable.scheduledAt}, ${salesActivitiesTable.occurredAt})`;
    const rows = await db
      .select({ a: salesActivitiesTable, companyName: salesCompaniesTable.name })
      .from(salesActivitiesTable)
      .innerJoin(salesCompaniesTable, eq(salesCompaniesTable.id, salesActivitiesTable.companyId))
      .where(and(
        eq(salesActivitiesTable.isDemo, q.demo),
        ne(salesActivitiesTable.status, "cancelled"),
        sql`${when} >= ${period.start.toISOString()}`,
        sql`${when} < ${period.end.toISOString()}`,
        ...owned(salesActivitiesTable.ownerId),
      ));
    for (const { a, companyName } of rows) {
      events.push({
        type: "activity",
        key: `activity:${a.id}`,
        title: `${a.type[0]!.toUpperCase()}${a.type.slice(1)} — ${companyName}`,
        start: (a.scheduledAt ?? a.occurredAt)!,
        allDay: false,
        date: null,
        status: a.status,
        ownerId: a.ownerId,
        companyId: a.companyId,
        companyName,
        activityId: a.id,
        details: { activityType: a.type, outcome: a.outcome },
      });
    }
  }

  for (const [type, column] of [["pilot_review", salesPilotsTable.reviewAt], ["extension_review", salesPilotsTable.extensionReviewAt]] as const) {
    if (!want.has(type)) continue;
    const rows = await db
      .select({ p: salesPilotsTable, companyName: salesCompaniesTable.name })
      .from(salesPilotsTable)
      .innerJoin(salesCompaniesTable, eq(salesCompaniesTable.id, salesPilotsTable.companyId))
      .where(and(
        eq(salesPilotsTable.isDemo, q.demo),
        ne(salesPilotsTable.status, "Cancelled"),
        gte(column, period.start),
        lt(column, period.end),
        ...owned(salesPilotsTable.ownerId),
      ));
    for (const { p, companyName } of rows) {
      events.push({
        type,
        key: `${type}:${p.id}`,
        title: `${type === "pilot_review" ? "Pilot review" : "Extension review"} — ${companyName}`,
        start: (type === "pilot_review" ? p.reviewAt : p.extensionReviewAt)!,
        allDay: false,
        date: null,
        status: p.status,
        ownerId: p.ownerId,
        companyId: p.companyId,
        companyName,
        pilotId: p.id,
      });
    }
  }

  if (want.has("task")) {
    const rows = await db
      .select({ t: salesTasksTable, companyName: salesCompaniesTable.name })
      .from(salesTasksTable)
      .leftJoin(salesCompaniesTable, eq(salesCompaniesTable.id, salesTasksTable.companyId))
      .where(and(
        eq(salesTasksTable.isDemo, q.demo),
        eq(salesTasksTable.status, "open"),
        gte(salesTasksTable.dueAt, period.start),
        lt(salesTasksTable.dueAt, period.end),
        sql`(${salesTasksTable.dedupeKey} IS NULL OR (${notLike(salesTasksTable.dedupeKey, "activity:%:appointment")} AND ${notLike(salesTasksTable.dedupeKey, "pilot:%")} AND ${notLike(salesTasksTable.dedupeKey, "sub:%:renewal:%")}))`,
        ...owned(salesTasksTable.ownerId),
      ));
    for (const { t, companyName } of rows) {
      events.push({
        type: "task",
        key: `task:${t.id}`,
        title: t.title,
        start: t.dueAt!,
        allDay: false,
        date: null,
        status: t.status,
        ownerId: t.ownerId,
        companyId: t.companyId,
        companyName,
        taskId: t.id,
        details: { kind: t.kind },
      });
    }
  }

  if (want.has("renewal")) {
    const rows = await db
      .select({ s: salesSubscriptionsTable, companyName: salesCompaniesTable.name })
      .from(salesSubscriptionsTable)
      .innerJoin(salesCompaniesTable, eq(salesCompaniesTable.id, salesSubscriptionsTable.companyId))
      .where(and(
        eq(salesSubscriptionsTable.isDemo, q.demo),
        inArray(salesSubscriptionsTable.status, ["active", "paused"]),
        gte(salesSubscriptionsTable.renewalDate, q.from),
        lte(salesSubscriptionsTable.renewalDate, q.to),
        ...owned(salesSubscriptionsTable.customerOwnerId),
      ));
    for (const { s, companyName } of rows) {
      events.push({
        type: "renewal",
        key: `renewal:${s.id}:${s.renewalDate}`,
        title: `Renewal — ${companyName}`,
        start: startOfLocalDay(s.renewalDate!, tz),
        allDay: true,
        date: s.renewalDate,
        status: s.status,
        ownerId: s.customerOwnerId,
        companyId: s.companyId,
        companyName,
        subscriptionId: s.id,
        details: { monthlyFeePaise: s.monthlyFeePaise },
      });
    }
  }

  if (want.has("target")) {
    const rows = await db
      .select()
      .from(salesTargetsTable)
      .where(and(eq(salesTargetsTable.kind, "daily"), gte(salesTargetsTable.date, q.from), lte(salesTargetsTable.date, q.to)));
    for (const t of rows) {
      events.push({
        type: "target",
        key: `target:${t.date}`,
        title: t.dayType === "review" ? "Review day" : `Targets: ${t.visits} visits, ${t.conversations} conversations, ${t.demos} demos, ${t.pilots} pilots`,
        start: startOfLocalDay(t.date, tz),
        allDay: true,
        date: t.date,
        status: t.dayType,
        ownerId: null,
        companyId: null,
        companyName: null,
        details: { dayType: t.dayType, visits: t.visits, conversations: t.conversations, demos: t.demos, pilots: t.pilots, note: t.note },
      });
    }
  }

  events.sort((a, b) => a.start.getTime() - b.start.getTime() || a.key.localeCompare(b.key));
  return { from: q.from, to: q.to, timezone: tz, scope: q.scope, ownerId, demo: q.demo, types: q.types, events };
}
