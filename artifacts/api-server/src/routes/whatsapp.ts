/**
 * WhatsApp webhook connections — CRUD + public inbound Request-a-Call.
 */

import { Router, type IRouter } from "express";
import { randomBytes } from "crypto";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import {
  db,
  whatsappConnectionsTable,
  agentsTable,
  callsTable,
  campaignsTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { logger } from "../lib/logger.js";
import { getSelfBaseUrl } from "../lib/app-domain.js";
import { normalizePhoneDigits, phonesMatch } from "../services/google-sheets-helpers.js";
import {
  normalizeWhatsappInbound,
  isRequestCallEvent,
} from "../services/whatsapp/normalize.js";
import { dialOutboundAgent, OutboundDialError } from "../services/outbound-agent-dial.js";
import { encryptKey, decryptKey } from "../lib/crypto.js";
import {
  fetchMetaTemplates,
  toTemplateCatalog,
  verifyMetaPhoneNumber,
  type MetaTemplateChoice,
} from "../services/whatsapp/meta.js";

const router: IRouter = Router();

const DEDUPE_WINDOW_MS = 5 * 60_000;

function inboundUrl(token: string): string {
  return `${getSelfBaseUrl()}/api/webhooks/whatsapp/${token}`;
}

function formatConnection(row: typeof whatsappConnectionsTable.$inferSelect, opts?: { includeSecret?: boolean }) {
  return {
    id: row.id,
    name: row.name,
    agentId: row.agentId,
    campaignId: row.campaignId,
    inboundToken: row.inboundToken,
    inboundWebhookUrl: inboundUrl(row.inboundToken),
    outboundWebhookUrl: row.outboundWebhookUrl,
    ...(opts?.includeSecret && row.outboundSecret ? { outboundSecret: row.outboundSecret } : {}),
    outboundSecretHint: row.outboundSecret ? `…${row.outboundSecret.slice(-6)}` : null,
    requestCallEnabled: row.requestCallEnabled,
    postCallEnabled: row.postCallEnabled,
    buttonIds: row.buttonIds ?? [],
    templates: row.templates ?? {},
    metaConnected: Boolean(row.metaAccessToken && row.metaPhoneNumberId),
    metaPhoneNumberId: row.metaPhoneNumberId,
    metaWabaId: row.metaWabaId,
    metaApiBase: row.metaApiBase ?? null,
    metaTemplates: row.metaTemplates ?? {},
    templateCatalog: Array.isArray(row.templateCatalog) ? row.templateCatalog : [],
    active: row.active,
    lastInboundAt: row.lastInboundAt?.toISOString() ?? null,
    lastOutboundAt: row.lastOutboundAt?.toISOString() ?? null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function normalizeTemplates(raw: unknown): {
  default?: string;
  call_summary?: string;
  booking_confirmed?: string;
  callback_scheduled?: string;
} {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const out: {
    default?: string;
    call_summary?: string;
    booking_confirmed?: string;
    callback_scheduled?: string;
  } = {};
  for (const key of ["default", "call_summary", "booking_confirmed", "callback_scheduled"] as const) {
    const v = o[key];
    if (typeof v === "string" && v.trim()) out[key] = v.trim();
  }
  return out;
}

function normalizeMetaTemplates(raw: unknown): Record<string, MetaTemplateChoice> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, MetaTemplateChoice> = {};
  for (const key of ["default", "call_summary", "booking_confirmed", "callback_scheduled"]) {
    const v = (raw as Record<string, unknown>)[key];
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    if (typeof o["name"] === "string" && o["name"].trim() && typeof o["language"] === "string" && o["language"].trim()) {
      out[key] = {
        name: o["name"].trim(),
        language: o["language"].trim(),
        paramCount: Number.isFinite(Number(o["paramCount"])) ? Math.max(0, Number(o["paramCount"])) : 0,
      };
    }
  }
  return out;
}

/** Fetch Meta templates and persist APPROVED catalog on the connection (best-effort). */
async function persistMetaCatalogForConnection(
  connectionId: string,
  userId: string,
  token: string,
  wabaId: string,
  apiBase: string | null,
): Promise<ReturnType<typeof toTemplateCatalog>> {
  const templates = await fetchMetaTemplates(token, wabaId, apiBase);
  const catalog = toTemplateCatalog(templates);
  await db.update(whatsappConnectionsTable)
    .set({ templateCatalog: catalog, updatedAt: new Date() })
    .where(and(
      eq(whatsappConnectionsTable.id, connectionId),
      eq(whatsappConnectionsTable.userId, userId),
    ));
  return catalog;
}

function toE164India(raw: string): string {
  const digits = normalizePhoneDigits(raw.replace(/\D/g, ""));
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (raw.trim().startsWith("+")) return raw.trim();
  return digits ? `+${digits}` : raw.trim();
}

async function recentlyDialed(
  userId: string,
  agentId: number,
  phone: string,
): Promise<boolean> {
  const since = new Date(Date.now() - DEDUPE_WINDOW_MS);
  const recent = await db
    .select({
      toNumber: callsTable.toNumber,
      fromNumber: callsTable.fromNumber,
      metadata: callsTable.metadata,
      createdAt: callsTable.createdAt,
    })
    .from(callsTable)
    .where(and(
      eq(callsTable.userId, userId),
      eq(callsTable.agentId, agentId),
      gte(callsTable.createdAt, since),
      inArray(callsTable.status, ["ringing", "in_progress", "completed", "no_pickup", "failed"]),
    ))
    .limit(40);

  return recent.some((c) => {
    if (phonesMatch(c.toNumber, phone) || phonesMatch(c.fromNumber, phone)) return true;
    try {
      const meta = c.metadata ? JSON.parse(c.metadata) as Record<string, unknown> : {};
      if (meta["source"] === "whatsapp" && typeof meta["whatsappPhone"] === "string") {
        return phonesMatch(meta["whatsappPhone"], phone);
      }
    } catch { /* ignore */ }
    return false;
  });
}

/* ── Authenticated CRUD ─────────────────────────────────────────────────── */

router.get("/whatsapp/connections", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const rows = await db
    .select({
      conn: whatsappConnectionsTable,
      agentName: agentsTable.name,
    })
    .from(whatsappConnectionsTable)
    .leftJoin(agentsTable, eq(whatsappConnectionsTable.agentId, agentsTable.id))
    .where(eq(whatsappConnectionsTable.userId, userId))
    .orderBy(desc(whatsappConnectionsTable.createdAt));

  res.json({
    connections: rows.map((r) => ({
      ...formatConnection(r.conn),
      agentName: r.agentName ?? null,
    })),
  });
});

router.post("/whatsapp/connections", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const body = req.body as {
    name?: string;
    agentId?: number;
    campaignId?: number | null;
    outboundWebhookUrl?: string | null;
    requestCallEnabled?: boolean;
    postCallEnabled?: boolean;
    buttonIds?: string[];
    templates?: Record<string, string>;
    metaAccessToken?: string | null;
    metaPhoneNumberId?: string | null;
    metaWabaId?: string | null;
    metaApiBase?: string | null;
    metaTemplates?: Record<string, unknown>;
  };

  const agentId = Number(body.agentId);
  if (!Number.isFinite(agentId) || agentId <= 0) {
    res.status(400).json({ error: "agentId is required" });
    return;
  }

  const [agent] = await db
    .select({ id: agentsTable.id })
    .from(agentsTable)
    .where(and(eq(agentsTable.id, agentId), eq(agentsTable.userId, userId)))
    .limit(1);
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  if (body.campaignId != null) {
    const [camp] = await db
      .select({ id: campaignsTable.id })
      .from(campaignsTable)
      .where(and(eq(campaignsTable.id, body.campaignId), eq(campaignsTable.userId, userId)))
      .limit(1);
    if (!camp) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
  }

  const inboundToken = randomBytes(20).toString("hex");
  const outboundSecret = `whsec_${randomBytes(24).toString("hex")}`;

  let [row] = await db.insert(whatsappConnectionsTable).values({
    userId,
    name: (body.name ?? "WhatsApp").trim() || "WhatsApp",
    agentId,
    campaignId: body.campaignId ?? null,
    inboundToken,
    outboundWebhookUrl: body.outboundWebhookUrl?.trim() || null,
    outboundSecret,
    requestCallEnabled: body.requestCallEnabled ?? true,
    postCallEnabled: body.postCallEnabled ?? true,
    buttonIds: Array.isArray(body.buttonIds) && body.buttonIds.length > 0
      ? body.buttonIds.map(String)
      : undefined,
    templates: normalizeTemplates(body.templates),
    metaAccessToken: body.metaAccessToken?.replace(/\s+/g, "") ? encryptKey(body.metaAccessToken.replace(/\s+/g, "")) : null,
    metaPhoneNumberId: body.metaPhoneNumberId?.trim() || null,
    metaWabaId: body.metaWabaId?.trim() || null,
    metaApiBase: body.metaApiBase?.trim() || null,
    metaTemplates: normalizeMetaTemplates(body.metaTemplates),
    active: true,
  }).returning();

  // Auto-fetch + persist approved catalog when Meta creds were provided.
  if (row?.metaAccessToken && row.metaWabaId) {
    try {
      const token = decryptKey(row.metaAccessToken);
      const catalog = await persistMetaCatalogForConnection(
        row.id, userId, token, row.metaWabaId, row.metaApiBase,
      );
      row = { ...row, templateCatalog: catalog };
    } catch (err) {
      logger.warn({ err, connectionId: row.id }, "whatsapp: catalog fetch on create failed");
    }
  }

  res.status(201).json(formatConnection(row!, { includeSecret: true }));
});

router.patch("/whatsapp/connections/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const id = String(req.params.id);
  const body = req.body as Record<string, unknown>;

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body["name"] === "string") updates.name = body["name"].trim() || "WhatsApp";
  if (typeof body["outboundWebhookUrl"] === "string" || body["outboundWebhookUrl"] === null) {
    updates.outboundWebhookUrl = typeof body["outboundWebhookUrl"] === "string"
      ? body["outboundWebhookUrl"].trim() || null
      : null;
  }
  if (typeof body["requestCallEnabled"] === "boolean") updates.requestCallEnabled = body["requestCallEnabled"];
  if (typeof body["postCallEnabled"] === "boolean") updates.postCallEnabled = body["postCallEnabled"];
  if (typeof body["active"] === "boolean") updates.active = body["active"];
  if (Array.isArray(body["buttonIds"])) updates.buttonIds = body["buttonIds"].map(String);
  if (body["templates"] !== undefined) updates.templates = normalizeTemplates(body["templates"]);
  if (body["campaignId"] === null) updates.campaignId = null;
  if (typeof body["campaignId"] === "number") updates.campaignId = body["campaignId"];
  if (typeof body["agentId"] === "number") {
    const [agent] = await db
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(and(eq(agentsTable.id, body["agentId"]), eq(agentsTable.userId, userId)))
      .limit(1);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    updates.agentId = body["agentId"];
  }
  if (body["regenerateOutboundSecret"] === true) {
    updates.outboundSecret = `whsec_${randomBytes(24).toString("hex")}`;
  }
  // Meta Cloud API fields. Token: string = set (encrypted), null = disconnect, absent = keep.
  if (typeof body["metaAccessToken"] === "string") {
    updates.metaAccessToken = body["metaAccessToken"].replace(/\s+/g, "") ? encryptKey(body["metaAccessToken"].replace(/\s+/g, "")) : null;
  } else if (body["metaAccessToken"] === null) {
    updates.metaAccessToken = null;
  }
  if (typeof body["metaPhoneNumberId"] === "string" || body["metaPhoneNumberId"] === null) {
    updates.metaPhoneNumberId = typeof body["metaPhoneNumberId"] === "string" ? body["metaPhoneNumberId"].trim() || null : null;
  }
  if (typeof body["metaWabaId"] === "string" || body["metaWabaId"] === null) {
    updates.metaWabaId = typeof body["metaWabaId"] === "string" ? body["metaWabaId"].trim() || null : null;
  }
  if (typeof body["metaApiBase"] === "string" || body["metaApiBase"] === null) {
    updates.metaApiBase = typeof body["metaApiBase"] === "string" ? body["metaApiBase"].trim() || null : null;
  }
  if (body["metaTemplates"] !== undefined) updates.metaTemplates = normalizeMetaTemplates(body["metaTemplates"]);

  let [row] = await db.update(whatsappConnectionsTable)
    .set(updates)
    .where(and(eq(whatsappConnectionsTable.id, id), eq(whatsappConnectionsTable.userId, userId)))
    .returning();

  if (!row) {
    res.status(404).json({ error: "Connection not found" });
    return;
  }

  // Refresh catalog when Meta creds change or catalog is still empty.
  const catalogEmpty = !Array.isArray(row.templateCatalog) || row.templateCatalog.length === 0;
  const metaTouched = body["metaAccessToken"] !== undefined
    || body["metaWabaId"] !== undefined
    || body["metaApiBase"] !== undefined;
  if (row.metaAccessToken && row.metaWabaId && (metaTouched || catalogEmpty)) {
    try {
      const token = decryptKey(row.metaAccessToken);
      const catalog = await persistMetaCatalogForConnection(
        row.id, userId, token, row.metaWabaId, row.metaApiBase,
      );
      row = { ...row, templateCatalog: catalog };
    } catch (err) {
      logger.warn({ err, connectionId: row.id }, "whatsapp: catalog fetch on patch failed");
    }
  }

  res.json(formatConnection(row, {
    includeSecret: body["regenerateOutboundSecret"] === true,
  }));
});

router.delete("/whatsapp/connections/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const id = String(req.params.id);
  const [row] = await db.delete(whatsappConnectionsTable)
    .where(and(eq(whatsappConnectionsTable.id, id), eq(whatsappConnectionsTable.userId, userId)))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Connection not found" });
    return;
  }
  res.sendStatus(204);
});

/**
 * Fetch approved templates from the user's Meta WABA.
 * Creds come either raw from the request (pre-save preview) or from a stored
 * connection (connectionId). Also verifies the phone number ID when given.
 */
router.post("/whatsapp/meta/templates", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const body = req.body as {
    accessToken?: string;
    wabaId?: string;
    phoneNumberId?: string;
    connectionId?: string;
    apiBase?: string;
  };

  // Meta tokens are a single unbroken string — pasted tokens often pick up
  // line breaks / spaces from the Meta UI, which Graph rejects with
  // "Cannot parse access token". Strip ALL whitespace, not just the edges.
  let token = (body.accessToken ?? "").replace(/\s+/g, "");
  let wabaId = (body.wabaId ?? "").trim();
  let phoneNumberId = (body.phoneNumberId ?? "").trim();
  let apiBase = (body.apiBase ?? "").trim();

  if ((!token || !wabaId) && body.connectionId) {
    const [conn] = await db
      .select()
      .from(whatsappConnectionsTable)
      .where(and(
        eq(whatsappConnectionsTable.id, String(body.connectionId)),
        eq(whatsappConnectionsTable.userId, userId),
      ))
      .limit(1);
    if (conn?.metaAccessToken) {
      try {
        token = token || decryptKey(conn.metaAccessToken);
      } catch {
        res.status(400).json({ error: "Saved access token could not be read — please paste it again." });
        return;
      }
      wabaId = wabaId || (conn.metaWabaId ?? "");
      phoneNumberId = phoneNumberId || (conn.metaPhoneNumberId ?? "");
      apiBase = apiBase || (conn.metaApiBase ?? "");
    }
  }

  if (!token || !wabaId) {
    res.status(400).json({ error: "accessToken and wabaId are required (WhatsApp Business Account ID from Meta Business settings)" });
    return;
  }

  try {
    const [templates, phoneCheck] = await Promise.all([
      fetchMetaTemplates(token, wabaId, apiBase || null),
      phoneNumberId ? verifyMetaPhoneNumber(token, phoneNumberId, apiBase || null) : Promise.resolve(null),
    ]);
    if (phoneCheck && !phoneCheck.ok) {
      res.status(400).json({ error: `Phone number ID check failed: ${phoneCheck.error}` });
      return;
    }
    const approved = templates.filter((t) => t.status === "APPROVED");
    const catalog = toTemplateCatalog(templates);
    // Persist catalog on the connection when we know which one was used.
    if (body.connectionId) {
      await db.update(whatsappConnectionsTable)
        .set({ templateCatalog: catalog, updatedAt: new Date() })
        .where(and(
          eq(whatsappConnectionsTable.id, String(body.connectionId)),
          eq(whatsappConnectionsTable.userId, userId),
        ))
        .catch((err) => logger.warn({ err }, "whatsapp-meta: catalog persist failed"));
    }
    res.json({
      templates: approved,
      templateCatalog: catalog,
      allCount: templates.length,
      phone: phoneCheck && phoneCheck.ok
        ? { displayPhone: phoneCheck.displayPhone, verifiedName: phoneCheck.verifiedName }
        : null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err, userId }, "whatsapp-meta: template fetch failed");
    res.status(400).json({ error: msg });
  }
});

/* ── Public inbound webhook ─────────────────────────────────────────────── */

router.post("/webhooks/whatsapp/:token", async (req, res): Promise<void> => {
  const token = String(req.params.token ?? "");
  if (!token) {
    res.status(404).json({ error: "Unknown webhook token" });
    return;
  }

  const [conn] = await db
    .select()
    .from(whatsappConnectionsTable)
    .where(eq(whatsappConnectionsTable.inboundToken, token))
    .limit(1);

  if (!conn || !conn.active) {
    res.status(404).json({ error: "Unknown webhook token" });
    return;
  }

  const event = normalizeWhatsappInbound(req.body);
  if (!event) {
    res.status(400).json({ error: "Could not resolve phone from payload" });
    return;
  }

  if (!conn.requestCallEnabled) {
    res.status(202).json({ ok: true, action: "ignored", reason: "request_call_disabled" });
    return;
  }

  const buttonIds = (conn.buttonIds ?? []) as string[];
  if (!isRequestCallEvent(event, buttonIds)) {
    logger.info(
      { connectionId: conn.id, event: event.event, buttonId: event.buttonId },
      "whatsapp: inbound ignored — not a request-call",
    );
    res.status(202).json({ ok: true, action: "ignored", reason: "not_request_call" });
    return;
  }

  const toNumber = toE164India(event.phone);

  try {
    if (await recentlyDialed(conn.userId, conn.agentId, toNumber)) {
      logger.info({ connectionId: conn.id, toNumber }, "whatsapp: deduped request-call");
      res.status(202).json({ ok: true, action: "deduped" });
      return;
    }

    const result = await dialOutboundAgent({
      userId: conn.userId,
      agentId: conn.agentId,
      toNumber,
      webhookBaseUrl: getSelfBaseUrl(),
      metadata: {
        source: "whatsapp",
        whatsappConnectionId: conn.id,
        whatsappPhone: toNumber,
        whatsappButtonId: event.buttonId ?? null,
        whatsappName: event.name ?? null,
        direction: "outbound",
        ...(event.name ? { caller_name: event.name, customer_name: event.name } : {}),
      },
    });

    await db.update(whatsappConnectionsTable)
      .set({ lastInboundAt: new Date(), lastError: null, updatedAt: new Date() })
      .where(eq(whatsappConnectionsTable.id, conn.id));

    logger.info(
      { connectionId: conn.id, callId: result.callId, toNumber },
      "whatsapp: request-call dialed",
    );

    res.status(202).json({
      ok: true,
      action: "dialed",
      callId: result.callId,
      executionId: result.executionId,
    });
  } catch (err) {
    const msg = err instanceof OutboundDialError ? err.message : (err instanceof Error ? err.message : String(err));
    const status = err instanceof OutboundDialError ? err.status : 500;
    const code = err instanceof OutboundDialError ? err.code : "DIAL_FAILED";
    await db.update(whatsappConnectionsTable)
      .set({ lastError: msg.slice(0, 500), updatedAt: new Date() })
      .where(eq(whatsappConnectionsTable.id, conn.id))
      .catch(() => {});
    logger.warn({ err, connectionId: conn.id, toNumber }, "whatsapp: request-call dial failed");
    res.status(status).json({ error: msg, code });
  }
});

/** Health / docs for the inbound URL (GET). */
router.get("/webhooks/whatsapp/:token", async (req, res): Promise<void> => {
  const token = String(req.params.token ?? "");
  const [conn] = await db
    .select({
      id: whatsappConnectionsTable.id,
      active: whatsappConnectionsTable.active,
      name: whatsappConnectionsTable.name,
    })
    .from(whatsappConnectionsTable)
    .where(eq(whatsappConnectionsTable.inboundToken, token))
    .limit(1);
  if (!conn) {
    res.status(404).json({ error: "Unknown webhook token" });
    return;
  }
  res.json({
    ok: true,
    name: conn.name,
    active: conn.active,
    hint: "POST JSON with phone + event=request_call (or a Request a Call button payload)",
  });
});

export default router;
