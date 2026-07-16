import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import { db, agentsTable, phoneNumbersTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { getAuth } from "../lib/auth-compat.js";
import { getSelfBaseUrl } from "../lib/app-domain.js";
import { logger } from "../lib/logger.js";
import {
  TaskOrchestratorError,
  createTask,
  getTaskDetail,
  listTasks,
  cancelTask,
  handleUserChatMessage,
  selectCandidateAndPrepareDial,
  runLookupStep,
  assertAgentEligibleForTasks,
  buildTaskBrief,
} from "../services/task-orchestrator.js";
import { dialOutboundForTask, TaskDialError } from "../services/task-dial.js";
import { listSkills } from "../services/task-skills/index.js";
import type { TaskGoalPrefs } from "../services/task-goal.js";

const router = Router();

function resolveWebhookBase(_req: unknown, override?: string): string {
  if (override?.trim()) return override.trim().replace(/\/+$/, "");
  try {
    return getSelfBaseUrl().replace(/\/+$/, "");
  } catch {
    return (process.env["PUBLIC_BASE_URL"] || process.env["APP_URL"] || "http://localhost:3000").replace(/\/+$/, "");
  }
}

function sendOrchError(res: import("express").Response, err: unknown): void {
  if (err instanceof TaskOrchestratorError || err instanceof TaskDialError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  logger.error({ err }, "agent-tasks error");
  res.status(500).json({ error: "Internal server error" });
}

async function dialSelectedIfNeeded(
  userId: string,
  detail: Awaited<ReturnType<typeof getTaskDetail>>,
  webhookBaseUrl: string,
): Promise<Awaited<ReturnType<typeof getTaskDetail>>> {
  if (detail.task.status !== "calling") return detail;
  const selected = detail.candidates.find((c) => c.selected);
  if (!selected?.phone) return detail;
  const alreadyDialed = detail.calls.some((c) => c.candidateId === selected.id);
  if (alreadyDialed) return detail;

  const prefs = (detail.task.prefs ?? {}) as TaskGoalPrefs;
  const taskBrief = buildTaskBrief({
    goal: detail.task.goal,
    businessName: selected.name,
    businessPhone: selected.phone,
    businessAddress: selected.address,
    timePrefs: prefs.timePrefs,
  });

  await dialOutboundForTask({
    userId,
    agentId: detail.task.agentId,
    toNumber: selected.phone,
    agentTaskId: detail.task.id,
    candidateId: selected.id,
    taskBrief,
    webhookBaseUrl,
  });
  return getTaskDetail(userId, detail.task.id);
}

/** GET /agent-tasks/skills */
router.get("/agent-tasks/skills", requireAuth, (_req, res): void => {
  res.json({ skills: listSkills() });
});

/** GET /agent-tasks/eligible-agents — outbound-capable agents for the picker */
router.get("/agent-tasks/eligible-agents", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const agents = await db
    .select({
      id: agentsTable.id,
      name: agentsTable.name,
      status: agentsTable.status,
      useCase: agentsTable.useCase,
      description: agentsTable.description,
      telephonyProvider: agentsTable.telephonyProvider,
      outboundPhoneNumberId: agentsTable.outboundPhoneNumberId,
      language: agentsTable.language,
    })
    .from(agentsTable)
    .where(eq(agentsTable.userId, userId))
    .orderBy(desc(agentsTable.id))
    .limit(100);

  const withNumbers = await Promise.all(
    agents.map(async (a) => {
      let outboundNumber: string | null = null;
      if (a.outboundPhoneNumberId) {
        const [pn] = await db
          .select({ number: phoneNumbersTable.number })
          .from(phoneNumbersTable)
          .where(eq(phoneNumbersTable.id, a.outboundPhoneNumberId))
          .limit(1);
        outboundNumber = pn?.number ?? null;
      }
      return {
        ...a,
        outboundNumber,
        eligible: !!a.telephonyProvider,
      };
    }),
  );

  res.json({ agents: withNumbers.filter((a) => a.eligible) });
});

/** GET /agent-tasks */
router.get("/agent-tasks", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const tasks = await listTasks(userId);
    res.json({ tasks });
  } catch (err) {
    sendOrchError(res, err);
  }
});

/** POST /agent-tasks */
router.post("/agent-tasks", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const agentId = Number(req.body?.agentId);
  const goal = String(req.body?.goal ?? "").trim();
  const dialPolicy = req.body?.dialPolicy === "auto" ? "auto" : "approval";
  const prefs = typeof req.body?.prefs === "object" && req.body.prefs ? req.body.prefs : undefined;

  if (!Number.isFinite(agentId) || agentId <= 0) {
    res.status(400).json({ error: "agentId is required" });
    return;
  }
  if (!goal) {
    res.status(400).json({ error: "goal is required" });
    return;
  }

  try {
    await assertAgentEligibleForTasks(userId, agentId);
    let detail = await createTask({ userId, agentId, goal, dialPolicy, prefs });
    const baseUrl = resolveWebhookBase(req, typeof req.body?.webhookBaseUrl === "string" ? req.body.webhookBaseUrl : undefined);
    detail = await dialSelectedIfNeeded(userId, detail, baseUrl);
    res.status(201).json(detail);
  } catch (err) {
    sendOrchError(res, err);
  }
});

/** GET /agent-tasks/:id */
router.get("/agent-tasks/:id", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    res.json(await getTaskDetail(userId, id));
  } catch (err) {
    sendOrchError(res, err);
  }
});

/** POST /agent-tasks/:id/messages */
router.post("/agent-tasks/:id/messages", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params["id"]);
  const content = String(req.body?.content ?? "").trim();
  if (!Number.isFinite(id) || !content) {
    res.status(400).json({ error: "content is required" });
    return;
  }

  try {
    let detail = await handleUserChatMessage(userId, id, content);
    detail = await dialSelectedIfNeeded(userId, detail, resolveWebhookBase(req));
    res.json(detail);
  } catch (err) {
    sendOrchError(res, err);
  }
});

/** POST /agent-tasks/:id/approve */
router.post("/agent-tasks/:id/approve", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params["id"]);
  const candidateId = Number(req.body?.candidateId);
  if (!Number.isFinite(id) || !Number.isFinite(candidateId)) {
    res.status(400).json({ error: "candidateId is required" });
    return;
  }

  try {
    await selectCandidateAndPrepareDial(userId, id, candidateId);
    let detail = await getTaskDetail(userId, id);
    detail = await dialSelectedIfNeeded(
      userId,
      detail,
      resolveWebhookBase(req, typeof req.body?.webhookBaseUrl === "string" ? req.body.webhookBaseUrl : undefined),
    );
    res.json(detail);
  } catch (err) {
    sendOrchError(res, err);
  }
});

/** POST /agent-tasks/:id/lookup — re-run discovery */
router.post("/agent-tasks/:id/lookup", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    res.json(await runLookupStep(userId, id));
  } catch (err) {
    sendOrchError(res, err);
  }
});

/** POST /agent-tasks/:id/cancel */
router.post("/agent-tasks/:id/cancel", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    res.json(await cancelTask(userId, id));
  } catch (err) {
    sendOrchError(res, err);
  }
});

export default router;
