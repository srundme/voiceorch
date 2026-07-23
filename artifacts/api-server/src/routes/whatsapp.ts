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
    provider: row.provider,
    vobizWabaId: row.vobizWabaId,
    vobizChannelId: row.vobizChannelId,
    vobizPhone: row.vobizPhone,
    postCallTemplate: row.postCallTemplate,
    midCallEnabled: row.midCallEnabled,
    inboundToken: row.inboundToken,
    inboundWebhookUrl: inboundUrl(row.inboundToken),
    outboundWebhookUrl: row.outboundWebhookUrl,
    ...(opts?.includeSecret && row.outboundSecret ? { outboundSecret: row.outboundSecret } : {}),
    outboundSecretHint: row.outboundSecret ? `…${row.outboundSecret.slice(-6)}` : null,
    requestCallEnabled: row.requestCallEnabled,
    postCallEnabled: row.postCallEnabled,
    buttonIds: row.buttonIds ?? [],
    active: row.active,
    lastInboundAt: row.lastInboundAt?.toISOString() ?? null,
    lastOutboundAt: row.lastOutboundAt?.toISOString() ?? null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
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
    provider?: "vobiz" | "webhook";
    vobizWabaId?: string | null;
    vobizChannelId?: string | null;
    vobizPhone?: string | null;
    postCallTemplate?: string | null;
    midCallEnabled?: boolean;
    outboundWebhookUrl?: string | null;
    requestCallEnabled?: boolean;
    postCallEnabled?: boolean;
    buttonIds?: string[];
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

  const [row] = await db.insert(whatsappConnectionsTable).values({
    userId,
    name: (body.name ?? "WhatsApp").trim() || "WhatsApp",
    agentId,
    campaignId: body.campaignId ?? null,
    provider: body.provider === "vobiz" ? "vobiz" : "webhook",
    vobizWabaId: typeof body.vobizWabaId === "string" ? body.vobizWabaId.trim() : null,
    vobizChannelId: typeof body.vobizChannelId === "string" ? body.vobizChannelId.trim() : null,
    vobizPhone: typeof body.vobizPhone === "string" ? body.vobizPhone.trim() : null,
    postCallTemplate: typeof body.postCallTemplate === "string" ? body.postCallTemplate.trim() : null,
    midCallEnabled: typeof body.midCallEnabled === "boolean" ? body.midCallEnabled : true,
    inboundToken,
    outboundWebhookUrl: body.outboundWebhookUrl?.trim() || null,
    outboundSecret,
    requestCallEnabled: body.requestCallEnabled ?? true,
    postCallEnabled: body.postCallEnabled ?? true,
    buttonIds: Array.isArray(body.buttonIds) && body.buttonIds.length > 0
      ? body.buttonIds.map(String)
      : undefined,
    active: true,
  }).returning();

  res.status(201).json(formatConnection(row!, { includeSecret: true }));
});

router.patch("/whatsapp/connections/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const id = String(req.params.id);
  const body = req.body as Record<string, unknown>;

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body["name"] === "string") updates.name = body["name"].trim() || "WhatsApp";
  if (typeof body["provider"] === "string") updates.provider = body["provider"] === "vobiz" ? "vobiz" : "webhook";
  if (typeof body["vobizWabaId"] === "string" || body["vobizWabaId"] === null) updates.vobizWabaId = body["vobizWabaId"] ? String(body["vobizWabaId"]).trim() : null;
  if (typeof body["vobizChannelId"] === "string" || body["vobizChannelId"] === null) updates.vobizChannelId = body["vobizChannelId"] ? String(body["vobizChannelId"]).trim() : null;
  if (typeof body["vobizPhone"] === "string" || body["vobizPhone"] === null) updates.vobizPhone = body["vobizPhone"] ? String(body["vobizPhone"]).trim() : null;
  if (typeof body["postCallTemplate"] === "string" || body["postCallTemplate"] === null) updates.postCallTemplate = body["postCallTemplate"] ? String(body["postCallTemplate"]).trim() : null;
  if (typeof body["midCallEnabled"] === "boolean") updates.midCallEnabled = body["midCallEnabled"];
  if (typeof body["outboundWebhookUrl"] === "string" || body["outboundWebhookUrl"] === null) {
    updates.outboundWebhookUrl = typeof body["outboundWebhookUrl"] === "string"
      ? body["outboundWebhookUrl"].trim() || null
      : null;
  }
  if (typeof body["requestCallEnabled"] === "boolean") updates.requestCallEnabled = body["requestCallEnabled"];
  if (typeof body["postCallEnabled"] === "boolean") updates.postCallEnabled = body["postCallEnabled"];
  if (typeof body["active"] === "boolean") updates.active = body["active"];
  if (Array.isArray(body["buttonIds"])) updates.buttonIds = body["buttonIds"].map(String);
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

  const [row] = await db.update(whatsappConnectionsTable)
    .set(updates)
    .where(and(eq(whatsappConnectionsTable.id, id), eq(whatsappConnectionsTable.userId, userId)))
    .returning();

  if (!row) {
    res.status(404).json({ error: "Connection not found" });
    return;
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

  // ── Vision: inbound image → store + notify active call ───────────────────
  if (event.media) {
    try {
      const { storeCallMedia, fetchImageFromUrl, isAllowedImageMime } = await import("../services/call-media.js");
      const {
        findActiveSessionByPhone,
        notifySessionIncomingMedia,
      } = await import("../orchestration/session.js");

      let buffer: Buffer | null = null;
      let mimeType = event.media.mimeType ?? "image/jpeg";

      if (event.media.url) {
        const fetched = await fetchImageFromUrl(event.media.url);
        buffer = fetched.buffer;
        mimeType = fetched.mimeType;
      } else if (event.media.mediaId && process.env["WHATSAPP_MEDIA_TOKEN"]) {
        // Meta Cloud media download (optional — requires Graph token in env)
        const metaUrl = `https://graph.facebook.com/v21.0/${event.media.mediaId}`;
        const metaResp = await fetch(metaUrl, {
          headers: { Authorization: `Bearer ${process.env["WHATSAPP_MEDIA_TOKEN"]}` },
          signal: AbortSignal.timeout(15_000),
        });
        if (metaResp.ok) {
          const metaJson = await metaResp.json() as { url?: string; mime_type?: string };
          if (metaJson.url) {
            const bin = await fetch(metaJson.url, {
              headers: { Authorization: `Bearer ${process.env["WHATSAPP_MEDIA_TOKEN"]}` },
              signal: AbortSignal.timeout(30_000),
            });
            if (bin.ok) {
              buffer = Buffer.from(await bin.arrayBuffer());
              mimeType = metaJson.mime_type ?? mimeType;
            }
          }
        }
      }

      if (!buffer || !isAllowedImageMime(mimeType)) {
        logger.info({ connectionId: conn.id, media: event.media }, "whatsapp: image inbound but no downloadable bytes");
        res.status(202).json({ ok: true, action: "image_ignored", reason: "no_media_bytes" });
        return;
      }

      const toNumber = toE164India(event.phone);
      const active = findActiveSessionByPhone(toNumber, conn.agentId);
      const row = await storeCallMedia({
        callId: active?.callId ?? null,
        agentId: conn.agentId,
        userId: conn.userId,
        phone: toNumber,
        source: "whatsapp",
        mimeType,
        fileName: event.media.fileName ?? null,
        buffer,
      });

      if (active) {
        notifySessionIncomingMedia(active.callId, row.id, { source: "whatsapp", mimeType: row.mimeType });
      }

      await db.update(whatsappConnectionsTable)
        .set({ lastInboundAt: new Date(), lastError: null, updatedAt: new Date() })
        .where(eq(whatsappConnectionsTable.id, conn.id));

      logger.info(
        { connectionId: conn.id, mediaId: row.id, callId: active?.callId ?? null, toNumber },
        "whatsapp: image stored for vision",
      );
      res.status(202).json({
        ok: true,
        action: active ? "image_attached" : "image_staged",
        mediaId: row.id,
        callId: active?.callId ?? null,
      });
      return;
    } catch (err) {
      logger.warn({ err, connectionId: conn.id }, "whatsapp: image ingest failed");
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      return;
    }
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
