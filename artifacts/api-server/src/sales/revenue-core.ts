import { and, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import {
  salesCompaniesTable,
  salesPaymentAdjustmentsTable,
  salesPaymentsTable,
  salesProposalsTable,
  salesSubscriptionsTable,
  type SalesCompany,
  type SalesSubscription,
} from "@workspace/db/schema";
import { actorRef, notFound, writeAudit, type SalesActor, type SalesDb } from "./db.js";
import { qualifyingFirstPaidAt } from "./metrics.js";
import { insertAutoTaskOnce } from "./task-service.js";
import { addDays, addMonths, localDateString, localTime, SALES_TZ } from "./time.js";

export const FIRST_PAID_RULE =
  "A company becomes newly paying on the date its verified first-month payments (net of corrections and refunds, cumulative) first reach the accepted proposal's monthly fee, or the subscription fee when there is no accepted proposal. Renewal payments never set first_paid_at.";

export async function acceptedProposal(db: SalesDb, companyId: number) {
  const [proposal] = await db
    .select()
    .from(salesProposalsTable)
    .where(and(eq(salesProposalsTable.companyId, companyId), eq(salesProposalsTable.status, "accepted"), isNotNull(salesProposalsTable.termsAcceptedAt)))
    .orderBy(desc(salesProposalsTable.termsAcceptedAt), desc(salesProposalsTable.id))
    .limit(1);
  return proposal ?? null;
}

export async function currentSubscription(db: SalesDb, companyId: number): Promise<SalesSubscription | null> {
  const [sub] = await db
    .select()
    .from(salesSubscriptionsTable)
    .where(and(eq(salesSubscriptionsTable.companyId, companyId), ne(salesSubscriptionsTable.status, "cancelled")))
    .orderBy(desc(salesSubscriptionsTable.id))
    .limit(1);
  return sub ?? null;
}

export async function firstPaidThresholdPaise(db: SalesDb, companyId: number): Promise<number | null> {
  const proposal = await acceptedProposal(db, companyId);
  if (proposal) return proposal.monthlyFeePaise;
  return (await currentSubscription(db, companyId))?.monthlyFeePaise ?? null;
}

export async function computeFirstPaidAt(db: SalesDb, company: Pick<SalesCompany, "id" | "isDemo">): Promise<Date | null> {
  const threshold = await firstPaidThresholdPaise(db, company.id);
  if (threshold == null) return null;
  const payments = await db
    .select({ id: salesPaymentsTable.id, receivedAt: salesPaymentsTable.receivedAt, feePaise: salesPaymentsTable.feePaise })
    .from(salesPaymentsTable)
    .where(and(
      eq(salesPaymentsTable.companyId, company.id),
      eq(salesPaymentsTable.isDemo, company.isDemo),
      eq(salesPaymentsTable.kind, "first_month"),
      eq(salesPaymentsTable.status, "verified"),
    ));
  if (!payments.length) return null;
  const adjustments = await db
    .select({ paymentId: salesPaymentAdjustmentsTable.paymentId, feeDeltaPaise: salesPaymentAdjustmentsTable.feeDeltaPaise })
    .from(salesPaymentAdjustmentsTable)
    .where(inArray(salesPaymentAdjustmentsTable.paymentId, payments.map((p) => p.id)));
  return qualifyingFirstPaidAt(
    payments.map((p) => ({
      id: p.id,
      receivedAt: p.receivedAt,
      netFeePaise: adjustments.filter((a) => a.paymentId === p.id).reduce((n, a) => n + a.feeDeltaPaise, p.feePaise),
    })),
    threshold,
  );
}

export async function recomputeFirstPaid(db: SalesDb, actor: SalesActor, companyId: number, reason: string): Promise<Date | null> {
  const [company] = await db.select().from(salesCompaniesTable).where(eq(salesCompaniesTable.id, companyId));
  if (!company) throw notFound("Company");
  const next = await computeFirstPaidAt(db, company);
  if ((company.firstPaidAt?.getTime() ?? null) === (next?.getTime() ?? null)) return next;
  await db.update(salesCompaniesTable).set({ firstPaidAt: next, updatedAt: new Date() }).where(eq(salesCompaniesTable.id, companyId));
  await writeAudit(db, {
    actorUserId: actorRef(actor),
    entity: "sales_company",
    entityId: companyId,
    action: "first_paid_recomputed",
    before: { firstPaidAt: company.firstPaidAt },
    after: { firstPaidAt: next },
    reason,
  });
  return next;
}

export async function ensureSubscription(
  db: SalesDb,
  actor: SalesActor,
  company: Pick<SalesCompany, "id" | "isDemo" | "ownerId">,
  fallbackFeePaise: number,
  fallbackMinutes: number,
): Promise<SalesSubscription> {
  const existing = await currentSubscription(db, company.id);
  if (existing) return existing;
  const proposal = await acceptedProposal(db, company.id);
  const [created] = await db
    .insert(salesSubscriptionsTable)
    .values({
      companyId: company.id,
      proposalId: proposal?.id ?? null,
      monthlyFeePaise: proposal?.monthlyFeePaise ?? fallbackFeePaise,
      includedMinutes: proposal?.includedMinutes ?? fallbackMinutes,
      customerOwnerId: company.ownerId,
      status: "active",
      isDemo: company.isDemo,
    })
    .returning();
  await writeAudit(db, {
    actorUserId: actorRef(actor),
    entity: "sales_subscription",
    entityId: created!.id,
    action: "created",
    after: { monthlyFeePaise: created!.monthlyFeePaise, proposalId: created!.proposalId },
  });
  return created!;
}

export const LIVE_REVIEW_DAYS = [1, 7, 14, 25] as const;
export const RENEWAL_LEAD_DAYS = 5;

export function liveTaskPlan(sub: Pick<SalesSubscription, "id" | "startDate" | "renewalDate">, tz: string = SALES_TZ) {
  const start = sub.startDate!;
  const reviews = LIVE_REVIEW_DAYS.map((d) => ({
    dedupeKey: `sub:${sub.id}:review:d${d}`,
    title: d === 1 ? "Day 1 live check" : `Day ${d} service review`,
    kind: d === 1 ? "onboarding" : "service_review",
    dueAt: localTime(addDays(start, d), "10:00", tz),
  }));
  const renewalDate = sub.renewalDate ?? addMonths(start, 1);
  return [
    ...reviews,
    {
      dedupeKey: `sub:${sub.id}:renewal:${renewalDate}`,
      title: `Renewal due ${renewalDate}`,
      kind: "renewal",
      dueAt: localTime(addDays(renewalDate, -RENEWAL_LEAD_DAYS), "10:00", tz),
    },
  ];
}

export async function generateLiveTasks(db: SalesDb, actor: SalesActor, sub: SalesSubscription, tz: string): Promise<number> {
  if (!sub.startDate) return 0;
  let created = 0;
  for (const t of liveTaskPlan(sub, tz)) {
    const inserted = await insertAutoTaskOnce(db, {
      ...t,
      ownerId: sub.customerOwnerId,
      companyId: sub.companyId,
      subscriptionId: sub.id,
      isDemo: sub.isDemo,
      createdBy: actorRef(actor),
    });
    if (inserted) created++;
  }
  return created;
}

export async function markSubscriptionLive(
  db: SalesDb,
  actor: SalesActor,
  sub: SalesSubscription,
  liveAt: Date,
  tz: string,
  startDate?: string,
): Promise<SalesSubscription> {
  const start = startDate ?? sub.startDate ?? localDateString(liveAt, tz);
  const [updated] = await db
    .update(salesSubscriptionsTable)
    .set({
      liveAt: sub.liveAt ?? liveAt,
      startDate: start,
      renewalDate: sub.renewalDate ?? addMonths(start, 1),
      updatedAt: new Date(),
    })
    .where(eq(salesSubscriptionsTable.id, sub.id))
    .returning();
  await generateLiveTasks(db, actor, updated!, tz);
  return updated!;
}
