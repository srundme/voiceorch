/**
 * Pure Squad plan validation / heuristics (no DB).
 */

import {
  DEFAULT_SQUAD_LIMITS,
  type SquadLimits,
  type SquadMember,
  type SquadStepType,
} from "@workspace/db/schema";

export const ALLOWED_STEP_TYPES: SquadStepType[] = [
  "agent_reason",
  "make_call",
  "wait_approval",
  "send_webhook",
  "supervisor_review",
  "live_call",
  "handoff_agent",
];

export type PlannedStep = {
  type: SquadStepType;
  memberId?: number;
  objective?: string;
  requiredInputs?: string[];
  successCriteria?: string;
  requireApproval?: boolean;
  phoneField?: string;
  url?: string;
  targetMemberId?: number;
  handoffReason?: string;
};

export function mergeLimits(raw: SquadLimits | null | undefined): Required<SquadLimits> {
  return {
    maxSteps: raw?.maxSteps ?? DEFAULT_SQUAD_LIMITS.maxSteps,
    maxRetriesPerStep: raw?.maxRetriesPerStep ?? DEFAULT_SQUAD_LIMITS.maxRetriesPerStep,
    maxCallMinutes: raw?.maxCallMinutes ?? DEFAULT_SQUAD_LIMITS.maxCallMinutes,
    maxRuntimeMinutes: raw?.maxRuntimeMinutes ?? DEFAULT_SQUAD_LIMITS.maxRuntimeMinutes,
  };
}

export function validatePlannedSteps(
  steps: unknown,
  members: SquadMember[],
  limits: Required<SquadLimits>,
): { ok: true; steps: PlannedStep[] } | { ok: false; error: string } {
  if (!Array.isArray(steps) || steps.length === 0) {
    return { ok: false, error: "Plan must include at least one step" };
  }
  if (steps.length > limits.maxSteps) {
    return { ok: false, error: `Plan exceeds maxSteps (${limits.maxSteps})` };
  }
  const memberIds = new Set(members.map((m) => m.id));
  const out: PlannedStep[] = [];
  for (let i = 0; i < steps.length; i++) {
    const raw = steps[i];
    if (!raw || typeof raw !== "object") {
      return { ok: false, error: `Step ${i} is not an object` };
    }
    const s = raw as Record<string, unknown>;
    const type = s["type"] as SquadStepType;
    if (!ALLOWED_STEP_TYPES.includes(type)) {
      return { ok: false, error: `Step ${i}: invalid type ${String(s["type"])}` };
    }
    const memberId = typeof s["memberId"] === "number" ? s["memberId"] : undefined;
    const targetMemberId = typeof s["targetMemberId"] === "number" ? s["targetMemberId"] : undefined;
    if (memberId != null && !memberIds.has(memberId)) {
      return { ok: false, error: `Step ${i}: memberId ${memberId} not in squad` };
    }
    if (targetMemberId != null && !memberIds.has(targetMemberId)) {
      return { ok: false, error: `Step ${i}: targetMemberId ${targetMemberId} not in squad` };
    }
    if ((type === "agent_reason" || type === "make_call" || type === "live_call") && memberId == null) {
      return { ok: false, error: `Step ${i}: ${type} requires memberId` };
    }
    if (type === "handoff_agent" && targetMemberId == null) {
      return { ok: false, error: `Step ${i}: handoff_agent requires targetMemberId` };
    }
    if (type === "send_webhook" && typeof s["url"] !== "string") {
      return { ok: false, error: `Step ${i}: send_webhook requires url` };
    }
    out.push({
      type,
      ...(memberId != null ? { memberId } : {}),
      ...(typeof s["objective"] === "string" ? { objective: s["objective"] } : {}),
      ...(Array.isArray(s["requiredInputs"])
        ? { requiredInputs: s["requiredInputs"].filter((x) => typeof x === "string") as string[] }
        : {}),
      ...(typeof s["successCriteria"] === "string" ? { successCriteria: s["successCriteria"] } : {}),
      ...(typeof s["requireApproval"] === "boolean" ? { requireApproval: s["requireApproval"] } : {}),
      ...(typeof s["phoneField"] === "string" ? { phoneField: s["phoneField"] } : {}),
      ...(typeof s["url"] === "string" ? { url: s["url"] } : {}),
      ...(targetMemberId != null ? { targetMemberId } : {}),
      ...(typeof s["handoffReason"] === "string" ? { handoffReason: s["handoffReason"] } : {}),
    });
  }
  return { ok: true, steps: out };
}

export function heuristicPlan(goal: string, members: SquadMember[]): PlannedStep[] {
  const supervisor = members.find((m) => m.roleType === "supervisor") ?? members[0];
  const specialist =
    members.find((m) => m.roleType === "specialist" && m.id !== supervisor?.id)
    ?? members[1]
    ?? supervisor;
  const steps: PlannedStep[] = [];
  if (specialist) {
    steps.push({
      type: "agent_reason",
      memberId: specialist.id,
      objective: `Work on: ${goal}`,
      successCriteria: "Produce a concise structured result for the supervisor",
    });
  }
  if (supervisor) {
    steps.push({
      type: "supervisor_review",
      memberId: supervisor.id,
      objective: "Review specialist output and produce the final answer",
    });
  }
  return steps;
}
