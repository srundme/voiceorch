/**
 * White-label partner transactional mail.
 *
 * Client invites / credentials / password resets should leave as
 * Acme <noreply@acme.com>, not SnapServe. Brevo will rewrite From unless the
 * partner domain is authenticated (Brevo code + DKIM + DMARC) on our account.
 */
import { and, eq } from "drizzle-orm";
import { db, partnersTable, usersTable, type Partner } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { sendBrevoEmail, type BrevoEmailMeta } from "./brevo.js";
import { subdomainHostForSlug } from "./partner-domains-normalize.js";
import type { EmailBrand } from "./email-templates.js";

const BREVO_DOMAINS = "https://api.brevo.com/v3/senders/domains";
const BREVO_SENDERS = "https://api.brevo.com/v3/senders";

const BLOCKED_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
  "yahoo.com", "ymail.com", "icloud.com", "me.com", "proton.me", "protonmail.com",
  "aol.com", "zoho.com", "gmx.com", "mail.com",
  "snapserve.ai",
]);

export type MailDnsRecord = {
  key: string;
  host: string;
  type: string;
  value: string;
  ok: boolean;
};

export function mailDomainFromEmail(email: string): string | null {
  const at = email.trim().toLowerCase().lastIndexOf("@");
  if (at < 1) return null;
  const domain = email.trim().toLowerCase().slice(at + 1).replace(/\.$/, "");
  if (!domain.includes(".") || domain.startsWith(".")) return null;
  return domain;
}

export function assertPartnerFromEmail(email: string): string {
  const clean = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean) || clean.length > 200) {
    throw new Error("Enter a valid From address, e.g. noreply@yourcompany.com");
  }
  const domain = mailDomainFromEmail(clean);
  if (!domain) throw new Error("Enter a valid From address, e.g. noreply@yourcompany.com");
  if (BLOCKED_MAIL_DOMAINS.has(domain)) {
    throw new Error("Use an address on your company domain, not Gmail/Outlook/SnapServe.");
  }
  return clean;
}

function brevoHeaders(): Record<string, string> {
  const apiKey = process.env["BREVO_API_KEY"] ?? "";
  if (!apiKey) throw new Error("Mail is not configured (BREVO_API_KEY)");
  return { "api-key": apiKey, Accept: "application/json", "Content-Type": "application/json" };
}

function parseDnsRecords(raw: unknown): MailDnsRecord[] {
  if (!raw || typeof raw !== "object") return [];
  const out: MailDnsRecord[] = [];
  for (const [key, rec] of Object.entries(raw as Record<string, unknown>)) {
    if (!rec || typeof rec !== "object") continue;
    const r = rec as Record<string, unknown>;
    const host = String(r["host_name"] ?? r["host"] ?? "");
    const type = String(r["type"] ?? "TXT");
    const value = String(r["value"] ?? r["data"] ?? "");
    if (!value) continue;
    out.push({
      key,
      host: host || "@",
      type,
      value,
      ok: r["status"] === true,
    });
  }
  return out;
}

function domainAuthenticated(body: Record<string, unknown>, records: MailDnsRecord[]): boolean {
  if (body["authenticated"] === true || body["authenticated"] === "true") return true;
  if (records.length > 0 && records.every((r) => r.ok)) return true;
  const dns = body["dns_records"];
  if (dns && typeof dns === "object") {
    const dkim = (dns as Record<string, { status?: boolean }>)["dkim_record"];
    const code = (dns as Record<string, { status?: boolean }>)["brevo_code"];
    if (dkim?.status === true && code?.status === true) return true;
  }
  return false;
}

async function brevoJson(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const resp = await fetch(url, { ...init, headers: { ...brevoHeaders(), ...(init?.headers as object) } });
  const text = await resp.text();
  let body: Record<string, unknown> = {};
  try { body = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { body = { raw: text.slice(0, 400) }; }
  return { ok: resp.ok, status: resp.status, body };
}

async function ensureBrevoSender(name: string, email: string): Promise<void> {
  const created = await brevoJson(BREVO_SENDERS, {
    method: "POST",
    body: JSON.stringify({ name: name.slice(0, 70) || email, email }),
  });
  if (created.ok || created.status === 400 || created.status === 409) return;
  logger.warn({ status: created.status, body: created.body, email }, "Brevo create sender failed");
}

export async function provisionPartnerMailDomain(
  fromName: string,
  fromEmail: string,
): Promise<{ status: "pending" | "verified"; domain: string; email: string; dnsRecords: MailDnsRecord[] }> {
  const email = assertPartnerFromEmail(fromEmail);
  const domain = mailDomainFromEmail(email)!;
  const name = fromName.trim().slice(0, 80) || domain;

  let created = await brevoJson(BREVO_DOMAINS, {
    method: "POST",
    body: JSON.stringify({ name: domain }),
  });
  if (!created.ok && created.status !== 400 && created.status !== 409) {
    throw new Error(`Could not register ${domain} for sending (${created.status})`);
  }

  const fetched = await brevoJson(`${BREVO_DOMAINS}/${encodeURIComponent(domain)}`);
  const body = fetched.ok ? fetched.body : created.body;
  const dnsRecords = parseDnsRecords(body["dns_records"]);
  await ensureBrevoSender(name, email);

  const verified = fetched.ok && domainAuthenticated(body, dnsRecords);
  return { status: verified ? "verified" : "pending", domain, email, dnsRecords };
}

export async function verifyPartnerMailDomain(domain: string): Promise<{
  status: "pending" | "verified" | "failed";
  dnsRecords: MailDnsRecord[];
}> {
  const auth = await brevoJson(`${BREVO_DOMAINS}/${encodeURIComponent(domain)}/authenticate`, { method: "PUT" });
  const fetched = await brevoJson(`${BREVO_DOMAINS}/${encodeURIComponent(domain)}`);
  const dnsRecords = parseDnsRecords(fetched.body["dns_records"]);
  if (fetched.ok && domainAuthenticated(fetched.body, dnsRecords)) {
    return { status: "verified", dnsRecords };
  }
  if (!auth.ok && auth.status >= 500) {
    return { status: "failed", dnsRecords };
  }
  return { status: "pending", dnsRecords };
}

export function partnerMailSender(partner: Pick<Partner, "companyName" | "mailFromName" | "mailFromEmail" | "mailDomainStatus">): {
  sender?: { name: string; email: string };
  replyTo?: { name: string; email: string };
} {
  const name = (partner.mailFromName || partner.companyName || "Team").trim();
  const email = (partner.mailFromEmail || "").trim().toLowerCase();
  if (email && partner.mailDomainStatus === "verified") {
    return { sender: { name, email } };
  }
  if (email) {
    return { replyTo: { name, email } };
  }
  return {};
}

export async function sendPartnerEmail(
  partner: Pick<Partner, "id" | "companyName" | "mailFromName" | "mailFromEmail" | "mailDomainStatus">,
  to: string,
  subject: string,
  html: string,
  meta: Omit<BrevoEmailMeta, "sender" | "replyTo">,
): Promise<void> {
  const { sender, replyTo } = partnerMailSender(partner);
  await sendBrevoEmail(to, subject, html, undefined, {
    ...meta,
    sender,
    replyTo,
    sentBy: meta.sentBy ?? `partner:${partner.id}`,
  });
}

export async function getManagedClientEmailBrand(clientClerkId: string): Promise<EmailBrand | null> {
  const [row] = await db
    .select({
      id: partnersTable.id,
      companyName: partnersTable.companyName,
      slug: partnersTable.slug,
      customDomain: partnersTable.customDomain,
      customDomainStatus: partnersTable.customDomainStatus,
      partnerUserId: partnersTable.userId,
    })
    .from(usersTable)
    .innerJoin(partnersTable, eq(usersTable.partnerId, partnersTable.id))
    .where(and(eq(usersTable.clerkId, clientClerkId), eq(partnersTable.status, "active")))
    .limit(1);
  if (!row || row.partnerUserId === clientClerkId) return null;
  let loginUrl = process.env["APP_BASE_URL"]?.replace(/\/$/, "") || "https://app.snapserve.ai";
  if (row.customDomain && row.customDomainStatus === "active") {
    loginUrl = `https://${row.customDomain}`;
  } else if (row.slug) {
    loginUrl = `https://${subdomainHostForSlug(row.slug)}`;
  }
  return { companyName: row.companyName, loginUrl };
}

export async function sendManagedClientEmail(
  clientClerkId: string,
  to: string,
  subject: string,
  html: string,
  meta: Omit<BrevoEmailMeta, "sender" | "replyTo">,
): Promise<void> {
  const [row] = await db
    .select({
      id: partnersTable.id,
      companyName: partnersTable.companyName,
      mailFromName: partnersTable.mailFromName,
      mailFromEmail: partnersTable.mailFromEmail,
      mailDomainStatus: partnersTable.mailDomainStatus,
      partnerUserId: partnersTable.userId,
    })
    .from(usersTable)
    .innerJoin(partnersTable, eq(usersTable.partnerId, partnersTable.id))
    .where(and(eq(usersTable.clerkId, clientClerkId), eq(partnersTable.status, "active")))
    .limit(1);

  if (row && row.partnerUserId !== clientClerkId) {
    await sendPartnerEmail(row, to, subject, html, meta);
    return;
  }
  await sendBrevoEmail(to, subject, html, undefined, meta);
}
