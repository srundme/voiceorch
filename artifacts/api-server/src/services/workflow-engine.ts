/**
 * Workflow execution engine.
 *
 * A workflow_run walks the workflow's ordered steps. Inline steps
 * (condition, send_webhook) run synchronously; async steps
 * (make_call, delay) park the run and are resumed by the poller in
 * workflow-worker.ts — this keeps execution restart-proof (no reliance on
 * in-memory timers surviving deploys).
 *
 * make_call reuses the campaign dialer: each (user, agent) pair gets a hidden,
 * non-dialable "workflow" campaign, and a lead is inserted + fired via
 * fireCampaignCall. This inherits DNC/TRAI gating, provider-credential
 * resolution, recording, disposition, summary, and Calls-list visibility for
 * free. The run resumes once that lead's call reaches a terminal state.
 */

import {
  db, workflowsTable, workflowRunsTable, campaignsTable, campaignLeadsTable,
  callsTable, agentsTable, phoneNumbersTable,
  type Workflow, type WorkflowRun, type WorkflowStep,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { logger } from "../lib/logger.js";
import { normalizePhone } from "../lib/phone-normalize.js";
import { fireCampaignCall } from "../orchestration/campaignCaller.js";

const CALL_TIMEOUT_MS = 20 * 60 * 1000; // give up waiting on a call after 20 min

// ── Context helpers ──────────────────────────────────────────────────────────

type Ctx = Record<string, unknown>;

function getPath(ctx: Ctx, path: string): unknown {
  if (!path) return undefined;
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, ctx);
}

function toStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Flatten top-level primitive context fields into a string map for lead vars. */
function flattenPrimitives(ctx: Ctx): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "object") continue;
    out[k] = String(v);
  }
  return out;
}

// ── Hidden per-(user,agent) workflow campaign ────────────────────────────────

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

async function getOrCreateWorkflowCampaign(userId: string, agentId: number): Promise<typeof campaignsTable.$inferSelect> {
  const [existing] = await db.select().from(campaignsTable)
    .where(and(
      eq(campaignsTable.userId, userId),
      eq(campaignsTable.agentId, agentId),
      eq(campaignsTable.leadSource, "workflow"),
    ))
    .limit(1);
  if (existing) return existing;

  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId)).limit(1);
  const fromNumber = agent ? await resolveAgentFromNumber(agent) : null;

  const [created] = await db.insert(campaignsTable).values({
    userId,
    name: `__workflow_agent_${agentId}`,
    agentId,
    // "paused" keeps the batch scheduler + rolling-refill from ever auto-dialing
    // these leads; we only ever dial explicitly via fireCampaignCall().
    status: "paused",
    webhookToken: `wf_${randomBytes(20).toString("hex")}`,
    leadSource: "workflow",
    triggerMode: "instant",
    maxAttempts: 1,
    concurrentCallLimit: 1000,
    isActive: false,
    ...(fromNumber ? { fromNumber } : {}),
  }).returning();
  return created!;
}

// ── Run lifecycle ─────────────────────────────────────────────────────────────

export async function startWorkflowRun(opts: {
  workflow: Workflow;
  context: Ctx;
  triggeredBy: string;
}): Promise<number> {
  const { workflow, context, triggeredBy } = opts;
  const [run] = await db.insert(workflowRunsTable).values({
    workflowId: workflow.id,
    userId: workflow.userId,
    status: "running",
    context,
    currentStepIndex: 0,
    triggeredBy,
  }).returning();
  await db.update(workflowsTable)
    .set({ totalRuns: sql`${workflowsTable.totalRuns} + 1`, lastRunAt: new Date() })
    .where(eq(workflowsTable.id, workflow.id));
  void advanceRun(run!.id);
  return run!.id;
}

async function loadRun(runId: number): Promise<{ run: WorkflowRun; workflow: Workflow } | null> {
  const [run] = await db.select().from(workflowRunsTable).where(eq(workflowRunsTable.id, runId)).limit(1);
  if (!run) return null;
  const [workflow] = await db.select().from(workflowsTable).where(eq(workflowsTable.id, run.workflowId)).limit(1);
  if (!workflow) return null;
  return { run, workflow };
}

async function finishRun(runId: number, context: Ctx, status: "completed" | "failed", error?: string): Promise<void> {
  await db.update(workflowRunsTable)
    .set({ status, context, error: error ?? null, updatedAt: new Date() })
    .where(eq(workflowRunsTable.id, runId));
}

/**
 * Execute steps from `run.currentStepIndex`. Inline steps run in a loop; the
 * first async step parks the run and returns (resumed later by the poller).
 */
export async function advanceRun(runId: number): Promise<void> {
  const loaded = await loadRun(runId);
  if (!loaded) return;
  const { run, workflow } = loaded;
  if (run.status === "completed" || run.status === "failed") return;

  const steps = workflow.steps ?? [];
  const context: Ctx = { ...(run.context ?? {}) };
  let idx = run.currentStepIndex;

  while (idx < steps.length) {
    const step = steps[idx]!;
    try {
      if (step.type === "make_call") {
        await beginCall(run.id, workflow.userId, step, context, idx);
        return;
      }
      if (step.type === "delay") {
        await beginDelay(run.id, step, context, idx);
        return;
      }
      if (step.type === "condition") {
        if (!evalCondition(step, context)) {
          logger.info({ runId, stepIdx: idx }, "workflow: condition false — ending run");
          await finishRun(run.id, context, "completed");
          return;
        }
        idx++;
        continue;
      }
      if (step.type === "send_webhook") {
        await doWebhook(step, context);
        idx++;
        continue;
      }
      // Unknown step type — skip.
      idx++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ runId, stepIdx: idx, err }, "workflow: step failed");
      await db.update(workflowRunsTable)
        .set({ status: "failed", error: `Step ${idx} (${step.type}): ${msg}`, context, currentStepIndex: idx, updatedAt: new Date() })
        .where(eq(workflowRunsTable.id, run.id));
      return;
    }
  }

  await finishRun(run.id, context, "completed");
}

// ── make_call ─────────────────────────────────────────────────────────────────

async function beginCall(runId: number, userId: string, step: WorkflowStep, context: Ctx, idx: number): Promise<void> {
  if (!step.agentId) throw new Error("make_call step missing agentId");
  const phoneRaw = toStr(getPath(context, step.phoneField ?? "phone") || context["phone"]);
  if (!phoneRaw.trim()) throw new Error("make_call: no phone number in context");

  const campaign = await getOrCreateWorkflowCampaign(userId, step.agentId);
  const leadData = flattenPrimitives(context);
  const [lead] = await db.insert(campaignLeadsTable).values({
    campaignId: campaign.id,
    phone: phoneRaw,
    normalizedPhone: normalizePhone(phoneRaw),
    name: toStr(context["name"]) || null,
    email: toStr(context["email"]) || null,
    leadData: { ...leadData, __workflowRunId: String(runId) },
    callStatus: "pending",
    source: "workflow",
  }).returning();

  // Park BEFORE dialing so the poller resumes at the step AFTER make_call.
  await db.update(workflowRunsTable)
    .set({ status: "waiting_call", leadId: lead!.id, currentStepIndex: idx + 1, context, updatedAt: new Date() })
    .where(eq(workflowRunsTable.id, runId));

  await fireCampaignCall(lead!, campaign);
  logger.info({ runId, leadId: lead!.id, agentId: step.agentId }, "workflow: make_call dialed");
}

function buildCallResult(call: typeof callsTable.$inferSelect, leadStatus: string): Ctx {
  const connected = call.status === "completed" || !!call.transcript || leadStatus === "connected";
  return {
    connected,
    status: call.status,
    duration: call.durationSeconds ?? 0,
    transcript: call.transcript ?? "",
    summary: call.callSummary ?? "",
    disposition: call.dispositionResult ?? {},
    success: call.successEvaluation ?? "",
    recordingUrl: call.recordingUrl ?? "",
    callId: call.id,
  };
}

/**
 * Poller entry point: resume runs waiting on a call whose lead has reached a
 * terminal state. Uses an atomic status flip so concurrent ticks don't
 * double-resume a run.
 */
export async function resumeWaitingCallRuns(): Promise<void> {
  const runs = await db.select().from(workflowRunsTable)
    .where(eq(workflowRunsTable.status, "waiting_call"))
    .limit(50);

  for (const run of runs) {
    try {
      if (!run.leadId) { await claimAndFail(run.id, "waiting_call", "lost lead reference"); continue; }
      const [lead] = await db.select().from(campaignLeadsTable).where(eq(campaignLeadsTable.id, run.leadId)).limit(1);
      const ageMs = Date.now() - new Date(run.updatedAt).getTime();

      let result: Ctx | null = null;
      let callId: number | null = null;

      if (!lead) {
        result = { connected: false, status: "failed", error: "lead not found" };
      } else if (lead.callId) {
        const [call] = await db.select().from(callsTable).where(eq(callsTable.id, lead.callId)).limit(1);
        if (call && isTerminalCall(call)) {
          result = buildCallResult(call, lead.callStatus);
          callId = call.id;
        }
      } else if (["failed", "skipped"].includes(lead.callStatus)) {
        // Dial never produced a call record (no answer / blocked / error).
        result = { connected: false, status: lead.callStatus, notes: lead.notes ?? "" };
      }

      // Backstop: if we've waited too long, resume as "not connected".
      if (!result && ageMs > CALL_TIMEOUT_MS) {
        result = { connected: false, status: "timeout" };
      }
      if (!result) continue; // still in progress — check again next tick

      if (await claimRun(run.id, "waiting_call")) {
        const context = { ...(run.context ?? {}), call: result };
        await db.update(workflowRunsTable)
          .set({ context, callId, updatedAt: new Date() })
          .where(eq(workflowRunsTable.id, run.id));
        await advanceRun(run.id);
      }
    } catch (err) {
      logger.warn({ runId: run.id, err }, "workflow: resumeWaitingCallRuns error");
    }
  }
}

function isTerminalCall(call: typeof callsTable.$inferSelect): boolean {
  const active = call.status === "pending" || call.status === "in_progress" || call.status === "ringing";
  return !active || !!call.endedAt;
}

// ── delay ─────────────────────────────────────────────────────────────────────

async function beginDelay(runId: number, step: WorkflowStep, context: Ctx, idx: number): Promise<void> {
  const secs = Math.max(0, Number(step.delaySeconds ?? 0));
  const resumeAt = new Date(Date.now() + secs * 1000);
  await db.update(workflowRunsTable)
    .set({ status: "waiting_delay", resumeAt, currentStepIndex: idx + 1, context, updatedAt: new Date() })
    .where(eq(workflowRunsTable.id, runId));
}

/** Poller entry point: resume delayed runs whose timer has elapsed. */
export async function resumeDelayedRuns(): Promise<void> {
  const runs = await db.select().from(workflowRunsTable)
    .where(and(eq(workflowRunsTable.status, "waiting_delay"), sql`${workflowRunsTable.resumeAt} <= now()`))
    .limit(50);
  for (const run of runs) {
    if (await claimRun(run.id, "waiting_delay")) {
      await advanceRun(run.id);
    }
  }
}

// ── condition ──────────────────────────────────────────────────────────────────

function evalCondition(step: WorkflowStep, context: Ctx): boolean {
  const actual = toStr(getPath(context, step.field ?? "")).toLowerCase().trim();
  const expected = toStr(step.value ?? "").toLowerCase().trim();
  switch (step.op ?? "exists") {
    case "eq": return actual === expected;
    case "neq": return actual !== expected;
    case "contains": return actual.includes(expected);
    case "exists": return actual !== "";
    case "gt": return Number(actual) > Number(expected);
    case "lt": return Number(actual) < Number(expected);
    default: return true;
  }
}

// ── webhook ───────────────────────────────────────────────────────────────────

async function doWebhook(step: WorkflowStep, context: Ctx): Promise<void> {
  if (!step.url) throw new Error("send_webhook missing url");
  await fetch(step.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "SnapServe-Workflows/1.0" },
    body: JSON.stringify(context),
    signal: AbortSignal.timeout(10_000),
  }).catch((err) => { throw new Error(`webhook POST failed: ${err?.message ?? err}`); });
}

// ── atomic claim helpers ─────────────────────────────────────────────────────

async function claimRun(runId: number, fromStatus: string): Promise<boolean> {
  const res = await db.execute(sql`
    UPDATE workflow_runs SET status = 'running', updated_at = now()
    WHERE id = ${runId} AND status = ${fromStatus}
    RETURNING id
  `);
  return res.rows.length > 0;
}

async function claimAndFail(runId: number, fromStatus: string, error: string): Promise<void> {
  if (await claimRun(runId, fromStatus)) {
    await db.update(workflowRunsTable).set({ status: "failed", error }).where(eq(workflowRunsTable.id, runId));
  }
}
