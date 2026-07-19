/**
 * Automatic Calls from Google Sheets API.
 */

import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { requireAuth } from "../middlewares/requireAuth.js";
import { logger } from "../lib/logger.js";
import {
  listPipelines,
  getPipeline,
  listPipelineActivity,
  createPipeline,
  startPipeline,
  pausePipeline,
  resumePipeline,
  stopPipeline,
  previewDialRows,
  retrySheetRow,
} from "../services/sheet-auto-calls.js";

const router: IRouter = Router();

const ColumnMapSchema = z.object({
  phone: z.string().min(1),
  name: z.string().optional(),
  email: z.string().optional(),
}).passthrough();

const CreateBody = z.object({
  name: z.string().min(1).max(200),
  connectionId: z.string().uuid(),
  agentId: z.number().int().positive(),
  spreadsheetId: z.string().min(1),
  spreadsheetTitle: z.string().optional(),
  sheetName: z.string().min(1),
  sheetGid: z.number().int().nullable().optional(),
  columnMap: ColumnMapSchema,
  startMode: z.enum(["new_only", "backfill_then_watch"]),
  writebackMode: z.enum(["same_sheet", "call_log", "both"]),
  fromNumber: z.string().nullable().optional(),
  concurrentCallLimit: z.number().int().min(1).max(20).optional(),
  createCallLogSheet: z.boolean().optional(),
  callLogSpreadsheetId: z.string().nullable().optional(),
  callLogSheetName: z.string().nullable().optional(),
});

function paramId(req: { params: Record<string, string | string[] | undefined> }, key = "id"): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0]! : String(v ?? "");
}

router.get("/automatic-calls", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as any).clerkUserId as string;
    const rows = await listPipelines(userId);
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "automatic-calls: list failed");
    res.status(500).json({ error: "Failed to list pipelines" });
  }
});

router.post("/automatic-calls", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as any).clerkUserId as string;
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
      return;
    }
    const row = await createPipeline(userId, {
      ...parsed.data,
      columnMap: parsed.data.columnMap as { phone: string; name?: string; email?: string },
    });
    res.status(201).json(row);
  } catch (err: any) {
    const msg = err?.message ?? "Failed to create pipeline";
    logger.warn({ err }, "automatic-calls: create failed");
    if (/sheet_auto_call_pipelines|does not exist|Failed query: insert/i.test(msg)) {
      res.status(503).json({
        error: "Database table missing. Run migration 0061_sheet_auto_calls.sql on Postgres, then retry.",
      });
      return;
    }
    res.status(400).json({ error: msg });
  }
});

router.get("/automatic-calls/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as any).clerkUserId as string;
    const id = paramId(req);
    const row = await getPipeline(userId, id);
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err) {
    logger.error({ err }, "automatic-calls: get failed");
    res.status(500).json({ error: "Failed to load pipeline" });
  }
});

router.get("/automatic-calls/:id/activity", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as any).clerkUserId as string;
    const id = paramId(req);
    const data = await listPipelineActivity(userId, id);
    if (!data) { res.status(404).json({ error: "Not found" }); return; }
    res.json(data);
  } catch (err) {
    logger.error({ err }, "automatic-calls: activity failed");
    res.status(500).json({ error: "Failed to load activity" });
  }
});

router.post("/automatic-calls/:id/start", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as any).clerkUserId as string;
    const id = paramId(req);
    const row = await startPipeline(userId, id);
    res.json(row);
  } catch (err: any) {
    logger.warn({ err }, "automatic-calls: start failed");
    res.status(400).json({ error: err?.message ?? "Failed to start" });
  }
});

router.post("/automatic-calls/:id/pause", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as any).clerkUserId as string;
    const row = await pausePipeline(userId, paramId(req));
    res.json(row);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Failed to pause" });
  }
});

router.post("/automatic-calls/:id/resume", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as any).clerkUserId as string;
    const row = await resumePipeline(userId, paramId(req));
    res.json(row);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Failed to resume" });
  }
});

router.post("/automatic-calls/:id/stop", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as any).clerkUserId as string;
    const row = await stopPipeline(userId, paramId(req));
    res.json(row);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Failed to stop" });
  }
});

const PreviewBody = z.object({
  connectionId: z.string().uuid(),
  spreadsheetId: z.string().min(1),
  sheetName: z.string().min(1),
  columnMap: ColumnMapSchema.optional(),
  limit: z.number().int().min(1).max(10).optional(),
});

router.post("/automatic-calls/preview", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as any).clerkUserId as string;
    const parsed = PreviewBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
      return;
    }
    const data = await previewDialRows(userId, {
      ...parsed.data,
      columnMap: parsed.data.columnMap as { phone: string; name?: string; email?: string } | undefined,
    });
    res.json(data);
  } catch (err: any) {
    logger.warn({ err }, "automatic-calls: preview failed");
    res.status(400).json({ error: err?.message ?? "Preview failed" });
  }
});

router.post("/automatic-calls/:id/retry-row", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as any).clerkUserId as string;
    const sheetRowIndex = Number((req.body as { sheetRowIndex?: number })?.sheetRowIndex);
    if (!Number.isFinite(sheetRowIndex) || sheetRowIndex < 2) {
      res.status(400).json({ error: "sheetRowIndex (>= 2) is required" });
      return;
    }
    const result = await retrySheetRow(userId, paramId(req), sheetRowIndex);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Retry failed" });
  }
});

export default router;
