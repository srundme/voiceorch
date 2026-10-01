/**
 * Flows event triggers: inbound / missed call, WhatsApp reply, schedule.
 * Each fires only for ACTIVE journeys whose trigger matches.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  journeysTable,
  workflowsTable,
  workflowRunsTable,
  ACTIVE_RUN_STATUSES,
  type Journey,
  type JourneySettings,
  type WorkflowTriggerType,
} from "@workspace/db";
import { logger } from "../lib/logger.js";
import { normalizePhone } from "../lib/phone-normalize.js";
import { resumeWaitingReplyRuns, startWorkflowRun } from "./workflow-engine.js";
import { feedCallPlanQueue } from "./call-plan-queue-feed.js";
import { isScheduleDue } from "./flow-time.js";

async function activeFlowsWithTrigger(type: WorkflowTriggerType, userId?: string): Promise<Journey[]> {
  return db.select().from(journeysTable).where(and(
    eq(journeysTable.status, "active"),
    sql`${journeysTable.trigger} ->> 'type' = ${type}`,
    ...(userId ? [eq(journeysTable.userId, userId)] : []),
  ));
}

async function hasActiveRunForPhone(workflowId: number, phone: string): Promise<boolean> {
  const norm = normalizePhone(phone);
  const rows = await db.select({ context: workflowRunsTable.context }).from(workflowRunsTable)
    .where(and(
      eq(workflowRunsTable.workflowId, workflowId),
      inArray(workflowRunsTable.status, [...ACTIVE_RUN_STATUSES]),
    ))
    .limit(2000);
  return rows.some((r) => {
    const p = typeof r.context?.["phone"] === "string" ? r.context["phone"] : "";
    return (normalizePhone(p) || p) === (norm || phone);
  });
}

async function startForJourney(journey: Journey, context: Record<string, unknown>, triggeredBy: string): Promise<number | null> {
  if (!journey.workflowId) return null;
  const [workflow] = await db.select().from(workflowsTable)
    .where(and(eq(workflowsTable.id, journey.workflowId), eq(workflowsTable.userId, journey.userId)))
    .limit(1);
  if (!workflow) return null;
  return startWorkflowRun({
    workflow,
    context: { ...context, callPlanId: journey.id, agentId: journey.agentId },
    triggeredBy,
  });
}

/** "Missed" = the caller hung up before a single conversation turn. */
export async function fireCallEndedFlows(input: {
  userId: string;
  agentId: number;
  callId: number;
  phone: string;
  missed: boolean;
  status: string;
  durationSeconds: number;
  summary: string;
  disposition: Record<string, unknown>;
  transcript: string;
}): Promise<void> {
  const flows = (await activeFlowsWithTrigger("call_ended", input.userId))
    .filter((j) => j.agentId === input.agentId && (!j.trigger.missedOnly || input.missed));
  for (const journey of flows) {
    try {
      if (journey.workflowId && await hasActiveRunForPhone(journey.workflowId, input.phone)) continue;
      const runId = await startForJourney(journey, {
        phone: input.phone,
        call: {
          connected: !input.missed,
          missed: input.missed,
          status: input.status,
          duration: input.durationSeconds,
          summary: input.summary,
          disposition: input.disposition,
          transcript: input.transcript,
          callId: input.callId,
        },
      }, input.missed ? "missed_call" : "inbound_call");
      logger.info({ journeyId: journey.id, runId, callId: input.callId }, "flows: call-ended trigger started run");
    } catch (err) {
      logger.warn({ err, journeyId: journey.id }, "flows: call-ended trigger failed");
    }
  }
}

/** Comma-separated alternatives, case-insensitive "contains". Empty = any message. */
export function matchesReplyKeyword(keyword: string | undefined, text: string, buttonId?: string | null): boolean {
  const words = (keyword ?? "").split(",").map((w) => w.trim().toLowerCase()).filter(Boolean);
  if (words.length === 0) return true;
  const hay = `${text} ${buttonId ?? ""}`.toLowerCase();
  return words.some((w) => hay.includes(w));
}

export async function onInboundWhatsappForFlows(input: {
  userId: string;
  phone: string;
  text: string;
  buttonId: string | null;
}): Promise<void> {
  await resumeWaitingReplyRuns(input.userId, input.phone, {
    text: input.text,
    ...(input.buttonId ? { buttonId: input.buttonId } : {}),
  });

  const flows = (await activeFlowsWithTrigger("whatsapp_reply", input.userId))
    .filter((j) => matchesReplyKeyword(j.trigger.keyword, input.text, input.buttonId));
  for (const journey of flows) {
    try {
      if (journey.workflowId && await hasActiveRunForPhone(journey.workflowId, input.phone)) continue;
      const runId = await startForJourney(journey, {
        phone: input.phone,
        reply: { received: true, text: input.text, buttonId: input.buttonId ?? "" },
      }, "whatsapp_reply");
      logger.info({ journeyId: journey.id, runId }, "flows: WhatsApp reply trigger started run");
    } catch (err) {
      logger.warn({ err, journeyId: journey.id }, "flows: WhatsApp reply trigger failed");
    }
  }
}

/** Worker: start due schedules — feeds the flow's people list once per scheduled day. */
export async function tickScheduledFlows(now = new Date()): Promise<void> {
  const flows = await activeFlowsWithTrigger("schedule");
  for (const journey of flows) {
    const settings = (journey.settings ?? {}) as JourneySettings;
    const { due, localDate } = isScheduleDue(journey.trigger.schedule, now, settings.scheduleLastFiredOn);
    if (!due || !journey.workflowId) continue;
    const force = journey.trigger.schedule?.reincludePeople === true;
    const nextSettings: JourneySettings = {
      ...settings,
      scheduleLastFiredOn: localDate,
      runMode: "once",
      autoFeed: true,
      startOffset: 0,
      feedForce: force,
    };
    try {
      const [updated] = await db.update(journeysTable)
        .set({ settings: nextSettings, updatedAt: new Date() })
        .where(and(
          eq(journeysTable.id, journey.id),
          sql`coalesce(${journeysTable.settings} ->> 'scheduleLastFiredOn', '') <> ${localDate}`,
        ))
        .returning();
      if (!updated) continue;
      const result = await feedCallPlanQueue(updated, { force, skipActive: true });
      logger.info({ journeyId: journey.id, started: result.started, localDate }, "flows: schedule fired");
    } catch (err) {
      logger.warn({ err, journeyId: journey.id }, "flows: schedule tick failed");
    }
  }
}
