/**
 * Agent Squads — authenticated CRUD, attach to phones/campaigns, run control.
 */

import { Router, type IRouter } from "express";
import { eq, and, desc, asc, inArray } from "drizzle-orm";
import {
  db,
  squadsTable,
  squadMembersTable,
  squadRunsTable,
  squadRunStepsTable,
  squadRunEventsTable,
  squadTasksTable,
  scheduledCallbacksTable,
  agentsTable,
  phoneNumbersTable,
  campaignsTable,
  type Squad,
  type SquadMember,
  type SquadLimits,
  type SquadStatus,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { clientContext } from "../middlewares/clientContext.js";
import { logger } from "../lib/logger.js";
import {
  startTaskRun,
  startLiveRun,
  approveSquadStep,
  cancelSquadRun,
  advanceSquadRun,
} from "../services/squad-engine.js";

const router: IRouter = Router();

const TEMPLATES = [
  {
    id: "lead_qualification",
    name: "Lead qualification",
    description: "Research → outbound caller → CRM-style summary",
    roles: ["Researcher", "Outbound Caller", "CRM Updater"],
  },
  {
    id: "claims_review",
    name: "Claims review",
    description: "Intake voice → detail verify → reviewer",
    roles: ["Intake", "Verifier", "Reviewer"],
  },
  {
    id: "appointment_concierge",
    name: "Appointment concierge",
    description: "Requirements → vendor caller → scheduler",
    roles: ["Requirements", "Vendor Caller", "Scheduler"],
  },
  {
    id: "kyc_verification",
    name: "KYC verification",
    description: "Voice KYC → ID check → compliance",
    roles: ["Voice KYC", "ID Verifier", "Compliance"],
  },
];

async function assertOwnedAgents(clerkId: string, agentIds: number[]): Promise<boolean> {
  if (agentIds.length === 0) return true;
  const rows = await db.select({ id: agentsTable.id }).from(agentsTable)
    .where(and(eq(agentsTable.userId, clerkId), inArray(agentsTable.id, agentIds)));
  return rows.length === agentIds.length;
}

async function loadMembers(squadId: number): Promise<SquadMember[]> {
  return db.select().from(squadMembersTable)
    .where(eq(squadMembersTable.squadId, squadId))
    .orderBy(asc(squadMembersTable.sortOrder), asc(squadMembersTable.id));
}

function serializeMember(m: SquadMember, agentName?: string | null) {
  return {
    id: m.id,
    squadId: m.squadId,
    agentId: m.agentId,
    agentName: agentName ?? null,
    roleName: m.roleName,
    roleType: m.roleType,
    instructions: m.instructions,
    allowedTools: m.allowedTools ?? [],
    sortOrder: m.sortOrder,
    handoffEnabled: m.handoffEnabled,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

async function serializeSquad(s: Squad) {
  const members = await loadMembers(s.id);
  const agentIds = members.map((m) => m.agentId);
  const agents = agentIds.length
    ? await db.select({ id: agentsTable.id, name: agentsTable.name }).from(agentsTable)
      .where(inArray(agentsTable.id, agentIds))
    : [];
  const nameById = new Map(agents.map((a) => [a.id, a.name]));

  const [phones, camps] = await Promise.all([
    db.select({
      id: phoneNumbersTable.id,
      number: phoneNumbersTable.number,
    }).from(phoneNumbersTable).where(eq(phoneNumbersTable.squadId, s.id)),
    db.select({
      id: campaignsTable.id,
      name: campaignsTable.name,
      agentId: campaignsTable.agentId,
    }).from(campaignsTable).where(eq(campaignsTable.squadId, s.id)),
  ]);

  return {
    id: s.id,
    name: s.name,
    description: s.description,
    status: s.status,
    supervisorAgentId: s.supervisorAgentId,
    entryMemberId: s.entryMemberId,
    limits: s.limits ?? {},
    handoffGreeting: s.handoffGreeting,
    members: members.map((m) => serializeMember(m, nameById.get(m.agentId))),
    connections: { phoneNumbers: phones, campaigns: camps },
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

type MemberInput = {
  agentId: number;
  roleName: string;
  roleType?: "supervisor" | "specialist";
  instructions?: string | null;
  allowedTools?: string[];
  sortOrder?: number;
  handoffEnabled?: boolean;
};

// ── Templates ────────────────────────────────────────────────────────────────

router.get("/squads/templates", requireAuth, clientContext, (_req, res): void => {
  res.json(TEMPLATES);
});

// ── CRUD ─────────────────────────────────────────────────────────────────────

router.get("/squads", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const rows = await db.select().from(squadsTable)
    .where(eq(squadsTable.userId, clerkId))
    .orderBy(desc(squadsTable.updatedAt));
  const out = [];
  for (const s of rows) out.push(await serializeSquad(s));
  res.json(out);
});

router.get("/squads/:id", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const [s] = await db.select().from(squadsTable)
    .where(and(eq(squadsTable.id, id), eq(squadsTable.userId, clerkId))).limit(1);
  if (!s) { res.status(404).json({ error: "Squad not found" }); return; }
  res.json(await serializeSquad(s));
});

router.post("/squads", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const body = req.body as {
    name?: string;
    description?: string;
    supervisorAgentId?: number | null;
    entryMemberId?: number | null;
    limits?: SquadLimits;
    handoffGreeting?: string;
    members?: MemberInput[];
    status?: SquadStatus;
  };
  if (!body.name?.trim()) { res.status(400).json({ error: "name required" }); return; }

  const members = body.members ?? [];
  const agentIds = [
    ...members.map((m) => m.agentId),
    ...(body.supervisorAgentId ? [body.supervisorAgentId] : []),
  ];
  if (!(await assertOwnedAgents(clerkId, [...new Set(agentIds)]))) {
    res.status(403).json({ error: "All member agents must belong to you" });
    return;
  }

  const [s] = await db.insert(squadsTable).values({
    userId: clerkId,
    name: body.name.trim(),
    description: body.description ?? null,
    supervisorAgentId: body.supervisorAgentId ?? null,
    limits: body.limits ?? {},
    handoffGreeting: body.handoffGreeting ?? undefined,
    status: body.status === "active" ? "active" : "draft",
  }).returning();

  if (members.length) {
    await db.insert(squadMembersTable).values(
      members.map((m, i) => ({
        squadId: s!.id,
        agentId: m.agentId,
        roleName: m.roleName,
        roleType: m.roleType ?? (m.agentId === body.supervisorAgentId ? "supervisor" : "specialist"),
        instructions: m.instructions ?? null,
        allowedTools: m.allowedTools ?? [],
        sortOrder: m.sortOrder ?? i,
        handoffEnabled: m.handoffEnabled ?? true,
      })),
    );
  }

  if (body.entryMemberId) {
    await db.update(squadsTable).set({ entryMemberId: body.entryMemberId })
      .where(eq(squadsTable.id, s!.id));
  } else {
    const loaded = await loadMembers(s!.id);
    const entry = loaded.find((m) => m.roleType === "specialist") ?? loaded[0];
    if (entry) {
      await db.update(squadsTable).set({ entryMemberId: entry.id }).where(eq(squadsTable.id, s!.id));
    }
  }

  const [fresh] = await db.select().from(squadsTable).where(eq(squadsTable.id, s!.id)).limit(1);
  res.status(201).json(await serializeSquad(fresh!));
});

router.patch("/squads/:id", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const [existing] = await db.select().from(squadsTable)
    .where(and(eq(squadsTable.id, id), eq(squadsTable.userId, clerkId))).limit(1);
  if (!existing) { res.status(404).json({ error: "Squad not found" }); return; }

  const body = req.body as Partial<{
    name: string;
    description: string | null;
    supervisorAgentId: number | null;
    entryMemberId: number | null;
    limits: SquadLimits;
    handoffGreeting: string;
    status: SquadStatus;
    members: MemberInput[];
  }>;

  if (body.members) {
    const agentIds = body.members.map((m) => m.agentId);
    if (body.supervisorAgentId) agentIds.push(body.supervisorAgentId);
    if (!(await assertOwnedAgents(clerkId, [...new Set(agentIds)]))) {
      res.status(403).json({ error: "All member agents must belong to you" });
      return;
    }
    await db.delete(squadMembersTable).where(eq(squadMembersTable.squadId, id));
    if (body.members.length) {
      await db.insert(squadMembersTable).values(
        body.members.map((m, i) => ({
          squadId: id,
          agentId: m.agentId,
          roleName: m.roleName,
          roleType: m.roleType ?? "specialist",
          instructions: m.instructions ?? null,
          allowedTools: m.allowedTools ?? [],
          sortOrder: m.sortOrder ?? i,
          handoffEnabled: m.handoffEnabled ?? true,
        })),
      );
    }
  }

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates["name"] = body.name;
  if (body.description !== undefined) updates["description"] = body.description;
  if (body.supervisorAgentId !== undefined) updates["supervisorAgentId"] = body.supervisorAgentId;
  if (body.entryMemberId !== undefined) updates["entryMemberId"] = body.entryMemberId;
  if (body.limits !== undefined) updates["limits"] = body.limits;
  if (body.handoffGreeting !== undefined) updates["handoffGreeting"] = body.handoffGreeting;
  if (body.status !== undefined && ["draft", "active", "paused"].includes(body.status)) {
    updates["status"] = body.status;
  }

  if (Object.keys(updates).length) {
    await db.update(squadsTable).set(updates)
      .where(and(eq(squadsTable.id, id), eq(squadsTable.userId, clerkId)));
  }

  const [fresh] = await db.select().from(squadsTable).where(eq(squadsTable.id, id)).limit(1);
  res.json(await serializeSquad(fresh!));
});

router.delete("/squads/:id", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  // Detach connections first
  await db.update(phoneNumbersTable).set({ squadId: null })
    .where(and(eq(phoneNumbersTable.squadId, id), eq(phoneNumbersTable.userId, clerkId)));
  await db.update(campaignsTable).set({ squadId: null })
    .where(and(eq(campaignsTable.squadId, id), eq(campaignsTable.userId, clerkId)));
  const [s] = await db.delete(squadsTable)
    .where(and(eq(squadsTable.id, id), eq(squadsTable.userId, clerkId))).returning();
  if (!s) { res.status(404).json({ error: "Squad not found" }); return; }
  res.sendStatus(204);
});

// ── Connect phone / campaign ─────────────────────────────────────────────────

router.post("/squads/:id/connect", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const [s] = await db.select().from(squadsTable)
    .where(and(eq(squadsTable.id, id), eq(squadsTable.userId, clerkId))).limit(1);
  if (!s) { res.status(404).json({ error: "Squad not found" }); return; }

  const body = req.body as {
    phoneNumberId?: number | null;
    campaignId?: number | null;
    entryMemberId?: number | null;
    detach?: boolean;
  };

  if (body.entryMemberId != null) {
    const [m] = await db.select().from(squadMembersTable)
      .where(and(eq(squadMembersTable.id, body.entryMemberId), eq(squadMembersTable.squadId, id)))
      .limit(1);
    if (!m) { res.status(400).json({ error: "entryMemberId not in squad" }); return; }
    await db.update(squadsTable).set({ entryMemberId: body.entryMemberId }).where(eq(squadsTable.id, id));
  }

  if (body.phoneNumberId != null) {
    const [pn] = await db.select().from(phoneNumbersTable)
      .where(and(eq(phoneNumbersTable.id, body.phoneNumberId), eq(phoneNumbersTable.userId, clerkId)))
      .limit(1);
    if (!pn) { res.status(404).json({ error: "Phone number not found" }); return; }
    await db.update(phoneNumbersTable).set({
      squadId: body.detach ? null : id,
    }).where(eq(phoneNumbersTable.id, pn.id));

    // Prefer entry member's agent as inbound agent when attaching
    if (!body.detach) {
      const members = await loadMembers(id);
      const entry = (body.entryMemberId
        ? members.find((m) => m.id === body.entryMemberId)
        : null)
        ?? (s.entryMemberId ? members.find((m) => m.id === s.entryMemberId) : null)
        ?? members[0];
      if (entry && !pn.agentId) {
        await db.update(phoneNumbersTable).set({ agentId: entry.agentId })
          .where(eq(phoneNumbersTable.id, pn.id));
      }
    }
  }

  if (body.campaignId != null) {
    const [c] = await db.select().from(campaignsTable)
      .where(and(eq(campaignsTable.id, body.campaignId), eq(campaignsTable.userId, clerkId)))
      .limit(1);
    if (!c) { res.status(404).json({ error: "Campaign not found" }); return; }
    const patch: Record<string, unknown> = { squadId: body.detach ? null : id };
    if (!body.detach) {
      const members = await loadMembers(id);
      const entry = (body.entryMemberId
        ? members.find((m) => m.id === body.entryMemberId)
        : null)
        ?? (s.entryMemberId ? members.find((m) => m.id === s.entryMemberId) : null)
        ?? members[0];
      if (entry) patch["agentId"] = entry.agentId;
    }
    await db.update(campaignsTable).set(patch).where(eq(campaignsTable.id, c.id));
  }

  const [fresh] = await db.select().from(squadsTable).where(eq(squadsTable.id, id)).limit(1);
  res.json(await serializeSquad(fresh!));
});

// ── Tasks (handoffs + follow-ups between squad members) ──────────────────────

router.get("/squads/:id/tasks", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const [s] = await db.select().from(squadsTable)
    .where(and(eq(squadsTable.id, id), eq(squadsTable.userId, clerkId))).limit(1);
  if (!s) { res.status(404).json({ error: "Squad not found" }); return; }

  const tasks = await db.select().from(squadTasksTable)
    .where(eq(squadTasksTable.squadId, id))
    .orderBy(desc(squadTasksTable.createdAt))
    .limit(100);

  const agentIds = [...new Set(tasks.flatMap((t) => [t.fromAgentId, t.toAgentId]).filter((v): v is number => v != null))];
  const agents = agentIds.length
    ? await db.select({ id: agentsTable.id, name: agentsTable.name }).from(agentsTable)
      .where(inArray(agentsTable.id, agentIds))
    : [];
  const nameById = new Map(agents.map((a) => [a.id, a.name]));

  res.json(tasks.map((t) => ({
    id: t.id,
    type: t.type,
    status: t.status,
    fromAgentId: t.fromAgentId,
    fromAgentName: t.fromAgentId != null ? nameById.get(t.fromAgentId) ?? null : null,
    toAgentId: t.toAgentId,
    toAgentName: t.toAgentId != null ? nameById.get(t.toAgentId) ?? null : null,
    callId: t.callId,
    callerPhone: t.callerPhone,
    title: t.title,
    note: t.note,
    contextSummary: t.contextSummary,
    dueAt: t.dueAt,
    createdAt: t.createdAt,
  })));
});

router.post("/squad-tasks/:taskId/cancel", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const taskId = parseInt(String(req.params["taskId"]), 10);
  const [task] = await db.select().from(squadTasksTable)
    .where(and(eq(squadTasksTable.id, taskId), eq(squadTasksTable.userId, clerkId))).limit(1);
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }
  if (task.status === "completed" || task.status === "cancelled") {
    res.status(400).json({ error: `Task already ${task.status}` });
    return;
  }
  await db.update(squadTasksTable).set({ status: "cancelled" }).where(eq(squadTasksTable.id, taskId));
  if (task.scheduledCallbackId) {
    await db.update(scheduledCallbacksTable)
      .set({ status: "cancelled", cancelledAt: new Date() })
      .where(and(
        eq(scheduledCallbacksTable.id, task.scheduledCallbackId),
        eq(scheduledCallbacksTable.status, "pending"),
      ));
  }
  res.json({ ok: true });
});

// ── Runs ─────────────────────────────────────────────────────────────────────

router.post("/squads/:id/runs", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const body = req.body as {
    kind?: "task" | "live_call";
    goal?: string;
    context?: Record<string, unknown>;
    entryMemberId?: number;
  };

  try {
    if (body.kind === "live_call") {
      const run = await startLiveRun({
        squadId: id,
        userId: clerkId,
        goal: body.goal ?? "Live call test",
        context: body.context,
        triggeredBy: "test",
        entryMemberId: body.entryMemberId ?? null,
      });
      res.status(201).json({ runId: run.id, kind: "live_call", status: run.status, activeMemberId: run.activeMemberId });
      return;
    }

    if (!body.goal?.trim()) { res.status(400).json({ error: "goal required for task runs" }); return; }
    const { runId } = await startTaskRun({
      squadId: id,
      userId: clerkId,
      goal: body.goal.trim(),
      context: body.context,
      triggeredBy: "test",
    });
    res.status(201).json({ runId, kind: "task" });
  } catch (err: any) {
    const status = typeof err?.status === "number" ? err.status : 500;
    logger.warn({ err, squadId: id }, "Failed to start squad run");
    res.status(status).json({ error: err instanceof Error ? err.message : "Failed to start run" });
  }
});

router.get("/squads/:id/runs", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const [s] = await db.select().from(squadsTable)
    .where(and(eq(squadsTable.id, id), eq(squadsTable.userId, clerkId))).limit(1);
  if (!s) { res.status(404).json({ error: "Squad not found" }); return; }

  const runs = await db.select().from(squadRunsTable)
    .where(eq(squadRunsTable.squadId, id))
    .orderBy(desc(squadRunsTable.createdAt))
    .limit(50);
  res.json(runs.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    goal: r.goal,
    triggeredBy: r.triggeredBy,
    activeMemberId: r.activeMemberId,
    activeCallId: r.activeCallId,
    finalResult: r.finalResult,
    error: r.error,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  })));
});

router.get("/squad-runs/:runId", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const runId = parseInt(String(req.params["runId"]), 10);
  const [run] = await db.select().from(squadRunsTable)
    .where(and(eq(squadRunsTable.id, runId), eq(squadRunsTable.userId, clerkId))).limit(1);
  if (!run) { res.status(404).json({ error: "Run not found" }); return; }

  const [steps, events] = await Promise.all([
    db.select().from(squadRunStepsTable)
      .where(eq(squadRunStepsTable.runId, runId))
      .orderBy(asc(squadRunStepsTable.stepIndex)),
    db.select().from(squadRunEventsTable)
      .where(eq(squadRunEventsTable.runId, runId))
      .orderBy(asc(squadRunEventsTable.createdAt))
      .limit(200),
  ]);

  res.json({
    ...run,
    steps,
    events,
  });
});

router.post("/squad-runs/:runId/cancel", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const runId = parseInt(String(req.params["runId"]), 10);
  try {
    await cancelSquadRun({ runId, userId: clerkId });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(err?.status ?? 500).json({ error: err instanceof Error ? err.message : "Cancel failed" });
  }
});

router.post("/squad-runs/:runId/approve", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const runId = parseInt(String(req.params["runId"]), 10);
  const body = req.body as { stepId?: number; approved?: boolean; note?: string };
  if (body.stepId == null || typeof body.approved !== "boolean") {
    res.status(400).json({ error: "stepId and approved required" });
    return;
  }
  try {
    await approveSquadStep({
      runId,
      userId: clerkId,
      stepId: body.stepId,
      approved: body.approved,
      note: body.note,
    });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(err?.status ?? 500).json({ error: err instanceof Error ? err.message : "Approval failed" });
  }
});

router.post("/squad-runs/:runId/retry", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const runId = parseInt(String(req.params["runId"]), 10);
  const [run] = await db.select().from(squadRunsTable)
    .where(and(eq(squadRunsTable.id, runId), eq(squadRunsTable.userId, clerkId))).limit(1);
  if (!run) { res.status(404).json({ error: "Run not found" }); return; }
  if (!["failed", "cancelled"].includes(run.status) && run.status !== "running") {
    // Allow retry of failed steps by re-advancing
  }
  await db.update(squadRunsTable).set({
    status: "running",
    error: null,
    attemptCount: run.attemptCount + 1,
  }).where(eq(squadRunsTable.id, runId));
  void advanceSquadRun(runId).catch((err) => logger.error({ err, runId }, "retry advance failed"));
  res.json({ ok: true });
});

export default router;
