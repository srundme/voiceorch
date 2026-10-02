import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { salesCompaniesTable, salesContactsTable, salesWebhookEventsTable } from "@workspace/db/schema";
import { contactValues, createCompany, createFirstResponseTask, findExactDuplicate, loadCompany, recordTouchpoint } from "./company-service.js";
import { SalesError, SYSTEM_ACTOR, writeAudit, type SalesDb } from "./db.js";
import { companyDomainFromEmail, normalizeDomain, normalizeEmail, normalizePhone } from "./normalize.js";
import type { WebhookLeadInput } from "./schemas.js";
import type { SalesConfig } from "./settings-schema.js";

export const SIGNATURE_HEADER = "x-snapserve-signature";
export const EVENT_ID_HEADER = "x-event-id";

export function signPayload(rawBody: Buffer | string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

export function verifySignature(rawBody: Buffer | undefined, header: string | undefined, secret: string): boolean {
  if (!rawBody || !header) return false;
  const expected = Buffer.from(signPayload(rawBody, secret));
  const given = Buffer.from(header.trim());
  return expected.length === given.length && timingSafeEqual(expected, given);
}

function consentEvidence(consent: WebhookLeadInput["consent"]): string | null {
  if (!consent) return null;
  return `${consent.method} at ${consent.capturedAt.toISOString()}: ${consent.text}`;
}

export async function ingestLeadWebhook(db: SalesDb, eventId: string, input: WebhookLeadInput, rawPayload: unknown, config: SalesConfig) {
  if (!config.sources.includes(input.source)) {
    throw new SalesError(400, `Unknown source "${input.source}"`, { allowed: config.sources });
  }
  return db.transaction(async (tx) => {
    const [event] = await tx
      .insert(salesWebhookEventsTable)
      .values({ eventId, source: input.source, payload: rawPayload as object })
      .onConflictDoNothing({ target: salesWebhookEventsTable.eventId })
      .returning();
    if (!event) {
      const [existing] = await tx.select().from(salesWebhookEventsTable).where(eq(salesWebhookEventsTable.eventId, eventId));
      return { status: 200, body: { duplicate: true, eventId, companyId: existing?.companyId ?? null } };
    }

    const phone = normalizePhone(input.contact.phone);
    const email = normalizeEmail(input.contact.email);
    const domain = normalizeDomain(input.company.website) ?? companyDomainFromEmail(email);
    const match = await findExactDuplicate(tx, { domain, phones: phone ? [phone] : [], emails: email ? [email] : [], isDemo: false });
    const sector = input.company.sector && config.sectors.includes(input.company.sector) ? input.company.sector : null;

    let companyId: number;
    let created: boolean;
    if (match) {
      const company = await loadCompany(tx, match.companyId);
      const contacts = await tx.select().from(salesContactsTable).where(eq(salesContactsTable.companyId, company.id));
      const known = contacts.some((c) => (phone && c.phoneNormalized === phone) || (email && c.emailNormalized === email));
      if (!known && (phone || email)) {
        await tx.insert(salesContactsTable).values({ ...contactValues({ name: input.contact.name ?? "", phone: input.contact.phone, email: input.contact.email }), companyId: company.id });
      }
      const evidence = consentEvidence(input.consent);
      if (evidence && !company.contactPermissionEvidence) {
        await tx.update(salesCompaniesTable).set({ contactPermissionEvidence: evidence, updatedAt: new Date() }).where(eq(salesCompaniesTable.id, company.id));
      }
      await createFirstResponseTask(tx, SYSTEM_ACTOR, company, config, {
        dedupeKey: `company:${company.id}:first_response:${eventId}`,
        enquiredAt: input.enquiredAt,
      });
      await recordTouchpoint(tx, {
        companyId: company.id,
        kind: "webhook",
        source: input.source,
        campaign: input.campaign ?? null,
        occurredAt: input.enquiredAt ?? new Date(),
        eventId,
        permissionEvidence: evidence,
        details: { matchedOn: match.matchedOn, contact: input.contact.name ?? null },
        isDemo: company.isDemo,
        createdBy: null,
      });
      await writeAudit(tx, {
        actorUserId: null,
        entity: "sales_company",
        entityId: company.id,
        action: "repeat_enquiry",
        after: { eventId, source: input.source, campaign: input.campaign ?? null, matchedOn: match.matchedOn },
      });
      companyId = company.id;
      created = false;
    } else {
      const result = await createCompany(tx, SYSTEM_ACTOR, {
        name: input.company.name,
        website: input.company.website,
        city: input.company.city,
        sector,
        source: input.source,
        sourceCampaign: input.campaign,
        originalEnquiryAt: input.enquiredAt,
        contactPermissionEvidence: consentEvidence(input.consent),
        inbound: true,
        contacts: phone || email || input.contact.name
          ? [{ name: input.contact.name ?? "", phone: input.contact.phone, email: input.contact.email }]
          : [],
      }, config);
      companyId = result.company.id;
      created = true;
    }
    await tx
      .update(salesWebhookEventsTable)
      .set({ status: created ? "created" : "matched", companyId })
      .where(eq(salesWebhookEventsTable.id, event.id));
    return { status: 201, body: { duplicate: false, eventId, companyId, created } };
  });
}
