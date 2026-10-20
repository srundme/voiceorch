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
import { and, desc, eq, ne } from "drizzle-orm";
import {
  db,
  whatsappConnectionsTable,
  callsTable,
  agentsTable,
  bookingsTable,
  executionLogsTable,
  eventTypesTable,
  schedulingCalendarsTable,
} from "@workspace/db";
import { logger } from "../../lib/logger.js";
import {
  buildWhatsappCallEndedPayload,
  resolveConnectionTemplateName,
  type WhatsappCallEndedPayload,
} from "./payload.js";
import { fetchUserConfiguredUrl } from "../../lib/ssrf.js";
import {
  buildMetaParams,
  catalogBodyPreview,
  isMetaTokenExpiredError,
  resolveMetaTemplate,
  sanitizeMetaParam,
  sendMetaTemplate,
  type MetaParamContext,
  type MetaTemplateChoice,
} from "./meta.js";
import { applyExplicitParams, pickCallerName, resolveTemplateParams } from "./template-params.js";
import { formatDispositionLabel } from "../../lib/disposition-match.js";
import type { AfterCallWhatsappTemplate } from "@workspace/db";
import {
  persistRefreshedMetaToken,
  resolveMetaAccessToken,
} from "./meta-token.js";
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

  const res = await fetchUserConfiguredUrl(url, {
    method: "POST",
    headers,
    body,
  }, { timeoutMs: 10_000, retries: 2 });
  if (!res.ok) {
    throw new Error(`outbound webhook HTTP ${res.status}`);
  }
}

function formatMeetingTimeIST(d: Date): string {
  return formatMeetingDateAndTime(d).combined;
}

function formatMeetingDateAndTime(d: Date, timeZone = "Asia/Kolkata"): {
  date: string;
  time: string;
  combined: string;
} {
  try {
    const date = new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone,
    }).format(d);
    const time = new Intl.DateTimeFormat("en-IN", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone,
    }).format(d);
    return { date, time: `${time} IST`, combined: `${date}, ${time} IST` };
  } catch {
    const iso = d.toISOString();
    return { date: iso.slice(0, 10), time: iso.slice(11, 16), combined: iso };
  }
}

export type WhatsappFillContext = {
  callerName: string;
  doctor: string;
  date: string;
  time: string;
  meetingTime: string;
  meetLink: string;
  slotStart: Date | null;
};

async function loadCallWhatsappFill(callId: number): Promise<WhatsappFillContext> {
  const empty: WhatsappFillContext = {
    callerName: "", doctor: "", date: "", time: "", meetingTime: "", meetLink: "", slotStart: null,
  };
  try {
    const [row] = await db
      .select({
        attendeeName: bookingsTable.attendeeName,
        slotStart: bookingsTable.slotStart,
        meetLink: bookingsTable.meetLink,
        eventName: eventTypesTable.name,
        timezone: schedulingCalendarsTable.timezone,
      })
      .from(bookingsTable)
      .leftJoin(eventTypesTable, eq(bookingsTable.eventTypeId, eventTypesTable.id))
      .leftJoin(schedulingCalendarsTable, eq(bookingsTable.calendarId, schedulingCalendarsTable.id))
      .where(and(
        eq(bookingsTable.callId, callId),
        ne(bookingsTable.status, "cancelled"),
        ne(bookingsTable.status, "rescheduled"),
      ))
      .orderBy(desc(bookingsTable.createdAt))
      .limit(1);
    if (!row?.slotStart) return empty;
    const parts = formatMeetingDateAndTime(row.slotStart, row.timezone || "Asia/Kolkata");
    return {
      callerName: (row.attendeeName ?? "").trim(),
      doctor: (row.eventName ?? "").trim(),
      date: parts.date,
      time: parts.time,
      meetingTime: parts.combined,
      meetLink: (row.meetLink ?? "").trim(),
      slotStart: row.slotStart,
    };
  } catch {
    return empty;
  }
}

function mergeWhatsappFill(
  booked: WhatsappFillContext,
  overlay: Partial<Omit<WhatsappFillContext, "slotStart">> & { summary?: string },
): WhatsappFillContext {
  const callerName = (overlay.callerName ?? "").trim() || booked.callerName;
  const doctor = (overlay.doctor ?? "").trim() || booked.doctor;
  const date = (overlay.date ?? "").trim() || booked.date;
  const time = (overlay.time ?? "").trim() || booked.time;
  const meetingTime = (overlay.meetingTime ?? "").trim() || booked.meetingTime
    || (date && time ? `${date}, ${time}` : date || time);
  const meetLink = (overlay.meetLink ?? "").trim() || booked.meetLink;
  return { callerName, doctor, date, time, meetingTime, meetLink, slotStart: booked.slotStart };
}

async function sendMetaTemplateFresh(
  conn: {
    id: string;
    metaAccessToken: string | null;
    metaTokenExpiresAt?: Date | null;
    metaPhoneNumberId: string | null;
    metaApiBase: string | null;
  },
  opts: {
    toPhone: string;
    template: MetaTemplateChoice;
    params: string[];
  },
): Promise<{ ok: true; messageId: string | null } | { ok: false; error: string }> {
  if (!conn.metaAccessToken || !conn.metaPhoneNumberId) {
    return { ok: false, error: "Meta WhatsApp is not connected" };
  }
  let token = await resolveMetaAccessToken({
    connectionId: conn.id,
    encryptedToken: conn.metaAccessToken,
    expiresAt: conn.metaTokenExpiresAt ?? null,
    apiBase: conn.metaApiBase,
  });
  const send = (accessToken: string) => sendMetaTemplate({
    accessToken,
    phoneNumberId: conn.metaPhoneNumberId!,
    toPhone: opts.toPhone,
    template: opts.template,
    params: opts.params,
    apiBase: conn.metaApiBase,
  });
  let result = await send(token);
  if (!result.ok && isMetaTokenExpiredError(result.error)) {
    token = await persistRefreshedMetaToken({
      connectionId: conn.id,
      accessToken: token,
      apiBase: conn.metaApiBase,
    });
    result = await send(token);
  }
  return result;
}

export type WhatsappAttemptStatus = "sent" | "failed" | "skipped";

type WhatsappAttempt = {
  status: WhatsappAttemptStatus;
  provider: "meta" | "vobiz" | "byo" | null;
  /** Why it was skipped, or the provider's error. */
  reason?: string;
  template?: string | null;
  language?: string | null;
  params?: string[];
  messageId?: string | null;
};

/**
 * Record an after-call WhatsApp attempt as a "WhatsApp" row in the call's Logs.
 * History reads the latest row per call for its sent / failed / skipped badge.
 */
async function logWhatsappAttempt(callId: number, agentId: number | null, a: WhatsappAttempt): Promise<void> {
  try {
    await db.insert(executionLogsTable).values({
      callId,
      agentId,
      component: "WhatsApp",
      direction: "system",
      provider: a.provider,
      status: a.status === "sent" ? "success" : a.status === "failed" ? "error" : "info",
      requestPayload: a.template
        ? { template: a.template, language: a.language ?? null, params: a.params ?? [] }
        : null,
      responsePayload: a.status === "sent"
        ? { messageId: a.messageId ?? null }
        : a.reason ? { error: a.reason } : null,
      metadata: {
        event: "After-call WhatsApp",
        whatsapp: { status: a.status, reason: a.reason ?? null, template: a.template ?? null, provider: a.provider },
        ...(a.status === "failed" && a.reason ? { errorMessage: a.reason } : {}),
      },
    });
  } catch (err) {
    logger.warn({ err, callId }, "whatsapp: failed to record attempt in execution logs");
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
    whatsappTemplate?: AfterCallWhatsappTemplate | null;
    /** Campaign lead name, used for the caller name when there is no booking. */
    leadName?: string | null;
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
  const agentId = call.agentId ?? null;
  // Only an agent that picked an after-call template gets "skipped" rows; the
  // legacy always-on path runs for every call and would flood the Logs otherwise.
  const explicit = !!opts?.whatsappTemplate?.name;
  const skip = async (reason: string) => {
    if (!explicit) return;
    await logWhatsappAttempt(callId, agentId, {
      status: "skipped", provider: null, reason, template: opts?.whatsappTemplate?.name ?? null,
    });
  };
  if (withUrl.length === 0 && withMeta.length === 0 && !nativeChannel) {
    await skip("No active WhatsApp connection for this agent");
    return;
  }

  let direction = "inbound";
  try {
    const meta = call.metadata ? JSON.parse(call.metadata) as Record<string, unknown> : {};
    if (typeof meta["direction"] === "string") direction = meta["direction"];
  } catch { /* ignore */ }
  const phone = direction === "outbound" ? call.toNumber : call.fromNumber;
  if (!phone?.trim()) {
    await skip("No phone number on the call");
    return;
  }

  const [agent] = await db
    .select({ name: agentsTable.name })
    .from(agentsTable)
    .where(eq(agentsTable.id, call.agentId))
    .limit(1);

  const booked = await loadCallWhatsappFill(callId);
  const callerSpoke = /\bCaller:\s*\S/.test(call.transcript ?? "");
  // Dead-air / greeting-only calls must not send appointment (or any) WhatsApp.
  // A bookings row used to bypass the status gate and fire booking_confirmed.
  if (!callerSpoke) {
    logger.info({ callId, status: call.status, hadBooking: !!booked.slotStart }, "whatsapp: skipped — no caller speech");
    await skip("The caller never spoke on this call");
    return;
  }
  const meetingTime = booked.slotStart;
  const meetLink = booked.meetLink || null;

  // The agent's explicit {{n}} mapping, resolved for this call ("" = keep the inferred value).
  const fields = (
    opts?.dispositionResult && typeof opts.dispositionResult === "object"
      ? opts.dispositionResult
      : call.dispositionResult
  ) as Record<string, unknown> | null;
  const callerName = pickCallerName(booked.callerName, opts?.leadName, fields);
  const explicitParams = resolveTemplateParams(opts?.whatsappTemplate?.params, {
    callerName,
    agentName: agent?.name ?? "",
    summary: (opts?.callSummary ?? call.callSummary ?? "").trim(),
    phone,
    outcome: formatDispositionLabel(fields),
    meetingTime: booked.meetingTime || (meetingTime ? formatMeetingTimeIST(meetingTime) : ""),
    meetLink: meetLink ?? "",
    fields,
  });

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
        const mapped = (opts?.whatsappTemplate?.name ?? "").trim()
          || resolveConnectionTemplateName(
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
        await logWhatsappAttempt(callId, agentId, {
          status: "sent", provider: "byo", template: mapped || null,
          reason: "Handed to your WhatsApp provider's webhook",
        });
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
        await logWhatsappAttempt(callId, agentId, {
          status: "failed", provider: "byo", reason: `Webhook failed: ${msg}`.slice(0, 1000),
          template: opts?.whatsappTemplate?.name ?? null,
        });
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
      await skip(`Call ended as "${call.status}"; only completed calls get the message`);
      return;
    }
    for (const conn of withMeta) {
      try {
        const tpl = opts?.whatsappTemplate?.name
          ? {
              name: opts.whatsappTemplate.name,
              language: opts.whatsappTemplate.language || "en",
              paramCount: 0,
            }
          : resolveMetaTemplate(
              conn.metaTemplates as Record<string, MetaTemplateChoice | undefined> | null,
              hint,
            );
        if (!tpl) {
          logger.info({ callId, connectionId: conn.id, hint }, "whatsapp-meta: no template linked for hint — skipped");
          await db.update(whatsappConnectionsTable)
            .set({ lastError: "No template linked — open the connection (pencil icon), fetch templates and pick one for Call summary", updatedAt: new Date() })
            .where(eq(whatsappConnectionsTable.id, conn.id))
            .catch(() => {});
          await logWhatsappAttempt(callId, agentId, {
            status: "failed", provider: "meta", reason: "No WhatsApp template is linked for this message",
          });
          continue;
        }
        const catalog = catalogBodyPreview(
          conn.templateCatalog as Array<{ name?: string; language?: string; bodyPreview?: string; paramCount?: number }> | null,
          tpl,
        );
        const paramCount = catalog.paramCount || tpl.paramCount;
        const inferred = buildMetaParams(hint, {
          businessName,
          summary,
          callerName,
          doctor: booked.doctor,
          date: booked.date,
          time: booked.time,
          meetingTime: booked.meetingTime || (meetingTime ? formatMeetingTimeIST(meetingTime) : null),
          meetLink,
          bodyPreview: catalog.bodyPreview,
        }, paramCount);
        const params = applyExplicitParams(inferred, explicitParams).map(sanitizeMetaParam);
        const result = await sendMetaTemplateFresh(conn, {
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
        await logWhatsappAttempt(callId, agentId, result.ok
          ? { status: "sent", provider: "meta", template: tpl.name, language: tpl.language, params, messageId: result.messageId }
          : { status: "failed", provider: "meta", template: tpl.name, language: tpl.language, params, reason: result.error });
      } catch (err) {
        // Decrypt failure or other per-connection error — record it and keep
        // processing remaining connections instead of aborting the dispatch.
        const msg = err instanceof Error ? err.message : String(err);
        await db.update(whatsappConnectionsTable)
          .set({ lastError: `Meta send failed: ${msg}`.slice(0, 500), updatedAt: new Date() })
          .where(eq(whatsappConnectionsTable.id, conn.id))
          .catch(() => {});
        logger.warn({ err, callId, connectionId: conn.id }, "whatsapp-meta: post-call send error");
        await logWhatsappAttempt(callId, agentId, {
          status: "failed", provider: "meta", reason: `Meta send failed: ${msg}`.slice(0, 1000),
          template: opts?.whatsappTemplate?.name ?? null,
        });
      }
    }
    return;
  }

  /* ── Path 2: Native VoBiz send ────────────────────────────────────────── */
  const channel = nativeChannel!;
  const hint = (basePayload.template_hint ?? "call_summary") as TemplateHint;

  if (!hintEnabled(channel, hint)) {
    logger.info({ callId, hint, userId: call.userId }, "whatsapp-native: hint disabled by user — skipped");
    await skip(`The "${hint}" message is turned off on your WhatsApp channel`);
    return;
  }
  // Quality gate: don't message customers about no-pickup/failed calls unless
  // a booking exists (booking events are always worth confirming).
  if (call.status !== "completed" && !meetingTime) {
    logger.info({ callId, status: call.status }, "whatsapp-native: non-completed call without booking — skipped");
    await skip(`Call ended as "${call.status}"; only completed calls get the message`);
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
  // An explicit mapping also decides how many {{n}} slots this template has.
  if (explicitParams.some(Boolean)) {
    params = Array.from(
      { length: Math.max(params.length, explicitParams.length) },
      (_, i) => sanitizeMetaParam(explicitParams[i] || params[i]),
    );
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
    await logWhatsappAttempt(callId, agentId, {
      status: "failed", provider: "vobiz", reason: ctx.error, template: opts?.whatsappTemplate?.name ?? null,
    });
    return;
  }

  // Failures are recorded on the message row + logged by sendWhatsappTemplate.
  const sent = await sendWhatsappTemplate({
    channel,
    ctx,
    toPhone: phone,
    hint: hint === "booking_confirmed" && !meetingTime ? "call_summary" : hint,
    params,
    callId,
    agentId: call.agentId ?? null,
    templateOverride: opts?.whatsappTemplate?.name
      ? { name: opts.whatsappTemplate.name, lang: opts.whatsappTemplate.language || "en" }
      : undefined,
  });
  await logWhatsappAttempt(callId, agentId, sent.ok
    ? { status: "sent", provider: "vobiz", template: opts?.whatsappTemplate?.name ?? hint, params, messageId: sent.vobizMessageId ?? null }
    : {
        status: sent.skipped ? "skipped" : "failed",
        provider: "vobiz",
        template: opts?.whatsappTemplate?.name ?? hint,
        params,
        reason: sent.error ?? "WhatsApp send failed",
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
  callerName?: string;
  doctor?: string;
  date?: string;
  time?: string;
  explicitParams?: string[];
}): Promise<{ ok: boolean; error?: string; via?: "byo" | "native" }> {
  const phone = opts.toPhone.trim();
  if (!phone) return { ok: false, error: "Missing phone number" };

  const hint = (opts.templateHint?.trim() || "call_summary") as TemplateHint;
  const allowed: TemplateHint[] = ["call_summary", "booking_confirmed", "callback_scheduled"];
  const safeHint = allowed.includes(hint) ? hint : "call_summary";
  const booked = await loadCallWhatsappFill(opts.callId);
  const fill = mergeWhatsappFill(booked, {
    callerName: opts.callerName,
    doctor: opts.doctor,
    date: opts.date,
    time: opts.time,
  });
  const paramCtx = (bodyPreview?: string): MetaParamContext => ({
    businessName: opts.agentName || "SnapServe",
    summary: (opts.summary ?? "").trim(),
    callerName: fill.callerName,
    doctor: fill.doctor,
    date: fill.date,
    time: fill.time,
    meetingTime: fill.meetingTime || null,
    meetLink: fill.meetLink || null,
    explicitParams: opts.explicitParams,
    bodyPreview: bodyPreview || null,
  });

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
      caller_name: fill.callerName,
      doctor: fill.doctor,
      date: fill.date,
      time: fill.time,
      template_hint: safeHint,
      ...(opts.explicitParams?.length ? { params: opts.explicitParams } : {}),
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
      const err = `No Meta template linked for ${safeHint} on this connection — open the connection (pencil icon), fetch templates and pick one for Call summary`;
      await db.update(whatsappConnectionsTable)
        .set({ lastError: err.slice(0, 500), updatedAt: new Date() })
        .where(eq(whatsappConnectionsTable.id, conn.id))
        .catch(() => {});
      return { ok: false, error: err, via: "byo" };
    }
    const catalog = catalogBodyPreview(
      conn.templateCatalog as Array<{ name?: string; language?: string; bodyPreview?: string; paramCount?: number }> | null,
      tpl,
    );
    const paramCount = catalog.paramCount || tpl.paramCount;
    const params = buildMetaParams(safeHint, paramCtx(catalog.bodyPreview), paramCount);
    logger.info(
      { callId: opts.callId, template: tpl.name, paramCount, params, hint: safeHint },
      "whatsapp-meta: mid-call params",
    );
    const result = await sendMetaTemplateFresh(conn, {
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
  const { resolveNativeTemplateForAgent } = await import("./agent-templates.js");
  const nativeTpl = await resolveNativeTemplateForAgent(opts.userId, opts.agentId, safeHint);
  const catalog = catalogBodyPreview(
    channel.templateCatalog as Array<{ name?: string; language?: string; bodyPreview?: string; paramCount?: number }> | null,
    { name: nativeTpl.name, language: nativeTpl.lang, paramCount: 0 },
  );
  const paramCount = catalog.paramCount || (catalog.bodyPreview ? (catalog.bodyPreview.match(/\{\{\s*\d+\s*\}\}/g)?.length ?? 0) : 0);
  const params = paramCount > 0
    ? buildMetaParams(safeHint, { ...paramCtx(catalog.bodyPreview), businessName, summary }, paramCount)
    : safeHint === "booking_confirmed"
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
    agentId: opts.agentId,
  });
  if (!result.ok) return { ok: false, error: result.error ?? "send failed", via: "native" };
  return { ok: true, via: "native" };
}
