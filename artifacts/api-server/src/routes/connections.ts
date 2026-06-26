/**
 * Connections Hub — inbound lead source management
 *
 * GET    /connections                         list all connections (campaigns + meta)
 * PATCH  /connections/:campaignId/webhook-config  update HMAC secret / field mappings
 * POST   /connections/:campaignId/listen/start    begin listening for a test event (60 s)
 * GET    /connections/:campaignId/listen/poll      poll for captured sample payload
 * DELETE /connections/:campaignId/listen/stop      stop listening
 */

import { Router, type IRouter, type Request } from "express";
import { eq, and, desc } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import {
  db,
  campaignsTable,
  metaIntegrationsTable,
  agentsTable,
  type CampaignFieldMappings,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { getSelfBaseUrl } from "../lib/app-domain.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

/* ── In-memory listen session store ─────────────────────────────────────── */

interface ListenSession {
  userId: string;
  campaignId: number;
  startedAt: Date;
  expiresAt: Date;
  capturedPayload: Record<string, unknown> | null;
  flatFields: Record<string, string> | null;
  capturedAt: Date | null;
}

const listenSessions = new Map<number, ListenSession>();
const LISTEN_TTL_MS = 120_000; // 2 minutes

// Cleanup expired sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [campaignId, session] of listenSessions) {
    if (session.expiresAt.getTime() < now) {
      listenSessions.delete(campaignId);
    }
  }
}, 30_000);

/** Called by campaign-webhook.ts when a payload arrives and a listen session is active. */
export function captureListenSample(
  campaignId: number,
  payload: Record<string, unknown>,
  flatFields: Record<string, string>,
): boolean {
  const session = listenSessions.get(campaignId);
  if (!session || session.expiresAt.getTime() < Date.now()) {
    listenSessions.delete(campaignId);
    return false;
  }
  if (session.capturedPayload !== null) return false; // already captured
  session.capturedPayload = payload;
  session.flatFields = flatFields;
  session.capturedAt = new Date();
  return true;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function maskSecret(secret: string | null | undefined): string | null {
  if (!secret) return null;
  return `…${secret.slice(-6)}`;
}

function flattenObject(obj: unknown, prefix = ""): Record<string, string> {
  if (typeof obj !== "object" || obj === null) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      Object.assign(out, flattenObject(v, key));
    } else if (Array.isArray(v)) {
      out[key] = v.map(String).join(",");
    } else {
      out[key] = String(v ?? "");
    }
  }
  return out;
}

function deriveStatus(
  lastAt: Date | null | undefined,
  lastStatus: string | null | undefined,
): "connected" | "waiting" | "error" {
  if (!lastAt) return "waiting";
  if (lastStatus === "error") return "error";
  return "connected";
}

/* ── GET /connections ────────────────────────────────────────────────────── */

router.get("/connections", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const baseUrl = getSelfBaseUrl();

  // Fetch all campaigns for user (webhook connections)
  const campaigns = await db
    .select({
      id:               campaignsTable.id,
      name:             campaignsTable.name,
      webhookToken:     campaignsTable.webhookToken,
      fieldMappings:    campaignsTable.fieldMappings,
      hmacSecret:       campaignsTable.hmacSecret,
      lastWebhookAt:    campaignsTable.lastWebhookAt,
      lastWebhookStatus: campaignsTable.lastWebhookStatus,
      createdAt:        campaignsTable.createdAt,
      agentId:          campaignsTable.agentId,
    })
    .from(campaignsTable)
    .where(eq(campaignsTable.userId, userId))
    .orderBy(desc(campaignsTable.createdAt));

  // Fetch agent system prompts for preview
  const agentIds = [...new Set(campaigns.map(c => c.agentId).filter(Boolean))] as number[];
  const agentMap = new Map<number, string>();
  if (agentIds.length > 0) {
    const agents = await db
      .select({ id: agentsTable.id, systemPrompt: agentsTable.systemPrompt })
      .from(agentsTable)
      .where(eq(agentsTable.userId, userId));
    for (const a of agents) {
      if (a.systemPrompt) agentMap.set(a.id, a.systemPrompt);
    }
  }

  // Fetch meta integrations
  const metaRows = await db
    .select({
      id:          metaIntegrationsTable.id,
      pageName:    metaIntegrationsTable.pageName,
      formName:    metaIntegrationsTable.formName,
      webhookToken: metaIntegrationsTable.webhookToken,
      active:      metaIntegrationsTable.active,
      createdAt:   metaIntegrationsTable.createdAt,
    })
    .from(metaIntegrationsTable)
    .where(eq(metaIntegrationsTable.userId, userId))
    .orderBy(desc(metaIntegrationsTable.createdAt));

  const webhookConnections = campaigns.map(c => ({
    id:              c.id,
    type:            "webhook" as const,
    name:            c.name,
    campaignId:      c.id,
    webhookUrl:      `${baseUrl}/api/webhooks/lead/${c.webhookToken}`,
    webhookToken:    c.webhookToken,
    hmacSecretHint:  maskSecret(c.hmacSecret),
    hasHmacSecret:   !!c.hmacSecret,
    status:          deriveStatus(c.lastWebhookAt, c.lastWebhookStatus),
    lastEventAt:     c.lastWebhookAt?.toISOString() ?? null,
    lastEventStatus: c.lastWebhookStatus ?? null,
    fieldMappings:   c.fieldMappings as Record<string, string> | null,
    agentSystemPrompt: c.agentId ? (agentMap.get(c.agentId) ?? null) : null,
    createdAt:       c.createdAt.toISOString(),
  }));

  const metaConnections = metaRows.map((m, idx) => ({
    id:              m.id + 100000, // offset to avoid collision with campaign IDs in UI
    type:            "meta_lead_ads" as const,
    name:            m.formName ?? m.pageName ?? `Meta Form ${idx + 1}`,
    campaignId:      null,
    webhookUrl:      `${baseUrl}/api/meta/webhook/${m.webhookToken}`,
    webhookToken:    m.webhookToken,
    hmacSecretHint:  null,
    hasHmacSecret:   false,
    status:          m.active ? ("waiting" as const) : ("waiting" as const),
    lastEventAt:     null,
    lastEventStatus: null,
    fieldMappings:   null,
    agentSystemPrompt: null,
    createdAt:       m.createdAt.toISOString(),
  }));

  res.json([...webhookConnections, ...metaConnections]);
});

/* ── PATCH /connections/:campaignId/webhook-config ───────────────────────── */

router.patch("/connections/:campaignId/webhook-config", requireAuth, async (req, res): Promise<void> => {
  const userId     = (req as any).clerkUserId as string;
  const campaignId = Number(req.params["campaignId"]);
  const body = req.body as {
    hmacSecret?: string | null;
    fieldMappings?: Record<string, string> | null;
  };

  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, userId)));

  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  const updates: Partial<typeof campaignsTable.$inferInsert> = {};
  if ("hmacSecret" in body) {
    updates.hmacSecret = body.hmacSecret ?? null;
  }
  if ("fieldMappings" in body && body.fieldMappings !== undefined) {
    updates.fieldMappings = (body.fieldMappings ?? { phone: "phone" }) as CampaignFieldMappings;
  }

  if (Object.keys(updates).length > 0) {
    await db
      .update(campaignsTable)
      .set(updates)
      .where(eq(campaignsTable.id, campaignId));
  }

  req.log.info({ userId, campaignId }, "Connection webhook-config updated");
  const baseUrl = getSelfBaseUrl();
  const updated = { ...campaign, ...updates };
  res.json({
    id:              updated.id,
    type:            "webhook",
    name:            updated.name,
    campaignId:      updated.id,
    webhookUrl:      `${baseUrl}/api/webhooks/lead/${updated.webhookToken}`,
    webhookToken:    updated.webhookToken,
    hmacSecretHint:  maskSecret(updated.hmacSecret),
    hasHmacSecret:   !!updated.hmacSecret,
    status:          deriveStatus(updated.lastWebhookAt, updated.lastWebhookStatus),
    lastEventAt:     updated.lastWebhookAt?.toISOString() ?? null,
    lastEventStatus: updated.lastWebhookStatus ?? null,
    fieldMappings:   updated.fieldMappings as Record<string, string> | null,
    agentSystemPrompt: null,
    createdAt:       updated.createdAt.toISOString(),
  });
});

/* ── POST /connections/:campaignId/listen/start ──────────────────────────── */

router.post("/connections/:campaignId/listen/start", requireAuth, async (req, res): Promise<void> => {
  const userId     = (req as any).clerkUserId as string;
  const campaignId = Number(req.params["campaignId"]);

  const [campaign] = await db
    .select({ id: campaignsTable.id, userId: campaignsTable.userId })
    .from(campaignsTable)
    .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, userId)));

  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + LISTEN_TTL_MS);

  listenSessions.set(campaignId, {
    userId,
    campaignId,
    startedAt:      now,
    expiresAt,
    capturedPayload: null,
    flatFields:      null,
    capturedAt:      null,
  });

  req.log.info({ userId, campaignId }, "Listen session started");
  res.json({
    campaignId,
    startedAt:  now.toISOString(),
    expiresAt:  expiresAt.toISOString(),
  });
});

/* ── GET /connections/:campaignId/listen/poll ────────────────────────────── */

router.get("/connections/:campaignId/listen/poll", requireAuth, async (req, res): Promise<void> => {
  const userId     = (req as any).clerkUserId as string;
  const campaignId = Number(req.params["campaignId"]);

  const session = listenSessions.get(campaignId);
  if (!session || session.userId !== userId) {
    res.status(404).json({ error: "No active listen session" });
    return;
  }

  if (session.expiresAt.getTime() < Date.now()) {
    listenSessions.delete(campaignId);
    res.json({ status: "expired", campaignId });
    return;
  }

  if (session.capturedPayload !== null) {
    res.json({
      status:      "captured",
      campaignId,
      capturedAt:  session.capturedAt?.toISOString() ?? null,
      payload:     session.capturedPayload,
      flatFields:  session.flatFields ?? {},
    });
    return;
  }

  res.json({ status: "waiting", campaignId, capturedAt: null, payload: null, flatFields: null });
});

/* ── DELETE /connections/:campaignId/listen/stop ─────────────────────────── */

router.delete("/connections/:campaignId/listen/stop", requireAuth, async (req, res): Promise<void> => {
  const userId     = (req as any).clerkUserId as string;
  const campaignId = Number(req.params["campaignId"]);

  const session = listenSessions.get(campaignId);
  if (session && session.userId === userId) {
    listenSessions.delete(campaignId);
  }

  res.sendStatus(204);
});

export default router;
