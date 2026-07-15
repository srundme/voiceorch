import { Router, type IRouter } from "express";
import { randomBytes, createHmac } from "crypto";
import { eq, and } from "drizzle-orm";
import { db, webhookEndpointsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import {
  CreateWebhookEndpointBody,
  UpdateWebhookEndpointBody,
} from "@workspace/api-zod";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

function maskSecret(secret: string | null | undefined): string | null {
  if (!secret) return null;
  return `…${secret.slice(-6)}`;
}

function formatEndpoint(
  ep: typeof webhookEndpointsTable.$inferSelect,
  opts?: { includeSecret?: boolean },
) {
  return {
    id: ep.id,
    url: ep.url,
    events: JSON.parse(ep.events) as string[],
    secretHint: maskSecret(ep.secret),
    /** Full signing secret — only returned once on create (or when regenerating). */
    ...(opts?.includeSecret && ep.secret ? { secret: ep.secret } : {}),
    enabled: ep.enabled,
    description: ep.description ?? null,
    createdAt: ep.createdAt.toISOString(),
  };
}

router.get("/webhook-endpoints", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const rows = await db.select().from(webhookEndpointsTable).where(eq(webhookEndpointsTable.userId, clerkId));
  res.json(rows.map((ep) => formatEndpoint(ep)));
});

router.post("/webhook-endpoints", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const parsed = CreateWebhookEndpointBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }
  const secret = parsed.data.secret ?? `whsec_${randomBytes(24).toString("hex")}`;
  const [row] = await db.insert(webhookEndpointsTable).values({
    userId: clerkId,
    url: parsed.data.url,
    events: JSON.stringify(parsed.data.events),
    secret,
    enabled: parsed.data.enabled ?? true,
    description: parsed.data.description ?? null,
  }).returning();
  // Return the full secret once — it is never shown again in list/get.
  res.status(201).json(formatEndpoint(row, { includeSecret: true }));
});

router.patch("/webhook-endpoints/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = UpdateWebhookEndpointBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }

  const updates: Record<string, unknown> = {};
  if (parsed.data.url !== undefined) updates.url = parsed.data.url;
  if (parsed.data.events !== undefined) updates.events = JSON.stringify(parsed.data.events);
  if (parsed.data.secret !== undefined) updates.secret = parsed.data.secret;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;
  if (parsed.data.enabled !== undefined) updates.enabled = parsed.data.enabled;

  const [row] = await db.update(webhookEndpointsTable)
    .set(updates)
    .where(and(eq(webhookEndpointsTable.id, id), eq(webhookEndpointsTable.userId, clerkId)))
    .returning();

  if (!row) { res.status(404).json({ error: "Webhook endpoint not found" }); return; }
  res.json(formatEndpoint(row));
});

router.delete("/webhook-endpoints/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [row] = await db.delete(webhookEndpointsTable)
    .where(and(eq(webhookEndpointsTable.id, id), eq(webhookEndpointsTable.userId, clerkId)))
    .returning();

  if (!row) { res.status(404).json({ error: "Webhook endpoint not found" }); return; }
  res.sendStatus(204);
});

export default router;

/* ── Webhook dispatch helper ─────────────────────────────────────────────── */

type WebhookEvent = "call.started" | "call.completed" | "call.failed";

/** Older UI subscribed to call.ended — treat it as call.completed. */
function eventMatches(subscribed: string[], event: WebhookEvent): boolean {
  if (subscribed.includes(event)) return true;
  if (event === "call.completed" && subscribed.includes("call.ended")) return true;
  return false;
}

export async function dispatchWebhooks(
  userId: string,
  event: WebhookEvent | "call.ended",
  payload: Record<string, unknown>,
): Promise<void> {
  const canonical: WebhookEvent =
    event === "call.ended" ? "call.completed" : event;

  const endpoints = await db.select().from(webhookEndpointsTable)
    .where(and(eq(webhookEndpointsTable.userId, userId), eq(webhookEndpointsTable.enabled, true)));

  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({
    event: canonical,
    timestamp: new Date().toISOString(),
    data: payload,
  });

  for (const ep of endpoints) {
    const events: string[] = JSON.parse(ep.events);
    if (!eventMatches(events, canonical)) continue;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "SnapServe-Webhooks/1.0",
      "X-SnapServe-Timestamp": timestamp,
    };

    if (ep.secret) {
      // HMAC-SHA256 of "{timestamp}.{rawBody}" — same scheme as docs.
      const digest = createHmac("sha256", ep.secret)
        .update(`${timestamp}.${body}`)
        .digest("hex");
      headers["X-SnapServe-Signature"] = `sha256=${digest}`;
      // Back-compat for older receivers that checked the previous header/body-only HMAC.
      headers["X-VoiceOrch-Signature"] = createHmac("sha256", ep.secret).update(body).digest("hex");
    }

    fetch(ep.url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(10_000),
    }).catch((err) => {
      logger.warn({ err, webhookId: ep.id, event: canonical }, "Webhook delivery failed");
    });
  }
}
