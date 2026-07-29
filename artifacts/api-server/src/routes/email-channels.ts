/**
 * Email messaging channel — managed SnapServe OR BYO Brevo.
 * SMS is not exposed here.
 */

import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import {
  db,
  emailMessagesTable,
  type EmailChannelMode,
  type EmailContentTemplate,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import {
  ensureEmailChannel,
  getEmailChannel,
  serializeEmailChannel,
  sendChannelEmail,
  upsertEmailChannel,
} from "../services/email-channel.js";
import { listTemplateVariables } from "../services/template-vars.js";

const router: IRouter = Router();

router.get("/email/channel", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const ch = await ensureEmailChannel(clerkId);
  res.json({
    channel: serializeEmailChannel(ch),
    variables: listTemplateVariables(),
  });
});

router.put("/email/channel", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const body = req.body as {
    mode?: EmailChannelMode;
    brevoApiKey?: string | null;
    fromName?: string | null;
    fromEmail?: string | null;
    defaultTemplate?: EmailContentTemplate | null;
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
      active: body.active,
    });
    res.json({ channel: serializeEmailChannel(ch), variables: listTemplateVariables() });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/email/channel/test", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const body = req.body as { toEmail?: string; name?: string };
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
    context: {
      name: body.name || "there",
      summary: "This is a SnapServe email channel test.",
      agent_name: "SnapServe",
      business_name: ch.fromName || "SnapServe",
    },
    journeyRunHint: "test",
  });

  if (!result.ok && !result.skipped) {
    res.status(502).json(result);
    return;
  }
  res.json(result);
});

router.get("/email/messages", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const rows = await db.select().from(emailMessagesTable)
    .where(eq(emailMessagesTable.userId, clerkId))
    .orderBy(desc(emailMessagesTable.createdAt))
    .limit(50);
  res.json(rows);
});

export default router;
