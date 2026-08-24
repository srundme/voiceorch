/**
 * Workflow execution engine.
 *
 * A workflow_run walks the workflow's ordered steps. Inline steps
 * (condition, send_webhook) run synchronously; async steps
 * (make_call, delay) park the run and are resumed by the poller in
 * workflow-worker.ts — this keeps execution restart-proof (no reliance on
 * in-memory timers surviving deploys).
 *
 * make_call reuses the campaign dialer: each (user, agent[, squad]) combo gets a
 * hidden, non-dialable "workflow" campaign, and a lead is inserted + fired via
 * fireCampaignCall. This inherits DNC/TRAI gating, provider-credential
 * resolution, recording, disposition, summary, and Calls-list visibility for
 * free. When step.squadId is set, the campaign is stamped with that squad so
 * createSession attaches a live squad run. The run resumes once that lead's
 * call reaches a terminal state.
 */

import {
  db, workflowsTable, workflowRunsTable, campaignsTable, campaignLeadsTable,
  campaignBatchesTable,
  callsTable, agentsTable, phoneNumbersTable, journeysTable,
  sheetAutoCallPipelinesTable,
  type Workflow, type WorkflowRun, type WorkflowStep,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { logger } from "../lib/logger.js";
import { normalizePhone } from "../lib/phone-normalize.js";
import { fetchUserConfiguredUrl } from "../lib/ssrf.js";
import { scheduleCallbackRequested } from "./autoRedial.js";
import {
  getUserConcurrentLimit,
  getOrCreateWorkflowRunningBatch,
  refillWorkflowDialSlots,
  syncWorkflowCampaignConcurrency,
} from "./workflow-dial-queue.js";
import {
  getActiveChannel,
  resolveSendContext,
  sendWhatsappTemplate,
  getOwnCredsForUser,
  type TemplateHint,
} from "./whatsapp/vobiz.js";
import { sendChannelEmail } from "./email-channel.js";
import { interpolateTemplate } from "./template-vars.js";
import { launchMeetingBotForAgent } from "./meeting-bot-launch.js";
import { updateSheetRowByIndex } from "./google-sheets.js";
import { sheetKeysForLead } from "./sheets-writeback.js";

const CALL_TIMEOUT_MS = 20 * 60 * 1000; // give up waiting on a call after 20 min

// ── Context helpers ──────────────────────────────────────────────────────────

type Ctx = Record<string, unknown>;

type StepAuditStatus = "sent" | "skipped" | "failed" | "ok" | "joined";

type StepAuditEntry = {
  type: string;
  status: StepAuditStatus;
  reason?: string;
  at: string;
  stepIndex?: number;
};

/** Append a per-step outcome onto run context for Activity / call-plan transparency. */
function recordStepAudit(
  context: Ctx,
  entry: Omit<StepAuditEntry, "at"> & { at?: string },
): void {
  const prev = Array.isArray(context["steps"]) ? (context["steps"] as StepAuditEntry[]) : [];
  const next: StepAuditEntry = {
    type: entry.type,
    status: entry.status,
    ...(entry.reason ? { reason: entry.reason } : {}),
    ...(typeof entry.stepIndex === "number" ? { stepIndex: entry.stepIndex } : {}),
    at: entry.at ?? new Date().toISOString(),
  };
  context["steps"] = [...prev, next];
  context["lastStep"] = next;
}

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

async function getOrCreateWorkflowCampaign(
  userId: string,
  agentId: number,
  squadId?: number | null,
): Promise<typeof campaignsTable.$inferSelect> {
  const sid = typeof squadId === "number" && Number.isInteger(squadId) && squadId > 0 ? squadId : null;
  const name = sid ? `__workflow_agent_${agentId}_sq_${sid}` : `__workflow_agent_${agentId}`;

  const [byName] = await db.select().from(campaignsTable)
    .where(and(
      eq(campaignsTable.userId, userId),
      eq(campaignsTable.agentId, agentId),
      eq(campaignsTable.leadSource, "workflow"),
      eq(campaignsTable.name, name),
    ))
    .limit(1);
  const accountLimit = await getUserConcurrentLimit(userId);

  if (byName) {
    let campaign = byName;
    if (sid && byName.squadId !== sid) {
      const [updated] = await db.update(campaignsTable)
        .set({ squadId: sid })
        .where(eq(campaignsTable.id, byName.id))
        .returning();
      campaign = updated!;
    }
    return syncWorkflowCampaignConcurrency(campaign, userId);
  }

  // Legacy: older rows were created without a unique name filter (one per agent).
  if (!sid) {
    const [legacy] = await db.select().from(campaignsTable)
      .where(and(
        eq(campaignsTable.userId, userId),
        eq(campaignsTable.agentId, agentId),
        eq(campaignsTable.leadSource, "workflow"),
      ))
      .limit(1);
    if (legacy) return syncWorkflowCampaignConcurrency(legacy, userId);
  }

  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId)).limit(1);
  const fromNumber = agent ? await resolveAgentFromNumber(agent) : null;

  const [created] = await db.insert(campaignsTable).values({
    userId,
    name,
    agentId,
    // Dialable like People campaigns — rolling refill via refillCampaignConcurrency.
    // Hidden from People UI via leadSource=workflow.
    status: "active",
    webhookToken: `wf_${randomBytes(20).toString("hex")}`,
    leadSource: "workflow",
    triggerMode: "instant",
    maxAttempts: 1,
    concurrentCallLimit: accountLimit,
    isActive: true,
    ...(sid ? { squadId: sid } : {}),
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

  // Keep linked journey counters in sync when runs start via the public hook / test.
  await db.update(journeysTable)
    .set({ totalRuns: sql`${journeysTable.totalRuns} + 1`, lastRunAt: new Date() })
    .where(eq(journeysTable.workflowId, workflow.id));

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
    // After a then-branch, skip the else-block to rejoin.
    const joinAt = Number(context["__branchJoinAt"]);
    const elseCount = Math.max(0, Math.floor(Number(context["__branchElseCount"] ?? 0)));
    if (Number.isFinite(joinAt) && idx === joinAt && elseCount > 0) {
      delete context["__branchJoinAt"];
      delete context["__branchElseCount"];
      idx += elseCount;
      continue;
    }

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
        if (step.field === "__stop") {
          recordStepAudit(context, { type: "stop", status: "ok", reason: "Stop", stepIndex: idx });
          await finishRun(run.id, context, "completed");
          return;
        }

        const ok = evalCondition(step, context);
        const thenN = Math.max(0, Math.floor(Number(step.thenStepCount ?? 0)));
        const elseN = Math.max(0, Math.floor(Number(step.elseStepCount ?? 0)));
        const branched = thenN > 0 || elseN > 0;

        if (!branched) {
          // Legacy gate: false ends the person’s path.
          if (!ok) {
            logger.info({ runId, stepIdx: idx }, "workflow: condition false — ending run");
            recordStepAudit(context, {
              type: "condition",
              status: "ok",
              reason: "Condition false — path ended",
              stepIndex: idx,
            });
            await finishRun(run.id, context, "completed");
            return;
          }
          recordStepAudit(context, {
            type: "condition",
            status: "ok",
            reason: "Condition true — continue",
            stepIndex: idx,
          });
          idx++;
          continue;
        }

        // If / else: [condition][then × thenN][else × elseN][rejoin…]
        if (ok) {
          recordStepAudit(context, {
            type: "condition",
            status: "ok",
            reason: `Then branch (${thenN} step${thenN === 1 ? "" : "s"})`,
            stepIndex: idx,
          });
          // After the then-block, skip the else-block.
          if (elseN > 0) {
            context["__branchJoinAt"] = idx + 1 + thenN;
            context["__branchElseCount"] = elseN;
          }
          idx++;
          continue;
        }

        recordStepAudit(context, {
          type: "condition",
          status: "ok",
          reason: elseN > 0
            ? `Else branch (${elseN} step${elseN === 1 ? "" : "s"})`
            : "Condition false — skip then (no else)",
          stepIndex: idx,
        });
        // Skip then-block; land on else (or rejoin if elseN=0).
        idx = idx + 1 + thenN;
        continue;
      }
      if (step.type === "send_webhook") {
        await doWebhook(step, context);
        recordStepAudit(context, { type: "send_webhook", status: "ok", stepIndex: idx });
        idx++;
        continue;
      }
      if (step.type === "schedule_callback") {
        await doScheduleCallback(workflow.userId, step, context);
        recordStepAudit(context, { type: "schedule_callback", status: "ok", stepIndex: idx });
        idx++;
        continue;
      }
      if (step.type === "send_whatsapp") {
        await doSendWhatsapp(workflow.userId, step, context, idx);
        idx++;
        continue;
      }
      if (step.type === "send_email") {
        await doSendEmail(workflow.userId, step, context, idx);
        idx++;
        continue;
      }
      if (step.type === "join_meeting") {
        await doJoinMeeting(workflow.userId, step, context, idx);
        idx++;
        continue;
      }
      if (step.type === "update_sheet") {
        await doUpdateSheet(workflow.userId, step, context, idx);
        idx++;
        continue;
      }
      // Unknown step type — skip.
      recordStepAudit(context, {
        type: step.type,
        status: "skipped",
        reason: "Unknown step type",
        stepIndex: idx,
      });
      idx++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ runId, stepIdx: idx, err }, "workflow: step failed");
      recordStepAudit(context, {
        type: step.type,
        status: "failed",
        reason: msg,
        stepIndex: idx,
      });
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

  const squadId =
    typeof step.squadId === "number" && Number.isInteger(step.squadId) && step.squadId > 0
      ? step.squadId
      : null;
  let campaign = await getOrCreateWorkflowCampaign(userId, step.agentId, squadId);
  let hours: {
    isCallingHoursEnabled?: boolean;
    businessHoursStart?: number | null;
    businessHoursEnd?: number | null;
    timezone?: string | null;
  } | null = null;
  const planIdRaw = context["callPlanId"];
  const planId = typeof planIdRaw === "number" ? planIdRaw : Number(planIdRaw);
  if (Number.isFinite(planId) && planId > 0) {
    const [plan] = await db.select({ settings: journeysTable.settings })
      .from(journeysTable)
      .where(and(eq(journeysTable.id, planId), eq(journeysTable.userId, userId)))
      .limit(1);
    if (plan?.settings) {
      const s = plan.settings as {
        isCallingHoursEnabled?: boolean;
        businessHoursStart?: number | null;
        businessHoursEnd?: number | null;
        timezone?: string | null;
      };
      hours = {
        isCallingHoursEnabled: s.isCallingHoursEnabled,
        businessHoursStart: s.businessHoursStart,
        businessHoursEnd: s.businessHoursEnd,
        timezone: s.timezone,
      };
    }
  }
  campaign = await syncWorkflowCampaignConcurrency(campaign, userId, hours);
  const batch = await getOrCreateWorkflowRunningBatch(campaign.id);
  const leadData = flattenPrimitives(context);
  const sheetKeys = await sheetKeysForLead(userId, step.agentId, phoneRaw);
  Object.assign(context, sheetKeys);
  const [lead] = await db.insert(campaignLeadsTable).values({
    campaignId: campaign.id,
    batchId: batch.id,
    phone: phoneRaw,
    normalizedPhone: normalizePhone(phoneRaw),
    name: toStr(context["name"]) || null,
    email: toStr(context["email"]) || null,
    leadData: {
      ...leadData,
      __workflowRunId: String(runId),
      ...(squadId ? { __squad_id: String(squadId) } : {}),
      ...sheetKeys,
    },
    callStatus: "pending",
    source: "workflow",
  }).returning();

  await db.update(campaignBatchesTable)
    .set({ totalLeads: sql`${campaignBatchesTable.totalLeads} + 1` })
    .where(eq(campaignBatchesTable.id, batch.id));

  // Park BEFORE dialing — campaign rolling refill claims up to concurrentLimit.
  recordStepAudit(context, { type: "make_call", status: "ok", reason: "Queued for dial", stepIndex: idx });
  await db.update(workflowRunsTable)
    .set({ status: "waiting_call", leadId: lead!.id, currentStepIndex: idx + 1, context, updatedAt: new Date() })
    .where(eq(workflowRunsTable.id, runId));

  await refillWorkflowDialSlots(userId, campaign.id);
  logger.info(
    { runId, leadId: lead!.id, agentId: step.agentId, squadId, batchId: batch.id, campaignId: campaign.id },
    "workflow: make_call enqueued on campaign batch",
  );
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
      } else if (lead.callStatus === "pending") {
        // Still in the account dial queue — never treat as timeout/no-answer.
        continue;
      }

      // Backstop: only for leads that actually started dialing (or have a call).
      if (!result && ageMs > CALL_TIMEOUT_MS && lead.callStatus !== "pending") {
        result = { connected: false, status: "timeout" };
      }
      if (!result) continue; // still in progress — check again next tick

      if (await claimRun(run.id, "waiting_call")) {
        const context = { ...(run.context ?? {}), call: result };
        recordStepAudit(context, {
          type: "make_call",
          status: result.connected === true ? "ok" : "skipped",
          reason: result.connected === true ? "Connected" : "No answer / not connected",
        });
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
  recordStepAudit(context, {
    type: "delay",
    status: "ok",
    reason: `Wait ${secs}s`,
    stepIndex: idx,
  });
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
  await fetchUserConfiguredUrl(step.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "SnapServe-Workflows/1.0" },
    body: JSON.stringify(context),
  }, { timeoutMs: 10_000, retries: 2 }).catch((err) => { throw new Error(`webhook POST failed: ${err?.message ?? err}`); });
}

async function doScheduleCallback(userId: string, step: WorkflowStep, context: Ctx): Promise<void> {
  const agentId = step.agentId;
  if (!agentId) throw new Error("schedule_callback missing agentId");
  const phoneRaw = toStr(getPath(context, step.phoneField ?? "phone") || context["phone"]);
  if (!phoneRaw.trim()) throw new Error("schedule_callback: no phone number in context");

  const days = Math.max(0, Number(step.callbackDelayDays ?? 0));
  const secs = Math.max(0, Number(step.delaySeconds ?? 0));
  const delayMs = days > 0 ? days * 86_400_000 : secs * 1000;
  const scheduledAt = new Date(Date.now() + Math.max(delayMs, 60_000)); // at least 1 min out

  const callObj = (context["call"] && typeof context["call"] === "object")
    ? (context["call"] as Record<string, unknown>)
    : {};
  const callId = typeof callObj["callId"] === "number" ? callObj["callId"] : null;

  const id = await scheduleCallbackRequested({
    agentId,
    toNumber: phoneRaw,
    userId,
    callId,
    scheduledAt,
    notes: step.notes ?? "Journey schedule_callback",
  });
  logger.info({ agentId, phone: phoneRaw, scheduledAt, callbackId: id }, "workflow: schedule_callback queued");
}

async function doSendWhatsapp(
  userId: string,
  step: WorkflowStep,
  context: Ctx,
  stepIndex?: number,
): Promise<void> {
  const phoneRaw = toStr(getPath(context, step.phoneField ?? "phone") || context["phone"]);
  if (!phoneRaw.trim()) throw new Error("send_whatsapp: no phone number in context");

  const channel = await getActiveChannel(userId);
  if (!channel) {
    logger.warn({ userId }, "workflow: send_whatsapp skipped — no active WhatsApp channel");
    recordStepAudit(context, {
      type: "send_whatsapp",
      status: "skipped",
      reason: "WhatsApp not connected",
      stepIndex,
    });
    return;
  }

  const ctx = await resolveSendContext(channel, () => getOwnCredsForUser(userId));
  if ("error" in ctx) {
    logger.warn({ userId, err: ctx.error }, "workflow: send_whatsapp skipped — send context error");
    recordStepAudit(context, {
      type: "send_whatsapp",
      status: "skipped",
      reason: String(ctx.error),
      stepIndex,
    });
    return;
  }

  const callObj = (context["call"] && typeof context["call"] === "object")
    ? (context["call"] as Record<string, unknown>)
    : {};
  const hint = (step.whatsappHint ?? "call_summary") as TemplateHint;
  const name = toStr(context["name"]) || "there";
  const summary = toStr(callObj["summary"]) || toStr(callObj["success"]) || "Thanks for speaking with us.";
  const defaultParams =
    hint === "booking_confirmed"
      ? [name, "your appointment", "as scheduled"]
      : hint === "callback_scheduled"
        ? [name, "soon"]
        : [name, summary.slice(0, 120)];
  const rawParams = (step.whatsappParams?.length ? step.whatsappParams : defaultParams).map(String);
  const params = rawParams.map((p) => interpolateTemplate(p, context));
  const callId = typeof callObj["callId"] === "number" ? callObj["callId"] : null;

  const agentIdRaw = typeof step.agentId === "number" && step.agentId > 0
    ? step.agentId
    : Number(context["agentId"] ?? callObj["agentId"] ?? 0);
  // Explicit catalog pick on the step wins — any Meta/VoBiz template name.
  const explicit = step.whatsappTemplate;
  const templateOverride = explicit?.name && explicit.language
    ? { name: explicit.name.trim(), lang: explicit.language.trim() }
    : undefined;
  const result = await sendWhatsappTemplate({
    channel,
    ctx,
    toPhone: phoneRaw,
    hint,
    params,
    callId,
    agentId: Number.isFinite(agentIdRaw) && agentIdRaw > 0 ? agentIdRaw : null,
    templateOverride,
  });
  if (!result.ok && !result.skipped) {
    throw new Error(result.error ?? "send_whatsapp failed");
  }
  if (result.skipped) {
    recordStepAudit(context, {
      type: "send_whatsapp",
      status: "skipped",
      reason: result.error ?? "Template send skipped",
      stepIndex,
    });
  } else {
    recordStepAudit(context, { type: "send_whatsapp", status: "sent", stepIndex });
  }
  logger.info({ userId, hint, ok: result.ok, skipped: result.skipped }, "workflow: send_whatsapp done");
}

async function doSendEmail(
  userId: string,
  step: WorkflowStep,
  context: Ctx,
  stepIndex?: number,
): Promise<void> {
  const to = toStr(getPath(context, step.emailField ?? "email") || context["email"]);
  if (!to.trim()) {
    logger.warn({ userId }, "workflow: send_email skipped — no email in context");
    recordStepAudit(context, {
      type: "send_email",
      status: "skipped",
      reason: "No email on person",
      stepIndex,
    });
    return;
  }
  const callObj = (context["call"] && typeof context["call"] === "object")
    ? (context["call"] as Record<string, unknown>)
    : {};
  const callId = typeof callObj["callId"] === "number" ? callObj["callId"] : null;

  const result = await sendChannelEmail({
    userId,
    toEmail: to,
    context: {
      ...context,
      summary: toStr(callObj["summary"] || context["summary"] || ""),
      agent_name: toStr(context["agent_name"] || ""),
    },
    template: (step.emailSubject || step.emailBody)
      ? {
          subject: step.emailSubject || "Follow-up",
          body: step.emailBody || "<p>Hi {{name}}</p><p>{{summary}}</p>",
        }
      : null,
    callId,
    journeyRunHint: "workflow_send_email",
  });

  if (!result.ok && !result.skipped) {
    throw new Error(result.error ?? "send_email failed");
  }
  if (result.skipped) {
    recordStepAudit(context, {
      type: "send_email",
      status: "skipped",
      reason: result.error ?? "Email channel inactive",
      stepIndex,
    });
  } else {
    recordStepAudit(context, { type: "send_email", status: "sent", stepIndex });
  }
  logger.info({ userId, ok: result.ok, skipped: result.skipped }, "workflow: send_email done");
}

async function doJoinMeeting(
  userId: string,
  step: WorkflowStep,
  context: Ctx,
  stepIndex?: number,
): Promise<void> {
  const field = step.meetingUrlField?.trim();
  const meetingUrl = toStr(
    (field ? getPath(context, field) : undefined)
      || context["meetingUrl"]
      || context["meetLink"]
      || context["meeting_url"]
      || context["meet_link"]
      || "",
  ).trim();
  if (!meetingUrl) {
    logger.warn({ userId }, "workflow: join_meeting skipped — no meeting URL in context");
    recordStepAudit(context, {
      type: "join_meeting",
      status: "skipped",
      reason: "No meeting URL on person",
      stepIndex,
    });
    return;
  }
  if (!process.env["RECALL_API_KEY"]) {
    throw new Error("Meeting bots are not configured (missing Recall API key)");
  }

  const configuredAgentId =
    typeof step.agentId === "number" && step.agentId > 0
      ? step.agentId
      : Number(context["agentId"] ?? 0);
  if (!Number.isInteger(configuredAgentId) || configuredAgentId <= 0) {
    throw new Error("join_meeting step missing agentId");
  }

  const result = await launchMeetingBotForAgent({
    userId,
    configuredAgentId,
    meetingUrl,
  });
  context["meetingBotId"] = result.botId;
  context["meetingRuntimeAgentId"] = result.runtimeAgentId;
  recordStepAudit(context, { type: "join_meeting", status: "joined", stepIndex });
  logger.info(
    { userId, botId: result.botId, agentId: result.runtimeAgentId },
    "workflow: join_meeting dispatched",
  );
}

async function doUpdateSheet(
  userId: string,
  step: WorkflowStep,
  context: Ctx,
  stepIndex?: number,
): Promise<void> {
  const pipelineId = toStr(
    context["__sheet_pipeline_id"]
      || context["sheetPipelineId"]
      || context["sheet_pipeline_id"]
      || "",
  ).trim();
  const rowRaw = context["__sheet_row_index"] ?? context["sheetRowIndex"] ?? context["sheet_row_index"];
  const sheetRowIndex = typeof rowRaw === "number" ? rowRaw : Number(rowRaw);
  if (!pipelineId || !Number.isFinite(sheetRowIndex) || sheetRowIndex < 2) {
    logger.warn({ userId, pipelineId, sheetRowIndex }, "workflow: update_sheet skipped — no sheet row in context");
    recordStepAudit(context, {
      type: "update_sheet",
      status: "skipped",
      reason: "No sheet row on this person",
      stepIndex,
    });
    return;
  }

  const [pipeline] = await db.select().from(sheetAutoCallPipelinesTable)
    .where(and(
      eq(sheetAutoCallPipelinesTable.id, pipelineId),
      eq(sheetAutoCallPipelinesTable.userId, userId),
    ))
    .limit(1);
  if (!pipeline) {
    logger.warn({ userId, pipelineId }, "workflow: update_sheet skipped — pipeline not found");
    recordStepAudit(context, {
      type: "update_sheet",
      status: "skipped",
      reason: "Sheet pipeline not found",
      stepIndex,
    });
    return;
  }

  const callObj = (context["call"] && typeof context["call"] === "object")
    ? (context["call"] as Record<string, unknown>)
    : {};
  const col = (step.sheetStatusColumn?.trim() || "Status");
  const value = (
    step.sheetStatusValue?.trim()
    || toStr(callObj["disposition"] || callObj["status"] || context["disposition"] || "")
    || "Updated"
  ).slice(0, 200);

  await updateSheetRowByIndex(
    userId,
    pipeline.connectionId,
    pipeline.spreadsheetId,
    pipeline.sheetName,
    sheetRowIndex,
    { [col]: value },
  );
  recordStepAudit(context, { type: "update_sheet", status: "ok", reason: `${col}=${value}`, stepIndex });
  logger.info({ userId, pipelineId, sheetRowIndex, col, value }, "workflow: update_sheet done");
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
