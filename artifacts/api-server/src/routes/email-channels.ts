/**
 * Email messaging channel — managed SnapServe OR BYO Brevo.
 * Multi From identities + multi templates (visual designer).
 */

import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import {
  db,
  emailMessagesTable,
  type EmailChannelMode,
  type EmailContentTemplate,
  type EmailDesignDoc,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { clientContext } from "../middlewares/clientContext.js";
import {
  deleteEmailTemplate,
  deleteFromIdentity,
  ensureEmailChannel,
  getEmailChannel,
  getEmailTemplate,
  listEmailTemplates,
  listFromIdentities,
  serializeEmailChannel,
  serializeEmailTemplate,
  serializeFromIdentity,
  sendChannelEmail,
  upsertEmailChannel,
  upsertEmailTemplate,
  upsertFromIdentity,
} from "../services/email-channel.js";
import { compileEmailDesign, defaultEmailDesign } from "../services/email-design.js";
import { listTemplateVariables } from "../services/template-vars.js";

const router: IRouter = Router();

router.get("/email/channel", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const ch = await ensureEmailChannel(clerkId);
  const [identities, templates] = await Promise.all([
    listFromIdentities(clerkId),
    listEmailTemplates(clerkId),
  ]);
  res.json({
    channel: serializeEmailChannel(ch),
    identities: identities.map(serializeFromIdentity),
    templates: templates.map(serializeEmailTemplate),
    variables: listTemplateVariables(),
    defaultDesign: defaultEmailDesign(),
  });
});

router.put("/email/channel", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const body = req.body as {
    mode?: EmailChannelMode;
    brevoApiKey?: string | null;
    fromName?: string | null;
    fromEmail?: string | null;
    defaultTemplate?: EmailContentTemplate | null;
    defaultTemplateId?: number | null;
    defaultFromIdentityId?: number | null;
    active?: boolean;
  };

  try {
    if (body.mode && !["managed", "brevo_byo"].includes(body.mode)) {
      res.status(400).json({ error: "mode must be managed or brevo_byo" });
      return;
    }
    if (body.defaultTemplate) {
      if (typeof body.defaultTemplate.subject !== "string" || typeof body.defaultTemplate.body !== "string") {
        res.status(400).json({ error: "defaultTemplate.subject and body are required strings" });
        return;
      }
    }
    const ch = await upsertEmailChannel({
      userId: clerkId,
      mode: body.mode,
      brevoApiKey: body.brevoApiKey,
      fromName: body.fromName,
      fromEmail: body.fromEmail,
      defaultTemplate: body.defaultTemplate,
      defaultTemplateId: body.defaultTemplateId,
      defaultFromIdentityId: body.defaultFromIdentityId,
      active: body.active,
    });
    const [identities, templates] = await Promise.all([
      listFromIdentities(clerkId),
      listEmailTemplates(clerkId),
    ]);
    res.json({
      channel: serializeEmailChannel(ch),
      identities: identities.map(serializeFromIdentity),
      templates: templates.map(serializeEmailTemplate),
      variables: listTemplateVariables(),
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/email/identities", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const rows = await listFromIdentities(clerkId);
  res.json({ identities: rows.map(serializeFromIdentity) });
});

router.post("/email/identities", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const body = req.body as { fromName?: string; fromEmail?: string; isDefault?: boolean };
  try {
    const row = await upsertFromIdentity({
      userId: clerkId,
      fromName: body.fromName || "",
      fromEmail: body.fromEmail || "",
      isDefault: body.isDefault,
    });
    res.json({ identity: serializeFromIdentity(row) });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.put("/email/identities/:id", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const body = req.body as { fromName?: string; fromEmail?: string; isDefault?: boolean };
  try {
    const row = await upsertFromIdentity({
      userId: clerkId,
      id,
      fromName: body.fromName || "",
      fromEmail: body.fromEmail || "",
      isDefault: body.isDefault,
    });
    res.json({ identity: serializeFromIdentity(row) });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.delete("/email/identities/:id", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = Number(req.params["id"]);
  try {
    await deleteFromIdentity(clerkId, id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/email/templates", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const rows = await listEmailTemplates(clerkId);
  res.json({
    templates: rows.map(serializeEmailTemplate),
    variables: listTemplateVariables(),
    defaultDesign: defaultEmailDesign(),
  });
});

router.get("/email/templates/:id", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = Number(req.params["id"]);
  const row = await getEmailTemplate(clerkId, id);
  if (!row) {
    res.status(404).json({ error: "Template not found" });
    return;
  }
  res.json({ template: serializeEmailTemplate(row), variables: listTemplateVariables() });
});

router.post("/email/templates", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const body = req.body as {
    name?: string;
    subject?: string;
    bodyHtml?: string | null;
    designJson?: EmailDesignDoc | null;
    fromIdentityId?: number | null;
    isDefault?: boolean;
  };
  try {
    const row = await upsertEmailTemplate({
      userId: clerkId,
      name: body.name || "",
      subject: body.subject || "",
      bodyHtml: body.bodyHtml,
      designJson: body.designJson,
      fromIdentityId: body.fromIdentityId,
      isDefault: body.isDefault,
    });
    res.json({ template: serializeEmailTemplate(row) });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.put("/email/templates/:id", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const body = req.body as {
    name?: string;
    subject?: string;
    bodyHtml?: string | null;
    designJson?: EmailDesignDoc | null;
    fromIdentityId?: number | null;
    isDefault?: boolean;
  };
  try {
    const row = await upsertEmailTemplate({
      userId: clerkId,
      id,
      name: body.name || "",
      subject: body.subject || "",
      bodyHtml: body.bodyHtml,
      designJson: body.designJson,
      fromIdentityId: body.fromIdentityId,
      isDefault: body.isDefault,
    });
    res.json({ template: serializeEmailTemplate(row) });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.delete("/email/templates/:id", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = Number(req.params["id"]);
  try {
    await deleteEmailTemplate(clerkId, id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/email/templates/compile", requireAuth, clientContext, async (req, res): Promise<void> => {
  const body = req.body as { designJson?: EmailDesignDoc };
  if (!body.designJson || !Array.isArray(body.designJson.blocks)) {
    res.status(400).json({ error: "designJson.blocks required" });
    return;
  }
  res.json({ html: compileEmailDesign(body.designJson) });
});

router.post("/email/channel/test", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const body = req.body as {
    toEmail?: string;
    name?: string;
    templateId?: number | null;
    fromIdentityId?: number | null;
  };
  const to = (body.toEmail ?? "").trim();
  if (!to.includes("@")) {
    res.status(400).json({ error: "toEmail required" });
    return;
  }

  const ch = await getEmailChannel(clerkId);
  if (!ch) {
    res.status(400).json({ error: "Configure email channel first" });
    return;
  }

  const result = await sendChannelEmail({
    userId: clerkId,
    toEmail: to,
    templateId: body.templateId,
    fromIdentityId: body.fromIdentityId,
    context: {
      name: body.name || "there",
      summary: "This is a SnapServe email channel test.",
      agent_name: "SnapServe",
      business_name: ch.fromName || "SnapServe",
      meet_link: "https://meet.google.com/test-link",
      phone: "+910000000000",
      email: to,
      disposition: "interested",
      call_status: "completed",
      callback_at: "",
    },
    journeyRunHint: "test",
  });

  if (!result.ok && !result.skipped) {
    res.status(502).json(result);
    return;
  }
  res.json(result);
});

router.get("/email/messages", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const rows = await db.select().from(emailMessagesTable)
    .where(eq(emailMessagesTable.userId, clerkId))
    .orderBy(desc(emailMessagesTable.createdAt))
    .limit(50);
  res.json(rows);
});

export default router;
