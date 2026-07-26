/**
 * Native VoBiz WhatsApp — channel enrollment (shared/own tier), message log,
 * test send, and the VoBiz webhook receiver (message.status / message.inbound).
 */

import { Router, type IRouter } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import {
  db,
  agentsTable,
  whatsappChannelsTable,
  whatsappMessagesTable,
  whatsappEventsTable,
  type WhatsappChannel,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { logger } from "../lib/logger.js";
import { getSelfBaseUrl } from "../lib/app-domain.js";
import { dialOutboundAgent, OutboundDialError } from "../services/outbound-agent-dial.js";
import {
  VOBIZ_API_BASE,
  vobizApiHeaders,
  getMasterVobizCreds,
  getSharedChannelConfig,
  getActiveChannel,
  resolveSendContext,
  sendWhatsappTemplate,
  countRecentOutbound,
  toPlusE164,
} from "../services/whatsapp/vobiz.js";

const router: IRouter = Router();

const REQUEST_CALL_RE = /\b(call\s*me|call\s*back|callback|request\s+a?\s*call|talk\s+to\s+(someone|agent|human)|baat\s*kar)\b/i;
const REQUEST_CALL_BUTTONS = new Set([
  "request_a_call", "request_call", "request call", "call_me", "call me", "call back", "callback",
]);

function formatChannel(row: WhatsappChannel) {
  return {
    id: row.id,
    mode: row.mode,
    businessName: row.businessName,
    notifyBookingConfirmed: row.notifyBookingConfirmed,
    notifyCallSummary: row.notifyCallSummary,
    notifyCallbackScheduled: row.notifyCallbackScheduled,
    inboundAgentId: row.inboundAgentId,
    dailyCap: row.dailyCap,
    wabaId: row.wabaId,
    phoneNumberId: row.phoneNumberId,
    phoneE164: row.phoneE164,
    vobizChannelId: row.vobizChannelId,
    accessTokenLast4: row.accessTokenLast4,
    status: row.status,
    lastError: row.lastError,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function validateAgentOwnership(userId: string, agentId: number): Promise<boolean> {
  const [agent] = await db
    .select({ id: agentsTable.id })
    .from(agentsTable)
    .where(and(eq(agentsTable.id, agentId), eq(agentsTable.userId, userId)))
    .limit(1);
  return !!agent;
}

async function getOwnCredsFor(userId: string): Promise<{ authId: string; authToken: string } | null> {
  try {
    const { ensureVobizSubAccount } = await import("./kyc.js");
    const creds = await ensureVobizSubAccount(userId);
    if (creds.authId && creds.authToken) return creds;
  } catch (err) {
    logger.warn({ err, userId }, "whatsapp-native: sub-account creds unavailable — falling back to master");
  }
  return getMasterVobizCreds();
}

/* ── Authenticated channel management ───────────────────────────────────── */

router.get("/whatsapp/channel", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const [row] = await db
    .select()
    .from(whatsappChannelsTable)
    .where(eq(whatsappChannelsTable.userId, userId))
    .limit(1);
  const shared = await getSharedChannelConfig();
  let usage: { used24h: number; cap: number } | null = null;
  if (row) usage = { used24h: await countRecentOutbound(row.id), cap: row.dailyCap };
  res.json({
    channel: row ? formatChannel(row) : null,
    sharedTierAvailable: !!shared && !!getMasterVobizCreds(),
    usage,
  });
});

/** Enroll (or switch) to the zero-setup shared SnapServe channel. */
router.post("/whatsapp/channel/shared", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const body = req.body as {
    businessName?: string;
    inboundAgentId?: number | null;
    notifyBookingConfirmed?: boolean;
    notifyCallSummary?: boolean;
    notifyCallbackScheduled?: boolean;
    switch?: boolean;
  };

  const businessName = (body.businessName ?? "").trim();
  if (!businessName) {
    res.status(400).json({ error: "businessName is required — it appears inside the WhatsApp messages" });
    return;
  }
  if (body.inboundAgentId != null && !(await validateAgentOwnership(userId, Number(body.inboundAgentId)))) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  const shared = await getSharedChannelConfig();
  if (!shared || !getMasterVobizCreds()) {
    res.status(503).json({ error: "Shared WhatsApp channel is not configured yet — contact support or connect your own channel" });
    return;
  }

  const [existing] = await db.select().from(whatsappChannelsTable)
    .where(eq(whatsappChannelsTable.userId, userId)).limit(1);
  if (existing?.mode === "own" && existing.active && existing.vobizChannelId && body.switch !== true) {
    res.status(409).json({ error: "You have your own WhatsApp channel connected. Disconnect it first (or pass switch: true) to move to the shared channel." });
    return;
  }

  const values = {
    userId,
    mode: "shared" as const,
    businessName: businessName.slice(0, 120),
    inboundAgentId: body.inboundAgentId ?? null,
    notifyBookingConfirmed: body.notifyBookingConfirmed ?? true,
    notifyCallSummary: body.notifyCallSummary ?? true,
    notifyCallbackScheduled: body.notifyCallbackScheduled ?? true,
    status: "active",
    active: true,
    lastError: null as string | null,
    // switching from own → shared clears own-channel fields
    vobizChannelId: null as string | null,
    wabaId: null as string | null,
    phoneNumberId: null as string | null,
    phoneE164: null as string | null,
    accessTokenLast4: null as string | null,
    updatedAt: new Date(),
  };
  const [row] = await db.insert(whatsappChannelsTable)
    .values(values)
    .onConflictDoUpdate({ target: whatsappChannelsTable.userId, set: values })
    .returning();
  logger.info({ userId }, "whatsapp-native: enrolled in shared tier");
  res.status(201).json(formatChannel(row!));
});

/** Connect the user's own WABA/number as a VoBiz channel (upgrade path). */
router.post("/whatsapp/channel/own", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const body = req.body as {
    businessName?: string;
    wabaId?: string;
    phoneNumberId?: string;
    phoneE164?: string;
    accessToken?: string;
    vobizChannelId?: string; // already created in VoBiz console — just link it
    inboundAgentId?: number | null;
  };

  const wabaId = (body.wabaId ?? "").trim();
  const phoneNumberId = (body.phoneNumberId ?? "").trim();
  const phoneE164 = (body.phoneE164 ?? "").trim();
  const accessToken = (body.accessToken ?? "").trim();
  const providedChannelId = (body.vobizChannelId ?? "").trim();

  if (!providedChannelId && (!wabaId || !phoneNumberId || !accessToken)) {
    res.status(400).json({ error: "Provide either vobizChannelId (existing VoBiz channel) or wabaId + phoneNumberId + accessToken" });
    return;
  }
  if (providedChannelId && !wabaId) {
    res.status(400).json({ error: "wabaId is required when linking an existing VoBiz channel — sends need it" });
    return;
  }
  if (providedChannelId) {
    const sharedCfg = await getSharedChannelConfig();
    if (sharedCfg && providedChannelId === sharedCfg.channelId) {
      res.status(400).json({ error: "That channel id is the platform shared channel — enroll in the shared tier instead" });
      return;
    }
  }
  if (body.inboundAgentId != null && !(await validateAgentOwnership(userId, Number(body.inboundAgentId)))) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  let vobizChannelId = providedChannelId;
  let lastError: string | null = null;
  let status = "active";

  if (!vobizChannelId) {
    // Strict: own-channel creation must happen under the user's OWN sub-account,
    // never the master account, or the channel lands in the wrong VoBiz account.
    let creds: { authId: string; authToken: string } | null = null;
    try {
      const { ensureVobizSubAccount } = await import("./kyc.js");
      const c = await ensureVobizSubAccount(userId);
      if (c.authId && c.authToken) creds = c;
    } catch (err) {
      logger.warn({ err, userId }, "whatsapp-native: sub-account resolution failed for own-channel create");
    }
    if (!creds) {
      res.status(503).json({ error: "Could not prepare your VoBiz sub-account — please try again shortly" });
      return;
    }
    try {
      const resp = await fetch(`${VOBIZ_API_BASE}/channels/whatsapp`, {
        method: "POST",
        headers: vobizApiHeaders(creds.authId, creds.authToken),
        body: JSON.stringify({
          number_onboarding_mode: "bring_your_own",
          waba_id: wabaId,
          phone_number_id: phoneNumberId,
          access_token: accessToken,
          ...(phoneE164 ? { phone_number: toPlusE164(phoneE164) } : {}),
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const text = await resp.text().catch(() => "");
      if (!resp.ok) {
        res.status(502).json({ error: `VoBiz channel create failed (HTTP ${resp.status}): ${text.slice(0, 300)}` });
        return;
      }
      try {
        const j = JSON.parse(text) as Record<string, any>;
        const ch = j["channel"] ?? j["data"] ?? j;
        vobizChannelId = ch?.["id"] != null ? String(ch["id"]) : "";
        if (typeof ch?.["status"] === "string" && ch["status"] !== "active") status = "pending";
      } catch { /* fallthrough */ }
      if (!vobizChannelId) {
        res.status(502).json({ error: "VoBiz channel create returned no channel id" });
        return;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: `VoBiz channel create error: ${msg}` });
      return;
    }
  }

  const values = {
    userId,
    mode: "own" as const,
    businessName: (body.businessName ?? "").trim().slice(0, 120),
    inboundAgentId: body.inboundAgentId ?? null,
    vobizChannelId,
    wabaId: wabaId || null,
    phoneNumberId: phoneNumberId || null,
    phoneE164: phoneE164 ? toPlusE164(phoneE164) : null,
    accessTokenLast4: accessToken ? accessToken.slice(-4) : null,
    status,
    lastError,
    active: true,
    updatedAt: new Date(),
  };
  if (vobizChannelId) {
    const [claimed] = await db.select({ id: whatsappChannelsTable.id, userId: whatsappChannelsTable.userId })
      .from(whatsappChannelsTable)
      .where(eq(whatsappChannelsTable.vobizChannelId, vobizChannelId))
      .limit(1);
    if (claimed && claimed.userId !== userId) {
      res.status(409).json({ error: "That VoBiz channel is already connected to another account" });
      return;
    }
  }
  let row: WhatsappChannel | undefined;
  try {
    [row] = await db.insert(whatsappChannelsTable)
      .values(values)
      .onConflictDoUpdate({ target: whatsappChannelsTable.userId, set: values })
      .returning();
  } catch (err) {
    const code = (err as any)?.cause?.code ?? (err as any)?.code;
    if (code === "23505") {
      res.status(409).json({ error: "That VoBiz channel is already connected to another account" });
      return;
    }
    throw err;
  }
  logger.info({ userId, vobizChannelId }, "whatsapp-native: own channel connected");
  res.status(201).json(formatChannel(row!));
});

router.patch("/whatsapp/channel", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const body = req.body as Record<string, unknown>;
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (typeof body["businessName"] === "string") updates.businessName = body["businessName"].trim().slice(0, 120);
  for (const k of ["notifyBookingConfirmed", "notifyCallSummary", "notifyCallbackScheduled", "active"] as const) {
    if (typeof body[k] === "boolean") updates[k] = body[k];
  }
  if (body["inboundAgentId"] === null) updates.inboundAgentId = null;
  if (typeof body["inboundAgentId"] === "number") {
    if (!(await validateAgentOwnership(userId, body["inboundAgentId"]))) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    updates.inboundAgentId = body["inboundAgentId"];
  }

  const [row] = await db.update(whatsappChannelsTable)
    .set(updates)
    .where(eq(whatsappChannelsTable.userId, userId))
    .returning();
  if (!row) {
    res.status(404).json({ error: "No WhatsApp channel enrolled" });
    return;
  }
  res.json(formatChannel(row));
});

router.delete("/whatsapp/channel", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const [row] = await db.update(whatsappChannelsTable)
    .set({ active: false, updatedAt: new Date() })
    .where(eq(whatsappChannelsTable.userId, userId))
    .returning();
  if (!row) {
    res.status(404).json({ error: "No WhatsApp channel enrolled" });
    return;
  }
  res.sendStatus(204);
});

router.get("/whatsapp/native/messages", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const limit = Math.min(Math.max(Number(req.query["limit"]) || 50, 1), 200);
  const rows = await db
    .select()
    .from(whatsappMessagesTable)
    .where(eq(whatsappMessagesTable.userId, userId))
    .orderBy(desc(whatsappMessagesTable.createdAt))
    .limit(limit);
  res.json({
    messages: rows.map((m) => ({
      id: m.id,
      callId: m.callId,
      direction: m.direction,
      phone: m.phone,
      msgType: m.msgType,
      templateName: m.templateName,
      bodyPreview: m.bodyPreview,
      status: m.status,
      errorMessage: m.errorMessage,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    })),
  });
});

/** Send yourself a test template to validate the setup end-to-end. */
router.post("/whatsapp/native/test", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const phone = String((req.body as any)?.phone ?? "").trim();
  if (!phone) {
    res.status(400).json({ error: "phone is required" });
    return;
  }
  const channel = await getActiveChannel(userId);
  if (!channel) {
    res.status(404).json({ error: "No active WhatsApp channel — enroll first" });
    return;
  }
  const ctx = await resolveSendContext(channel, () => getOwnCredsFor(userId));
  if ("error" in ctx) {
    res.status(503).json({ error: ctx.error });
    return;
  }
  const result = await sendWhatsappTemplate({
    channel,
    ctx,
    toPhone: phone,
    hint: "call_summary",
    params: [
      channel.businessName || "SnapServe",
      "This is a test message from your SnapServe WhatsApp integration — you're all set!",
    ],
  });
  if (!result.ok) {
    res.status(result.skipped === "daily_cap" ? 429 : 502).json({ error: result.error, skipped: result.skipped });
    return;
  }
  res.json({ ok: true, messageId: result.messageRowId });
});

/* ── VoBiz webhook receiver ─────────────────────────────────────────────── */

const STATUS_RANK: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3 };
let warnedNoSecret = false;

function verifyVobizWaSignature(req: import("express").Request): boolean {
  const secret = process.env["VOBIZ_WA_WEBHOOK_SECRET"];
  if (!secret) {
    if (process.env["NODE_ENV"] === "production") {
      if (!warnedNoSecret) {
        warnedNoSecret = true;
        logger.error("whatsapp-native: VOBIZ_WA_WEBHOOK_SECRET not set in production — rejecting VoBiz WhatsApp webhooks (fail-closed)");
      }
      return false;
    }
    if (!warnedNoSecret) {
      warnedNoSecret = true;
      logger.warn("whatsapp-native: VOBIZ_WA_WEBHOOK_SECRET not set — webhook signature verification DISABLED (dev only)");
    }
    return true;
  }
  const header = String(req.headers["x-webhook-signature"] ?? "");
  const raw = (req as any).rawBody as Buffer | undefined;
  if (!header || !raw) return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(header, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handleStatusEvent(data: Record<string, any>): Promise<void> {
  // Meta-style: data.statuses[] with {id (wamid), status, errors?}; also accept
  // a flat {message_id, meta_message_id, status} shape.
  const updates: Array<{ wamid?: string; vobizId?: string; status: string; error?: string }> = [];
  const statuses = Array.isArray(data["statuses"]) ? data["statuses"] : null;
  if (statuses) {
    for (const s of statuses) {
      if (!s || typeof s["status"] !== "string") continue;
      const err = Array.isArray(s["errors"]) && s["errors"][0]
        ? String(s["errors"][0]["title"] ?? s["errors"][0]["message"] ?? JSON.stringify(s["errors"][0])).slice(0, 400)
        : undefined;
      updates.push({ wamid: s["id"] != null ? String(s["id"]) : undefined, status: s["status"], error: err });
    }
  } else if (typeof data["status"] === "string") {
    updates.push({
      wamid: data["meta_message_id"] != null ? String(data["meta_message_id"]) : undefined,
      vobizId: data["message_id"] != null ? String(data["message_id"]) : (data["id"] != null ? String(data["id"]) : undefined),
      status: data["status"],
      error: data["error"] != null ? String(data["error"]).slice(0, 400) : undefined,
    });
  }

  for (const u of updates) {
    const cond = u.wamid
      ? eq(whatsappMessagesTable.metaMessageId, u.wamid)
      : u.vobizId
        ? eq(whatsappMessagesTable.vobizMessageId, u.vobizId)
        : null;
    if (!cond) continue;
    const [row] = await db.select().from(whatsappMessagesTable).where(cond).limit(1);
    if (!row) {
      logger.info({ wamid: u.wamid, vobizId: u.vobizId, status: u.status }, "whatsapp-native: status for unknown message");
      continue;
    }
    if (u.status === "failed") {
      await db.update(whatsappMessagesTable)
        .set({ status: "failed", errorMessage: u.error ?? row.errorMessage, updatedAt: new Date() })
        .where(eq(whatsappMessagesTable.id, row.id));
      continue;
    }
    const newRank = STATUS_RANK[u.status];
    const oldRank = STATUS_RANK[row.status] ?? 0;
    if (newRank === undefined || newRank <= oldRank) continue; // never downgrade
    await db.update(whatsappMessagesTable)
      .set({ status: u.status, ...(u.wamid && !row.metaMessageId ? { metaMessageId: u.wamid } : {}), updatedAt: new Date() })
      .where(eq(whatsappMessagesTable.id, row.id));
  }
}

async function handleInboundEvent(data: Record<string, any>): Promise<void> {
  const msg = (data["message"] ?? data) as Record<string, any>;
  const fromRaw = msg["from"] ?? msg["phone"] ?? data["from"];
  if (!fromRaw) return;
  const phone = toPlusE164(String(fromRaw));
  const channelIdRaw = data["channel_id"] ?? msg["channel_id"];
  const vobizChannelId = channelIdRaw != null ? String(channelIdRaw) : null;

  const textBody = typeof msg["text"] === "string"
    ? msg["text"]
    : (msg["text"]?.["body"] != null ? String(msg["text"]["body"]) : "");
  const buttonId = msg["button"]?.["payload"] ?? msg["button"]?.["text"]
    ?? msg["interactive"]?.["button_reply"]?.["id"] ?? null;
  const metaMessageId = msg["id"] != null ? String(msg["id"]) : null;

  // Resolve which user this inbound belongs to.
  let channel: WhatsappChannel | null = null;
  if (vobizChannelId) {
    const [own] = await db.select().from(whatsappChannelsTable)
      .where(and(
        eq(whatsappChannelsTable.vobizChannelId, vobizChannelId),
        eq(whatsappChannelsTable.active, true),
      )).limit(1);
    channel = own ?? null;
  }
  if (!channel) {
    // Shared channel: attribute via the most recent outbound to this phone (7d).
    const since = new Date(Date.now() - 7 * 24 * 3600_000);
    const [recent] = await db.select().from(whatsappMessagesTable)
      .where(and(
        eq(whatsappMessagesTable.phone, phone),
        eq(whatsappMessagesTable.direction, "outbound"),
        gt(whatsappMessagesTable.createdAt, since),
      ))
      .orderBy(desc(whatsappMessagesTable.createdAt))
      .limit(1);
    if (recent) {
      const [byUser] = await db.select().from(whatsappChannelsTable)
        .where(eq(whatsappChannelsTable.id, recent.channelId)).limit(1);
      channel = byUser ?? null;
    }
  }
  if (!channel) {
    logger.info({ phone, vobizChannelId }, "whatsapp-native: inbound could not be attributed — ignored");
    return;
  }

  await db.insert(whatsappMessagesTable).values({
    userId: channel.userId,
    channelId: channel.id,
    direction: "inbound",
    phone,
    msgType: buttonId ? "template" : "text",
    bodyPreview: (buttonId ? `[button] ${buttonId}` : textBody).slice(0, 300),
    status: "received",
    metaMessageId,
  });

  // Request-a-call intent → dial the configured agent.
  const wantsCall = (buttonId && REQUEST_CALL_BUTTONS.has(String(buttonId).toLowerCase().trim()))
    || REQUEST_CALL_RE.test(textBody);
  if (!wantsCall || !channel.inboundAgentId || !channel.active) return;

  // Dedupe: skip if we dialed this phone for this user in the last 5 minutes.
  const since = new Date(Date.now() - 5 * 60_000);
  const [recentDial] = await db.select({ n: sql<number>`count(*)::int` })
    .from(whatsappMessagesTable)
    .where(and(
      eq(whatsappMessagesTable.userId, channel.userId),
      eq(whatsappMessagesTable.phone, phone),
      eq(whatsappMessagesTable.direction, "inbound"),
      gt(whatsappMessagesTable.createdAt, since),
    ));
  if ((recentDial?.n ?? 0) > 1) {
    logger.info({ phone, userId: channel.userId }, "whatsapp-native: request-call deduped");
    return;
  }

  try {
    const result = await dialOutboundAgent({
      userId: channel.userId,
      agentId: channel.inboundAgentId,
      toNumber: phone,
      webhookBaseUrl: getSelfBaseUrl(),
      metadata: {
        source: "whatsapp_native",
        whatsappChannelId: channel.id,
        whatsappPhone: phone,
        whatsappButtonId: buttonId,
        direction: "outbound",
      },
    });
    logger.info({ callId: result.callId, phone, userId: channel.userId }, "whatsapp-native: request-call dialed");
  } catch (err) {
    const msg = err instanceof OutboundDialError ? err.message : (err instanceof Error ? err.message : String(err));
    await db.update(whatsappChannelsTable)
      .set({ lastError: msg.slice(0, 500), updatedAt: new Date() })
      .where(eq(whatsappChannelsTable.id, channel.id))
      .catch(() => {});
    logger.warn({ err, phone, userId: channel.userId }, "whatsapp-native: request-call dial failed");
  }
}

router.post("/webhooks/vobiz/whatsapp", async (req, res): Promise<void> => {
  if (!verifyVobizWaSignature(req)) {
    res.status(401).json({ error: "invalid signature" });
    return;
  }
  const body = (req.body ?? {}) as Record<string, any>;
  const eventType = String(body["type"] ?? body["event"] ?? "");
  const eventId = body["event_id"] != null ? String(body["event_id"])
    : (body["id"] != null ? String(body["id"]) : null);

  // Deduplicate on event_id (deliveries are retried; Meta events repeat).
  if (eventId) {
    const inserted = await db.insert(whatsappEventsTable)
      .values({ eventId, eventType: eventType || "unknown" })
      .onConflictDoNothing()
      .returning({ id: whatsappEventsTable.eventId });
    if (inserted.length === 0) {
      res.status(200).json({ ok: true, deduped: true });
      return;
    }
  }

  // Ack fast, process async (per VoBiz webhook guidance).
  res.status(200).json({ ok: true });

  const data = (body["data"] ?? body) as Record<string, any>;
  setImmediate(() => {
    (async () => {
      if (eventType === "message.status") await handleStatusEvent(data);
      else if (eventType === "message.inbound") await handleInboundEvent(data);
      else logger.info({ eventType, eventId }, "whatsapp-native: unhandled webhook event type");
    })().catch((err) => {
      logger.warn({ err, eventType, eventId }, "whatsapp-native: webhook processing error");
    });
  });
});

export default router;
