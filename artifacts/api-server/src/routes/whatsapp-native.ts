/**
 * Native VoBiz WhatsApp — channel enrollment (shared/own tier), message log,
 * test send, and the VoBiz webhook receiver (message.status / message.inbound).
 */

import { Router, type IRouter } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import Razorpay from "razorpay";
import { and, desc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import {
  db,
  agentsTable,
  usersTable,
  vobizAccountsTable,
  phoneNumbersTable,
  phoneNumberOrdersTable,
  walletTransactionsTable,
  whatsappChannelsTable,
  whatsappMessagesTable,
  whatsappEventsTable,
  whatsappAssetsTable,
  type WhatsappChannel,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { clientContext, denyManagedClient } from "../middlewares/clientContext.js";
import { logger } from "../lib/logger.js";
import { getSelfBaseUrl } from "../lib/app-domain.js";
import { logActivity } from "../lib/activity.js";
import { issueInvoice } from "../services/invoice.js";
import {
  CURRENCY_INR,
  GST_RATE,
  PHONE_BASE_PAISE,
  PHONE_TOTAL_PAISE,
  PHONE_WALLET_PURCHASE_MIN_BALANCE_PAISE,
  formatInr,
  gstPortionPaise,
} from "../lib/money-inr.js";
import { RENEWAL_RATE_CENTS, RENEWAL_INTERVAL_DAYS } from "./phone-numbers.js";
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
  getOwnCredsForUser,
  getStrictSubAccountCredsForUser,
  sanitizeVobizError,
} from "../services/whatsapp/vobiz.js";
import { maybeSendBrochure, maybeChatbotReply } from "../services/whatsapp/auto-reply.js";
import {
  startOutboundWhatsappCall,
  terminateWhatsappCall,
  listWhatsappCalls,
  handleWhatsappCallWebhook,
} from "../services/whatsapp/call-session.js";
import { getWhatsappMessageRates, DEFAULT_WA_MESSAGE_RATES } from "../services/whatsapp/billing.js";
import { isWrtcAvailable } from "../services/whatsapp/webrtc-bridge.js";

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
    chatbotEnabled: row.chatbotEnabled,
    chatbotAgentId: row.chatbotAgentId,
    brochureAssetId: row.brochureAssetId,
    brochureAutoSend: row.brochureAutoSend,
    wabaId: row.wabaId,
    phoneNumberId: row.phoneNumberId,
    phoneE164: row.phoneE164,
    vobizChannelId: row.vobizChannelId,
    accessTokenLast4: row.accessTokenLast4,
    status: row.status,
    lastError: row.lastError,
    active: row.active,
    callingEnabled: (row as { callingEnabled?: boolean }).callingEnabled ?? false,
    callingAgentId: (row as { callingAgentId?: number | null }).callingAgentId ?? null,
    templateCatalog: Array.isArray(row.templateCatalog) ? row.templateCatalog : [],
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

const getOwnCredsFor = getOwnCredsForUser;

/**
 * Own-channel / own-number operations must run under the user's OWN VoBiz
 * sub-account. ensureVobizSubAccount silently falls back to master creds when
 * provisioning fails — reject that here, or the channel/number would land in
 * the platform account instead of the user's.
 */
const getStrictSubAccountCreds = getStrictSubAccountCredsForUser;

/**
 * Carrier error bodies can echo request fields — including the Meta access
 * token — so anything persisted (whatsapp_channels.lastError, order failure
 * reasons) or returned to the client must be scrubbed first: exact secret
 * occurrences removed, long token-like sequences redacted, length capped.
 */
const sanitizeCarrierError = sanitizeVobizError;

type ChannelCreateResult =
  | { ok: true; channelId: string; status: string; phoneNumberId: string | null }
  | { ok: false; error: string };

/**
 * Create a WhatsApp channel on VoBiz. Two supported modes (BYON is deliberately
 * NOT offered — external numbers can't be brought into SnapServe):
 * - 'direct'    → bring_your_own: number already registered in the user's WABA
 *                 (requires a Meta Phone Number ID).
 * - 'purchased' → buy_from_vobiz: WhatsApp number bought through SnapServe;
 *                 VoBiz auto-assigns the Phone Number ID after provisioning.
 */
async function createVobizWhatsappChannel(
  creds: { authId: string; authToken: string },
  opts: {
    numberSource: "direct" | "purchased";
    wabaId: string;
    accessToken: string;
    phoneNumberId?: string;
    phoneE164?: string;
  },
): Promise<ChannelCreateResult> {
  const payload: Record<string, unknown> = opts.numberSource === "purchased"
    ? {
        number_onboarding_mode: "buy_from_vobiz",
        waba_id: opts.wabaId,
        access_token: opts.accessToken,
        ...(opts.phoneE164 ? { phone_number: toPlusE164(opts.phoneE164) } : {}),
      }
    : {
        number_onboarding_mode: "bring_your_own",
        waba_id: opts.wabaId,
        phone_number_id: opts.phoneNumberId,
        access_token: opts.accessToken,
        ...(opts.phoneE164 ? { phone_number: toPlusE164(opts.phoneE164) } : {}),
      };
  try {
    const resp = await fetch(`${VOBIZ_API_BASE}/messaging/channels/whatsapp`, {
      method: "POST",
      headers: vobizApiHeaders(creds.authId, creds.authToken),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await resp.text().catch(() => "");
    if (!resp.ok) {
      return { ok: false, error: `VoBiz channel create failed (HTTP ${resp.status}): ${sanitizeCarrierError(text, [opts.accessToken])}` };
    }
    let channelId = "";
    let status = "active";
    let phoneNumberId: string | null = null;
    try {
      const j = JSON.parse(text) as Record<string, any>;
      const ch = j["channel"] ?? j["data"] ?? j;
      channelId = ch?.["id"] != null ? String(ch["id"]) : "";
      phoneNumberId = ch?.["phone_number_id"] != null ? String(ch["phone_number_id"]) : null;
      if (typeof ch?.["status"] === "string" && ch["status"] !== "active") status = "pending";
      // buy_from_vobiz channels stay pending until VoBiz assigns the Phone Number ID.
      if (opts.numberSource === "purchased" && !phoneNumberId) status = "pending";
    } catch { /* fallthrough */ }
    if (!channelId) return { ok: false, error: "VoBiz channel create returned no channel id" };
    return { ok: true, channelId, status, phoneNumberId };
  } catch (err) {
    return { ok: false, error: sanitizeCarrierError(`VoBiz channel create error: ${err instanceof Error ? err.message : String(err)}`, [opts.accessToken]) };
  }
}

/* ── Authenticated channel management ───────────────────────────────────── */

router.get("/whatsapp/channel", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const [row] = await db
    .select()
    .from(whatsappChannelsTable)
    .where(eq(whatsappChannelsTable.userId, userId))
    .limit(1);
  let usage: { used24h: number; cap: number } | null = null;
  if (row) usage = { used24h: await countRecentOutbound(row.id), cap: row.dailyCap };

  // WhatsApp number bought through SnapServe (if any) — surfaced here because
  // it's hidden from the voice numbers page.
  const [wn] = await db
    .select()
    .from(phoneNumbersTable)
    .where(and(
      eq(phoneNumbersTable.userId, userId),
      eq(phoneNumbersTable.service, "whatsapp"),
      eq(phoneNumbersTable.status, "active"),
    ))
    .orderBy(desc(phoneNumbersTable.createdAt))
    .limit(1);

  res.json({
    channel: row ? formatChannel(row) : null,
    sharedTierAvailable: false,
    usage,
    purchasedNumber: wn ? {
      id: wn.id,
      number: wn.number,
      nextRenewalAt: wn.nextRenewalAt?.toISOString() ?? null,
      renewalPaise: wn.renewalRateCents,
    } : null,
  });
});

/** Instant (shared) WhatsApp enrollment — closed. Existing shared channels still work via GET/PATCH/DELETE. */
router.post("/whatsapp/channel/shared", requireAuth, async (_req, res): Promise<void> => {
  res.status(410).json({
    error: "Instant WhatsApp is no longer available. Connect Meta API / Business WhatsApp with your own number instead.",
    code: "INSTANT_WHATSAPP_REMOVED",
  });
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
    /** 'direct' (default) = Meta-registered number; 'purchased' = bought via SnapServe; 'voice_number' = WhatsApp-enable an existing voice DID. */
    numberSource?: "direct" | "purchased" | "voice_number";
    /** phone_numbers.id of the voice DID (numberSource='voice_number'). */
    voicePhoneNumberId?: number;
  };

  const numberSource = body.numberSource === "purchased" ? "purchased" as const
    : body.numberSource === "voice_number" ? "voice_number" as const
    : "direct" as const;
  const wabaId = (body.wabaId ?? "").trim();
  const phoneNumberId = (body.phoneNumberId ?? "").trim();
  let phoneE164 = (body.phoneE164 ?? "").trim();
  const accessToken = (body.accessToken ?? "").trim();
  const providedChannelId = (body.vobizChannelId ?? "").trim();

  if (numberSource === "purchased") {
    if (!wabaId || !accessToken || !phoneE164) {
      res.status(400).json({ error: "wabaId, accessToken and phoneE164 are required to connect a purchased WhatsApp number" });
      return;
    }
    // Retry-connect path: the number must have been bought through SnapServe.
    const plusForm = toPlusE164(phoneE164);
    const bareForm = plusForm.replace(/^\+/, "");
    const [owned] = await db
      .select({ id: phoneNumbersTable.id })
      .from(phoneNumbersTable)
      .where(and(
        eq(phoneNumbersTable.userId, userId),
        eq(phoneNumbersTable.service, "whatsapp"),
        eq(phoneNumbersTable.status, "active"),
        inArray(phoneNumbersTable.number, [plusForm, bareForm]),
      ))
      .limit(1);
    if (!owned) {
      res.status(400).json({ error: "That number wasn't bought through the SnapServe WhatsApp flow. Use the setup wizard to buy one first." });
      return;
    }
  } else if (numberSource === "voice_number") {
    // BYON: WhatsApp-enable one of the user's existing voice DIDs (₹0 — the
    // number is already rented). The number keeps service='voice' for dual use.
    const vpnId = Number(body.voicePhoneNumberId);
    if (!Number.isFinite(vpnId)) {
      res.status(400).json({ error: "voicePhoneNumberId is required to WhatsApp-enable a voice number" });
      return;
    }
    const [vpn] = await db
      .select({ id: phoneNumbersTable.id, number: phoneNumbersTable.number })
      .from(phoneNumbersTable)
      .where(and(
        eq(phoneNumbersTable.id, vpnId),
        eq(phoneNumbersTable.userId, userId),
        ne(phoneNumbersTable.service, "whatsapp"),
        eq(phoneNumbersTable.status, "active"),
      ))
      .limit(1);
    if (!vpn) {
      res.status(404).json({ error: "Voice number not found" });
      return;
    }
    phoneE164 = toPlusE164(vpn.number);
    if (!providedChannelId && (!wabaId || !phoneNumberId || !accessToken)) {
      res.status(400).json({ error: "wabaId, phoneNumberId and accessToken (from Meta Business Manager) are required to WhatsApp-enable your voice number" });
      return;
    }
  } else if (!providedChannelId && (!wabaId || !phoneNumberId || !accessToken)) {
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
      res.status(400).json({ error: "That channel id is the platform shared channel — connect your own Meta Business WhatsApp number instead" });
      return;
    }
  }
  if (body.inboundAgentId != null && !(await validateAgentOwnership(userId, Number(body.inboundAgentId)))) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  // Meta-first: "already on my WABA" and voice-DID WhatsApp-enable send via Graph.
  // VoBiz is only for a SnapServe-bought WhatsApp DID or an existing VoBiz channel
  // (WhatsApp calling / native chatbot).
  if (!providedChannelId && numberSource !== "purchased") {
    res.status(400).json({
      error: "Use Meta connect (WABA + Phone Number ID + token) for a number already on your WABA. VoBiz is only required when you buy a WhatsApp number from SnapServe or enable WhatsApp calling.",
      code: "USE_META_CONNECT",
    });
    return;
  }

  let vobizChannelId = providedChannelId;
  let lastError: string | null = null;
  let status = "active";

  let remotePhoneNumberId: string | null = null;
  if (!vobizChannelId) {
    // Strict: own-channel creation must happen under the user's OWN sub-account,
    // never the master account, or the channel lands in the wrong VoBiz account.
    const creds = await getStrictSubAccountCreds(userId);
    if (!creds) {
      res.status(503).json({ error: "Could not prepare your VoBiz sub-account — please try again shortly" });
      return;
    }
    const created = await createVobizWhatsappChannel(creds, {
      // voice_number uses the same bring_your_own carrier payload as direct.
      numberSource: numberSource === "purchased" ? "purchased" : "direct",
      wabaId,
      accessToken,
      phoneNumberId: phoneNumberId || undefined,
      phoneE164: phoneE164 || undefined,
    });
    if (!created.ok) {
      res.status(502).json({ error: created.error });
      return;
    }
    vobizChannelId = created.channelId;
    status = created.status;
    remotePhoneNumberId = created.phoneNumberId;
  }

  const values = {
    userId,
    mode: "own" as const,
    businessName: (body.businessName ?? "").trim().slice(0, 120),
    inboundAgentId: body.inboundAgentId ?? null,
    vobizChannelId,
    wabaId: wabaId || null,
    phoneNumberId: phoneNumberId || remotePhoneNumberId || null,
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

  // Best-effort: fetch + persist APPROVED template catalog for Builder picks.
  if (row) {
    try {
      const { refreshOwnChannelTemplateCatalog } = await import("./whatsapp-extras.js");
      const catalog = await refreshOwnChannelTemplateCatalog(row, userId);
      row = { ...row, templateCatalog: catalog };
    } catch (err) {
      logger.warn({ err, userId }, "whatsapp-native: catalog fetch on connect failed");
    }
  }

  res.status(201).json(formatChannel(row!));
});

/* ── WhatsApp-capable number purchase (business tier) ─────────────────────
 *
 * WhatsApp numbers are a SEPARATE VoBiz inventory from voice DIDs — a voice
 * number cannot be used here (and BYON is deliberately not offered). Platform
 * price mirrors voice numbers: ₹800 + GST first month via Razorpay, then the
 * standard 30-day wallet renewal (same billing engine — the number lives in
 * phone_numbers with service='whatsapp').
 */

function getWaRazorpay() {
  return new Razorpay({
    key_id: process.env["RAZORPAY_KEY_ID"]!,
    key_secret: process.env["RAZORPAY_KEY_SECRET"]!,
  });
}

/** Best-effort refund of a failed WhatsApp-number purchase payment. */
async function refundWhatsappOrder(
  orderRowId: number,
  razorpayPaymentId: string,
  amountCents: number,
  reason: string,
): Promise<void> {
  try {
    const razorpay = getWaRazorpay();
    await (razorpay.payments as any).refund(razorpayPaymentId, { amount: amountCents, speed: "optimum" });
    logger.info({ orderRowId, razorpayPaymentId, reason }, "whatsapp-native: purchase payment refunded");
  } catch (err) {
    logger.error({ err, orderRowId, razorpayPaymentId, reason }, "whatsapp-native: refund failed — needs manual review");
  } finally {
    await db.update(phoneNumberOrdersTable)
      .set({ status: "failed", failureReason: reason })
      .where(eq(phoneNumberOrdersTable.id, orderRowId));
  }
}

/** Live WhatsApp-capable inventory (separate from voice DIDs). */
router.get("/whatsapp/numbers/available", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const country = String(req.query["country"] ?? "IN").toUpperCase().slice(0, 2);

  const creds = await getStrictSubAccountCreds(userId);
  if (!creds) {
    res.status(503).json({ error: "Could not prepare your VoBiz sub-account — please try again shortly" });
    return;
  }

  try {
    const resp = await fetch(
      `${VOBIZ_API_BASE}/messaging/numbers/whatsapp/availability?country=${encodeURIComponent(country)}`,
      { headers: vobizApiHeaders(creds.authId, creds.authToken), signal: AbortSignal.timeout(15_000) },
    );
    const text = await resp.text().catch(() => "");
    if (!resp.ok) {
      logger.warn({ status: resp.status, body: text.slice(0, 300), userId }, "whatsapp-native: availability fetch failed");
      res.status(502).json({ error: `Could not load WhatsApp numbers from the carrier (HTTP ${resp.status})` });
      return;
    }
    let raw: any = {};
    try { raw = JSON.parse(text); } catch { /* non-JSON body */ }
    const list: any[] = Array.isArray(raw)
      ? raw
      : raw.numbers ?? raw.available_numbers ?? raw.objects ?? raw.items ?? raw.data ?? [];
    const numbers = (list as any[])
      .map((n) => ({
        number: String(n?.phone_number ?? n?.number ?? n?.e164 ?? "").trim(),
        country: String(n?.country ?? country).toUpperCase(),
        region: n?.region != null ? String(n.region) : null,
      }))
      .filter((n) => n.number);
    // Carrier's raw monthly fee is never surfaced — SnapServe charges flat pricing.
    const [walletUser] = await db
      .select({ walletBalanceCents: usersTable.walletBalanceCents })
      .from(usersTable)
      .where(eq(usersTable.clerkId, userId))
      .limit(1);
    const balance = walletUser?.walletBalanceCents ?? 0;
    res.json({
      numbers,
      pricing: {
        basePaise: PHONE_BASE_PAISE,
        gstPaise: gstPortionPaise(PHONE_BASE_PAISE),
        totalPaise: PHONE_TOTAL_PAISE,
        renewalPaise: RENEWAL_RATE_CENTS,
        currency: CURRENCY_INR,
        walletPurchaseMinPaise: PHONE_WALLET_PURCHASE_MIN_BALANCE_PAISE,
        walletEligible: balance > PHONE_WALLET_PURCHASE_MIN_BALANCE_PAISE && balance >= PHONE_TOTAL_PAISE,
        walletBalanceCents: balance,
      },
    });
  } catch (err) {
    logger.error({ err, userId }, "whatsapp-native: availability error");
    res.status(502).json({ error: "Could not reach the carrier for WhatsApp number availability" });
  }
});

/** Razorpay order for a WhatsApp number — nothing is provisioned until confirm. */
router.post("/whatsapp/numbers/purchase/initiate", requireAuth, clientContext, denyManagedClient, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const body = req.body as { number?: string; countryCode?: string; region?: string };
  const rawNumber = String(body.number ?? "").trim();
  const countryCode = (String(body.countryCode ?? "IN").trim().toUpperCase() || "IN").slice(0, 2);
  if (!rawNumber) { res.status(400).json({ error: "number is required" }); return; }
  const number = toPlusE164(rawNumber);

  if (!process.env["RAZORPAY_KEY_ID"] || !process.env["RAZORPAY_KEY_SECRET"]) {
    res.status(503).json({ error: "Payments are not configured yet" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  // KYC gate — Indian numbers require completed identity verification (same as voice).
  if (countryCode === "IN") {
    const [kycAccount] = await db
      .select({ kycStatus: vobizAccountsTable.kycStatus })
      .from(vobizAccountsTable)
      .where(eq(vobizAccountsTable.userId, userId));
    if (!kycAccount || kycAccount.kycStatus !== "completed") {
      res.status(403).json({ error: "Identity verification required to purchase Indian numbers.", code: "KYC_REQUIRED" });
      return;
    }
  }

  // Fail early (before payment) if the user's sub-account can't be prepared.
  const creds = await getStrictSubAccountCreds(userId);
  if (!creds) {
    res.status(503).json({ error: "Could not prepare your VoBiz sub-account — please try again shortly" });
    return;
  }

  const bareForm = number.replace(/^\+/, "");
  const numberTakenWhere = and(
    inArray(phoneNumbersTable.number, [number, bareForm]),
    eq(phoneNumbersTable.status, "active"),
  );
  const openOrderWhere = and(
    eq(phoneNumberOrdersTable.number, number),
    inArray(phoneNumberOrdersTable.status, ["pending", "processing"]),
  );

  // Cheap pre-checks so we can fail before creating a Razorpay order; the
  // authoritative re-check runs under an advisory lock together with the insert.
  const [existingNum] = await db.select({ id: phoneNumbersTable.id }).from(phoneNumbersTable).where(numberTakenWhere);
  if (existingNum) { res.status(409).json({ error: "This number is already taken." }); return; }

  const [pendingOrder] = await db.select({ id: phoneNumberOrdersTable.id }).from(phoneNumberOrdersTable).where(openOrderWhere);
  if (pendingOrder) { res.status(409).json({ error: "A pending purchase already exists for this number." }); return; }

  const basePaise = PHONE_BASE_PAISE;
  const gstPaise = gstPortionPaise(basePaise);
  const payablePaise = PHONE_TOTAL_PAISE;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let order: any;
  try {
    order = await getWaRazorpay().orders.create({
      amount:   payablePaise,
      currency: CURRENCY_INR,
      receipt:  `wa_${user.id}_${Date.now()}`,
      notes: {
        userId: String(user.id),
        clerkId: userId,
        number,
        service: "whatsapp",
        basePaise: String(basePaise),
        gstPaise: String(gstPaise),
        gstRate: String(GST_RATE),
      },
      payment_capture: 1,
    } as any);
  } catch (err) {
    res.status(502).json({ error: `Failed to create payment order: ${err instanceof Error ? err.message : "Razorpay error"}` });
    return;
  }

  // Serialize concurrent purchases of the same number: the advisory lock keys
  // on the number, and the duplicate checks re-run in the same transaction as
  // the insert. A loser's already-created Razorpay order just expires unpaid.
  let orderRow: typeof phoneNumberOrdersTable.$inferSelect | undefined;
  let conflictMsg: string | null = null;
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`wa-num:${number}`}))`);
    const [takenNow] = await tx.select({ id: phoneNumbersTable.id }).from(phoneNumbersTable).where(numberTakenWhere);
    if (takenNow) { conflictMsg = "This number is already taken."; return; }
    const [openNow] = await tx.select({ id: phoneNumberOrdersTable.id }).from(phoneNumberOrdersTable).where(openOrderWhere);
    if (openNow) { conflictMsg = "A pending purchase already exists for this number."; return; }
    [orderRow] = await tx.insert(phoneNumberOrdersTable).values({
      userId,
      number,
      countryCode,
      region:          body.region ?? null,
      numberType:      "whatsapp",
      amountCents:     payablePaise,
      status:          "pending",
      razorpayOrderId: order.id,
    }).returning();
  });
  if (conflictMsg || !orderRow) {
    res.status(409).json({ error: conflictMsg ?? "Could not create the purchase order — please try again." });
    return;
  }

  logger.info({ userId, number, orderId: order.id, payablePaise }, "whatsapp-native: WhatsApp number purchase initiated");

  res.json({
    purchaseOrderId: orderRow.id,
    orderId:         order.id,
    amountCents:     payablePaise,
    basePaise,
    gstPaise,
    payablePaise,
    gstRate:         GST_RATE,
    currency:        CURRENCY_INR,
    keyId:           process.env["RAZORPAY_KEY_ID"],
  });
});

/**
 * Confirm payment → order the number from VoBiz → create the buy_from_vobiz
 * channel. If the VoBiz number order fails the payment is refunded. If only the
 * channel create fails (usually a bad Meta token), the number is kept — the UI
 * retries via POST /whatsapp/channel/own with numberSource: 'purchased'.
 */
router.post("/whatsapp/numbers/purchase/confirm", requireAuth, clientContext, denyManagedClient, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const body = req.body as {
    purchaseOrderId?: number;
    razorpayOrderId?: string;
    razorpayPaymentId?: string;
    razorpaySignature?: string;
    wabaId?: string;
    accessToken?: string;
    businessName?: string;
    inboundAgentId?: number | null;
  };
  const purchaseOrderId   = Number(body.purchaseOrderId);
  const razorpayOrderId   = String(body.razorpayOrderId ?? "");
  const razorpayPaymentId = String(body.razorpayPaymentId ?? "");
  const razorpaySignature = String(body.razorpaySignature ?? "");
  const wabaId       = (body.wabaId ?? "").trim();
  const accessToken  = (body.accessToken ?? "").trim();
  const businessName = (body.businessName ?? "").trim();

  if (!purchaseOrderId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    res.status(400).json({ error: "purchaseOrderId, razorpayOrderId, razorpayPaymentId and razorpaySignature are required" });
    return;
  }
  // Validate Meta details BEFORE claiming the order — a validation miss must
  // leave the order pending so the same payment can be re-submitted.
  if (!wabaId || !accessToken) {
    res.status(400).json({ error: "wabaId and accessToken are required — the WhatsApp channel is created right after payment" });
    return;
  }
  if (body.inboundAgentId != null && !(await validateAgentOwnership(userId, Number(body.inboundAgentId)))) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const secret = process.env["RAZORPAY_KEY_SECRET"];
  if (!secret) { res.status(503).json({ error: "Payments are not configured yet" }); return; }
  const expectedSig = createHmac("sha256", secret).update(`${razorpayOrderId}|${razorpayPaymentId}`).digest("hex");
  if (expectedSig !== razorpaySignature) {
    res.status(400).json({ error: "Invalid payment signature" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  // Atomic claim — only one concurrent confirm wins.
  const [claimed] = await db
    .update(phoneNumberOrdersTable)
    .set({ status: "processing", razorpayPaymentId })
    .where(and(
      eq(phoneNumberOrdersTable.id, purchaseOrderId),
      eq(phoneNumberOrdersTable.razorpayOrderId, razorpayOrderId),
      eq(phoneNumberOrdersTable.userId, userId),
      eq(phoneNumberOrdersTable.status, "pending"),
      eq(phoneNumberOrdersTable.numberType, "whatsapp"),
    ))
    .returning();
  if (!claimed) { res.status(400).json({ error: "Order not found or already processed" }); return; }

  const number = claimed.number;
  const amountCents = claimed.amountCents;

  const creds = await getStrictSubAccountCreds(userId);
  if (!creds) {
    await refundWhatsappOrder(claimed.id, razorpayPaymentId, amountCents, "Sub-account unavailable at confirm");
    res.status(503).json({ error: "Could not prepare your VoBiz sub-account. Your payment has been refunded." });
    return;
  }

  // 1) Order the WhatsApp-capable number (separate inventory from voice DIDs).
  let vobizNumberId: string | null = null;
  try {
    const resp = await fetch(`${VOBIZ_API_BASE}/messaging/numbers/whatsapp/orders`, {
      method: "POST",
      headers: vobizApiHeaders(creds.authId, creds.authToken),
      body: JSON.stringify({
        country_code: claimed.countryCode || "IN",
        selected_phone_number: toPlusE164(number),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await resp.text().catch(() => "");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${text.slice(0, 300)}`);
    try {
      const j = JSON.parse(text) as Record<string, any>;
      const o = j["order"] ?? j["data"] ?? j;
      vobizNumberId = o?.["id"] != null ? String(o["id"]) : null;
    } catch { /* non-JSON success body */ }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, number, userId }, "whatsapp-native: number order failed after payment — refunding");
    await refundWhatsappOrder(claimed.id, razorpayPaymentId, amountCents, `VoBiz WhatsApp number order failed: ${msg.slice(0, 200)}`);
    res.status(502).json({
      error: msg.toLowerCase().includes("not found") || msg.toLowerCase().includes("unavailable")
        ? "This number is no longer available. Your payment has been refunded."
        : "Failed to provision the WhatsApp number. Your payment has been refunded.",
    });
    return;
  }

  // 2) Record ownership + 30-day renewal (same billing engine as voice numbers).
  // Payment is captured and the carrier order succeeded — from here on, any
  // bookkeeping failure must refund and mark the order failed, never leave it
  // stuck in 'processing' with the user silently charged.
  const now = new Date();
  const nextRenewalAt = new Date(now.getTime() + RENEWAL_INTERVAL_DAYS * 24 * 60 * 60 * 1000);
  const bareForm = number.replace(/^\+/, "");
  let numberRow: typeof phoneNumbersTable.$inferSelect | undefined;
  try {
    const ownershipFields = {
      userId,
      number,
      countryCode:      (claimed.countryCode || "IN").toUpperCase(),
      region:           claimed.region ?? null,
      numberType:       "local",
      service:          "whatsapp",
      vobizNumberId,
      agentId:          null,
      squadId:          null,
      status:           "active",
      monthlyRateCents: PHONE_BASE_PAISE,
      renewalRateCents: RENEWAL_RATE_CENTS,
      purchasedAt:      now,
      nextRenewalAt,
      lastRenewalAt:    now,
      releasedAt:       null,
      routingRules:     null,
    };
    // phone_numbers.number is globally unique and released rows are kept, so a
    // previously released row for this number is reused instead of colliding.
    const [existingRow] = await db.select().from(phoneNumbersTable)
      .where(inArray(phoneNumbersTable.number, [number, bareForm]))
      .limit(1);
    if (existingRow && existingRow.status === "active") {
      throw new Error(`phone_numbers row ${existingRow.id} for this number is still active — refusing to overwrite`);
    }
    if (existingRow) {
      [numberRow] = await db.update(phoneNumbersTable)
        .set(ownershipFields)
        .where(eq(phoneNumbersTable.id, existingRow.id))
        .returning();
    } else {
      [numberRow] = await db.insert(phoneNumbersTable).values(ownershipFields).returning();
    }
    if (!numberRow) throw new Error("phone_numbers write returned no row");

    await db.update(phoneNumberOrdersTable)
      .set({ status: "completed", phoneNumberId: numberRow.id })
      .where(eq(phoneNumberOrdersTable.id, claimed.id));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // The carrier-side number may now be orphaned on the user's sub-account —
    // log everything needed for manual reconciliation before refunding.
    logger.error(
      { err, userId, number, vobizNumberId, subAccountAuthId: creds.authId },
      "whatsapp-native: bookkeeping failed AFTER carrier number order — refunding; carrier number may need manual release",
    );
    await refundWhatsappOrder(claimed.id, razorpayPaymentId, amountCents, `Bookkeeping failed after provisioning: ${msg.slice(0, 200)}`);
    res.status(500).json({ error: "Something went wrong while recording your number. Your payment has been refunded." });
    return;
  }

  // Audit-trail records only — direct card payment, wallet balance untouched.
  // Best-effort: never fail a completed purchase over audit bookkeeping.
  try {
    await db.insert(walletTransactionsTable).values({
      userId:            user.id,
      type:              "debit",
      amountCents:       -amountCents,
      description:       `WhatsApp number ${number} purchased (${formatInr(PHONE_BASE_PAISE)} + GST ${formatInr(gstPortionPaise(PHONE_BASE_PAISE))} = ${formatInr(amountCents)}, paid by card)`,
      status:            "completed",
      razorpayOrderId,
      razorpayPaymentId,
    });
    await logActivity({
      userId,
      eventType:    "phone_number.purchased",
      resourceType: "phone_number",
      resourceId:   String(numberRow.id),
      description:  `WhatsApp number ${number} purchased (₹${(amountCents / 100).toFixed(2)}, paid via Razorpay)`,
    });
  } catch (auditErr) {
    logger.error({ err: auditErr, userId, number }, "whatsapp-native: audit records failed (purchase itself is complete)");
  }

  void issueInvoice({
    user: { id: user.id, name: user.name, email: user.email },
    type: "phone_number",
    description: `WhatsApp business number ${number} — provisioning & 1 month rental`,
    hsnSac: "998411",
    amountCents: PHONE_BASE_PAISE,
    gstInclusive: false,
    razorpayOrderId,
    razorpayPaymentId,
    metadata: { number, phoneNumberId: numberRow!.id, service: "whatsapp" },
  });

  // 3) Create the buy_from_vobiz channel (Phone Number ID auto-assigned by VoBiz).
  const created = await createVobizWhatsappChannel(creds, {
    numberSource: "purchased",
    wabaId,
    accessToken,
    phoneE164: number,
  });

  const channelValues = {
    userId,
    mode: "own" as const,
    businessName: businessName.slice(0, 120),
    inboundAgentId: body.inboundAgentId ?? null,
    vobizChannelId: created.ok ? created.channelId : null,
    wabaId,
    phoneNumberId: created.ok ? created.phoneNumberId : null,
    phoneE164: toPlusE164(number),
    accessTokenLast4: accessToken.slice(-4),
    status: created.ok ? created.status : "error",
    lastError: created.ok ? null : created.error,
    active: true,
    updatedAt: new Date(),
  };
  let channelRow: WhatsappChannel | undefined;
  try {
    [channelRow] = await db.insert(whatsappChannelsTable)
      .values(channelValues)
      .onConflictDoUpdate({ target: whatsappChannelsTable.userId, set: channelValues })
      .returning();
  } catch (err) {
    const code = (err as any)?.cause?.code ?? (err as any)?.code;
    if (code === "23505") {
      // The purchase itself is complete — surface the attach failure as
      // channelError; the dashboard shows the "finish connecting" banner via
      // purchasedNumber, so the paid number is never invisible to the user.
      res.status(201).json({
        purchased: true,
        number,
        channel: null,
        channelError: "That VoBiz channel is already connected to another account",
      });
      return;
    }
    throw err;
  }

  logger.info({ userId, number, channelOk: created.ok, vobizNumberId }, "whatsapp-native: WhatsApp number purchased");

  res.status(201).json({
    purchased: true,
    number,
    channel: formatChannel(channelRow!),
    channelError: created.ok ? null : created.error,
  });
});

/**
 * Pay for a WhatsApp number from wallet when balance > ₹20,000.
 * Debits GST-inclusive total atomically, orders from VoBiz, creates channel.
 * On carrier failure the wallet is refunded.
 */
router.post("/whatsapp/numbers/purchase/wallet", requireAuth, clientContext, denyManagedClient, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const body = req.body as {
    number?: string;
    countryCode?: string;
    region?: string;
    wabaId?: string;
    accessToken?: string;
    businessName?: string;
    inboundAgentId?: number | null;
  };
  const rawNumber = String(body.number ?? "").trim();
  const countryCode = (String(body.countryCode ?? "IN").trim().toUpperCase() || "IN").slice(0, 2);
  const wabaId = (body.wabaId ?? "").trim();
  const accessToken = (body.accessToken ?? "").trim();
  const businessName = (body.businessName ?? "").trim();
  if (!rawNumber) { res.status(400).json({ error: "number is required" }); return; }
  if (!wabaId || !accessToken || !businessName) {
    res.status(400).json({ error: "businessName, wabaId and accessToken are required" });
    return;
  }
  if (body.inboundAgentId != null && !(await validateAgentOwnership(userId, Number(body.inboundAgentId)))) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  const number = toPlusE164(rawNumber);

  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  if (user.walletBalanceCents <= PHONE_WALLET_PURCHASE_MIN_BALANCE_PAISE) {
    res.status(403).json({
      error: `Pay from wallet is available when your balance is above ${formatInr(PHONE_WALLET_PURCHASE_MIN_BALANCE_PAISE)}. Top up or pay by card instead.`,
      code: "WALLET_PURCHASE_NOT_ELIGIBLE",
      minBalancePaise: PHONE_WALLET_PURCHASE_MIN_BALANCE_PAISE,
      balanceCents: user.walletBalanceCents,
    });
    return;
  }

  if (countryCode === "IN") {
    const [kycAccount] = await db
      .select({ kycStatus: vobizAccountsTable.kycStatus })
      .from(vobizAccountsTable)
      .where(eq(vobizAccountsTable.userId, userId));
    if (!kycAccount || kycAccount.kycStatus !== "completed") {
      res.status(403).json({ error: "Identity verification required to purchase Indian numbers.", code: "KYC_REQUIRED" });
      return;
    }
  }

  const payablePaise = PHONE_TOTAL_PAISE;
  const basePaise = PHONE_BASE_PAISE;
  if (user.walletBalanceCents < payablePaise) {
    res.status(402).json({
      error: `Insufficient wallet balance. Need ${formatInr(payablePaise)}, have ${formatInr(user.walletBalanceCents)}.`,
      code: "INSUFFICIENT_BALANCE",
      payablePaise,
      balanceCents: user.walletBalanceCents,
    });
    return;
  }

  const creds = await getStrictSubAccountCreds(userId);
  if (!creds) {
    res.status(503).json({ error: "Could not prepare your VoBiz sub-account — please try again shortly" });
    return;
  }

  const bareForm = number.replace(/^\+/, "");
  const numberTakenWhere = and(
    inArray(phoneNumbersTable.number, [number, bareForm]),
    eq(phoneNumbersTable.status, "active"),
  );

  let orderRow: typeof phoneNumberOrdersTable.$inferSelect | undefined;
  let debitOk = false;
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`wa-num:${number}`}))`);
      const [takenNow] = await tx.select({ id: phoneNumbersTable.id }).from(phoneNumbersTable).where(numberTakenWhere);
      if (takenNow) throw Object.assign(new Error("This number is already taken."), { status: 409 });

      const [debited] = await tx
        .update(usersTable)
        .set({
          walletBalanceCents: sql`GREATEST(0, ${usersTable.walletBalanceCents} - ${payablePaise})`,
        })
        .where(and(
          eq(usersTable.clerkId, userId),
          gt(usersTable.walletBalanceCents, PHONE_WALLET_PURCHASE_MIN_BALANCE_PAISE),
          sql`${usersTable.walletBalanceCents} >= ${payablePaise}`,
        ))
        .returning({ walletBalanceCents: usersTable.walletBalanceCents, id: usersTable.id });
      if (!debited) throw Object.assign(new Error("Wallet debit failed — balance changed. Try again."), { status: 409 });
      debitOk = true;

      await tx.insert(walletTransactionsTable).values({
        userId: user.id,
        type: "debit",
        amountCents: -payablePaise,
        description: `WhatsApp number ${number} purchased from wallet (${formatInr(basePaise)} + GST = ${formatInr(payablePaise)})`,
        status: "completed",
      });

      [orderRow] = await tx.insert(phoneNumberOrdersTable).values({
        userId,
        number,
        countryCode,
        region: body.region ?? null,
        numberType: "whatsapp",
        amountCents: payablePaise,
        status: "processing",
        razorpayOrderId: `wallet_wa_${user.id}_${Date.now()}`,
      }).returning();
    });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : "Purchase failed" });
    return;
  }
  if (!orderRow) {
    res.status(500).json({ error: "Could not create purchase order" });
    return;
  }

  const refundWallet = async (reason: string) => {
    if (!debitOk) return;
    await db.transaction(async (tx) => {
      await tx
        .update(usersTable)
        .set({ walletBalanceCents: sql`${usersTable.walletBalanceCents} + ${payablePaise}` })
        .where(eq(usersTable.clerkId, userId));
      await tx.insert(walletTransactionsTable).values({
        userId: user.id,
        type: "credit",
        amountCents: payablePaise,
        description: `Refund: WhatsApp number ${number} — ${reason.slice(0, 120)}`,
        status: "completed",
      });
      await tx.update(phoneNumberOrdersTable)
        .set({ status: "failed" })
        .where(eq(phoneNumberOrdersTable.id, orderRow!.id));
    });
  };

  let vobizNumberId: string | null = null;
  try {
    const resp = await fetch(`${VOBIZ_API_BASE}/messaging/numbers/whatsapp/orders`, {
      method: "POST",
      headers: vobizApiHeaders(creds.authId, creds.authToken),
      body: JSON.stringify({
        country_code: countryCode,
        selected_phone_number: number,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await resp.text().catch(() => "");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${text.slice(0, 300)}`);
    try {
      const j = JSON.parse(text) as Record<string, any>;
      const o = j["order"] ?? j["data"] ?? j;
      vobizNumberId = o?.["id"] != null ? String(o["id"]) : null;
    } catch { /* non-JSON */ }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, number, userId }, "whatsapp-native: wallet buy — VoBiz order failed, refunding");
    await refundWallet(`VoBiz order failed: ${msg}`);
    res.status(502).json({ error: "Failed to provision the WhatsApp number. Your wallet has been refunded." });
    return;
  }

  const now = new Date();
  const nextRenewalAt = new Date(now.getTime() + RENEWAL_INTERVAL_DAYS * 24 * 60 * 60 * 1000);
  let numberRow: typeof phoneNumbersTable.$inferSelect | undefined;
  try {
    const ownershipFields = {
      userId,
      number,
      countryCode,
      region: body.region ?? null,
      numberType: "local" as const,
      service: "whatsapp",
      vobizNumberId,
      agentId: null,
      squadId: null,
      status: "active",
      monthlyRateCents: PHONE_BASE_PAISE,
      renewalRateCents: RENEWAL_RATE_CENTS,
      purchasedAt: now,
      nextRenewalAt,
      lastRenewalAt: now,
      releasedAt: null,
      routingRules: null,
    };
    const [existingRow] = await db.select().from(phoneNumbersTable)
      .where(inArray(phoneNumbersTable.number, [number, bareForm]))
      .limit(1);
    if (existingRow && existingRow.status === "active") {
      throw new Error(`phone_numbers row ${existingRow.id} for this number is still active`);
    }
    if (existingRow) {
      [numberRow] = await db.update(phoneNumbersTable).set(ownershipFields).where(eq(phoneNumbersTable.id, existingRow.id)).returning();
    } else {
      [numberRow] = await db.insert(phoneNumbersTable).values(ownershipFields).returning();
    }
    await db.update(phoneNumberOrdersTable)
      .set({ status: "completed", phoneNumberId: numberRow!.id })
      .where(eq(phoneNumberOrdersTable.id, orderRow.id));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, userId, number, vobizNumberId }, "whatsapp-native: wallet buy bookkeeping failed — refunding");
    await refundWallet(`Bookkeeping failed: ${msg}`);
    res.status(500).json({ error: "Something went wrong recording your number. Your wallet has been refunded." });
    return;
  }

  void issueInvoice({
    user: { id: user.id, name: user.name, email: user.email },
    type: "phone_number",
    description: `WhatsApp business number ${number} — provisioning & 1 month rental (wallet)`,
    hsnSac: "998411",
    amountCents: PHONE_BASE_PAISE,
    gstInclusive: false,
    metadata: { number, phoneNumberId: numberRow!.id, service: "whatsapp", paidVia: "wallet" },
  });

  const created = await createVobizWhatsappChannel(creds, {
    numberSource: "purchased",
    wabaId,
    accessToken,
    phoneE164: number,
  });

  const channelValues = {
    userId,
    mode: "own" as const,
    businessName: businessName.slice(0, 120),
    inboundAgentId: body.inboundAgentId ?? null,
    vobizChannelId: created.ok ? created.channelId : null,
    wabaId,
    phoneNumberId: created.ok ? created.phoneNumberId : null,
    phoneE164: toPlusE164(number),
    accessTokenLast4: accessToken.slice(-4),
    status: created.ok ? created.status : "error",
    lastError: created.ok ? null : created.error,
    active: true,
    updatedAt: new Date(),
  };
  const [channelRow] = await db.insert(whatsappChannelsTable)
    .values(channelValues)
    .onConflictDoUpdate({ target: whatsappChannelsTable.userId, set: channelValues })
    .returning();

  logger.info({ userId, number, channelOk: created.ok, vobizNumberId, paidVia: "wallet" }, "whatsapp-native: WhatsApp number purchased from wallet");

  res.status(201).json({
    purchased: true,
    paidVia: "wallet",
    number,
    channel: formatChannel(channelRow!),
    channelError: created.ok ? null : created.error,
  });
});

/** Re-pull a pending own channel from VoBiz (buy_from_vobiz provisioning). */
router.post("/whatsapp/channel/refresh", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const [row] = await db.select().from(whatsappChannelsTable)
    .where(eq(whatsappChannelsTable.userId, userId)).limit(1);
  if (!row || row.mode !== "own" || !row.vobizChannelId) {
    res.status(404).json({ error: "No own WhatsApp channel to refresh" });
    return;
  }

  const creds = await getStrictSubAccountCreds(userId);
  if (!creds) {
    res.status(503).json({ error: "Could not prepare your VoBiz sub-account — please try again shortly" });
    return;
  }

  try {
    const resp = await fetch(`${VOBIZ_API_BASE}/messaging/channels/whatsapp`, {
      headers: vobizApiHeaders(creds.authId, creds.authToken),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await resp.text().catch(() => "");
    if (!resp.ok) {
      res.status(502).json({ error: `Carrier refresh failed (HTTP ${resp.status})` });
      return;
    }
    let raw: any = {};
    try { raw = JSON.parse(text); } catch { /* non-JSON body */ }
    const list: any[] = Array.isArray(raw) ? raw : raw.channels ?? raw.objects ?? raw.items ?? raw.data ?? [];
    const remote = (list as any[]).find((c) => String(c?.id ?? "") === row.vobizChannelId);
    if (!remote) {
      res.status(404).json({ error: "Channel not found on the carrier — it may have been deleted in the VoBiz console" });
      return;
    }
    const remoteStatus = typeof remote.status === "string" ? remote.status : "";
    const remotePnid   = remote.phone_number_id != null ? String(remote.phone_number_id) : null;
    const remotePhone  = remote.phone_number != null ? String(remote.phone_number) : null;
    const newStatus = remoteStatus
      ? (remoteStatus === "active" ? "active" : remoteStatus)
      : (remotePnid ? "active" : row.status);
    const [updated] = await db.update(whatsappChannelsTable).set({
      phoneNumberId: remotePnid ?? row.phoneNumberId,
      phoneE164: remotePhone ? toPlusE164(remotePhone) : row.phoneE164,
      status: newStatus,
      lastError: null,
      updatedAt: new Date(),
    }).where(eq(whatsappChannelsTable.id, row.id)).returning();
    logger.info({ userId, status: newStatus, phoneNumberId: remotePnid }, "whatsapp-native: channel refreshed from carrier");
    res.json(formatChannel(updated!));
  } catch (err) {
    res.status(502).json({ error: `Carrier refresh error: ${err instanceof Error ? err.message : String(err)}` });
  }
});

router.patch("/whatsapp/channel", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const body = req.body as Record<string, unknown>;
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (typeof body["businessName"] === "string") updates.businessName = body["businessName"].trim().slice(0, 120);
  for (const k of ["notifyBookingConfirmed", "notifyCallSummary", "notifyCallbackScheduled", "active", "callingEnabled"] as const) {
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
  if (body["callingAgentId"] === null) updates.callingAgentId = null;
  if (typeof body["callingAgentId"] === "number") {
    if (!(await validateAgentOwnership(userId, body["callingAgentId"]))) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    updates.callingAgentId = body["callingAgentId"];
  }
  if (typeof body["chatbotEnabled"] === "boolean") updates.chatbotEnabled = body["chatbotEnabled"];
  if (body["chatbotAgentId"] === null) updates.chatbotAgentId = null;
  if (typeof body["chatbotAgentId"] === "number") {
    if (!(await validateAgentOwnership(userId, body["chatbotAgentId"]))) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    updates.chatbotAgentId = body["chatbotAgentId"];
  }
  if (typeof body["brochureAutoSend"] === "boolean") updates.brochureAutoSend = body["brochureAutoSend"];
  if (body["brochureAssetId"] === null) updates.brochureAssetId = null;
  if (typeof body["brochureAssetId"] === "string" && body["brochureAssetId"]) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body["brochureAssetId"])) {
      res.status(400).json({ error: "Invalid asset id" });
      return;
    }
    const [asset] = await db.select({ id: whatsappAssetsTable.id })
      .from(whatsappAssetsTable)
      .where(and(eq(whatsappAssetsTable.id, body["brochureAssetId"]), eq(whatsappAssetsTable.userId, userId)))
      .limit(1);
    if (!asset) {
      res.status(404).json({ error: "Asset not found" });
      return;
    }
    updates.brochureAssetId = body["brochureAssetId"];
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
  if (wantsCall && channel.inboundAgentId && channel.active) {
    await dialRequestedCall(channel, phone, buttonId != null ? String(buttonId) : null);
    return;
  }

  // Brochure request → auto-send the configured asset (the 24h customer-service
  // window just opened, so a free-form document send is allowed).
  try {
    if (await maybeSendBrochure(channel, phone, textBody, buttonId != null ? String(buttonId) : null)) return;
  } catch (err) {
    logger.warn({ err, phone, channelId: channel.id }, "whatsapp-native: brochure auto-send crashed");
  }

  // AI chatbot → free-form reply in the configured agent's persona.
  try {
    await maybeChatbotReply(channel, phone, textBody);
  } catch (err) {
    logger.warn({ err, phone, channelId: channel.id }, "whatsapp-native: chatbot reply crashed");
  }
}

/** Request-a-call intent → dial the configured inbound agent (5-min dedupe). */
async function dialRequestedCall(channel: WhatsappChannel, phone: string, buttonId: string | null): Promise<void> {
  const agentId = channel.inboundAgentId;
  if (!agentId) return;
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
      agentId,
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
      else if (eventType.startsWith("call.") || eventType === "call") await handleWhatsappCallWebhook(eventType, data);
      else logger.info({ eventType, eventId }, "whatsapp-native: unhandled webhook event type");
    })().catch((err) => {
      logger.warn({ err, eventType, eventId }, "whatsapp-native: webhook processing error");
    });
  });
});

/** Message rate card (own-channel wallet billing). */
router.get("/whatsapp/rates", requireAuth, async (_req, res): Promise<void> => {
  const rates = await getWhatsappMessageRates();
  res.json({ rates, defaults: DEFAULT_WA_MESSAGE_RATES });
});

/** Outbound WhatsApp voice call (WebRTC via VoBiz). */
router.post("/whatsapp/calls/outbound", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const body = req.body as { to?: string; agentId?: number | null };
  const to = String(body.to ?? "").trim();
  if (!to) { res.status(400).json({ error: "to is required (E.164)" }); return; }
  const channel = await getActiveChannel(userId);
  if (!channel) { res.status(404).json({ error: "No active WhatsApp channel" }); return; }
  if (body.agentId != null && !(await validateAgentOwnership(userId, Number(body.agentId)))) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  const result = await startOutboundWhatsappCall({
    userId,
    channel,
    toPhone: to,
    agentId: body.agentId ?? null,
  });
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.status(201).json({
    call: result.call,
    mediaReady: result.mediaReady,
    wrtcAvailable: await isWrtcAvailable(),
  });
});

router.post("/whatsapp/calls/:id/terminate", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const result = await terminateWhatsappCall({ userId, callId: String(req.params["id"]) });
  if (!result.ok) { res.status(400).json({ error: result.error }); return; }
  res.json({ ok: true });
});

router.get("/whatsapp/calls", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const calls = await listWhatsappCalls(userId, 40);
  res.json({ calls, wrtcAvailable: await isWrtcAvailable() });
});

export default router;
