import { and, desc, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import {
  salesCompaniesTable,
  salesImportsTable,
  salesOpportunitiesTable,
  salesPilotSnapshotsTable,
  salesPilotsTable,
  type SalesPilot,
  type SalesPilotSnapshot,
} from "@workspace/db/schema";
import { canEditCompany, loadCompany } from "./company-service.js";
import { actorRef, forbidden, isFounder, notFound, SalesError, writeAudit, type SalesActor, type SalesDb } from "./db.js";
import { NEW_PILOT_RULE, pilotAllowance, pilotRates, SNAPSHOT_METRIC_KEYS, snapshotConsistencyErrors, type SnapshotMetrics } from "./metrics.js";
import { ACTIVE_PILOT_STATUSES } from "./opportunity-service.js";
import {
  snapshotImportRowSchema,
  type CreatePilotInput,
  type PilotExtensionInput,
  type PilotStatus,
  type PilotStatusInput,
  type SnapshotInput,
  type UpdatePilotInput,
} from "./schemas.js";
import type { SalesConfig } from "./settings-schema.js";
import { assertAssignableOwner, closeAutoTask, upsertAutoTask } from "./task-service.js";

const FINAL_STATUSES: readonly PilotStatus[] = ["Completed", "Cancelled"];
const NEXT_STATUS: Partial<Record<PilotStatus, PilotStatus>> = {
  Draft: "Setup",
  Setup: "Calling",
  Calling: "Review due",
  "Review due": "Completed",
};
const POST_FINAL_EDITABLE = new Set([
  "buyerFeedback",
  "acceptedOutcomesNote",
  "proposedNextStep",
  "customerReportNotes",
  "internalNotes",
  "qualityReview",
  "recordingLinks",
  "reportLink",
]);
export function canEditPilot(actor: SalesActor, pilot: Pick<SalesPilot, "ownerId">, company: { ownerId: number | null }): boolean {
  return isFounder(actor) || pilot.ownerId === actor.id || company.ownerId === actor.id;
}

function isActiveStatus(status: string): boolean {
  return (ACTIVE_PILOT_STATUSES as readonly string[]).includes(status);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function pilotView(pilot: SalesPilot, latestSnapshot: SalesPilotSnapshot | null) {
  return {
    ...pilot,
    latestSnapshot,
    allowance: pilotAllowance(pilot, latestSnapshot?.attempts ?? null),
    rates: pilotRates(latestSnapshot),
  };
}

async function loadPilot(db: SalesDb, id: number): Promise<SalesPilot> {
  const [pilot] = await db.select().from(salesPilotsTable).where(eq(salesPilotsTable.id, id));
  if (!pilot) throw notFound("Pilot");
  return pilot;
}

async function loadEditable(db: SalesDb, actor: SalesActor, id: number) {
  const pilot = await loadPilot(db, id);
  const company = await loadCompany(db, pilot.companyId);
  if (!canEditPilot(actor, pilot, company)) throw forbidden("You can only change pilots you own");
  return { pilot, company };
}

export async function latestSnapshot(db: SalesDb, pilotId: number): Promise<SalesPilotSnapshot | null> {
  const [snap] = await db
    .select()
    .from(salesPilotSnapshotsTable)
    .where(eq(salesPilotSnapshotsTable.pilotId, pilotId))
    .orderBy(desc(salesPilotSnapshotsTable.asOf), desc(salesPilotSnapshotsTable.id))
    .limit(1);
  return snap ?? null;
}

export async function latestSnapshots(db: SalesDb, pilotIds: number[]): Promise<Map<number, SalesPilotSnapshot>> {
  const out = new Map<number, SalesPilotSnapshot>();
  if (!pilotIds.length) return out;
  const rows = await db
    .select()
    .from(salesPilotSnapshotsTable)
    .where(inArray(salesPilotSnapshotsTable.pilotId, pilotIds))
    .orderBy(desc(salesPilotSnapshotsTable.asOf), desc(salesPilotSnapshotsTable.id));
  for (const row of rows) if (!out.has(row.pilotId)) out.set(row.pilotId, row);
  return out;
}

async function view(db: SalesDb, id: number) {
  const pilot = await loadPilot(db, id);
  return pilotView(pilot, await latestSnapshot(db, id));
}

export async function listPilots(db: SalesDb, q: { companyId?: number; status?: string; demo: boolean }) {
  const conds: SQL[] = [eq(salesPilotsTable.isDemo, q.demo)];
  if (q.companyId) conds.push(eq(salesPilotsTable.companyId, q.companyId));
  if (q.status) conds.push(eq(salesPilotsTable.status, q.status));
  const rows = await db
    .select({ pilot: salesPilotsTable, companyName: salesCompaniesTable.name })
    .from(salesPilotsTable)
    .innerJoin(salesCompaniesTable, eq(salesCompaniesTable.id, salesPilotsTable.companyId))
    .where(and(...conds))
    .orderBy(desc(salesPilotsTable.id))
    .limit(500);
  const latest = await latestSnapshots(db, rows.map((r) => r.pilot.id));
  return rows.map((r) => ({ ...pilotView(r.pilot, latest.get(r.pilot.id) ?? null), companyName: r.companyName }));
}

export async function getPilot(db: SalesDb, id: number) {
  const pilot = await view(db, id);
  const snapshots = await db
    .select()
    .from(salesPilotSnapshotsTable)
    .where(eq(salesPilotSnapshotsTable.pilotId, id))
    .orderBy(desc(salesPilotSnapshotsTable.asOf), desc(salesPilotSnapshotsTable.id));
  return { pilot, snapshots, newPilotRule: NEW_PILOT_RULE };
}

function pilotValues(input: UpdatePilotInput): Partial<typeof salesPilotsTable.$inferInsert> {
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    values[key] = typeof value === "string" ? value.trim() || null : value;
  }
  return values as Partial<typeof salesPilotsTable.$inferInsert>;
}

export async function createPilot(db: SalesDb, actor: SalesActor, input: CreatePilotInput, config: SalesConfig) {
  const company = await loadCompany(db, input.companyId);
  if (!canEditCompany(actor, company)) throw forbidden("You can only create pilots for companies you own");
  if (input.attemptAllowance !== undefined && input.attemptAllowance !== config.pilot.attemptAllowance && !isFounder(actor)) {
    throw forbidden("Only a founder can change the attempt allowance");
  }
  const { companyId, isDemo, ...rest } = input;
  const ownerId = rest.ownerId !== undefined ? rest.ownerId : company.ownerId ?? actor.id;
  await assertAssignableOwner(db, ownerId);
  if (rest.followupOwnerId != null) await assertAssignableOwner(db, rest.followupOwnerId);
  let opportunityId = rest.opportunityId ?? null;
  if (opportunityId == null) {
    const [open] = await db
      .select({ id: salesOpportunitiesTable.id })
      .from(salesOpportunitiesTable)
      .where(and(eq(salesOpportunitiesTable.companyId, companyId), sql`${salesOpportunitiesTable.stage} NOT IN ('Lost', 'Live')`))
      .limit(1);
    opportunityId = open?.id ?? null;
  }
  const [created] = await db
    .insert(salesPilotsTable)
    .values({
      ...pilotValues(rest),
      companyId,
      opportunityId,
      ownerId,
      status: "Draft",
      attemptAllowance: rest.attemptAllowance ?? config.pilot.attemptAllowance,
      readiness: rest.readiness ?? {},
      qualityReview: { firstFiveAnsweredReviewed: false, ...rest.qualityReview },
      isDemo: company.isDemo || (isDemo ?? false),
    })
    .returning();
  await writeAudit(db, { actorUserId: actor.id, entity: "sales_pilot", entityId: created!.id, action: "created", after: created });
  return pilotView(created!, null);
}

export async function updatePilot(db: SalesDb, actor: SalesActor, id: number, input: UpdatePilotInput) {
  const { pilot } = await loadEditable(db, actor, id);
  if (FINAL_STATUSES.includes(pilot.status as PilotStatus)) {
    const blocked = Object.keys(input).filter((k) => !POST_FINAL_EDITABLE.has(k));
    if (blocked.length) throw new SalesError(400, `A ${pilot.status} pilot only allows report and review edits (blocked: ${blocked.join(", ")})`);
  }
  if (input.attemptAllowance !== undefined && input.attemptAllowance !== pilot.attemptAllowance && !isFounder(actor)) {
    throw forbidden("Only a founder can change the attempt allowance");
  }
  if (input.ownerId != null) await assertAssignableOwner(db, input.ownerId);
  if (input.followupOwnerId != null) await assertAssignableOwner(db, input.followupOwnerId);
  const patch = pilotValues(input);
  if (input.readiness) patch.readiness = { ...asRecord(pilot.readiness), ...input.readiness };
  if (input.qualityReview) patch.qualityReview = { ...asRecord(pilot.qualityReview), ...input.qualityReview };
  const [updated] = await db
    .update(salesPilotsTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(salesPilotsTable.id, id))
    .returning();
  await writeAudit(db, { actorUserId: actor.id, entity: "sales_pilot", entityId: id, action: "updated", before: pilot, after: updated });
  return view(db, id);
}

export function setupRequirementErrors(pilot: SalesPilot): string[] {
  const errors: string[] = [];
  const filled = (s: string | null) => Boolean(s && s.trim());
  if (!filled(pilot.useCase)) errors.push("Setup requires the use case");
  if (!filled(pilot.language)) errors.push("Setup requires the calling language");
  if (!filled(pilot.qualificationCriteria)) errors.push("Setup requires qualification criteria");
  if (!filled(pilot.approvedScript)) errors.push("Setup requires an approved script");
  if (!pilot.leadCount || pilot.leadCount <= 0) errors.push("Setup requires a lead count");
  if (!pilot.contactBasisConfirmed) errors.push("Setup requires confirmation of the contact basis for the leads");
  if (!pilot.reviewAt) errors.push("Setup requires a booked review time");
  return errors;
}

async function activePilotCount(db: SalesDb, excludeId: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(salesPilotsTable)
    .where(and(eq(salesPilotsTable.isDemo, false), inArray(salesPilotsTable.status, [...ACTIVE_PILOT_STATUSES]), ne(salesPilotsTable.id, excludeId)));
  return Number(row?.n ?? 0);
}

export async function changePilotStatus(db: SalesDb, actor: SalesActor, id: number, input: PilotStatusInput, config: SalesConfig, now = new Date()) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('sales_pilot_capacity'))`);
    const { pilot, company } = await loadEditable(tx, actor, id);
    const from = pilot.status as PilotStatus;
    const to = input.to;
    if (from === to) throw new SalesError(400, `Pilot is already ${to}`);
    if (FINAL_STATUSES.includes(from)) throw new SalesError(400, `A ${from} pilot cannot change status`);
    const patch: Partial<typeof salesPilotsTable.$inferInsert> = { status: to, updatedAt: now };
    let capacityOverride: { activeBefore: number; capacity: number } | null = null;

    if (to === "Cancelled") {
      if (!input.reason?.trim()) throw new SalesError(400, "Cancelling a pilot requires a reason");
      patch.cancelledReason = input.reason.trim();
      patch.completedAt = now;
    } else {
      if (NEXT_STATUS[from] !== to) {
        throw new SalesError(400, `Pilot status can move ${from} → ${NEXT_STATUS[from] ?? "nothing"} (or Cancelled), not ${to}`);
      }
      if (to === "Setup") {
        const errors = setupRequirementErrors(pilot);
        if (errors.length) throw new SalesError(400, errors.join("; "), { errors });
        if (!pilot.isDemo) {
          const active = await activePilotCount(tx, pilot.id);
          if (active >= config.pilot.activeCapacity) {
            const reason = input.overrideReason?.trim();
            if (!isFounder(actor) || !reason) {
              throw new SalesError(
                409,
                isFounder(actor)
                  ? `Active pilot capacity (${config.pilot.activeCapacity}) is full; give an overrideReason to start anyway`
                  : `Active pilot capacity (${config.pilot.activeCapacity}) is full; a founder must approve an override`,
                { code: "capacity", active, capacity: config.pilot.activeCapacity },
              );
            }
            patch.capacityOverrideReason = reason;
            patch.capacityOverrideBy = actor.id;
            capacityOverride = { activeBefore: active, capacity: config.pilot.activeCapacity };
          }
        }
        if (!pilot.onboardingStartedAt) patch.onboardingStartedAt = now;
      }
      if (to === "Calling" && !pilot.campaignStartedAt) patch.campaignStartedAt = now;
      if (to === "Completed") patch.completedAt = now;
    }

    const [updated] = await tx.update(salesPilotsTable).set(patch).where(eq(salesPilotsTable.id, id)).returning();
    await writeAudit(tx, {
      actorUserId: actor.id,
      entity: "sales_pilot",
      entityId: id,
      action: "status_changed",
      before: { status: from },
      after: { status: to },
      reason: input.reason ?? null,
    });
    if (capacityOverride) {
      await writeAudit(tx, {
        actorUserId: actor.id,
        entity: "sales_pilot",
        entityId: id,
        action: "capacity_override",
        before: capacityOverride,
        after: { activeAfter: capacityOverride.activeBefore + 1 },
        reason: patch.capacityOverrideReason ?? null,
      });
    }
    if (to === "Setup" && updated!.reviewAt) {
      await upsertAutoTask(tx, {
        dedupeKey: `pilot:${id}:review`,
        title: `Pilot review — ${company.name}`,
        kind: "pilot_review",
        dueAt: updated!.reviewAt,
        ownerId: updated!.ownerId,
        companyId: company.id,
        opportunityId: updated!.opportunityId,
        pilotId: id,
        isDemo: updated!.isDemo,
        createdBy: actor.id,
      });
    }
    if (FINAL_STATUSES.includes(to)) {
      const status = to === "Completed" ? "done" : "cancelled";
      const outcome = `Pilot ${to.toLowerCase()}`;
      await closeAutoTask(tx, `pilot:${id}:review`, status, actor.id, outcome);
      await closeAutoTask(tx, `pilot:${id}:extension_review`, status, actor.id, outcome);
    }
    return pilotView(updated!, await latestSnapshot(tx, id));
  });
}

export async function extendPilot(db: SalesDb, actor: SalesActor, id: number, input: PilotExtensionInput, config: SalesConfig) {
  if (!isFounder(actor)) throw forbidden("Only a founder can approve a pilot extension");
  return db.transaction(async (tx) => {
    const pilot = await loadPilot(tx, id);
    if (!isActiveStatus(pilot.status)) throw new SalesError(400, `Only active pilots can be extended (pilot is ${pilot.status})`);
    if (pilot.extensionAttempts != null) throw new SalesError(409, "This pilot already has its one allowed extension", { code: "extension_used" });
    const { extensionMin, extensionMax } = config.pilot;
    if (input.attempts < extensionMin || input.attempts > extensionMax) {
      throw new SalesError(400, `Extension attempts must be between ${extensionMin} and ${extensionMax}`);
    }
    const [updated] = await tx
      .update(salesPilotsTable)
      .set({
        extensionAttempts: input.attempts,
        extensionReason: input.reason.trim(),
        extensionCostLimitPaise: input.costLimitPaise,
        extensionReviewAt: input.reviewAt,
        extensionApprovedBy: actor.id,
        updatedAt: new Date(),
      })
      .where(eq(salesPilotsTable.id, id))
      .returning();
    await writeAudit(tx, {
      actorUserId: actor.id,
      entity: "sales_pilot",
      entityId: id,
      action: "extended",
      before: { attemptAllowance: pilot.attemptAllowance, extensionAttempts: null },
      after: {
        extensionAttempts: input.attempts,
        revisedAllowance: pilot.attemptAllowance + input.attempts,
        costLimitPaise: input.costLimitPaise,
        reviewAt: input.reviewAt,
      },
      reason: input.reason,
    });
    await upsertAutoTask(tx, {
      dedupeKey: `pilot:${id}:extension_review`,
      title: "Pilot extension review",
      kind: "pilot_review",
      dueAt: input.reviewAt,
      ownerId: updated!.ownerId,
      companyId: updated!.companyId,
      opportunityId: updated!.opportunityId,
      pilotId: id,
      isDemo: updated!.isDemo,
      createdBy: actor.id,
    });
    return pilotView(updated!, await latestSnapshot(tx, id));
  });
}

type SnapshotValues = SnapshotMetrics;

function snapshotValues(input: Omit<SnapshotInput, "snapshotKey" | "asOf">): SnapshotValues {
  return {
    attempts: input.attempts,
    distinctRecords: input.distinctRecords,
    answered: input.answered,
    meaningful: input.meaningful,
    qualifiedPeople: input.qualifiedPeople,
    acceptedOutcomes: input.acceptedOutcomes,
    callbackRequests: input.callbackRequests,
    confirmedAppointments: input.confirmedAppointments,
    connectedMinutes: input.connectedMinutes ?? 0,
    costPaise: input.costPaise ?? 0,
  };
}

function snapshotDiff(before: SalesPilotSnapshot, asOf: Date, values: SnapshotValues): Record<string, { before: unknown; after: unknown }> {
  const diff: Record<string, { before: unknown; after: unknown }> = {};
  for (const key of SNAPSHOT_METRIC_KEYS) {
    if (before[key] !== values[key]) diff[key] = { before: before[key], after: values[key] };
  }
  if (before.asOf.getTime() !== asOf.getTime()) diff["asOf"] = { before: before.asOf, after: asOf };
  return diff;
}

async function upsertSnapshot(
  db: SalesDb,
  actor: SalesActor,
  pilotId: number,
  snapshotKey: string,
  asOf: Date,
  values: SnapshotValues,
  source: string,
): Promise<{ result: "created" | "corrected" | "unchanged"; snapshot: SalesPilotSnapshot }> {
  const [existing] = await db
    .select()
    .from(salesPilotSnapshotsTable)
    .where(and(eq(salesPilotSnapshotsTable.pilotId, pilotId), eq(salesPilotSnapshotsTable.snapshotKey, snapshotKey)));
  if (!existing) {
    const [created] = await db
      .insert(salesPilotSnapshotsTable)
      .values({ pilotId, snapshotKey, asOf, source, ...values, createdBy: actorRef(actor) })
      .returning();
    return { result: "created", snapshot: created! };
  }
  const diff = snapshotDiff(existing, asOf, values);
  if (!Object.keys(diff).length) return { result: "unchanged", snapshot: existing };
  const [updated] = await db
    .update(salesPilotSnapshotsTable)
    .set({ asOf, source, ...values, updatedAt: new Date() })
    .where(eq(salesPilotSnapshotsTable.id, existing.id))
    .returning();
  await writeAudit(db, {
    actorUserId: actorRef(actor),
    entity: "sales_pilot_snapshot",
    entityId: existing.id,
    action: "corrected",
    before: Object.fromEntries(Object.entries(diff).map(([k, v]) => [k, v.before])),
    after: Object.fromEntries(Object.entries(diff).map(([k, v]) => [k, v.after])),
    reason: `${source} snapshot ${snapshotKey} for pilot ${pilotId}`,
  });
  return { result: "corrected", snapshot: updated! };
}

export async function addSnapshot(db: SalesDb, actor: SalesActor, id: number, input: SnapshotInput) {
  return db.transaction(async (tx) => {
    await loadEditable(tx, actor, id);
    const values = snapshotValues(input);
    const errors = snapshotConsistencyErrors(values);
    if (errors.length) throw new SalesError(400, errors.join("; "), { errors });
    const key = input.snapshotKey?.trim() || `manual:${input.asOf.toISOString()}`;
    const { result, snapshot } = await upsertSnapshot(tx, actor, id, key, input.asOf, values, "manual");
    return { result, snapshot, pilot: await view(tx, id) };
  });
}

export async function importSnapshots(db: SalesDb, actor: SalesActor, id: number, filename: string, rows: Array<Record<string, unknown>>) {
  return db.transaction(async (tx) => {
    await loadEditable(tx, actor, id);
    const outcome = { created: 0, corrected: 0, unchanged: 0, rejected: [] as Array<{ row: number; reason: string }> };
    for (const [i, raw] of rows.entries()) {
      const rowNo = i + 1;
      const parsed = snapshotImportRowSchema.safeParse(raw);
      if (!parsed.success) {
        const reason = parsed.error.issues.map((e) => `${e.path.join(".") || "row"}: ${e.message}`).join("; ");
        outcome.rejected.push({ row: rowNo, reason });
        continue;
      }
      const r = parsed.data;
      const values = snapshotValues({ ...r, costPaise: r.costRupees != null ? Math.round(r.costRupees * 100) : r.costPaise });
      const errors = snapshotConsistencyErrors(values);
      if (errors.length) {
        outcome.rejected.push({ row: rowNo, reason: errors.join("; ") });
        continue;
      }
      const key = r.snapshotKey?.trim() || `import:${r.asOf.toISOString()}`;
      const { result } = await upsertSnapshot(tx, actor, id, key, r.asOf, values, "csv");
      outcome[result]++;
    }
    const summary = { pilotId: id, rows: rows.length, ...outcome };
    const [imp] = await tx
      .insert(salesImportsTable)
      .values({ kind: "pilot_snapshots", filename, createdBy: actorRef(actor), summary })
      .returning();
    return { importId: imp!.id, ...summary, pilot: await view(tx, id) };
  });
}

const INSUFFICIENT = "insufficient data";

export async function pilotReport(db: SalesDb, id: number) {
  const pilot = await loadPilot(db, id);
  const company = await loadCompany(db, pilot.companyId);
  const snap = await latestSnapshot(db, id);
  const metric = (key: keyof SnapshotValues) =>
    snap ? { value: snap[key], insufficientData: false } : { value: null, insufficientData: true, display: INSUFFICIENT };
  const rates = Object.fromEntries(
    Object.entries(pilotRates(snap)).map(([k, r]) => [k, r.value == null ? { ...r, insufficientData: true, display: INSUFFICIENT } : { ...r, insufficientData: false }]),
  );
  const allowance = pilotAllowance(pilot, snap?.attempts ?? null);
  const links = Array.isArray(pilot.recordingLinks) ? (pilot.recordingLinks as Array<{ url?: unknown; label?: unknown; authorized?: unknown }>) : [];
  return {
    title: `Pilot report — ${company.name}`,
    generatedAt: new Date(),
    company: { id: company.id, name: company.name, city: company.city, sector: company.sector },
    pilot: {
      id: pilot.id,
      status: pilot.status,
      useCase: pilot.useCase,
      language: pilot.language,
      qualificationCriteria: pilot.qualificationCriteria,
      leadCount: pilot.leadCount,
      onboardingStartedAt: pilot.onboardingStartedAt,
      campaignStartedAt: pilot.campaignStartedAt,
      windowStart: pilot.windowStart,
      windowEnd: pilot.windowEnd,
      reviewAt: pilot.reviewAt,
      completedAt: pilot.completedAt,
    },
    dataAsOf: snap?.asOf ?? null,
    hasData: snap != null,
    metrics: {
      attempts: metric("attempts"),
      distinctRecords: metric("distinctRecords"),
      answered: metric("answered"),
      meaningfulConversations: metric("meaningful"),
      qualifiedPeople: metric("qualifiedPeople"),
      acceptedOutcomes: metric("acceptedOutcomes"),
      callbackRequests: metric("callbackRequests"),
      confirmedAppointments: metric("confirmedAppointments"),
      connectedMinutes: metric("connectedMinutes"),
    },
    rates,
    allowance: {
      baseAllowance: allowance.baseAllowance,
      extensionAttempts: allowance.extensionAttempts,
      revisedAllowance: allowance.revisedAllowance,
      attemptsUsed: allowance.attemptsUsed,
      overAllowance: allowance.overAllowance,
      overBy: allowance.overBy,
      note: allowance.note,
    },
    extension: pilot.extensionAttempts != null ? { attempts: pilot.extensionAttempts, reviewAt: pilot.extensionReviewAt } : null,
    buyerFeedback: pilot.buyerFeedback,
    acceptedOutcomes: pilot.acceptedOutcomesNote,
    proposedNextStep: pilot.proposedNextStep,
    notes: pilot.customerReportNotes,
    recordingLinks: links
      .filter((l) => l.authorized === true && typeof l.url === "string")
      .map((l) => ({ url: l.url as string, label: typeof l.label === "string" ? l.label : null })),
    rules: {
      callbacksAndAppointments: "Callback requests and confirmed appointments are reported separately and never added together.",
      rates: "Each rate shows its numerator and denominator; a rate with a zero denominator is shown as insufficient data.",
    },
  };
}
