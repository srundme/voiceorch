/**
 * Flow graph helpers (pure — no DB).
 *
 * Graph mode is on when `trigger.entryStepId` is present: steps are walked by
 * pointers (`next`, `onTrue`/`onFalse`, `cases[].next`) instead of array order.
 * Legacy linear flows (if/else expressed as thenStepCount/elseStepCount) are
 * converted with `linearToGraph` so the canvas can open them; array order and
 * indices are preserved so parked runs keep resuming at the same index.
 */

import type { ConditionOp, WorkflowStep, WorkflowTrigger } from "@workspace/db";

type Ctx = Record<string, unknown>;

/** Graph mode = `entryStepId` present on the trigger (null = canvas flow not yet connected). */
export function isGraphFlow(trigger: WorkflowTrigger | null | undefined): boolean {
  return typeof trigger?.entryStepId === "string" || trigger?.entryStepId === null;
}

export function getPath(ctx: Ctx, path: string): unknown {
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

export function evalCondition(
  field: string | undefined,
  op: ConditionOp | undefined,
  value: string | undefined,
  context: Ctx,
): boolean {
  const actual = toStr(getPath(context, field ?? "")).toLowerCase().trim();
  const expected = toStr(value ?? "").toLowerCase().trim();
  switch (op ?? "exists") {
    case "eq": return actual === expected;
    case "neq": return actual !== expected;
    case "contains": return actual.includes(expected);
    case "exists": return actual !== "";
    case "gt": return Number(actual || 0) > Number(expected);
    case "lt": return Number(actual || 0) < Number(expected);
    default: return true;
  }
}

/**
 * Pointer to follow after `step` runs. Returns the target step id, or null to
 * end the run. Async steps (make_call, delay) resolve `next` when they park.
 */
export function resolveNextStepId(step: WorkflowStep, context: Ctx): string | null {
  if (step.type === "condition") {
    if (step.field === "__stop") return null;
    const ok = evalCondition(step.field, step.op, step.value, context);
    return (ok ? step.onTrue : step.onFalse) ?? null;
  }
  if (step.type === "branch") {
    for (const c of step.cases ?? []) {
      if (evalCondition(c.field, c.op, c.value, context)) return c.next ?? null;
    }
    return step.next ?? null;
  }
  return step.next ?? null;
}

/** Array index for a step id; `steps.length` (= finish) when null / unknown. */
export function indexOfStep(steps: WorkflowStep[], id: string | null | undefined): number {
  if (!id) return steps.length;
  const i = steps.findIndex((s) => s.id === id);
  return i < 0 ? steps.length : i;
}

function newId(prefix: string, taken: Set<string>): string {
  let id = "";
  do {
    id = `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
  } while (taken.has(id));
  taken.add(id);
  return id;
}

/** Ensure every step has a unique id (ids are what arrows point at). */
function withUniqueIds(steps: WorkflowStep[]): WorkflowStep[] {
  const taken = new Set<string>();
  return steps.map((s) => {
    const id = typeof s.id === "string" && s.id.trim() && !taken.has(s.id) ? s.id : null;
    if (id) { taken.add(id); return s; }
    return { ...s, id: newId(s.type || "step", taken) };
  });
}

/**
 * Convert a legacy linear flow to graph pointers with identical behaviour.
 * Steps keep their array positions.
 */
export function linearToGraph(input: WorkflowStep[]): { entryStepId: string | null; steps: WorkflowStep[] } {
  const steps = withUniqueIds(input.map((s) => ({ ...s })));
  const idAt = (k: number): string | null => (k >= 0 && k < steps.length ? steps[k]!.id : null);

  // Last step of a then-block jumps over the else-block to the join point.
  const jumpOverElse = new Map<number, number>();
  steps.forEach((s, i) => {
    if (s.type !== "condition" || s.field === "__stop") return;
    const thenN = Math.max(0, Math.floor(Number(s.thenStepCount ?? 0)));
    const elseN = Math.max(0, Math.floor(Number(s.elseStepCount ?? 0)));
    if (thenN > 0 && elseN > 0) jumpOverElse.set(i + thenN, i + 1 + thenN + elseN);
  });

  const out = steps.map((s, i): WorkflowStep => {
    const { thenStepCount: _t, elseStepCount: _e, ...rest } = s;
    if (s.type === "condition") {
      if (s.field === "__stop") return { ...rest, onTrue: null, onFalse: null, next: null };
      const thenN = Math.max(0, Math.floor(Number(s.thenStepCount ?? 0)));
      const elseN = Math.max(0, Math.floor(Number(s.elseStepCount ?? 0)));
      if (thenN === 0 && elseN === 0) {
        // Legacy gate: true continues, false ends the run.
        return { ...rest, onTrue: idAt(i + 1), onFalse: null, next: null };
      }
      const join = i + 1 + thenN + elseN;
      return {
        ...rest,
        onTrue: idAt(thenN > 0 ? i + 1 : join),
        onFalse: idAt(elseN > 0 ? i + 1 + thenN : join),
        next: null,
      };
    }
    const target = jumpOverElse.get(i) ?? i + 1;
    return { ...rest, next: idAt(target) };
  });

  return { entryStepId: out[0]?.id ?? null, steps: out };
}

/** Graph view of any flow — converts legacy linear flows on the fly. */
export function toGraphFlow(
  trigger: WorkflowTrigger,
  steps: WorkflowStep[],
): { trigger: WorkflowTrigger; steps: WorkflowStep[] } {
  if (isGraphFlow(trigger)) return { trigger, steps };
  const g = linearToGraph(steps ?? []);
  return { trigger: { ...trigger, entryStepId: g.entryStepId }, steps: g.steps };
}

export interface FlowIssue {
  stepId: string | null;
  message: string;
}

export interface FlowValidation {
  /** Structural problems — the flow cannot be saved. */
  errors: string[];
  /** Config problems — the flow can be saved as draft but not activated/started. */
  issues: FlowIssue[];
}

function targetsOf(step: WorkflowStep): Array<string | null | undefined> {
  if (step.type === "condition") return [step.onTrue, step.onFalse];
  if (step.type === "branch") return [...(step.cases ?? []).map((c) => c.next), step.next];
  return [step.next];
}

export function validateFlow(trigger: WorkflowTrigger, steps: WorkflowStep[]): FlowValidation {
  const errors: string[] = [];
  const issues: FlowIssue[] = [];
  if (!Array.isArray(steps)) return { errors: ["steps must be an array"], issues };

  if (!isGraphFlow(trigger)) {
    if (steps.length === 0) issues.push({ stepId: null, message: "Add at least one step" });
    return { errors, issues };
  }

  const ids = new Set<string>();
  for (const s of steps) {
    if (!s || typeof s.id !== "string" || !s.id.trim()) { errors.push("Every step needs an id"); continue; }
    if (ids.has(s.id)) errors.push(`Duplicate step id: ${s.id}`);
    ids.add(s.id);
  }
  if (steps.length === 0) {
    issues.push({ stepId: null, message: "Add at least one step" });
    return { errors, issues };
  }
  const entry = trigger.entryStepId;
  if (entry && !ids.has(entry)) errors.push("The trigger is not connected to a step that exists");
  if (!entry) issues.push({ stepId: null, message: "Connect the trigger to the first step" });

  for (const s of steps) {
    for (const t of targetsOf(s)) {
      if (t && !ids.has(t)) errors.push(`Step ${s.id} points to missing step ${t}`);
    }
    if (s.type === "branch") {
      const caseIds = new Set<string>();
      for (const c of s.cases ?? []) {
        if (!c.id || caseIds.has(c.id)) errors.push(`Step ${s.id} has a path without a unique id`);
        caseIds.add(c.id);
      }
    }
  }
  if (errors.length > 0) return { errors, issues };

  const need = (s: WorkflowStep, ok: boolean, message: string) => {
    if (!ok) issues.push({ stepId: s.id, message });
  };
  for (const s of steps) {
    switch (s.type) {
      case "make_call":
        need(s, !!s.agentId, "Pick an agent to call with");
        break;
      case "schedule_callback":
        need(s, !!s.agentId, "Pick an agent for the callback");
        break;
      case "delay":
        need(s, Number(s.delaySeconds) > 0, "Set how long to wait");
        break;
      case "send_webhook":
        need(s, !!s.url?.trim(), "Add the webhook URL");
        break;
      case "condition":
        need(s, s.field === "__stop" || !!s.field?.trim(), "Choose what to check");
        break;
      case "branch":
        need(s, (s.cases ?? []).length > 0, "Add at least one path");
        for (const c of s.cases ?? []) need(s, !!c.field?.trim(), `Path "${c.label || c.id}" needs something to check`);
        break;
    }
  }

  // Unreachable steps are allowed (drafts) but flagged.
  const byId = new Map(steps.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const stack = entry ? [entry] : [];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const t of targetsOf(byId.get(id)!)) if (t) stack.push(t);
  }
  if (entry) {
    for (const s of steps) {
      if (!seen.has(s.id)) issues.push({ stepId: s.id, message: "Not connected — this step will never run" });
    }
  }

  return { errors, issues };
}
