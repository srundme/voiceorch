import { Router, type IRouter } from "express";
import { randomBytes, createHmac } from "crypto";
import { eq, and } from "drizzle-orm";
import { db, webhookEndpointsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { clientContext } from "../middlewares/clientContext.js";
import {
  CreateWebhookEndpointBody,
  UpdateWebhookEndpointBody,
} from "@workspace/api-zod";
import { logger } from "../lib/logger.js";
import { toAbsoluteAppUrl } from "../lib/app-domain.js";
import { shareableRecordingUrl } from "../services/recording-share.js";

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

router.get("/webhook-endpoints", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const rows = await db.select().from(webhookEndpointsTable).where(eq(webhookEndpointsTable.userId, clerkId));
  res.json(rows.map((ep) => formatEndpoint(ep)));
});

router.post("/webhook-endpoints", requireAuth, clientContext, async (req, res): Promise<void> => {
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

router.patch("/webhook-endpoints/:id", requireAuth, clientContext, async (req, res): Promise<void> => {
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

router.delete("/webhook-endpoints/:id", requireAuth, clientContext, async (req, res): Promise<void> => {
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

/** Flatten taxonomy disposition into the shape stored on calls.disposition_result. */
export function flatDispositionFromTaxonomy(result: {
  primary?: string | null;
  sub?: string | null;
  confidence?: number;
  summary?: string;
  evidence?: string;
  flags?: string[];
  needsReview?: boolean;
  domainFields?: Record<string, unknown>;
  error?: string;
} | null | undefined): Record<string, unknown> | null {
  if (!result || result.error || !result.primary || !result.sub) return null;
  const flat: Record<string, unknown> = {
    [result.primary]: result.sub,
    primary: result.primary,
    sub: result.sub,
  };
  if (typeof result.confidence === "number") flat["confidence"] = result.confidence;
  if (result.summary) flat["summary"] = result.summary;
  if (result.evidence) flat["evidence"] = result.evidence;
  if (Array.isArray(result.flags) && result.flags.length) flat["flags"] = result.flags;
  if (typeof result.needsReview === "boolean") flat["needsReview"] = result.needsReview;
  if (result.domainFields && typeof result.domainFields === "object") {
    // Flatten domain scalars onto the top level so call UI / sheets see
    // whatsapp_number=987… instead of a nested blob or prose summary.
    for (const [k, v] of Object.entries(result.domainFields)) {
      if (v == null || v === "") continue;
      if (k in flat) continue;
      flat[k] = v;
    }
  }
  return flat;
}

/** Full call-ended payload for agent + workspace webhooks. */
export function buildCallEndedWebhookPayload(input: {
  callId: number;
  executionId?: string | null;
  agentId: number;
  agentName?: string | null;
  status: string;
  fromNumber?: string | null;
  toNumber?: string | null;
  durationSeconds?: number | null;
  costCents?: number | null;
  transcript?: string | null;
  callSummary?: string | null;
  dispositionResult?: Record<string, unknown> | null;
  successEvaluation?: string | null;
  recordingUrl?: string | null;
  recordingError?: string | null;
  amdResult?: string | null;
  transferType?: string | null;
  transferTarget?: string | null;
  campaignLeadId?: number | null;
  conversationCompleted?: boolean | null;
  primaryLanguage?: string | null;
  memoryRecognized?: boolean | null;
  errorMessage?: string | null;
  avgSttLatencyMs?: number | null;
  avgLlmLatencyMs?: number | null;
  avgTtsLatencyMs?: number | null;
  tokensSaved?: number | null;
  createdAt?: Date | string | null;
  endedAt?: Date | string | null;
  metadata?: string | Record<string, unknown> | null;
}): Record<string, unknown> {
  let meta: Record<string, unknown> | null = null;
  if (input.metadata && typeof input.metadata === "object") {
    meta = input.metadata;
  } else if (typeof input.metadata === "string" && input.metadata.trim()) {
    try {
      meta = JSON.parse(input.metadata) as Record<string, unknown>;
    } catch {
      meta = null;
    }
  }

  const direction =
    (typeof meta?.["direction"] === "string" ? meta["direction"] : null)
    ?? null;

  const iso = (v: Date | string | null | undefined): string | null => {
    if (!v) return null;
    if (v instanceof Date) return v.toISOString();
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
  };

  // External receivers need an absolute, playable URL. Stored values are often
  // relative (`/api/storage/recordings/:id`) and require a login cookie — emit a
  // signed share link instead (same as Sheets writeback).
  let recordingUrl: string | null = null;
  if (input.recordingUrl && String(input.recordingUrl).trim()) {
    try {
      recordingUrl = shareableRecordingUrl(input.callId);
    } catch {
      recordingUrl = toAbsoluteAppUrl(input.recordingUrl) || null;
    }
  }

  return {
    callId: input.callId,
    executionId: input.executionId ?? null,
    agentId: input.agentId,
    agentName: input.agentName ?? null,
    status: input.status,
    direction,
    fromNumber: input.fromNumber ?? null,
    toNumber: input.toNumber ?? null,
    durationSeconds: input.durationSeconds ?? null,
    costCents: input.costCents ?? null,
    transcript: input.transcript ?? null,
    callSummary: input.callSummary ?? null,
    dispositionResult: input.dispositionResult ?? null,
    successEvaluation: input.successEvaluation ?? null,
    recordingUrl,
    recordingError: input.recordingError ?? null,
    amdResult: input.amdResult ?? null,
    transferType: input.transferType ?? null,
    transferTarget: input.transferTarget ?? null,
    campaignLeadId: input.campaignLeadId ?? null,
    conversationCompleted: input.conversationCompleted ?? null,
    primaryLanguage: input.primaryLanguage ?? null,
    memoryRecognized: input.memoryRecognized ?? null,
    errorMessage: input.errorMessage ?? null,
    tokensSaved: input.tokensSaved ?? null,
    avgSttLatencyMs: input.avgSttLatencyMs ?? null,
    avgLlmLatencyMs: input.avgLlmLatencyMs ?? null,
    avgTtsLatencyMs: input.avgTtsLatencyMs ?? null,
    createdAt: iso(input.createdAt),
    endedAt: iso(input.endedAt),
    metadata: meta,
  };
}
