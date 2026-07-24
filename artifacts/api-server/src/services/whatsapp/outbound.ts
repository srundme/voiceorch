/**
 * Post-call WhatsApp notify — POSTs call.ended to the customer's outbound webhook
 * so their BSP / Zapier can send a WhatsApp template.
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

/**
 * Fire-and-forget: notify all active WhatsApp connections for this agent
 * that have post-call outbound enabled.
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
  if (withUrl.length === 0) return;

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
}
