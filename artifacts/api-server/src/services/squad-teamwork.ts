/**
 * Squad teamwork — the simple squad model.
 *
 * Agents are built individually (own prompt, own phone number). Putting them
 * in a squad gives them three things automatically, with zero extra config:
 *
 *  1. Handoff tools — every member gets a `transfer_to_<teammate>` tool so it
 *     can pass the live call to a teammate mid-conversation (same call, same
 *     media stream; only the AI pipeline is swapped).
 *  2. Shared caller memory — facts a teammate learned about this caller are
 *     injected into the prompt, so agent 2 already "knows" the caller.
 *  3. Tasks — a `create_followup_task` tool lets any member schedule a
 *     teammate to call the customer back later (backed by the existing
 *     scheduled-callbacks dialer), and every handoff is recorded as a task.
 */

import {
  db,
  squadsTable,
  squadMembersTable,
  squadTasksTable,
  agentsTable,
  callerFactsTable,
  scheduledCallbacksTable,
  type Squad,
  type SquadMember,
} from "@workspace/db";
import { eq, and, desc, inArray, isNull } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { canonicalizeCallerKey } from "../orchestration/callerMemory.js";
import type { AgentTool } from "../orchestration/types.js";

export type SquadTeam = {
  squad: Squad;
  members: SquadMember[];
  /** The member row for the agent currently on the call. */
  self: SquadMember;
  /** Teammates that can receive a live handoff. */
  teammates: Array<SquadMember & { agentName: string }>;
};

/**
 * Resolve the active squad an agent belongs to (membership-based — no phone
 * number or campaign wiring needed). If the agent is in several active squads,
 * the most recently updated one wins.
 */
export async function findSquadForAgent(
  agentId: number,
  userId: string,
): Promise<SquadTeam | null> {
  const rows = await db
    .select({ squadId: squadsTable.id })
    .from(squadMembersTable)
    .innerJoin(squadsTable, eq(squadMembersTable.squadId, squadsTable.id))
    .where(and(
      eq(squadMembersTable.agentId, agentId),
      eq(squadsTable.userId, userId),
      eq(squadsTable.status, "active"),
    ))
    .orderBy(desc(squadsTable.updatedAt))
    .limit(1);
  const hit = rows[0];
  if (!hit) return null;
  return loadSquadTeam(hit.squadId, agentId);
}

/** Load the team view for a known squad id (used when squad was resolved via phone/campaign). */
export async function loadSquadTeam(squadId: number, agentId: number): Promise<SquadTeam | null> {
  const [squad] = await db.select().from(squadsTable)
    .where(and(eq(squadsTable.id, squadId), eq(squadsTable.status, "active"))).limit(1);
  if (!squad) return null;

  const members = await db.select().from(squadMembersTable)
    .where(eq(squadMembersTable.squadId, squadId));
  const self = members.find((m) => m.agentId === agentId);
  if (!self) return null;

  const teammateAgentIds = members.filter((m) => m.agentId !== agentId).map((m) => m.agentId);
  const agents = teammateAgentIds.length
    ? await db.select({ id: agentsTable.id, name: agentsTable.name }).from(agentsTable)
      .where(inArray(agentsTable.id, teammateAgentIds))
    : [];
  const nameById = new Map(agents.map((a) => [a.id, a.name]));

  const teammates = members
    .filter((m) => m.agentId !== agentId && m.handoffEnabled)
    .map((m) => ({ ...m, agentName: nameById.get(m.agentId) ?? `Agent #${m.agentId}` }));

  return { squad, members, self, teammates };
}

function sanitizeToolName(raw: string): string {
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
  return cleaned || "teammate";
}

/**
 * Tools auto-injected for a squad member: one transfer tool per teammate plus
 * a generic follow-up task tool. Skips teammates the user already wired up
 * manually with their own transfer_agent tool.
 */
export function buildSquadTools(team: SquadTeam, existingTools: AgentTool[]): AgentTool[] {
  const existingTargets = new Set(
    existingTools
      .filter((t): t is AgentTool & { type: "transfer_agent" } => t.type === "transfer_agent")
      .map((t) => t.targetAgentId),
  );
  const usedNames = new Set(existingTools.map((t) => t.name));

  const injected: AgentTool[] = [];
  for (const tm of team.teammates) {
    if (existingTargets.has(tm.agentId)) continue;
    let name = `transfer_to_${sanitizeToolName(tm.roleName || tm.agentName)}`;
    if (usedNames.has(name)) name = `${name}_${tm.agentId}`;
    usedNames.add(name);
    injected.push({
      type: "transfer_agent",
      name,
      description:
        `Hand this live call to your teammate "${tm.roleName}" (${tm.agentName}). ` +
        `Use when the caller needs what they handle` +
        (tm.instructions ? `: ${tm.instructions.slice(0, 200)}` : ".") +
        " The caller stays on the same call; briefly tell them you are connecting a teammate before transferring.",
      targetAgentId: tm.agentId,
    });
  }

  if (team.teammates.length > 0 && !existingTools.some((t) => t.type === "squad_followup")) {
    injected.push({
      type: "squad_followup",
      name: "create_followup_task",
      description:
        "Schedule a teammate to call this customer back later (e.g. tomorrow, in 2 hours). " +
        "Use when the customer wants a callback or the next step belongs to a teammate but not right now. " +
        "The teammate will automatically call the customer at the scheduled time with your note as context.",
    });
  }

  return injected;
}

/** Prompt block describing the squad so the agent knows who to hand off to. */
export function buildSquadPromptBlock(team: SquadTeam): string {
  if (team.teammates.length === 0) return "";
  const lines = team.teammates.map((tm) =>
    `- ${tm.roleName} (${tm.agentName}, agentId ${tm.agentId})${tm.instructions ? `: handles ${tm.instructions.slice(0, 200)}` : ""}`,
  );
  return [
    "[YOUR TEAM]",
    `You are the "${team.self.roleName}" on the "${team.squad.name}" team. Your teammates:`,
    ...lines,
    "When the caller needs something a teammate handles, briefly tell them you are connecting a teammate, then call the matching transfer tool. The caller stays on the line. The teammate will take over and continue — do not wait for a confirmation after the tool.",
    "If the next step should happen later (a callback), use create_followup_task with the teammate's agentId, a clear note, and when to call.",
  ].join("\n");
}

/**
 * Facts teammates learned about this caller (facts under other member agent
 * IDs). Returned as a compact prompt block, or "" when nothing is known.
 */
export async function buildSharedCallerFactsBlock(
  team: SquadTeam,
  callerPhone: string | null,
  selfAgentId: number,
): Promise<string> {
  if (!callerPhone) return "";
  const phone = canonicalizeCallerKey(callerPhone) ?? callerPhone;
  const otherAgentIds = team.members.map((m) => m.agentId).filter((id) => id !== selfAgentId);
  if (otherAgentIds.length === 0) return "";

  try {
    const facts = await db.select({
      agentId: callerFactsTable.agentId,
      key: callerFactsTable.key,
      value: callerFactsTable.value,
    })
      .from(callerFactsTable)
      .where(and(
        inArray(callerFactsTable.agentId, otherAgentIds),
        eq(callerFactsTable.phoneNumber, phone),
        isNull(callerFactsTable.supersededById),
      ))
      .orderBy(desc(callerFactsTable.createdAt))
      .limit(30);
    if (facts.length === 0) return "";

    // De-dupe by key, newest wins (query is newest-first).
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const f of facts) {
      if (seen.has(f.key)) continue;
      seen.add(f.key);
      lines.push(`- ${f.key}: ${f.value}`);
    }
    return [
      "[TEAM NOTES ABOUT THIS CALLER]",
      "Your teammates already spoke with this caller and learned:",
      ...lines.slice(0, 20),
      "Use this naturally — do not re-ask for information you already have here.",
    ].join("\n");
  } catch (err) {
    logger.warn({ err, callerPhone }, "Failed to load shared squad caller facts");
    return "";
  }
}

/** Record a completed mid-call handoff as a squad task (audit trail). */
export async function recordHandoffTask(opts: {
  squadId: number;
  userId: string;
  fromAgentId: number;
  toAgentId: number;
  callId: number;
  callerPhone: string | null;
  reason: string;
  contextSummary: string;
}): Promise<void> {
  try {
    await db.insert(squadTasksTable).values({
      squadId: opts.squadId,
      userId: opts.userId,
      type: "handoff",
      status: "completed",
      fromAgentId: opts.fromAgentId,
      toAgentId: opts.toAgentId,
      callId: opts.callId,
      callerPhone: opts.callerPhone ? (canonicalizeCallerKey(opts.callerPhone) ?? opts.callerPhone) : null,
      title: opts.reason.slice(0, 200) || "Live call handoff",
      contextSummary: opts.contextSummary.slice(0, 4000),
    });
  } catch (err) {
    logger.warn({ err, callId: opts.callId }, "Failed to record squad handoff task");
  }
}

const MAX_FOLLOWUP_DELAY_MINUTES = 60 * 24 * 30; // 30 days

/**
 * Create a follow-up task: a teammate calls the customer back later.
 * Backed by a scheduled_callbacks row — the existing callback poller dials
 * with the target agent's own telephony config and phone number.
 */
export async function createSquadFollowupTask(opts: {
  fromAgentId: number;
  callId: number;
  callerPhone: string | null;
  targetAgentId: number;
  note: string;
  delayMinutes: number;
  contextSummary?: string;
}): Promise<string> {
  const [fromAgent] = await db.select({ userId: agentsTable.userId })
    .from(agentsTable).where(eq(agentsTable.id, opts.fromAgentId)).limit(1);
  if (!fromAgent?.userId) return "followup_failed: agent not found";

  const team = await findSquadForAgent(opts.fromAgentId, fromAgent.userId);
  if (!team) return "followup_failed: you are not part of an active squad";

  const target = team.members.find((m) => m.agentId === opts.targetAgentId);
  if (!target) {
    const valid = team.teammates.map((t) => `${t.roleName}=${t.agentId}`).join(", ");
    return `followup_failed: agent ${opts.targetAgentId} is not on your team. Valid teammates: ${valid}`;
  }

  if (!opts.callerPhone) {
    return "followup_failed: caller phone number unknown on this call";
  }
  // Task rows use the canonical caller key so the follow-up call (or a
  // ring-back) matches; the dialer keeps the raw number.
  const canonicalPhone = canonicalizeCallerKey(opts.callerPhone) ?? opts.callerPhone;

  const delay = Math.min(Math.max(Math.round(opts.delayMinutes), 1), MAX_FOLLOWUP_DELAY_MINUTES);
  const dueAt = new Date(Date.now() + delay * 60_000);

  const [cb] = await db.insert(scheduledCallbacksTable).values({
    agentId: opts.targetAgentId,
    toNumber: opts.callerPhone,
    userId: fromAgent.userId,
    scheduledAt: dueAt,
    createdFromCallId: opts.callId,
    reason: "callback_requested",
    maxAttempts: 3,
    notes: `[Squad follow-up from teammate] ${opts.note}`.slice(0, 2000),
  }).returning({ id: scheduledCallbacksTable.id });

  await db.insert(squadTasksTable).values({
    squadId: team.squad.id,
    userId: fromAgent.userId,
    type: "follow_up",
    status: "scheduled",
    fromAgentId: opts.fromAgentId,
    toAgentId: opts.targetAgentId,
    callId: opts.callId,
    callerPhone: canonicalPhone,
    title: opts.note.slice(0, 200),
    note: opts.note,
    contextSummary: (opts.contextSummary ?? "").slice(0, 4000) || null,
    dueAt,
    scheduledCallbackId: cb?.id ?? null,
  });

  logger.info(
    { fromAgentId: opts.fromAgentId, toAgentId: opts.targetAgentId, dueAt, callId: opts.callId },
    "Squad follow-up task scheduled",
  );
  const roleName = team.teammates.find((t) => t.agentId === opts.targetAgentId)?.roleName
    ?? target.roleName;
  return `followup_scheduled: ${roleName} will call the customer back around ${dueAt.toISOString()}. Let the caller know.`;
}

/**
 * When an agent gets on a call with a caller it owes a follow-up to, pull the
 * task note into the prompt and mark the task done. Covers both the scheduled
 * auto-dial and the caller ringing back in before the callback fires.
 */
export async function consumeFollowupContext(
  agentId: number,
  callerPhone: string | null,
): Promise<string> {
  if (!callerPhone) return "";
  const phone = canonicalizeCallerKey(callerPhone) ?? callerPhone;
  try {
    const tasks = await db.select().from(squadTasksTable)
      .where(and(
        eq(squadTasksTable.toAgentId, agentId),
        eq(squadTasksTable.callerPhone, phone),
        eq(squadTasksTable.type, "follow_up"),
        inArray(squadTasksTable.status, ["pending", "scheduled"]),
      ))
      .orderBy(desc(squadTasksTable.createdAt))
      .limit(3);
    if (tasks.length === 0) return "";

    await db.update(squadTasksTable)
      .set({ status: "completed" })
      .where(inArray(squadTasksTable.id, tasks.map((t) => t.id)));

    const lines = tasks.map((t) => {
      const parts = [`- ${t.note || t.title}`];
      if (t.contextSummary) parts.push(`  Context from the earlier call: ${t.contextSummary.slice(0, 600)}`);
      return parts.join("\n");
    });
    return [
      "[FOLLOW-UP TASK FROM YOUR TEAMMATE]",
      "This call is a follow-up your teammate asked you to handle for this customer:",
      ...lines,
      "Open the conversation naturally — reference the earlier conversation instead of starting cold.",
    ].join("\n");
  } catch (err) {
    logger.warn({ err, agentId, callerPhone }, "Failed to load squad follow-up context");
    return "";
  }
}

/**
 * Squad-shared memory owner. All members of a squad read/write ONE caller
 * memory + voiceprint record, keyed under a canonical "owner" agentId so the
 * whole squad recognizes the caller regardless of which member answers.
 * Owner = entry member's agent, else supervisor, else lowest member agentId
 * (deterministic + stable). Falls back to the agent itself when not in a squad.
 */
export async function resolveSquadMemoryOwnerAgentId(
  agentId: number,
  userId: string | null | undefined,
  /** When the call already knows its squad (campaign/queue path), use THAT
   *  squad — membership lookup alone can pick the wrong squad for agents in
   *  several active squads. */
  knownSquadId?: number | null,
): Promise<number> {
  if (!userId && !knownSquadId) return agentId;
  try {
    const team = knownSquadId
      ? await loadSquadTeam(knownSquadId, agentId)
      : userId
        ? await findSquadForAgent(agentId, userId)
        : null;
    if (!team) return agentId;
    const entry = team.squad.entryMemberId != null
      ? team.members.find((m) => m.id === team.squad.entryMemberId)
      : undefined;
    const owner =
      entry?.agentId
      ?? team.squad.supervisorAgentId
      ?? team.members.reduce((min, m) => Math.min(min, m.agentId), agentId);
    return owner ?? agentId;
  } catch (err) {
    logger.warn({ err, agentId }, "Squad memory owner resolution failed — using own agentId");
    return agentId;
  }
}
