/**
 * User email messaging channel — managed SnapServe Brevo OR BYO Brevo.
 * Supports multiple From identities and multiple designed templates.
 */

import { and, desc, eq } from "drizzle-orm";
import {
  db,
  emailChannelsTable,
  emailFromIdentitiesTable,
  emailMessagesTable,
  emailTemplatesTable,
  type EmailChannel,
  type EmailChannelMode,
  type EmailContentTemplate,
  type EmailDesignDoc,
  type EmailFromIdentity,
  type EmailTemplateRow,
} from "@workspace/db";
import { encryptKey, decryptKey } from "../lib/crypto.js";
import { logger } from "../lib/logger.js";
import { interpolateTemplate, type TemplateContext } from "./template-vars.js";
import { compileEmailDesign, defaultEmailDesign } from "./email-design.js";

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

async function seedDefaultsForChannel(ch: EmailChannel): Promise<EmailChannel> {
  let next = ch;

  const identities = await db.select().from(emailFromIdentitiesTable)
    .where(eq(emailFromIdentitiesTable.userId, ch.userId)).limit(1);
  if (identities.length === 0 && ch.fromEmail) {
    const [idRow] = await db.insert(emailFromIdentitiesTable).values({
      userId: ch.userId,
      fromName: ch.fromName || ch.fromEmail.split("@")[0] || "Sender",
      fromEmail: ch.fromEmail,
      isDefault: true,
    }).returning();
    if (idRow) {
      const [updated] = await db.update(emailChannelsTable).set({
        defaultFromIdentityId: idRow.id,
      }).where(eq(emailChannelsTable.id, ch.id)).returning();
      if (updated) next = updated;
    }
  }

  const templates = await db.select().from(emailTemplatesTable)
    .where(eq(emailTemplatesTable.userId, ch.userId)).limit(1);
  if (templates.length === 0) {
    const design = defaultEmailDesign();
    const bodyHtml = ch.defaultTemplate?.body?.includes("<")
      ? (ch.defaultTemplate.body.includes("<!DOCTYPE") || ch.defaultTemplate.body.includes("<html")
        ? ch.defaultTemplate.body
        : compileEmailDesign({
          ...design,
          blocks: [
            { id: "text-legacy", type: "text", html: ch.defaultTemplate.body },
            {
              id: "footer-legacy",
              type: "footer",
              html: "<p style=\"margin:0\">— {{agent_name}}</p>",
            },
          ],
        }))
      : compileEmailDesign(design);
    const [tpl] = await db.insert(emailTemplatesTable).values({
      userId: ch.userId,
      name: "Default follow-up",
      subject: ch.defaultTemplate?.subject
        || "Thanks {{name}} — following up from our call",
      bodyHtml,
      designJson: ch.defaultTemplate?.body?.includes("<html") ? null : design,
      isDefault: true,
    }).returning();
    if (tpl) {
      const [updated] = await db.update(emailChannelsTable).set({
        defaultTemplateId: tpl.id,
        defaultTemplate: {
          subject: tpl.subject,
          body: tpl.bodyHtml,
          wrapManagedShell: ch.defaultTemplate?.wrapManagedShell ?? false,
        },
      }).where(eq(emailChannelsTable.id, ch.id)).returning();
      if (updated) next = updated;
    }
  }

  return next;
}

export async function ensureEmailChannel(userId: string): Promise<EmailChannel> {
  const existing = await getEmailChannel(userId);
  if (existing) return seedDefaultsForChannel(existing);
  const [created] = await db.insert(emailChannelsTable).values({
    userId,
    mode: "managed",
    active: true,
  }).returning();
  return seedDefaultsForChannel(created!);
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
    defaultTemplateId: ch.defaultTemplateId,
    defaultFromIdentityId: ch.defaultFromIdentityId,
    active: ch.active,
    lastError: ch.lastError,
    lastSentAt: ch.lastSentAt,
    updatedAt: ch.updatedAt,
  };
}

export function serializeFromIdentity(row: EmailFromIdentity) {
  return {
    id: row.id,
    fromName: row.fromName,
    fromEmail: row.fromEmail,
    isDefault: row.isDefault,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function serializeEmailTemplate(row: EmailTemplateRow) {
  return {
    id: row.id,
    name: row.name,
    subject: row.subject,
    bodyHtml: row.bodyHtml,
    designJson: row.designJson,
    fromIdentityId: row.fromIdentityId,
    isDefault: row.isDefault,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function upsertEmailChannel(opts: {
  userId: string;
  mode?: EmailChannelMode;
  brevoApiKey?: string | null;
  fromName?: string | null;
  fromEmail?: string | null;
  defaultTemplate?: EmailContentTemplate | null;
  defaultTemplateId?: number | null;
  defaultFromIdentityId?: number | null;
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
  if (opts.defaultTemplateId !== undefined) updates["defaultTemplateId"] = opts.defaultTemplateId;
  if (opts.defaultFromIdentityId !== undefined) {
    updates["defaultFromIdentityId"] = opts.defaultFromIdentityId;
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

  // Keep primary from identity in sync when channel from fields change.
  if (opts.fromEmail || opts.fromName) {
    const fromEmail = (opts.fromEmail ?? row!.fromEmail ?? "").trim();
    const fromName = (opts.fromName ?? row!.fromName ?? fromEmail.split("@")[0] ?? "Sender").trim();
    if (fromEmail.includes("@")) {
      if (row!.defaultFromIdentityId) {
        await db.update(emailFromIdentitiesTable).set({
          fromName,
          fromEmail,
          isDefault: true,
        }).where(and(
          eq(emailFromIdentitiesTable.id, row!.defaultFromIdentityId),
          eq(emailFromIdentitiesTable.userId, opts.userId),
        ));
      } else {
        const existing = await db.select().from(emailFromIdentitiesTable)
          .where(eq(emailFromIdentitiesTable.userId, opts.userId)).limit(1);
        if (existing[0]) {
          await db.update(emailFromIdentitiesTable).set({
            fromName,
            fromEmail,
            isDefault: true,
          }).where(eq(emailFromIdentitiesTable.id, existing[0].id));
          await db.update(emailChannelsTable).set({
            defaultFromIdentityId: existing[0].id,
          }).where(eq(emailChannelsTable.id, row!.id));
        } else {
          const [created] = await db.insert(emailFromIdentitiesTable).values({
            userId: opts.userId,
            fromName,
            fromEmail,
            isDefault: true,
          }).returning();
          await db.update(emailChannelsTable).set({
            defaultFromIdentityId: created!.id,
          }).where(eq(emailChannelsTable.id, row!.id));
        }
      }
    }
  }

  return (await getEmailChannel(opts.userId))!;
}

export async function listFromIdentities(userId: string): Promise<EmailFromIdentity[]> {
  await ensureEmailChannel(userId);
  return db.select().from(emailFromIdentitiesTable)
    .where(eq(emailFromIdentitiesTable.userId, userId))
    .orderBy(desc(emailFromIdentitiesTable.isDefault), desc(emailFromIdentitiesTable.id));
}

export async function upsertFromIdentity(opts: {
  userId: string;
  id?: number;
  fromName: string;
  fromEmail: string;
  isDefault?: boolean;
}): Promise<EmailFromIdentity> {
  await ensureEmailChannel(opts.userId);
  const fromName = opts.fromName.trim();
  const fromEmail = opts.fromEmail.trim().toLowerCase();
  if (!fromName) throw new Error("fromName is required");
  if (!fromEmail.includes("@")) throw new Error("Valid fromEmail is required");

  if (opts.isDefault) {
    await db.update(emailFromIdentitiesTable).set({ isDefault: false })
      .where(eq(emailFromIdentitiesTable.userId, opts.userId));
  }

  if (opts.id) {
    const [row] = await db.update(emailFromIdentitiesTable).set({
      fromName,
      fromEmail,
      ...(opts.isDefault !== undefined ? { isDefault: opts.isDefault } : {}),
    }).where(and(
      eq(emailFromIdentitiesTable.id, opts.id),
      eq(emailFromIdentitiesTable.userId, opts.userId),
    )).returning();
    if (!row) throw new Error("From identity not found");
    if (row.isDefault) {
      await db.update(emailChannelsTable).set({
        fromName: row.fromName,
        fromEmail: row.fromEmail,
        defaultFromIdentityId: row.id,
      }).where(eq(emailChannelsTable.userId, opts.userId));
    }
    return row;
  }

  const [row] = await db.insert(emailFromIdentitiesTable).values({
    userId: opts.userId,
    fromName,
    fromEmail,
    isDefault: !!opts.isDefault,
  }).returning();

  if (row!.isDefault) {
    await db.update(emailChannelsTable).set({
      fromName: row!.fromName,
      fromEmail: row!.fromEmail,
      defaultFromIdentityId: row!.id,
    }).where(eq(emailChannelsTable.userId, opts.userId));
  }
  return row!;
}

export async function deleteFromIdentity(userId: string, id: number): Promise<void> {
  const rows = await listFromIdentities(userId);
  if (rows.length <= 1) throw new Error("Keep at least one From identity");
  const target = rows.find((r) => r.id === id);
  if (!target) throw new Error("From identity not found");
  await db.delete(emailFromIdentitiesTable).where(and(
    eq(emailFromIdentitiesTable.id, id),
    eq(emailFromIdentitiesTable.userId, userId),
  ));
  if (target.isDefault) {
    const [next] = await db.select().from(emailFromIdentitiesTable)
      .where(eq(emailFromIdentitiesTable.userId, userId)).limit(1);
    if (next) {
      await db.update(emailFromIdentitiesTable).set({ isDefault: true })
        .where(eq(emailFromIdentitiesTable.id, next.id));
      await db.update(emailChannelsTable).set({
        fromName: next.fromName,
        fromEmail: next.fromEmail,
        defaultFromIdentityId: next.id,
      }).where(eq(emailChannelsTable.userId, userId));
    }
  }
}

export async function listEmailTemplates(userId: string): Promise<EmailTemplateRow[]> {
  await ensureEmailChannel(userId);
  return db.select().from(emailTemplatesTable)
    .where(eq(emailTemplatesTable.userId, userId))
    .orderBy(desc(emailTemplatesTable.isDefault), desc(emailTemplatesTable.updatedAt));
}

export async function getEmailTemplate(
  userId: string,
  id: number,
): Promise<EmailTemplateRow | null> {
  const [row] = await db.select().from(emailTemplatesTable).where(and(
    eq(emailTemplatesTable.id, id),
    eq(emailTemplatesTable.userId, userId),
  )).limit(1);
  return row ?? null;
}

export async function upsertEmailTemplate(opts: {
  userId: string;
  id?: number;
  name: string;
  subject: string;
  bodyHtml?: string | null;
  designJson?: EmailDesignDoc | null;
  fromIdentityId?: number | null;
  isDefault?: boolean;
}): Promise<EmailTemplateRow> {
  await ensureEmailChannel(opts.userId);
  const name = opts.name.trim();
  const subject = opts.subject.trim();
  if (!name) throw new Error("Template name is required");
  if (!subject) throw new Error("Subject is required");

  let bodyHtml = (opts.bodyHtml ?? "").trim();
  let designJson = opts.designJson === undefined ? undefined : opts.designJson;
  // Prefer explicit HTML (designer always syncs HTML when blocks change).
  // Only compile when body is empty and a design doc was provided.
  if (!bodyHtml && designJson && Array.isArray(designJson.blocks)) {
    bodyHtml = compileEmailDesign(designJson);
  }
  if (!bodyHtml) throw new Error("Template body is required");

  if (opts.fromIdentityId != null) {
    const [idok] = await db.select({ id: emailFromIdentitiesTable.id })
      .from(emailFromIdentitiesTable)
      .where(and(
        eq(emailFromIdentitiesTable.id, opts.fromIdentityId),
        eq(emailFromIdentitiesTable.userId, opts.userId),
      )).limit(1);
    if (!idok) throw new Error("fromIdentityId not found");
  }

  if (opts.isDefault) {
    await db.update(emailTemplatesTable).set({ isDefault: false })
      .where(eq(emailTemplatesTable.userId, opts.userId));
  }

  if (opts.id) {
    const patch: Record<string, unknown> = {
      name,
      subject,
      bodyHtml,
    };
    if (designJson !== undefined) patch["designJson"] = designJson;
    if (opts.fromIdentityId !== undefined) patch["fromIdentityId"] = opts.fromIdentityId;
    if (opts.isDefault !== undefined) patch["isDefault"] = opts.isDefault;

    const [row] = await db.update(emailTemplatesTable).set(patch).where(and(
      eq(emailTemplatesTable.id, opts.id),
      eq(emailTemplatesTable.userId, opts.userId),
    )).returning();
    if (!row) throw new Error("Template not found");
    if (row.isDefault) {
      await db.update(emailChannelsTable).set({
        defaultTemplateId: row.id,
        defaultTemplate: { subject: row.subject, body: row.bodyHtml, wrapManagedShell: false },
      }).where(eq(emailChannelsTable.userId, opts.userId));
    }
    return row;
  }

  const [row] = await db.insert(emailTemplatesTable).values({
    userId: opts.userId,
    name,
    subject,
    bodyHtml,
    designJson: designJson ?? null,
    fromIdentityId: opts.fromIdentityId ?? null,
    isDefault: !!opts.isDefault,
  }).returning();

  if (row!.isDefault) {
    await db.update(emailChannelsTable).set({
      defaultTemplateId: row!.id,
      defaultTemplate: { subject: row!.subject, body: row!.bodyHtml, wrapManagedShell: false },
    }).where(eq(emailChannelsTable.userId, opts.userId));
  }
  return row!;
}

export async function deleteEmailTemplate(userId: string, id: number): Promise<void> {
  const rows = await listEmailTemplates(userId);
  if (rows.length <= 1) throw new Error("Keep at least one email template");
  const target = rows.find((r) => r.id === id);
  if (!target) throw new Error("Template not found");
  await db.delete(emailTemplatesTable).where(and(
    eq(emailTemplatesTable.id, id),
    eq(emailTemplatesTable.userId, userId),
  ));
  if (target.isDefault) {
    const [next] = await db.select().from(emailTemplatesTable)
      .where(eq(emailTemplatesTable.userId, userId)).limit(1);
    if (next) {
      await db.update(emailTemplatesTable).set({ isDefault: true })
        .where(eq(emailTemplatesTable.id, next.id));
      await db.update(emailChannelsTable).set({
        defaultTemplateId: next.id,
        defaultTemplate: { subject: next.subject, body: next.bodyHtml, wrapManagedShell: false },
      }).where(eq(emailChannelsTable.userId, userId));
    }
  }
}

async function resolveFrom(
  channel: EmailChannel,
  opts: { fromIdentityId?: number | null; template?: EmailTemplateRow | null },
): Promise<{ fromName: string; fromEmail: string }> {
  if (channel.mode === "managed") return MANAGED_FROM;

  const identityId =
    opts.fromIdentityId
    ?? opts.template?.fromIdentityId
    ?? channel.defaultFromIdentityId
    ?? null;

  if (identityId) {
    const [row] = await db.select().from(emailFromIdentitiesTable).where(and(
      eq(emailFromIdentitiesTable.id, identityId),
      eq(emailFromIdentitiesTable.userId, channel.userId),
    )).limit(1);
    if (row) return { fromName: row.fromName, fromEmail: row.fromEmail };
  }

  if (channel.fromEmail) {
    return {
      fromName: channel.fromName || channel.fromEmail,
      fromEmail: channel.fromEmail,
    };
  }
  throw new Error("BYO Brevo is missing from email — add a From identity");
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
  /** Override subject/body; falls back to selected / default template. */
  template?: Partial<EmailContentTemplate> | null;
  /** Named template from email_templates. */
  templateId?: number | null;
  /** From identity override. */
  fromIdentityId?: number | null;
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

  let stored: EmailTemplateRow | null = null;
  if (opts.templateId) {
    stored = await getEmailTemplate(opts.userId, opts.templateId);
  } else if (channel.defaultTemplateId && !opts.template?.subject && !opts.template?.body) {
    stored = await getEmailTemplate(opts.userId, channel.defaultTemplateId);
  }

  const tpl: EmailContentTemplate = {
    subject: opts.template?.subject
      ?? stored?.subject
      ?? channel.defaultTemplate?.subject
      ?? "Follow-up",
    body: opts.template?.body
      ?? stored?.bodyHtml
      ?? channel.defaultTemplate?.body
      ?? "<p>Hi {{name}}</p>",
    wrapManagedShell: opts.template?.wrapManagedShell
      ?? channel.defaultTemplate?.wrapManagedShell
      ?? true,
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
    const from = await resolveFrom(channel, {
      fromIdentityId: opts.fromIdentityId,
      template: stored,
    });

    if (channel.mode === "managed") {
      const apiKey = process.env["BREVO_API_KEY"];
      if (!apiKey) throw new Error("SnapServe managed email is not configured (BREVO_API_KEY)");
      await sendViaBrevo({
        apiKey,
        fromName: from.fromName,
        fromEmail: from.fromEmail,
        to,
        subject,
        html,
      });
    } else {
      if (!channel.brevoApiKeyEncrypted) {
        throw new Error("BYO Brevo is missing API key");
      }
      const apiKey = decryptKey(channel.brevoApiKeyEncrypted);
      await sendViaBrevo({
        apiKey,
        fromName: from.fromName,
        fromEmail: from.fromEmail,
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

    logger.info({ userId: opts.userId, to, mode: channel.mode, templateId: stored?.id }, "email-channel: sent");
    return { ok: true, messageId: msg!.id };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await db.update(emailMessagesTable).set({ status: "failed", error }).where(eq(emailMessagesTable.id, msg!.id));
    await db.update(emailChannelsTable).set({ lastError: error }).where(eq(emailChannelsTable.id, channel.id));
    logger.warn({ userId: opts.userId, to, error }, "email-channel: send failed");
    return { ok: false, error, messageId: msg!.id };
  }
}
