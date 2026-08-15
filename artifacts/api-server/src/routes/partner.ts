/**
 * partner.ts — Partner (reseller) panel routes.
 *
 * Partners are regular users with a `partners` row (created by an admin).
 * They onboard client accounts via email invites; accepted clients get
 * users.partnerId set and are billed at the partner-set per-minute rate,
 * with the spread over the partner's base rate credited to the partner
 * (see services/partner-billing.ts).
 *
 * Route groups:
 *  - GET  /partner/context                    → isPartner + client branding (all users)
 *  - GET/PATCH /partner/me                    → partner profile + settings
 *  - POST/DELETE /partner/logo                → white-label logo (bytea, capability token)
 *  - PUT/DELETE  /partner/domain/slug         → subdomain {slug}.snapserve.ai
 *  - PUT/DELETE  /partner/domain/custom       → custom domain + DNS verify
 *  - POST        /partner/domain/custom/verify
 *  - GET  /public/partner-branding?host=      → public branding by Host (pre-login)
 *  - GET  /partner/clients                    → clients with balance/rate/month usage
 *  - POST /partner/clients                    → provision client (email + password)
 *  - PATCH /partner/clients/:clerkId          → set per-client rate and/or allowAgentEdit
 *  - POST /partner/clients/:clerkId/transfer  → move balance partner → client
 *  - GET  /partner/clients/:clerkId/calls     → recent calls for one client
 *  - GET  /partner/clients/:clerkId/config    → client agents + partner number provisioning
 *  - POST /partner/clients/:clerkId/agents    → copy one of the partner's agents into the client account
 *  - GET/POST/DELETE /partner/clients/:clerkId/api-keys → issue SDK keys for the client
 *  - GET/POST/DELETE /partner/invites         → invite lifecycle
 *  - GET  /partner/invites/preview?token=     → invite details for the accept page
 *  - POST /partner/invites/accept             → link the signed-in user to the partner
 *  - GET  /partner/earnings                   → spread earnings + transfer history
 *  - GET  /public/partner-logos/:token        → public logo (unguessable token)
 */

import { Router } from "express";
import { createHash, randomBytes } from "node:crypto";
import {
  db,
  usersTable,
  partnersTable,
  partnerInvitesTable,
  walletTransactionsTable,
  callsTable,
  agentsTable,
  phoneNumbersTable,
  userApiKeysTable,
} from "@workspace/db";
import { and, desc, eq, gte, inArray, isNull, ne, sql, count } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";
import { sendBrevoEmail } from "../services/brevo.js";
import { getSelfBaseUrl } from "../lib/app-domain.js";
import { hashPassword } from "../lib/password.js";
import {
  getPartnerCnameTarget,
  getPartnerSubdomainRoot,
  invalidatePartnerHostCache,
  newDomainVerifyToken,
  normalizeDomain,
  normalizeSlug,
  resolvePartnerByHost,
  subdomainHostForSlug,
  validateDomain,
  validateSlug,
  verifyCustomDomainDns,
} from "../services/partner-domains.js";

function generateClientApiKey(): { key: string; prefix: string; hash: string } {
  const secret = randomBytes(32).toString("hex");
  const key = `sk_live_${secret}`;
  const prefix = key.slice(0, 16);
  const hash = createHash("sha256").update(key).digest("hex");
  return { key, prefix, hash };
}

const router: Router = Router();

const LOGO_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);
const LOGO_MAX_BYTES = 512 * 1024;
const MAX_PENDING_INVITES = 100;
const MAX_RATE_CENTS_PER_MIN = 100_000; // ₹1,000/min sanity cap
const MAX_TRANSFER_CENTS = 10_000_000;  // ₹1,00,000 per transfer sanity cap
const TOKEN_RE = /^[0-9a-f]{24,64}$/i;

function clerkIdOf(req: { clerkUserId?: string }): string {
  return (req as { clerkUserId?: string }).clerkUserId as string;
}

function fmtInr(cents: number): string {
  return `₹${(cents / 100).toFixed(2)}`;
}

function monthStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

async function getPartnerForUser(clerkId: string) {
  const [partner] = await db
    .select()
    .from(partnersTable)
    .where(eq(partnersTable.userId, clerkId));
  return partner ?? null;
}

function logoPathFor(partner: { logoToken: string | null }): string | null {
  return partner.logoToken ? `/api/public/partner-logos/${partner.logoToken}` : null;
}

function generateUserApiKey() {
  return `vok_${randomBytes(24).toString("hex")}`;
}
function generateUserOrgKey() {
  return `voo_${randomBytes(24).toString("hex")}`;
}

/** Preferred public login URL for this partner (custom → subdomain → app). */
function partnerLoginBaseUrl(partner: {
  slug: string | null;
  customDomain: string | null;
  customDomainStatus: string | null;
}): string {
  if (partner.customDomain && partner.customDomainStatus === "active") {
    return `https://${partner.customDomain}`;
  }
  if (partner.slug) {
    return `https://${subdomainHostForSlug(partner.slug)}`;
  }
  return (process.env["APP_BASE_URL"]?.replace(/\/$/, "") || getSelfBaseUrl());
}

/** Require the signed-in user to be an ACTIVE partner; 403 otherwise. */
async function requireActivePartner(req: any, res: any) {
  const partner = await getPartnerForUser(clerkIdOf(req));
  if (!partner) {
    res.status(403).json({ error: "Not a partner account" });
    return null;
  }
  if (partner.status !== "active") {
    res.status(403).json({ error: "Partner account is suspended" });
    return null;
  }
  return partner;
}

/* ─── Client agents: targets for assigning partner-owned numbers ───────────── */

router.get("/partner/client-agents", requireAuth, async (req, res): Promise<void> => {
  try {
    const partner = await requireActivePartner(req, res);
    if (!partner) return;

    const clients = await db
      .select({ clerkId: usersTable.clerkId, name: usersTable.name, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.partnerId, partner.id));
    if (clients.length === 0) { res.json({ clients: [] }); return; }

    const agents = await db
      .select({ id: agentsTable.id, name: agentsTable.name, userId: agentsTable.userId })
      .from(agentsTable)
      .where(inArray(agentsTable.userId, clients.map(c => c.clerkId)));

    const byUser = new Map<string, { id: number; name: string }[]>();
    for (const a of agents) {
      if (!a.userId) continue;
      const list = byUser.get(a.userId) ?? [];
      list.push({ id: a.id, name: a.name });
      byUser.set(a.userId, list);
    }

    res.json({
      clients: clients
        .map(c => ({
          clerkId: c.clerkId,
          name: c.name || c.email || "Client",
          agents: byUser.get(c.clerkId) ?? [],
        }))
        .filter(c => c.agents.length > 0),
    });
  } catch (err) {
    req.log.error({ err }, "partner/client-agents GET failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ─── Context: cheap flags for the dashboard shell ─────────────────────────── */

router.get("/partner/context", requireAuth, async (req, res): Promise<void> => {
  try {
    const clerkId = clerkIdOf(req as any);
    const [me] = await db
      .select({ partnerId: usersTable.partnerId })
      .from(usersTable)
      .where(eq(usersTable.clerkId, clerkId));

    const ownPartner = await getPartnerForUser(clerkId);

    let branding: { companyName: string; logoUrl: string | null } | null = null;
    if (me?.partnerId) {
      const [p] = await db
        .select({
          companyName: partnersTable.companyName,
          logoToken: partnersTable.logoToken,
          status: partnersTable.status,
        })
        .from(partnersTable)
        .where(eq(partnersTable.id, me.partnerId));
      if (p && p.status === "active") {
        branding = { companyName: p.companyName, logoUrl: logoPathFor(p) };
      }
    }

    const isPartner = !!ownPartner && ownPartner.status === "active";
    const isManagedClient = branding !== null && !isPartner;
    res.json({
      isPartner,
      branding,
      // Managed client = linked to an ACTIVE partner. Clients get a full
      // workspace (agents/KB/etc.); partner owns rate, funding, and numbers.
      // A partner linked to their own org (self-partner) is never "managed".
      isManagedClient,
      canEditAgents: isManagedClient ? true : false,
    });
  } catch (err) {
    req.log.error({ err }, "partner/context failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ─── Partner profile ──────────────────────────────────────────────────────── */

router.get("/partner/me", requireAuth, async (req, res): Promise<void> => {
  try {
    const partner = await requireActivePartner(req, res);
    if (!partner) return;

    const start = monthStart();
    const [clientCountRow] = await db
      .select({ n: count() })
      .from(usersTable)
      .where(eq(usersTable.partnerId, partner.id));
    const [pendingInvitesRow] = await db
      .select({ n: count() })
      .from(partnerInvitesTable)
      .where(and(eq(partnerInvitesTable.partnerId, partner.id), eq(partnerInvitesTable.status, "pending")));

    const [partnerUser] = await db
      .select({ id: usersTable.id, walletBalanceCents: usersTable.walletBalanceCents })
      .from(usersTable)
      .where(eq(usersTable.clerkId, partner.userId));

    let monthEarningsCents = 0;
    if (partnerUser) {
      const [earn] = await db
        .select({ total: sql<number>`coalesce(sum(${walletTransactionsTable.amountCents}), 0)` })
        .from(walletTransactionsTable)
        .where(and(
          eq(walletTransactionsTable.userId, partnerUser.id),
          eq(walletTransactionsTable.type, "partner_earning"),
          gte(walletTransactionsTable.createdAt, start),
        ));
      monthEarningsCents = Number(earn?.total ?? 0);
    }

    // Month usage across all clients
    const clientRows = await db
      .select({ clerkId: usersTable.clerkId })
      .from(usersTable)
      .where(eq(usersTable.partnerId, partner.id));
    let monthClientSeconds = 0;
    let monthClientCalls = 0;
    if (clientRows.length > 0) {
      const [usage] = await db
        .select({
          seconds: sql<number>`coalesce(sum(${callsTable.durationSeconds}), 0)`,
          calls: count(),
        })
        .from(callsTable)
        .where(and(
          inArray(callsTable.userId, clientRows.map(c => c.clerkId)),
          gte(callsTable.createdAt, start),
        ));
      monthClientSeconds = Number(usage?.seconds ?? 0);
      monthClientCalls = Number(usage?.calls ?? 0);
    }

    res.json({
      companyName: partner.companyName,
      status: partner.status,
      baseRateCentsPerMin: partner.baseRateCentsPerMin,
      defaultClientRateCentsPerMin: partner.defaultClientRateCentsPerMin,
      logoUrl: logoPathFor(partner),
      loginTitle: partner.loginTitle ?? null,
      loginSubtitle: partner.loginSubtitle ?? null,
      loginUrl: `${partnerLoginBaseUrl(partner)}/sign-in`,
      slug: partner.slug ?? null,
      subdomainHost: partner.slug ? subdomainHostForSlug(partner.slug) : null,
      subdomainRoot: getPartnerSubdomainRoot(),
      customDomain: partner.customDomain ?? null,
      customDomainStatus: partner.customDomainStatus ?? "none",
      domainVerifyToken: partner.domainVerifyToken ?? null,
      cnameTarget: getPartnerCnameTarget(),
      walletBalanceCents: partnerUser?.walletBalanceCents ?? 0,
      clientCount: Number(clientCountRow?.n ?? 0),
      pendingInvites: Number(pendingInvitesRow?.n ?? 0),
      monthEarningsCents,
      monthClientSeconds,
      monthClientCalls,
    });
  } catch (err) {
    req.log.error({ err }, "partner/me GET failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/partner/me", requireAuth, async (req, res): Promise<void> => {
  try {
    const partner = await requireActivePartner(req, res);
    if (!partner) return;

    const { companyName, defaultClientRateCentsPerMin, loginTitle, loginSubtitle } = (req.body ?? {}) as {
      companyName?: string;
      defaultClientRateCentsPerMin?: number;
      loginTitle?: string | null;
      loginSubtitle?: string | null;
    };

    const set: Record<string, unknown> = {};
    if (companyName !== undefined) {
      const clean = String(companyName).trim().slice(0, 80);
      if (clean.length < 2) {
        res.status(400).json({ error: "Company name must be at least 2 characters" });
        return;
      }
      set["companyName"] = clean;
    }
    if (defaultClientRateCentsPerMin !== undefined) {
      const rate = Number(defaultClientRateCentsPerMin);
      if (!Number.isInteger(rate) || rate < partner.baseRateCentsPerMin || rate > MAX_RATE_CENTS_PER_MIN) {
        res.status(400).json({
          error: `Default client rate must be an integer between your base rate (${fmtInr(partner.baseRateCentsPerMin)}/min) and ${fmtInr(MAX_RATE_CENTS_PER_MIN)}/min`,
        });
        return;
      }
      set["defaultClientRateCentsPerMin"] = rate;
    }
    if (loginTitle !== undefined) {
      if (loginTitle === null || String(loginTitle).trim() === "") {
        set["loginTitle"] = null;
      } else {
        set["loginTitle"] = String(loginTitle).trim().slice(0, 120);
      }
    }
    if (loginSubtitle !== undefined) {
      if (loginSubtitle === null || String(loginSubtitle).trim() === "") {
        set["loginSubtitle"] = null;
      } else {
        set["loginSubtitle"] = String(loginSubtitle).trim().slice(0, 280);
      }
    }
    if (Object.keys(set).length === 0) {
      res.status(400).json({ error: "Nothing to update" });
      return;
    }

    const [updated] = await db
      .update(partnersTable)
      .set(set)
      .where(eq(partnersTable.id, partner.id))
      .returning();
    res.json({
      companyName: updated!.companyName,
      defaultClientRateCentsPerMin: updated!.defaultClientRateCentsPerMin,
      loginTitle: updated!.loginTitle ?? null,
      loginSubtitle: updated!.loginSubtitle ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "partner/me PATCH failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ─── Logo (white-label) ───────────────────────────────────────────────────── */

router.post("/partner/logo", requireAuth, async (req, res): Promise<void> => {
  try {
    const partner = await requireActivePartner(req, res);
    if (!partner) return;

    const body = (req.body ?? {}) as { mime?: string; dataBase64?: string };
    const mime = (body.mime ?? "").trim().toLowerCase();
    if (!LOGO_MIMES.has(mime)) {
      res.status(400).json({ error: "Logo must be a PNG, JPEG or WebP image" });
      return;
    }
    const rawB64 = (body.dataBase64 ?? "").replace(/^data:[^;]+;base64,/, "");
    let data: Buffer;
    try {
      data = Buffer.from(rawB64, "base64");
    } catch {
      res.status(400).json({ error: "Invalid image data" });
      return;
    }
    if (data.length < 50 || data.length > LOGO_MAX_BYTES) {
      res.status(400).json({ error: `Logo must be between 50 bytes and ${LOGO_MAX_BYTES / 1024}KB` });
      return;
    }

    const logoToken = randomBytes(18).toString("hex");
    await db
      .update(partnersTable)
      .set({ logoData: data, logoMime: mime, logoToken })
      .where(eq(partnersTable.id, partner.id));
    res.status(201).json({ logoUrl: `/api/public/partner-logos/${logoToken}` });
  } catch (err) {
    req.log.error({ err }, "partner/logo POST failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/partner/logo", requireAuth, async (req, res): Promise<void> => {
  try {
    const partner = await requireActivePartner(req, res);
    if (!partner) return;
    await db
      .update(partnersTable)
      .set({ logoData: null, logoMime: null, logoToken: null })
      .where(eq(partnersTable.id, partner.id));
    res.sendStatus(204);
  } catch (err) {
    req.log.error({ err }, "partner/logo DELETE failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/** Public: clients' dashboards load the partner logo from this URL. */
router.get("/public/partner-logos/:token", async (req, res): Promise<void> => {
  try {
    const token = String((req.params as any).token ?? "");
    if (!TOKEN_RE.test(token)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const [partner] = await db
      .select({ logoData: partnersTable.logoData, logoMime: partnersTable.logoMime })
      .from(partnersTable)
      .where(eq(partnersTable.logoToken, token));
    if (!partner?.logoData || !partner.logoMime) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.setHeader("Content-Type", partner.logoMime);
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(partner.logoData);
  } catch (err) {
    req.log.error({ err }, "public partner logo failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/** Public: resolve partner branding from the browser Host (login / pre-auth). */
router.get("/public/partner-branding", async (req, res): Promise<void> => {
  try {
    const hostRaw =
      (typeof req.query["host"] === "string" && req.query["host"]) ||
      (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim() ||
      req.hostname;
    const brand = await resolvePartnerByHost(String(hostRaw ?? ""));
    if (!brand) {
      res.json({ branding: null, subdomainRoot: getPartnerSubdomainRoot(), cnameTarget: getPartnerCnameTarget() });
      return;
    }
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({
      branding: brand,
      subdomainRoot: getPartnerSubdomainRoot(),
      cnameTarget: getPartnerCnameTarget(),
    });
  } catch (err) {
    req.log.error({ err }, "public partner branding failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ─── Domains (subdomain + custom) ─────────────────────────────────────────── */

router.put("/partner/domain/slug", requireAuth, async (req, res): Promise<void> => {
  try {
    const partner = await requireActivePartner(req, res);
    if (!partner) return;

    const slug = normalizeSlug(String((req.body as { slug?: string })?.slug ?? ""));
    const err = validateSlug(slug);
    if (err) { res.status(400).json({ error: err }); return; }

    const [taken] = await db
      .select({ id: partnersTable.id })
      .from(partnersTable)
      .where(and(eq(partnersTable.slug, slug), ne(partnersTable.id, partner.id)))
      .limit(1);
    if (taken) { res.status(409).json({ error: "That subdomain is already taken" }); return; }

    const [updated] = await db
      .update(partnersTable)
      .set({ slug })
      .where(eq(partnersTable.id, partner.id))
      .returning({ slug: partnersTable.slug });

    invalidatePartnerHostCache();
    res.json({
      slug: updated!.slug,
      subdomainHost: subdomainHostForSlug(updated!.slug!),
      subdomainRoot: getPartnerSubdomainRoot(),
      url: `https://${subdomainHostForSlug(updated!.slug!)}`,
    });
  } catch (err) {
    req.log.error({ err }, "partner/domain/slug PUT failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/partner/domain/slug", requireAuth, async (req, res): Promise<void> => {
  try {
    const partner = await requireActivePartner(req, res);
    if (!partner) return;
    await db.update(partnersTable).set({ slug: null }).where(eq(partnersTable.id, partner.id));
    invalidatePartnerHostCache();
    res.sendStatus(204);
  } catch (err) {
    req.log.error({ err }, "partner/domain/slug DELETE failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/partner/domain/custom", requireAuth, async (req, res): Promise<void> => {
  try {
    const partner = await requireActivePartner(req, res);
    if (!partner) return;

    const domain = normalizeDomain(String((req.body as { domain?: string })?.domain ?? ""));
    const err = validateDomain(domain);
    if (err) { res.status(400).json({ error: err }); return; }

    const [taken] = await db
      .select({ id: partnersTable.id })
      .from(partnersTable)
      .where(and(eq(partnersTable.customDomain, domain), ne(partnersTable.id, partner.id)))
      .limit(1);
    if (taken) { res.status(409).json({ error: "That domain is already linked to another partner" }); return; }

    const token = partner.domainVerifyToken || newDomainVerifyToken();
    const [updated] = await db
      .update(partnersTable)
      .set({
        customDomain: domain,
        customDomainStatus: "pending",
        domainVerifyToken: token,
        customDomainVerifiedAt: null,
      })
      .where(eq(partnersTable.id, partner.id))
      .returning();

    invalidatePartnerHostCache();
    res.json({
      customDomain: updated!.customDomain,
      customDomainStatus: updated!.customDomainStatus,
      domainVerifyToken: updated!.domainVerifyToken,
      cnameTarget: getPartnerCnameTarget(),
      txtHost: `_snapserve-verify.${domain}`,
      txtValue: `snapserve-verify=${token}`,
      instructions: {
        cname: `Point a CNAME from ${domain} to ${getPartnerCnameTarget()}`,
        txt: `Or add TXT at _snapserve-verify.${domain} = snapserve-verify=${token}`,
      },
    });
  } catch (err) {
    req.log.error({ err }, "partner/domain/custom PUT failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/partner/domain/custom/verify", requireAuth, async (req, res): Promise<void> => {
  try {
    const partner = await requireActivePartner(req, res);
    if (!partner) return;
    if (!partner.customDomain || !partner.domainVerifyToken) {
      res.status(400).json({ error: "Set a custom domain first" });
      return;
    }

    const result = await verifyCustomDomainDns({
      domain: partner.customDomain,
      verifyToken: partner.domainVerifyToken,
    });

    if (!result.ok) {
      await db
        .update(partnersTable)
        .set({ customDomainStatus: "failed" })
        .where(eq(partnersTable.id, partner.id));
      res.status(400).json({
        ok: false,
        customDomainStatus: "failed",
        error: result.reason,
        cname: result.cname,
        txt: result.txt,
      });
      return;
    }

    await db
      .update(partnersTable)
      .set({
        customDomainStatus: "active",
        customDomainVerifiedAt: new Date(),
      })
      .where(eq(partnersTable.id, partner.id));
    invalidatePartnerHostCache();
    res.json({
      ok: true,
      customDomain: partner.customDomain,
      customDomainStatus: "active",
      url: `https://${partner.customDomain}`,
    });
  } catch (err) {
    req.log.error({ err }, "partner/domain/custom/verify failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/partner/domain/custom", requireAuth, async (req, res): Promise<void> => {
  try {
    const partner = await requireActivePartner(req, res);
    if (!partner) return;
    await db
      .update(partnersTable)
      .set({
        customDomain: null,
        customDomainStatus: "none",
        domainVerifyToken: null,
        customDomainVerifiedAt: null,
      })
      .where(eq(partnersTable.id, partner.id));
    invalidatePartnerHostCache();
    res.sendStatus(204);
  } catch (err) {
    req.log.error({ err }, "partner/domain/custom DELETE failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ─── Clients ──────────────────────────────────────────────────────────────── */

function clientWelcomeEmailHtml(opts: {
  companyName: string;
  clientName: string;
  email: string;
  password: string;
  loginUrl: string;
}): string {
  return `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;background:#f6f7fb;padding:24px;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;border:1px solid #e8eaf0;">
    <h1 style="font-size:20px;margin:0 0 12px;">Your ${opts.companyName} account is ready</h1>
    <p style="color:#444;line-height:1.6;">
      Hi ${opts.clientName}, ${opts.companyName} created a workspace for you. Sign in with the credentials below:
    </p>
    <div style="background:#f6f7fb;border-radius:8px;padding:14px 16px;margin:18px 0;font-size:14px;line-height:1.7;">
      <div><strong>Email:</strong> ${opts.email}</div>
      <div><strong>Password:</strong> ${opts.password}</div>
    </div>
    <p style="margin:28px 0;">
      <a href="${opts.loginUrl}" style="background:#0f172a;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;display:inline-block;">
        Sign in
      </a>
    </p>
    <p style="color:#888;font-size:12px;line-height:1.5;">
      For security, change your password after your first sign-in if your administrator asked you to.
    </p>
  </div>
</body></html>`;
}

/**
 * Provision a managed client with email + password. They sign in on the
 * partner's white-label gateway (no Google, no public self-signup).
 */
router.post("/partner/clients", requireAuth, async (req, res): Promise<void> => {
  try {
    const partner = await requireActivePartner(req, res);
    if (!partner) return;

    const { email, password, name, rateCentsPerMin, sendCredentials } = (req.body ?? {}) as {
      email?: string;
      password?: string;
      name?: string;
      rateCentsPerMin?: number;
      sendCredentials?: boolean;
    };

    const cleanEmail = String(email ?? "").trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes("@") || cleanEmail.length > 200) {
      res.status(400).json({ error: "Valid email address is required" });
      return;
    }
    const pwd = String(password ?? "");
    if (pwd.length < 8) {
      res.status(400).json({ error: "Password must be at least 8 characters" });
      return;
    }

    let rate = partner.defaultClientRateCentsPerMin;
    if (rateCentsPerMin !== undefined && rateCentsPerMin !== null) {
      rate = Number(rateCentsPerMin);
      if (!Number.isInteger(rate) || rate < partner.baseRateCentsPerMin || rate > MAX_RATE_CENTS_PER_MIN) {
        res.status(400).json({
          error: `Rate must be an integer between your base rate (${fmtInr(partner.baseRateCentsPerMin)}/min) and ${fmtInr(MAX_RATE_CENTS_PER_MIN)}/min`,
        });
        return;
      }
    }

    const sub = `email:${cleanEmail}`;
    const [existing] = await db
      .select({
        id: usersTable.id,
        clerkId: usersTable.clerkId,
        partnerId: usersTable.partnerId,
        status: usersTable.status,
      })
      .from(usersTable)
      .where(eq(usersTable.clerkId, sub))
      .limit(1);

    if (existing && existing.status !== "deleted") {
      if (existing.partnerId === partner.id) {
        res.status(409).json({ error: "This client already exists in your account" });
        return;
      }
      if (existing.partnerId) {
        res.status(409).json({ error: "This email is already linked to another partner" });
        return;
      }
      const otherPartner = await getPartnerForUser(existing.clerkId);
      if (otherPartner) {
        res.status(409).json({ error: "This email belongs to a partner account" });
        return;
      }
      res.status(409).json({ error: "An account with that email already exists. Ask them to accept an invite instead." });
      return;
    }

    // Also block google-only accounts with the same email from being dual-created silently.
    const [emailTaken] = await db
      .select({ clerkId: usersTable.clerkId, partnerId: usersTable.partnerId, status: usersTable.status })
      .from(usersTable)
      .where(and(eq(usersTable.email, cleanEmail), ne(usersTable.clerkId, sub)))
      .limit(1);
    if (emailTaken && emailTaken.status !== "deleted") {
      res.status(409).json({ error: "An account with that email already exists" });
      return;
    }

    const displayName = (name ?? "").trim().slice(0, 80) || cleanEmail.split("@")[0]!;
    const passwordHash = await hashPassword(pwd);

    let user: typeof usersTable.$inferSelect;
    if (existing) {
      [user] = await db
        .update(usersTable)
        .set({
          name: displayName,
          email: cleanEmail,
          passwordHash,
          status: "active",
          suspendedAt: null,
          suspendedReason: null,
          partnerId: partner.id,
          partnerRateCentsPerMin: rate,
          partnerAllowAgentEdit: true,
          walletBalanceCents: 0,
          freeCreditsGranted: true,
          onboardingCompleted: false,
        })
        .where(eq(usersTable.id, existing.id))
        .returning();
    } else {
      [user] = await db
        .insert(usersTable)
        .values({
          clerkId: sub,
          email: cleanEmail,
          name: displayName,
          passwordHash,
          walletBalanceCents: 0,
          freeCreditsGranted: true,
          apiKey: generateUserApiKey(),
          orgKey: generateUserOrgKey(),
          partnerId: partner.id,
          partnerRateCentsPerMin: rate,
          partnerAllowAgentEdit: true,
        })
        .returning();
    }

    const loginUrl = `${partnerLoginBaseUrl(partner)}/sign-in`;
    let emailSent = false;
    if (sendCredentials !== false) {
      try {
        await sendBrevoEmail(
          cleanEmail,
          `Your ${partner.companyName} account is ready`,
          clientWelcomeEmailHtml({
            companyName: partner.companyName,
            clientName: displayName,
            email: cleanEmail,
            password: pwd,
            loginUrl,
          }),
          undefined,
          { emailType: "partner_client_credentials", toUserId: sub, toName: displayName },
        );
        emailSent = true;
      } catch (emailErr) {
        req.log.warn({ emailErr, cleanEmail }, "Partner client credentials email failed");
      }
    }

    res.status(201).json({
      client: {
        clerkId: user.clerkId,
        email: user.email,
        name: user.name,
        rateCentsPerMin: user.partnerRateCentsPerMin ?? rate,
        walletBalanceCents: user.walletBalanceCents,
      },
      loginUrl,
      emailSent,
    });
  } catch (err) {
    req.log.error({ err }, "partner/clients POST failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/partner/clients", requireAuth, async (req, res): Promise<void> => {
  try {
    const partner = await requireActivePartner(req, res);
    if (!partner) return;

    const clients = await db
      .select({
        clerkId: usersTable.clerkId,
        name: usersTable.name,
        email: usersTable.email,
        status: usersTable.status,
        walletBalanceCents: usersTable.walletBalanceCents,
        rateCentsPerMin: usersTable.partnerRateCentsPerMin,
        allowAgentEdit: usersTable.partnerAllowAgentEdit,
        createdAt: usersTable.createdAt,
      })
      .from(usersTable)
      .where(eq(usersTable.partnerId, partner.id))
      .orderBy(desc(usersTable.createdAt));

    const start = monthStart();
    const usageByUser = new Map<string, { seconds: number; spendCents: number; calls: number }>();
    if (clients.length > 0) {
      const usage = await db
        .select({
          userId: callsTable.userId,
          seconds: sql<number>`coalesce(sum(${callsTable.durationSeconds}), 0)`,
          spendCents: sql<number>`coalesce(sum(${callsTable.costCents}), 0)`,
          calls: count(),
        })
        .from(callsTable)
        .where(and(
          inArray(callsTable.userId, clients.map(c => c.clerkId)),
          gte(callsTable.createdAt, start),
        ))
        .groupBy(callsTable.userId);
      for (const u of usage) {
        if (u.userId) {
          usageByUser.set(u.userId, {
            seconds: Number(u.seconds ?? 0),
            spendCents: Number(u.spendCents ?? 0),
            calls: Number(u.calls ?? 0),
          });
        }
      }
    }

    res.json({
      clients: clients.map(c => ({
        clerkId: c.clerkId,
        name: c.name,
        email: c.email,
        status: c.status,
        walletBalanceCents: c.walletBalanceCents,
        rateCentsPerMin: c.rateCentsPerMin ?? partner.defaultClientRateCentsPerMin,
        allowAgentEdit: c.allowAgentEdit === true,
        joinedAt: c.createdAt,
        monthSeconds: usageByUser.get(c.clerkId)?.seconds ?? 0,
        monthSpendCents: usageByUser.get(c.clerkId)?.spendCents ?? 0,
        monthCalls: usageByUser.get(c.clerkId)?.calls ?? 0,
      })),
      baseRateCentsPerMin: partner.baseRateCentsPerMin,
    });
  } catch (err) {
    req.log.error({ err }, "partner/clients GET failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

async function getOwnedClient(partnerId: number, clientClerkId: string) {
  const [client] = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.clerkId, clientClerkId), eq(usersTable.partnerId, partnerId)));
  return client ?? null;
}

router.patch("/partner/clients/:clerkId", requireAuth, async (req, res): Promise<void> => {
  try {
    const partner = await requireActivePartner(req, res);
    if (!partner) return;

    const client = await getOwnedClient(partner.id, String(req.params.clerkId ?? ""));
    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }

    const body = (req.body ?? {}) as { rateCentsPerMin?: unknown; allowAgentEdit?: unknown };
    const updates: {
      partnerRateCentsPerMin?: number;
      partnerAllowAgentEdit?: boolean;
    } = {};

    if (body.rateCentsPerMin !== undefined && body.rateCentsPerMin !== null) {
      const rate = Number(body.rateCentsPerMin);
      if (!Number.isInteger(rate) || rate < partner.baseRateCentsPerMin || rate > MAX_RATE_CENTS_PER_MIN) {
        res.status(400).json({
          error: `Rate must be an integer between your base rate (${fmtInr(partner.baseRateCentsPerMin)}/min) and ${fmtInr(MAX_RATE_CENTS_PER_MIN)}/min`,
        });
        return;
      }
      updates.partnerRateCentsPerMin = rate;
    }

    // allowAgentEdit is deprecated — managed clients always have a full workspace.
    if (typeof body.allowAgentEdit === "boolean") {
      updates.partnerAllowAgentEdit = true;
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "Provide rateCentsPerMin" });
      return;
    }

    await db
      .update(usersTable)
      .set(updates)
      .where(eq(usersTable.id, client.id));

    res.json({
      clerkId: client.clerkId,
      rateCentsPerMin: updates.partnerRateCentsPerMin
        ?? client.partnerRateCentsPerMin
        ?? partner.defaultClientRateCentsPerMin,
      allowAgentEdit: true,
    });
  } catch (err) {
    req.log.error({ err }, "partner/clients PATCH failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/partner/clients/:clerkId/transfer", requireAuth, async (req, res): Promise<void> => {
  try {
    const partner = await requireActivePartner(req, res);
    if (!partner) return;

    const client = await getOwnedClient(partner.id, String(req.params.clerkId ?? ""));
    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }

    const amountCents = Number((req.body ?? {}).amountCents);
    if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > MAX_TRANSFER_CENTS) {
      res.status(400).json({ error: `Amount must be a positive integer up to ${fmtInr(MAX_TRANSFER_CENTS)}` });
      return;
    }

    const [partnerUser] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.clerkId, partner.userId));
    if (!partnerUser) {
      res.status(500).json({ error: "Partner account not found" });
      return;
    }

    const clientLabel = client.name || client.email || client.clerkId;
    const result = await db.transaction(async (tx) => {
      // Conditional atomic debit — rejects (rather than clamps) on insufficient balance.
      const [debited] = await tx
        .update(usersTable)
        .set({ walletBalanceCents: sql`${usersTable.walletBalanceCents} - ${amountCents}` })
        .where(and(eq(usersTable.id, partnerUser.id), gte(usersTable.walletBalanceCents, amountCents)))
        .returning({ walletBalanceCents: usersTable.walletBalanceCents });
      if (!debited) return null;

      const [credited] = await tx
        .update(usersTable)
        .set({ walletBalanceCents: sql`${usersTable.walletBalanceCents} + ${amountCents}` })
        .where(eq(usersTable.id, client.id))
        .returning({ walletBalanceCents: usersTable.walletBalanceCents });

      await tx.insert(walletTransactionsTable).values([
        {
          userId: partnerUser.id,
          type: "partner_transfer_out",
          amountCents: -amountCents,
          description: `Balance transfer to client ${clientLabel}`,
          status: "completed",
        },
        {
          userId: client.id,
          type: "partner_transfer_in",
          amountCents: amountCents,
          description: `Credit from ${partner.companyName}`,
          status: "completed",
        },
      ]);
      return { partnerBalanceCents: debited.walletBalanceCents, clientBalanceCents: credited?.walletBalanceCents ?? null };
    });

    if (!result) {
      res.status(400).json({ error: "Insufficient balance for this transfer" });
      return;
    }
    req.log.info({ partnerId: partner.id, client: client.clerkId, amountCents }, "Partner balance transfer");
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "partner transfer failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/partner/clients/:clerkId/calls", requireAuth, async (req, res): Promise<void> => {
  try {
    const partner = await requireActivePartner(req, res);
    if (!partner) return;

    const client = await getOwnedClient(partner.id, String(req.params.clerkId ?? ""));
    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }

    const calls = await db
      .select({
        id: callsTable.id,
        status: callsTable.status,
        durationSeconds: callsTable.durationSeconds,
        costCents: callsTable.costCents,
        createdAt: callsTable.createdAt,
      })
      .from(callsTable)
      .where(eq(callsTable.userId, client.clerkId))
      .orderBy(desc(callsTable.createdAt))
      .limit(20);

    res.json({ calls });
  } catch (err) {
    req.log.error({ err }, "partner client calls failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ─── Client configuration (agents + partner number provisioning) ─────────── */

router.get("/partner/clients/:clerkId/config", requireAuth, async (req, res): Promise<void> => {
  try {
    const partner = await requireActivePartner(req, res);
    if (!partner) return;
    const client = await getOwnedClient(partner.id, String(req.params.clerkId ?? ""));
    if (!client) { res.status(404).json({ error: "Client not found" }); return; }
    const partnerClerkId = clerkIdOf(req as { clerkUserId?: string });

    // The client's agents (built by the partner via acting-as).
    const agents = await db
      .select({
        id: agentsTable.id,
        name: agentsTable.name,
        status: agentsTable.status,
        inboundPhoneNumberId: agentsTable.inboundPhoneNumberId,
      })
      .from(agentsTable)
      .where(eq(agentsTable.userId, client.clerkId))
      .orderBy(agentsTable.name);

    // Resolve inbound number strings (may be client-owned or partner-owned).
    const inboundIds = agents.map(a => a.inboundPhoneNumberId).filter((x): x is number => x != null);
    const inboundRows = inboundIds.length
      ? await db
          .select({ id: phoneNumbersTable.id, number: phoneNumbersTable.number, userId: phoneNumbersTable.userId })
          .from(phoneNumbersTable)
          .where(inArray(phoneNumbersTable.id, inboundIds))
      : [];
    const numById = new Map(inboundRows.map(r => [r.id, r]));

    // The partner's own active voice numbers + who currently holds each one.
    const pNumbers = await db
      .select({
        id: phoneNumbersTable.id,
        number: phoneNumbersTable.number,
        agentId: phoneNumbersTable.agentId,
      })
      .from(phoneNumbersTable)
      .where(and(
        eq(phoneNumbersTable.userId, partnerClerkId),
        eq(phoneNumbersTable.service, "voice"),
        eq(phoneNumbersTable.status, "active"),
      ))
      .orderBy(phoneNumbersTable.number);

    const holderIds = pNumbers.map(n => n.agentId).filter((x): x is number => x != null);
    const holders = holderIds.length
      ? await db
          .select({ id: agentsTable.id, name: agentsTable.name, userId: agentsTable.userId })
          .from(agentsTable)
          .where(inArray(agentsTable.id, holderIds))
      : [];
    const holderById = new Map(holders.map(h => [h.id, h]));

    // The partner's own agents — templates they can send to this client.
    const ownAgents = await db
      .select({ id: agentsTable.id, name: agentsTable.name, status: agentsTable.status })
      .from(agentsTable)
      .where(eq(agentsTable.userId, partnerClerkId))
      .orderBy(agentsTable.name);

    res.json({
      partnerAgents: ownAgents,
      agents: agents.map(a => {
        const num = a.inboundPhoneNumberId != null ? numById.get(a.inboundPhoneNumberId) : undefined;
        return {
          id: a.id,
          name: a.name,
          status: a.status,
          inboundNumber: num?.number ?? null,
          inboundNumberOwnedByPartner: num ? num.userId === partnerClerkId : false,
        };
      }),
      partnerNumbers: pNumbers.map(n => {
        const holder = n.agentId != null ? holderById.get(n.agentId) : undefined;
        const assignment =
          !holder ? "unassigned"
          : holder.userId === client.clerkId ? "this_client"
          : holder.userId === partnerClerkId ? "own"
          : "other_client";
        return {
          id: n.id,
          number: n.number,
          assignedAgentId: n.agentId,
          assignedAgentName: holder?.name ?? null,
          assignment,
        };
      }),
    });
  } catch (err) {
    req.log.error({ err }, "partner client config failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /partner/clients/:clerkId/agents — copy one of the partner's own agents
 * into a managed client's account. The copy is a config snapshot: account-scoped
 * references (numbers, knowledge base, WhatsApp credentials, calendar/IVR ids,
 * call stats) are stripped and must be re-linked in the client's workspace.
 */
router.post("/partner/clients/:clerkId/agents", requireAuth, async (req, res): Promise<void> => {
  try {
    const partner = await requireActivePartner(req, res);
    if (!partner) return;
    const client = await getOwnedClient(partner.id, String(req.params.clerkId ?? ""));
    if (!client) { res.status(404).json({ error: "Client not found" }); return; }
    const partnerClerkId = clerkIdOf(req as { clerkUserId?: string });

    const sourceAgentId = Number((req.body as { sourceAgentId?: unknown } | undefined)?.sourceAgentId);
    if (!Number.isInteger(sourceAgentId) || sourceAgentId <= 0) {
      res.status(400).json({ error: "sourceAgentId is required" });
      return;
    }

    const [src] = await db
      .select()
      .from(agentsTable)
      .where(and(eq(agentsTable.id, sourceAgentId), eq(agentsTable.userId, partnerClerkId)));
    if (!src) { res.status(404).json({ error: "Agent not found in your account" }); return; }

    // Strip account-scoped references — they must not follow the copy across accounts.
    const copy: Record<string, unknown> = { ...src };
    for (const k of [
      "id", "userId", "createdAt", "updatedAt",
      "inboundPhoneNumberId", "outboundPhoneNumberId",
      "knowledgeBaseId", "snapserveAgentId",
      "totalCalls", "successfulCalls", "avgDurationSeconds",
      "avgSttLatencyMs", "avgLlmLatencyMs", "avgTtsFirstChunkMs",
    ]) delete copy[k];
    if (src.agentConfig) {
      // WhatsApp credentials are secrets; IVR/scheduling/calendar entries embed
      // ids that only resolve inside the partner's account.
      const cfg: Record<string, unknown> = { ...(src.agentConfig as Record<string, unknown>) };
      for (const key of Object.keys(cfg)) {
        if (/whatsapp|ivr|scheduling|calendar/i.test(key)) delete cfg[key];
      }
      copy["agentConfig"] = cfg;
    }

    // De-duplicate the name inside the client's account.
    const existing = await db
      .select({ name: agentsTable.name })
      .from(agentsTable)
      .where(eq(agentsTable.userId, client.clerkId));
    const taken = new Set(existing.map(e => e.name));
    let name = src.name;
    for (let n = 2; taken.has(name); n++) name = `${src.name} (${n})`;

    const [created] = await db
      .insert(agentsTable)
      .values({ ...(copy as unknown as typeof agentsTable.$inferInsert), userId: client.clerkId, name })
      .returning({ id: agentsTable.id, name: agentsTable.name });

    req.log.info(
      { sourceAgentId, createdId: created!.id, clientClerkId: client.clerkId },
      "partner copied agent into client account",
    );
    res.status(201).json(created);
  } catch (err) {
    req.log.error({ err }, "partner send agent failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ─── Client API keys (SDK / automations for the managed client) ───────────── */

router.get("/partner/clients/:clerkId/api-keys", requireAuth, async (req, res): Promise<void> => {
  try {
    const partner = await requireActivePartner(req, res);
    if (!partner) return;
    const client = await getOwnedClient(partner.id, String(req.params.clerkId ?? ""));
    if (!client) { res.status(404).json({ error: "Client not found" }); return; }

    const keys = await db
      .select({
        id: userApiKeysTable.id,
        name: userApiKeysTable.name,
        keyPrefix: userApiKeysTable.keyPrefix,
        lastUsedAt: userApiKeysTable.lastUsedAt,
        createdAt: userApiKeysTable.createdAt,
        revokedAt: userApiKeysTable.revokedAt,
      })
      .from(userApiKeysTable)
      .where(eq(userApiKeysTable.userId, client.clerkId))
      .orderBy(userApiKeysTable.createdAt);

    res.json({ keys });
  } catch (err) {
    req.log.error({ err }, "partner client api-keys list failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/partner/clients/:clerkId/api-keys", requireAuth, async (req, res): Promise<void> => {
  try {
    const partner = await requireActivePartner(req, res);
    if (!partner) return;
    const client = await getOwnedClient(partner.id, String(req.params.clerkId ?? ""));
    if (!client) { res.status(404).json({ error: "Client not found" }); return; }

    const name = (req.body as { name?: string }).name?.trim() || "Partner issued";

    const existing = await db
      .select({ id: userApiKeysTable.id })
      .from(userApiKeysTable)
      .where(and(eq(userApiKeysTable.userId, client.clerkId), isNull(userApiKeysTable.revokedAt)));

    if (existing.length >= 5) {
      res.status(400).json({ error: "Maximum 5 active API keys allowed for this client. Revoke one first." });
      return;
    }

    const { key, prefix, hash } = generateClientApiKey();
    await db.insert(userApiKeysTable).values({
      userId: client.clerkId,
      name,
      keyHash: hash,
      keyPrefix: prefix,
    });

    req.log.info(
      { partnerId: partner.id, clientClerkId: client.clerkId, prefix },
      "partner issued API key for client",
    );
    res.status(201).json({
      key,
      prefix,
      name,
      message: "Save this key — it will not be shown again. It authenticates as this client.",
    });
  } catch (err) {
    req.log.error({ err }, "partner client api-key create failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/partner/clients/:clerkId/api-keys/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const partner = await requireActivePartner(req, res);
    if (!partner) return;
    const client = await getOwnedClient(partner.id, String(req.params.clerkId ?? ""));
    if (!client) { res.status(404).json({ error: "Client not found" }); return; }

    const id = Number(req.params["id"]);
    if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid key id" }); return; }

    const [row] = await db
      .select()
      .from(userApiKeysTable)
      .where(and(eq(userApiKeysTable.id, id), eq(userApiKeysTable.userId, client.clerkId)));

    if (!row) { res.status(404).json({ error: "Key not found" }); return; }
    if (row.revokedAt) { res.status(400).json({ error: "Key already revoked" }); return; }

    await db
      .update(userApiKeysTable)
      .set({ revokedAt: new Date() })
      .where(eq(userApiKeysTable.id, id));

    req.log.info(
      { partnerId: partner.id, clientClerkId: client.clerkId, id },
      "partner revoked client API key",
    );
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "partner client api-key revoke failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ─── Invites ──────────────────────────────────────────────────────────────── */

router.get("/partner/invites", requireAuth, async (req, res): Promise<void> => {
  try {
    const partner = await requireActivePartner(req, res);
    if (!partner) return;
    const invites = await db
      .select({
        id: partnerInvitesTable.id,
        email: partnerInvitesTable.email,
        name: partnerInvitesTable.name,
        rateCentsPerMin: partnerInvitesTable.rateCentsPerMin,
        status: partnerInvitesTable.status,
        invitedAt: partnerInvitesTable.invitedAt,
        acceptedAt: partnerInvitesTable.acceptedAt,
      })
      .from(partnerInvitesTable)
      .where(eq(partnerInvitesTable.partnerId, partner.id))
      .orderBy(desc(partnerInvitesTable.invitedAt))
      .limit(200);
    res.json({ invites });
  } catch (err) {
    req.log.error({ err }, "partner/invites GET failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

function inviteEmailHtml(companyName: string, inviteUrl: string): string {
  return `
  <!doctype html><html><body style="font-family: Arial, sans-serif; background:#f6f7f9; padding:24px;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      <h1 style="font-size:20px;margin:0 0 12px;">${companyName} invited you to their AI voice-agent platform</h1>
      <p style="color:#444;line-height:1.6;">
        ${companyName} uses SnapServe AI to run AI voice agents and has invited you to join as a client.
        You'll get your own account with agents, call logs and a prepaid wallet — managed in partnership with ${companyName}.
      </p>
      <p style="margin:28px 0;">
        <a href="${inviteUrl}" style="background:#4f46e5;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;display:inline-block;">
          Accept invitation
        </a>
      </p>
      <p style="color:#888;font-size:12px;line-height:1.5;">
        If you didn't expect this invitation, you can safely ignore this email.
      </p>
    </div>
  </body></html>`;
}

router.post("/partner/invites", requireAuth, async (req, res): Promise<void> => {
  try {
    const partner = await requireActivePartner(req, res);
    if (!partner) return;

    const { email, name, rateCentsPerMin } = (req.body ?? {}) as {
      email?: string; name?: string; rateCentsPerMin?: number;
    };
    const cleanEmail = String(email ?? "").trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes("@") || cleanEmail.length > 200) {
      res.status(400).json({ error: "Valid email address is required" });
      return;
    }
    let rate: number | null = null;
    if (rateCentsPerMin !== undefined && rateCentsPerMin !== null) {
      rate = Number(rateCentsPerMin);
      if (!Number.isInteger(rate) || rate < partner.baseRateCentsPerMin || rate > MAX_RATE_CENTS_PER_MIN) {
        res.status(400).json({
          error: `Rate must be an integer between your base rate (${fmtInr(partner.baseRateCentsPerMin)}/min) and ${fmtInr(MAX_RATE_CENTS_PER_MIN)}/min`,
        });
        return;
      }
    }

    // Refuse emails that already belong to a partner-linked user or a partner account.
    const [existingUser] = await db
      .select({ clerkId: usersTable.clerkId, partnerId: usersTable.partnerId })
      .from(usersTable)
      .where(eq(usersTable.email, cleanEmail));
    if (existingUser?.partnerId) {
      res.status(409).json({ error: "This user is already linked to a partner" });
      return;
    }
    if (existingUser) {
      const otherPartner = await getPartnerForUser(existingUser.clerkId);
      if (otherPartner) {
        res.status(409).json({ error: "This email belongs to a partner account" });
        return;
      }
    }

    const [pendingCountRow] = await db
      .select({ n: count() })
      .from(partnerInvitesTable)
      .where(and(eq(partnerInvitesTable.partnerId, partner.id), eq(partnerInvitesTable.status, "pending")));
    if (Number(pendingCountRow?.n ?? 0) >= MAX_PENDING_INVITES) {
      res.status(400).json({ error: `Limit of ${MAX_PENDING_INVITES} pending invites reached` });
      return;
    }

    // Existing pending invite for this email → refresh + re-send.
    const [existingInvite] = await db
      .select()
      .from(partnerInvitesTable)
      .where(and(
        eq(partnerInvitesTable.partnerId, partner.id),
        eq(partnerInvitesTable.email, cleanEmail),
        eq(partnerInvitesTable.status, "pending"),
      ));

    const token = existingInvite?.token ?? randomBytes(24).toString("hex");
    let inviteRow;
    if (existingInvite) {
      [inviteRow] = await db
        .update(partnerInvitesTable)
        .set({
          name: name?.trim().slice(0, 80) || existingInvite.name,
          rateCentsPerMin: rate ?? existingInvite.rateCentsPerMin,
          invitedAt: new Date(),
        })
        .where(eq(partnerInvitesTable.id, existingInvite.id))
        .returning();
    } else {
      [inviteRow] = await db
        .insert(partnerInvitesTable)
        .values({
          partnerId: partner.id,
          email: cleanEmail,
          name: name?.trim().slice(0, 80) || null,
          rateCentsPerMin: rate,
          token,
        })
        .returning();
    }

    const appBase = process.env["APP_BASE_URL"]?.replace(/\/$/, "") || getSelfBaseUrl();
    const inviteUrl = `${appBase}/app/partner-join?token=${token}`;
    let emailSent = true;
    try {
      await sendBrevoEmail(
        cleanEmail,
        `${partner.companyName} invited you to SnapServe AI`,
        inviteEmailHtml(partner.companyName, inviteUrl),
        undefined,
        { emailType: "partner_invite" },
      );
    } catch (emailErr) {
      emailSent = false;
      req.log.warn({ emailErr, cleanEmail }, "Partner invite email failed");
    }

    res.status(existingInvite ? 200 : 201).json({
      invite: {
        id: inviteRow!.id,
        email: inviteRow!.email,
        name: inviteRow!.name,
        rateCentsPerMin: inviteRow!.rateCentsPerMin,
        status: inviteRow!.status,
        invitedAt: inviteRow!.invitedAt,
      },
      emailSent,
      inviteUrl,
    });
  } catch (err) {
    req.log.error({ err }, "partner/invites POST failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/partner/invites/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const partner = await requireActivePartner(req, res);
    if (!partner) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid invite id" });
      return;
    }
    // Status-guarded: only pending invites can be revoked.
    const revoked = await db
      .update(partnerInvitesTable)
      .set({ status: "revoked" })
      .where(and(
        eq(partnerInvitesTable.id, id),
        eq(partnerInvitesTable.partnerId, partner.id),
        eq(partnerInvitesTable.status, "pending"),
      ))
      .returning({ id: partnerInvitesTable.id });
    if (revoked.length === 0) {
      res.status(404).json({ error: "Pending invite not found" });
      return;
    }
    res.sendStatus(204);
  } catch (err) {
    req.log.error({ err }, "partner/invites DELETE failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/partner/invites/preview", requireAuth, async (req, res): Promise<void> => {
  try {
    const token = String(req.query.token ?? "");
    if (!TOKEN_RE.test(token)) {
      res.status(404).json({ error: "Invite not found" });
      return;
    }
    const [row] = await db
      .select({
        status: partnerInvitesTable.status,
        email: partnerInvitesTable.email,
        rateCentsPerMin: partnerInvitesTable.rateCentsPerMin,
        companyName: partnersTable.companyName,
        partnerStatus: partnersTable.status,
        defaultRate: partnersTable.defaultClientRateCentsPerMin,
        logoToken: partnersTable.logoToken,
      })
      .from(partnerInvitesTable)
      .innerJoin(partnersTable, eq(partnerInvitesTable.partnerId, partnersTable.id))
      .where(eq(partnerInvitesTable.token, token));
    if (!row || row.partnerStatus !== "active") {
      res.status(404).json({ error: "Invite not found" });
      return;
    }
    res.json({
      status: row.status,
      email: row.email,
      companyName: row.companyName,
      rateCentsPerMin: row.rateCentsPerMin ?? row.defaultRate,
      logoUrl: logoPathFor(row),
    });
  } catch (err) {
    req.log.error({ err }, "partner invite preview failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/partner/invites/accept", requireAuth, async (req, res): Promise<void> => {
  try {
    const clerkId = clerkIdOf(req as any);
    const token = String((req.body ?? {}).token ?? "");
    if (!TOKEN_RE.test(token)) {
      res.status(400).json({ error: "Invalid invite token" });
      return;
    }

    const [invite] = await db
      .select()
      .from(partnerInvitesTable)
      .where(eq(partnerInvitesTable.token, token));
    if (!invite) {
      res.status(404).json({ error: "Invite not found" });
      return;
    }

    const [partner] = await db.select().from(partnersTable).where(eq(partnersTable.id, invite.partnerId));
    if (!partner || partner.status !== "active") {
      res.status(410).json({ error: "This invitation is no longer valid" });
      return;
    }

    const [me] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
    if (!me) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // Idempotent success if this user already accepted this invite.
    if (invite.status === "accepted" && invite.acceptedUserId === clerkId && me.partnerId === partner.id) {
      res.json({ linked: true, companyName: partner.companyName, alreadyLinked: true });
      return;
    }
    if (invite.status !== "pending") {
      res.status(410).json({ error: "This invitation is no longer valid" });
      return;
    }
    if ((me.email ?? "").trim().toLowerCase() !== invite.email) {
      res.status(403).json({ error: `This invitation was sent to ${invite.email}. Sign in with that email to accept it.` });
      return;
    }
    if (me.partnerId) {
      res.status(409).json({ error: "Your account is already linked to a partner" });
      return;
    }
    const meAsPartner = await getPartnerForUser(clerkId);
    if (meAsPartner) {
      res.status(409).json({ error: "Partner accounts cannot join another partner as a client" });
      return;
    }

    const rate = Math.max(
      invite.rateCentsPerMin ?? partner.defaultClientRateCentsPerMin,
      partner.baseRateCentsPerMin,
    );

    const linked = await db.transaction(async (tx) => {
      // Status-guarded claim — a concurrent accept loses this update.
      const claimed = await tx
        .update(partnerInvitesTable)
        .set({ status: "accepted", acceptedAt: new Date(), acceptedUserId: clerkId })
        .where(and(eq(partnerInvitesTable.id, invite.id), eq(partnerInvitesTable.status, "pending")))
        .returning({ id: partnerInvitesTable.id });
      if (claimed.length === 0) return false;

      const linkedRows = await tx
        .update(usersTable)
        .set({
          partnerId: partner.id,
          partnerRateCentsPerMin: rate,
          partnerAllowAgentEdit: true,
        })
        .where(and(eq(usersTable.id, me.id), isNull(usersTable.partnerId)))
        .returning({ id: usersTable.id });
      if (linkedRows.length === 0) throw new Error("concurrent partner link");
      return true;
    });

    if (!linked) {
      res.status(410).json({ error: "This invitation is no longer valid" });
      return;
    }
    req.log.info({ partnerId: partner.id, client: clerkId, rate }, "Partner invite accepted");
    res.json({ linked: true, companyName: partner.companyName });
  } catch (err) {
    req.log.error({ err }, "partner invite accept failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ─── Earnings ─────────────────────────────────────────────────────────────── */

router.get("/partner/earnings", requireAuth, async (req, res): Promise<void> => {
  try {
    const partner = await requireActivePartner(req, res);
    if (!partner) return;
    const [partnerUser] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.clerkId, partner.userId));
    if (!partnerUser) {
      res.json({ entries: [] });
      return;
    }
    const entries = await db
      .select({
        id: walletTransactionsTable.id,
        type: walletTransactionsTable.type,
        amountCents: walletTransactionsTable.amountCents,
        description: walletTransactionsTable.description,
        callId: walletTransactionsTable.callId,
        createdAt: walletTransactionsTable.createdAt,
      })
      .from(walletTransactionsTable)
      .where(and(
        eq(walletTransactionsTable.userId, partnerUser.id),
        inArray(walletTransactionsTable.type, ["partner_earning", "partner_transfer_out"]),
      ))
      .orderBy(desc(walletTransactionsTable.createdAt))
      .limit(100);
    res.json({ entries });
  } catch (err) {
    req.log.error({ err }, "partner/earnings failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
