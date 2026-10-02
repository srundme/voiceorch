import { and, desc, eq, sql } from "drizzle-orm";
import { salesOpportunitiesTable, salesProposalsTable, type SalesProposal } from "@workspace/db/schema";
import { canEditCompany, loadCompany } from "./company-service.js";
import { forbidden, notFound, SalesError, writeAudit, type SalesActor, type SalesDb } from "./db.js";
import { proposalAmounts } from "./metrics.js";
import { recomputeFirstPaid } from "./revenue-core.js";
import type { CreateProposalInput, UpdateProposalInput } from "./schemas.js";
import type { SalesConfig } from "./settings-schema.js";

const EDITABLE = ["draft", "sent"];

export function proposalView(p: SalesProposal) {
  return { ...p, amounts: proposalAmounts(p) };
}

async function loadProposal(db: SalesDb, id: number): Promise<SalesProposal> {
  const [p] = await db.select().from(salesProposalsTable).where(eq(salesProposalsTable.id, id));
  if (!p) throw notFound("Proposal");
  return p;
}

async function loadEditable(db: SalesDb, actor: SalesActor, id: number) {
  const proposal = await loadProposal(db, id);
  const company = await loadCompany(db, proposal.companyId);
  if (!canEditCompany(actor, company)) throw forbidden("You can only change proposals for companies you own");
  return { proposal, company };
}

export async function listProposals(db: SalesDb, companyId: number) {
  const rows = await db.select().from(salesProposalsTable).where(eq(salesProposalsTable.companyId, companyId)).orderBy(desc(salesProposalsTable.id));
  return rows.map(proposalView);
}

export async function createProposal(db: SalesDb, actor: SalesActor, input: CreateProposalInput, config: SalesConfig) {
  const company = await loadCompany(db, input.companyId);
  if (!canEditCompany(actor, company)) throw forbidden("You can only create proposals for companies you own");
  let opportunityId = input.opportunityId ?? null;
  if (opportunityId != null) {
    const [opp] = await db
      .select({ id: salesOpportunitiesTable.id })
      .from(salesOpportunitiesTable)
      .where(and(eq(salesOpportunitiesTable.id, opportunityId), eq(salesOpportunitiesTable.companyId, company.id)));
    if (!opp) throw new SalesError(400, "Opportunity does not belong to this company");
  } else {
    const [open] = await db
      .select({ id: salesOpportunitiesTable.id })
      .from(salesOpportunitiesTable)
      .where(and(eq(salesOpportunitiesTable.companyId, company.id), sql`${salesOpportunitiesTable.stage} NOT IN ('Lost', 'Live')`))
      .limit(1);
    opportunityId = open?.id ?? null;
  }
  const [created] = await db
    .insert(salesProposalsTable)
    .values({
      companyId: company.id,
      opportunityId,
      monthlyFeePaise: input.monthlyFeePaise ?? config.offer.monthlyFeePaise,
      setupFeePaise: input.setupFeePaise ?? 0,
      includedMinutes: input.includedMinutes ?? config.offer.includedMinutes,
      gstRateBps: input.gstRateBps ?? config.offer.gstRateBps,
      scope: input.scope ?? null,
      createdBy: actor.id,
    })
    .returning();
  await writeAudit(db, { actorUserId: actor.id, entity: "sales_proposal", entityId: created!.id, action: "created", after: created });
  return proposalView(created!);
}

export async function updateProposal(db: SalesDb, actor: SalesActor, id: number, input: UpdateProposalInput) {
  const { proposal } = await loadEditable(db, actor, id);
  if (!EDITABLE.includes(proposal.status)) throw new SalesError(400, `A ${proposal.status} proposal cannot be edited`);
  const [updated] = await db
    .update(salesProposalsTable)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(salesProposalsTable.id, id))
    .returning();
  await writeAudit(db, { actorUserId: actor.id, entity: "sales_proposal", entityId: id, action: "updated", before: proposal, after: updated });
  return proposalView(updated!);
}

async function transition(
  db: SalesDb,
  actor: SalesActor,
  id: number,
  to: "sent" | "accepted" | "declined",
  patch: Partial<typeof salesProposalsTable.$inferInsert>,
  reason?: string | null,
) {
  return db.transaction(async (tx) => {
    const { proposal } = await loadEditable(tx, actor, id);
    if (!EDITABLE.includes(proposal.status)) throw new SalesError(400, `A ${proposal.status} proposal cannot be marked ${to}`);
    if (to === "sent" && proposal.status !== "draft") throw new SalesError(400, "Only draft proposals can be marked sent");
    const now = new Date();
    const [updated] = await tx
      .update(salesProposalsTable)
      .set({ ...patch, status: to, updatedAt: now })
      .where(eq(salesProposalsTable.id, id))
      .returning();
    await writeAudit(tx, {
      actorUserId: actor.id,
      entity: "sales_proposal",
      entityId: id,
      action: to,
      before: { status: proposal.status },
      after: { status: to, ...patch },
      reason: reason ?? null,
    });
    if (to === "accepted") await recomputeFirstPaid(tx, actor, proposal.companyId, "Proposal accepted");
    return proposalView(updated!);
  });
}

export function sendProposal(db: SalesDb, actor: SalesActor, id: number) {
  return transition(db, actor, id, "sent", { sentAt: new Date() });
}

export function acceptProposal(db: SalesDb, actor: SalesActor, id: number, acceptedBy: string, acceptedAt?: Date) {
  return transition(db, actor, id, "accepted", { termsAcceptedAt: acceptedAt ?? new Date(), termsAcceptedBy: acceptedBy });
}

export function declineProposal(db: SalesDb, actor: SalesActor, id: number, reason?: string | null) {
  return transition(db, actor, id, "declined", { declinedAt: new Date(), declineReason: reason ?? null }, reason);
}
