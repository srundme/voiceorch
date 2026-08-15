/**
 * WhatsApp voice call lifecycle: outbound dial, inbound accept, terminate, billing.
 */
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  whatsappCallsTable,
  whatsappChannelsTable,
  type WhatsappCall,
  type WhatsappChannel,
} from "@workspace/db";
import { logger } from "../../lib/logger.js";
import { toPlusE164, getStrictSubAccountCredsForUser } from "./vobiz.js";
import { vobizInitiateWhatsappCall, vobizWhatsappCallAction } from "./calls-api.js";
import { createInboundBridge, createOutboundBridge, type WhatsappWebRtcBridge } from "./webrtc-bridge.js";
import { debitWhatsappCallMinutes } from "./billing.js";

/** In-memory active bridges keyed by whatsapp_calls.id */
const bridges = new Map<string, WhatsappWebRtcBridge>();

export function getActiveBridge(callRowId: string): WhatsappWebRtcBridge | undefined {
  return bridges.get(callRowId);
}

export async function startOutboundWhatsappCall(opts: {
  userId: string;
  channel: WhatsappChannel;
  toPhone: string;
  agentId?: number | null;
}): Promise<{ ok: true; call: WhatsappCall; mediaReady: boolean } | { ok: false; error: string }> {
  if (opts.channel.mode !== "own" || !opts.channel.vobizChannelId) {
    return { ok: false, error: "WhatsApp calling requires an active own (Vobiz) channel" };
  }
  if (!opts.channel.callingEnabled) {
    return { ok: false, error: "WhatsApp calling is disabled for this channel — enable it in settings" };
  }

  const creds = await getStrictSubAccountCredsForUser(opts.userId);
  if (!creds) return { ok: false, error: "Could not prepare VoBiz sub-account credentials" };

  const to = toPlusE164(opts.toPhone);
  const bridge = await createOutboundBridge();
  const [row] = await db.insert(whatsappCallsTable).values({
    userId: opts.userId,
    channelId: opts.channel.id,
    agentId: opts.agentId ?? opts.channel.callingAgentId ?? opts.channel.inboundAgentId,
    direction: "outbound",
    fromNumber: opts.channel.phoneE164,
    toNumber: to,
    status: "initiated",
    offerSdp: bridge.localSdp,
    startedAt: new Date(),
  }).returning();

  const initiated = await vobizInitiateWhatsappCall({
    authId: creds.authId,
    authToken: creds.authToken,
    channelId: opts.channel.vobizChannelId,
    to,
    sdpOffer: bridge.localSdp,
  });

  if (!initiated.ok) {
    bridge.close();
    await db.update(whatsappCallsTable)
      .set({ status: "failed", lastError: initiated.error, endedAt: new Date() })
      .where(eq(whatsappCallsTable.id, row!.id));
    return { ok: false, error: initiated.error };
  }

  await db.update(whatsappCallsTable)
    .set({ vobizCallId: initiated.callId, status: initiated.status || "initiated" })
    .where(eq(whatsappCallsTable.id, row!.id));

  bridges.set(row!.id, bridge);
  const [updated] = await db.select().from(whatsappCallsTable).where(eq(whatsappCallsTable.id, row!.id)).limit(1);
  logger.info({ callId: row!.id, vobizCallId: initiated.callId, mediaReady: bridge.mediaReady }, "whatsapp-call: outbound initiated");
  return { ok: true, call: updated!, mediaReady: bridge.mediaReady };
}

export async function handleWhatsappCallWebhook(eventType: string, data: Record<string, unknown>): Promise<void> {
  // Envelope may nest Meta-style payload.
  const payload = (data["payload"] ?? data) as Record<string, any>;
  const entry = payload?.entry?.[0]?.changes?.[0]?.value ?? payload;
  const calls: any[] = entry?.calls ?? (payload.calls ? payload.calls : []);
  const first = calls[0] ?? payload;
  const metaCallId = first?.id != null ? String(first.id) : null;
  const vobizCallId = data["call_id"] != null ? String(data["call_id"])
    : (payload["call_id"] != null ? String(payload["call_id"]) : metaCallId);
  const status = String(first?.status ?? payload["status"] ?? "").toLowerCase();
  const direction = String(first?.direction ?? payload["direction"] ?? "").toUpperCase();
  const sessionSdp = first?.session?.sdp ?? payload?.session?.sdp ?? null;
  const from = first?.from != null ? String(first.from) : null;
  const to = first?.to != null ? String(first.to) : null;

  logger.info({ eventType, vobizCallId, metaCallId, status, direction }, "whatsapp-call: webhook");

  // Inbound connect — create/accept if calling enabled.
  if (eventType.includes("connect") || first?.event === "connect") {
    if (direction === "USER_INITIATED" || direction === "INBOUND" || !direction) {
      await acceptInboundIfEnabled({
        vobizCallId: vobizCallId ?? metaCallId,
        metaCallId,
        offerSdp: typeof sessionSdp === "string" ? sessionSdp : null,
        from,
        to,
        phoneNumberId: entry?.metadata?.phone_number_id != null ? String(entry.metadata.phone_number_id) : null,
      });
      return;
    }
    // Outbound answer SDP
    if (typeof sessionSdp === "string" && (vobizCallId || metaCallId)) {
      await applyAnswerSdp(vobizCallId, metaCallId, sessionSdp);
    }
  }

  if (eventType.includes("terminate") || status === "terminated" || status === "failed" || status === "missed" || status === "rejected") {
    await finalizeCall(vobizCallId, metaCallId, status || "terminated", first?.hangup_cause ?? null);
    return;
  }

  if (status === "accepted" || status === "pre_accepted" || status === "ringing") {
    const [row] = await findCall(vobizCallId, metaCallId);
    if (row) {
      await db.update(whatsappCallsTable)
        .set({
          status,
          ...(status === "accepted" ? { answeredAt: row.answeredAt ?? new Date() } : {}),
          metaCallId: metaCallId ?? row.metaCallId,
          vobizCallId: vobizCallId ?? row.vobizCallId,
        })
        .where(eq(whatsappCallsTable.id, row.id));
      if (typeof sessionSdp === "string") {
        await applyAnswerSdp(vobizCallId, metaCallId, sessionSdp);
      }
    }
  }
}

async function findCall(vobizCallId: string | null, metaCallId: string | null) {
  if (vobizCallId) {
    const rows = await db.select().from(whatsappCallsTable).where(eq(whatsappCallsTable.vobizCallId, vobizCallId)).limit(1);
    if (rows[0]) return rows;
  }
  if (metaCallId) {
    return db.select().from(whatsappCallsTable).where(eq(whatsappCallsTable.metaCallId, metaCallId)).limit(1);
  }
  return [] as WhatsappCall[];
}

async function applyAnswerSdp(vobizCallId: string | null, metaCallId: string | null, sdp: string) {
  const [row] = await findCall(vobizCallId, metaCallId);
  if (!row) return;
  await db.update(whatsappCallsTable)
    .set({ answerSdp: sdp, status: row.status === "initiated" ? "ringing" : row.status })
    .where(eq(whatsappCallsTable.id, row.id));
  const bridge = bridges.get(row.id);
  if (bridge) {
    try {
      await bridge.setRemoteSdp(sdp, "answer");
    } catch (err) {
      logger.warn({ err, callId: row.id }, "whatsapp-call: setRemoteSdp failed");
    }
  }
}

async function acceptInboundIfEnabled(opts: {
  vobizCallId: string | null;
  metaCallId: string | null;
  offerSdp: string | null;
  from: string | null;
  to: string | null;
  phoneNumberId: string | null;
}) {
  // Resolve channel by phone number id or E.164.
  let channel: WhatsappChannel | undefined;
  if (opts.phoneNumberId) {
    const [c] = await db.select().from(whatsappChannelsTable)
      .where(and(eq(whatsappChannelsTable.phoneNumberId, opts.phoneNumberId), eq(whatsappChannelsTable.active, true)))
      .limit(1);
    channel = c;
  }
  if (!channel && opts.to) {
    const e164 = toPlusE164(opts.to.startsWith("+") ? opts.to : `+${opts.to}`);
    const [c] = await db.select().from(whatsappChannelsTable)
      .where(and(eq(whatsappChannelsTable.phoneE164, e164), eq(whatsappChannelsTable.active, true)))
      .limit(1);
    channel = c;
  }
  if (!channel?.callingEnabled || !channel.vobizChannelId) {
    logger.info({ phoneNumberId: opts.phoneNumberId }, "whatsapp-call: inbound ignored — calling disabled");
    return;
  }

  const existing = await findCall(opts.vobizCallId, opts.metaCallId);
  if (existing[0]) return;

  const agentId = channel.callingAgentId ?? channel.inboundAgentId;
  const bridge = opts.offerSdp
    ? await createInboundBridge(opts.offerSdp)
    : await createOutboundBridge();

  const [row] = await db.insert(whatsappCallsTable).values({
    userId: channel.userId,
    channelId: channel.id,
    agentId,
    direction: "inbound",
    fromNumber: opts.from ? toPlusE164(opts.from.startsWith("+") ? opts.from : `+${opts.from}`) : null,
    toNumber: channel.phoneE164,
    status: "ringing",
    vobizCallId: opts.vobizCallId,
    metaCallId: opts.metaCallId,
    offerSdp: opts.offerSdp,
    answerSdp: bridge.localSdp,
    startedAt: new Date(),
  }).returning();

  const creds = await getStrictSubAccountCredsForUser(channel.userId);
  if (!creds || !opts.vobizCallId) {
    bridge.close();
    await db.update(whatsappCallsTable)
      .set({ status: "failed", lastError: "Missing creds or call id for accept" })
      .where(eq(whatsappCallsTable.id, row!.id));
    return;
  }

  // pre_accept then accept with our SDP answer
  await vobizWhatsappCallAction({
    authId: creds.authId,
    authToken: creds.authToken,
    channelId: channel.vobizChannelId,
    callId: opts.vobizCallId,
    action: "pre_accept",
    sdp: bridge.localSdp,
  });
  const accepted = await vobizWhatsappCallAction({
    authId: creds.authId,
    authToken: creds.authToken,
    channelId: channel.vobizChannelId,
    callId: opts.vobizCallId,
    action: "accept",
    sdp: bridge.localSdp,
  });

  if (!accepted.ok) {
    bridge.close();
    await db.update(whatsappCallsTable)
      .set({ status: "failed", lastError: accepted.error, endedAt: new Date() })
      .where(eq(whatsappCallsTable.id, row!.id));
    return;
  }

  bridges.set(row!.id, bridge);
  await db.update(whatsappCallsTable)
    .set({ status: "accepted", answeredAt: new Date() })
    .where(eq(whatsappCallsTable.id, row!.id));

  // Media ↔ agent pipeline attach is best-effort; PCM events available on bridge.
  logger.info({ callId: row!.id, agentId, mediaReady: bridge.mediaReady }, "whatsapp-call: inbound accepted");
}

async function finalizeCall(
  vobizCallId: string | null,
  metaCallId: string | null,
  status: string,
  hangupCause: unknown,
) {
  const [row] = await findCall(vobizCallId, metaCallId);
  if (!row) return;
  const bridge = bridges.get(row.id);
  bridge?.close();
  bridges.delete(row.id);

  const endedAt = new Date();
  const answeredAt = row.answeredAt;
  const durationSeconds = answeredAt
    ? Math.max(0, Math.round((endedAt.getTime() - answeredAt.getTime()) / 1000))
    : 0;

  let billedPaise: number | null = row.billedPaise;
  if (durationSeconds > 0 && !row.billedPaise) {
    const mins = Math.max(1, Math.ceil(durationSeconds / 60));
    const billed = await debitWhatsappCallMinutes({
      clerkUserId: row.userId,
      callLogId: row.id,
      minutes: mins,
    });
    if (billed.ok) billedPaise = billed.amountPaise;
  }

  await db.update(whatsappCallsTable)
    .set({
      status: status || "terminated",
      hangupCause: hangupCause != null ? String(hangupCause).slice(0, 200) : null,
      durationSeconds,
      billedPaise,
      endedAt,
    })
    .where(eq(whatsappCallsTable.id, row.id));
}

export async function terminateWhatsappCall(opts: {
  userId: string;
  callId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const [row] = await db.select().from(whatsappCallsTable)
    .where(and(eq(whatsappCallsTable.id, opts.callId), eq(whatsappCallsTable.userId, opts.userId)))
    .limit(1);
  if (!row) return { ok: false, error: "Call not found" };
  const [channel] = await db.select().from(whatsappChannelsTable)
    .where(eq(whatsappChannelsTable.id, row.channelId)).limit(1);
  if (!channel?.vobizChannelId || !row.vobizCallId) {
    await finalizeCall(row.vobizCallId, row.metaCallId, "terminated", "local");
    return { ok: true };
  }
  const creds = await getStrictSubAccountCredsForUser(opts.userId);
  if (!creds) return { ok: false, error: "No VoBiz credentials" };
  await vobizWhatsappCallAction({
    authId: creds.authId,
    authToken: creds.authToken,
    channelId: channel.vobizChannelId,
    callId: row.vobizCallId,
    action: "terminate",
  });
  await finalizeCall(row.vobizCallId, row.metaCallId, "terminated", "user");
  return { ok: true };
}

export async function listWhatsappCalls(userId: string, limit = 30): Promise<WhatsappCall[]> {
  return db.select().from(whatsappCallsTable)
    .where(eq(whatsappCallsTable.userId, userId))
    .orderBy(desc(whatsappCallsTable.createdAt))
    .limit(limit);
}
