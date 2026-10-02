import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import {
  salesActivitiesTable,
  salesCompaniesTable,
  salesContactsTable,
  salesOpportunitiesTable,
  salesPaymentAdjustmentsTable,
  salesPaymentsTable,
  salesPilotSnapshotsTable,
  salesPilotsTable,
  salesProposalsTable,
  salesStageHistoryTable,
  salesSubscriptionsTable,
  salesTasksTable,
  salesTouchpointsTable,
  salesUsersTable,
  type SalesCompany,
} from "@workspace/db/schema";
import { getActiveUser } from "./auth-service.js";
import {
  actorRef,
  forbidden,
  isFounder,
  isUniqueViolation,
  notFound,
  SalesError,
  writeAudit,
  type SalesActor,
  type SalesDb,
} from "./db.js";
import { pilotAllowance, pilotRates, proposalAmounts } from "./metrics.js";
import {
  companyDomainFromEmail,
  isFuzzyNameMatch,
  normalizeCompanyName,
  normalizeDomain,
  normalizeEmail,
  normalizePhone,
} from "./normalize.js";
import type { ContactInput, CreateCompanyInput, ListCompaniesQuery, UpdateCompanyInput, UpdateContactInput } from "./schemas.js";
import { FIELD_SOURCE, isInboundSource, type SalesConfig } from "./settings-schema.js";
import { assertAssignableOwner, upsertAutoTask } from "./task-service.js";
import { addBusinessMinutes, businessMinutesBetween } from "./time.js";

export const blank = (v: string | null | undefined): string | null => (v && v.trim() ? v.trim() : null);

export const OUTBOUND_RESPONSE_TYPES = ["call", "whatsapp", "email", "visit"] as const;

export function canEditCompany(actor: SalesActor, company: Pick<SalesCompany, "ownerId">): boolean {
  return isFounder(actor) || company.ownerId === actor.id;
}

export async function loadCompany(db: SalesDb, id: number): Promise<SalesCompany> {
  const [company] = await db.select().from(salesCompaniesTable).where(eq(salesCompaniesTable.id, id));
  if (!company) throw notFound("Company");
  return company;
}

export function assertConfigured(config: SalesConfig, input: { source?: string | null; sector?: string | null }): void {
  const source = blank(input.source);
  const sector = blank(input.sector);
  if (source && !config.sources.includes(source)) throw new SalesError(400, `Unknown source "${source}"`, { allowed: config.sources });
  if (sector && !config.sectors.includes(sector)) throw new SalesError(400, `Unknown sector "${sector}"`, { allowed: config.sectors });
}

export function contactValues(input: ContactInput | UpdateContactInput) {
  const out: Partial<typeof salesContactsTable.$inferInsert> = {};
  if (input.name !== undefined) out.name = input.name ?? "";
  if (input.role !== undefined) out.role = blank(input.role);
  if (input.phone !== undefined) {
    out.phone = blank(input.phone);
    out.phoneNormalized = normalizePhone(input.phone);
  }
  if (input.email !== undefined) {
    out.email = blank(input.email);
    out.emailNormalized = normalizeEmail(input.email);
  }
  if (input.preferredChannel !== undefined) out.preferredChannel = input.preferredChannel ?? null;
  if (input.isDecisionMaker !== undefined) out.isDecisionMaker = input.isDecisionMaker;
  return out;
}

export interface DuplicateMatch {
  companyId: number;
  matchedOn: "domain" | "phone" | "email";
}

export async function findExactDuplicate(
  db: SalesDb,
  probe: { domain: string | null; phones: string[]; emails: string[]; isDemo: boolean; excludeId?: number },
): Promise<DuplicateMatch | null> {
  const notSelf = probe.excludeId ? ne(salesCompaniesTable.id, probe.excludeId) : undefined;
  if (probe.domain) {
    const [hit] = await db
      .select({ id: salesCompaniesTable.id })
      .from(salesCompaniesTable)
      .where(and(eq(salesCompaniesTable.domainNormalized, probe.domain), eq(salesCompaniesTable.isDemo, probe.isDemo), notSelf))
      .limit(1);
    if (hit) return { companyId: hit.id, matchedOn: "domain" };
  }
  for (const [field, values, matchedOn] of [
    [salesContactsTable.phoneNormalized, probe.phones, "phone"],
    [salesContactsTable.emailNormalized, probe.emails, "email"],
  ] as const) {
    if (!values.length) continue;
    const [hit] = await db
      .select({ id: salesCompaniesTable.id })
      .from(salesContactsTable)
      .innerJoin(salesCompaniesTable, eq(salesCompaniesTable.id, salesContactsTable.companyId))
      .where(and(inArray(field, values), eq(salesCompaniesTable.isDemo, probe.isDemo), notSelf))
      .orderBy(salesCompaniesTable.id)
      .limit(1);
    if (hit) return { companyId: hit.id, matchedOn };
  }
  return null;
}

export async function findFuzzyNameMatch(db: SalesDb, nameNormalized: string, isDemo: boolean): Promise<number | null> {
  if (!nameNormalized) return null;
  const candidates = await db
    .select({ id: salesCompaniesTable.id, nameNormalized: salesCompaniesTable.nameNormalized })
    .from(salesCompaniesTable)
    .where(and(
      eq(salesCompaniesTable.isDemo, isDemo),
      or(
        eq(salesCompaniesTable.nameNormalized, nameNormalized),
        sql`${salesCompaniesTable.nameNormalized} LIKE ${`${nameNormalized} %`}`,
        sql`${salesCompaniesTable.nameNormalized} LIKE ${`% ${nameNormalized}`}`,
        sql`${nameNormalized} LIKE ${salesCompaniesTable.nameNormalized} || ' %'`,
        sql`${nameNormalized} LIKE '% ' || ${salesCompaniesTable.nameNormalized}`,
      ),
    ))
    .orderBy(salesCompaniesTable.id)
    .limit(20);
  return candidates.find((c) => isFuzzyNameMatch(c.nameNormalized, nameNormalized))?.id ?? null;
}

function duplicateError(match: DuplicateMatch): SalesError {
  return new SalesError(409, "A matching company already exists", { existingCompanyId: match.companyId, matchedOn: match.matchedOn });
}

export async function nextInboundOwner(db: SalesDb, config: SalesConfig): Promise<number | null> {
  if (config.defaultInboundOwnerId && (await getActiveUser(db, config.defaultInboundOwnerId))) {
    return config.defaultInboundOwnerId;
  }
  const users = await db
    .select({ id: salesUsersTable.id })
    .from(salesUsersTable)
    .where(and(eq(salesUsersTable.status, "active"), isNotNull(salesUsersTable.passwordHash)))
    .orderBy(salesUsersTable.id);
  if (!users.length) return null;
  const [last] = await db
    .select({ ownerId: salesCompaniesTable.ownerId })
    .from(salesCompaniesTable)
    .where(and(
      eq(salesCompaniesTable.isDemo, false),
      isNotNull(salesCompaniesTable.ownerId),
      isNotNull(salesCompaniesTable.originalSource),
      ne(salesCompaniesTable.originalSource, FIELD_SOURCE),
    ))
    .orderBy(desc(salesCompaniesTable.id))
    .limit(1);
  const idx = last ? users.findIndex((u) => u.id === last.ownerId) : -1;
  return users[(idx + 1) % users.length]!.id;
}

export function firstResponseDueAt(enquiredAt: Date, config: SalesConfig): Date {
  return addBusinessMinutes(enquiredAt, config.responseTargetMinutes, config.businessHours, config.timezone);
}

export async function createFirstResponseTask(
  db: SalesDb,
  actor: SalesActor,
  company: SalesCompany,
  config: SalesConfig,
  opts: { dedupeKey?: string; enquiredAt?: Date; opportunityId?: number | null } = {},
): Promise<void> {
  await upsertAutoTask(db, {
    dedupeKey: opts.dedupeKey ?? `company:${company.id}:first_response`,
    title: `First response to ${company.name}`,
    kind: "first_response",
    dueAt: firstResponseDueAt(opts.enquiredAt ?? company.originalEnquiryAt ?? company.createdAt, config),
    ownerId: company.ownerId,
    companyId: company.id,
    opportunityId: opts.opportunityId ?? null,
    isDemo: company.isDemo,
    createdBy: actorRef(actor),
  });
}

export async function createCompany(db: SalesDb, actor: SalesActor, input: CreateCompanyInput, config: SalesConfig) {
  assertConfigured(config, input);
  const inbound = input.inbound ?? isInboundSource(blank(input.source));
  if (!isFounder(actor) && input.ownerId !== undefined && input.ownerId !== actor.id && input.ownerId !== null) {
    throw forbidden("Teammates can only create leads owned by themselves or unassigned");
  }
  const ownerId =
    input.ownerId !== undefined ? input.ownerId : inbound ? await nextInboundOwner(db, config) : actorRef(actor);
  await assertAssignableOwner(db, ownerId);

  const isDemo = input.isDemo ?? false;
  const contacts = (input.contacts ?? []).map(contactValues);
  const phones = contacts.map((c) => c.phoneNormalized).filter((v): v is string => Boolean(v));
  const emails = contacts.map((c) => c.emailNormalized).filter((v): v is string => Boolean(v));
  const domain = normalizeDomain(input.website) ?? emails.map(companyDomainFromEmail).find(Boolean) ?? null;
  const nameNormalized = normalizeCompanyName(input.name);

  const exact = await findExactDuplicate(db, { domain, phones, emails, isDemo });
  if (exact) throw duplicateError(exact);
  const fuzzyId = await findFuzzyNameMatch(db, nameNormalized, isDemo);

  const source = blank(input.source);
  const now = new Date();
  try {
    return await db.transaction(async (tx) => {
      const [company] = await tx
        .insert(salesCompaniesTable)
        .values({
          isDemo,
          name: input.name.trim(),
          nameNormalized,
          domainNormalized: domain,
          website: blank(input.website),
          sector: blank(input.sector),
          city: blank(input.city),
          area: blank(input.area),
          address: blank(input.address),
          mapLink: blank(input.mapLink),
          ownerId,
          source,
          sourceCampaign: blank(input.sourceCampaign),
          originalSource: source,
          originalSourceCampaign: blank(input.sourceCampaign),
          originalEnquiryAt: input.originalEnquiryAt ?? now,
          contactPermissionEvidence: blank(input.contactPermissionEvidence),
          priority: input.priority ?? "medium",
          callingVolume: input.callingVolume ?? null,
          currentCallingTeam: blank(input.currentCallingTeam),
          painPoint: blank(input.painPoint),
          budgetFit: input.budgetFit ?? "unknown",
          decisionMaker: blank(input.decisionMaker),
          nextAction: blank(input.nextAction),
          nextActionDueAt: input.nextActionDueAt ?? null,
          duplicateOfCompanyId: fuzzyId,
          needsDedupeReview: fuzzyId != null,
          internalNotes: blank(input.internalNotes),
          customerNotes: blank(input.customerNotes),
          isInbound: inbound,
          createdBy: actorRef(actor),
        })
        .returning();
      const c = company!;

      const savedContacts = contacts.length
        ? await tx.insert(salesContactsTable).values(contacts.map((v) => ({ ...v, companyId: c.id }))).returning()
        : [];

      let opportunity = null;
      if (input.createOpportunity !== false) {
        [opportunity] = await tx
          .insert(salesOpportunitiesTable)
          .values({ companyId: c.id, stage: "Identified", ownerId, isDemo })
          .returning();
        await tx.insert(salesStageHistoryTable).values({ opportunityId: opportunity!.id, fromStage: null, toStage: "Identified", changedBy: actorRef(actor) });
      }

      await recordTouchpoint(tx, {
        companyId: c.id,
        kind: "original",
        source: c.originalSource,
        campaign: c.originalSourceCampaign,
        occurredAt: c.originalEnquiryAt,
        permissionEvidence: c.contactPermissionEvidence,
        isDemo,
        createdBy: actorRef(actor),
      });
      if (inbound) await createFirstResponseTask(tx, actor, c, config, { opportunityId: opportunity?.id ?? null });
      if (c.nextAction) await syncCompanyNextActionTask(tx, c, actorRef(actor));

      return {
        company: c,
        inbound,
        contacts: savedContacts,
        opportunity,
        dedupe: { needsReview: fuzzyId != null, duplicateOfCompanyId: fuzzyId },
      };
    });
  } catch (err) {
    if (isUniqueViolation(err, "sales_companies_domain_uq")) {
      const again = await findExactDuplicate(db, { domain, phones: [], emails: [], isDemo });
      if (again) throw duplicateError(again);
    }
    throw err;
  }
}

export interface TouchpointInput {
  companyId: number;
  kind: "original" | "webhook" | "import" | "manual";
  source?: string | null;
  campaign?: string | null;
  occurredAt?: Date | null;
  eventId?: string | null;
  permissionEvidence?: string | null;
  details?: Record<string, unknown> | null;
  isDemo: boolean;
  createdBy: number | null;
}

export async function recordTouchpoint(db: SalesDb, input: TouchpointInput): Promise<void> {
  await db
    .insert(salesTouchpointsTable)
    .values({
      companyId: input.companyId,
      kind: input.kind,
      source: input.source ?? null,
      campaign: input.campaign ?? null,
      occurredAt: input.occurredAt ?? new Date(),
      eventId: input.eventId ?? null,
      permissionEvidence: input.permissionEvidence ?? null,
      details: input.details ?? null,
      isDemo: input.isDemo,
      createdBy: input.createdBy,
    })
    .onConflictDoNothing();
}

async function syncCompanyNextActionTask(db: SalesDb, company: SalesCompany, actorId: number | null): Promise<void> {
  await upsertAutoTask(db, {
    dedupeKey: `company:${company.id}:next_action`,
    title: company.nextAction ?? "Next action",
    kind: "follow_up",
    dueAt: company.nextActionDueAt,
    ownerId: company.ownerId,
    companyId: company.id,
    isDemo: company.isDemo,
    createdBy: actorId,
    reopenIfChanged: true,
  });
}

const likeEscape = (s: string): string => s.replace(/[\\%_]/g, (m) => `\\${m}`);

export async function listCompanies(db: SalesDb, q: ListCompaniesQuery, now = new Date()) {
  const c = salesCompaniesTable;
  const latestOpp = (column: "stage" | "id") => sql`(
    SELECT o.${sql.raw(column)} FROM ${salesOpportunitiesTable} o
    WHERE o.company_id = ${c.id}
    ORDER BY (o.stage NOT IN ('Lost', 'Live')) DESC, o.id DESC
    LIMIT 1
  )`;
  const conds: SQL[] = [eq(c.isDemo, q.demo)];
  if (q.q) {
    const pattern = `%${likeEscape(q.q)}%`;
    const digits = q.q.replace(/\D/g, "");
    const contactMatch = digits.length >= 4
      ? sql`(ct.phone_normalized LIKE ${`%${digits}%`} OR ct.email_normalized ILIKE ${pattern})`
      : sql`ct.email_normalized ILIKE ${pattern}`;
    conds.push(or(
      sql`${c.name} ILIKE ${pattern}`,
      sql`${c.area} ILIKE ${pattern}`,
      sql`EXISTS (SELECT 1 FROM ${salesContactsTable} ct WHERE ct.company_id = ${c.id} AND ${contactMatch})`,
    )!);
  }
  if (q.ownerId) conds.push(eq(c.ownerId, q.ownerId));
  if (q.unassigned) conds.push(isNull(c.ownerId));
  if (q.city) conds.push(sql`lower(${c.city}) = lower(${q.city})`);
  if (q.area) conds.push(sql`${c.area} ILIKE ${`%${likeEscape(q.area)}%`}`);
  if (q.sector) conds.push(eq(c.sector, q.sector));
  if (q.source) conds.push(eq(c.source, q.source));
  if (q.priority) conds.push(eq(c.priority, q.priority));
  if (q.needsDedupeReview) conds.push(eq(c.needsDedupeReview, true));
  if (q.overdueNextAction) conds.push(lt(c.nextActionDueAt, now));
  if (q.missingNextAction) conds.push(sql`(${c.nextAction} IS NULL OR ${c.nextAction} = '' OR ${c.nextActionDueAt} IS NULL)`);
  if (q.stage) conds.push(sql`${latestOpp("stage")} = ${q.stage}`);
  const where = and(...conds);

  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(c).where(where);
  const rows = await db
    .select({
      company: c,
      ownerName: salesUsersTable.name,
      stage: sql<string | null>`${latestOpp("stage")}`,
      opportunityId: sql<number | null>`${latestOpp("id")}`,
    })
    .from(c)
    .leftJoin(salesUsersTable, eq(salesUsersTable.id, c.ownerId))
    .where(where)
    .orderBy(sql`${c.nextActionDueAt} ASC NULLS LAST`, desc(c.id))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);

  return {
    items: rows.map((r) => ({
      ...r.company,
      ownerName: r.ownerName,
      stage: r.stage,
      opportunityId: r.opportunityId == null ? null : Number(r.opportunityId),
      nextActionOverdue: r.company.nextActionDueAt != null && r.company.nextActionDueAt.getTime() < now.getTime(),
    })),
    total: Number(total),
    page: q.page,
    pageSize: q.pageSize,
  };
}

export async function getCompanyDetail(db: SalesDb, id: number, config: SalesConfig) {
  const company = await loadCompany(db, id);
  const [owner] = company.ownerId
    ? await db.select({ id: salesUsersTable.id, name: salesUsersTable.name }).from(salesUsersTable).where(eq(salesUsersTable.id, company.ownerId))
    : [];
  const contacts = await db.select().from(salesContactsTable).where(eq(salesContactsTable.companyId, id)).orderBy(salesContactsTable.id);
  const opportunities = await db
    .select()
    .from(salesOpportunitiesTable)
    .where(eq(salesOpportunitiesTable.companyId, id))
    .orderBy(desc(salesOpportunitiesTable.id));
  const opportunity = opportunities.find((o) => o.stage !== "Lost" && o.stage !== "Live") ?? opportunities[0] ?? null;
  const oppIds = opportunities.map((o) => o.id);
  const stageHistory = oppIds.length
    ? await db
        .select()
        .from(salesStageHistoryTable)
        .where(inArray(salesStageHistoryTable.opportunityId, oppIds))
        .orderBy(desc(salesStageHistoryTable.changedAt), desc(salesStageHistoryTable.id))
    : [];
  const activities = await db
    .select()
    .from(salesActivitiesTable)
    .where(eq(salesActivitiesTable.companyId, id))
    .orderBy(sql`coalesce(${salesActivitiesTable.occurredAt}, ${salesActivitiesTable.scheduledAt}, ${salesActivitiesTable.createdAt}) DESC`);
  const tasks = await db
    .select()
    .from(salesTasksTable)
    .where(eq(salesTasksTable.companyId, id))
    .orderBy(sql`(${salesTasksTable.status} = 'open') DESC`, sql`${salesTasksTable.dueAt} ASC NULLS LAST`);

  const pilotRows = await db.select().from(salesPilotsTable).where(eq(salesPilotsTable.companyId, id)).orderBy(desc(salesPilotsTable.id));
  const snapshots = pilotRows.length
    ? await db
        .select()
        .from(salesPilotSnapshotsTable)
        .where(inArray(salesPilotSnapshotsTable.pilotId, pilotRows.map((p) => p.id)))
        .orderBy(desc(salesPilotSnapshotsTable.asOf), desc(salesPilotSnapshotsTable.id))
    : [];
  const pilots = pilotRows.map((p) => {
    const latestSnapshot = snapshots.find((s) => s.pilotId === p.id) ?? null;
    return {
      ...p,
      latestSnapshot,
      allowance: pilotAllowance(p, latestSnapshot?.attempts ?? null),
      rates: pilotRates(latestSnapshot),
    };
  });

  const proposals = (
    await db.select().from(salesProposalsTable).where(eq(salesProposalsTable.companyId, id)).orderBy(desc(salesProposalsTable.id))
  ).map((p) => ({ ...p, amounts: proposalAmounts(p) }));

  const paymentRows = await db.select().from(salesPaymentsTable).where(eq(salesPaymentsTable.companyId, id)).orderBy(desc(salesPaymentsTable.receivedAt), desc(salesPaymentsTable.id));
  const adjustments = paymentRows.length
    ? await db
        .select()
        .from(salesPaymentAdjustmentsTable)
        .where(inArray(salesPaymentAdjustmentsTable.paymentId, paymentRows.map((p) => p.id)))
        .orderBy(asc(salesPaymentAdjustmentsTable.id))
    : [];
  const payments = paymentRows.map((p) => {
    const own = adjustments.filter((a) => a.paymentId === p.id);
    return {
      ...p,
      adjustments: own,
      netFeePaise: own.reduce((n, a) => n + a.feeDeltaPaise, p.feePaise),
      netTaxPaise: own.reduce((n, a) => n + a.taxDeltaPaise, p.taxPaise),
    };
  });

  const subscriptions = await db
    .select()
    .from(salesSubscriptionsTable)
    .where(eq(salesSubscriptionsTable.companyId, id))
    .orderBy(desc(salesSubscriptionsTable.id));
  const subscription = subscriptions.find((s) => s.status !== "cancelled") ?? subscriptions[0] ?? null;
  const touchpoints = await db
    .select()
    .from(salesTouchpointsTable)
    .where(eq(salesTouchpointsTable.companyId, id))
    .orderBy(desc(salesTouchpointsTable.occurredAt), desc(salesTouchpointsTable.id));
  const [duplicateOf] = company.duplicateOfCompanyId
    ? await db
        .select({ id: salesCompaniesTable.id, name: salesCompaniesTable.name })
        .from(salesCompaniesTable)
        .where(eq(salesCompaniesTable.id, company.duplicateOfCompanyId))
    : [];

  return {
    company,
    owner: owner ?? null,
    duplicateOf: duplicateOf ?? null,
    contacts,
    opportunity,
    opportunities,
    stageHistory,
    activities,
    tasks,
    touchpoints,
    pilots,
    proposals,
    payments,
    subscription,
    subscriptions,
    firstResponse: await firstResponseMetrics(db, company, config),
    notes: { internal: company.internalNotes, customerFacing: company.customerNotes },
  };
}

export async function firstResponseMetrics(db: SalesDb, company: SalesCompany, config: SalesConfig, now = new Date()) {
  if (!company.isInbound) return null;
  const enquiredAt = company.originalEnquiryAt ?? company.createdAt;
  const [first] = await db
    .select({ id: salesActivitiesTable.id, type: salesActivitiesTable.type, occurredAt: salesActivitiesTable.occurredAt })
    .from(salesActivitiesTable)
    .where(and(
      eq(salesActivitiesTable.companyId, company.id),
      eq(salesActivitiesTable.status, "completed"),
      inArray(salesActivitiesTable.type, [...OUTBOUND_RESPONSE_TYPES]),
      gte(salesActivitiesTable.occurredAt, enquiredAt),
    ))
    .orderBy(asc(salesActivitiesTable.occurredAt), asc(salesActivitiesTable.id))
    .limit(1);
  const respondedAt = first?.occurredAt ?? null;
  const businessMinutes = businessMinutesBetween(enquiredAt, respondedAt ?? now, config.businessHours, config.timezone);
  return {
    enquiredAt,
    dueAt: firstResponseDueAt(enquiredAt, config),
    respondedAt,
    responseActivityId: first?.id ?? null,
    responseType: first?.type ?? null,
    businessMinutes: respondedAt ? businessMinutes : null,
    elapsedBusinessMinutes: respondedAt ? null : businessMinutes,
    targetMinutes: config.responseTargetMinutes,
    withinTarget: respondedAt ? businessMinutes <= config.responseTargetMinutes : null,
    overdue: !respondedAt && businessMinutes > config.responseTargetMinutes,
    rule: "Business minutes from the enquiry to the first completed outbound call, WhatsApp, email or visit, counted only inside configured business hours.",
  };
}

export async function updateCompany(db: SalesDb, actor: SalesActor, id: number, input: UpdateCompanyInput, config: SalesConfig) {
  const company = await loadCompany(db, id);
  if (!canEditCompany(actor, company)) throw forbidden("You can only edit companies you own");
  assertConfigured(config, input);

  const patch: Partial<typeof salesCompaniesTable.$inferInsert> = { updatedAt: new Date() };
  for (const [key, value] of Object.entries(input) as Array<[keyof UpdateCompanyInput, unknown]>) {
    (patch as Record<string, unknown>)[key] = typeof value === "string" ? blank(value) : value;
  }
  if (input.name !== undefined) {
    patch.name = input.name.trim();
    patch.nameNormalized = normalizeCompanyName(input.name);
  }
  if (input.website !== undefined) {
    const domain = normalizeDomain(input.website);
    if (domain && domain !== company.domainNormalized) {
      const dup = await findExactDuplicate(db, { domain, phones: [], emails: [], isDemo: company.isDemo, excludeId: id });
      if (dup) throw duplicateError(dup);
    }
    patch.domainNormalized = domain ?? company.domainNormalized;
  }

  try {
    return await db.transaction(async (tx) => {
      const [updated] = await tx.update(salesCompaniesTable).set(patch).where(eq(salesCompaniesTable.id, id)).returning();
      if ((input.nextAction !== undefined || input.nextActionDueAt !== undefined) && updated!.nextAction) {
        await syncCompanyNextActionTask(tx, updated!, actor.id);
      }
      return updated!;
    });
  } catch (err) {
    if (isUniqueViolation(err, "sales_companies_domain_uq")) throw new SalesError(409, "Another company already uses this website domain");
    throw err;
  }
}

export async function assignCompanyOwner(db: SalesDb, actor: SalesActor, id: number, ownerId: number | null) {
  const company = await loadCompany(db, id);
  if (!isFounder(actor)) {
    if (company.ownerId != null || ownerId !== actor.id) {
      throw forbidden("Teammates can only assign unowned leads to themselves");
    }
  }
  await assertAssignableOwner(db, ownerId);
  return db.transaction(async (tx) => {
    const now = new Date();
    const [updated] = await tx
      .update(salesCompaniesTable)
      .set({ ownerId, updatedAt: now })
      .where(eq(salesCompaniesTable.id, id))
      .returning();
    await tx
      .update(salesOpportunitiesTable)
      .set({ ownerId, updatedAt: now })
      .where(and(eq(salesOpportunitiesTable.companyId, id), sql`${salesOpportunitiesTable.stage} NOT IN ('Lost', 'Live')`));
    await tx
      .update(salesTasksTable)
      .set({ ownerId, updatedAt: now })
      .where(and(
        eq(salesTasksTable.companyId, id),
        eq(salesTasksTable.status, "open"),
        company.ownerId == null ? isNull(salesTasksTable.ownerId) : eq(salesTasksTable.ownerId, company.ownerId),
      ));
    await writeAudit(tx, {
      actorUserId: actor.id,
      entity: "sales_company",
      entityId: id,
      action: "owner_changed",
      before: { ownerId: company.ownerId },
      after: { ownerId },
    });
    return updated!;
  });
}

export async function addContact(db: SalesDb, actor: SalesActor, companyId: number, input: ContactInput) {
  const company = await loadCompany(db, companyId);
  if (!canEditCompany(actor, company)) throw forbidden("You can only edit companies you own");
  const [contact] = await db.insert(salesContactsTable).values({ ...contactValues(input), companyId }).returning();
  return contact!;
}

async function loadContactForEdit(db: SalesDb, actor: SalesActor, contactId: number) {
  const [row] = await db
    .select({ contact: salesContactsTable, ownerId: salesCompaniesTable.ownerId })
    .from(salesContactsTable)
    .innerJoin(salesCompaniesTable, eq(salesCompaniesTable.id, salesContactsTable.companyId))
    .where(eq(salesContactsTable.id, contactId));
  if (!row) throw notFound("Contact");
  if (!canEditCompany(actor, { ownerId: row.ownerId })) throw forbidden("You can only edit companies you own");
  return row.contact;
}

export async function updateContact(db: SalesDb, actor: SalesActor, contactId: number, input: UpdateContactInput) {
  await loadContactForEdit(db, actor, contactId);
  const values = contactValues(input);
  if (Object.keys(values).length === 0) throw new SalesError(400, "Nothing to update");
  const [contact] = await db.update(salesContactsTable).set(values).where(eq(salesContactsTable.id, contactId)).returning();
  return contact!;
}

export async function deleteContact(db: SalesDb, actor: SalesActor, contactId: number) {
  await loadContactForEdit(db, actor, contactId);
  await db.delete(salesContactsTable).where(eq(salesContactsTable.id, contactId));
}

export async function createOpportunity(db: SalesDb, actor: SalesActor, companyId: number) {
  const company = await loadCompany(db, companyId);
  if (!canEditCompany(actor, company)) throw forbidden("You can only edit companies you own");
  try {
    return await db.transaction(async (tx) => {
      const [opp] = await tx
        .insert(salesOpportunitiesTable)
        .values({ companyId, stage: "Identified", ownerId: company.ownerId, isDemo: company.isDemo })
        .returning();
      await tx.insert(salesStageHistoryTable).values({ opportunityId: opp!.id, fromStage: null, toStage: "Identified", changedBy: actor.id });
      return opp!;
    });
  } catch (err) {
    if (isUniqueViolation(err, "sales_opportunities_open_uq")) throw new SalesError(409, "This company already has an open opportunity");
    throw err;
  }
}
