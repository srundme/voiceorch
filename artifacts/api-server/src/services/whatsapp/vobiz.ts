/**
 * Native VoBiz WhatsApp sends — first-party template messages, no BYO-BSP.
 *
 * Two tiers (whatsapp_channels.mode):
 *  - 'shared': platform's SnapServe channel (master creds + platform_settings
 *    config). Zero user setup; per-user rolling daily cap.
 *  - 'own':    user's own WABA/number connected as a VoBiz channel under their
 *    sub-account creds (master fallback).
 *
 * VoBiz contract (vobiz-whatsapp skill): POST /api/v1/messaging/messages with
 * channel_id + waba_id + to (+E.164) + type. Template sends carry
 * template.name, template.language.code, components[] with ordered params.
 * Params must be single-line (Meta rejects newlines/tabs).
 */

import { and, eq, gt, ne, sql } from "drizzle-orm";
import {
  db,
  platformSettingsTable,
  whatsappChannelsTable,
  whatsappMessagesTable,
  type WhatsappChannel,
} from "@workspace/db";
import { logger } from "../../lib/logger.js";
import {
  assertWhatsappSendBalance,
  debitWhatsappMessage,
  getWhatsappMessageRates,
  rateForTemplateCategory,
} from "./billing.js";

export const VOBIZ_API_BASE = "https://api.vobiz.ai/api/v1";

/* platform_settings keys for the shared SnapServe channel */
export const KEY_WA_SHARED_CHANNEL_ID = "vobiz_wa_shared_channel_id";
export const KEY_WA_SHARED_WABA_ID = "vobiz_wa_shared_waba_id";
export const KEY_WA_TEMPLATES = "vobiz_wa_templates";

export type TemplateHint = "booking_confirmed" | "call_summary" | "callback_scheduled";

export interface TemplateRef { name: string; lang: string; }

export const DEFAULT_WA_TEMPLATES: Record<TemplateHint, TemplateRef> = {
  booking_confirmed:  { name: "snapserve_booking_confirmed",  lang: "en" },
  call_summary:       { name: "snapserve_call_summary",       lang: "en" },
  callback_scheduled: { name: "snapserve_callback_scheduled", lang: "en" },
};

export function vobizApiHeaders(authId: string, authToken: string): Record<string, string> {
  const basic = Buffer.from(`${authId}:${authToken}`).toString("base64");
  return {
    "Authorization": `Basic ${basic}`,
    "X-Auth-ID":     authId,
    "X-Auth-Token":  authToken,
    "Accept":        "application/json",
    "Content-Type":  "application/json",
  };
}

export function getMasterVobizCreds(): { authId: string; authToken: string } | null {
  const authId = process.env["VOBIZ_AUTH_ID"];
  const authToken = process.env["VOBIZ_AUTH_TOKEN"];
  return authId && authToken ? { authId, authToken } : null;
}

async function getSetting(key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: platformSettingsTable.value })
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.key, key))
    .limit(1);
  const v = row?.value?.trim();
  return v ? v : null;
}

export async function getSharedChannelConfig(): Promise<{ channelId: string; wabaId: string } | null> {
  const [channelId, wabaId] = await Promise.all([
    getSetting(KEY_WA_SHARED_CHANNEL_ID),
    getSetting(KEY_WA_SHARED_WABA_ID),
  ]);
  return channelId && wabaId ? { channelId, wabaId } : null;
}

/** Template catalog: code defaults overridden by platform_settings JSON. */
export async function getTemplateCatalog(): Promise<Record<TemplateHint, TemplateRef>> {
  const raw = await getSetting(KEY_WA_TEMPLATES);
  if (!raw) return DEFAULT_WA_TEMPLATES;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<TemplateHint, Partial<TemplateRef>>>;
    const merged = { ...DEFAULT_WA_TEMPLATES };
    for (const k of Object.keys(merged) as TemplateHint[]) {
      const o = parsed[k];
      if (o?.name) merged[k] = { name: String(o.name), lang: String(o.lang || merged[k].lang) };
    }
    return merged;
  } catch {
    logger.warn({ key: KEY_WA_TEMPLATES }, "whatsapp-native: invalid template catalog JSON — using defaults");
    return DEFAULT_WA_TEMPLATES;
  }
}

/** WhatsApp template params must be single-line and reasonably short. */
export function sanitizeParam(v: string | null | undefined, max = 550): string {
  const s = (v ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "—";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function toPlusE164(raw: string): string {
  const t = (raw ?? "").trim();
  if (t.startsWith("+")) return `+${t.slice(1).replace(/\D/g, "")}`;
  const digits = t.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  return `+${digits}`;
}

/** Rolling 24h business-initiated send count for cap enforcement. */
export async function countRecentOutbound(channelId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 3600_000);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(whatsappMessagesTable)
    .where(and(
      eq(whatsappMessagesTable.channelId, channelId),
      eq(whatsappMessagesTable.direction, "outbound"),
      gt(whatsappMessagesTable.createdAt, since),
      ne(whatsappMessagesTable.status, "failed"),
    ));
  return row?.n ?? 0;
}

export interface SendContext {
  vobizChannelId: string;
  wabaId: string;
  authId: string;
  authToken: string;
}

/**
 * Resolve the VoBiz channel + creds used to send for an enrollment.
 * Own-mode creds resolution is injected by the caller (routes own the
 * sub-account helper) to keep this service dependency-light.
 */
export async function resolveSendContext(
  channel: WhatsappChannel,
  getOwnCreds?: () => Promise<{ authId: string; authToken: string } | null>,
): Promise<SendContext | { error: string }> {
  if (channel.mode === "own") {
    if (!channel.vobizChannelId || !channel.wabaId) {
      return { error: "own channel not fully connected (missing channel/waba id)" };
    }
    const creds = (getOwnCreds ? await getOwnCreds() : null) ?? getMasterVobizCreds();
    if (!creds) return { error: "VoBiz credentials not configured" };
    return { vobizChannelId: channel.vobizChannelId, wabaId: channel.wabaId, ...creds };
  }
  const shared = await getSharedChannelConfig();
  if (!shared) return { error: "shared WhatsApp channel not configured by platform admin" };
  const creds = getMasterVobizCreds();
  if (!creds) return { error: "VoBiz master credentials not configured" };
  return { vobizChannelId: shared.channelId, wabaId: shared.wabaId, ...creds };
}

export interface SendTemplateArgs {
  channel: WhatsappChannel;
  ctx: SendContext;
  toPhone: string;               // any format; normalized to +E.164
  hint: TemplateHint;
  /** Ordered body parameters (already meaningful for the template). */
  params: string[];
  callId?: number | null;
  /** When set, prefer this agent's saved template picks over platform catalog. */
  agentId?: number | null;
  /** Explicit override (wins over agent picks + platform catalog). */
  templateOverride?: TemplateRef;
  enforceCap?: boolean;          // default true for shared tier
}

export interface SendResult {
  ok: boolean;
  messageRowId?: string;
  vobizMessageId?: string | null;
  error?: string;
  skipped?: "daily_cap" | "invalid_phone" | "insufficient_balance";
}

/** Send one template message and log it to whatsapp_messages. */
export async function sendWhatsappTemplate(args: SendTemplateArgs): Promise<SendResult> {
  const { channel, ctx, hint } = args;
  const to = toPlusE164(args.toPhone);
  if (to.replace(/\D/g, "").length < 8) {
    return { ok: false, skipped: "invalid_phone", error: `invalid phone: ${args.toPhone}` };
  }

  const enforceCap = args.enforceCap ?? (channel.mode === "shared");
  if (enforceCap) {
    const used = await countRecentOutbound(channel.id);
    if (used >= channel.dailyCap) {
      logger.warn({ channelId: channel.id, used, cap: channel.dailyCap }, "whatsapp-native: daily cap reached — send skipped");
      return { ok: false, skipped: "daily_cap", error: `daily cap ${channel.dailyCap} reached` };
    }
  }

  let tpl: TemplateRef;
  if (args.templateOverride?.name) {
    tpl = args.templateOverride;
  } else if (args.agentId != null && Number.isFinite(args.agentId)) {
    const { resolveNativeTemplateForAgent } = await import("./agent-templates.js");
    tpl = await resolveNativeTemplateForAgent(channel.userId, args.agentId, hint);
  } else {
    const catalog = await getTemplateCatalog();
    tpl = catalog[hint] ?? catalog.call_summary;
  }
  const params = args.params.map((p) => sanitizeParam(p));

  // Own-channel: SnapServe wallet bills per message. Shared Instant stays capped, not billed.
  let billPaise = 0;
  if (channel.mode === "own") {
    const rates = await getWhatsappMessageRates();
    billPaise = rateForTemplateCategory(rates, (args as { templateCategory?: string }).templateCategory);
    const check = await assertWhatsappSendBalance(channel.userId, billPaise);
    if (!check.ok) {
      return { ok: false, skipped: "insufficient_balance", error: check.error };
    }
  }

  const [row] = await db.insert(whatsappMessagesTable).values({
    userId: channel.userId,
    channelId: channel.id,
    callId: args.callId ?? null,
    direction: "outbound",
    phone: to,
    msgType: "template",
    templateName: tpl.name,
    bodyPreview: params.join(" · ").slice(0, 300),
    status: "pending",
  }).returning({ id: whatsappMessagesTable.id });

  const body = {
    channel_id: ctx.vobizChannelId,
    waba_id: ctx.wabaId,
    to,
    type: "template",
    template: {
      name: tpl.name,
      language: { code: tpl.lang },
      components: [{
        type: "body",
        parameters: params.map((text) => ({ type: "text", text })),
      }],
    },
  };

  try {
    const resp = await fetch(`${VOBIZ_API_BASE}/messaging/messages`, {
      method: "POST",
      headers: vobizApiHeaders(ctx.authId, ctx.authToken),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await resp.text().catch(() => "");
    if (!resp.ok) {
      const err = `VoBiz send HTTP ${resp.status}: ${text.slice(0, 300)}`;
      await db.update(whatsappMessagesTable)
        .set({ status: "failed", errorMessage: err.slice(0, 500), updatedAt: new Date() })
        .where(eq(whatsappMessagesTable.id, row!.id));
      logger.warn({ channelId: channel.id, to, hint, status: resp.status, body: text.slice(0, 300) }, "whatsapp-native: send failed");
      return { ok: false, messageRowId: row!.id, error: err };
    }
    let vobizMessageId: string | null = null;
    let metaMessageId: string | null = null;
    let status = "pending";
    try {
      const j = JSON.parse(text) as Record<string, any>;
      const msg = j["message"] ?? j["data"] ?? j;
      vobizMessageId = msg?.["id"] != null ? String(msg["id"]) : null;
      metaMessageId = msg?.["meta_message_id"] != null ? String(msg["meta_message_id"]) : null;
      if (typeof msg?.["status"] === "string") status = msg["status"];
    } catch { /* keep pending */ }
    await db.update(whatsappMessagesTable)
      .set({ vobizMessageId, metaMessageId, status, updatedAt: new Date() })
      .where(eq(whatsappMessagesTable.id, row!.id));
    if (channel.mode === "own" && billPaise > 0) {
      const billed = await debitWhatsappMessage({
        clerkUserId: channel.userId,
        messageRowId: row!.id,
        amountPaise: billPaise,
        description: `WhatsApp template ${tpl.name} → ${to}`,
      });
      if (!billed.ok && billed.code === "INSUFFICIENT_BALANCE") {
        logger.warn({ channelId: channel.id, messageRowId: row!.id }, "whatsapp-native: send ok but wallet debit failed");
      }
    }
    logger.info({ channelId: channel.id, to, hint, vobizMessageId }, "whatsapp-native: template sent");
    return { ok: true, messageRowId: row!.id, vobizMessageId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.update(whatsappMessagesTable)
      .set({ status: "failed", errorMessage: msg.slice(0, 500), updatedAt: new Date() })
      .where(eq(whatsappMessagesTable.id, row!.id))
      .catch(() => {});
    logger.warn({ err, channelId: channel.id, to, hint }, "whatsapp-native: send error");
    return { ok: false, messageRowId: row!.id, error: msg };
  }
}

/** Load a user's active native enrollment, or null. */
export async function getActiveChannel(userId: string): Promise<WhatsappChannel | null> {
  const [row] = await db
    .select()
    .from(whatsappChannelsTable)
    .where(and(
      eq(whatsappChannelsTable.userId, userId),
      eq(whatsappChannelsTable.active, true),
      eq(whatsappChannelsTable.status, "active"),
    ))
    .limit(1);
  return row ?? null;
}

/** Map a template hint to the per-event notify toggle. */
export function hintEnabled(channel: WhatsappChannel, hint: TemplateHint): boolean {
  if (hint === "booking_confirmed") return channel.notifyBookingConfirmed;
  if (hint === "callback_scheduled") return channel.notifyCallbackScheduled;
  return channel.notifyCallSummary;
}

/* ── Shared helpers for BYON / templates / freeform sends ─────────────────── */

/**
 * Carrier error bodies can echo request fields — including Meta access
 * tokens — so anything persisted or returned to the client must be scrubbed:
 * exact secret occurrences removed, long token-like sequences redacted,
 * length capped.
 */
function looksLikeHtmlError(raw: string): boolean {
  const t = raw.trimStart();
  return /^<!DOCTYPE/i.test(t) || /^<html[\s>]/i.test(t) || /<\/(?:html|body|head)>/i.test(raw);
}

export function sanitizeVobizError(raw: string, secrets: Array<string | undefined> = []): string {
  if (looksLikeHtmlError(raw) || /bad gateway|error code 502|cloudflare/i.test(raw) && /<html/i.test(raw)) {
    return "Carrier unavailable, try again";
  }
  let out = raw;
  for (const s of secrets) {
    if (s && s.length >= 6) out = out.split(s).join("[redacted]");
  }
  out = out.replace(/[A-Za-z0-9_\-.]{24,}/g, "[redacted]");
  if (looksLikeHtmlError(out)) return "Carrier unavailable, try again";
  return out.slice(0, 300);
}

/** User's sub-account creds with silent master fallback (send/read paths). */
export async function getOwnCredsForUser(userId: string): Promise<{ authId: string; authToken: string } | null> {
  try {
    const { ensureVobizSubAccount } = await import("../../routes/kyc.js");
    const creds = await ensureVobizSubAccount(userId);
    if (creds.authId && creds.authToken) return creds;
  } catch (err) {
    logger.warn({ err, userId }, "whatsapp: sub-account creds unavailable — falling back to master");
  }
  return getMasterVobizCreds();
}

/**
 * Own-channel/number MUTATIONS must run under the user's OWN VoBiz
 * sub-account. ensureVobizSubAccount silently falls back to master when
 * provisioning fails — reject that here, or the resource would land in the
 * platform account instead of the user's.
 */
export async function getStrictSubAccountCredsForUser(userId: string): Promise<{ authId: string; authToken: string } | null> {
  try {
    const { ensureVobizSubAccount } = await import("../../routes/kyc.js");
    const c = await ensureVobizSubAccount(userId);
    if (!c.authId || !c.authToken) return null;
    const master = getMasterVobizCreds();
    if (master && c.authId === master.authId) return null;
    return { authId: c.authId, authToken: c.authToken };
  } catch (err) {
    logger.warn({ err, userId }, "whatsapp: sub-account resolution failed");
    return null;
  }
}

export interface VobizApiResult {
  ok: boolean;
  status: number;
  json: Record<string, any> | null;
  rawText: string;
}

/** Generic VoBiz messaging-API call with defensive JSON parsing. */
export async function vobizApiCall(
  creds: { authId: string; authToken: string },
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  payload?: unknown,
): Promise<VobizApiResult> {
  try {
    const resp = await fetch(`${VOBIZ_API_BASE}${path}`, {
      method,
      headers: vobizApiHeaders(creds.authId, creds.authToken),
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
      signal: AbortSignal.timeout(20_000),
    });
    const rawText = await resp.text().catch(() => "");
    let json: Record<string, any> | null = null;
    try { json = rawText ? (JSON.parse(rawText) as Record<string, any>) : null; } catch { /* non-JSON */ }
    return { ok: resp.ok, status: resp.status, json, rawText };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, json: null, rawText: msg };
  }
}

export interface SendFreeformArgs {
  channel: WhatsappChannel;
  ctx: SendContext;
  toPhone: string;
  kind: "text" | "document" | "image";
  text?: string;
  media?: { link: string; filename?: string; caption?: string };
  callId?: number | null;
  enforceCap?: boolean;
}

/**
 * Send one free-form (non-template) message inside the 24h customer-service
 * window and log it to whatsapp_messages. Meta rejects free-form messages
 * outside the window — callers should only use this in reply to a fresh
 * inbound message.
 */
export async function sendWhatsappFreeform(args: SendFreeformArgs): Promise<SendResult> {
  const { channel, ctx } = args;
  const to = toPlusE164(args.toPhone);
  if (to.replace(/\D/g, "").length < 8) {
    return { ok: false, skipped: "invalid_phone", error: `invalid phone: ${args.toPhone}` };
  }
  const enforceCap = args.enforceCap ?? (channel.mode === "shared");
  if (enforceCap) {
    const used = await countRecentOutbound(channel.id);
    if (used >= channel.dailyCap) {
      logger.warn({ channelId: channel.id, used, cap: channel.dailyCap }, "whatsapp: daily cap reached — freeform send skipped");
      return { ok: false, skipped: "daily_cap", error: `daily cap ${channel.dailyCap} reached` };
    }
  }

  const preview = args.kind === "text"
    ? (args.text ?? "")
    : `[${args.kind}] ${args.media?.filename ?? args.media?.link ?? ""}`;

  let billPaise = 0;
  if (channel.mode === "own") {
    const rates = await getWhatsappMessageRates();
    billPaise = rates.freeformPaise;
    const check = await assertWhatsappSendBalance(channel.userId, billPaise);
    if (!check.ok) {
      return { ok: false, skipped: "insufficient_balance", error: check.error };
    }
  }

  const [row] = await db.insert(whatsappMessagesTable).values({
    userId: channel.userId,
    channelId: channel.id,
    callId: args.callId ?? null,
    direction: "outbound",
    phone: to,
    msgType: args.kind === "text" ? "text" : "media",
    bodyPreview: preview.slice(0, 300),
    status: "pending",
  }).returning({ id: whatsappMessagesTable.id });

  const body: Record<string, unknown> = {
    channel_id: ctx.vobizChannelId,
    waba_id: ctx.wabaId,
    to,
    type: args.kind,
  };
  if (args.kind === "text") {
    body["text"] = { body: (args.text ?? "").slice(0, 3900) };
  } else {
    body["media"] = {
      link: args.media?.link,
      ...(args.kind === "document" && args.media?.filename ? { filename: args.media.filename } : {}),
      ...(args.media?.caption ? { caption: args.media.caption.slice(0, 900) } : {}),
    };
  }

  try {
    const resp = await fetch(`${VOBIZ_API_BASE}/messaging/messages`, {
      method: "POST",
      headers: vobizApiHeaders(ctx.authId, ctx.authToken),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await resp.text().catch(() => "");
    if (!resp.ok) {
      const err = `VoBiz send HTTP ${resp.status}: ${text.slice(0, 300)}`;
      await db.update(whatsappMessagesTable)
        .set({ status: "failed", errorMessage: err.slice(0, 500), updatedAt: new Date() })
        .where(eq(whatsappMessagesTable.id, row!.id));
      logger.warn({ channelId: channel.id, to, kind: args.kind, status: resp.status }, "whatsapp: freeform send failed");
      return { ok: false, messageRowId: row!.id, error: err };
    }
    let vobizMessageId: string | null = null;
    let metaMessageId: string | null = null;
    let status = "pending";
    try {
      const j = JSON.parse(text) as Record<string, any>;
      const msg = j["message"] ?? j["data"] ?? j;
      vobizMessageId = msg?.["id"] != null ? String(msg["id"]) : null;
      metaMessageId = msg?.["meta_message_id"] != null ? String(msg["meta_message_id"]) : null;
      if (typeof msg?.["status"] === "string") status = msg["status"];
    } catch { /* keep pending */ }
    await db.update(whatsappMessagesTable)
      .set({ vobizMessageId, metaMessageId, status, updatedAt: new Date() })
      .where(eq(whatsappMessagesTable.id, row!.id));
    if (channel.mode === "own" && billPaise > 0) {
      await debitWhatsappMessage({
        clerkUserId: channel.userId,
        messageRowId: row!.id,
        amountPaise: billPaise,
        description: `WhatsApp ${args.kind} → ${to}`,
      });
    }
    logger.info({ channelId: channel.id, to, kind: args.kind, vobizMessageId }, "whatsapp: freeform sent");
    return { ok: true, messageRowId: row!.id, vobizMessageId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.update(whatsappMessagesTable)
      .set({ status: "failed", errorMessage: msg.slice(0, 500), updatedAt: new Date() })
      .where(eq(whatsappMessagesTable.id, row!.id))
      .catch(() => {});
    logger.warn({ err, channelId: channel.id, to, kind: args.kind }, "whatsapp: freeform send error");
    return { ok: false, messageRowId: row!.id, error: msg };
  }
}
