import { and, desc, eq, sql } from "drizzle-orm";
import { salesOpportunitiesTable, salesSubscriptionsTable, salesTasksTable, type SalesSubscription } from "@workspace/db/schema";
import { canEditCompany, loadCompany } from "./company-service.js";
import { forbidden, notFound, SalesError, writeAudit, type SalesActor, type SalesDb } from "./db.js";
import { changeStage, onboardingChecksComplete } from "./opportunity-service.js";
import { acceptedProposal, currentSubscription, markSubscriptionLive } from "./revenue-core.js";
import type { CreateSubscriptionInput, UpdateSubscriptionInput } from "./schemas.js";
import type { SalesConfig } from "./settings-schema.js";
import { assertAssignableOwner } from "./task-service.js";
import { addMonths } from "./time.js";

async function loadSubscription(db: SalesDb, id: number): Promise<SalesSubscription> {
  const [sub] = await db.select().from(salesSubscriptionsTable).where(eq(salesSubscriptionsTable.id, id));
  if (!sub) throw notFound("Subscription");
  return sub;
}

async function loadEditable(db: SalesDb, actor: SalesActor, id: number) {
  const sub = await loadSubscription(db, id);
  const company = await loadCompany(db, sub.companyId);
  if (!canEditCompany(actor, company) && sub.customerOwnerId !== actor.id) {
    throw forbidden("You can only change subscriptions for companies you own");
  }
  return { sub, company };
}

async function subscriptionTasks(db: SalesDb, id: number) {
  return db.select().from(salesTasksTable).where(eq(salesTasksTable.subscriptionId, id)).orderBy(sql`${salesTasksTable.dueAt} ASC NULLS LAST`);
}

export async function getSubscription(db: SalesDb, id: number) {
  const sub = await loadSubscription(db, id);
  return { subscription: sub, tasks: await subscriptionTasks(db, id) };
}

export async function listSubscriptions(db: SalesDb, q: { companyId?: number; demo: boolean }) {
  const conds = [eq(salesSubscriptionsTable.isDemo, q.demo)];
  if (q.companyId) conds.push(eq(salesSubscriptionsTable.companyId, q.companyId));
  return db.select().from(salesSubscriptionsTable).where(and(...conds)).orderBy(desc(salesSubscriptionsTable.id)).limit(500);
}

export async function createSubscription(db: SalesDb, actor: SalesActor, input: CreateSubscriptionInput, config: SalesConfig) {
  const company = await loadCompany(db, input.companyId);
  if (!canEditCompany(actor, company)) throw forbidden("You can only create subscriptions for companies you own");
  if (await currentSubscription(db, company.id)) throw new SalesError(409, "This company already has an open subscription");
  if (input.customerOwnerId != null) await assertAssignableOwner(db, input.customerOwnerId);
  const proposal = input.proposalId ? null : await acceptedProposal(db, company.id);
  const startDate = input.startDate ?? null;
  const [created] = await db
    .insert(salesSubscriptionsTable)
    .values({
      companyId: company.id,
      proposalId: input.proposalId ?? proposal?.id ?? null,
      monthlyFeePaise: input.monthlyFeePaise ?? proposal?.monthlyFeePaise ?? config.offer.monthlyFeePaise,
      includedMinutes: input.includedMinutes ?? proposal?.includedMinutes ?? config.offer.includedMinutes,
      customerOwnerId: input.customerOwnerId ?? company.ownerId,
      startDate,
      renewalDate: startDate ? addMonths(startDate, 1) : null,
      onboardingChecks: input.onboardingChecks ?? null,
      status: "active",
      isDemo: company.isDemo,
    })
    .returning();
  await writeAudit(db, { actorUserId: actor.id, entity: "sales_subscription", entityId: created!.id, action: "created", after: created });
  return created!;
}

export async function updateSubscription(db: SalesDb, actor: SalesActor, id: number, input: UpdateSubscriptionInput) {
  const { sub } = await loadEditable(db, actor, id);
  if (sub.status === "cancelled") throw new SalesError(400, "Cancelled subscriptions cannot be edited");
  if (input.customerOwnerId != null) await assertAssignableOwner(db, input.customerOwnerId);
  const patch: Partial<typeof salesSubscriptionsTable.$inferInsert> = { updatedAt: new Date() };
  if (input.customerOwnerId !== undefined) patch.customerOwnerId = input.customerOwnerId;
  if (input.onboardingChecks !== undefined) patch.onboardingChecks = { ...(sub.onboardingChecks as Record<string, boolean> | null), ...input.onboardingChecks };
  if (input.startDate !== undefined) {
    if (sub.liveAt) throw new SalesError(400, "The start date of a live subscription cannot change");
    patch.startDate = input.startDate;
    patch.renewalDate = input.startDate ? addMonths(input.startDate, 1) : null;
  }
  const [updated] = await db.update(salesSubscriptionsTable).set(patch).where(eq(salesSubscriptionsTable.id, id)).returning();
  await writeAudit(db, { actorUserId: actor.id, entity: "sales_subscription", entityId: id, action: "updated", before: sub, after: updated });
  return updated!;
}

export async function goLive(db: SalesDb, actor: SalesActor, id: number, input: { startDate?: string; liveAt?: Date }, config: SalesConfig, now = new Date()) {
  return db.transaction(async (tx) => {
    const { sub, company } = await loadEditable(tx, actor, id);
    if (sub.status !== "active") throw new SalesError(400, `A ${sub.status} subscription cannot go live`);
    if (sub.liveAt) throw new SalesError(400, "Subscription is already live");
    const startDate = input.startDate ?? sub.startDate;
    const errors: string[] = [];
    if (!startDate) errors.push("Live requires the actual production start date");
    const liveAt = input.liveAt ?? now;
    if (liveAt.getTime() > now.getTime()) errors.push("Live production start date cannot be in the future");
    if (!onboardingChecksComplete(sub.onboardingChecks)) errors.push("Live requires completed onboarding checks");
    if (errors.length) throw new SalesError(400, errors.join("; "), { errors });

    await tx
      .update(salesSubscriptionsTable)
      .set({ startDate, renewalDate: sub.renewalDate ?? addMonths(startDate!, 1), updatedAt: now })
      .where(eq(salesSubscriptionsTable.id, id));

    const [paidOpp] = await tx
      .select()
      .from(salesOpportunitiesTable)
      .where(and(eq(salesOpportunitiesTable.companyId, company.id), eq(salesOpportunitiesTable.stage, "Paid")))
      .limit(1);
    let opportunityStage: string | null = null;
    if (paidOpp) {
      const moved = await changeStage(tx, actor, paidOpp.id, { to: "Live", evidence: { liveAt } }, now);
      opportunityStage = moved.opportunity.stage;
    } else {
      await markSubscriptionLive(tx, actor, await loadSubscription(tx, id), liveAt, config.timezone);
    }
    const updated = await loadSubscription(tx, id);
    await writeAudit(tx, { actorUserId: actor.id, entity: "sales_subscription", entityId: id, action: "live", after: { liveAt: updated.liveAt, startDate: updated.startDate, renewalDate: updated.renewalDate } });
    return { subscription: updated, opportunityStage, tasks: await subscriptionTasks(tx, id) };
  });
}

async function setStatus(db: SalesDb, actor: SalesActor, id: number, from: string[], to: string, reason?: string | null) {
  return db.transaction(async (tx) => {
    const { sub } = await loadEditable(tx, actor, id);
    if (!from.includes(sub.status)) throw new SalesError(400, `A ${sub.status} subscription cannot be set to ${to}`);
    const now = new Date();
    const patch: Partial<typeof salesSubscriptionsTable.$inferInsert> = { status: to, updatedAt: now };
    if (to === "paused") patch.pausedAt = now;
    if (to === "active") patch.pausedAt = null;
    if (to === "cancelled") {
      patch.cancelledAt = now;
      patch.cancelReason = reason ?? null;
      await tx
        .update(salesTasksTable)
        .set({ status: "cancelled", outcome: "Subscription cancelled", completedAt: now, completedBy: actor.id, updatedAt: now })
        .where(and(eq(salesTasksTable.subscriptionId, id), eq(salesTasksTable.status, "open")));
    }
    const [updated] = await tx.update(salesSubscriptionsTable).set(patch).where(eq(salesSubscriptionsTable.id, id)).returning();
    await writeAudit(tx, { actorUserId: actor.id, entity: "sales_subscription", entityId: id, action: to, before: { status: sub.status }, after: { status: to }, reason: reason ?? null });
    return updated!;
  });
}

export const pauseSubscription = (db: SalesDb, actor: SalesActor, id: number) => setStatus(db, actor, id, ["active"], "paused");
export const resumeSubscription = (db: SalesDb, actor: SalesActor, id: number) => setStatus(db, actor, id, ["paused"], "active");
export const cancelSubscription = (db: SalesDb, actor: SalesActor, id: number, reason: string) =>
  setStatus(db, actor, id, ["active", "paused"], "cancelled", reason);
