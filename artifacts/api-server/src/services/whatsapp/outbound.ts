/**
 * Post-call WhatsApp notify.
 *
 * Precedence per call:
 *  1. BYO-BSP webhook connections (agent-scoped, deliberately configured) —
 *     POSTs call.ended to the customer's URL so their BSP sends the template.
 *  2. Native VoBiz enrollment (user-scoped whatsapp_channels) — SnapServe
 *     sends the WhatsApp template directly via VoBiz (shared or own channel).
 */

import { createHmac } from "crypto";
import { and, eq, ne } from "drizzle-orm";
import {
  db,
  whatsappConnectionsTable,
  callsTable,
  agentsTable,
  bookingsTable,
} from "@workspace/db";
import { logger } from "../../lib/logger.js";
import {
  buildWhatsappCallEndedPayload,
  type WhatsappCallEndedPayload,
} from "./payload.js";
import {
  getActiveChannel,
  hintEnabled,
  resolveSendContext,
  sendWhatsappTemplate,
  getMasterVobizCreds,
  type TemplateHint,
} from "./vobiz.js";

export { buildWhatsappCallEndedPayload } from "./payload.js";
export type { WhatsappCallEndedPayload } from "./payload.js";

async function postOutbound(
  url: string,
  secret: string | null | undefined,
  payload: WhatsappCallEndedPayload,
): Promise<void> {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "SnapServe-WhatsApp/1.0",
    "X-SnapServe-Timestamp": timestamp,
    "X-SnapServe-Event": "call.ended",
  };
  if (secret) {
    const digest = createHmac("sha256", secret)
      .update(`${timestamp}.${body}`)
      .digest("hex");
    headers["X-SnapServe-Signature"] = `sha256=${digest}`;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`outbound webhook HTTP ${res.status}`);
  }
}

function formatMeetingTimeIST(d: Date): string {
  try {
    return new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Kolkata",
    }).format(d) + " IST";
  } catch {
    return d.toISOString();
  }
}

/**
 * Fire-and-forget post-call notification. BYO webhook connections (if any
 * with a URL) own the notification for this agent; otherwise the user's
 * native VoBiz enrollment sends the template directly.
 */
export async function dispatchWhatsappCallEnded(
  callId: number,
  opts?: {
    callSummary?: string | null;
    dispositionResult?: unknown;
  },
): Promise<void> {
  const [call] = await db.select().from(callsTable).where(eq(callsTable.id, callId)).limit(1);
  if (!call?.userId) return;
  const userId = call.userId;

  const connections = await db
    .select()
    .from(whatsappConnectionsTable)
    .where(and(
      eq(whatsappConnectionsTable.userId, call.userId),
      eq(whatsappConnectionsTable.agentId, call.agentId),
      eq(whatsappConnectionsTable.active, true),
      eq(whatsappConnectionsTable.postCallEnabled, true),
    ));
  const withUrl = connections.filter((c) => (c.outboundWebhookUrl ?? "").trim());

  const nativeChannel = withUrl.length === 0 ? await getActiveChannel(call.userId) : null;
  if (withUrl.length === 0 && !nativeChannel) return;

  let direction = "inbound";
  try {
    const meta = call.metadata ? JSON.parse(call.metadata) as Record<string, unknown> : {};
    if (typeof meta["direction"] === "string") direction = meta["direction"];
  } catch { /* ignore */ }
  const phone = direction === "outbound" ? call.toNumber : call.fromNumber;
  if (!phone?.trim()) return;

  const [agent] = await db
    .select({ name: agentsTable.name })
    .from(agentsTable)
    .where(eq(agentsTable.id, call.agentId))
    .limit(1);

  let meetingTime: Date | null = null;
  let meetLink: string | null = null;
  try {
    const [booking] = await db
      .select({
        slotStart: bookingsTable.slotStart,
        meetLink: bookingsTable.meetLink,
      })
      .from(bookingsTable)
      .where(and(
        eq(bookingsTable.callId, callId),
        ne(bookingsTable.status, "cancelled"),
      ))
      .limit(1);
    if (booking) {
      meetingTime = booking.slotStart;
      meetLink = booking.meetLink;
    }
  } catch { /* ignore */ }

  const payload = buildWhatsappCallEndedPayload({
    call,
    agentName: agent?.name ?? "",
    phone,
    direction,
    callSummary: opts?.callSummary,
    dispositionResult: opts?.dispositionResult,
    meetingTime,
    meetLink,
  });

  /* ── Path 1: BYO-BSP webhooks (existing behavior, unchanged) ──────────── */
  if (withUrl.length > 0) {
    for (const conn of withUrl) {
      try {
        await postOutbound(conn.outboundWebhookUrl!.trim(), conn.outboundSecret, payload);
        await db.update(whatsappConnectionsTable)
          .set({ lastOutboundAt: new Date(), lastError: null, updatedAt: new Date() })
          .where(eq(whatsappConnectionsTable.id, conn.id));
        logger.info(
          { callId, connectionId: conn.id, phone },
          "whatsapp: post-call outbound ok",
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await db.update(whatsappConnectionsTable)
          .set({ lastError: msg.slice(0, 500), updatedAt: new Date() })
          .where(eq(whatsappConnectionsTable.id, conn.id))
          .catch(() => {});
        logger.warn(
          { err, callId, connectionId: conn.id },
          "whatsapp: post-call outbound failed",
        );
      }
    }
    return;
  }

  /* ── Path 2: Native VoBiz send ────────────────────────────────────────── */
  const channel = nativeChannel!;
  const hint = (payload.template_hint ?? "call_summary") as TemplateHint;

  if (!hintEnabled(channel, hint)) {
    logger.info({ callId, hint, userId: call.userId }, "whatsapp-native: hint disabled by user — skipped");
    return;
  }
  // Quality gate: don't message customers about no-pickup/failed calls unless
  // a booking exists (booking events are always worth confirming).
  if (call.status !== "completed" && !meetingTime) {
    logger.info({ callId, status: call.status }, "whatsapp-native: non-completed call without booking — skipped");
    return;
  }

  const businessName = channel.businessName || agent?.name || "SnapServe";
  const summary = (opts?.callSummary ?? "").trim();
  let params: string[];
  if (hint === "booking_confirmed" && meetingTime) {
    params = [businessName, formatMeetingTimeIST(meetingTime), meetLink || "—"];
  } else if (hint === "callback_scheduled") {
    params = [businessName, summary || "Our team will call you back soon."];
  } else {
    params = [businessName, summary || "Thanks for speaking with us — we'll be in touch."];
  }

  const ctx = await resolveSendContext(channel, async () => {
    if (channel.mode !== "own") return getMasterVobizCreds();
    try {
      const { ensureVobizSubAccount } = await import("../../routes/kyc.js");
      const creds = await ensureVobizSubAccount(userId);
      if (creds.authId && creds.authToken) return creds;
    } catch (err) {
      logger.warn({ err, userId: call.userId }, "whatsapp-native: sub-account creds unavailable — master fallback");
    }
    return getMasterVobizCreds();
  });
  if ("error" in ctx) {
    logger.warn({ callId, userId: call.userId, error: ctx.error }, "whatsapp-native: post-call send skipped — no send context");
    return;
  }

  // Failures are recorded on the message row + logged by sendWhatsappTemplate.
  await sendWhatsappTemplate({
    channel,
    ctx,
    toPhone: phone,
    hint: hint === "booking_confirmed" && !meetingTime ? "call_summary" : hint,
    params,
    callId,
  });
}
