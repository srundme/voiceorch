/**
 * Agent-first Journeys — product layer above workflows.
 *
 * Journeys own the business flow (presets, settings, agent binding). Execution
 * is delegated to a linked workflow so dialing/resume/delay reuse the existing
 * engine, including Phase-2 steps: schedule_callback + send_whatsapp.
 */

import { Router, type IRouter } from "express";
import { randomBytes } from "node:crypto";
import { and, count, desc, eq, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm";
import {
  db,
  journeysTable,
  workflowsTable,
  workflowRunsTable,
  agentsTable,
  scheduledCallbacksTable,
  campaignsTable,
  campaignLeadsTable,
  type Journey,
  type JourneyPresetId,
  type JourneySettings,
  type JourneyStep,
  type WorkflowTrigger,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { logger } from "../lib/logger.js";
import { startWorkflowRun } from "../services/workflow-engine.js";
import { getSarvamManagedKey, platformChatText } from "../services/platform-chat-llm.js";
import {
  buildJourneyPreset,
  listJourneyPresets,
} from "../services/journey-presets.js";
import { draftCallPlanFromPrompt } from "../services/call-plan-vibe.js";
import { isGraphFlow, toGraphFlow, validateFlow } from "../services/workflow-graph.js";
import { normalizePhone } from "../lib/phone-normalize.js";

const router: IRouter = Router();

function serializeJourney(j: Journey, extras?: { hookUrl?: string | null }) {
  const flow = toGraphFlow(j.trigger, j.steps ?? []);
  return {
    id: j.id,
    agentId: j.agentId,
    name: j.name,
    description: j.description,
    status: j.status,
    presetId: j.presetId,
    trigger: j.trigger,
    steps: j.steps,
    settings: j.settings ?? {},
    /** Canvas view: graph pointers (legacy linear journeys converted on the fly). */
    flow: { trigger: flow.trigger, steps: flow.steps },
    validation: validateFlow(j.trigger, j.steps ?? []),
    workflowId: j.workflowId,
    publicToken: j.publicToken,
    hookUrl: extras?.hookUrl ?? (j.publicToken ? `/api/workflows/hook/${j.publicToken}` : null),
    totalRuns: j.totalRuns,
    lastRunAt: j.lastRunAt,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
  };
}

function newPublicToken(): string {
  return `jrn_${randomBytes(18).toString("hex")}`;
}

function needsPublicToken(trigger: WorkflowTrigger | undefined): boolean {
  return trigger?.type === "form_lead" || trigger?.type === "instagram_lead";
}

/** Strip UI-only labels before persisting to the workflow engine. */
function toWorkflowSteps(steps: JourneyStep[]) {
  return (steps ?? []).map(({ label: _label, ...rest }) => rest);
}

async function syncBackingWorkflow(journey: Journey): Promise<number> {
  const steps = toWorkflowSteps(journey.steps ?? []);
  const trigger = journey.trigger;
  const token = journey.publicToken
    ?? (needsPublicToken(trigger) ? newPublicToken() : null);

  if (journey.workflowId) {
    const [existing] = await db.select().from(workflowsTable)
      .where(and(eq(workflowsTable.id, journey.workflowId), eq(workflowsTable.userId, journey.userId)))
      .limit(1);
    if (existing) {
      await db.update(workflowsTable).set({
        name: `__journey_${journey.id}_${journey.name}`.slice(0, 120),
        description: journey.description ?? `Journey #${journey.id}`,
        status: journey.status === "active" ? "active" : journey.status === "paused" ? "paused" : "draft",
        trigger,
        steps,
        publicToken: token ?? existing.publicToken,
      }).where(eq(workflowsTable.id, existing.id));

      if (token && journey.publicToken !== token) {
        await db.update(journeysTable).set({ publicToken: token }).where(eq(journeysTable.id, journey.id));
      }
      return existing.id;
    }
  }

  const [wf] = await db.insert(workflowsTable).values({
    userId: journey.userId,
    name: `__journey_${journey.id}_${journey.name}`.slice(0, 120),
    description: journey.description ?? `Journey #${journey.id}`,
    status: journey.status === "active" ? "active" : journey.status === "paused" ? "paused" : "draft",
    trigger,
    steps,
    publicToken: token,
  }).returning();

  await db.update(journeysTable).set({
    workflowId: wf!.id,
    publicToken: token,
  }).where(eq(journeysTable.id, journey.id));

  return wf!.id;
}

/** Reject structurally broken flows (bad arrows, duplicate ids) on save. */
function rejectBrokenFlow(res: import("express").Response, trigger: WorkflowTrigger, steps: JourneyStep[]): boolean {
  const { errors } = validateFlow(trigger, steps);
  if (errors.length === 0) return false;
  res.status(400).json({ error: errors[0], errors });
  return true;
}

/** Block activate / start while the flow still has config issues. */
function rejectIncompleteFlow(res: import("express").Response, j: Journey): boolean {
  const { errors, issues } = validateFlow(j.trigger, j.steps ?? []);
  if (errors.length === 0 && issues.length === 0) return false;
  res.status(400).json({ error: errors[0] ?? issues[0]!.message, errors, issues });
  return true;
}

async function loadOwnedJourney(clerkId: string, id: number): Promise<Journey | null> {
  const [j] = await db.select().from(journeysTable)
    .where(and(eq(journeysTable.id, id), eq(journeysTable.userId, clerkId)))
    .limit(1);
  return j ?? null;
}

async function assertAgentOwned(clerkId: string, agentId: number): Promise<boolean> {
  const [a] = await db.select({ id: agentsTable.id }).from(agentsTable)
    .where(and(eq(agentsTable.id, agentId), eq(agentsTable.userId, clerkId)))
    .limit(1);
  return !!a;
}

// ── Preset catalog ───────────────────────────────────────────────────────────

async function getPlanVibeKey(): Promise<string | null> {
  return getSarvamManagedKey();
}

async function generatePlanVibeJson(_key: string, system: string, user: string): Promise<string> {
  return platformChatText({
    system,
    messages: [{ role: "user", content: user }],
    temperature: 0.3,
    maxTokens: 512,
    timeoutMs: 20_000,
    json: true,
  });
}

/** Draft a call plan from natural language (classify → client creates with recipes). */
router.post("/journeys/vibe-draft", requireAuth, async (req, res): Promise<void> => {
  const prompt = String((req.body as { prompt?: string })?.prompt ?? "").trim();
  if (!prompt) {
    res.status(400).json({ error: "prompt required" });
    return;
  }
  try {
    const key = await getPlanVibeKey();
    const draft = await draftCallPlanFromPrompt(prompt, key, generatePlanVibeJson);
    res.json(draft);
  } catch (err) {
    logger.warn({ err }, "journeys/vibe-draft failed; returning heuristic");
    const { classifyCallPlanPrompt } = await import("../services/call-plan-vibe.js");
    res.json(classifyCallPlanPrompt(prompt));
  }
});

router.get("/journeys/presets", requireAuth, (_req, res): void => {
  res.json(listJourneyPresets());
});

// ── List / get ───────────────────────────────────────────────────────────────

router.get("/journeys", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const agentIdRaw = req.query["agentId"];
  const agentId = agentIdRaw != null ? parseInt(String(agentIdRaw), 10) : NaN;

  const rows = Number.isFinite(agentId)
    ? await db.select().from(journeysTable)
        .where(and(eq(journeysTable.userId, clerkId), eq(journeysTable.agentId, agentId)))
        .orderBy(desc(journeysTable.updatedAt))
    : await db.select().from(journeysTable)
        .where(eq(journeysTable.userId, clerkId))
        .orderBy(desc(journeysTable.updatedAt));

  res.json(rows.map((j) => serializeJourney(j)));
});

router.get("/journeys/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const j = await loadOwnedJourney(clerkId, id);
  if (!j) { res.status(404).json({ error: "Journey not found" }); return; }
  res.json(serializeJourney(j));
});

// ── Create from preset or custom ─────────────────────────────────────────────

router.post("/journeys", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const body = req.body as {
    agentId?: number;
    presetId?: JourneyPresetId;
    name?: string;
    description?: string;
    settings?: JourneySettings;
    trigger?: WorkflowTrigger;
    steps?: JourneyStep[];
  };

  const agentId = Number(body.agentId);
  if (!Number.isFinite(agentId)) { res.status(400).json({ error: "agentId required" }); return; }
  if (!(await assertAgentOwned(clerkId, agentId))) {
    res.status(404).json({ error: "Agent not found" }); return;
  }

  const presetId = (body.presetId ?? "custom") as JourneyPresetId;
  let name = body.name?.trim();
  let description = body.description ?? null;
  let trigger: WorkflowTrigger = body.trigger ?? { type: "manual" };
  let steps: JourneyStep[] = body.steps ?? [];
  let settings: JourneySettings = body.settings ?? {};

  if (presetId !== "custom") {
    try {
      const built = buildJourneyPreset(presetId, agentId, body.settings);
      name = name || built.name;
      description = description ?? built.description;
      trigger = built.trigger;
      steps = built.steps;
      settings = built.settings;
    } catch {
      res.status(400).json({ error: `Unknown preset: ${presetId}` }); return;
    }
  }

  if (!name) { res.status(400).json({ error: "name required" }); return; }
  if (rejectBrokenFlow(res, trigger, steps)) return;

  const publicToken = needsPublicToken(trigger) ? newPublicToken() : null;

  const [j] = await db.insert(journeysTable).values({
    userId: clerkId,
    agentId,
    name,
    description,
    status: "draft",
    presetId,
    trigger,
    steps,
    settings,
    publicToken,
  }).returning();

  try {
    await syncBackingWorkflow(j!);
  } catch (err) {
    logger.warn({ err, journeyId: j!.id }, "journey: failed to sync backing workflow on create");
  }

  const [fresh] = await db.select().from(journeysTable).where(eq(journeysTable.id, j!.id)).limit(1);
  res.status(201).json(serializeJourney(fresh!));
});

// ── Patch ────────────────────────────────────────────────────────────────────

router.patch("/journeys/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const existing = await loadOwnedJourney(clerkId, id);
  if (!existing) { res.status(404).json({ error: "Journey not found" }); return; }

  const body = req.body as Partial<{
    name: string;
    description: string | null;
    agentId: number;
    trigger: WorkflowTrigger;
    steps: JourneyStep[];
    settings: JourneySettings;
    status: string;
    presetId: JourneyPresetId;
  }>;

  if (
    body.trigger !== undefined && body.steps === undefined
    && !("entryStepId" in body.trigger) && isGraphFlow(existing.trigger)
  ) {
    body.trigger = { ...body.trigger, entryStepId: existing.trigger.entryStepId ?? null };
  }

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates["name"] = body.name;
  if (body.description !== undefined) updates["description"] = body.description;
  if (body.agentId !== undefined) {
    const nextAgentId = Number(body.agentId);
    if (!Number.isFinite(nextAgentId) || !(await assertAgentOwned(clerkId, nextAgentId))) {
      res.status(400).json({ error: "Invalid agentId" }); return;
    }
    updates["agentId"] = nextAgentId;
  }
  if (body.trigger !== undefined) {
    updates["trigger"] = body.trigger;
    if (needsPublicToken(body.trigger) && !existing.publicToken) {
      updates["publicToken"] = newPublicToken();
    }
  }
  if (body.steps !== undefined) {
    if (!Array.isArray(body.steps)) { res.status(400).json({ error: "steps must be an array" }); return; }
    updates["steps"] = body.steps;
    // Hand-edited steps detach the preset so a later settings save can't rebuild over them.
    if (body.presetId === undefined && existing.presetId !== "custom") updates["presetId"] = "custom";
  }
  if (body.settings !== undefined) updates["settings"] = body.settings;
  if (body.presetId !== undefined) updates["presetId"] = body.presetId;
  if (body.steps !== undefined || body.trigger !== undefined) {
    if (rejectBrokenFlow(res, body.trigger ?? existing.trigger, body.steps ?? existing.steps ?? [])) return;
  }
  if (body.status !== undefined && ["draft", "active", "paused"].includes(body.status)) {
    updates["status"] = body.status;
  }

  // Rebuilding from settings while keeping the same preset.
  if (body.settings !== undefined && existing.presetId !== "custom" && body.steps === undefined) {
    const rebuilt = buildJourneyPreset(existing.presetId as Exclude<JourneyPresetId, "custom">, existing.agentId, {
      ...(existing.settings ?? {}),
      ...body.settings,
    });
    updates["steps"] = rebuilt.steps;
    updates["settings"] = rebuilt.settings;
    if (body.trigger === undefined) updates["trigger"] = rebuilt.trigger;
  }

  const [j] = await db.update(journeysTable).set(updates)
    .where(and(eq(journeysTable.id, id), eq(journeysTable.userId, clerkId)))
    .returning();

  try {
    await syncBackingWorkflow(j!);
  } catch (err) {
    logger.warn({ err, journeyId: id }, "journey: failed to sync backing workflow on patch");
  }

  // Push calling hours onto the hidden workflow campaign (campaign dial gate).
  try {
    const settings = (j!.settings ?? {}) as JourneySettings;
    const { syncCallingHoursForAgent } = await import("../services/workflow-dial-queue.js");
    await syncCallingHoursForAgent(clerkId, j!.agentId, {
      isCallingHoursEnabled: settings.isCallingHoursEnabled,
      businessHoursStart: settings.businessHoursStart,
      businessHoursEnd: settings.businessHoursEnd,
      timezone: settings.timezone,
    });
  } catch (err) {
    logger.warn({ err, journeyId: id }, "journey: failed to sync calling hours");
  }

  const [fresh] = await db.select().from(journeysTable).where(eq(journeysTable.id, id)).limit(1);
  res.json(serializeJourney(fresh!));
});

router.delete("/journeys/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const existing = await loadOwnedJourney(clerkId, id);
  if (!existing) { res.status(404).json({ error: "Journey not found" }); return; }

  if (existing.workflowId) {
    await db.delete(workflowsTable)
      .where(and(eq(workflowsTable.id, existing.workflowId), eq(workflowsTable.userId, clerkId)));
  }
  await db.delete(journeysTable)
    .where(and(eq(journeysTable.id, id), eq(journeysTable.userId, clerkId)));
  res.sendStatus(204);
});

// ── Activate / pause ─────────────────────────────────────────────────────────

router.post("/journeys/:id/activate", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const existing = await loadOwnedJourney(clerkId, id);
  if (!existing) { res.status(404).json({ error: "Journey not found" }); return; }
  if (rejectIncompleteFlow(res, existing)) return;

  // Resume dial queue feed when source still has remaining people.
  const settings = { ...(existing.settings ?? {}) } as JourneySettings;
  const offset = typeof settings.startOffset === "number" ? settings.startOffset : 0;
  const total = typeof settings.startSourceTotal === "number" ? settings.startSourceTotal : 0;
  if (settings.runMode !== "live" && total > 0 && offset > 0 && offset < total) {
    settings.autoFeed = true;
  }

  const [j] = await db.update(journeysTable).set({ status: "active", settings })
    .where(and(eq(journeysTable.id, id), eq(journeysTable.userId, clerkId)))
    .returning();
  await syncBackingWorkflow(j!);

  // Resume uses the same campaign-engine rolling refill as People campaigns.
  const { refillWorkflowDialSlots } = await import("../services/workflow-dial-queue.js");
  void refillWorkflowDialSlots(clerkId);

  const [fresh] = await db.select().from(journeysTable).where(eq(journeysTable.id, id)).limit(1);
  res.json(serializeJourney(fresh!));
});

router.post("/journeys/:id/pause", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const existing = await loadOwnedJourney(clerkId, id);
  if (!existing) { res.status(404).json({ error: "Journey not found" }); return; }

  const settings = { ...(existing.settings ?? {}) } as JourneySettings;
  settings.autoFeed = false;

  const [j] = await db.update(journeysTable).set({ status: "paused", settings })
    .where(and(eq(journeysTable.id, id), eq(journeysTable.userId, clerkId)))
    .returning();
  await syncBackingWorkflow(j!);

  // If no other active call plan shares this agent, pause the hidden dial campaign
  // so campaign-engine refill stops (same as pausing a People campaign).
  const [otherActive] = await db.select({ id: journeysTable.id })
    .from(journeysTable)
    .where(and(
      eq(journeysTable.userId, clerkId),
      eq(journeysTable.agentId, existing.agentId),
      eq(journeysTable.status, "active"),
    ))
    .limit(1);
  if (!otherActive) {
    const { pauseWorkflowCampaignsForAgent } = await import("../services/workflow-dial-queue.js");
    await pauseWorkflowCampaignsForAgent(clerkId, existing.agentId);
  }

  const [fresh] = await db.select().from(journeysTable).where(eq(journeysTable.id, id)).limit(1);
  res.json(serializeJourney(fresh!));
});

// ── Apply / swap preset on an existing journey ───────────────────────────────

router.post("/journeys/:id/apply-preset", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const existing = await loadOwnedJourney(clerkId, id);
  if (!existing) { res.status(404).json({ error: "Journey not found" }); return; }

  const presetId = String((req.body as any)?.presetId ?? "") as JourneyPresetId;
  if (!presetId || presetId === "custom") {
    res.status(400).json({ error: "presetId required" }); return;
  }

  const settings = {
    ...(existing.settings ?? {}),
    ...((req.body as any)?.settings ?? {}),
  } as JourneySettings;

  let built;
  try {
    built = buildJourneyPreset(presetId as Exclude<JourneyPresetId, "custom">, existing.agentId, settings);
  } catch {
    res.status(400).json({ error: `Unknown preset: ${presetId}` }); return;
  }

  const [j] = await db.update(journeysTable).set({
    name: built.name,
    description: built.description,
    presetId: built.presetId,
    trigger: built.trigger,
    steps: built.steps,
    settings: built.settings,
    status: "draft",
  }).where(and(eq(journeysTable.id, id), eq(journeysTable.userId, clerkId))).returning();

  await syncBackingWorkflow(j!);
  const [fresh] = await db.select().from(journeysTable).where(eq(journeysTable.id, id)).limit(1);
  res.json(serializeJourney(fresh!));
});

// ── Test run ─────────────────────────────────────────────────────────────────

router.post("/journeys/:id/test", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const journey = await loadOwnedJourney(clerkId, id);
  if (!journey) { res.status(404).json({ error: "Journey not found" }); return; }

  const body = (req.body ?? {}) as Record<string, unknown>;
  if (!body["phone"]) { res.status(400).json({ error: "phone required" }); return; }

  const workflowId = await syncBackingWorkflow(journey);
  const [workflow] = await db.select().from(workflowsTable)
    .where(and(eq(workflowsTable.id, workflowId), eq(workflowsTable.userId, clerkId)))
    .limit(1);
  if (!workflow) { res.status(500).json({ error: "Backing workflow missing" }); return; }

  const runId = await startWorkflowRun({
    workflow,
    context: body,
    triggeredBy: "test",
  });

  res.status(201).json({ ok: true, runId, workflowId });
});

// ── Start once (Call plans) ──────────────────────────────────────────────────
// Enqueues people into a dial queue capped by users.concurrentLimit.
// Worker auto-feeds the rest of the list (no manual Continue required).

/** Legacy preview batch size (UI may still show). */
const START_ONCE_MAX = 100;

router.post("/journeys/:id/start", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const journey = await loadOwnedJourney(clerkId, id);
  if (!journey) { res.status(404).json({ error: "Journey not found" }); return; }

  if (!Array.isArray(journey.steps) || journey.steps.length === 0) {
    res.status(400).json({ error: "Add at least one step before starting" }); return;
  }
  if (rejectIncompleteFlow(res, journey)) return;

  const body = (req.body ?? {}) as {
    campaignId?: number;
    sheetPipelineId?: string;
    phones?: string[];
    limit?: number;
    /** Skip this many people (Continue / resume). */
    offset?: number;
    runMode?: "once" | "live";
    /** Re-dial people who already have a run on this plan. */
    force?: boolean;
  };

  const settings = (journey.settings ?? {}) as JourneySettings;
  const campaignIdRaw = body.campaignId ?? settings.campaignId ?? null;
  const campaignId = campaignIdRaw != null ? Number(campaignIdRaw) : NaN;
  const sheetPipelineId = (body.sheetPipelineId ?? settings.sheetPipelineId ?? "").trim() || null;
  const runMode = body.runMode === "live" || settings.runMode === "live" ? "live" : "once";
  const offset = Math.max(0, Number(body.offset) || 0);
  const force = body.force === true;
  const manualPhones = Array.isArray(body.phones)
    ? body.phones.map((raw) => String(raw ?? "").trim()).filter(Boolean)
    : (settings.manualPhones ?? []);

  const {
    getUserConcurrentLimit,
    callPlanFeedBufferSize,
  } = await import("../services/workflow-dial-queue.js");
  const {
    feedCallPlanQueue,
    loadCallPlanPeopleSlice,
    startRunsForPeople,
  } = await import("../services/call-plan-queue-feed.js");

  const concurrentLimit = await getUserConcurrentLimit(clerkId);
  const bufferTarget = callPlanFeedBufferSize(concurrentLimit);
  const feedLimit = Math.min(
    Math.max(1, Number(body.limit) || bufferTarget),
    START_ONCE_MAX,
  );

  // Keep live: arm sheet cursor path (existing behaviour).
  if (runMode === "live" && sheetPipelineId) {
    const {
      loadOwnedSheetPipeline,
      listSheetPipelinePeople,
      startCallPlanRunsForPeople,
    } = await import("../services/call-plan-sheet-live.js");
    const pipeline = await loadOwnedSheetPipeline(clerkId, sheetPipelineId);
    if (!pipeline) { res.status(404).json({ error: "Sheet list not found" }); return; }

    let sheetCursorRow = typeof settings.sheetCursorRow === "number" ? settings.sheetCursorRow : 1;
    const listed = await listSheetPipelinePeople(pipeline, {
      fromRowExclusive: sheetCursorRow,
      limit: feedLimit,
    });
    const people = listed.people;
    if (people.length > 0) {
      sheetCursorRow = Math.max(...people.map((p) => p.sheetRowIndex), sheetCursorRow);
    } else if (listed.lastRow > sheetCursorRow) {
      sheetCursorRow = listed.lastRow;
    }

    const nextSettings: JourneySettings = {
      ...settings,
      runMode: "live",
      peopleSource: "sheet",
      sheetPipelineId,
      sheetCursorRow,
      campaignId: null,
      autoFeed: false,
      startOffset: 0,
    };
    await db.update(journeysTable).set({
      settings: nextSettings,
      status: "active",
    }).where(and(eq(journeysTable.id, id), eq(journeysTable.userId, clerkId)));

    const [freshJourney] = await db.select().from(journeysTable).where(eq(journeysTable.id, id)).limit(1);
    const workflowId = await syncBackingWorkflow(freshJourney!);
    const runIds = people.length > 0
      ? await startCallPlanRunsForPeople({
          journey: freshJourney!,
          workflowId,
          people,
          triggeredBy: "call_plan_live",
          sheetPipelineId,
        })
      : [];

    res.status(201).json({
      ok: true,
      started: runIds.length,
      skipped: 0,
      runIds,
      workflowId,
      journeyId: id,
      runMode: "live",
      keepLive: true,
      autoFeed: false,
      concurrentLimit,
      bufferTarget,
      batchMax: START_ONCE_MAX,
      offset: 0,
      nextOffset: 0,
      hasMore: false,
      sourceTotal: Math.max(0, listed.lastRow - 1),
      scanned: people.length,
    });
    return;
  }

  // Bind people source + enable auto-feed for once mode.
  const hasCampaign = Number.isFinite(campaignId) && campaignId > 0 && !sheetPipelineId;
  const hasManual = manualPhones.length > 0 && !sheetPipelineId && !hasCampaign;
  if (!hasCampaign && !sheetPipelineId && !hasManual) {
    res.status(400).json({
      error: "Pick a people list (CSV or Sheet) or pass phones to start",
    });
    return;
  }

  if (hasCampaign) {
    const [campaign] = await db.select({ id: campaignsTable.id })
      .from(campaignsTable)
      .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, clerkId)))
      .limit(1);
    if (!campaign) { res.status(404).json({ error: "People list (campaign) not found" }); return; }
  }
  if (sheetPipelineId) {
    const { loadOwnedSheetPipeline } = await import("../services/call-plan-sheet-live.js");
    const pipeline = await loadOwnedSheetPipeline(clerkId, sheetPipelineId);
    if (!pipeline) { res.status(404).json({ error: "Sheet list not found" }); return; }
  }

  const boundSettings: JourneySettings = {
    ...settings,
    runMode: "once",
    autoFeed: true,
    startOffset: offset,
    ...(hasCampaign
      ? { peopleSource: "campaign" as const, campaignId, sheetPipelineId: null, manualPhones: undefined }
      : {}),
    ...(sheetPipelineId
      ? {
          peopleSource: "sheet" as const,
          sheetPipelineId,
          campaignId: null,
          manualPhones: undefined,
        }
      : {}),
    ...(hasManual
      ? { peopleSource: "manual" as const, manualPhones, campaignId: null, sheetPipelineId: null }
      : {}),
  };

  // Probe that the source has someone to dial (respecting offset).
  const probe = await loadCallPlanPeopleSlice({
    userId: clerkId,
    settings: boundSettings,
    offset,
    limit: 1,
    phonesOverride: hasManual ? manualPhones : undefined,
  });
  if (probe.people.length === 0 && probe.sourceTotal === 0) {
    res.status(400).json({ error: "No people to start — add leads, connect a sheet, or paste phone numbers" });
    return;
  }

  await db.update(journeysTable).set({
    settings: {
      ...boundSettings,
      startSourceTotal: probe.sourceTotal,
      ...(sheetPipelineId ? { sheetCursorRow: probe.sheetCursorRow } : {}),
    },
    status: "active",
  }).where(and(eq(journeysTable.id, id), eq(journeysTable.userId, clerkId)));

  const [freshJourney] = await db.select().from(journeysTable).where(eq(journeysTable.id, id)).limit(1);
  const workflowId = await syncBackingWorkflow(freshJourney!);
  const [workflow] = await db.select().from(workflowsTable)
    .where(and(eq(workflowsTable.id, workflowId), eq(workflowsTable.userId, clerkId)))
    .limit(1);
  if (!workflow) { res.status(500).json({ error: "Backing workflow missing" }); return; }

  // Arm campaign dial gate with this plan's calling hours (same as People campaigns).
  {
    const s = (freshJourney!.settings ?? {}) as JourneySettings;
    const { syncCallingHoursForAgent } = await import("../services/workflow-dial-queue.js");
    await syncCallingHoursForAgent(clerkId, freshJourney!.agentId, {
      isCallingHoursEnabled: s.isCallingHoursEnabled,
      businessHoursStart: s.businessHoursStart,
      businessHoursEnd: s.businessHoursEnd,
      timezone: s.timezone,
    });
  }

  // First slice into the pipeline; auto-feed continues the rest.
  const slice = await loadCallPlanPeopleSlice({
    userId: clerkId,
    settings: (freshJourney!.settings ?? {}) as JourneySettings,
    offset,
    limit: feedLimit,
    phonesOverride: hasManual ? manualPhones : undefined,
  });

  const { runIds, skippedDup } = await startRunsForPeople({
    journey: freshJourney!,
    workflowId,
    people: slice.people,
    triggeredBy: "call_plan_start",
    force,
  });

  if (runIds.length === 0 && skippedDup > 0 && slice.people.length > 0) {
    // Entire first slice already walked — try feeding further via auto-feed helper.
  } else if (runIds.length === 0 && slice.people.length === 0) {
    res.status(400).json({
      error: "No people to start — add leads, connect a sheet, or paste phone numbers",
      skipped: skippedDup,
    });
    return;
  }

  const nextOffset = offset + slice.scanned;
  const hasMore = nextOffset < slice.sourceTotal;
  await db.update(journeysTable).set({
    settings: {
      ...((freshJourney!.settings ?? {}) as JourneySettings),
      startOffset: hasMore ? nextOffset : 0,
      startSourceTotal: slice.sourceTotal,
      autoFeed: hasMore,
      ...(sheetPipelineId ? { sheetCursorRow: slice.sheetCursorRow } : {}),
    } as JourneySettings,
    updatedAt: new Date(),
  }).where(and(eq(journeysTable.id, id), eq(journeysTable.userId, clerkId)));

  // Top up immediately if first slice was all dups or buffer still hungry.
  const [afterStart] = await db.select().from(journeysTable).where(eq(journeysTable.id, id)).limit(1);
  let fed = { started: 0, skipped: 0, nextOffset, hasMore, sourceTotal: slice.sourceTotal, concurrentLimit, bufferTarget };
  if (afterStart && ((afterStart.settings as JourneySettings)?.autoFeed || runIds.length === 0)) {
    fed = await feedCallPlanQueue(afterStart, { force });
  }

  const started = runIds.length + fed.started;
  if (started === 0 && skippedDup + fed.skipped > 0) {
    res.status(400).json({
      error: `All people already walked this plan. Pass force=true to re-dial.`,
      skipped: skippedDup + fed.skipped,
    });
    return;
  }

  res.status(201).json({
    ok: true,
    started,
    skipped: skippedDup + fed.skipped,
    runIds,
    workflowId,
    journeyId: id,
    runMode: "once",
    keepLive: false,
    autoFeed: fed.hasMore,
    concurrentLimit,
    bufferTarget,
    batchMax: START_ONCE_MAX,
    offset,
    nextOffset: fed.nextOffset,
    hasMore: fed.hasMore,
    sourceTotal: fed.sourceTotal || slice.sourceTotal,
    scanned: slice.scanned,
    queue: true,
  });
});

/** Preview who would start vs skip (dedup) before committing a Start. */
router.post("/journeys/:id/start-preview", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const journey = await loadOwnedJourney(clerkId, id);
  if (!journey) { res.status(404).json({ error: "Journey not found" }); return; }

  const body = (req.body ?? {}) as {
    campaignId?: number;
    sheetPipelineId?: string;
    phones?: string[];
    offset?: number;
    force?: boolean;
  };
  const settings = (journey.settings ?? {}) as JourneySettings;
  const campaignIdRaw = body.campaignId ?? settings.campaignId ?? null;
  const campaignId = campaignIdRaw != null ? Number(campaignIdRaw) : NaN;
  const sheetPipelineId = (body.sheetPipelineId ?? settings.sheetPipelineId ?? "").trim() || null;
  const offset = Math.max(0, Number(body.offset) || 0);
  const force = body.force === true;

  type Person = { phone: string; name?: string };
  const people: Person[] = [];
  let sourceTotal = 0;

  if (Array.isArray(body.phones) && body.phones.length > 0) {
    const all = body.phones.map((p) => String(p ?? "").trim()).filter(Boolean);
    sourceTotal = all.length;
    for (const phone of all.slice(offset, offset + START_ONCE_MAX)) people.push({ phone });
  } else if (sheetPipelineId) {
    const {
      loadOwnedSheetPipeline,
      listSheetPipelinePeople,
    } = await import("../services/call-plan-sheet-live.js");
    const pipeline = await loadOwnedSheetPipeline(clerkId, sheetPipelineId);
    if (!pipeline) { res.status(404).json({ error: "Sheet list not found" }); return; }
    const listed = await listSheetPipelinePeople(pipeline, {
      fromRowExclusive: 1,
      limit: offset + START_ONCE_MAX,
    });
    sourceTotal = Math.max(0, listed.lastRow - 1);
    for (const p of listed.people.slice(offset, offset + START_ONCE_MAX)) {
      people.push({ phone: p.phone, name: p.name });
    }
  } else if (Number.isFinite(campaignId) && campaignId > 0) {
    const leads = await db.select({
      phone: campaignLeadsTable.phone,
      name: campaignLeadsTable.name,
    }).from(campaignLeadsTable)
      .where(eq(campaignLeadsTable.campaignId, campaignId))
      .orderBy(desc(campaignLeadsTable.createdAt));
    const withPhone = leads.filter((l) => (l.phone ?? "").trim());
    sourceTotal = withPhone.length;
    for (const l of withPhone.slice(offset, offset + START_ONCE_MAX)) {
      people.push({ phone: (l.phone ?? "").trim(), name: l.name ?? undefined });
    }
  } else {
    res.status(400).json({ error: "Pick people first" }); return;
  }

  let wouldSkip = 0;
  const sampleSkipped: Array<{ phone: string; name?: string }> = [];
  let wouldStart = people.length;

  if (!force && journey.workflowId) {
    const prior = await db.select({
      context: workflowRunsTable.context,
      status: workflowRunsTable.status,
    }).from(workflowRunsTable)
      .where(and(
        eq(workflowRunsTable.workflowId, journey.workflowId),
        eq(workflowRunsTable.userId, clerkId),
      ))
      .limit(2000);
    const busy = new Set<string>();
    for (const r of prior) {
      if (r.status === "failed") continue;
      const phone = typeof r.context?.["phone"] === "string" ? r.context["phone"] : "";
      const norm = normalizePhone(phone) || phone.trim();
      if (norm) busy.add(norm);
    }
    wouldStart = 0;
    for (const p of people) {
      const norm = normalizePhone(p.phone) || p.phone.trim();
      if (busy.has(norm)) {
        wouldSkip++;
        if (sampleSkipped.length < 8) sampleSkipped.push(p);
      } else {
        wouldStart++;
        busy.add(norm);
      }
    }
  }

  res.json({
    batchMax: START_ONCE_MAX,
    offset,
    sourceTotal,
    inBatch: people.length,
    wouldStart,
    wouldSkip,
    sampleSkipped,
    hasMore: offset + people.length < sourceTotal,
    nextOffset: offset + people.length,
  });
});

/** Disarm Keep live — stop accepting new sheet rows without deleting the plan. */
router.post("/journeys/:id/stop-live", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const journey = await loadOwnedJourney(clerkId, id);
  if (!journey) { res.status(404).json({ error: "Journey not found" }); return; }

  const settings = { ...(journey.settings ?? {}) } as JourneySettings;
  settings.runMode = "once";
  settings.autoFeed = false;

  await db.update(journeysTable).set({
    settings,
    status: "paused",
    updatedAt: new Date(),
  }).where(and(eq(journeysTable.id, id), eq(journeysTable.userId, clerkId)));

  res.json({ ok: true, runMode: "once", status: "paused" });
});

// ── Runs (via backing workflow) ──────────────────────────────────────────────

type RunStatusFilter = "all" | "in_progress" | "waiting" | "completed" | "failed" | "with_call";

const IN_PROGRESS_STATUSES = ["running", "pending"] as const;
const WAITING_STATUSES = ["waiting_call", "waiting_delay"] as const;
const ACTIVE_STATUSES = [...IN_PROGRESS_STATUSES, ...WAITING_STATUSES] as const;

function parseRunStatusFilter(raw: unknown): RunStatusFilter {
  const v = String(raw ?? "all");
  if (
    v === "in_progress" || v === "waiting" || v === "completed"
    || v === "failed" || v === "with_call" || v === "all"
  ) return v;
  return "all";
}

function runsBaseWhere(workflowId: number, clerkId: string): SQL {
  return and(
    eq(workflowRunsTable.workflowId, workflowId),
    eq(workflowRunsTable.userId, clerkId),
  )!;
}

function runsFilterWhere(status: RunStatusFilter, q: string): SQL | undefined {
  const parts: SQL[] = [];
  if (status === "in_progress") {
    parts.push(inArray(workflowRunsTable.status, [...ACTIVE_STATUSES]));
  } else if (status === "waiting") {
    parts.push(inArray(workflowRunsTable.status, [...WAITING_STATUSES]));
  } else if (status === "completed") {
    parts.push(eq(workflowRunsTable.status, "completed"));
  } else if (status === "failed") {
    parts.push(eq(workflowRunsTable.status, "failed"));
  } else if (status === "with_call") {
    parts.push(or(
      isNotNull(workflowRunsTable.callId),
      sql`coalesce((${workflowRunsTable.context}->'call'->>'callId')::int, 0) > 0`,
    )!);
  }
  const needle = q.trim();
  if (needle) {
    const like = `%${needle.replace(/[%_]/g, "\\$&")}%`;
    parts.push(or(
      sql`coalesce(${workflowRunsTable.context}->>'name', '') ilike ${like}`,
      sql`coalesce(${workflowRunsTable.context}->>'phone', '') ilike ${like}`,
      sql`cast(${workflowRunsTable.id} as text) like ${like}`,
    )!);
  }
  if (parts.length === 0) return undefined;
  return and(...parts);
}

type StepAuditLean = {
  type?: string;
  status?: string;
  reason?: string;
  at?: string;
  stepIndex?: number;
};

function leanCallFromContext(ctx: Record<string, unknown> | null) {
  if (!ctx || typeof ctx.call !== "object" || ctx.call === null) return null;
  const c = ctx.call as Record<string, unknown>;
  return {
    callId: typeof c.callId === "number" ? c.callId : undefined,
    duration: typeof c.duration === "number" ? c.duration : undefined,
    connected: typeof c.connected === "boolean" ? c.connected : undefined,
    status: typeof c.status === "string" ? c.status : undefined,
    summary: typeof c.summary === "string" ? c.summary.slice(0, 200) : undefined,
    disposition: typeof c.disposition === "string" ? c.disposition : undefined,
  };
}

function leanLastStep(ctx: Record<string, unknown> | null): StepAuditLean | null {
  if (!ctx) return null;
  if (ctx.lastStep && typeof ctx.lastStep === "object") {
    const s = ctx.lastStep as StepAuditLean;
    return {
      type: s.type,
      status: s.status,
      reason: typeof s.reason === "string" ? s.reason.slice(0, 200) : undefined,
      at: s.at,
      stepIndex: s.stepIndex,
    };
  }
  if (Array.isArray(ctx.steps) && ctx.steps.length > 0) {
    const last = ctx.steps[ctx.steps.length - 1];
    if (last && typeof last === "object") {
      const s = last as StepAuditLean;
      return {
        type: s.type,
        status: s.status,
        reason: typeof s.reason === "string" ? s.reason.slice(0, 200) : undefined,
        at: s.at,
        stepIndex: s.stepIndex,
      };
    }
  }
  return null;
}

function leanStepTrail(ctx: Record<string, unknown> | null): StepAuditLean[] {
  if (!ctx || !Array.isArray(ctx.steps)) return [];
  return ctx.steps
    .filter((s): s is StepAuditLean => !!s && typeof s === "object")
    .map((s) => ({
      type: s.type,
      status: s.status,
      reason: typeof s.reason === "string" ? s.reason.slice(0, 200) : undefined,
      at: s.at,
      stepIndex: s.stepIndex,
    }));
}

function serializeLeanRun(r: typeof workflowRunsTable.$inferSelect) {
  const ctx = (r.context && typeof r.context === "object") ? r.context as Record<string, unknown> : null;
  const name = typeof ctx?.name === "string" ? ctx.name : "";
  const phone = typeof ctx?.phone === "string" ? ctx.phone : "";
  const call = leanCallFromContext(ctx);
  return {
    id: r.id,
    status: r.status,
    currentStepIndex: r.currentStepIndex,
    leadId: r.leadId,
    callId: r.callId,
    triggeredBy: r.triggeredBy,
    error: r.error,
    resumeAt: r.resumeAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    name,
    phone,
    call,
    lastStep: leanLastStep(ctx),
    stepTrail: leanStepTrail(ctx),
    /** @deprecated use lean fields — kept empty for old clients that expect context */
    context: {
      name,
      phone,
      call,
      lastStep: leanLastStep(ctx),
      steps: leanStepTrail(ctx),
    } as Record<string, unknown>,
  };
}

router.get("/journeys/:id/runs/stats", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const journey = await loadOwnedJourney(clerkId, id);
  if (!journey) { res.status(404).json({ error: "Journey not found" }); return; }
  const { getUserConcurrentLimit } = await import("../services/workflow-dial-queue.js");
  const concurrentLimit = await getUserConcurrentLimit(clerkId);
  const settings = (journey.settings ?? {}) as JourneySettings;

  if (!journey.workflowId) {
    res.json({
      started: 0,
      inProgress: 0,
      waiting: 0,
      queued: 0,
      dialing: 0,
      completed: 0,
      failed: 0,
      withCall: 0,
      connected: 0,
      connectRate: null,
      avgDurationSec: null,
      stepFunnel: [],
      stepCount: (journey.steps ?? []).length,
      concurrentLimit,
      autoFeed: settings.autoFeed === true,
      startOffset: settings.startOffset ?? 0,
      startSourceTotal: settings.startSourceTotal ?? 0,
    });
    return;
  }

  const base = runsBaseWhere(journey.workflowId, clerkId);
  const [agg] = await db
    .select({
      started: count(),
      inProgress: sql<number>`count(*) filter (where ${workflowRunsTable.status} in ('running', 'pending', 'waiting_call', 'waiting_delay'))::int`,
      waiting: sql<number>`count(*) filter (where ${workflowRunsTable.status} in ('waiting_call', 'waiting_delay'))::int`,
      completed: sql<number>`count(*) filter (where ${workflowRunsTable.status} = 'completed')::int`,
      failed: sql<number>`count(*) filter (where ${workflowRunsTable.status} = 'failed')::int`,
      withCall: sql<number>`count(*) filter (where ${workflowRunsTable.callId} is not null or coalesce((${workflowRunsTable.context}->'call'->>'callId')::int, 0) > 0)::int`,
      connected: sql<number>`count(*) filter (where (${workflowRunsTable.context}->'call'->>'connected') = 'true')::int`,
      avgDurationSec: sql<number | null>`avg(nullif((${workflowRunsTable.context}->'call'->>'duration')::float, 0)) filter (where ${workflowRunsTable.callId} is not null or coalesce((${workflowRunsTable.context}->'call'->>'callId')::int, 0) > 0)`,
    })
    .from(workflowRunsTable)
    .where(base);

  const queueCounts = await db.execute<{ queued: number; dialing: number }>(sql`
    SELECT
      count(*) FILTER (WHERE cl.call_status = 'pending')::int AS queued,
      count(*) FILTER (WHERE cl.call_status IN ('calling', 'connected'))::int AS dialing
    FROM workflow_runs wr
    JOIN campaign_leads cl ON cl.id = wr.lead_id
    WHERE wr.workflow_id = ${journey.workflowId}
      AND wr.user_id = ${clerkId}
      AND wr.status = 'waiting_call'
  `);

  const funnelRows = await db
    .select({
      stepIndex: workflowRunsTable.currentStepIndex,
      count: count(),
      failed: sql<number>`count(*) filter (where ${workflowRunsTable.status} = 'failed')::int`,
      completed: sql<number>`count(*) filter (where ${workflowRunsTable.status} = 'completed')::int`,
    })
    .from(workflowRunsTable)
    .where(base)
    .groupBy(workflowRunsTable.currentStepIndex)
    .orderBy(workflowRunsTable.currentStepIndex);

  const stepCount = Math.max((journey.steps ?? []).length, 1);
  const byIndex = new Map(funnelRows.map((r) => [r.stepIndex, r]));

  // Reached counts: runs whose currentStepIndex >= i (or completed)
  const reachedResult = await db.execute(sql`
    select s.step_index, count(*)::int as reached
    from generate_series(0, ${stepCount - 1}) as s(step_index)
    join workflow_runs r
      on r.workflow_id = ${journey.workflowId}
     and r.user_id = ${clerkId}
     and (r.current_step_index >= s.step_index or r.status = 'completed')
    group by s.step_index
    order by s.step_index
  `);
  const reachedMap = new Map(
    (reachedResult.rows as Array<{ step_index: number; reached: number }>).map((r) => [
      Number(r.step_index),
      Number(r.reached),
    ]),
  );
  const stepFunnel = Array.from({ length: stepCount }, (_, stepIndex) => {
    const row = byIndex.get(stepIndex);
    return {
      stepIndex,
      type: (journey.steps ?? [])[stepIndex]?.type ?? null,
      label: (journey.steps ?? [])[stepIndex]?.label ?? null,
      reached: reachedMap.get(stepIndex) ?? 0,
      atStep: Number(row?.count ?? 0),
      failed: Number(row?.failed ?? 0),
      completedAtOrPast: Number(row?.completed ?? 0),
    };
  });

  const started = Number(agg?.started ?? 0);
  const withCall = Number(agg?.withCall ?? 0);
  const connected = Number(agg?.connected ?? 0);
  const avgRaw = agg?.avgDurationSec;
  const queued = Number(queueCounts.rows[0]?.queued ?? 0);
  const dialing = Number(queueCounts.rows[0]?.dialing ?? 0);
  res.json({
    started,
    inProgress: Number(agg?.inProgress ?? 0),
    waiting: Number(agg?.waiting ?? 0),
    queued,
    dialing,
    completed: Number(agg?.completed ?? 0),
    failed: Number(agg?.failed ?? 0),
    withCall,
    connected,
    connectRate: withCall > 0 ? Math.round((connected / withCall) * 1000) / 10 : null,
    avgDurationSec: avgRaw != null && Number.isFinite(Number(avgRaw))
      ? Math.round(Number(avgRaw))
      : null,
    stepFunnel,
    stepCount: (journey.steps ?? []).length,
    concurrentLimit,
    autoFeed: settings.autoFeed === true,
    startOffset: settings.startOffset ?? 0,
    startSourceTotal: settings.startSourceTotal ?? 0,
  });
});

/**
 * Per-step counts for the canvas: how many people each step ran for (by audit
 * status) and how many are parked on it right now (waiting on a call / wait).
 * Keyed by step id; step indices are only stable within the current steps array.
 */
router.get("/journeys/:id/step-stats", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const journey = await loadOwnedJourney(clerkId, id);
  if (!journey) { res.status(404).json({ error: "Journey not found" }); return; }

  const steps = journey.steps ?? [];
  type StepCounts = {
    ran: number; ok: number; sent: number; skipped: number; failed: number; waiting: number; connected: number;
    /** condition / branch: people per path reason ("Yes", "No", "Path: …"). */
    paths: Record<string, number>;
  };
  const out: Record<string, StepCounts> = {};
  for (const s of steps) {
    out[s.id] = { ran: 0, ok: 0, sent: 0, skipped: 0, failed: 0, waiting: 0, connected: 0, paths: {} };
  }
  if (!journey.workflowId || steps.length === 0) { res.json({ steps: out }); return; }

  const audit = await db.execute<{ step_index: number; status: string; reason: string | null; people: number }>(sql`
    SELECT (s->>'stepIndex')::int AS step_index, s->>'status' AS status, s->>'reason' AS reason,
           count(DISTINCT r.id)::int AS people
    FROM workflow_runs r
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(r.context->'steps') = 'array' THEN r.context->'steps' ELSE '[]'::jsonb END
    ) AS s
    WHERE r.workflow_id = ${journey.workflowId} AND r.user_id = ${clerkId}
      AND s ? 'stepIndex'
    GROUP BY 1, 2, 3
  `);
  const ranByIndex = new Map<number, number>();
  for (const row of audit.rows) {
    const step = steps[Number(row.step_index)];
    if (!step) continue;
    const c = out[step.id]!;
    const n = Number(row.people);
    if (step.type === "make_call" && row.reason === "Queued for dial") continue;
    if ((step.type === "condition" || step.type === "branch") && row.reason) {
      c.paths[row.reason] = (c.paths[row.reason] ?? 0) + n;
    }
    if (row.status === "ok" || row.status === "joined") c.ok += n;
    else if (row.status === "sent") c.sent += n;
    else if (row.status === "skipped") c.skipped += n;
    else if (row.status === "failed") c.failed += n;
    if (step.type === "make_call" && row.reason === "Connected") c.connected += n;
  }
  // "ran" = distinct people with any audit entry on the step.
  const ran = await db.execute<{ step_index: number; people: number }>(sql`
    SELECT (s->>'stepIndex')::int AS step_index, count(DISTINCT r.id)::int AS people
    FROM workflow_runs r
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(r.context->'steps') = 'array' THEN r.context->'steps' ELSE '[]'::jsonb END
    ) AS s
    WHERE r.workflow_id = ${journey.workflowId} AND r.user_id = ${clerkId}
      AND s ? 'stepIndex'
    GROUP BY 1
  `);
  for (const row of ran.rows) ranByIndex.set(Number(row.step_index), Number(row.people));
  for (const [idx, n] of ranByIndex) {
    const step = steps[idx];
    if (step) out[step.id]!.ran = n;
  }

  const waiting = await db.execute<{ step_index: number; people: number }>(sql`
    SELECT (context->>'__parkedStepIndex')::int AS step_index, count(*)::int AS people
    FROM workflow_runs
    WHERE workflow_id = ${journey.workflowId} AND user_id = ${clerkId}
      AND status IN ('waiting_call', 'waiting_delay')
      AND context ? '__parkedStepIndex'
    GROUP BY 1
  `);
  for (const row of waiting.rows) {
    const step = steps[Number(row.step_index)];
    if (step) out[step.id]!.waiting = Number(row.people);
  }

  res.json({ steps: out });
});

router.get("/journeys/:id/runs/export", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const journey = await loadOwnedJourney(clerkId, id);
  if (!journey) { res.status(404).json({ error: "Journey not found" }); return; }
  if (!journey.workflowId) {
    res.status(200).type("text/csv").send("Person,Phone,Status,Step,CallId,Duration,Last step,Updated\n");
    return;
  }

  const status = parseRunStatusFilter(req.query["status"]);
  const q = typeof req.query["q"] === "string" ? req.query["q"] : "";
  const filter = runsFilterWhere(status, q);
  const where = filter ? and(runsBaseWhere(journey.workflowId, clerkId), filter) : runsBaseWhere(journey.workflowId, clerkId);

  const runs = await db.select().from(workflowRunsTable)
    .where(where)
    .orderBy(desc(workflowRunsTable.updatedAt))
    .limit(5000);

  const steps = journey.steps ?? [];
  const csvEscape = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const lines = ["Person,Phone,Status,Step,CallId,Duration,Last step,Updated"];
  for (const r of runs) {
    const lean = serializeLeanRun(r);
    const stepN = Math.min(r.currentStepIndex + 1, Math.max(steps.length, 1));
    const stepType = steps[r.currentStepIndex]?.type?.replace(/_/g, " ") ?? "";
    const callId = lean.callId ?? lean.call?.callId ?? "";
    const duration = lean.call?.duration != null && lean.call.duration > 0
      ? String(Math.round(lean.call.duration))
      : "";
    const last = lean.lastStep
      ? `${lean.lastStep.type ?? ""}${lean.lastStep.status ? ` ${lean.lastStep.status}` : ""}${lean.lastStep.reason ? ` — ${lean.lastStep.reason}` : ""}`
      : "";
    lines.push([
      lean.name || "—",
      lean.phone,
      String(r.status).replace(/_/g, " "),
      `${stepN}/${Math.max(steps.length, 1)}${stepType ? ` ${stepType}` : ""}`,
      callId !== "" ? String(callId) : "",
      duration,
      last.trim(),
      r.updatedAt?.toISOString?.() ?? String(r.updatedAt),
    ].map((c) => csvEscape(String(c))).join(","));
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  res.setHeader("Content-Disposition", `attachment; filename="call-plan-${id}-runs-${stamp}.csv"`);
  res.status(200).type("text/csv").send(lines.join("\n"));
});

router.get("/journeys/:id/runs", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const journey = await loadOwnedJourney(clerkId, id);
  if (!journey) { res.status(404).json({ error: "Journey not found" }); return; }
  if (!journey.workflowId) {
    res.json({ runs: [], total: 0, limit: 50, offset: 0 });
    return;
  }

  const status = parseRunStatusFilter(req.query["status"]);
  const q = typeof req.query["q"] === "string" ? req.query["q"] : "";
  const limitRaw = parseInt(String(req.query["limit"] ?? "50"), 10);
  const offsetRaw = parseInt(String(req.query["offset"] ?? "0"), 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, limitRaw)) : 50;
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;

  const filter = runsFilterWhere(status, q);
  const where = filter ? and(runsBaseWhere(journey.workflowId, clerkId), filter) : runsBaseWhere(journey.workflowId, clerkId);

  const [totalRow] = await db
    .select({ total: count() })
    .from(workflowRunsTable)
    .where(where);

  const runs = await db.select().from(workflowRunsTable)
    .where(where)
    .orderBy(desc(workflowRunsTable.updatedAt))
    .limit(limit)
    .offset(offset);

  res.json({
    runs: runs.map(serializeLeanRun),
    total: Number(totalRow?.total ?? 0),
    limit,
    offset,
  });
});

// ── Unified follow-ups (scheduled callbacks for this agent) ──────────────────

router.get("/journeys/:id/followups", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const journey = await loadOwnedJourney(clerkId, id);
  if (!journey) { res.status(404).json({ error: "Journey not found" }); return; }

  const rows = await db.select().from(scheduledCallbacksTable)
    .where(and(
      eq(scheduledCallbacksTable.agentId, journey.agentId),
      eq(scheduledCallbacksTable.userId, clerkId),
    ))
    .orderBy(desc(scheduledCallbacksTable.scheduledAt))
    .limit(50);

  res.json(rows.map((r) => ({
    id: r.id,
    toNumber: r.toNumber,
    status: r.status,
    reason: r.reason,
    notes: r.notes,
    scheduledAt: r.scheduledAt,
    attemptCount: r.attemptCount,
    maxAttempts: r.maxAttempts,
    createdFromCallId: r.createdFromCallId,
    createdAt: r.createdAt,
  })));
});

export default router;
