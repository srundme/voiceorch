/**
 * CRM Connector routes
 * ──────────────────────────────────────────────────────────────────────────
 * OAuth connect + callback (HubSpot and Zoho), connection management,
 * contact/lead browsing, and import into campaign batches.
 *
 * Push (call-outcome writeback) is triggered from calls.ts at call-end.
 *
 * OAuth state: HMAC-SHA256 signed token (same pattern as Google Calendar).
 * Works across multiple API server instances — no shared in-memory store needed.
 * Tokens encrypted at rest via encryptKey / decryptKey (AES-256-GCM).
 *
 * Public routes (no auth):
 *   GET  /crm/callback/hubspot
 *   GET  /crm/callback/zoho
 *   POST /crm/webhook/zoho/:connectionId
 *
 * Authenticated routes:
 *   GET    /crm/connections
 *   PATCH  /crm/connections/:id
 *   DELETE /crm/connections/:id
 *   GET    /crm/connect/:provider
 *   GET    /crm/connections/:id/lists
 *   GET    /crm/connections/:id/contacts
 *   POST   /crm/connections/:id/import
 */

import { Router, type IRouter } from "express";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { eq, and } from "drizzle-orm";
import {
  db,
  crmConnectionsTable,
  campaignsTable,
  campaignBatchesTable,
  campaignLeadsTable,
  leadTimelineTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { encryptKey, decryptKey } from "../lib/crypto.js";
import { getSelfBaseUrl, getAppOrigins } from "../lib/app-domain.js";
import { logger } from "../lib/logger.js";
import { APP_SECRET } from "../lib/app-secret.js";
import {
  isHubSpotConfigured, buildHubSpotAuthUrl, exchangeHubSpotCode,
  listHubSpotContacts, listHubSpotContactLists,
} from "../services/crm/hubspot.js";
import {
  isZohoConfigured, buildZohoAuthUrl, exchangeZohoCode,
  listZohoContacts, listZohoLeads, listZohoViews, listZohoLeadViews,
  zohoAccountsServerFromLocation,
} from "../services/crm/zoho.js";
import { normalizePhone as normalizePhoneService, INDIA_PHONE_CONFIG } from "../services/phone-normalization.js";
import { isOnDnc } from "../lib/dnc-check.js";
import { checkDuplicate, type DuplicatePolicy } from "../services/duplicate-detection.js";
import { sql } from "drizzle-orm";
import type { CrmTokenPayload } from "@workspace/db";
import { scheduleCampaignCall } from "../orchestration/campaignCaller.js";

const router: IRouter = Router();

const DASHBOARD_BASE = () => {
  if (process.env["APP_BASE_URL"]) return process.env["APP_BASE_URL"].replace(/\/$/, "");
  return getSelfBaseUrl();
};

function isTrustedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:") return false;
    const host = url.hostname;
    if (process.env["APP_BASE_URL"]) {
      try {
        const appUrl = new URL(process.env["APP_BASE_URL"]);
        if (appUrl.hostname === host) return true;
      } catch { /* ignore */ }
    }
    const trustedHosts = getAppOrigins().map(o => {
      try { return new URL(o).hostname; } catch { return ""; }
    }).filter(Boolean);
    if (trustedHosts.includes(host)) return true;
    if (/^[a-z0-9-]+-\d{2}-[a-z0-9]+\.sisko\.replit\.dev$/.test(host)) return true;
    if (/^[a-z0-9-]+\.replit\.dev$/.test(host)) return true;
    return false;
  } catch {
    return false;
  }
}

/* ── HMAC-signed OAuth state (stateless, multi-instance safe) ────────────── */

const STATE_TTL_MS    = 15 * 60 * 1000; // 15 minutes — covers slow consent screens
const STATE_HMAC_ALGO = "sha256";

interface CrmOAuthStatePayload {
  userId:       string;
  provider:     string;
  returnOrigin: string | null;
  exp:          number;
  nonce:        string;
}

function hmacState(encoded: string): string {
  return createHmac(STATE_HMAC_ALGO, APP_SECRET).update(encoded).digest("hex");
}

function signCrmOAuthState(payload: Omit<CrmOAuthStatePayload, "exp" | "nonce">): string {
  const full: CrmOAuthStatePayload = {
    ...payload,
    exp:   Date.now() + STATE_TTL_MS,
    nonce: randomBytes(12).toString("hex"),
  };
  const encoded = Buffer.from(JSON.stringify(full)).toString("base64url");
  const sig     = hmacState(encoded);
  return `${encoded}.${sig}`;
}

function verifyCrmOAuthState(raw: string | undefined): CrmOAuthStatePayload | null {
  if (!raw) return null;
  const dotIdx = raw.lastIndexOf(".");
  if (dotIdx < 0) return null;
  const encoded = raw.slice(0, dotIdx);
  const sig     = raw.slice(dotIdx + 1);

  const expectedSig = hmacState(encoded);
  if (sig.length !== expectedSig.length) return null;
  // Constant-time comparison
  let diff = 0;
  for (let i = 0; i < sig.length; i++) {
    diff |= sig.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  }
  if (diff !== 0) return null;

  let payload: CrmOAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as CrmOAuthStatePayload;
  } catch {
    return null;
  }

  if (!payload.userId || !payload.provider) return null;
  if (typeof payload.exp !== "number" || Date.now() > payload.exp) return null;

  return payload;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function serializeConnection(conn: typeof crmConnectionsTable.$inferSelect) {
  return {
    id:                 conn.id,
    provider:           conn.provider,
    accountId:          conn.accountId,
    accountName:        conn.accountName ?? null,
    fieldMapping:       (conn.fieldMapping ?? {}) as Record<string, string>,
    webhookCampaignId:  conn.webhookCampaignId ?? null,
    webhookAgentId:     conn.webhookAgentId ?? null,
    hasWebhookSecret:   !!(conn.webhookSecret),
    lastSyncAt:         conn.lastSyncAt?.toISOString() ?? null,
    lastErrorAt:        conn.lastErrorAt?.toISOString() ?? null,
    lastError:          conn.lastError ?? null,
    createdAt:          conn.createdAt.toISOString(),
  };
}

/* ── GET /crm/connections ────────────────────────────────────────────────── */

router.get("/crm/connections", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const rows = await db.select().from(crmConnectionsTable)
    .where(eq(crmConnectionsTable.userId, userId))
    .orderBy(crmConnectionsTable.createdAt);
  res.json(rows.map(serializeConnection));
});

/* ── PATCH /crm/connections/:id ──────────────────────────────────────────── */

router.patch("/crm/connections/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const id = Number(req.params["id"]);
  const body = req.body as {
    fieldMapping?:       Record<string, string>;
    webhookCampaignId?:  number | null;
    webhookAgentId?:     number | null;
    regenerateSecret?:   boolean;
    clearSecret?:        boolean;
  };

  const [conn] = await db.select().from(crmConnectionsTable)
    .where(and(eq(crmConnectionsTable.id, id), eq(crmConnectionsTable.userId, userId)));
  if (!conn) { res.status(404).json({ error: "Not found" }); return; }

  const updates: Partial<typeof crmConnectionsTable.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (body.fieldMapping !== undefined) updates.fieldMapping = body.fieldMapping;

  // Validate campaign ownership before linking — prevents cross-tenant assignment
  if (body.webhookCampaignId !== undefined) {
    if (body.webhookCampaignId != null) {
      const [campaign] = await db.select({ id: campaignsTable.id })
        .from(campaignsTable)
        .where(and(eq(campaignsTable.id, body.webhookCampaignId), eq(campaignsTable.userId, userId)));
      if (!campaign) {
        res.status(404).json({ error: "Campaign not found" });
        return;
      }
    }
    updates.webhookCampaignId = body.webhookCampaignId ?? null;
  }

  // Validate agent ownership before linking
  if (body.webhookAgentId !== undefined) {
    if (body.webhookAgentId != null) {
      const { agentsTable } = await import("@workspace/db");
      const [agent] = await db.select({ id: agentsTable.id })
        .from(agentsTable)
        .where(and(eq(agentsTable.id, body.webhookAgentId), eq(agentsTable.userId, userId)));
      if (!agent) {
        res.status(404).json({ error: "Agent not found" });
        return;
      }
    }
    updates.webhookAgentId = body.webhookAgentId ?? null;
  }

  if (body.regenerateSecret) {
    updates.webhookSecret = randomBytes(24).toString("hex");
  }
  if (body.clearSecret) {
    updates.webhookSecret = null;
  }

  const [updated] = await db.update(crmConnectionsTable)
    .set(updates)
    .where(eq(crmConnectionsTable.id, id))
    .returning();

  const result = serializeConnection(updated!);
  // Return the plain secret only when we just generated it
  if (body.regenerateSecret && updated!.webhookSecret) {
    res.json({ ...result, webhookSecret: updated!.webhookSecret });
    return;
  }
  res.json(result);
});

/* ── DELETE /crm/connections/:id ─────────────────────────────────────────── */

router.delete("/crm/connections/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const id = Number(req.params["id"]);
  const [conn] = await db.select().from(crmConnectionsTable)
    .where(and(eq(crmConnectionsTable.id, id), eq(crmConnectionsTable.userId, userId)));
  if (!conn) { res.status(404).json({ error: "Not found" }); return; }
  await db.delete(crmConnectionsTable).where(eq(crmConnectionsTable.id, id));
  req.log.info({ userId, id, provider: conn.provider }, "CRM connection deleted");
  res.sendStatus(204);
});

/* ── GET /crm/connect/:provider ──────────────────────────────────────────── */

router.get("/crm/connect/:provider", requireAuth, (req, res): void => {
  const userId       = (req as any).clerkUserId as string;
  const provider     = req.params["provider"] as string;
  const returnOrigin = (req.query["returnOrigin"] as string | undefined) ?? null;

  if (provider === "hubspot" && !isHubSpotConfigured()) {
    res.status(400).json({ error: "HubSpot OAuth is not configured on this platform (missing HUBSPOT_CLIENT_ID / HUBSPOT_CLIENT_SECRET)" });
    return;
  }
  if (provider === "zoho" && !isZohoConfigured()) {
    res.status(400).json({ error: "Zoho OAuth is not configured on this platform (missing ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET)" });
    return;
  }
  if (provider !== "hubspot" && provider !== "zoho") {
    res.status(400).json({ error: `Unsupported CRM provider: ${provider}` });
    return;
  }

  // HMAC-signed state — stateless, multi-instance safe, 15-min TTL
  const state = signCrmOAuthState({ userId, provider, returnOrigin });

  const authUrl = provider === "hubspot"
    ? buildHubSpotAuthUrl(state)
    : buildZohoAuthUrl(state);

  res.redirect(authUrl);
});

/* ── GET /crm/callback/:provider (no auth — uses signed state) ───────────── */

router.get("/crm/callback/:provider", async (req, res): Promise<void> => {
  const provider    = req.params["provider"] as string;
  const code        = req.query["code"]  as string | undefined;
  const rawState    = req.query["state"] as string | undefined;
  const errorParam  = req.query["error"] as string | undefined;

  const dashBase = DASHBOARD_BASE();

  function redirectError(msg: string): void {
    res.redirect(`${dashBase}/app/connections#crm-error=${encodeURIComponent(msg)}`);
  }

  if (errorParam) { redirectError(`OAuth denied: ${errorParam}`); return; }
  if (!rawState || !code) { redirectError("Missing state or code"); return; }

  // Verify the server-signed state token — tamper-proof, no shared store needed
  const statePayload = verifyCrmOAuthState(rawState);
  if (!statePayload) {
    redirectError("OAuth state invalid or expired — please try connecting again");
    return;
  }

  if (statePayload.provider !== provider) {
    redirectError("Provider mismatch in OAuth state");
    return;
  }

  try {
    let result: { tokens: CrmTokenPayload; accountId: string; accountName: string };

    if (provider === "hubspot") {
      result = await exchangeHubSpotCode(code);
    } else if (provider === "zoho") {
      // Zoho appends `location` to the callback URL indicating the datacenter
      // (e.g. "in", "eu", "au", "jp", "cn", "com"). The token exchange and all
      // subsequent API calls MUST use the matching regional server.
      const locationParam = req.query["location"] as string | undefined;
      const accountsServer = zohoAccountsServerFromLocation(locationParam);

      const zohoResult = await exchangeZohoCode(code, accountsServer);

      // Upsert connection by userId + provider + accountId
      const existingRows = await db.select({ id: crmConnectionsTable.id, encryptedTokens: crmConnectionsTable.encryptedTokens })
        .from(crmConnectionsTable)
        .where(and(
          eq(crmConnectionsTable.userId, statePayload.userId),
          eq(crmConnectionsTable.provider, provider),
          eq(crmConnectionsTable.accountId, zohoResult.accountId),
        ));

      let refreshToken = zohoResult.tokens.refreshToken;
      if (!refreshToken) {
        if (existingRows.length > 0) {
          try {
            const storedPayload = JSON.parse(decryptKey(existingRows[0]!.encryptedTokens)) as CrmTokenPayload;
            refreshToken = storedPayload.refreshToken;
            logger.info({ userId: statePayload.userId, provider }, "Reused stored Zoho refresh_token for re-connect");
          } catch {
            // decryptKey failed — fall through to throw below
          }
        }
        if (!refreshToken) {
          throw new Error("Zoho token exchange returned no refresh_token and no prior connection exists — ensure access_type=offline and prompt=consent");
        }
      }

      const finalTokens: CrmTokenPayload = {
        accessToken:    zohoResult.tokens.accessToken,
        refreshToken,
        expiresAt:      zohoResult.tokens.expiresAt,
        accountsServer: zohoResult.tokens.accountsServer,
        apiDomain:      zohoResult.tokens.apiDomain,
      };

      const encTokens = encryptKey(JSON.stringify(finalTokens));

      if (existingRows.length > 0) {
        await db.update(crmConnectionsTable)
          .set({
            encryptedTokens: encTokens,
            accountName:     zohoResult.accountName,
            lastError:       null,
            lastErrorAt:     null,
            updatedAt:       new Date(),
          })
          .where(eq(crmConnectionsTable.id, existingRows[0]!.id));
      } else {
        await db.insert(crmConnectionsTable).values({
          userId:          statePayload.userId,
          provider,
          accountId:       zohoResult.accountId,
          accountName:     zohoResult.accountName,
          encryptedTokens: encTokens,
        });
      }

      logger.info({ userId: statePayload.userId, provider, accountId: zohoResult.accountId }, "CRM connected");
      const returnOrigin = statePayload.returnOrigin;
      const base = returnOrigin && isTrustedOrigin(returnOrigin) ? returnOrigin : dashBase;
      res.redirect(`${base}/app/connections#crm-connected=${provider}`);
      return;
    } else {
      redirectError(`Unsupported provider: ${provider}`);
      return;
    }

    const encTokens = encryptKey(JSON.stringify(result.tokens));

    // Upsert connection by userId + provider + accountId
    const existing = await db.select({ id: crmConnectionsTable.id })
      .from(crmConnectionsTable)
      .where(and(
        eq(crmConnectionsTable.userId, statePayload.userId),
        eq(crmConnectionsTable.provider, provider),
        eq(crmConnectionsTable.accountId, result.accountId),
      ));

    if (existing.length > 0) {
      await db.update(crmConnectionsTable)
        .set({
          encryptedTokens: encTokens,
          accountName:     result.accountName,
          lastError:       null,
          lastErrorAt:     null,
          updatedAt:       new Date(),
        })
        .where(eq(crmConnectionsTable.id, existing[0]!.id));
    } else {
      await db.insert(crmConnectionsTable).values({
        userId:          statePayload.userId,
        provider,
        accountId:       result.accountId,
        accountName:     result.accountName,
        encryptedTokens: encTokens,
      });
    }

    logger.info({ userId: statePayload.userId, provider, accountId: result.accountId }, "CRM connected");
    // Redirect back to the origin that initiated the flow (if trusted) or fall back to dashboard
    const returnOrigin = statePayload.returnOrigin;
    const base = returnOrigin && isTrustedOrigin(returnOrigin) ? returnOrigin : dashBase;
    res.redirect(`${base}/app/connections#crm-connected=${provider}`);
  } catch (err) {
    logger.error({ err, provider }, "CRM OAuth callback error");
    redirectError(`Failed to connect ${provider}: ${(err as Error).message}`);
  }
});

/* ── GET /crm/connections/:id/lists ──────────────────────────────────────── */

router.get("/crm/connections/:id/lists", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const id     = Number(req.params["id"]);
  const module = (req.query["module"] as string | undefined) === "leads" ? "leads" : "contacts";

  const [conn] = await db.select().from(crmConnectionsTable)
    .where(and(eq(crmConnectionsTable.id, id), eq(crmConnectionsTable.userId, userId)));

  if (!conn) { res.status(404).json({ error: "Connection not found" }); return; }

  try {
    let lists: { id: string; name: string; type?: string; count?: number }[];

    if (conn.provider === "hubspot") {
      lists = await listHubSpotContactLists(id);
    } else if (conn.provider === "zoho") {
      const views = module === "leads"
        ? await listZohoLeadViews(id)
        : await listZohoViews(id);
      lists = views.map(v => ({ id: v.id, name: v.name, type: v.type }));
    } else {
      res.status(400).json({ error: `Unsupported provider: ${conn.provider}` }); return;
    }

    res.json({ lists });
  } catch (err) {
    logger.warn({ err, id, provider: conn.provider }, "CRM lists fetch failed");
    res.status(500).json({ error: (err as Error).message });
  }
});

/* ── GET /crm/connections/:id/contacts ───────────────────────────────────── */

router.get("/crm/connections/:id/contacts", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const id     = Number(req.params["id"]);
  const query  = req.query["query"]  as string | undefined;
  const after  = req.query["after"]  as string | undefined;
  const listId = req.query["listId"] as string | undefined; // HubSpot list ID or Zoho view ID
  const limit  = req.query["limit"]  ? Number(req.query["limit"]) : 50;
  const module = (req.query["module"] as string | undefined) === "leads" ? "leads" : "contacts";

  const [conn] = await db.select().from(crmConnectionsTable)
    .where(and(eq(crmConnectionsTable.id, id), eq(crmConnectionsTable.userId, userId)));

  if (!conn) { res.status(404).json({ error: "Connection not found" }); return; }

  try {
    let page: { contacts: unknown[]; nextCursor: string | null; total: number | null };

    if (conn.provider === "hubspot") {
      page = await listHubSpotContacts(id, { query, after, limit, listId });
    } else if (conn.provider === "zoho") {
      if (module === "leads") {
        page = await listZohoLeads(id, { query, after, limit, viewId: listId });
      } else {
        page = await listZohoContacts(id, { query, after, limit, viewId: listId });
      }
    } else {
      res.status(400).json({ error: `Unsupported provider: ${conn.provider}` });
      return;
    }

    db.update(crmConnectionsTable)
      .set({ lastSyncAt: new Date(), lastError: null })
      .where(eq(crmConnectionsTable.id, id))
      .catch(() => {});

    res.json(page);
  } catch (err) {
    const msg = (err as Error).message;
    logger.error({ err, id, provider: conn.provider }, "CRM contacts list failed");

    db.update(crmConnectionsTable)
      .set({ lastErrorAt: new Date(), lastError: msg })
      .where(eq(crmConnectionsTable.id, id))
      .catch(() => {});

    res.status(500).json({ error: msg });
  }
});

/* ── POST /crm/connections/:id/import ────────────────────────────────────── */

router.post("/crm/connections/:id/import", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const id     = Number(req.params["id"]);

  const [conn] = await db.select().from(crmConnectionsTable)
    .where(and(eq(crmConnectionsTable.id, id), eq(crmConnectionsTable.userId, userId)));

  if (!conn) { res.status(404).json({ error: "CRM connection not found" }); return; }

  const body = req.body as {
    campaignId:      number;
    batchName?:      string;
    contacts:        Array<{
      id: string; phone: string; name: string | null; email: string | null;
      company: string | null; rawFields?: Record<string, string>;
    }>;
    fieldMapping:    Record<string, string>;
    duplicatePolicy?: DuplicatePolicy;
  };

  if (!body.campaignId || !Array.isArray(body.contacts) || body.contacts.length === 0) {
    res.status(400).json({ error: "campaignId and non-empty contacts are required" });
    return;
  }

  // Verify campaign ownership
  const [campaign] = await db.select().from(campaignsTable)
    .where(and(eq(campaignsTable.id, body.campaignId), eq(campaignsTable.userId, userId)));
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }

  // Persist fieldMapping update (if caller passed an updated mapping)
  if (body.fieldMapping && Object.keys(body.fieldMapping).length > 0) {
    db.update(crmConnectionsTable)
      .set({ fieldMapping: body.fieldMapping, updatedAt: new Date() })
      .where(eq(crmConnectionsTable.id, id))
      .catch(() => {});
  }

  const fieldMapping   = body.fieldMapping ?? (conn.fieldMapping as Record<string, string> | null) ?? {};
  const batchName      = body.batchName?.trim() || `${conn.accountName ?? conn.provider} Import ${new Date().toLocaleDateString()}`;
  const duplicatePolicy: DuplicatePolicy = body.duplicatePolicy ?? "skip";

  // Resolve which raw field holds the phone number
  const phoneField = fieldMapping["phone"] ?? "phone";

  // Create batch
  const [batch] = await db.insert(campaignBatchesTable).values({
    campaignId:     body.campaignId,
    name:           batchName,
    leadSource:     conn.provider === "hubspot" ? "hubspot" : "zoho",
    duplicatePolicy,
  } as typeof campaignBatchesTable.$inferInsert).returning();

  let leadsCreated    = 0;
  let duplicatesFound = 0;
  let invalidPhones   = 0;
  let dncBlocked      = 0;

  const toInsert: (typeof campaignLeadsTable.$inferInsert)[] = [];

  for (const contact of body.contacts) {
    // Resolve phone — prefer the mapped raw field, then the structured phone, then any rawField
    const rawPhone = (
      contact.rawFields?.[phoneField] ??
      contact.phone ??
      ""
    ).trim();
    if (!rawPhone) { invalidPhones++; continue; }

    const normResult = normalizePhoneService(rawPhone, INDIA_PHONE_CONFIG);
    if (!normResult.valid || !normResult.normalized) { invalidPhones++; continue; }

    if (await isOnDnc(campaign.userId, normResult.normalized)) { dncBlocked++; continue; }

    const dupResult = await checkDuplicate(db, {
      normalizedPhone: normResult.normalized,
      campaignId:      body.campaignId,
      policy:          duplicatePolicy,
    });

    if (dupResult.action === "skip" || dupResult.action === "reject") { duplicatesFound++; continue; }

    // Build leadData — structured fields + all rawFields + CRM identity for writeback
    const leadData: Record<string, string> = {
      ...(contact.rawFields ?? {}),
      __crm_connection_id: String(id),
      __crm_provider:      conn.provider,
      __crm_contact_id:    contact.id,
    };

    // Apply fieldMapping to store mapped values under expected variable names
    for (const [varName, rawFieldName] of Object.entries(fieldMapping)) {
      if (varName.startsWith("__")) continue; // skip internal keys
      if (rawFieldName && contact.rawFields?.[rawFieldName] !== undefined) {
        leadData[varName] = contact.rawFields[rawFieldName]!;
      }
    }

    if (contact.company) leadData["company"] = contact.company;

    toInsert.push({
      campaignId:      body.campaignId,
      batchId:         batch!.id,
      phone:           rawPhone,
      normalizedPhone: normResult.normalized,
      name:            contact.name ?? null,
      email:           contact.email ?? null,
      leadData,
      source:          conn.provider === "hubspot" ? "hubspot" : "zoho",
      externalLeadId:  contact.id,
    });
  }

  if (toInsert.length > 0) {
    for (let i = 0; i < toInsert.length; i += 100) {
      const chunk = await db.insert(campaignLeadsTable).values(toInsert.slice(i, i + 100)).returning();
      leadsCreated += chunk.length;
      if (chunk.length > 0) {
        await db.insert(leadTimelineTable).values(
          chunk.map(l => ({
            leadId:    l.id,
            campaignId: body.campaignId,
            eventType: "imported",
            data:      { source: conn.provider, crmConnectionId: id, batchId: batch!.id },
          }))
        );
      }
    }
    await db.update(campaignBatchesTable).set({ totalLeads: leadsCreated }).where(eq(campaignBatchesTable.id, batch!.id));
    await db.update(campaignsTable)
      .set({ totalLeads: sql`${campaignsTable.totalLeads} + ${leadsCreated}` })
      .where(eq(campaignsTable.id, body.campaignId));
  }

  db.update(crmConnectionsTable)
    .set({ lastSyncAt: new Date(), lastError: null })
    .where(eq(crmConnectionsTable.id, id))
    .catch(() => {});

  req.log.info({ userId, id, provider: conn.provider, leadsCreated }, "CRM import completed");

  res.json({
    batchId:         batch!.id,
    leadsCreated,
    duplicatesFound,
    invalidPhones,
    dncBlocked,
  });
});

/* ── POST /crm/webhook/zoho/:connectionId (public — no session auth) ─────── */
//
// Zoho fires this when a new Lead arrives (via Automation → Webhooks or a
// Zoho Function). Payload: { "leads": [ { ... } ] }
//
// Security: the request must include the connection's webhookSecret in either:
//   - Header:  X-Zoho-Webhook-Secret: <secret>
//   - Query:   ?secret=<secret>
//
// Verified with timingSafeEqual. If no secret is configured the endpoint
// accepts the request but logs a warning — allows gradual rollout.

router.post("/crm/webhook/zoho/:connectionId", async (req, res): Promise<void> => {
  const connectionId = Number(req.params["connectionId"]);
  if (isNaN(connectionId)) { res.status(400).json({ error: "Invalid connectionId" }); return; }

  const [conn] = await db.select().from(crmConnectionsTable)
    .where(eq(crmConnectionsTable.id, connectionId));

  if (!conn || conn.provider !== "zoho") {
    // Always 200 — don't leak whether the connection ID is valid
    logger.warn({ connectionId }, "Zoho webhook for unknown/wrong-provider connection");
    res.sendStatus(200);
    return;
  }

  // Secret verification — required; connections without a secret reject all requests
  if (!conn.webhookSecret) {
    logger.warn({ connectionId }, "Zoho webhook rejected — no secret configured on connection");
    res.status(403).json({ error: "Webhook secret not configured — generate a secret in the Connections page first" });
    return;
  }

  const providedSecret =
    (req.headers["x-zoho-webhook-secret"] as string | undefined) ??
    (req.query["secret"] as string | undefined);

  if (!providedSecret) {
    logger.warn({ connectionId }, "Zoho webhook missing secret — rejected");
    res.status(401).json({ error: "Missing webhook secret" });
    return;
  }

  let valid = false;
  try {
    const a = Buffer.from(conn.webhookSecret);
    const b = Buffer.from(providedSecret);
    valid = a.length === b.length && timingSafeEqual(a, b);
  } catch {
    valid = false;
  }

  if (!valid) {
    logger.warn({ connectionId }, "Zoho webhook secret mismatch — rejected");
    res.status(401).json({ error: "Invalid webhook secret" });
    return;
  }

  // Ack quickly; process fire-and-forget
  res.sendStatus(200);

  if (!conn.webhookCampaignId) {
    logger.info({ connectionId }, "Zoho webhook received but no campaign configured — lead dropped");
    return;
  }

  const body = req.body as Record<string, unknown>;
  const leads = Array.isArray(body["leads"]) ? (body["leads"] as Array<Record<string, unknown>>) : [];

  if (leads.length === 0) {
    logger.info({ connectionId }, "Zoho webhook payload has no leads array — nothing to process");
    return;
  }

  // Enforce tenant ownership — campaign must belong to the same user as the connection
  const [campaign] = await db.select().from(campaignsTable)
    .where(and(eq(campaignsTable.id, conn.webhookCampaignId), eq(campaignsTable.userId, conn.userId)));

  if (!campaign) {
    logger.warn({ connectionId, campaignId: conn.webhookCampaignId }, "Zoho webhook — campaign not found or belongs to different tenant");
    return;
  }

  for (const lead of leads) {
    void processZohoWebhookLead(lead, conn, campaign).catch((err: unknown) => {
      logger.error({ err, connectionId }, "Failed to process Zoho webhook lead");
    });
  }
});

async function processZohoWebhookLead(
  raw: Record<string, unknown>,
  conn: typeof crmConnectionsTable.$inferSelect,
  campaign: typeof campaignsTable.$inferSelect,
): Promise<void> {
  const leadId = String(raw["id"] ?? raw["ID"] ?? "").trim();
  const rawPhone = String(
    raw["Phone"] ?? raw["phone"] ?? raw["Mobile"] ?? raw["mobile"] ?? ""
  ).trim();

  if (!rawPhone) {
    logger.info({ connectionId: conn.id }, "Zoho webhook lead missing phone — skipped");
    return;
  }

  const normResult = normalizePhoneService(rawPhone, INDIA_PHONE_CONFIG);
  if (!normResult.valid || !normResult.normalized) {
    logger.info({ rawPhone, connectionId: conn.id }, "Zoho webhook lead invalid phone — skipped");
    return;
  }
  const normalized = normResult.normalized;

  // DNC check
  if (await isOnDnc(campaign.userId, normalized)) {
    logger.info({ phone: normalized, connectionId: conn.id }, "Zoho webhook lead blocked by DNC");
    return;
  }

  // Deduplication — externalLeadId first (when Zoho record ID is present)
  if (leadId) {
    const existing = await db.query.campaignLeadsTable.findFirst({
      where: (t, { eq: deq }) => deq(t.externalLeadId, `zoho_lead_${leadId}`),
    });
    if (existing) {
      logger.info({ leadId, connectionId: conn.id }, "Zoho webhook lead already exists by externalLeadId — skipped");
      return;
    }
  }

  // Phone-level campaign-scoped deduplication (same policy the batch import uses)
  const dupResult = await checkDuplicate(db, {
    normalizedPhone: normalized,
    campaignId:      campaign.id,
    policy:          "skip",
  });
  if (dupResult.action === "skip" || dupResult.action === "reject") {
    logger.info({ phone: normalized, campaignId: campaign.id, connectionId: conn.id }, "Zoho webhook lead phone already in campaign — skipped");
    return;
  }

  // Flatten raw fields
  const flatData: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v != null && typeof v !== "object") flatData[k] = String(v);
  }

  const name = [raw["First_Name"], raw["Last_Name"]].filter(Boolean).join(" ").trim() || null;
  const email = String(raw["Email"] ?? "").trim() || null;

  // Find or create today's live batch — same pattern as campaign-webhook
  const { getOrCreateLiveBatch, isWithinBusinessHours } = await import("./campaign-webhook.js");

  // Resolve agent ID — prefer per-connection override, fall back to campaign's agent
  const effectiveAgentId = conn.webhookAgentId ?? campaign.agentId;

  let agentTimezone = campaign.timezone ?? "Asia/Kolkata";
  if (effectiveAgentId) {
    const agent = await db.query.agentsTable.findFirst({
      where: (t, { eq: aeq }) => aeq(t.id, effectiveAgentId),
      columns: { agentConfig: true },
    });
    const tz = (agent?.agentConfig as Record<string, unknown> | null)?.["timezone"];
    if (typeof tz === "string" && tz.length > 0) agentTimezone = tz;
  }

  const targetBatch = await getOrCreateLiveBatch(campaign.id, agentTimezone);

  const [lead] = await db.insert(campaignLeadsTable).values({
    campaignId:      campaign.id,
    batchId:         targetBatch?.id ?? null,
    phone:           rawPhone,
    normalizedPhone: normalized,
    name,
    email,
    leadData:        {
      ...flatData,
      __crm_connection_id: String(conn.id),
      __crm_provider:      "zoho",
      __crm_module:        "leads",
      // Store the effective agent ID so the call uses the right agent
      ...(conn.webhookAgentId ? { __webhook_agent_id: String(conn.webhookAgentId) } : {}),
    },
    source:          "zoho_webhook",
    externalLeadId:  leadId ? `zoho_lead_${leadId}` : null,
    callStatus:      "pending",
  }).returning();

  await db.insert(leadTimelineTable).values({
    leadId:     lead!.id,
    campaignId: campaign.id,
    eventType:  "imported",
    data:       { source: "zoho_webhook", connectionId: conn.id, batchId: targetBatch?.id ?? null },
  });

  await db.update(campaignsTable)
    .set({ totalLeads: sql`${campaignsTable.totalLeads} + 1` })
    .where(eq(campaignsTable.id, campaign.id));

  if (targetBatch) {
    await db.update(campaignBatchesTable)
      .set({ totalLeads: sql`${campaignBatchesTable.totalLeads} + 1` })
      .where(eq(campaignBatchesTable.id, targetBatch.id));

    const isPaused = campaign.status === "paused";
    const inHours  = isWithinBusinessHours(campaign, agentTimezone);

    // Build effective campaign object with optional agent override
    const effectiveCampaign = conn.webhookAgentId
      ? { ...campaign, agentId: conn.webhookAgentId }
      : campaign;

    if (!isPaused && inHours) {
      scheduleCampaignCall(lead!, effectiveCampaign);
      logger.info({ leadId: lead!.id, connectionId: conn.id, agentId: effectiveCampaign.agentId }, "Zoho webhook lead dispatched for immediate dial");
    } else {
      await db.update(campaignLeadsTable)
        .set({ callStatus: "queued" })
        .where(eq(campaignLeadsTable.id, lead!.id));
      logger.info({ leadId: lead!.id, connectionId: conn.id, isPaused, inHours }, "Zoho webhook lead queued");
    }
  }
}

export default router;
