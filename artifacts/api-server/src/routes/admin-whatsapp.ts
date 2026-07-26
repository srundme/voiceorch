/**
 * Admin: shared SnapServe WhatsApp channel configuration (platform_settings)
 * + a direct test send that bypasses user enrollment.
 */

import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, platformSettingsTable, whatsappChannelsTable, whatsappMessagesTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { logger } from "../lib/logger.js";
import {
  VOBIZ_API_BASE,
  vobizApiHeaders,
  getMasterVobizCreds,
  getSharedChannelConfig,
  getTemplateCatalog,
  KEY_WA_SHARED_CHANNEL_ID,
  KEY_WA_SHARED_WABA_ID,
  KEY_WA_TEMPLATES,
  toPlusE164,
  sanitizeParam,
} from "../services/whatsapp/vobiz.js";

const router: IRouter = Router();

async function upsertSetting(key: string, value: string): Promise<void> {
  await db.insert(platformSettingsTable)
    .values({ key, value })
    .onConflictDoUpdate({ target: platformSettingsTable.key, set: { value } });
}

router.get("/admin/whatsapp-shared", requireAdmin, async (_req, res): Promise<void> => {
  const [shared, templates] = await Promise.all([getSharedChannelConfig(), getTemplateCatalog()]);
  const [counts] = await db.select({
    shared: sql<number>`count(*) filter (where mode = 'shared' and active)::int`,
    own: sql<number>`count(*) filter (where mode = 'own' and active)::int`,
  }).from(whatsappChannelsTable);
  const [msgs] = await db.select({
    last24h: sql<number>`count(*) filter (where created_at > now() - interval '24 hours')::int`,
    failed24h: sql<number>`count(*) filter (where created_at > now() - interval '24 hours' and status = 'failed')::int`,
  }).from(whatsappMessagesTable);
  res.json({
    channelId: shared?.channelId ?? null,
    wabaId: shared?.wabaId ?? null,
    templates,
    masterCredsConfigured: !!getMasterVobizCreds(),
    webhookSecretConfigured: !!process.env["VOBIZ_WA_WEBHOOK_SECRET"],
    enrollments: counts ?? { shared: 0, own: 0 },
    messages: msgs ?? { last24h: 0, failed24h: 0 },
  });
});

router.put("/admin/whatsapp-shared", requireAdmin, async (req, res): Promise<void> => {
  const body = req.body as { channelId?: string; wabaId?: string; templates?: unknown };
  if (typeof body.channelId === "string") await upsertSetting(KEY_WA_SHARED_CHANNEL_ID, body.channelId.trim());
  if (typeof body.wabaId === "string") await upsertSetting(KEY_WA_SHARED_WABA_ID, body.wabaId.trim());
  if (body.templates !== undefined) {
    try {
      const json = typeof body.templates === "string" ? body.templates : JSON.stringify(body.templates);
      JSON.parse(json); // validate
      await upsertSetting(KEY_WA_TEMPLATES, json);
    } catch {
      res.status(400).json({ error: "templates must be valid JSON" });
      return;
    }
  }
  logger.info("admin: shared WhatsApp channel config updated");
  res.json({ ok: true });
});

/** Direct shared-channel test send (no user enrollment; no message log). */
router.post("/admin/whatsapp-shared/test", requireAdmin, async (req, res): Promise<void> => {
  const phone = String((req.body as any)?.phone ?? "").trim();
  if (!phone) {
    res.status(400).json({ error: "phone is required" });
    return;
  }
  const shared = await getSharedChannelConfig();
  const creds = getMasterVobizCreds();
  if (!shared || !creds) {
    res.status(503).json({ error: "Shared channel or master VoBiz creds not configured" });
    return;
  }
  const catalog = await getTemplateCatalog();
  const tpl = catalog.call_summary;
  try {
    const resp = await fetch(`${VOBIZ_API_BASE}/messaging/messages`, {
      method: "POST",
      headers: vobizApiHeaders(creds.authId, creds.authToken),
      body: JSON.stringify({
        channel_id: shared.channelId,
        waba_id: shared.wabaId,
        to: toPlusE164(phone),
        type: "template",
        template: {
          name: tpl.name,
          language: { code: tpl.lang },
          components: [{
            type: "body",
            parameters: [
              { type: "text", text: "SnapServe Admin" },
              { type: "text", text: sanitizeParam("Shared channel test — configuration is working.") },
            ],
          }],
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await resp.text().catch(() => "");
    if (!resp.ok) {
      res.status(502).json({ error: `VoBiz HTTP ${resp.status}`, detail: text.slice(0, 400) });
      return;
    }
    res.json({ ok: true, response: text.slice(0, 400) });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
