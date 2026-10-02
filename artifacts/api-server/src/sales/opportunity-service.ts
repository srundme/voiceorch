import { and, desc, eq, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import {
  salesActivitiesTable,
  salesCompaniesTable,
  salesContactsTable,
  salesOpportunitiesTable,
  salesPilotsTable,
  salesProposalsTable,
  salesStageHistoryTable,
  type SalesCompany,
  type SalesOpportunity,
} from "@workspace/db/schema";
import { syncOpportunityDemo } from "./activity-service.js";
import { forbidden, isFounder, notFound, SalesError, writeAudit, type SalesActor, type SalesDb } from "./db.js";
import { computeFirstPaidAt, currentSubscription, ensureSubscription, markSubscriptionLive, recomputeFirstPaid } from "./revenue-core.js";
import type { StageChangeInput, UpdateOpportunityInput } from "./schemas.js";
import { getSettings } from "./settings-service.js";
import {
  isStage,
  validateStageChange,
  type PilotReadiness,
  type Qualification,
  type Review,
  type Stage,
  type StageFacts,
} from "./stages.js";
import { upsertAutoTask } from "./task-service.js";

export const ACTIVE_PILOT_STATUSES = ["Setup", "Calling", "Review due"] as const;

type Evidence = StageChangeInput["evidence"];

export function canEditOpportunity(actor: SalesActor, opp: Pick<SalesOpportunity, "ownerId">, company: Pick<SalesCompany, "ownerId">): boolean {
  return isFounder(actor) || company.ownerId === actor.id || opp.ownerId === actor.id;
}

function defined<T extends object>(obj: T | null | undefined): Partial<T> {
  if (!obj) return {};
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function asObject<T>(value: unknown): T {
  return (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as T;
}

export function onboardingChecksComplete(checks: unknown): boolean {
  const entries = Object.values(asObject<Record<string, unknown>>(checks));
  if (!entries.length) return false;
  return entries.every((v) => v === true || (typeof v === "object" && v !== null && (v as { done?: unknown }).done === true));
}

async function loadOpportunity(db: SalesDb, id: number, lock = false) {
  const query = db
    .select({ opp: salesOpportunitiesTable, company: salesCompaniesTable })
    .from(salesOpportunitiesTable)
    .innerJoin(salesCompaniesTable, eq(salesCompaniesTable.id, salesOpportunitiesTable.companyId))
    .where(eq(salesOpportunitiesTable.id, id));
  const [row] = lock ? await query.for("update", { of: salesOpportunitiesTable }) : await query;
  if (!row) throw notFound("Opportunity");
  return row;
}

async function contactBelongs(db: SalesDb, contactId: number | null | undefined, companyId: number): Promise<boolean> {
  if (contactId == null) return false;
  const [hit] = await db
    .select({ id: salesContactsTable.id })
    .from(salesContactsTable)
    .where(and(eq(salesContactsTable.id, contactId), eq(salesContactsTable.companyId, companyId)));
  return Boolean(hit);
}

export async function gatherStageFacts(
  db: SalesDb,
  opp: SalesOpportunity,
  company: SalesCompany,
  evidence: Evidence,
  to: Stage,
): Promise<StageFacts> {
  const forThisOpp = (table: { companyId: PgColumn; opportunityId: PgColumn }) =>
    and(eq(table.companyId, company.id), or(eq(table.opportunityId, opp.id), isNull(table.opportunityId)));

  const qualification: Qualification = {
    need: company.painPoint,
    callingVolume: company.callingVolume,
    budgetFit: company.budgetFit,
    decisionMaker: company.decisionMaker,
    ...defined(asObject<Qualification>(opp.qualification)),
    ...defined(evidence.qualification),
  };

  const [latestDemo] = await db
    .select({ contactId: salesActivitiesTable.contactId, scheduledAt: salesActivitiesTable.scheduledAt })
    .from(salesActivitiesTable)
    .where(and(forThisOpp(salesActivitiesTable), eq(salesActivitiesTable.type, "demo"), inArray(salesActivitiesTable.status, ["scheduled", "completed"])))
    .orderBy(desc(salesActivitiesTable.id))
    .limit(1);
  const demoBuyerContactId = evidence.demoBuyerContactId ?? opp.demoBuyerContactId ?? latestDemo?.contactId ?? null;
  const demoAt = evidence.demoAt ?? opp.demoAt ?? latestDemo?.scheduledAt ?? null;

  const [completedDemo] = await db
    .select({ id: salesActivitiesTable.id })
    .from(salesActivitiesTable)
    .where(and(forThisOpp(salesActivitiesTable), eq(salesActivitiesTable.status, "completed"), eq(salesActivitiesTable.flagDemo, true)))
    .limit(1);

  const [activePilot] = await db
    .select({ id: salesPilotsTable.id })
    .from(salesPilotsTable)
    .where(and(forThisOpp(salesPilotsTable), inArray(salesPilotsTable.status, [...ACTIVE_PILOT_STATUSES])))
    .limit(1);

  const [proposal] = await db
    .select({ id: salesProposalsTable.id })
    .from(salesProposalsTable)
    .where(and(forThisOpp(salesProposalsTable), ne(salesProposalsTable.status, "declined")))
    .limit(1);

  const [accepted] = await db
    .select({ id: salesProposalsTable.id })
    .from(salesProposalsTable)
    .where(and(forThisOpp(salesProposalsTable), eq(salesProposalsTable.status, "accepted"), isNotNull(salesProposalsTable.termsAcceptedAt)))
    .limit(1);

  const firstPaidAt = await computeFirstPaidAt(db, company);
  const subscription = await currentSubscription(db, company.id);

  const [laterEntry] = await db
    .select({ fromStage: salesStageHistoryTable.fromStage })
    .from(salesStageHistoryTable)
    .where(and(eq(salesStageHistoryTable.opportunityId, opp.id), eq(salesStageHistoryTable.toStage, "Later")))
    .orderBy(desc(salesStageHistoryTable.id))
    .limit(1);
  const before = laterEntry?.fromStage;

  return {
    qualification,
    decisionMakerContactValid: await contactBelongs(db, qualification.decisionMakerContactId, company.id),
    demoBuyerContactId,
    demoBuyerContactValid: await contactBelongs(db, demoBuyerContactId, company.id),
    demoAt,
    hasCompletedDemo: Boolean(completedDemo),
    pilotReadiness: { ...defined(asObject<PilotReadiness>(opp.pilotReadiness)), ...defined(evidence.pilotReadiness) },
    hasActivePilot: Boolean(activePilot),
    review: { ...defined(asObject<Review>(opp.review)), ...defined(evidence.review) },
    hasProposal: Boolean(proposal),
    hasAcceptedTerms: Boolean(accepted),
    hasVerifiedFirstMonthPayment: firstPaidAt != null,
    liveAt: evidence.liveAt ?? subscription?.liveAt ?? null,
    onboardingChecksComplete: onboardingChecksComplete(subscription?.onboardingChecks),
    laterReason: to === "Later" ? evidence.reason ?? null : opp.laterReason,
    laterActionAt: to === "Later" ? evidence.actionAt ?? null : opp.laterActionAt,
    lostReason: to === "Lost" ? evidence.reason ?? null : opp.lostReason,
    stageBeforeLater: before && isStage(before) ? before : null,
  };
}

export async function changeStage(db: SalesDb, actor: SalesActor, oppId: number, input: StageChangeInput, now = new Date()) {
  return db.transaction(async (tx) => {
    const { config } = await getSettings(tx);
    const { opp, company } = await loadOpportunity(tx, oppId, true);
    if (!canEditOpportunity(actor, opp, company)) throw forbidden("You can only move opportunities you own");
    const from = opp.stage as Stage;
    const to = input.to;

    const facts = await gatherStageFacts(tx, opp, company, input.evidence, to);
    const result = validateStageChange({ from, to, role: actor.role, note: input.note, bypassReason: input.bypassReason, now, facts });
    if (!result.ok) throw new SalesError(result.status, result.errors.join("; "), { errors: result.errors });

    const ev = input.evidence;
    const patch: Partial<typeof salesOpportunitiesTable.$inferInsert> = { stage: to, stageChangedAt: now, updatedAt: now };
    if (ev.qualification) patch.qualification = { ...asObject<Record<string, unknown>>(opp.qualification), ...defined(ev.qualification) };
    if (ev.pilotReadiness) patch.pilotReadiness = { ...asObject<Record<string, unknown>>(opp.pilotReadiness), ...defined(ev.pilotReadiness) };
    if (ev.review) patch.review = { ...asObject<Record<string, unknown>>(opp.review), ...defined(ev.review) };
    if (to === "Demo booked") {
      patch.demoBuyerContactId = facts.demoBuyerContactId;
      patch.demoAt = facts.demoAt;
    }
    if (to === "Later") {
      patch.laterReason = facts.laterReason;
      patch.laterActionAt = facts.laterActionAt;
    } else if (from === "Later") {
      patch.laterReason = null;
      patch.laterActionAt = null;
    }
    if (to === "Lost") {
      patch.lostReason = facts.lostReason;
      patch.closedAt = now;
    }
    if (to === "Live") patch.closedAt = now;
    if (result.bypass) {
      patch.bypassReason = input.bypassReason ?? null;
      patch.bypassBy = actor.id;
    }

    const [updated] = await tx.update(salesOpportunitiesTable).set(patch).where(eq(salesOpportunitiesTable.id, opp.id)).returning();

    const companyPatch: Partial<typeof salesCompaniesTable.$inferInsert> = {};
    if (ev.qualification) {
      const q = ev.qualification;
      if (q.need) companyPatch.painPoint = q.need;
      if (q.callingVolume != null) companyPatch.callingVolume = q.callingVolume;
      if (q.budgetFit) companyPatch.budgetFit = q.budgetFit;
      if (q.decisionMaker) companyPatch.decisionMaker = q.decisionMaker;
    }
    if (Object.keys(companyPatch).length) {
      await tx.update(salesCompaniesTable).set({ ...companyPatch, updatedAt: now }).where(eq(salesCompaniesTable.id, company.id));
    }
    if (to === "Paid") {
      await recomputeFirstPaid(tx, actor, company.id, "Opportunity moved to Paid");
      await ensureSubscription(tx, actor, company, config.offer.monthlyFeePaise, config.offer.includedMinutes);
    }
    if (to === "Live") {
      const sub = await currentSubscription(tx, company.id);
      if (sub && facts.liveAt) await markSubscriptionLive(tx, actor, sub, facts.liveAt, config.timezone);
    }
    if (to === "Demo booked" && facts.demoAt) {
      await syncOpportunityDemo(tx, actor, {
        company,
        opportunityId: opp.id,
        ownerId: opp.ownerId ?? company.ownerId,
        contactId: facts.demoBuyerContactId,
        at: facts.demoAt,
      });
    }
    if (to === "Later" && facts.laterActionAt) {
      await upsertAutoTask(tx, {
        dedupeKey: `later:${opp.id}:${facts.laterActionAt.toISOString()}`,
        title: `Revisit ${company.name}: ${facts.laterReason ?? ""}`.trim(),
        kind: "follow_up",
        dueAt: facts.laterActionAt,
        ownerId: opp.ownerId ?? company.ownerId,
        companyId: company.id,
        opportunityId: opp.id,
        isDemo: company.isDemo,
        createdBy: actor.id,
      });
    }

    const [history] = await tx
      .insert(salesStageHistoryTable)
      .values({
        opportunityId: opp.id,
        fromStage: from,
        toStage: to,
        changedBy: actor.id,
        changedAt: now,
        evidence: JSON.parse(JSON.stringify(ev)),
        bypass: result.bypass,
        note: input.note ?? null,
      })
      .returning();

    await writeAudit(tx, {
      actorUserId: actor.id,
      entity: "sales_opportunity",
      entityId: opp.id,
      action: result.bypass ? "stage_bypassed" : "stage_changed",
      before: { stage: from },
      after: { stage: to, skipped: result.skipped },
      reason: input.bypassReason ?? input.note ?? null,
    });

    return { opportunity: updated!, history: history!, bypass: result.bypass, skipped: result.skipped };
  });
}

export async function updateOpportunity(db: SalesDb, actor: SalesActor, oppId: number, input: UpdateOpportunityInput) {
  const { opp, company } = await loadOpportunity(db, oppId);
  if (!canEditOpportunity(actor, opp, company)) throw forbidden("You can only edit opportunities you own");
  if (input.demoBuyerContactId != null && !(await contactBelongs(db, input.demoBuyerContactId, company.id))) {
    throw new SalesError(400, "Buyer contact must belong to this company");
  }
  const dmId = input.qualification?.decisionMakerContactId;
  if (dmId != null && !(await contactBelongs(db, dmId, company.id))) {
    throw new SalesError(400, "Decision maker contact must belong to this company");
  }
  const patch: Partial<typeof salesOpportunitiesTable.$inferInsert> = { updatedAt: new Date() };
  if (input.qualification) patch.qualification = { ...asObject<Record<string, unknown>>(opp.qualification), ...defined(input.qualification) };
  if (input.pilotReadiness) patch.pilotReadiness = { ...asObject<Record<string, unknown>>(opp.pilotReadiness), ...defined(input.pilotReadiness) };
  if (input.review) patch.review = { ...asObject<Record<string, unknown>>(opp.review), ...defined(input.review) };
  if (input.terms) patch.terms = { ...asObject<Record<string, unknown>>(opp.terms), ...input.terms };
  if (input.demoBuyerContactId !== undefined) patch.demoBuyerContactId = input.demoBuyerContactId;
  if (input.demoAt !== undefined) patch.demoAt = input.demoAt;
  return db.transaction(async (tx) => {
    const [updated] = await tx.update(salesOpportunitiesTable).set(patch).where(eq(salesOpportunitiesTable.id, oppId)).returning();
    const demoMoved = input.demoAt != null && input.demoAt.getTime() !== opp.demoAt?.getTime();
    if (updated!.stage === "Demo booked" && updated!.demoAt && (demoMoved || input.demoBuyerContactId !== undefined)) {
      await syncOpportunityDemo(tx, actor, {
        company,
        opportunityId: opp.id,
        ownerId: opp.ownerId ?? company.ownerId,
        contactId: updated!.demoBuyerContactId,
        at: updated!.demoAt,
        previousAt: demoMoved ? opp.demoAt : null,
      });
    }
    return updated!;
  });
}

export async function getOpportunity(db: SalesDb, oppId: number) {
  const { opp, company } = await loadOpportunity(db, oppId);
  const history = await db
    .select()
    .from(salesStageHistoryTable)
    .where(eq(salesStageHistoryTable.opportunityId, oppId))
    .orderBy(desc(salesStageHistoryTable.id));
  return { opportunity: opp, company: { id: company.id, name: company.name, ownerId: company.ownerId }, history };
}
