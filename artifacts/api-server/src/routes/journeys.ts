/**
 * Agent-first Journeys — product layer above workflows.
 *
 * Journeys own the business flow (presets, settings, agent binding). Execution
 * is delegated to a linked workflow so dialing/resume/delay reuse the existing
 * engine, including Phase-2 steps: schedule_callback + send_whatsapp.
 */

import { Router, type IRouter } from "express";
import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
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
import {
  buildJourneyPreset,
  listJourneyPresets,
} from "../services/journey-presets.js";

const router: IRouter = Router();

function serializeJourney(j: Journey, extras?: { hookUrl?: string | null }) {
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
  if (body.steps !== undefined) updates["steps"] = body.steps;
  if (body.settings !== undefined) updates["settings"] = body.settings;
  if (body.presetId !== undefined) updates["presetId"] = body.presetId;
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

  const [j] = await db.update(journeysTable).set({ status: "active" })
    .where(and(eq(journeysTable.id, id), eq(journeysTable.userId, clerkId)))
    .returning();
  await syncBackingWorkflow(j!);
  const [fresh] = await db.select().from(journeysTable).where(eq(journeysTable.id, id)).limit(1);
  res.json(serializeJourney(fresh!));
});

router.post("/journeys/:id/pause", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const existing = await loadOwnedJourney(clerkId, id);
  if (!existing) { res.status(404).json({ error: "Journey not found" }); return; }

  const [j] = await db.update(journeysTable).set({ status: "paused" })
    .where(and(eq(journeysTable.id, id), eq(journeysTable.userId, clerkId)))
    .returning();
  await syncBackingWorkflow(j!);
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

// ── Start once (Call plans MVP) ──────────────────────────────────────────────
// Walk current people through the plan: one workflow run per phone.
// Retries / "call me back" stay on the agent — this only starts the sequence.

const START_ONCE_MAX = 100;

router.post("/journeys/:id/start", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const journey = await loadOwnedJourney(clerkId, id);
  if (!journey) { res.status(404).json({ error: "Journey not found" }); return; }

  if (!Array.isArray(journey.steps) || journey.steps.length === 0) {
    res.status(400).json({ error: "Add at least one step before starting" }); return;
  }

  const body = (req.body ?? {}) as {
    campaignId?: number;
    sheetPipelineId?: string;
    phones?: string[];
    limit?: number;
    runMode?: "once" | "live";
  };

  const settings = (journey.settings ?? {}) as JourneySettings;
  const campaignIdRaw = body.campaignId ?? settings.campaignId ?? null;
  const campaignId = campaignIdRaw != null ? Number(campaignIdRaw) : NaN;
  const sheetPipelineId = (body.sheetPipelineId ?? settings.sheetPipelineId ?? "").trim() || null;
  const runMode = body.runMode === "live" || settings.runMode === "live" ? "live" : "once";
  const limit = Math.min(
    Math.max(1, Number(body.limit) || START_ONCE_MAX),
    START_ONCE_MAX,
  );

  type Person = {
    phone: string;
    name?: string;
    email?: string;
    leadId?: number;
    meetingUrl?: string;
    sheetRowIndex?: number;
  };
  const people: Person[] = [];
  let sheetCursorRow = typeof settings.sheetCursorRow === "number" ? settings.sheetCursorRow : 1;

  if (Array.isArray(body.phones) && body.phones.length > 0) {
    for (const raw of body.phones) {
      const phone = String(raw ?? "").trim();
      if (phone) people.push({ phone });
      if (people.length >= limit) break;
    }
  } else if (sheetPipelineId) {
    const {
      loadOwnedSheetPipeline,
      listSheetPipelinePeople,
    } = await import("../services/call-plan-sheet-live.js");
    const pipeline = await loadOwnedSheetPipeline(clerkId, sheetPipelineId);
    if (!pipeline) { res.status(404).json({ error: "Sheet list not found" }); return; }
    const listed = await listSheetPipelinePeople(pipeline, {
      fromRowExclusive: runMode === "live" ? sheetCursorRow : 1,
      limit,
    });
    for (const p of listed.people) {
      people.push({
        phone: p.phone,
        name: p.name,
        email: p.email,
        meetingUrl: p.meetingUrl,
        sheetRowIndex: p.sheetRowIndex,
      });
    }
    if (people.length > 0) {
      sheetCursorRow = Math.max(...people.map((p) => p.sheetRowIndex ?? 1), sheetCursorRow);
    } else if (listed.lastRow > sheetCursorRow) {
      sheetCursorRow = listed.lastRow;
    }
  } else if (Number.isFinite(campaignId) && campaignId > 0) {
    const [campaign] = await db.select({ id: campaignsTable.id })
      .from(campaignsTable)
      .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, clerkId)))
      .limit(1);
    if (!campaign) { res.status(404).json({ error: "People list (campaign) not found" }); return; }

    const leads = await db.select({
      id: campaignLeadsTable.id,
      phone: campaignLeadsTable.phone,
      name: campaignLeadsTable.name,
      email: campaignLeadsTable.email,
    }).from(campaignLeadsTable)
      .where(eq(campaignLeadsTable.campaignId, campaignId))
      .orderBy(desc(campaignLeadsTable.createdAt))
      .limit(limit);

    for (const lead of leads) {
      const phone = (lead.phone ?? "").trim();
      if (!phone) continue;
      people.push({
        phone,
        name: lead.name ?? undefined,
        email: lead.email ?? undefined,
        leadId: lead.id,
      });
    }
  } else {
    res.status(400).json({
      error: "Pick a people list (CSV or Sheet) or pass phones to start",
    });
    return;
  }

  // Persist people binding + run mode (Keep live can arm with zero current rows).
  const nextSettings: JourneySettings = {
    ...settings,
    runMode,
    ...(Number.isFinite(campaignId) && campaignId > 0 && !sheetPipelineId
      ? { peopleSource: "campaign" as const, campaignId, sheetPipelineId: null }
      : {}),
    ...(sheetPipelineId
      ? {
          peopleSource: "sheet" as const,
          sheetPipelineId,
          sheetCursorRow,
          campaignId: null,
        }
      : {}),
    ...(Array.isArray(body.phones) && body.phones.length > 0 && !sheetPipelineId && !(Number.isFinite(campaignId) && campaignId > 0)
      ? { peopleSource: "manual" as const }
      : {}),
  };

  if (people.length === 0 && !(runMode === "live" && sheetPipelineId)) {
    res.status(400).json({ error: "No people to start — add leads, connect a sheet, or paste phone numbers" }); return;
  }

  await db.update(journeysTable).set({
    settings: nextSettings,
    status: "active",
  }).where(and(eq(journeysTable.id, id), eq(journeysTable.userId, clerkId)));

  const [freshJourney] = await db.select().from(journeysTable).where(eq(journeysTable.id, id)).limit(1);
  const workflowId = await syncBackingWorkflow(freshJourney!);
  const [workflow] = await db.select().from(workflowsTable)
    .where(and(eq(workflowsTable.id, workflowId), eq(workflowsTable.userId, clerkId)))
    .limit(1);
  if (!workflow) { res.status(500).json({ error: "Backing workflow missing" }); return; }

  const runIds: number[] = [];
  for (const person of people) {
    const runId = await startWorkflowRun({
      workflow,
      context: {
        phone: person.phone,
        ...(person.name ? { name: person.name } : {}),
        ...(person.email ? { email: person.email } : {}),
        ...(person.meetingUrl
          ? { meetingUrl: person.meetingUrl, meetLink: person.meetingUrl }
          : {}),
        ...(person.leadId != null ? { leadId: person.leadId } : {}),
        ...(sheetPipelineId && person.sheetRowIndex != null
          ? {
              __sheet_pipeline_id: sheetPipelineId,
              sheetPipelineId,
              __sheet_row_index: person.sheetRowIndex,
              sheetRowIndex: person.sheetRowIndex,
            }
          : {}),
        callPlanId: id,
        agentId: freshJourney!.agentId,
      },
      triggeredBy: runMode === "live" ? "call_plan_live" : "call_plan_start",
    });
    runIds.push(runId);
  }

  res.status(201).json({
    ok: true,
    started: runIds.length,
    runIds,
    workflowId,
    journeyId: id,
    runMode,
    keepLive: runMode === "live" && !!sheetPipelineId,
  });
});

// ── Runs (via backing workflow) ──────────────────────────────────────────────

router.get("/journeys/:id/runs", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const journey = await loadOwnedJourney(clerkId, id);
  if (!journey) { res.status(404).json({ error: "Journey not found" }); return; }
  if (!journey.workflowId) { res.json([]); return; }

  const runs = await db.select().from(workflowRunsTable)
    .where(and(
      eq(workflowRunsTable.workflowId, journey.workflowId),
      eq(workflowRunsTable.userId, clerkId),
    ))
    .orderBy(desc(workflowRunsTable.createdAt))
    .limit(50);

  res.json(runs.map((r) => ({
    id: r.id,
    status: r.status,
    context: r.context,
    currentStepIndex: r.currentStepIndex,
    leadId: r.leadId,
    callId: r.callId,
    triggeredBy: r.triggeredBy,
    error: r.error,
    resumeAt: r.resumeAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  })));
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
