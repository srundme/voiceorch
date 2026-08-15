/**
 * CRUD + render + email for campaign analytics report definitions.
 */
import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  campaignsTable,
  campaignReportDefinitionsTable,
  type ReportBlock,
  type ReportEmailConfig,
  type ReportFilters,
} from "@workspace/db";
import { getAuth } from "../lib/auth-compat.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { clientContext } from "../middlewares/clientContext.js";
import { REPORT_PRESETS } from "../services/campaign-report-presets.js";
import { renderCampaignReport } from "../services/campaign-report-render.js";
import { sendCampaignReportEmail } from "../services/campaign-report-email.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();
router.use(requireAuth, clientContext);

async function requireCampaign(campaignId: number, userId: string) {
  const [c] = await db
    .select({ id: campaignsTable.id, userId: campaignsTable.userId, name: campaignsTable.name })
    .from(campaignsTable)
    .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, userId)))
    .limit(1);
  return c ?? null;
}

function normalizeBlocks(raw: unknown): ReportBlock[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set([
    "kpis", "dispositions", "deep_sentiment", "purchase_funnel", "objections",
    "agent_performance", "custom_questions", "hot_leads", "nl_insight", "narrative",
  ]);
  const out: ReportBlock[] = [];
  for (const item of raw.slice(0, 20)) {
    if (!item || typeof item !== "object") continue;
    const t = String((item as { type?: string }).type ?? "");
    if (!allowed.has(t)) continue;
    const block = item as ReportBlock;
    out.push({
      type: block.type,
      metrics: Array.isArray(block.metrics) ? block.metrics.map(String).slice(0, 12) : undefined,
      questionIds: Array.isArray(block.questionIds) ? block.questionIds.map(String).slice(0, 20) : undefined,
      filter: block.filter && typeof block.filter === "object"
        ? {
            minPurchaseScore:
              typeof block.filter.minPurchaseScore === "number"
                ? Math.max(0, Math.min(100, block.filter.minPurchaseScore))
                : undefined,
            intents: Array.isArray(block.filter.intents)
              ? block.filter.intents.map(String).slice(0, 12)
              : undefined,
          }
        : undefined,
      prompt:
        typeof block.prompt === "string" && block.prompt.trim()
          ? block.prompt.trim().slice(0, 500)
          : undefined,
    });
  }
  return out;
}

function normalizeEmail(raw: unknown): ReportEmailConfig {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<ReportEmailConfig>;
  const trigger = o.trigger === "batch_complete" || o.trigger === "schedule" ? o.trigger : "manual";
  const recipients = Array.isArray(o.recipients)
    ? o.recipients.map(String).map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@")).slice(0, 20)
    : [];
  return {
    enabled: !!o.enabled,
    recipients,
    trigger,
    cron: typeof o.cron === "string" ? o.cron.slice(0, 64) : null,
  };
}

function normalizeFilters(raw: unknown): ReportFilters {
  const o = (raw && typeof raw === "object" ? raw : {}) as ReportFilters;
  return {
    dispositions: Array.isArray(o.dispositions) ? o.dispositions.map(String).slice(0, 30) : undefined,
    dateFrom: typeof o.dateFrom === "string" ? o.dateFrom : null,
    dateTo: typeof o.dateTo === "string" ? o.dateTo : null,
  };
}

router.get("/campaigns/:id/report-presets", async (_req, res): Promise<void> => {
  res.json({ presets: REPORT_PRESETS });
});

router.get("/campaigns/:id/reports", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const campaignId = parseInt(req.params["id"]!, 10);
  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const rows = await db
    .select()
    .from(campaignReportDefinitionsTable)
    .where(eq(campaignReportDefinitionsTable.campaignId, campaignId))
    .orderBy(desc(campaignReportDefinitionsTable.updatedAt));
  res.json({ reports: rows });
});

router.post("/campaigns/:id/reports", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const campaignId = parseInt(req.params["id"]!, 10);
  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const body = req.body ?? {};
  const presetId = typeof body.presetId === "string" ? body.presetId : null;
  const preset = presetId ? REPORT_PRESETS.find((p) => p.id === presetId) : null;

  const name = String(body.name ?? preset?.name ?? "Untitled report").trim().slice(0, 120) || "Untitled report";
  const scope = body.scope === "batch" || preset?.scope === "batch" ? "batch" : "campaign";
  const blocks = normalizeBlocks(body.blocks ?? preset?.blocks ?? []);
  if (!blocks.length) {
    res.status(400).json({ error: "Add at least one report block" });
    return;
  }
  const email = normalizeEmail(body.email);
  const filters = normalizeFilters(body.filters);
  const isDefault = !!body.isDefault;

  if (isDefault) {
    await db
      .update(campaignReportDefinitionsTable)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(eq(campaignReportDefinitionsTable.campaignId, campaignId));
  }

  const [row] = await db
    .insert(campaignReportDefinitionsTable)
    .values({ userId, campaignId, name, scope, blocks, filters, email, isDefault })
    .returning();
  res.status(201).json(row);
});

router.patch("/campaigns/:id/reports/:reportId", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const campaignId = parseInt(req.params["id"]!, 10);
  const reportId = parseInt(req.params["reportId"]!, 10);
  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const [existing] = await db
    .select()
    .from(campaignReportDefinitionsTable)
    .where(and(
      eq(campaignReportDefinitionsTable.id, reportId),
      eq(campaignReportDefinitionsTable.campaignId, campaignId),
    ))
    .limit(1);
  if (!existing) { res.status(404).json({ error: "Report not found" }); return; }

  const body = req.body ?? {};
  const patch: Partial<typeof campaignReportDefinitionsTable.$inferInsert> = { updatedAt: new Date() };
  if (typeof body.name === "string") patch.name = body.name.trim().slice(0, 120) || existing.name;
  if (body.scope === "batch" || body.scope === "campaign") patch.scope = body.scope;
  if (body.blocks !== undefined) {
    const blocks = normalizeBlocks(body.blocks);
    if (!blocks.length) { res.status(400).json({ error: "Add at least one report block" }); return; }
    patch.blocks = blocks;
  }
  if (body.email !== undefined) patch.email = normalizeEmail(body.email);
  if (body.filters !== undefined) patch.filters = normalizeFilters(body.filters);
  if (typeof body.isDefault === "boolean") {
    patch.isDefault = body.isDefault;
    if (body.isDefault) {
      await db
        .update(campaignReportDefinitionsTable)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(campaignReportDefinitionsTable.campaignId, campaignId));
    }
  }

  const [row] = await db
    .update(campaignReportDefinitionsTable)
    .set(patch)
    .where(eq(campaignReportDefinitionsTable.id, reportId))
    .returning();
  res.json(row);
});

router.delete("/campaigns/:id/reports/:reportId", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const campaignId = parseInt(req.params["id"]!, 10);
  const reportId = parseInt(req.params["reportId"]!, 10);
  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  await db
    .delete(campaignReportDefinitionsTable)
    .where(and(
      eq(campaignReportDefinitionsTable.id, reportId),
      eq(campaignReportDefinitionsTable.campaignId, campaignId),
    ));
  res.json({ ok: true });
});

router.post("/campaigns/:id/reports/:reportId/render", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const campaignId = parseInt(req.params["id"]!, 10);
  const reportId = parseInt(req.params["reportId"]!, 10);
  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const [definition] = await db
    .select()
    .from(campaignReportDefinitionsTable)
    .where(and(
      eq(campaignReportDefinitionsTable.id, reportId),
      eq(campaignReportDefinitionsTable.campaignId, campaignId),
    ))
    .limit(1);
  if (!definition) { res.status(404).json({ error: "Report not found" }); return; }

  const batchIdRaw = req.body?.batchId ?? req.query["batchId"];
  const batchId = batchIdRaw != null && batchIdRaw !== "" ? parseInt(String(batchIdRaw), 10) : null;
  const days = Math.min(Math.max(parseInt(String(req.body?.days ?? req.query["days"] ?? "30"), 10) || 30, 1), 90);

  try {
    const rendered = await renderCampaignReport({
      definition,
      batchId: Number.isFinite(batchId as number) ? batchId : null,
      days,
    });
    res.json(rendered);
  } catch (err) {
    logger.warn({ err, campaignId, reportId }, "campaign-report render failed");
    res.status(500).json({ error: "Failed to render report" });
  }
});

router.post("/campaigns/:id/reports/:reportId/send", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const campaignId = parseInt(req.params["id"]!, 10);
  const reportId = parseInt(req.params["reportId"]!, 10);
  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const [definition] = await db
    .select()
    .from(campaignReportDefinitionsTable)
    .where(and(
      eq(campaignReportDefinitionsTable.id, reportId),
      eq(campaignReportDefinitionsTable.campaignId, campaignId),
    ))
    .limit(1);
  if (!definition) { res.status(404).json({ error: "Report not found" }); return; }

  const recipients = Array.isArray(req.body?.recipients)
    ? (req.body.recipients as string[])
    : definition.email?.recipients ?? [];
  const cleaned = recipients.map(String).map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@"));
  if (!cleaned.length) {
    res.status(400).json({ error: "Add at least one recipient email" });
    return;
  }

  const batchIdRaw = req.body?.batchId;
  const batchId = batchIdRaw != null && batchIdRaw !== "" ? parseInt(String(batchIdRaw), 10) : null;

  try {
    const rendered = await renderCampaignReport({
      definition,
      batchId: Number.isFinite(batchId as number) ? batchId : null,
      days: 30,
    });
    await sendCampaignReportEmail({
      to: cleaned,
      subject: `${rendered.name} — ${rendered.campaignName}`,
      html: rendered.html,
      campaignId,
      reportId,
      userId,
    });
    res.json({ ok: true, sent: cleaned.length, reportId, generatedAt: rendered.generatedAt });
  } catch (err) {
    logger.warn({ err, campaignId, reportId }, "campaign-report send failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to send report" });
  }
});

export default router;
