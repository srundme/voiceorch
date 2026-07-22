/**
 * Public, unauthenticated intake for workflow triggers.
 *
 * POST /api/workflows/hook/:token  — website / Instagram form leads. The posted
 * JSON body is flattened, mapped via the trigger's fieldMap, and starts a
 * workflow run. Mounted BEFORE provisionUser (no Clerk session).
 */

import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, workflowsTable, type Workflow } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { startWorkflowRun } from "../services/workflow-engine.js";

const router: IRouter = Router();

function publicCors(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Hub-Signature-256, X-Signature-256, X-Signature");
  next();
}

function flattenObject(obj: unknown, prefix = ""): Record<string, string> {
  if (typeof obj !== "object" || obj === null) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      Object.assign(out, flattenObject(v, key));
    } else if (Array.isArray(v)) {
      out[key] = v.map(String).join(",");
    } else {
      out[key] = String(v ?? "");
    }
  }
  return out;
}

router.options("/workflows/hook/:token", publicCors, (_req, res) => { res.sendStatus(204); });

// Meta / Facebook webhook subscription verification (hub.challenge echo).
router.get("/workflows/hook/:token", publicCors, (req, res): void => {
  const challenge = req.query["hub.challenge"];
  if (challenge) { res.status(200).send(String(challenge)); return; }
  res.status(200).json({ ok: true });
});

router.post("/workflows/hook/:token", publicCors, async (req, res): Promise<void> => {
  const token = String(req.params["token"] ?? "");
  const [workflow] = await db.select().from(workflowsTable)
    .where(eq(workflowsTable.publicToken, token)).limit(1);

  if (!workflow) { res.status(404).json({ error: "Unknown workflow token" }); return; }
  if (workflow.status !== "active") {
    // Accept but ignore so form providers don't retry/alert while paused.
    res.status(202).json({ ok: true, ignored: "workflow not active" });
    return;
  }

  const trigger = (workflow as Workflow).trigger;
  const flat = flattenObject(req.body ?? {});
  const context: Record<string, unknown> = { ...flat };

  // Map posted fields onto canonical context keys.
  if (trigger?.fieldMap) {
    for (const [posted, key] of Object.entries(trigger.fieldMap)) {
      if (flat[posted] !== undefined) context[key] = flat[posted];
    }
  }
  const phoneKey = (trigger as any)?.phoneColumn ?? trigger?.fieldMap?.["phone"] ?? "phone";
  if (!context["phone"] && flat[phoneKey]) context["phone"] = flat[phoneKey];

  if (!context["phone"]) {
    res.status(400).json({ error: "No phone number found in payload" });
    return;
  }

  try {
    const runId = await startWorkflowRun({
      workflow: workflow as Workflow,
      context,
      triggeredBy: trigger?.type === "instagram_lead" ? "instagram_lead" : "form_lead",
    });
    logger.info({ workflowId: workflow.id, runId }, "workflow: form lead accepted");
    res.status(200).json({ ok: true, runId });
  } catch (err) {
    logger.error({ err, workflowId: workflow.id }, "workflow: failed to start run from hook");
    res.status(500).json({ error: "Failed to start workflow" });
  }
});

export default router;
