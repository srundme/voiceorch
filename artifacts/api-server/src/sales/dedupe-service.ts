import { and, eq, inArray, ne } from "drizzle-orm";
import {
  salesActivitiesTable,
  salesCompaniesTable,
  salesContactsTable,
  salesOpportunitiesTable,
  salesPaymentsTable,
  salesPilotsTable,
  salesProposalsTable,
  salesSubscriptionsTable,
  salesTasksTable,
  salesTouchpointsTable,
} from "@workspace/db/schema";
import { recomputeCompanyActivityFlags } from "./activity-service.js";
import { canEditCompany, loadCompany, recordTouchpoint } from "./company-service.js";
import { forbidden, isFounder, SalesError, writeAudit, type SalesActor, type SalesDb } from "./db.js";
import type { DedupeReviewInput } from "./schemas.js";

/**
 * Resolves a fuzzy-name duplicate flag. "keep_separate" clears the flag; "merge" (founder only)
 * folds a fresh lead (no pilots, proposals, payments or subscriptions; still Identified) into the
 * company it was flagged against and deletes it.
 */
export async function resolveDedupeReview(db: SalesDb, actor: SalesActor, companyId: number, input: DedupeReviewInput) {
  const company = await loadCompany(db, companyId);
  if (!company.needsDedupeReview) throw new SalesError(400, "This company is not waiting for a duplicate review");

  if (input.action === "keep_separate") {
    if (!canEditCompany(actor, company)) throw forbidden("You can only review duplicates on your own companies");
    return db.transaction(async (tx) => {
      const [updated] = await tx
        .update(salesCompaniesTable)
        .set({ needsDedupeReview: false, duplicateOfCompanyId: null, updatedAt: new Date() })
        .where(eq(salesCompaniesTable.id, company.id))
        .returning();
      await writeAudit(tx, {
        actorUserId: actor.id,
        entity: "sales_company",
        entityId: company.id,
        action: "dedupe_kept_separate",
        before: { duplicateOfCompanyId: company.duplicateOfCompanyId },
        after: { duplicateOfCompanyId: null },
        reason: input.reason ?? null,
      });
      return { action: "keep_separate" as const, companyId: updated!.id };
    });
  }

  if (!isFounder(actor)) throw forbidden("Only the founder can merge companies");
  const targetId = input.targetCompanyId ?? company.duplicateOfCompanyId;
  if (!targetId || targetId === company.id) throw new SalesError(400, "Choose the company to merge into");
  const target = await loadCompany(db, targetId);
  if (target.isDemo !== company.isDemo) throw new SalesError(400, "Demo and real companies cannot be merged");

  const blockers: string[] = [];
  const [pilot] = await db.select({ id: salesPilotsTable.id }).from(salesPilotsTable).where(eq(salesPilotsTable.companyId, company.id)).limit(1);
  if (pilot) blockers.push("pilots");
  const [proposal] = await db.select({ id: salesProposalsTable.id }).from(salesProposalsTable).where(eq(salesProposalsTable.companyId, company.id)).limit(1);
  if (proposal) blockers.push("proposals");
  const [payment] = await db.select({ id: salesPaymentsTable.id }).from(salesPaymentsTable).where(eq(salesPaymentsTable.companyId, company.id)).limit(1);
  if (payment) blockers.push("payments");
  const [sub] = await db.select({ id: salesSubscriptionsTable.id }).from(salesSubscriptionsTable).where(eq(salesSubscriptionsTable.companyId, company.id)).limit(1);
  if (sub) blockers.push("subscriptions");
  const [progressed] = await db
    .select({ id: salesOpportunitiesTable.id })
    .from(salesOpportunitiesTable)
    .where(and(eq(salesOpportunitiesTable.companyId, company.id), ne(salesOpportunitiesTable.stage, "Identified")))
    .limit(1);
  if (progressed) blockers.push("an opportunity past Identified");
  if (blockers.length) {
    throw new SalesError(409, `This company cannot be merged because it has ${blockers.join(", ")}. Keep it separate instead.`, { blockers });
  }

  return db.transaction(async (tx) => {
    const [targetOpp] = await tx
      .select({ id: salesOpportunitiesTable.id })
      .from(salesOpportunitiesTable)
      .where(and(eq(salesOpportunitiesTable.companyId, target.id), ne(salesOpportunitiesTable.stage, "Lost"), ne(salesOpportunitiesTable.stage, "Live")))
      .limit(1);
    const sourceOppIds = (
      await tx.select({ id: salesOpportunitiesTable.id }).from(salesOpportunitiesTable).where(eq(salesOpportunitiesTable.companyId, company.id))
    ).map((o) => o.id);

    const moved = {
      contacts: (await tx.update(salesContactsTable).set({ companyId: target.id }).where(eq(salesContactsTable.companyId, company.id)).returning({ id: salesContactsTable.id })).length,
      activities: (
        await tx
          .update(salesActivitiesTable)
          .set({ companyId: target.id, opportunityId: targetOpp?.id ?? null })
          .where(eq(salesActivitiesTable.companyId, company.id))
          .returning({ id: salesActivitiesTable.id })
      ).length,
      tasks: (
        await tx
          .update(salesTasksTable)
          .set({ companyId: target.id, opportunityId: targetOpp?.id ?? null })
          .where(eq(salesTasksTable.companyId, company.id))
          .returning({ id: salesTasksTable.id })
      ).length,
      touchpoints: (
        await tx.update(salesTouchpointsTable).set({ companyId: target.id }).where(eq(salesTouchpointsTable.companyId, company.id)).returning({ id: salesTouchpointsTable.id })
      ).length,
    };
    if (sourceOppIds.length) await tx.delete(salesOpportunitiesTable).where(inArray(salesOpportunitiesTable.id, sourceOppIds));
    await tx.delete(salesCompaniesTable).where(eq(salesCompaniesTable.id, company.id));

    const fill: Partial<typeof salesCompaniesTable.$inferInsert> = {};
    if (!target.website && company.website) {
      fill.website = company.website;
      fill.domainNormalized = target.domainNormalized ?? company.domainNormalized;
    }
    if (!target.city && company.city) fill.city = company.city;
    if (!target.area && company.area) fill.area = company.area;
    if (!target.sector && company.sector) fill.sector = company.sector;
    if (company.internalNotes) {
      fill.internalNotes = [target.internalNotes, `Merged from "${company.name}": ${company.internalNotes}`].filter(Boolean).join("\n\n");
    }
    await tx.update(salesCompaniesTable).set({ ...fill, updatedAt: new Date() }).where(eq(salesCompaniesTable.id, target.id));
    await recomputeCompanyActivityFlags(tx, target.id);
    await recordTouchpoint(tx, {
      companyId: target.id,
      kind: "manual",
      source: company.source,
      campaign: company.sourceCampaign,
      occurredAt: company.originalEnquiryAt ?? company.createdAt,
      details: { mergedFromCompanyId: company.id, mergedFromName: company.name },
      isDemo: target.isDemo,
      createdBy: actor.id,
    });
    await writeAudit(tx, {
      actorUserId: actor.id,
      entity: "sales_company",
      entityId: target.id,
      action: "dedupe_merged",
      before: { mergedCompanyId: company.id, name: company.name, source: company.source },
      after: { ...moved, filled: Object.keys(fill) },
      reason: input.reason ?? null,
    });
    return { action: "merge" as const, companyId: target.id, mergedCompanyId: company.id, moved };
  });
}
