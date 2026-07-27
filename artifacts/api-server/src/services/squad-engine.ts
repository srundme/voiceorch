/**
 * Squad execution engine — supervisor plans steps, engine executes them
 * restart-safely (persist before every async action).
 */

import {
  db,
  squadsTable,
  squadMembersTable,
  squadRunsTable,
  squadRunStepsTable,
  squadRunEventsTable,
  agentsTable,
  campaignsTable,
  campaignLeadsTable,
  phoneNumbersTable,
  platformSettingsTable,
  usersTable,
  DEFAULT_SQUAD_LIMITS,
  type Squad,
  type SquadMember,
  type SquadRun,
  type SquadStepPayload,
  type SquadRunTrigger,
  type SquadRunKind,
  type SquadEventType,
} from "@workspace/db";
import { eq, and, asc, desc, inArray } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { geminiThinkingConfig } from "../orchestration/adapters/llm/google.js";
import { logger } from "../lib/logger.js";
import { normalizePhone } from "../lib/phone-normalize.js";
import { fireCampaignCall } from "../orchestration/campaignCaller.js";
import {
  validatePlannedSteps,
  heuristicPlan,
  mergeLimits,
  ALLOWED_STEP_TYPES,
  type PlannedStep,
} from "./squad-plan.js";

export {
  validatePlannedSteps,
  heuristicPlan,
  mergeLimits,
  ALLOWED_STEP_TYPES,
  type PlannedStep,
} from "./squad-plan.js";

const PLANNER_MODEL = "gemini-3.5-flash-lite";

type Ctx = Record<string, unknown>;

export async function appendSquadEvent(opts: {
  runId: number;
  type: SquadEventType;
  message?: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(squadRunEventsTable).values({
    runId: opts.runId,
    type: opts.type,
    message: opts.message ?? null,
    payload: opts.payload ?? {},
  });
}

async function getGeminiKey(): Promise<string | null> {
  try {
    const [row] = await db.select().from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, "managed_gemini_key"));
    return row?.value ?? process.env["GEMINI_API_KEY"] ?? null;
  } catch {
    return process.env["GEMINI_API_KEY"] ?? null;
  }
}

async function planWithLlm(opts: {
  goal: string;
  context: Ctx;
  members: SquadMember[];
  agentsById: Map<number, { name: string }>;
}): Promise<PlannedStep[] | null> {
  const key = await getGeminiKey();
  if (!key) return null;

  const roster = opts.members.map((m) => ({
    memberId: m.id,
    roleName: m.roleName,
    roleType: m.roleType,
    agentName: opts.agentsById.get(m.agentId)?.name ?? `agent:${m.agentId}`,
    instructions: m.instructions,
    handoffEnabled: m.handoffEnabled,
  }));

  const prompt = `You are a squad supervisor planner. Return ONLY JSON: {"steps":[...]}.
Each step: {type, memberId?, objective?, requiredInputs?, successCriteria?, requireApproval?, phoneField?, url?, targetMemberId?, handoffReason?}
Allowed types: ${ALLOWED_STEP_TYPES.join(", ")}.
Prefer agent_reason then supervisor_review. Use make_call only if a phone is clearly needed and present in context.
Max ${DEFAULT_SQUAD_LIMITS.maxSteps} steps. memberId must be from the roster.

Goal: ${opts.goal}
Context: ${JSON.stringify(opts.context).slice(0, 4000)}
Roster: ${JSON.stringify(roster)}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${PLANNER_MODEL}:generateContent?key=${key}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.2, thinkingConfig: geminiThinkingConfig(PLANNER_MODEL) },
      }),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "Squad planner Gemini error");
      return null;
    }
    const data = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const parsed = JSON.parse(text) as { steps?: unknown };
    return Array.isArray(parsed.steps) ? (parsed.steps as PlannedStep[]) : null;
  } catch (err) {
    logger.warn({ err }, "Squad planner failed — using heuristic");
    return null;
  }
}

async function loadSquadBundle(squadId: number, userId?: string) {
  const where = userId
    ? and(eq(squadsTable.id, squadId), eq(squadsTable.userId, userId))
    : eq(squadsTable.id, squadId);
  const [squad] = await db.select().from(squadsTable).where(where).limit(1);
  if (!squad) return null;
  const members = await db.select().from(squadMembersTable)
    .where(eq(squadMembersTable.squadId, squadId))
    .orderBy(asc(squadMembersTable.sortOrder), asc(squadMembersTable.id));
  return { squad, members };
}

async function persistPlan(runId: number, steps: PlannedStep[]): Promise<void> {
  await db.delete(squadRunStepsTable).where(eq(squadRunStepsTable.runId, runId));
  if (steps.length === 0) return;
  await db.insert(squadRunStepsTable).values(
    steps.map((s, i) => ({
      runId,
      stepIndex: i,
      type: s.type,
      status: "pending" as const,
      memberId: s.memberId ?? s.targetMemberId ?? null,
      input: s as SquadStepPayload,
    })),
  );
}

export async function createSquadRun(opts: {
  squadId: number;
  userId: string;
  kind: SquadRunKind;
  goal: string;
  context?: Ctx;
  triggeredBy: SquadRunTrigger;
  campaignId?: number | null;
  campaignLeadId?: number | null;
  phoneNumberId?: number | null;
  activeMemberId?: number | null;
}): Promise<SquadRun> {
  const [run] = await db.insert(squadRunsTable).values({
    squadId: opts.squadId,
    userId: opts.userId,
    kind: opts.kind,
    status: "pending",
    goal: opts.goal,
    context: opts.context ?? {},
    triggeredBy: opts.triggeredBy,
    campaignId: opts.campaignId ?? null,
    campaignLeadId: opts.campaignLeadId ?? null,
    phoneNumberId: opts.phoneNumberId ?? null,
    activeMemberId: opts.activeMemberId ?? null,
  }).returning();
  await appendSquadEvent({
    runId: run!.id,
    type: "run_started",
    message: `Run started (${opts.triggeredBy})`,
    payload: { kind: opts.kind, goal: opts.goal },
  });
  return run!;
}

export async function startTaskRun(opts: {
  squadId: number;
  userId: string;
  goal: string;
  context?: Ctx;
  triggeredBy?: SquadRunTrigger;
}): Promise<{ runId: number }> {
  const bundle = await loadSquadBundle(opts.squadId, opts.userId);
  if (!bundle) throw Object.assign(new Error("Squad not found"), { status: 404 });
  if (bundle.members.length === 0) throw Object.assign(new Error("Squad has no members"), { status: 400 });

  const [wallet] = await db.select({ balance: usersTable.walletBalanceCents })
    .from(usersTable).where(eq(usersTable.clerkId, opts.userId)).limit(1);
  if ((wallet?.balance ?? 0) <= 0) {
    throw Object.assign(new Error("Insufficient wallet balance"), { status: 402 });
  }

  const run = await createSquadRun({
    squadId: opts.squadId,
    userId: opts.userId,
    kind: "task",
    goal: opts.goal,
    context: opts.context,
    triggeredBy: opts.triggeredBy ?? "manual",
  });

  const agentIds = [...new Set(bundle.members.map((m) => m.agentId))];
  const agents = agentIds.length
    ? await db.select({ id: agentsTable.id, name: agentsTable.name }).from(agentsTable)
      .where(inArray(agentsTable.id, agentIds))
    : [];
  const agentsById = new Map(agents.map((a) => [a.id, { name: a.name }]));

  const limits = mergeLimits(bundle.squad.limits);
  const llmSteps = await planWithLlm({
    goal: opts.goal,
    context: opts.context ?? {},
    members: bundle.members,
    agentsById,
  });
  const candidate = llmSteps ?? heuristicPlan(opts.goal, bundle.members);
  const validated = validatePlannedSteps(candidate, bundle.members, limits);
  if (!validated.ok) {
    await db.update(squadRunsTable).set({ status: "failed", error: validated.error })
      .where(eq(squadRunsTable.id, run.id));
    await appendSquadEvent({ runId: run.id, type: "run_failed", message: validated.error });
    throw Object.assign(new Error(validated.error), { status: 400 });
  }

  await persistPlan(run.id, validated.steps);
  await appendSquadEvent({
    runId: run.id,
    type: "plan_created",
    message: `Plan with ${validated.steps.length} steps`,
    payload: { steps: validated.steps },
  });
  await db.update(squadRunsTable).set({ status: "running", currentStepIndex: 0 })
    .where(eq(squadRunsTable.id, run.id));

  void advanceSquadRun(run.id).catch((err) => {
    logger.error({ err, runId: run.id }, "advanceSquadRun failed after start");
  });

  return { runId: run.id };
}

export async function startLiveRun(opts: {
  squadId: number;
  userId: string;
  goal?: string;
  context?: Ctx;
  triggeredBy: SquadRunTrigger;
  entryMemberId?: number | null;
  campaignId?: number | null;
  campaignLeadId?: number | null;
  phoneNumberId?: number | null;
  callId?: number | null;
}): Promise<SquadRun> {
  const bundle = await loadSquadBundle(opts.squadId, opts.userId);
  if (!bundle) throw Object.assign(new Error("Squad not found"), { status: 404 });

  let entry = opts.entryMemberId
    ? bundle.members.find((m) => m.id === opts.entryMemberId)
    : null;
  if (!entry && bundle.squad.entryMemberId) {
    entry = bundle.members.find((m) => m.id === bundle.squad.entryMemberId) ?? null;
  }
  if (!entry) {
    entry = bundle.members.find((m) => m.roleType === "specialist")
      ?? bundle.members[0]
      ?? null;
  }
  if (!entry) throw Object.assign(new Error("Squad has no entry member"), { status: 400 });

  const run = await createSquadRun({
    squadId: opts.squadId,
    userId: opts.userId,
    kind: "live_call",
    goal: opts.goal ?? "Live squad call",
    context: opts.context,
    triggeredBy: opts.triggeredBy,
    campaignId: opts.campaignId,
    campaignLeadId: opts.campaignLeadId,
    phoneNumberId: opts.phoneNumberId,
    activeMemberId: entry.id,
  });

  await db.insert(squadRunStepsTable).values({
    runId: run.id,
    stepIndex: 0,
    type: "live_call",
    status: opts.callId ? "running" : "pending",
    memberId: entry.id,
    input: { memberId: entry.id, objective: "Handle live customer call" },
    callId: opts.callId ?? null,
    startedAt: opts.callId ? new Date() : null,
  });

  await db.update(squadRunsTable).set({
    status: "live_call",
    activeCallId: opts.callId ?? null,
    activeMemberId: entry.id,
  }).where(eq(squadRunsTable.id, run.id));

  if (opts.callId) {
    await appendSquadEvent({
      runId: run.id,
      type: "call_linked",
      message: `Linked call ${opts.callId}`,
      payload: { callId: opts.callId, memberId: entry.id },
    });
  }

  return { ...run, status: "live_call", activeMemberId: entry.id, activeCallId: opts.callId ?? null };
}

export async function linkCallToLiveRun(opts: {
  runId: number;
  callId: number;
}): Promise<void> {
  await db.update(squadRunsTable).set({
    activeCallId: opts.callId,
    status: "live_call",
  }).where(eq(squadRunsTable.id, opts.runId));
  await db.update(squadRunStepsTable).set({
    callId: opts.callId,
    status: "running",
    startedAt: new Date(),
  }).where(and(
    eq(squadRunStepsTable.runId, opts.runId),
    eq(squadRunStepsTable.type, "live_call"),
  ));
  await appendSquadEvent({
    runId: opts.runId,
    type: "call_linked",
    message: `Linked call ${opts.callId}`,
    payload: { callId: opts.callId },
  });
}

/** Resolve or create a live squad run for inbound/campaign triggers. */
export async function ensureLiveSquadRunForCall(opts: {
  squadId: number;
  userId: string;
  callId: number;
  entryAgentId: number;
  triggeredBy: SquadRunTrigger;
  campaignId?: number | null;
  campaignLeadId?: number | null;
  phoneNumberId?: number | null;
  goal?: string;
  context?: Ctx;
}): Promise<{ runId: number; memberId: number } | null> {
  const bundle = await loadSquadBundle(opts.squadId, opts.userId);
  if (!bundle || bundle.squad.status === "paused") return null;

  const entry = bundle.members.find((m) => m.agentId === opts.entryAgentId)
    ?? (bundle.squad.entryMemberId
      ? bundle.members.find((m) => m.id === bundle.squad.entryMemberId)
      : null)
    ?? bundle.members[0];
  if (!entry) return null;

  const run = await startLiveRun({
    squadId: opts.squadId,
    userId: opts.userId,
    goal: opts.goal,
    context: opts.context,
    triggeredBy: opts.triggeredBy,
    entryMemberId: entry.id,
    campaignId: opts.campaignId,
    campaignLeadId: opts.campaignLeadId,
    phoneNumberId: opts.phoneNumberId,
    callId: opts.callId,
  });

  return { runId: run.id, memberId: entry.id };
}

export type HandoffPacket = {
  fromMemberId: number;
  toMemberId: number;
  fromAgentId: number;
  toAgentId: number;
  reason: string;
  goal: string;
  transcriptSummary: string;
  language?: string | null;
  durableFacts?: Record<string, unknown>;
  toolResults?: unknown[];
};

export async function validateSquadHandoff(opts: {
  squadId: number;
  fromAgentId: number;
  toAgentId: number;
}): Promise<{ ok: true; from: SquadMember; to: SquadMember; squad: Squad } | { ok: false; error: string }> {
  const bundle = await loadSquadBundle(opts.squadId);
  if (!bundle) return { ok: false, error: "Squad not found" };
  const from = bundle.members.find((m) => m.agentId === opts.fromAgentId);
  const to = bundle.members.find((m) => m.agentId === opts.toAgentId);
  if (!from) return { ok: false, error: "Current agent is not a squad member" };
  if (!to) return { ok: false, error: "Target agent is not a squad member" };
  if (!to.handoffEnabled) return { ok: false, error: "Target member is not enabled for handoff" };
  if (from.id === to.id) return { ok: false, error: "Cannot hand off to the same member" };
  return { ok: true, from, to, squad: bundle.squad };
}

export async function recordSquadHandoff(opts: {
  runId: number;
  packet: HandoffPacket;
  outcome: "success" | "failed" | "rolled_back";
  error?: string;
}): Promise<void> {
  const [run] = await db.select().from(squadRunsTable).where(eq(squadRunsTable.id, opts.runId)).limit(1);
  if (run) {
    const ctx = { ...(run.context ?? {}), lastHandoff: opts.packet };
    await db.update(squadRunsTable).set({
      context: ctx,
      ...(opts.outcome === "success" ? { activeMemberId: opts.packet.toMemberId } : {}),
    }).where(eq(squadRunsTable.id, opts.runId));
  }

  await appendSquadEvent({
    runId: opts.runId,
    type: "handoff",
    message: opts.outcome === "success"
      ? `Handoff ${opts.packet.fromMemberId} → ${opts.packet.toMemberId}`
      : `Handoff failed: ${opts.error ?? opts.outcome}`,
    payload: { ...opts.packet, outcome: opts.outcome, error: opts.error },
  });
}

async function resolveAgentFromNumber(agent: typeof agentsTable.$inferSelect): Promise<string | null> {
  if (agent.outboundPhoneNumberId) {
    const [pn] = await db.select({ number: phoneNumbersTable.number })
      .from(phoneNumbersTable).where(eq(phoneNumbersTable.id, agent.outboundPhoneNumberId)).limit(1);
    if (pn?.number) return pn.number;
  }
  const [assigned] = await db.select({ number: phoneNumbersTable.number })
    .from(phoneNumbersTable)
    .where(and(eq(phoneNumbersTable.agentId, agent.id), eq(phoneNumbersTable.status, "active")))
    .limit(1);
  return assigned?.number ?? null;
}

async function getOrCreateSquadCampaign(userId: string, agentId: number) {
  const [existing] = await db.select().from(campaignsTable)
    .where(and(
      eq(campaignsTable.userId, userId),
      eq(campaignsTable.agentId, agentId),
      eq(campaignsTable.leadSource, "workflow"),
      eq(campaignsTable.name, `__squad_agent_${agentId}`),
    ))
    .limit(1);
  if (existing) return existing;

  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId)).limit(1);
  const fromNumber = agent ? await resolveAgentFromNumber(agent) : null;
  const [created] = await db.insert(campaignsTable).values({
    userId,
    name: `__squad_agent_${agentId}`,
    agentId,
    status: "paused",
    webhookToken: `sq_${randomBytes(20).toString("hex")}`,
    leadSource: "workflow",
    triggerMode: "instant",
    maxAttempts: 1,
    concurrentCallLimit: 1000,
    isActive: false,
    ...(fromNumber ? { fromNumber } : {}),
  }).returning();
  return created!;
}

function getPath(ctx: Ctx, path: string): unknown {
  if (!path) return undefined;
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, ctx);
}

async function runAgentReason(opts: {
  member: SquadMember;
  agentName: string;
  goal: string;
  objective: string;
  context: Ctx;
}): Promise<Record<string, unknown>> {
  const key = await getGeminiKey();
  if (!key) {
    return {
      summary: `Heuristic result for ${opts.agentName}: ${opts.objective}`,
      notes: "No LLM key — placeholder specialist output",
    };
  }
  const prompt = `You are squad member "${opts.member.roleName}" (${opts.agentName}).
Role instructions: ${opts.member.instructions ?? "(none)"}
Squad goal: ${opts.goal}
Your objective: ${opts.objective}
Shared context (JSON): ${JSON.stringify(opts.context).slice(0, 6000)}
Return ONLY JSON with keys: summary (string), data (object), nextHint (string).`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${PLANNER_MODEL}:generateContent?key=${key}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.3, thinkingConfig: geminiThinkingConfig(PLANNER_MODEL) },
      }),
    });
    if (!res.ok) {
      return { summary: `LLM error ${res.status}`, error: true };
    }
    const data = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    return JSON.parse(text) as Record<string, unknown>;
  } catch (err) {
    return { summary: "Specialist reasoning failed", error: String(err) };
  }
}

export async function advanceSquadRun(runId: number): Promise<void> {
  const [run] = await db.select().from(squadRunsTable).where(eq(squadRunsTable.id, runId)).limit(1);
  if (!run) return;
  if (!["running", "pending"].includes(run.status)) return;

  const bundle = await loadSquadBundle(run.squadId);
  if (!bundle) {
    await failRun(runId, "Squad missing");
    return;
  }
  const limits = mergeLimits(bundle.squad.limits);
  const membersById = new Map(bundle.members.map((m) => [m.id, m]));

  const steps = await db.select().from(squadRunStepsTable)
    .where(eq(squadRunStepsTable.runId, runId))
    .orderBy(asc(squadRunStepsTable.stepIndex));

  let idx = run.currentStepIndex;
  while (idx < steps.length) {
    const step = steps[idx]!;
    if (step.status === "completed" || step.status === "skipped") {
      idx++;
      continue;
    }
    if (step.status === "waiting") return;

    if (idx >= limits.maxSteps) {
      await failRun(runId, "Max steps exceeded");
      return;
    }

    await db.update(squadRunStepsTable).set({
      status: "running",
      startedAt: step.startedAt ?? new Date(),
    }).where(eq(squadRunStepsTable.id, step.id));
    await appendSquadEvent({
      runId,
      type: "step_started",
      message: `Step ${idx}: ${step.type}`,
      payload: { stepId: step.id, type: step.type },
    });

    try {
      const input = (step.input ?? {}) as SquadStepPayload;
      const member = step.memberId != null ? membersById.get(step.memberId) : undefined;
      let output: Record<string, unknown> = {};
      let contextPatch: Ctx = {};

      switch (step.type) {
        case "agent_reason":
        case "supervisor_review": {
          if (!member) throw new Error("Missing member for reasoning step");
          const [agent] = await db.select({ name: agentsTable.name }).from(agentsTable)
            .where(eq(agentsTable.id, member.agentId)).limit(1);
          output = await runAgentReason({
            member,
            agentName: agent?.name ?? `agent:${member.agentId}`,
            goal: run.goal,
            objective: input.objective ?? step.type,
            context: run.context ?? {},
          });
          contextPatch = {
            [`members.${member.roleName.replace(/\s+/g, "_").toLowerCase()}.result`]: output,
          };
          if (step.type === "supervisor_review") {
            await db.update(squadRunsTable).set({
              finalResult: typeof output["summary"] === "string" ? output["summary"] : JSON.stringify(output),
            }).where(eq(squadRunsTable.id, runId));
          }
          break;
        }
        case "wait_approval": {
          await db.update(squadRunStepsTable).set({ status: "waiting" }).where(eq(squadRunStepsTable.id, step.id));
          await db.update(squadRunsTable).set({
            status: "awaiting_approval",
            currentStepIndex: idx,
          }).where(eq(squadRunsTable.id, runId));
          await appendSquadEvent({
            runId,
            type: "approval_requested",
            message: input.objective ?? "Approval required",
            payload: { stepId: step.id },
          });
          return;
        }
        case "send_webhook": {
          const url = input.url;
          if (!url) throw new Error("Webhook URL missing");
          const idem = (input.idempotencyKey as string | undefined)
            ?? `squad-${runId}-step-${step.id}`;
          const res = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": idem,
            },
            body: JSON.stringify({
              squadRunId: runId,
              goal: run.goal,
              context: run.context,
              step: input,
            }),
          });
          output = { status: res.status, ok: res.ok };
          if (!res.ok) throw new Error(`Webhook HTTP ${res.status}`);
          break;
        }
        case "make_call": {
          if (!member) throw new Error("Missing member for make_call");
          const phoneField = input.phoneField ?? "phone";
          const phoneRaw = getPath(run.context ?? {}, phoneField);
          const phone = normalizePhone(String(phoneRaw ?? ""));
          if (!phone) throw new Error(`No phone in context.${phoneField}`);

          if (input.requireApproval !== false) {
            // Default: park for approval before dialing
            await db.update(squadRunStepsTable).set({
              status: "waiting",
              input: { ...input, _pendingDial: true, phone },
            }).where(eq(squadRunStepsTable.id, step.id));
            await db.update(squadRunsTable).set({
              status: "awaiting_approval",
              currentStepIndex: idx,
            }).where(eq(squadRunsTable.id, runId));
            await appendSquadEvent({
              runId,
              type: "approval_requested",
              message: `Approve call to ${phone}`,
              payload: { stepId: step.id, phone },
            });
            return;
          }

          const campaign = await getOrCreateSquadCampaign(run.userId, member.agentId);
          const [lead] = await db.insert(campaignLeadsTable).values({
            campaignId: campaign.id,
            phone,
            normalizedPhone: phone,
            name: String(getPath(run.context ?? {}, "name") ?? "") || null,
            leadData: { __squad_run_id: String(runId), __squad_step_id: String(step.id) },
            callStatus: "pending",
            source: "workflow",
          }).returning();
          await db.update(squadRunsTable).set({
            status: "waiting_call",
            currentStepIndex: idx,
            campaignLeadId: lead!.id,
            campaignId: campaign.id,
          }).where(eq(squadRunsTable.id, runId));
          await db.update(squadRunStepsTable).set({ status: "waiting" }).where(eq(squadRunStepsTable.id, step.id));
          await fireCampaignCall(lead!, campaign);
          await appendSquadEvent({
            runId,
            type: "step_started",
            message: `Dialing ${phone}`,
            payload: { leadId: lead!.id, stepId: step.id },
          });
          return;
        }
        case "live_call":
        case "handoff_agent": {
          // Live steps are driven by the call session / coordinator, not the task loop.
          await db.update(squadRunStepsTable).set({
            status: "completed",
            output: { note: "Managed by live call coordinator" },
            completedAt: new Date(),
          }).where(eq(squadRunStepsTable.id, step.id));
          idx++;
          await db.update(squadRunsTable).set({ currentStepIndex: idx }).where(eq(squadRunsTable.id, runId));
          continue;
        }
        default:
          throw new Error(`Unsupported step type: ${step.type}`);
      }

      const mergedCtx = { ...(run.context ?? {}), ...contextPatch };
      await db.update(squadRunsTable).set({ context: mergedCtx }).where(eq(squadRunsTable.id, runId));
      run.context = mergedCtx;

      await db.update(squadRunStepsTable).set({
        status: "completed",
        output,
        completedAt: new Date(),
      }).where(eq(squadRunStepsTable.id, step.id));
      await appendSquadEvent({
        runId,
        type: "step_completed",
        message: `Step ${idx} completed`,
        payload: { stepId: step.id, type: step.type, output },
      });
      idx++;
      await db.update(squadRunsTable).set({ currentStepIndex: idx }).where(eq(squadRunsTable.id, runId));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const retries = step.retryCount + 1;
      if (retries <= limits.maxRetriesPerStep) {
        await db.update(squadRunStepsTable).set({
          status: "pending",
          retryCount: retries,
          error: msg,
        }).where(eq(squadRunStepsTable.id, step.id));
        await appendSquadEvent({
          runId,
          type: "step_failed",
          message: `Retry ${retries}: ${msg}`,
          payload: { stepId: step.id },
        });
        continue;
      }
      await db.update(squadRunStepsTable).set({
        status: "failed",
        error: msg,
        completedAt: new Date(),
      }).where(eq(squadRunStepsTable.id, step.id));
      await failRun(runId, msg);
      return;
    }
  }

  await db.update(squadRunsTable).set({
    status: "completed",
    currentStepIndex: idx,
  }).where(eq(squadRunsTable.id, runId));
  await appendSquadEvent({ runId, type: "run_completed", message: "Run completed" });
}

async function failRun(runId: number, error: string): Promise<void> {
  await db.update(squadRunsTable).set({ status: "failed", error }).where(eq(squadRunsTable.id, runId));
  await appendSquadEvent({ runId, type: "run_failed", message: error });
}

export async function approveSquadStep(opts: {
  runId: number;
  userId: string;
  stepId: number;
  approved: boolean;
  note?: string;
}): Promise<void> {
  const [run] = await db.select().from(squadRunsTable)
    .where(and(eq(squadRunsTable.id, opts.runId), eq(squadRunsTable.userId, opts.userId)))
    .limit(1);
  if (!run) throw Object.assign(new Error("Run not found"), { status: 404 });

  const [step] = await db.select().from(squadRunStepsTable)
    .where(and(eq(squadRunStepsTable.id, opts.stepId), eq(squadRunStepsTable.runId, opts.runId)))
    .limit(1);
  if (!step || step.status !== "waiting") {
    throw Object.assign(new Error("Step is not awaiting approval"), { status: 400 });
  }

  await appendSquadEvent({
    runId: opts.runId,
    type: "approval_resolved",
    message: opts.approved ? "Approved" : "Rejected",
    payload: { stepId: opts.stepId, note: opts.note },
  });

  if (!opts.approved) {
    await db.update(squadRunStepsTable).set({
      status: "cancelled",
      error: opts.note ?? "Rejected",
      completedAt: new Date(),
    }).where(eq(squadRunStepsTable.id, step.id));
    await failRun(opts.runId, opts.note ?? "Step rejected");
    return;
  }

  const input = (step.input ?? {}) as SquadStepPayload & { _pendingDial?: boolean; phone?: string };
  if (step.type === "make_call" && input._pendingDial && input.phone && step.memberId) {
    const [member] = await db.select().from(squadMembersTable)
      .where(eq(squadMembersTable.id, step.memberId)).limit(1);
    if (!member) throw Object.assign(new Error("Member missing"), { status: 400 });
    const campaign = await getOrCreateSquadCampaign(run.userId, member.agentId);
    const [lead] = await db.insert(campaignLeadsTable).values({
      campaignId: campaign.id,
      phone: input.phone,
      normalizedPhone: input.phone,
      leadData: { __squad_run_id: String(opts.runId), __squad_step_id: String(step.id) },
      callStatus: "pending",
      source: "workflow",
    }).returning();
    await db.update(squadRunStepsTable).set({
      status: "waiting",
      input: { ...input, requireApproval: false, _pendingDial: false },
    }).where(eq(squadRunStepsTable.id, step.id));
    await db.update(squadRunsTable).set({
      status: "waiting_call",
      campaignLeadId: lead!.id,
      campaignId: campaign.id,
    }).where(eq(squadRunsTable.id, opts.runId));
    await fireCampaignCall(lead!, campaign);
    return;
  }

  await db.update(squadRunStepsTable).set({ status: "completed", completedAt: new Date() })
    .where(eq(squadRunStepsTable.id, step.id));
  await db.update(squadRunsTable).set({
    status: "running",
    currentStepIndex: step.stepIndex + 1,
  }).where(eq(squadRunsTable.id, opts.runId));
  await advanceSquadRun(opts.runId);
}

export async function cancelSquadRun(opts: { runId: number; userId: string }): Promise<void> {
  const [run] = await db.select().from(squadRunsTable)
    .where(and(eq(squadRunsTable.id, opts.runId), eq(squadRunsTable.userId, opts.userId)))
    .limit(1);
  if (!run) throw Object.assign(new Error("Run not found"), { status: 404 });
  await db.update(squadRunsTable).set({ status: "cancelled" }).where(eq(squadRunsTable.id, opts.runId));
  await appendSquadEvent({ runId: opts.runId, type: "run_cancelled", message: "Cancelled by user" });
}

export async function onSquadCampaignCallEnded(opts: {
  leadId: number;
  callId: number | null;
  summary?: string | null;
  disposition?: string | null;
}): Promise<void> {
  const [run] = await db.select().from(squadRunsTable)
    .where(and(
      eq(squadRunsTable.campaignLeadId, opts.leadId),
      eq(squadRunsTable.status, "waiting_call"),
    ))
    .orderBy(desc(squadRunsTable.id))
    .limit(1);
  if (!run) return;

  const ctx = {
    ...(run.context ?? {}),
    call: {
      callId: opts.callId,
      summary: opts.summary,
      disposition: opts.disposition,
    },
  };
  const steps = await db.select().from(squadRunStepsTable)
    .where(and(eq(squadRunStepsTable.runId, run.id), eq(squadRunStepsTable.status, "waiting")))
    .orderBy(asc(squadRunStepsTable.stepIndex))
    .limit(1);
  const step = steps[0];
  if (step) {
    await db.update(squadRunStepsTable).set({
      status: "completed",
      callId: opts.callId,
      output: { summary: opts.summary, disposition: opts.disposition },
      completedAt: new Date(),
    }).where(eq(squadRunStepsTable.id, step.id));
  }
  await db.update(squadRunsTable).set({
    status: "running",
    context: ctx,
    activeCallId: opts.callId,
    currentStepIndex: (step?.stepIndex ?? run.currentStepIndex) + 1,
  }).where(eq(squadRunsTable.id, run.id));
  await appendSquadEvent({
    runId: run.id,
    type: "step_completed",
    message: "Outbound call finished",
    payload: { callId: opts.callId, summary: opts.summary },
  });
  await advanceSquadRun(run.id);
}

export async function completeLiveSquadRun(opts: {
  runId: number;
  summary?: string | null;
}): Promise<void> {
  await db.update(squadRunsTable).set({
    status: "completed",
    finalResult: opts.summary ?? null,
  }).where(eq(squadRunsTable.id, opts.runId));
  await db.update(squadRunStepsTable).set({
    status: "completed",
    completedAt: new Date(),
    ...(opts.summary ? { output: { summary: opts.summary } } : {}),
  }).where(and(
    eq(squadRunStepsTable.runId, opts.runId),
    eq(squadRunStepsTable.type, "live_call"),
  ));
  await appendSquadEvent({
    runId: opts.runId,
    type: "run_completed",
    message: "Live call ended",
    payload: { summary: opts.summary },
  });
}
