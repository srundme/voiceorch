import {
  db,
  agentsTable,
  agentTasksTable,
  agentTaskMessagesTable,
  agentTaskStepsTable,
  agentTaskCandidatesTable,
  agentTaskCallsTable,
  phoneNumbersTable,
  type AgentTask,
  type AgentTaskDialPolicy,
  type AgentTaskPrefs,
  type AgentTaskCandidate,
} from "@workspace/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { isOnDnc } from "../lib/dnc-check.js";
import { runSkill, type BusinessCandidate } from "./task-skills/index.js";
import { parseTaskGoal, buildTaskBrief } from "./task-goal.js";

export { parseTaskGoal, buildTaskBrief } from "./task-goal.js";

const MAX_CANDIDATES = 8;
const MAX_DIAL_ATTEMPTS = 3;
const MAX_ACTIVE_TASKS_PER_USER = 20;
const MAX_LOOKUPS_PER_HOUR = 30;

export class TaskOrchestratorError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "TaskOrchestratorError";
  }
}

export type TaskDetail = {
  task: AgentTask;
  messages: Array<typeof agentTaskMessagesTable.$inferSelect>;
  steps: Array<typeof agentTaskStepsTable.$inferSelect>;
  candidates: AgentTaskCandidate[];
  calls: Array<typeof agentTaskCallsTable.$inferSelect>;
};

function titleFromGoal(goal: string): string {
  const t = goal.trim().replace(/\s+/g, " ");
  return t.length > 72 ? `${t.slice(0, 69)}…` : t || "New task";
}

export async function assertAgentEligibleForTasks(userId: string, agentId: number): Promise<typeof agentsTable.$inferSelect> {
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId)).limit(1);
  if (!agent) throw new TaskOrchestratorError("Agent not found", "AGENT_NOT_FOUND", 404);
  if (agent.userId !== userId) throw new TaskOrchestratorError("Forbidden", "FORBIDDEN", 403);

  const hasOutboundNumber = !!agent.outboundPhoneNumberId;
  let numberOk = hasOutboundNumber;
  if (agent.outboundPhoneNumberId) {
    const [pn] = await db
      .select({ id: phoneNumbersTable.id, number: phoneNumbersTable.number })
      .from(phoneNumbersTable)
      .where(eq(phoneNumbersTable.id, agent.outboundPhoneNumberId))
      .limit(1);
    numberOk = !!pn?.number;
  }

  // Allow managed telephony without assigned number (platform pool) — still require agent exists.
  // Soft-require outbound capability: warn via error only when clearly inbound-only with no number and no telephony.
  if (!agent.telephonyProvider) {
    throw new TaskOrchestratorError(
      "This agent has no telephony provider. Configure telephony before using Tasks.",
      "AGENT_NO_TELEPHONY",
      400,
    );
  }

  if (!numberOk && !hasOutboundNumber) {
    // Still allow — managed Vobiz can dial without assigned number; surface as soft note in logs
    logger.info({ agentId, userId }, "Task agent has no assigned outbound number — managed pool may be used");
  }

  return agent;
}

async function enforceRateLimits(userId: string): Promise<void> {
  const [active] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(agentTasksTable)
    .where(
      and(
        eq(agentTasksTable.userId, userId),
        inArray(agentTasksTable.status, ["draft", "running", "awaiting_approval", "calling"]),
      ),
    );
  if ((active?.c ?? 0) >= MAX_ACTIVE_TASKS_PER_USER) {
    throw new TaskOrchestratorError(
      `Too many active tasks (max ${MAX_ACTIVE_TASKS_PER_USER}). Complete or cancel some first.`,
      "RATE_LIMIT_ACTIVE",
      429,
    );
  }

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const [lookups] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(agentTaskStepsTable)
    .innerJoin(agentTasksTable, eq(agentTaskStepsTable.taskId, agentTasksTable.id))
    .where(
      and(
        eq(agentTasksTable.userId, userId),
        eq(agentTaskStepsTable.type, "lookup"),
        sql`${agentTaskStepsTable.createdAt} >= ${hourAgo}`,
      ),
    );
  if ((lookups?.c ?? 0) >= MAX_LOOKUPS_PER_HOUR) {
    throw new TaskOrchestratorError(
      `Lookup rate limit reached (${MAX_LOOKUPS_PER_HOUR}/hour). Try again later.`,
      "RATE_LIMIT_LOOKUP",
      429,
    );
  }
}

export async function appendMessage(
  taskId: number,
  role: "user" | "assistant" | "system",
  content: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  await db.insert(agentTaskMessagesTable).values({
    taskId,
    role,
    content,
    meta: meta ?? null,
  });
  await db.update(agentTasksTable).set({ updatedAt: new Date() }).where(eq(agentTasksTable.id, taskId));
}

export async function getTaskDetail(userId: string, taskId: number): Promise<TaskDetail> {
  const [task] = await db
    .select()
    .from(agentTasksTable)
    .where(and(eq(agentTasksTable.id, taskId), eq(agentTasksTable.userId, userId)))
    .limit(1);
  if (!task) throw new TaskOrchestratorError("Task not found", "NOT_FOUND", 404);

  const [messages, steps, candidates, calls] = await Promise.all([
    db.select().from(agentTaskMessagesTable).where(eq(agentTaskMessagesTable.taskId, taskId)).orderBy(asc(agentTaskMessagesTable.createdAt)),
    db.select().from(agentTaskStepsTable).where(eq(agentTaskStepsTable.taskId, taskId)).orderBy(asc(agentTaskStepsTable.stepIndex)),
    db.select().from(agentTaskCandidatesTable).where(eq(agentTaskCandidatesTable.taskId, taskId)).orderBy(asc(agentTaskCandidatesTable.rank)),
    db.select().from(agentTaskCallsTable).where(eq(agentTaskCallsTable.taskId, taskId)).orderBy(desc(agentTaskCallsTable.createdAt)),
  ]);

  return { task, messages, steps, candidates, calls };
}

export async function createTask(opts: {
  userId: string;
  agentId: number;
  goal: string;
  dialPolicy?: AgentTaskDialPolicy;
  prefs?: AgentTaskPrefs;
}): Promise<TaskDetail> {
  await enforceRateLimits(opts.userId);
  await assertAgentEligibleForTasks(opts.userId, opts.agentId);

  const prefs = parseTaskGoal(opts.goal, opts.prefs ?? {});
  const dialPolicy = opts.dialPolicy === "auto" ? "auto" : "approval";

  const [task] = await db
    .insert(agentTasksTable)
    .values({
      userId: opts.userId,
      agentId: opts.agentId,
      title: titleFromGoal(opts.goal),
      goal: opts.goal.trim(),
      status: "running",
      dialPolicy,
      prefs,
    })
    .returning();

  await db.insert(agentTaskStepsTable).values([
    { taskId: task!.id, stepIndex: 0, type: "lookup", status: "pending" },
    { taskId: task!.id, stepIndex: 1, type: "await_approval", status: "pending" },
    { taskId: task!.id, stepIndex: 2, type: "outbound_call", status: "pending" },
    { taskId: task!.id, stepIndex: 3, type: "summarize", status: "pending" },
  ]);

  await appendMessage(task!.id, "user", opts.goal.trim());
  await appendMessage(
    task!.id,
    "assistant",
    `Got it — I'll look up public listings for “${prefs.query}”${prefs.location ? ` near ${prefs.location}` : ""}. Dial policy: ${dialPolicy === "auto" ? "auto-call top match" : "ask you before calling"}.`,
  );

  logger.info(
    { evt: "agent_task_created", taskId: task!.id, userId: opts.userId, agentId: opts.agentId, dialPolicy },
    "Agent task created",
  );

  await runLookupStep(opts.userId, task!.id);
  return getTaskDetail(opts.userId, task!.id);
}

async function setStepStatus(
  taskId: number,
  type: "lookup" | "await_approval" | "outbound_call" | "summarize",
  status: "pending" | "running" | "waiting" | "completed" | "failed" | "skipped",
  result?: Record<string, unknown>,
): Promise<void> {
  await db
    .update(agentTaskStepsTable)
    .set({ status, ...(result ? { result } : {}), updatedAt: new Date() })
    .where(and(eq(agentTaskStepsTable.taskId, taskId), eq(agentTaskStepsTable.type, type)));
}

export async function runLookupStep(userId: string, taskId: number): Promise<TaskDetail> {
  const detail = await getTaskDetail(userId, taskId);
  const { task } = detail;
  if (task.status === "cancelled" || task.status === "completed") return detail;

  await db.update(agentTasksTable).set({ status: "running" }).where(eq(agentTasksTable.id, taskId));
  await setStepStatus(taskId, "lookup", "running");

  const prefs = (task.prefs ?? {}) as AgentTaskPrefs;
  const parsed = parseTaskGoal(task.goal, prefs);

  try {
    const candidates = await runSkill<
      { query: string; location?: string; lat?: number; lng?: number; radiusMeters?: number; limit?: number },
      BusinessCandidate[]
    >(
      "public_business_lookup",
      {
        query: parsed.query || "business",
        location: parsed.location,
        lat: parsed.lat,
        lng: parsed.lng,
        radiusMeters: parsed.radiusMeters,
        limit: Math.min(parsed.maxCandidates ?? 5, MAX_CANDIDATES),
      },
      { userId, taskId },
    );

    await db.delete(agentTaskCandidatesTable).where(eq(agentTaskCandidatesTable.taskId, taskId));
    if (candidates.length) {
      await db.insert(agentTaskCandidatesTable).values(
        candidates.map((c) => ({
          taskId,
          name: c.name,
          phone: c.phone,
          address: c.address,
          sourceUrl: c.sourceUrl,
          placeId: c.placeId,
          rank: c.rank,
          selected: false,
          meta: c.meta ?? {},
        })),
      );
    }

    await setStepStatus(taskId, "lookup", "completed", { count: candidates.length });

    const withPhone = candidates.filter((c) => c.phone);
    if (!withPhone.length) {
      await db
        .update(agentTasksTable)
        .set({
          status: "failed",
          errorMessage: "No public phone numbers found for this search.",
          resultSummary: "Lookup finished with no dialable numbers.",
        })
        .where(eq(agentTasksTable.id, taskId));
      await appendMessage(
        taskId,
        "assistant",
        "I couldn't find publicly listed phone numbers for that search. Try a more specific business type or location.",
      );
      await setStepStatus(taskId, "await_approval", "skipped");
      await setStepStatus(taskId, "outbound_call", "skipped");
      await setStepStatus(taskId, "summarize", "completed", { reason: "no_phones" });
      return getTaskDetail(userId, taskId);
    }

    const listText = withPhone
      .map((c, i) => `${i + 1}. ${c.name}${c.phone ? ` — ${c.phone}` : ""}${c.address ? `\n   ${c.address}` : ""}`)
      .join("\n");

    if (task.dialPolicy === "approval") {
      await setStepStatus(taskId, "await_approval", "waiting");
      await db.update(agentTasksTable).set({ status: "awaiting_approval" }).where(eq(agentTasksTable.id, taskId));
      await appendMessage(
        taskId,
        "assistant",
        `Here are public listings I found:\n\n${listText}\n\nPick one to call (reply with the number or use Approve), or change your search.`,
        { candidates: withPhone },
      );
    } else {
      await setStepStatus(taskId, "await_approval", "skipped");
      await appendMessage(
        taskId,
        "assistant",
        `Found ${withPhone.length} listings. Auto-dial is on — calling the top match with a public number.\n\n${listText}`,
        { candidates: withPhone },
      );
      const top = withPhone[0]!;
      // Mark selected by phone match after reload
      const refreshed = await getTaskDetail(userId, taskId);
      const match = refreshed.candidates.find((c) => c.phone === top.phone) ?? refreshed.candidates[0];
      if (match) {
        await selectCandidateAndPrepareDial(userId, taskId, match.id);
      }
    }

    return getTaskDetail(userId, taskId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, taskId, userId }, "Task lookup failed");
    await setStepStatus(taskId, "lookup", "failed", { error: msg });
    await db
      .update(agentTasksTable)
      .set({ status: "failed", errorMessage: msg })
      .where(eq(agentTasksTable.id, taskId));
    await appendMessage(taskId, "assistant", `Lookup failed: ${msg}`);
    return getTaskDetail(userId, taskId);
  }
}

export async function selectCandidateAndPrepareDial(
  userId: string,
  taskId: number,
  candidateId: number,
): Promise<{ taskId: number; candidate: AgentTaskCandidate; taskBrief: string }> {
  const detail = await getTaskDetail(userId, taskId);
  const candidate = detail.candidates.find((c) => c.id === candidateId);
  if (!candidate) throw new TaskOrchestratorError("Candidate not found", "CANDIDATE_NOT_FOUND", 404);
  if (!candidate.phone) {
    throw new TaskOrchestratorError("This listing has no public phone number", "NO_PHONE", 400);
  }

  const onDnc = await isOnDnc(userId, candidate.phone);
  if (onDnc) {
    throw new TaskOrchestratorError("This number is on your Do Not Call list", "DNC_BLOCKED", 403);
  }

  const maxAttempts = (detail.task.prefs as AgentTaskPrefs)?.maxDialAttempts ?? MAX_DIAL_ATTEMPTS;
  if (detail.task.dialAttempts >= maxAttempts) {
    throw new TaskOrchestratorError(`Max dial attempts (${maxAttempts}) reached for this task`, "MAX_DIALS", 400);
  }

  await db
    .update(agentTaskCandidatesTable)
    .set({ selected: false })
    .where(eq(agentTaskCandidatesTable.taskId, taskId));
  await db
    .update(agentTaskCandidatesTable)
    .set({ selected: true })
    .where(eq(agentTaskCandidatesTable.id, candidateId));

  await setStepStatus(taskId, "await_approval", "completed", { candidateId });
  await setStepStatus(taskId, "outbound_call", "running", { candidateId, phone: candidate.phone });
  await db.update(agentTasksTable).set({ status: "calling" }).where(eq(agentTasksTable.id, taskId));

  const prefs = (detail.task.prefs ?? {}) as AgentTaskPrefs;
  const taskBrief = buildTaskBrief({
    goal: detail.task.goal,
    businessName: candidate.name,
    businessPhone: candidate.phone,
    businessAddress: candidate.address,
    timePrefs: prefs.timePrefs,
  });

  await appendMessage(
    taskId,
    "assistant",
    `Calling ${candidate.name} at ${candidate.phone}…`,
    { candidateId, phone: candidate.phone },
  );

  logger.info(
    { evt: "agent_task_dial_prepare", taskId, userId, candidateId, phone: candidate.phone },
    "Task dial prepared",
  );

  return { taskId, candidate, taskBrief };
}

/** Record that an outbound call was started for this task. */
export async function recordTaskCallStarted(opts: {
  taskId: number;
  callId: number;
  candidateId: number;
  toNumber: string;
}): Promise<void> {
  await db.insert(agentTaskCallsTable).values({
    taskId: opts.taskId,
    callId: opts.callId,
    candidateId: opts.candidateId,
    toNumber: opts.toNumber,
    outcome: "ringing",
  });
  await db
    .update(agentTasksTable)
    .set({ dialAttempts: sql`${agentTasksTable.dialAttempts} + 1`, status: "calling" })
    .where(eq(agentTasksTable.id, opts.taskId));
}

/**
 * Called when a call linked to an agent task ends.
 */
export async function onAgentTaskCallEnded(opts: {
  callId: number;
  agentTaskId: number;
  summary?: string | null;
  disposition?: Record<string, unknown> | null;
  amdResult?: string | null;
  successEvaluation?: string | null;
}): Promise<void> {
  const [task] = await db.select().from(agentTasksTable).where(eq(agentTasksTable.id, opts.agentTaskId)).limit(1);
  if (!task) return;
  if (task.status === "cancelled" || task.status === "completed") return;

  const outcome = deriveOutcome(opts);
  const summary =
    opts.summary?.trim() ||
    (typeof opts.successEvaluation === "string" ? opts.successEvaluation : null) ||
    `Call ended (${outcome}).`;

  await db
    .update(agentTaskCallsTable)
    .set({ outcome, summary, updatedAt: new Date() })
    .where(and(eq(agentTaskCallsTable.taskId, opts.agentTaskId), eq(agentTaskCallsTable.callId, opts.callId)));

  const success = outcome === "booked" || outcome === "completed" || outcome === "human_reached";

  if (success || outcome === "no_availability" || outcome === "declined") {
    await setStepStatus(opts.agentTaskId, "outbound_call", "completed", { outcome, callId: opts.callId });
    await setStepStatus(opts.agentTaskId, "summarize", "completed", { outcome });
    await db
      .update(agentTasksTable)
      .set({ status: "completed", resultSummary: summary })
      .where(eq(agentTasksTable.id, opts.agentTaskId));
    await appendMessage(
      opts.agentTaskId,
      "assistant",
      `Call finished (${outcome}).\n\n${summary}\n\nOpen Call #${opts.callId} in Call Logs for the full recording/transcript.`,
      { callId: opts.callId, outcome },
    );
    return;
  }

  // Retry path for no-answer / wrong number when auto or more candidates exist
  const prefs = (task.prefs ?? {}) as AgentTaskPrefs;
  const maxAttempts = prefs.maxDialAttempts ?? MAX_DIAL_ATTEMPTS;
  const candidates = await db
    .select()
    .from(agentTaskCandidatesTable)
    .where(eq(agentTaskCandidatesTable.taskId, opts.agentTaskId))
    .orderBy(asc(agentTaskCandidatesTable.rank));
  const selected = candidates.find((c) => c.selected);
  const next = candidates.find((c) => c.phone && c.id !== selected?.id && !c.selected);

  if (task.dialPolicy === "auto" && next && task.dialAttempts < maxAttempts && (outcome === "no_answer" || outcome === "wrong_number" || outcome === "voicemail")) {
    await appendMessage(
      opts.agentTaskId,
      "assistant",
      `That call ended (${outcome}). Trying next listing: ${next.name}…`,
    );
    // Leave status calling — API/UI or a follow-up message can dial next; mark awaiting if approval needed
    await db.update(agentTasksTable).set({ status: "awaiting_approval" }).where(eq(agentTasksTable.id, opts.agentTaskId));
    await setStepStatus(opts.agentTaskId, "await_approval", "waiting");
    await setStepStatus(opts.agentTaskId, "outbound_call", "pending");
    // Auto-select next for auto policy — caller of dial path should pick up; we set selected
    await db.update(agentTaskCandidatesTable).set({ selected: false }).where(eq(agentTaskCandidatesTable.taskId, opts.agentTaskId));
    await db.update(agentTaskCandidatesTable).set({ selected: true }).where(eq(agentTaskCandidatesTable.id, next.id));
    await appendMessage(
      opts.agentTaskId,
      "system",
      JSON.stringify({ action: "auto_retry_candidate", candidateId: next.id }),
      { candidateId: next.id },
    );
    return;
  }

  await setStepStatus(opts.agentTaskId, "outbound_call", "completed", { outcome, callId: opts.callId });
  await setStepStatus(opts.agentTaskId, "summarize", "completed", { outcome });
  await db
    .update(agentTasksTable)
    .set({
      status: outcome === "failed" ? "failed" : "completed",
      resultSummary: summary,
      errorMessage: outcome === "failed" ? summary : null,
    })
    .where(eq(agentTasksTable.id, opts.agentTaskId));
  await appendMessage(
    opts.agentTaskId,
    "assistant",
    `Call finished (${outcome}).\n\n${summary}`,
    { callId: opts.callId, outcome },
  );
}

function deriveOutcome(opts: {
  summary?: string | null;
  disposition?: Record<string, unknown> | null;
  amdResult?: string | null;
  successEvaluation?: string | null;
}): string {
  if (opts.amdResult === "machine") return "voicemail";
  const blob = `${opts.summary ?? ""} ${opts.successEvaluation ?? ""} ${JSON.stringify(opts.disposition ?? {})}`.toLowerCase();
  if (/\bbooked\b|\bconfirmed\b|\bappointment\b/.test(blob)) return "booked";
  if (/\bno availability\b|\bfull\b|\bno slots\b/.test(blob)) return "no_availability";
  if (/\bwrong number\b|\bnot this\b/.test(blob)) return "wrong_number";
  if (/\bno answer\b|\bdid not answer\b|\bunanswered\b/.test(blob)) return "no_answer";
  if (/\bdeclin|\bnot interested\b/.test(blob)) return "declined";
  if (/\bpass\b/.test((opts.successEvaluation ?? "").toLowerCase())) return "human_reached";
  return "completed";
}

export async function cancelTask(userId: string, taskId: number): Promise<TaskDetail> {
  const detail = await getTaskDetail(userId, taskId);
  if (detail.task.status === "completed" || detail.task.status === "cancelled") return detail;
  await db
    .update(agentTasksTable)
    .set({ status: "cancelled", resultSummary: "Cancelled by user." })
    .where(eq(agentTasksTable.id, taskId));
  await appendMessage(taskId, "assistant", "Task cancelled.");
  return getTaskDetail(userId, taskId);
}

export async function handleUserChatMessage(
  userId: string,
  taskId: number,
  content: string,
): Promise<TaskDetail> {
  const detail = await getTaskDetail(userId, taskId);
  if (["completed", "cancelled", "failed"].includes(detail.task.status)) {
    throw new TaskOrchestratorError("This task is already closed", "TASK_CLOSED", 400);
  }

  await appendMessage(taskId, "user", content.trim());

  // If awaiting approval, try to parse a selection index / name
  if (detail.task.status === "awaiting_approval") {
    const pick = parseCandidatePick(content, detail.candidates);
    if (pick) {
      await selectCandidateAndPrepareDial(userId, taskId, pick.id);
      return getTaskDetail(userId, taskId);
    }
    // Re-run lookup if user changes the search
    if (/\b(search|find|look|near|instead|different)\b/i.test(content)) {
      const prefs = parseTaskGoal(content, (detail.task.prefs ?? {}) as AgentTaskPrefs);
      await db
        .update(agentTasksTable)
        .set({ goal: content.trim(), prefs, title: titleFromGoal(content) })
        .where(eq(agentTasksTable.id, taskId));
      return runLookupStep(userId, taskId);
    }
    await appendMessage(
      taskId,
      "assistant",
      "Reply with the listing number to call (e.g. “1”), or ask me to search again with a new location.",
    );
    return getTaskDetail(userId, taskId);
  }

  // Calling / running — acknowledge
  await appendMessage(
    taskId,
    "assistant",
    "I'm still working on this task. If you want to stop, cancel the task.",
  );
  return getTaskDetail(userId, taskId);
}

function parseCandidatePick(
  content: string,
  candidates: AgentTaskCandidate[],
): AgentTaskCandidate | null {
  const dialable = candidates.filter((c) => c.phone);
  const num = content.trim().match(/^#?\s*(\d+)\s*$/);
  if (num) {
    const idx = Number(num[1]) - 1;
    if (idx >= 0 && idx < dialable.length) return dialable[idx]!;
  }
  const lower = content.toLowerCase();
  const byName = dialable.find((c) => lower.includes(c.name.toLowerCase().slice(0, 12)));
  return byName ?? null;
}

export async function listTasks(userId: string, limit = 30): Promise<AgentTask[]> {
  return db
    .select()
    .from(agentTasksTable)
    .where(eq(agentTasksTable.userId, userId))
    .orderBy(desc(agentTasksTable.updatedAt))
    .limit(Math.min(limit, 100));
}
