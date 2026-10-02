import { and, asc, desc, eq, inArray, type SQL } from "drizzle-orm";
import {
  salesPaymentAdjustmentsTable,
  salesPaymentsTable,
  salesProposalsTable,
  salesSubscriptionsTable,
  type SalesPayment,
} from "@workspace/db/schema";
import { canEditCompany, loadCompany } from "./company-service.js";
import { forbidden, isFounder, notFound, SalesError, writeAudit, type SalesActor, type SalesDb } from "./db.js";
import { currentSubscription, recomputeFirstPaid, RENEWAL_LEAD_DAYS } from "./revenue-core.js";
import type { PaymentAdjustmentInput, RecordPaymentInput } from "./schemas.js";
import { closeAutoTask, insertAutoTaskOnce } from "./task-service.js";
import { addDays, addMonths, localTime } from "./time.js";

async function loadPayment(db: SalesDb, id: number): Promise<SalesPayment> {
  const [p] = await db.select().from(salesPaymentsTable).where(eq(salesPaymentsTable.id, id));
  if (!p) throw notFound("Payment");
  return p;
}

export async function paymentViews(db: SalesDb, payments: SalesPayment[]) {
  const adjustments = payments.length
    ? await db
        .select()
        .from(salesPaymentAdjustmentsTable)
        .where(inArray(salesPaymentAdjustmentsTable.paymentId, payments.map((p) => p.id)))
        .orderBy(asc(salesPaymentAdjustmentsTable.id))
    : [];
  return payments.map((p) => {
    const own = adjustments.filter((a) => a.paymentId === p.id);
    return {
      ...p,
      adjustments: own,
      netFeePaise: own.reduce((n, a) => n + a.feeDeltaPaise, p.feePaise),
      netTaxPaise: own.reduce((n, a) => n + a.taxDeltaPaise, p.taxPaise),
    };
  });
}

async function paymentView(db: SalesDb, id: number) {
  const [view] = await paymentViews(db, [await loadPayment(db, id)]);
  return view!;
}

export async function listPayments(db: SalesDb, q: { companyId?: number; status?: string; demo: boolean }) {
  const conds: SQL[] = [eq(salesPaymentsTable.isDemo, q.demo)];
  if (q.companyId) conds.push(eq(salesPaymentsTable.companyId, q.companyId));
  if (q.status) conds.push(eq(salesPaymentsTable.status, q.status));
  const rows = await db
    .select()
    .from(salesPaymentsTable)
    .where(and(...conds))
    .orderBy(desc(salesPaymentsTable.receivedAt), desc(salesPaymentsTable.id))
    .limit(500);
  return paymentViews(db, rows);
}

export async function recordPayment(db: SalesDb, actor: SalesActor, input: RecordPaymentInput) {
  const company = await loadCompany(db, input.companyId);
  if (!canEditCompany(actor, company)) throw forbidden("You can only record payments for companies you own");
  if (input.proposalId != null) {
    const [p] = await db
      .select({ id: salesProposalsTable.id })
      .from(salesProposalsTable)
      .where(and(eq(salesProposalsTable.id, input.proposalId), eq(salesProposalsTable.companyId, company.id)));
    if (!p) throw new SalesError(400, "Proposal does not belong to this company");
  }
  let subscriptionId = input.subscriptionId ?? null;
  if (subscriptionId != null) {
    const [s] = await db
      .select({ id: salesSubscriptionsTable.id })
      .from(salesSubscriptionsTable)
      .where(and(eq(salesSubscriptionsTable.id, subscriptionId), eq(salesSubscriptionsTable.companyId, company.id)));
    if (!s) throw new SalesError(400, "Subscription does not belong to this company");
  } else if (input.kind === "renewal") {
    subscriptionId = (await currentSubscription(db, company.id))?.id ?? null;
    if (subscriptionId == null) throw new SalesError(400, "Renewal payments need a subscription");
  }
  const [created] = await db
    .insert(salesPaymentsTable)
    .values({
      companyId: company.id,
      proposalId: input.proposalId ?? null,
      subscriptionId,
      kind: input.kind,
      feePaise: input.feePaise,
      taxPaise: input.taxPaise,
      reference: input.reference ?? null,
      receivedAt: input.receivedAt,
      notes: input.notes ?? null,
      isDemo: company.isDemo,
      createdBy: actor.id,
    })
    .returning();
  await writeAudit(db, { actorUserId: actor.id, entity: "sales_payment", entityId: created!.id, action: "recorded", after: created });
  return paymentView(db, created!.id);
}

async function extendRenewal(db: SalesDb, actor: SalesActor, payment: SalesPayment, tz: string) {
  if (payment.subscriptionId == null) return null;
  const [sub] = await db.select().from(salesSubscriptionsTable).where(eq(salesSubscriptionsTable.id, payment.subscriptionId));
  const base = sub?.renewalDate ?? sub?.startDate;
  if (!sub || !base) return null;
  const next = addMonths(base, 1);
  await db.update(salesSubscriptionsTable).set({ renewalDate: next, updatedAt: new Date() }).where(eq(salesSubscriptionsTable.id, sub.id));
  if (sub.renewalDate) await closeAutoTask(db, `sub:${sub.id}:renewal:${sub.renewalDate}`, "done", actor.id, `Renewal paid (payment ${payment.id})`);
  await insertAutoTaskOnce(db, {
    dedupeKey: `sub:${sub.id}:renewal:${next}`,
    title: `Renewal due ${next}`,
    kind: "renewal",
    dueAt: localTime(addDays(next, -RENEWAL_LEAD_DAYS), "10:00", tz),
    ownerId: sub.customerOwnerId,
    companyId: sub.companyId,
    subscriptionId: sub.id,
    isDemo: sub.isDemo,
    createdBy: actor.id,
  });
  await writeAudit(db, {
    actorUserId: actor.id,
    entity: "sales_subscription",
    entityId: sub.id,
    action: "renewal_extended",
    before: { renewalDate: sub.renewalDate },
    after: { renewalDate: next },
    reason: `Verified renewal payment ${payment.id}`,
  });
  return next;
}

export async function verifyPayment(db: SalesDb, actor: SalesActor, id: number, tz: string) {
  if (!isFounder(actor)) throw forbidden("Only a founder can verify payments");
  return db.transaction(async (tx) => {
    const payment = await loadPayment(tx, id);
    if (payment.status !== "recorded") throw new SalesError(400, `A ${payment.status} payment cannot be verified`);
    const now = new Date();
    await tx
      .update(salesPaymentsTable)
      .set({ status: "verified", verifiedAt: now, verifiedBy: actor.id, updatedAt: now })
      .where(eq(salesPaymentsTable.id, id));
    await writeAudit(tx, { actorUserId: actor.id, entity: "sales_payment", entityId: id, action: "verified", before: { status: payment.status }, after: { status: "verified" } });
    const renewalDate = payment.kind === "renewal" ? await extendRenewal(tx, actor, payment, tz) : null;
    const firstPaidAt = await recomputeFirstPaid(tx, actor, payment.companyId, `Payment ${id} verified`);
    return { payment: await paymentView(tx, id), firstPaidAt, renewalDate };
  });
}

export async function rejectPayment(db: SalesDb, actor: SalesActor, id: number, reason: string) {
  if (!isFounder(actor)) throw forbidden("Only a founder can reject payments");
  return db.transaction(async (tx) => {
    const payment = await loadPayment(tx, id);
    if (payment.status === "rejected") throw new SalesError(400, "Payment is already rejected");
    if (payment.status === "verified" && payment.kind === "renewal") {
      throw new SalesError(400, "A verified renewal payment extended the renewal date; record a refund adjustment instead");
    }
    await tx.update(salesPaymentsTable).set({ status: "rejected", updatedAt: new Date() }).where(eq(salesPaymentsTable.id, id));
    await writeAudit(tx, { actorUserId: actor.id, entity: "sales_payment", entityId: id, action: "rejected", before: { status: payment.status }, after: { status: "rejected" }, reason });
    const firstPaidAt = await recomputeFirstPaid(tx, actor, payment.companyId, `Payment ${id} rejected`);
    return { payment: await paymentView(tx, id), firstPaidAt };
  });
}

export async function adjustPayment(db: SalesDb, actor: SalesActor, id: number, input: PaymentAdjustmentInput) {
  if (!isFounder(actor)) throw forbidden("Only a founder can adjust payments");
  return db.transaction(async (tx) => {
    const payment = await loadPayment(tx, id);
    if (payment.status === "rejected") throw new SalesError(400, "Rejected payments cannot be adjusted");
    const [view] = await paymentViews(tx, [payment]);
    if (view!.netFeePaise + input.feeDeltaPaise < 0 || view!.netTaxPaise + input.taxDeltaPaise < 0) {
      throw new SalesError(400, "Adjustment would make the payment negative");
    }
    const [adjustment] = await tx
      .insert(salesPaymentAdjustmentsTable)
      .values({ paymentId: id, kind: input.kind, feeDeltaPaise: input.feeDeltaPaise, taxDeltaPaise: input.taxDeltaPaise, reason: input.reason, createdBy: actor.id })
      .returning();
    if (input.kind === "refund") {
      await tx
        .update(salesPaymentsTable)
        .set({ refundedPaise: payment.refundedPaise - input.feeDeltaPaise - input.taxDeltaPaise, updatedAt: new Date() })
        .where(eq(salesPaymentsTable.id, id));
    }
    await writeAudit(tx, {
      actorUserId: actor.id,
      entity: "sales_payment",
      entityId: id,
      action: input.kind === "refund" ? "refunded" : "corrected",
      before: { netFeePaise: view!.netFeePaise, netTaxPaise: view!.netTaxPaise },
      after: { netFeePaise: view!.netFeePaise + input.feeDeltaPaise, netTaxPaise: view!.netTaxPaise + input.taxDeltaPaise, adjustmentId: adjustment!.id },
      reason: input.reason,
    });
    const firstPaidAt = await recomputeFirstPaid(tx, actor, payment.companyId, `Payment ${id} ${input.kind}`);
    return { payment: await paymentView(tx, id), adjustment: adjustment!, firstPaidAt };
  });
}
