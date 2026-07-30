/**
 * User email messaging channel — managed SnapServe Brevo OR BYO Brevo.
 */

import { eq } from "drizzle-orm";
import {
  db,
  emailChannelsTable,
  emailMessagesTable,
  type EmailChannel,
  type EmailChannelMode,
  type EmailContentTemplate,
} from "@workspace/db";
import { encryptKey, decryptKey } from "../lib/crypto.js";
import { logger } from "../lib/logger.js";
import { interpolateTemplate, type TemplateContext } from "./template-vars.js";

const MANAGED_FROM = { name: "SnapServe", email: "noreply@snapserve.ai" };

function wrapManagedShell(innerHtml: string, agentName?: string): string {
  const safe = innerHtml.includes("<") ? innerHtml : `<p>${innerHtml.replace(/\n/g, "<br/>")}</p>`;
  return `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    ${safe}
    <hr style="border:none;border-top:1px solid #e5e5e5;margin:28px 0"/>
    <p style="font-size:12px;color:#888">Sent via SnapServe${agentName ? ` · ${agentName}` : ""}</p>
  </div>
</body></html>`;
}

export async function getEmailChannel(userId: string): Promise<EmailChannel | null> {
  const [row] = await db.select().from(emailChannelsTable)
    .where(eq(emailChannelsTable.userId, userId)).limit(1);
  return row ?? null;
}

export async function ensureEmailChannel(userId: string): Promise<EmailChannel> {
  const existing = await getEmailChannel(userId);
  if (existing) return existing;
  const [created] = await db.insert(emailChannelsTable).values({
    userId,
    mode: "managed",
    active: true,
  }).returning();
  return created!;
}

export function serializeEmailChannel(ch: EmailChannel) {
  return {
    id: ch.id,
    mode: ch.mode,
    fromName: ch.mode === "managed" ? MANAGED_FROM.name : (ch.fromName || null),
    fromEmail: ch.mode === "managed" ? MANAGED_FROM.email : (ch.fromEmail || null),
    hasBrevoKey: !!ch.brevoApiKeyEncrypted,
    brevoApiKeyLast4: ch.brevoApiKeyLast4,
    defaultTemplate: ch.defaultTemplate,
    active: ch.active,
    lastError: ch.lastError,
    lastSentAt: ch.lastSentAt,
    updatedAt: ch.updatedAt,
  };
}

export async function upsertEmailChannel(opts: {
  userId: string;
  mode?: EmailChannelMode;
  brevoApiKey?: string | null;
  fromName?: string | null;
  fromEmail?: string | null;
  defaultTemplate?: EmailContentTemplate | null;
  active?: boolean;
}): Promise<EmailChannel> {
  const current = await ensureEmailChannel(opts.userId);
  const updates: Record<string, unknown> = { lastError: null };

  if (opts.mode !== undefined) updates["mode"] = opts.mode;
  if (opts.fromName !== undefined) updates["fromName"] = opts.fromName;
  if (opts.fromEmail !== undefined) updates["fromEmail"] = opts.fromEmail;
  if (opts.defaultTemplate !== undefined && opts.defaultTemplate !== null) {
    updates["defaultTemplate"] = opts.defaultTemplate;
  }
  if (opts.active !== undefined) updates["active"] = opts.active;

  if (opts.brevoApiKey !== undefined) {
    if (opts.brevoApiKey === null || opts.brevoApiKey === "") {
      updates["brevoApiKeyEncrypted"] = null;
      updates["brevoApiKeyLast4"] = null;
    } else {
      const trimmed = opts.brevoApiKey.trim();
      updates["brevoApiKeyEncrypted"] = encryptKey(trimmed);
      updates["brevoApiKeyLast4"] = trimmed.slice(-4);
    }
  }

  const mode = (opts.mode ?? current.mode) as EmailChannelMode;
  if (mode === "brevo_byo") {
    const key = (updates["brevoApiKeyEncrypted"] as string | null | undefined) ?? current.brevoApiKeyEncrypted;
    const fromEmail = (updates["fromEmail"] as string | null | undefined) ?? current.fromEmail;
    if (!key) throw new Error("Brevo API key is required for BYO mode");
    if (!fromEmail) throw new Error("From email is required for BYO Brevo");
  }

  const [row] = await db.update(emailChannelsTable).set(updates)
    .where(eq(emailChannelsTable.id, current.id)).returning();
  return row!;
}

async function sendViaBrevo(opts: {
  apiKey: string;
  fromName: string;
  fromEmail: string;
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": opts.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: { name: opts.fromName, email: opts.fromEmail },
      to: [{ email: opts.to }],
      subject: opts.subject,
      htmlContent: opts.html,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Brevo email error ${resp.status}: ${text}`);
  }
}

export interface SendChannelEmailOpts {
  userId: string;
  toEmail: string;
  context: TemplateContext;
  /** Override subject/body; falls back to channel defaultTemplate. */
  template?: Partial<EmailContentTemplate> | null;
  callId?: number | null;
  journeyRunHint?: string | null;
}

export interface SendChannelEmailResult {
  ok: boolean;
  skipped?: "inactive" | "no_email" | "missing_config";
  error?: string;
  messageId?: number;
}

export async function sendChannelEmail(opts: SendChannelEmailOpts): Promise<SendChannelEmailResult> {
  const to = (opts.toEmail || "").trim();
  if (!to || !to.includes("@")) {
    return { ok: false, skipped: "no_email", error: "No valid recipient email" };
  }

  const channel = await getEmailChannel(opts.userId);
  if (!channel || !channel.active) {
    return { ok: false, skipped: "inactive", error: "Email channel not configured or inactive" };
  }

  const tpl: EmailContentTemplate = {
    subject: opts.template?.subject ?? channel.defaultTemplate?.subject ?? "Follow-up",
    body: opts.template?.body ?? channel.defaultTemplate?.body ?? "<p>Hi {{name}}</p>",
    wrapManagedShell: opts.template?.wrapManagedShell ?? channel.defaultTemplate?.wrapManagedShell ?? true,
  };

  const subject = interpolateTemplate(tpl.subject, opts.context);
  let html = interpolateTemplate(tpl.body, opts.context);
  if (!html.includes("<")) {
    html = `<p>${html.replace(/\n/g, "<br/>")}</p>`;
  }
  if (channel.mode === "managed" && tpl.wrapManagedShell !== false) {
    html = wrapManagedShell(html, String(opts.context["agent_name"] ?? ""));
  }

  const [msg] = await db.insert(emailMessagesTable).values({
    userId: opts.userId,
    channelId: channel.id,
    toEmail: to,
    subject,
    bodyPreview: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 280),
    status: "pending",
    mode: channel.mode,
    callId: opts.callId ?? null,
    journeyRunHint: opts.journeyRunHint ?? null,
  }).returning();

  try {
    if (channel.mode === "managed") {
      const apiKey = process.env["BREVO_API_KEY"];
      if (!apiKey) throw new Error("SnapServe managed email is not configured (BREVO_API_KEY)");
      await sendViaBrevo({
        apiKey,
        fromName: MANAGED_FROM.name,
        fromEmail: MANAGED_FROM.email,
        to,
        subject,
        html,
      });
    } else {
      if (!channel.brevoApiKeyEncrypted || !channel.fromEmail) {
        throw new Error("BYO Brevo is missing API key or from email");
      }
      const apiKey = decryptKey(channel.brevoApiKeyEncrypted);
      await sendViaBrevo({
        apiKey,
        fromName: channel.fromName || channel.fromEmail,
        fromEmail: channel.fromEmail,
        to,
        subject,
        html,
      });
    }

    await db.update(emailMessagesTable).set({ status: "sent" }).where(eq(emailMessagesTable.id, msg!.id));
    await db.update(emailChannelsTable).set({
      lastSentAt: new Date(),
      lastError: null,
    }).where(eq(emailChannelsTable.id, channel.id));

    logger.info({ userId: opts.userId, to, mode: channel.mode }, "email-channel: sent");
    return { ok: true, messageId: msg!.id };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await db.update(emailMessagesTable).set({ status: "failed", error }).where(eq(emailMessagesTable.id, msg!.id));
    await db.update(emailChannelsTable).set({ lastError: error }).where(eq(emailChannelsTable.id, channel.id));
    logger.warn({ userId: opts.userId, to, error }, "email-channel: send failed");
    return { ok: false, error, messageId: msg!.id };
  }
}
