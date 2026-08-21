/**
 * Admin V2 Phase 7 — Product controls: integrations overview + product hub stats.
 */
import { Router } from "express";
import {
  db,
  crmConnectionsTable,
  googleSheetsConnectionsTable,
  whatsappConnectionsTable,
  emailChannelsTable,
  platformListedVoicesTable,
  ambientSoundsTable,
  promptTemplatesTable,
} from "@workspace/db";
import { count, eq, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { logger } from "../lib/logger.js";

const router = Router();
router.use("/admin/product", requireAdmin);

const FULL_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

router.get("/admin/product/integrations", async (_req, res): Promise<void> => {
  try {
    const [gcal, crm, sheets, whatsapp, email] = await Promise.all([
      db.execute(sql`
        select
          count(*)::int as total,
          count(*) filter (
            where granted_scopes is not null
              and position(${FULL_CALENDAR_SCOPE} in granted_scopes) > 0
          )::int as healthy,
          count(*) filter (
            where granted_scopes is null
               or position(${FULL_CALENDAR_SCOPE} in granted_scopes) = 0
          )::int as failed,
          max(updated_at) as last_sync,
          count(distinct user_id)::int as users
        from google_calendar_connections
      `),
      db
        .select({
          total: count(),
          failed: sql<number>`count(*) filter (where ${crmConnectionsTable.lastError} is not null)`,
          lastSync: sql<string>`max(${crmConnectionsTable.lastSyncAt})`,
          lastError: sql<string>`max(${crmConnectionsTable.lastError})`,
          users: sql<number>`count(distinct ${crmConnectionsTable.userId})`,
          hubspot: sql<number>`count(*) filter (where ${crmConnectionsTable.provider} = 'hubspot')`,
          zoho: sql<number>`count(*) filter (where ${crmConnectionsTable.provider} = 'zoho')`,
        })
        .from(crmConnectionsTable),
      db
        .select({
          total: count(),
          users: sql<number>`count(distinct ${googleSheetsConnectionsTable.userId})`,
          lastSync: sql<string>`max(${googleSheetsConnectionsTable.updatedAt})`,
        })
        .from(googleSheetsConnectionsTable),
      db
        .select({
          total: count(),
          users: sql<number>`count(distinct ${whatsappConnectionsTable.userId})`,
          lastSync: sql<string>`max(${whatsappConnectionsTable.updatedAt})`,
        })
        .from(whatsappConnectionsTable),
      db
        .select({
          total: count(),
          users: sql<number>`count(distinct ${emailChannelsTable.userId})`,
          managed: sql<number>`count(*) filter (where ${emailChannelsTable.mode} = 'managed')`,
          byo: sql<number>`count(*) filter (where ${emailChannelsTable.mode} = 'brevo_byo')`,
          lastSync: sql<string>`max(${emailChannelsTable.updatedAt})`,
        })
        .from(emailChannelsTable),
    ]);

    const g = (gcal.rows[0] ?? {}) as Record<string, unknown>;
    const c = crm[0];
    const s = sheets[0];
    const w = whatsapp[0];
    const e = email[0];

    const services = [
      {
        id: "google_calendar",
        label: "Google Calendar",
        href: "/product/integrations/gcal",
        connected: Number(g.total ?? 0),
        failed: Number(g.failed ?? 0),
        healthy: Number(g.healthy ?? 0),
        usersAffected: Number(g.users ?? 0),
        lastSync: g.last_sync ? String(g.last_sync) : null,
        lastError: null as string | null,
        detail: `${Number(g.healthy ?? 0)} with full calendar scope`,
      },
      {
        id: "crm",
        label: "CRM (HubSpot / Zoho)",
        href: "/product/integrations",
        connected: Number(c?.total ?? 0),
        failed: Number(c?.failed ?? 0),
        healthy: Math.max(0, Number(c?.total ?? 0) - Number(c?.failed ?? 0)),
        usersAffected: Number(c?.users ?? 0),
        lastSync: c?.lastSync ? String(c.lastSync) : null,
        lastError: c?.lastError ? String(c.lastError).slice(0, 200) : null,
        detail: `HubSpot ${Number(c?.hubspot ?? 0)} · Zoho ${Number(c?.zoho ?? 0)}`,
      },
      {
        id: "sheets",
        label: "Google Sheets",
        href: "/product/integrations",
        connected: Number(s?.total ?? 0),
        failed: 0,
        healthy: Number(s?.total ?? 0),
        usersAffected: Number(s?.users ?? 0),
        lastSync: s?.lastSync ? String(s.lastSync) : null,
        lastError: null,
        detail: `${Number(s?.total ?? 0)} OAuth connections`,
      },
      {
        id: "whatsapp",
        label: "WhatsApp",
        href: "/product/integrations",
        connected: Number(w?.total ?? 0),
        failed: 0,
        healthy: Number(w?.total ?? 0),
        usersAffected: Number(w?.users ?? 0),
        lastSync: w?.lastSync ? String(w.lastSync) : null,
        lastError: null,
        detail: `${Number(w?.total ?? 0)} webhook connections`,
      },
      {
        id: "email",
        label: "Email channels",
        href: "/operations/emails",
        connected: Number(e?.total ?? 0),
        failed: 0,
        healthy: Number(e?.total ?? 0),
        usersAffected: Number(e?.users ?? 0),
        lastSync: e?.lastSync ? String(e.lastSync) : null,
        lastError: null,
        detail: `Managed ${Number(e?.managed ?? 0)} · BYO ${Number(e?.byo ?? 0)}`,
      },
    ];

    res.json({
      generatedAt: new Date().toISOString(),
      services,
      totals: {
        connected: services.reduce((n, s) => n + s.connected, 0),
        failed: services.reduce((n, s) => n + s.failed, 0),
        users: services.reduce((n, s) => n + s.usersAffected, 0),
      },
    });
  } catch (err) {
    logger.error({ err }, "product/integrations failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/product/overview", async (_req, res): Promise<void> => {
  try {
    const [voices, ambient, prompts, activePrompt] = await Promise.all([
      db.select({ c: count() }).from(platformListedVoicesTable),
      db.select({ c: count() }).from(ambientSoundsTable),
      db.select({ c: count() }).from(promptTemplatesTable),
      db
        .select({ c: count() })
        .from(promptTemplatesTable)
        .where(eq(promptTemplatesTable.isActive, true)),
    ]);

    res.json({
      generatedAt: new Date().toISOString(),
      voicesListed: Number(voices[0]?.c ?? 0),
      ambientSounds: Number(ambient[0]?.c ?? 0),
      promptTemplates: Number(prompts[0]?.c ?? 0),
      activePromptTemplates: Number(activePrompt[0]?.c ?? 0),
    });
  } catch (err) {
    logger.error({ err }, "product/overview failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
