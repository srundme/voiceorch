import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import {
  salesActivitiesTable,
  salesCompaniesTable,
  salesContactsTable,
  salesOpportunitiesTable,
  type SalesActivity,
  type SalesCompany,
} from "@workspace/db/schema";
import { canEditCompany, loadCompany, OUTBOUND_RESPONSE_TYPES } from "./company-service.js";
import { forbidden, isFounder, notFound, SalesError, type SalesActor, type SalesDb } from "./db.js";
import type { CreateActivityInput, ListActivitiesQuery, UpdateActivityInput } from "./schemas.js";
import { closeAutoTask, closeFirstResponseTasks, upsertAutoTask } from "./task-service.js";
import { periodFromDates } from "./time.js";

const FUTURE_SKEW_MS = 5 * 60 * 1000;

export function canEditActivity(actor: SalesActor, activity: Pick<SalesActivity, "ownerId">): boolean {
  return isFounder(actor) || activity.ownerId === actor.id;
}

const appointmentKey = (id: number) => `activity:${id}:appointment`;
const nextActionKey = (id: number) => `activity:${id}:next_action`;

async function loadActivity(db: SalesDb, id: number): Promise<SalesActivity> {
  const [activity] = await db.select().from(salesActivitiesTable).where(eq(salesActivitiesTable.id, id));
  if (!activity) throw notFound("Activity");
  return activity;
}

async function assertContact(db: SalesDb, contactId: number | null | undefined, companyId: number): Promise<void> {
  if (contactId == null) return;
  const [hit] = await db
    .select({ id: salesContactsTable.id })
    .from(salesContactsTable)
    .where(and(eq(salesContactsTable.id, contactId), eq(salesContactsTable.companyId, companyId)));
  if (!hit) throw new SalesError(400, "Contact must belong to this company");
}

async function resolveOpportunityId(db: SalesDb, companyId: number, requested: number | null | undefined): Promise<number | null> {
  if (requested != null) {
    const [opp] = await db
      .select({ id: salesOpportunitiesTable.id })
      .from(salesOpportunitiesTable)
      .where(and(eq(salesOpportunitiesTable.id, requested), eq(salesOpportunitiesTable.companyId, companyId)));
    if (!opp) throw new SalesError(400, "Opportunity does not belong to this company");
    return opp.id;
  }
  const [open] = await db
    .select({ id: salesOpportunitiesTable.id })
    .from(salesOpportunitiesTable)
    .where(and(eq(salesOpportunitiesTable.companyId, companyId), sql`${salesOpportunitiesTable.stage} NOT IN ('Lost', 'Live')`))
    .limit(1);
  return open?.id ?? null;
}

export async function recomputeCompanyActivityFlags(db: SalesDb, companyId: number): Promise<void> {
  const [first] = await db
    .select({ id: salesActivitiesTable.id })
    .from(salesActivitiesTable)
    .where(and(eq(salesActivitiesTable.companyId, companyId), eq(salesActivitiesTable.status, "completed"), eq(salesActivitiesTable.flagVisit, true)))
    .orderBy(asc(salesActivitiesTable.occurredAt), asc(salesActivitiesTable.id))
    .limit(1);
  await db
    .update(salesActivitiesTable)
    .set({ flagFirstVisit: first ? sql`${salesActivitiesTable.id} = ${first.id}` : false })
    .where(eq(salesActivitiesTable.companyId, companyId));
  await db
    .update(salesCompaniesTable)
    .set({
      lastActivityAt: sql`(
        SELECT max(a.occurred_at) FROM ${salesActivitiesTable} a
        WHERE a.company_id = ${companyId} AND a.status = 'completed'
      )`,
    })
    .where(eq(salesCompaniesTable.id, companyId));
}

function appointmentTitle(activity: SalesActivity, company: SalesCompany): string {
  const label = activity.type === "demo" ? "Demo" : activity.type === "meeting" ? "Meeting" : `Scheduled ${activity.type}`;
  return `${label} with ${company.name}`;
}

async function syncTasks(db: SalesDb, actor: SalesActor, activity: SalesActivity, company: SalesCompany): Promise<void> {
  if (activity.status === "scheduled" && activity.scheduledAt) {
    await upsertAutoTask(db, {
      dedupeKey: appointmentKey(activity.id),
      title: appointmentTitle(activity, company),
      kind: activity.type === "demo" ? "demo" : "follow_up",
      dueAt: activity.scheduledAt,
      ownerId: activity.ownerId,
      companyId: company.id,
      opportunityId: activity.opportunityId,
      isDemo: company.isDemo,
      createdBy: actor.id,
    });
  } else if (activity.status === "completed") {
    await closeAutoTask(db, appointmentKey(activity.id), "done", actor.id, activity.outcome);
    if ((OUTBOUND_RESPONSE_TYPES as readonly string[]).includes(activity.type)) {
      await closeFirstResponseTasks(db, company.id, actor.id, `Responded by ${activity.type}`);
    }
  } else {
    await closeAutoTask(db, appointmentKey(activity.id), "cancelled", actor.id, activity.status);
  }

  if (activity.nextAction) {
    await upsertAutoTask(db, {
      dedupeKey: nextActionKey(activity.id),
      title: activity.nextAction,
      kind: "follow_up",
      dueAt: activity.nextActionDueAt,
      ownerId: activity.ownerId,
      companyId: company.id,
      opportunityId: activity.opportunityId,
      isDemo: company.isDemo,
      createdBy: actor.id,
      reopenIfChanged: true,
    });
  }
}

async function applyCompanyNextAction(db: SalesDb, actor: SalesActor, company: SalesCompany, activity: SalesActivity): Promise<void> {
  if (!activity.nextAction || !canEditCompany(actor, company)) return;
  await db
    .update(salesCompaniesTable)
    .set({ nextAction: activity.nextAction, nextActionDueAt: activity.nextActionDueAt, updatedAt: new Date() })
    .where(eq(salesCompaniesTable.id, company.id));
}

function checkTiming(status: string, occurredAt: Date | null, scheduledAt: Date | null, now: Date): void {
  if (status === "scheduled" && !scheduledAt) throw new SalesError(400, "Scheduled activities need scheduledAt");
  if (status === "completed" && occurredAt && occurredAt.getTime() > now.getTime() + FUTURE_SKEW_MS) {
    throw new SalesError(400, "A completed activity cannot be in the future");
  }
}

export async function createActivity(db: SalesDb, actor: SalesActor, input: CreateActivityInput, now = new Date()) {
  const company = await loadCompany(db, input.companyId);
  await assertContact(db, input.contactId, company.id);
  const opportunityId = await resolveOpportunityId(db, company.id, input.opportunityId);
  const occurredAt = input.status === "completed" ? input.occurredAt ?? now : null;
  const scheduledAt = input.scheduledAt ?? null;
  checkTiming(input.status, occurredAt, scheduledAt, now);
  const flags = input.flags ?? {};

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(salesActivitiesTable)
      .values({
        companyId: company.id,
        opportunityId,
        contactId: input.contactId ?? null,
        ownerId: actor.id,
        type: input.type,
        status: input.status,
        occurredAt,
        scheduledAt,
        flagVisit: flags.visit ?? input.type === "visit",
        flagBuyerConversation: flags.buyerConversation ?? false,
        flagDemo: flags.demo ?? input.type === "demo",
        flagPilotStarted: flags.pilotStarted ?? false,
        outcome: input.outcome ?? null,
        notes: input.notes ?? null,
        nextAction: input.nextAction?.trim() || null,
        nextActionDueAt: input.nextActionDueAt ?? null,
        isDemo: company.isDemo,
        createdBy: actor.id,
      })
      .returning();
    await recomputeCompanyActivityFlags(tx, company.id);
    await syncTasks(tx, actor, created!, company);
    await applyCompanyNextAction(tx, actor, company, created!);
    return loadActivity(tx, created!.id);
  });
}

export interface OpportunityDemoInput {
  company: SalesCompany;
  opportunityId: number;
  ownerId: number | null;
  contactId: number | null;
  at: Date;
  previousAt?: Date | null;
}

/**
 * Keeps one scheduled demo activity (and its appointment task) behind an opportunity's
 * "Demo booked" evidence, so the demo shows in Today and the calendar. Reuses a matching
 * demo activity, moves the one at `previousAt` when the time changes, otherwise inserts one.
 */
export async function syncOpportunityDemo(db: SalesDb, actor: SalesActor, input: OpportunityDemoInput): Promise<SalesActivity> {
  const { company, opportunityId, contactId, at } = input;
  const linkable = and(
    eq(salesActivitiesTable.companyId, company.id),
    eq(salesActivitiesTable.type, "demo"),
    sql`(${salesActivitiesTable.opportunityId} = ${opportunityId} OR ${salesActivitiesTable.opportunityId} IS NULL)`,
  );
  const [existing] = await db
    .select()
    .from(salesActivitiesTable)
    .where(and(linkable, sql`${salesActivitiesTable.status} IN ('scheduled', 'completed')`, eq(salesActivitiesTable.scheduledAt, at)))
    .orderBy(desc(salesActivitiesTable.id))
    .limit(1);

  let activity: SalesActivity | undefined;
  if (existing) {
    const patch: Partial<typeof salesActivitiesTable.$inferInsert> = {};
    if (existing.opportunityId == null) patch.opportunityId = opportunityId;
    if (existing.contactId == null && contactId != null) patch.contactId = contactId;
    activity = Object.keys(patch).length
      ? (await db.update(salesActivitiesTable).set({ ...patch, updatedAt: new Date() }).where(eq(salesActivitiesTable.id, existing.id)).returning())[0]
      : existing;
  } else if (input.previousAt) {
    const [moved] = await db
      .update(salesActivitiesTable)
      .set({ scheduledAt: at, opportunityId, ...(contactId != null ? { contactId } : {}), updatedAt: new Date() })
      .where(and(linkable, eq(salesActivitiesTable.status, "scheduled"), eq(salesActivitiesTable.scheduledAt, input.previousAt)))
      .returning();
    activity = moved;
  }
  if (!activity) {
    [activity] = await db
      .insert(salesActivitiesTable)
      .values({
        companyId: company.id,
        opportunityId,
        contactId,
        ownerId: input.ownerId ?? actor.id,
        type: "demo",
        status: "scheduled",
        scheduledAt: at,
        flagDemo: true,
        isDemo: company.isDemo,
        createdBy: actor.id,
      })
      .returning();
  }
  if (activity!.status === "scheduled") await syncTasks(db, actor, activity!, company);
  return activity!;
}

export async function updateActivity(db: SalesDb, actor: SalesActor, id: number, input: UpdateActivityInput, now = new Date()) {
  const activity = await loadActivity(db, id);
  if (!canEditActivity(actor, activity)) throw forbidden("You can only edit your own activities");
  if (activity.status === "cancelled") throw new SalesError(400, "Cancelled activities cannot be edited");
  const company = await loadCompany(db, activity.companyId);
  if (input.contactId !== undefined) await assertContact(db, input.contactId, company.id);

  const status = input.status ?? activity.status;
  let occurredAt = input.occurredAt !== undefined ? input.occurredAt : activity.occurredAt;
  if (status === "completed" && !occurredAt) occurredAt = now;
  if (status === "scheduled") occurredAt = null;
  const scheduledAt = input.scheduledAt !== undefined ? input.scheduledAt : activity.scheduledAt;
  checkTiming(status, occurredAt, scheduledAt, now);

  const patch: Partial<typeof salesActivitiesTable.$inferInsert> = { status, occurredAt, scheduledAt, updatedAt: now };
  if (input.contactId !== undefined) patch.contactId = input.contactId;
  if (input.type !== undefined) patch.type = input.type;
  if (input.outcome !== undefined) patch.outcome = input.outcome ?? null;
  if (input.notes !== undefined) patch.notes = input.notes ?? null;
  if (input.nextAction !== undefined) patch.nextAction = input.nextAction?.trim() || null;
  if (input.nextActionDueAt !== undefined) patch.nextActionDueAt = input.nextActionDueAt;
  if (input.flags) {
    if (input.flags.visit !== undefined) patch.flagVisit = input.flags.visit;
    if (input.flags.buyerConversation !== undefined) patch.flagBuyerConversation = input.flags.buyerConversation;
    if (input.flags.demo !== undefined) patch.flagDemo = input.flags.demo;
    if (input.flags.pilotStarted !== undefined) patch.flagPilotStarted = input.flags.pilotStarted;
  }

  return db.transaction(async (tx) => {
    const [updated] = await tx.update(salesActivitiesTable).set(patch).where(eq(salesActivitiesTable.id, id)).returning();
    await recomputeCompanyActivityFlags(tx, company.id);
    await syncTasks(tx, actor, updated!, company);
    if (input.nextAction !== undefined || input.nextActionDueAt !== undefined) {
      await applyCompanyNextAction(tx, actor, company, updated!);
    }
    return loadActivity(tx, id);
  });
}

export async function cancelActivity(db: SalesDb, actor: SalesActor, id: number, reason?: string | null) {
  const activity = await loadActivity(db, id);
  if (!canEditActivity(actor, activity)) throw forbidden("You can only cancel your own activities");
  if (activity.status === "cancelled") throw new SalesError(400, "Activity is already cancelled");
  return db.transaction(async (tx) => {
    const now = new Date();
    await tx
      .update(salesActivitiesTable)
      .set({ status: "cancelled", outcome: reason ?? activity.outcome, updatedAt: now })
      .where(eq(salesActivitiesTable.id, id));
    await closeAutoTask(tx, appointmentKey(id), "cancelled", actor.id, reason ?? "cancelled");
    await recomputeCompanyActivityFlags(tx, activity.companyId);
    return loadActivity(tx, id);
  });
}

export async function listActivities(db: SalesDb, actor: SalesActor, q: ListActivitiesQuery, tz: string) {
  const when = sql`coalesce(${salesActivitiesTable.scheduledAt}, ${salesActivitiesTable.occurredAt})`;
  const conds: SQL[] = [eq(salesActivitiesTable.isDemo, q.demo)];
  if (q.companyId) conds.push(eq(salesActivitiesTable.companyId, q.companyId));
  if (q.scope === "mine") conds.push(eq(salesActivitiesTable.ownerId, actor.id));
  if (q.ownerId) conds.push(eq(salesActivitiesTable.ownerId, q.ownerId));
  if (q.type) conds.push(eq(salesActivitiesTable.type, q.type));
  if (q.status) conds.push(eq(salesActivitiesTable.status, q.status));
  if (q.from || q.to) {
    const period = periodFromDates(q.from ?? q.to!, q.to ?? q.from!, tz);
    conds.push(sql`${when} >= ${period.start.toISOString()}`, sql`${when} < ${period.end.toISOString()}`);
  }
  const rows = await db
    .select({ activity: salesActivitiesTable, companyName: salesCompaniesTable.name })
    .from(salesActivitiesTable)
    .innerJoin(salesCompaniesTable, eq(salesCompaniesTable.id, salesActivitiesTable.companyId))
    .where(and(...conds))
    .orderBy(q.from || q.to ? asc(when) : desc(when))
    .limit(q.limit);
  return rows.map((r) => ({ ...r.activity, companyName: r.companyName }));
}
