import { eq } from "drizzle-orm";
import { salesCompaniesTable, salesContactsTable, salesImportsTable } from "@workspace/db/schema";
import {
  blank,
  contactValues,
  createCompany,
  findExactDuplicate,
  findFuzzyNameMatch,
  loadCompany,
  recordTouchpoint,
  type DuplicateMatch,
} from "./company-service.js";
import { actorRef, writeAudit, type SalesActor, type SalesDb } from "./db.js";
import { companyDomainFromEmail, normalizeCompanyName, normalizeDomain, normalizeEmail, normalizePhone } from "./normalize.js";
import { leadImportRowSchema } from "./schemas.js";
import type { SalesConfig } from "./settings-schema.js";

export type LeadDecision = "create" | "update" | "skip" | "review" | "reject";

interface LeadRow {
  name: string;
  website: string | null;
  city: string | null;
  sector: string | null;
  source: string | null;
  campaign: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  enquiredAt?: Date;
}

export interface LeadPlanRow {
  row: number;
  decision: LeadDecision;
  reason: string;
  name: string | null;
  matchedCompanyId: number | null;
  matchedOn: DuplicateMatch["matchedOn"] | "name" | "file" | null;
  updates: string[];
  data: LeadRow | null;
}

function keysOf(r: { domain: string | null; phone: string | null; email: string | null }): string[] {
  return [r.domain && `d:${r.domain}`, r.phone && `p:${r.phone}`, r.email && `e:${r.email}`].filter((k): k is string => Boolean(k));
}

async function updatesFor(db: SalesDb, companyId: number, row: LeadRow, phone: string | null, email: string | null): Promise<string[]> {
  const company = await loadCompany(db, companyId);
  const updates: string[] = [];
  if (!company.website && row.website) updates.push("website");
  if (!company.city && row.city) updates.push("city");
  if (!company.sector && row.sector) updates.push("sector");
  if (phone || email) {
    const contacts = await db.select().from(salesContactsTable).where(eq(salesContactsTable.companyId, companyId));
    const knownPhone = !phone || contacts.some((c) => c.phoneNormalized === phone);
    const knownEmail = !email || contacts.some((c) => c.emailNormalized === email);
    if (!knownPhone || !knownEmail) updates.push("contact");
  }
  return updates;
}

export async function planLeadImport(
  db: SalesDb,
  rows: Array<Record<string, unknown>>,
  config: SalesConfig,
  overrides: Record<string, "create" | "skip"> = {},
): Promise<LeadPlanRow[]> {
  const plan: LeadPlanRow[] = [];
  const seen = new Map<string, number>();
  for (const [i, raw] of rows.entries()) {
    const rowNo = i + 1;
    const base = { row: rowNo, matchedCompanyId: null, matchedOn: null, updates: [] as string[] };
    const parsed = leadImportRowSchema.safeParse(raw);
    if (!parsed.success) {
      const reason = parsed.error.issues.map((e) => `${e.path.join(".") || "row"}: ${e.message}`).join("; ");
      plan.push({ ...base, decision: "reject", reason, name: null, data: null });
      continue;
    }
    const p = parsed.data;
    const row: LeadRow = {
      name: p.name.trim(),
      website: blank(p.website),
      city: blank(p.city),
      sector: blank(p.sector),
      source: blank(p.source),
      campaign: blank(p.campaign),
      contactName: blank(p.contactName),
      phone: blank(p.phone),
      email: blank(p.email),
      enquiredAt: p.enquiredAt,
    };
    const reject = (reason: string) => plan.push({ ...base, decision: "reject", reason, name: row.name || null, data: null });
    if (!row.name) { reject("Company name is required"); continue; }
    if (row.source && !config.sources.includes(row.source)) { reject(`Unknown source "${row.source}"`); continue; }
    if (row.sector && !config.sectors.includes(row.sector)) { reject(`Unknown sector "${row.sector}"`); continue; }
    const phone = normalizePhone(row.phone);
    const email = normalizeEmail(row.email);
    if (row.phone && !phone) { reject("Phone number is not valid"); continue; }
    if (row.email && !email) { reject("Email address is not valid"); continue; }
    const domain = normalizeDomain(row.website) ?? companyDomainFromEmail(email);
    if (!phone && !email && !domain) { reject("Needs a phone, email or website so duplicates can be detected"); continue; }

    const keys = keysOf({ domain, phone, email });
    const earlier = keys.map((k) => seen.get(k)).find((n) => n != null);
    if (earlier != null) {
      plan.push({ ...base, decision: "skip", reason: `Same company as row ${earlier} in this file`, name: row.name, matchedOn: "file", data: row });
      continue;
    }
    keys.forEach((k) => seen.set(k, rowNo));

    const exact = await findExactDuplicate(db, { domain, phones: phone ? [phone] : [], emails: email ? [email] : [], isDemo: false });
    if (exact) {
      const updates = await updatesFor(db, exact.companyId, row, phone, email);
      plan.push({
        ...base,
        decision: updates.length ? "update" : "skip",
        reason: updates.length ? `Matches company #${exact.companyId} by ${exact.matchedOn}; fills ${updates.join(", ")}` : `Already exists as company #${exact.companyId} (${exact.matchedOn})`,
        name: row.name,
        matchedCompanyId: exact.companyId,
        matchedOn: exact.matchedOn,
        updates,
        data: row,
      });
      continue;
    }
    const fuzzyId = await findFuzzyNameMatch(db, normalizeCompanyName(row.name), false);
    if (fuzzyId != null) {
      const override = overrides[String(rowNo)];
      plan.push({
        ...base,
        decision: override ?? "review",
        reason: override
          ? `Similar name to company #${fuzzyId}; ${override === "create" ? "created as a separate company by reviewer" : "skipped by reviewer"}`
          : `Similar name to company #${fuzzyId} but no shared phone, email or domain; not merged — choose create or skip`,
        name: row.name,
        matchedCompanyId: fuzzyId,
        matchedOn: "name",
        data: row,
      });
      continue;
    }
    plan.push({ ...base, decision: "create", reason: "New company", name: row.name, data: row });
  }
  return plan;
}

function tally(plan: LeadPlanRow[]) {
  const counts: Record<LeadDecision, number> = { create: 0, update: 0, skip: 0, review: 0, reject: 0 };
  for (const r of plan) counts[r.decision]++;
  return counts;
}

export async function previewLeadImport(db: SalesDb, rows: Array<Record<string, unknown>>, config: SalesConfig, overrides?: Record<string, "create" | "skip">) {
  const plan = await planLeadImport(db, rows, config, overrides);
  return { counts: tally(plan), rows: plan.map(({ data: _data, ...r }) => r) };
}

export async function commitLeadImport(
  db: SalesDb,
  actor: SalesActor,
  filename: string,
  rows: Array<Record<string, unknown>>,
  config: SalesConfig,
  overrides?: Record<string, "create" | "skip">,
) {
  return db.transaction(async (tx) => {
    const plan = await planLeadImport(tx, rows, config, overrides);
    const results: Array<{ row: number; decision: LeadDecision; companyId: number | null; reason: string }> = [];
    for (const r of plan) {
      const d = r.data;
      if (r.decision === "create" && d) {
        const created = await createCompany(tx, actor, {
          name: d.name,
          website: d.website,
          city: d.city,
          sector: d.sector,
          source: d.source,
          sourceCampaign: d.campaign,
          originalEnquiryAt: d.enquiredAt,
          contacts: d.phone || d.email || d.contactName ? [{ name: d.contactName ?? "", phone: d.phone, email: d.email }] : [],
        }, config);
        results.push({ row: r.row, decision: "create", companyId: created.company.id, reason: r.reason });
      } else if (r.decision === "update" && d && r.matchedCompanyId) {
        const company = await loadCompany(tx, r.matchedCompanyId);
        const patch: Partial<typeof salesCompaniesTable.$inferInsert> = {};
        if (r.updates.includes("website")) {
          patch.website = d.website;
          patch.domainNormalized = company.domainNormalized ?? normalizeDomain(d.website);
        }
        if (r.updates.includes("city")) patch.city = d.city;
        if (r.updates.includes("sector")) patch.sector = d.sector;
        if (Object.keys(patch).length) {
          await tx.update(salesCompaniesTable).set({ ...patch, updatedAt: new Date() }).where(eq(salesCompaniesTable.id, company.id));
        }
        if (r.updates.includes("contact")) {
          await tx.insert(salesContactsTable).values({ ...contactValues({ name: d.contactName ?? "", phone: d.phone, email: d.email }), companyId: company.id });
        }
        await writeAudit(tx, {
          actorUserId: actorRef(actor),
          entity: "sales_company",
          entityId: company.id,
          action: "import_update",
          before: Object.fromEntries(Object.keys(patch).map((k) => [k, company[k as keyof typeof company] ?? null])),
          after: { ...patch, contactAdded: r.updates.includes("contact") },
          reason: `Lead import ${filename} row ${r.row}`,
        });
        results.push({ row: r.row, decision: "update", companyId: company.id, reason: r.reason });
      } else {
        results.push({ row: r.row, decision: r.decision, companyId: r.matchedCompanyId, reason: r.reason });
      }
      const repeatEnquiry = (r.decision === "update" || r.decision === "skip") && r.matchedCompanyId && d
        && (r.matchedOn === "domain" || r.matchedOn === "phone" || r.matchedOn === "email");
      if (repeatEnquiry) {
        const company = await loadCompany(tx, r.matchedCompanyId!);
        await recordTouchpoint(tx, {
          companyId: company.id,
          kind: "import",
          source: d!.source,
          campaign: d!.campaign,
          occurredAt: d!.enquiredAt ?? new Date(),
          details: { filename, row: r.row, matchedOn: r.matchedOn },
          isDemo: company.isDemo,
          createdBy: actorRef(actor),
        });
      }
    }
    const counts = tally(plan);
    const summary = { rows: rows.length, ...counts, results };
    const [imp] = await tx.insert(salesImportsTable).values({ kind: "leads", filename, createdBy: actorRef(actor), summary }).returning();
    return { importId: imp!.id, counts, results };
  });
}
