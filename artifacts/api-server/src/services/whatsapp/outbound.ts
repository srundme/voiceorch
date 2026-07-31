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
  resolveConnectionTemplateName,
  type WhatsappCallEndedPayload,
} from "./payload.js";
import { decryptKey } from "../../lib/crypto.js";
import {
  buildMetaParams,
  resolveMetaTemplate,
  sendMetaTemplate,
  type MetaTemplateChoice,
} from "./meta.js";
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
  payload: WhatsappCallEndedPayload | Record<string, unknown>,
  eventHeader = "call.ended",
): Promise<void> {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "SnapServe-WhatsApp/1.0",
    "X-SnapServe-Timestamp": timestamp,
    "X-SnapServe-Event": eventHeader,
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
  const withMeta = connections.filter(
    (c) => !(c.outboundWebhookUrl ?? "").trim() && c.metaAccessToken && c.metaPhoneNumberId,
  );

  const nativeChannel = withUrl.length === 0 && withMeta.length === 0 ? await getActiveChannel(call.userId) : null;
  if (withUrl.length === 0 && withMeta.length === 0 && !nativeChannel) return;

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

  const basePayload = buildWhatsappCallEndedPayload({
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
        const mapped = resolveConnectionTemplateName(
          conn.templates as Record<string, string | undefined> | null,
          basePayload.template_hint,
        );
        const payload: WhatsappCallEndedPayload = mapped
          ? { ...basePayload, template_name: mapped }
          : basePayload;
        await postOutbound(conn.outboundWebhookUrl!.trim(), conn.outboundSecret, payload);
        await db.update(whatsappConnectionsTable)
          .set({ lastOutboundAt: new Date(), lastError: null, updatedAt: new Date() })
          .where(eq(whatsappConnectionsTable.id, conn.id));
        logger.info(
          { callId, connectionId: conn.id, phone, template_name: mapped },
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

  /* ── Path 1.5: Direct Meta Cloud API send ─────────────────────────────── */
  if (withMeta.length > 0) {
    const hint = (basePayload.template_hint ?? "call_summary") as string;
    const businessName = agent?.name || "SnapServe";
    const summary = (opts?.callSummary ?? call.callSummary ?? "").trim();
    // Quality gate mirrors native path: skip failed/no-pickup calls unless a booking exists.
    if (call.status !== "completed" && !meetingTime) {
      logger.info({ callId, status: call.status }, "whatsapp-meta: non-completed call without booking — skipped");
      return;
    }
    for (const conn of withMeta) {
      try {
        const tpl = resolveMetaTemplate(
          conn.metaTemplates as Record<string, MetaTemplateChoice | undefined> | null,
          hint,
        );
        if (!tpl) {
          logger.info({ callId, connectionId: conn.id, hint }, "whatsapp-meta: no template linked for hint — skipped");
          continue;
        }
        const params = buildMetaParams(hint, {
          businessName,
          summary,
          meetingTime: meetingTime ? formatMeetingTimeIST(meetingTime) : null,
          meetLink,
        }, tpl.paramCount);
        const result = await sendMetaTemplate({
          accessToken: decryptKey(conn.metaAccessToken!),
          phoneNumberId: conn.metaPhoneNumberId!,
          toPhone: phone,
          template: tpl,
          params,
        });
        await db.update(whatsappConnectionsTable)
          .set(result.ok
            ? { lastOutboundAt: new Date(), lastError: null, updatedAt: new Date() }
            : { lastError: result.ok ? null : result.error.slice(0, 500), updatedAt: new Date() })
          .where(eq(whatsappConnectionsTable.id, conn.id))
          .catch(() => {});
        logger.info(
          { callId, connectionId: conn.id, phone, template: tpl.name, ok: result.ok, ...(result.ok ? {} : { error: result.error }) },
          "whatsapp-meta: post-call send",
        );
      } catch (err) {
        // Decrypt failure or other per-connection error — record it and keep
        // processing remaining connections instead of aborting the dispatch.
        const msg = err instanceof Error ? err.message : String(err);
        await db.update(whatsappConnectionsTable)
          .set({ lastError: `Meta send failed: ${msg}`.slice(0, 500), updatedAt: new Date() })
          .where(eq(whatsappConnectionsTable.id, conn.id))
          .catch(() => {});
        logger.warn({ err, callId, connectionId: conn.id }, "whatsapp-meta: post-call send error");
      }
    }
    return;
  }

  /* ── Path 2: Native VoBiz send ────────────────────────────────────────── */
  const channel = nativeChannel!;
  const hint = (basePayload.template_hint ?? "call_summary") as TemplateHint;

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

/**
 * Mid-call WhatsApp send for the voice agent tool.
 * Prefers BYO BSP webhook for this agent; otherwise native Instant/Business channel.
 */
export async function sendMidCallWhatsapp(opts: {
  userId: string;
  agentId: number;
  agentName?: string;
  callId: number;
  toPhone: string;
  templateHint?: string;
  templateName?: string;
  summary?: string;
}): Promise<{ ok: boolean; error?: string; via?: "byo" | "native" }> {
  const phone = opts.toPhone.trim();
  if (!phone) return { ok: false, error: "Missing phone number" };

  const hint = (opts.templateHint?.trim() || "call_summary") as TemplateHint;
  const allowed: TemplateHint[] = ["call_summary", "booking_confirmed", "callback_scheduled"];
  const safeHint = allowed.includes(hint) ? hint : "call_summary";

  const [conn] = await db
    .select()
    .from(whatsappConnectionsTable)
    .where(and(
      eq(whatsappConnectionsTable.userId, opts.userId),
      eq(whatsappConnectionsTable.agentId, opts.agentId),
      eq(whatsappConnectionsTable.active, true),
    ))
    .limit(1);

  const byoUrl = (conn?.outboundWebhookUrl ?? "").trim();
  if (conn && byoUrl) {
    const mapped =
      (opts.templateName ?? "").trim() ||
      resolveConnectionTemplateName(
        conn.templates as Record<string, string | undefined> | null,
        safeHint,
      );
    const payload: Record<string, unknown> = {
      event: "call.mid",
      action: "send_whatsapp",
      phone,
      call_id: opts.callId,
      agent_id: opts.agentId,
      agent_name: opts.agentName ?? "",
      summary: opts.summary ?? "",
      template_hint: safeHint,
      ...(mapped ? { template_name: mapped } : {}),
      timestamp: new Date().toISOString(),
    };
    try {
      await postOutbound(byoUrl, conn.outboundSecret, payload, "call.mid");
      await db.update(whatsappConnectionsTable)
        .set({ lastOutboundAt: new Date(), lastError: null, updatedAt: new Date() })
        .where(eq(whatsappConnectionsTable.id, conn.id));
      return { ok: true, via: "byo" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await db.update(whatsappConnectionsTable)
        .set({ lastError: msg.slice(0, 500), updatedAt: new Date() })
        .where(eq(whatsappConnectionsTable.id, conn.id))
        .catch(() => {});
      return { ok: false, error: msg, via: "byo" };
    }
  }

  /* Mid-call direct Meta Cloud API send */
  if (conn && conn.metaAccessToken && conn.metaPhoneNumberId) {
    try {
    const tpl = resolveMetaTemplate(
      conn.metaTemplates as Record<string, MetaTemplateChoice | undefined> | null,
      safeHint,
    );
    if (!tpl) {
      return { ok: false, error: `No Meta template linked for ${safeHint} on this connection`, via: "byo" };
    }
    const params = buildMetaParams(safeHint, {
      businessName: opts.agentName || "SnapServe",
      summary: (opts.summary ?? "").trim(),
    }, tpl.paramCount);
    const result = await sendMetaTemplate({
      accessToken: decryptKey(conn.metaAccessToken),
      phoneNumberId: conn.metaPhoneNumberId,
      toPhone: phone,
      template: tpl,
      params,
    });
    await db.update(whatsappConnectionsTable)
      .set(result.ok
        ? { lastOutboundAt: new Date(), lastError: null, updatedAt: new Date() }
        : { lastError: result.ok ? null : result.error.slice(0, 500), updatedAt: new Date() })
      .where(eq(whatsappConnectionsTable.id, conn.id))
      .catch(() => {});
    if (!result.ok) return { ok: false, error: result.error, via: "byo" };
    return { ok: true, via: "byo" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await db.update(whatsappConnectionsTable)
        .set({ lastError: `Meta send failed: ${msg}`.slice(0, 500), updatedAt: new Date() })
        .where(eq(whatsappConnectionsTable.id, conn.id))
        .catch(() => {});
      return { ok: false, error: msg, via: "byo" };
    }
  }

  const channel = await getActiveChannel(opts.userId);
  if (!channel) {
    return { ok: false, error: "No WhatsApp channel or BSP connection configured" };
  }
  if (!hintEnabled(channel, safeHint)) {
    return { ok: false, error: `Template ${safeHint} is disabled on your WhatsApp channel` };
  }

  const businessName = channel.businessName || opts.agentName || "SnapServe";
  const summary = (opts.summary ?? "").trim() || "Thanks for speaking with us.";
  const params =
    safeHint === "booking_confirmed"
      ? [businessName, summary, "—"]
      : [businessName, summary];

  const ctx = await resolveSendContext(channel, async () => {
    if (channel.mode !== "own") return getMasterVobizCreds();
    try {
      const { ensureVobizSubAccount } = await import("../../routes/kyc.js");
      const creds = await ensureVobizSubAccount(opts.userId);
      if (creds.authId && creds.authToken) return creds;
    } catch { /* fall through */ }
    return getMasterVobizCreds();
  });
  if ("error" in ctx) return { ok: false, error: ctx.error, via: "native" };

  const result = await sendWhatsappTemplate({
    channel,
    ctx,
    toPhone: phone,
    hint: safeHint,
    params,
    callId: opts.callId,
  });
  if (!result.ok) return { ok: false, error: result.error ?? "send failed", via: "native" };
  return { ok: true, via: "native" };
}
