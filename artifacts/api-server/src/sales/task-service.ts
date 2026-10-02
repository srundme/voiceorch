import { and, asc, eq, gte, isNull, lt, sql, type SQL } from "drizzle-orm";
import { salesCompaniesTable, salesOpportunitiesTable, salesTasksTable, type SalesTask } from "@workspace/db/schema";
import { getActiveUser } from "./auth-service.js";
import { forbidden, isFounder, notFound, SalesError, type SalesActor, type SalesDb } from "./db.js";
import type { CreateTaskInput, ListTasksQuery, UpdateTaskInput } from "./schemas.js";
import { localDateString, periodBounds } from "./time.js";

export function canEditTask(actor: SalesActor, task: Pick<SalesTask, "ownerId">): boolean {
  return isFounder(actor) || task.ownerId === actor.id;
}

export async function assertAssignableOwner(db: SalesDb, ownerId: number | null): Promise<void> {
  if (ownerId == null) return;
  if (!(await getActiveUser(db, ownerId))) throw new SalesError(400, "Owner must be an active sales user");
}

export interface AutoTaskInput {
  dedupeKey: string;
  title: string;
  kind: string;
  dueAt: Date | null;
  ownerId: number | null;
  companyId: number | null;
  opportunityId?: number | null;
  pilotId?: number | null;
  subscriptionId?: number | null;
  isDemo: boolean;
  createdBy: number | null;
}

/**
 * `reopenIfChanged` lets a closed task come back when its title or due time changes
 * (a new next action after the previous one was completed). Otherwise closed tasks stay closed.
 */
export async function upsertAutoTask(db: SalesDb, input: AutoTaskInput & { reopenIfChanged?: boolean }): Promise<void> {
  const { reopenIfChanged, ...values } = input;
  const now = new Date();
  const changed = sql`(${salesTasksTable.title} IS DISTINCT FROM ${values.title} OR ${salesTasksTable.dueAt} IS DISTINCT FROM ${values.dueAt?.toISOString() ?? null}::timestamptz)`;
  await db
    .insert(salesTasksTable)
    .values({ ...values, status: "open" })
    .onConflictDoUpdate({
      target: salesTasksTable.dedupeKey,
      set: reopenIfChanged
        ? {
            title: values.title,
            dueAt: values.dueAt,
            ownerId: values.ownerId,
            status: "open",
            outcome: sql`CASE WHEN ${salesTasksTable.status} = 'open' THEN ${salesTasksTable.outcome} ELSE NULL END`,
            completedAt: sql`CASE WHEN ${salesTasksTable.status} = 'open' THEN ${salesTasksTable.completedAt} ELSE NULL END`,
            completedBy: sql`CASE WHEN ${salesTasksTable.status} = 'open' THEN ${salesTasksTable.completedBy} ELSE NULL END`,
            updatedAt: now,
          }
        : { title: values.title, dueAt: values.dueAt, ownerId: values.ownerId, updatedAt: now },
      setWhere: reopenIfChanged ? sql`(${salesTasksTable.status} = 'open' OR ${changed})` : sql`${salesTasksTable.status} = 'open'`,
    });
}

const NEXT_ACTION_KEY = /^(company|activity):\d+:next_action$/;

/** Keeps the company's "next action" in step with the task that tracks it. */
async function syncCompanyNextAction(
  db: SalesDb,
  task: SalesTask,
  change: { closed: true } | { title?: string; dueAt?: Date | null },
): Promise<void> {
  if (task.companyId == null || !task.dedupeKey || !NEXT_ACTION_KEY.test(task.dedupeKey)) return;
  const patch: Partial<typeof salesCompaniesTable.$inferInsert> =
    "closed" in change
      ? { nextAction: null, nextActionDueAt: null }
      : {
          ...(change.title !== undefined ? { nextAction: change.title } : {}),
          ...(change.dueAt !== undefined ? { nextActionDueAt: change.dueAt } : {}),
        };
  if (!Object.keys(patch).length) return;
  await db
    .update(salesCompaniesTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(salesCompaniesTable.id, task.companyId), eq(salesCompaniesTable.nextAction, task.title)));
}

export async function closeAutoTask(db: SalesDb, dedupeKey: string, status: "done" | "cancelled", actorId: number | null, outcome?: string | null) {
  const now = new Date();
  await db
    .update(salesTasksTable)
    .set({ status, outcome: outcome ?? null, completedAt: now, completedBy: actorId, updatedAt: now })
    .where(and(eq(salesTasksTable.dedupeKey, dedupeKey), eq(salesTasksTable.status, "open")));
}

export async function closeFirstResponseTasks(db: SalesDb, companyId: number, actorId: number | null, outcome: string) {
  const now = new Date();
  await db
    .update(salesTasksTable)
    .set({ status: "done", outcome, completedAt: now, completedBy: actorId, updatedAt: now })
    .where(and(eq(salesTasksTable.companyId, companyId), eq(salesTasksTable.kind, "first_response"), eq(salesTasksTable.status, "open")));
}

export async function insertAutoTaskOnce(db: SalesDb, input: AutoTaskInput): Promise<boolean> {
  const rows = await db
    .insert(salesTasksTable)
    .values({ ...input, status: "open" })
    .onConflictDoNothing({ target: salesTasksTable.dedupeKey })
    .returning({ id: salesTasksTable.id });
  return rows.length > 0;
}

const taskColumns = {
  task: salesTasksTable,
  companyName: salesCompaniesTable.name,
};

export async function listTasks(db: SalesDb, actor: SalesActor, q: ListTasksQuery, tz: string, now = new Date()) {
  const scope = q.scope ?? (isFounder(actor) ? "team" : "mine");
  const conds: SQL[] = [eq(salesTasksTable.isDemo, q.demo)];
  if (scope === "mine") conds.push(eq(salesTasksTable.ownerId, actor.id));
  if (q.ownerId) conds.push(eq(salesTasksTable.ownerId, q.ownerId));
  if (q.unassigned) conds.push(isNull(salesTasksTable.ownerId));
  if (q.status !== "all") conds.push(eq(salesTasksTable.status, q.status));
  if (q.overdue) conds.push(eq(salesTasksTable.status, "open"), lt(salesTasksTable.dueAt, now));
  if (q.dueToday) {
    const day = periodBounds("day", q.date ?? localDateString(now, tz), { tz });
    conds.push(gte(salesTasksTable.dueAt, day.start), lt(salesTasksTable.dueAt, day.end));
  }
  if (q.companyId) conds.push(eq(salesTasksTable.companyId, q.companyId));

  const rows = await db
    .select(taskColumns)
    .from(salesTasksTable)
    .leftJoin(salesCompaniesTable, eq(salesCompaniesTable.id, salesTasksTable.companyId))
    .where(and(...conds))
    .orderBy(sql`${salesTasksTable.dueAt} ASC NULLS LAST`, asc(salesTasksTable.id))
    .limit(q.limit);
  return { scope, items: rows.map((r) => ({ ...r.task, companyName: r.companyName, overdue: isOverdue(r.task, now) })) };
}

export function isOverdue(task: Pick<SalesTask, "status" | "dueAt">, now: Date): boolean {
  return task.status === "open" && task.dueAt != null && task.dueAt.getTime() < now.getTime();
}

async function loadTask(db: SalesDb, id: number): Promise<SalesTask> {
  const [task] = await db.select().from(salesTasksTable).where(eq(salesTasksTable.id, id));
  if (!task) throw notFound("Task");
  return task;
}

export async function createTask(db: SalesDb, actor: SalesActor, input: CreateTaskInput) {
  const ownerId = input.ownerId === undefined ? actor.id : input.ownerId;
  if (!isFounder(actor) && ownerId !== actor.id && ownerId !== null) {
    throw forbidden("Teammates can only create tasks for themselves");
  }
  await assertAssignableOwner(db, ownerId);

  let isDemo = false;
  if (input.companyId) {
    const [company] = await db.select({ isDemo: salesCompaniesTable.isDemo }).from(salesCompaniesTable).where(eq(salesCompaniesTable.id, input.companyId));
    if (!company) throw notFound("Company");
    isDemo = company.isDemo;
  }
  if (input.opportunityId) {
    const [opp] = await db.select({ companyId: salesOpportunitiesTable.companyId }).from(salesOpportunitiesTable).where(eq(salesOpportunitiesTable.id, input.opportunityId));
    if (!opp || (input.companyId && opp.companyId !== input.companyId)) throw new SalesError(400, "Opportunity does not belong to this company");
  }
  const [task] = await db
    .insert(salesTasksTable)
    .values({
      title: input.title,
      kind: input.kind,
      dueAt: input.dueAt ?? null,
      companyId: input.companyId ?? null,
      opportunityId: input.opportunityId ?? null,
      ownerId,
      isDemo,
      createdBy: actor.id,
    })
    .returning();
  return task!;
}

export async function updateTask(db: SalesDb, actor: SalesActor, id: number, input: UpdateTaskInput) {
  const task = await loadTask(db, id);
  if (!canEditTask(actor, task)) throw forbidden("You can only change your own tasks");
  if (task.status !== "open") throw new SalesError(400, "Only open tasks can be changed");
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(salesTasksTable)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(salesTasksTable.id, id))
      .returning();
    await syncCompanyNextAction(tx, task, { title: input.title, dueAt: input.dueAt });
    return updated!;
  });
}

export async function assignTask(db: SalesDb, actor: SalesActor, id: number, ownerId: number | null) {
  const task = await loadTask(db, id);
  if (!isFounder(actor)) {
    const ownsTask = task.ownerId === actor.id;
    const claimsUnowned = task.ownerId == null && ownerId === actor.id;
    if (!ownsTask && !claimsUnowned) throw forbidden("You can only reassign your own tasks or claim unassigned ones");
  }
  if (task.status !== "open") throw new SalesError(400, "Only open tasks can be reassigned");
  await assertAssignableOwner(db, ownerId);
  const [updated] = await db
    .update(salesTasksTable)
    .set({ ownerId, updatedAt: new Date() })
    .where(eq(salesTasksTable.id, id))
    .returning();
  return updated!;
}

export async function finishTask(db: SalesDb, actor: SalesActor, id: number, status: "done" | "cancelled", outcome?: string | null) {
  const task = await loadTask(db, id);
  if (!canEditTask(actor, task)) throw forbidden("You can only change your own tasks");
  if (task.status !== "open") throw new SalesError(400, "Task is already closed");
  const now = new Date();
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(salesTasksTable)
      .set({ status, outcome: outcome ?? null, completedAt: now, completedBy: actor.id, updatedAt: now })
      .where(eq(salesTasksTable.id, id))
      .returning();
    await syncCompanyNextAction(tx, task, { closed: true });
    return updated!;
  });
}
