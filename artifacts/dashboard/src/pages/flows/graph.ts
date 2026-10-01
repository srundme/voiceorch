import { MarkerType, type Edge } from "@xyflow/react";
import type { FlowStep, FlowTrigger } from "./api";

export const TRIGGER_NODE_ID = "__trigger";
const COL_W = 300;
const ROW_H = 170;

type Pointer = { handle: string; target: string | null | undefined; label?: string; reason?: string };

/** Every outgoing arrow of a step, keyed by its source handle id. */
export function pointersOf(step: FlowStep): Pointer[] {
  if (step.type === "condition") {
    return [
      { handle: "yes", target: step.onTrue, label: "Yes", reason: "Yes" },
      { handle: "no", target: step.onFalse, label: "No", reason: "No" },
    ];
  }
  if (step.type === "branch") {
    return [
      ...(step.cases ?? []).map((c) => ({
        handle: `case:${c.id}`,
        target: c.next,
        label: c.label || "Path",
        reason: `Path: ${c.label || c.id}`,
      })),
      { handle: "otherwise", target: step.next, label: "Otherwise", reason: "Path: otherwise" },
    ];
  }
  return [{ handle: "next", target: step.next }];
}

/** Set the arrow leaving `handle` on `step` (null removes it). */
export function setPointer(step: FlowStep, handle: string, target: string | null): FlowStep {
  if (step.type === "condition") {
    if (handle === "yes") return { ...step, onTrue: target };
    if (handle === "no") return { ...step, onFalse: target };
  }
  if (step.type === "branch" && handle.startsWith("case:")) {
    const caseId = handle.slice(5);
    return { ...step, cases: (step.cases ?? []).map((c) => (c.id === caseId ? { ...c, next: target } : c)) };
  }
  return { ...step, next: target };
}

export function buildEdges(
  trigger: FlowTrigger,
  steps: FlowStep[],
  pathCount: (stepId: string, reason: string) => number | undefined,
): Edge[] {
  const ids = new Set(steps.map((s) => s.id));
  const marker = { type: MarkerType.ArrowClosed, width: 16, height: 16 };
  const edges: Edge[] = [];
  if (trigger.entryStepId && ids.has(trigger.entryStepId)) {
    edges.push({
      id: `${TRIGGER_NODE_ID}->${trigger.entryStepId}`,
      source: TRIGGER_NODE_ID,
      sourceHandle: "out",
      target: trigger.entryStepId,
      markerEnd: marker,
    });
  }
  for (const s of steps) {
    for (const p of pointersOf(s)) {
      if (!p.target || !ids.has(p.target)) continue;
      const n = p.reason ? pathCount(s.id, p.reason) : undefined;
      edges.push({
        id: `${s.id}:${p.handle}->${p.target}`,
        source: s.id,
        sourceHandle: p.handle,
        target: p.target,
        markerEnd: marker,
        label: n ? `${n}` : undefined,
        labelBgPadding: [4, 2],
        labelBgBorderRadius: 4,
        labelStyle: { fontSize: 10, fontWeight: 600 },
        style: p.handle === "no" ? { strokeDasharray: "4 3" } : undefined,
      });
    }
  }
  return edges;
}

/** Remove a step and every arrow pointing at it. */
export function removeStep(
  trigger: FlowTrigger,
  steps: FlowStep[],
  id: string,
): { trigger: FlowTrigger; steps: FlowStep[] } {
  const next = steps
    .filter((s) => s.id !== id)
    .map((s) => pointersOf(s).reduce((acc, p) => (p.target === id ? setPointer(acc, p.handle, null) : acc), s));
  return {
    trigger: trigger.entryStepId === id ? { ...trigger, entryStepId: null } : trigger,
    steps: next,
  };
}

/** Layered top-down layout from the trigger; unreachable steps go in a side column. */
export function autoLayout(trigger: FlowTrigger, steps: FlowStep[]): { trigger: FlowTrigger; steps: FlowStep[] } {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const depth = new Map<string, number>();
  const queue: string[] = [];
  if (trigger.entryStepId && byId.has(trigger.entryStepId)) {
    depth.set(trigger.entryStepId, 1);
    queue.push(trigger.entryStepId);
  }
  while (queue.length > 0) {
    const id = queue.shift()!;
    const d = depth.get(id)!;
    for (const p of pointersOf(byId.get(id)!)) {
      if (p.target && byId.has(p.target) && !depth.has(p.target)) {
        depth.set(p.target, d + 1);
        queue.push(p.target);
      }
    }
  }
  const rows = new Map<number, string[]>();
  for (const s of steps) {
    const d = depth.get(s.id);
    if (d == null) continue;
    rows.set(d, [...(rows.get(d) ?? []), s.id]);
  }
  const pos = new Map<string, { x: number; y: number }>();
  for (const [d, ids] of rows) {
    ids.forEach((id, i) => pos.set(id, { x: (i - (ids.length - 1) / 2) * COL_W, y: d * ROW_H }));
  }
  const maxX = Math.max(0, ...[...pos.values()].map((p) => p.x));
  let orphanRow = 1;
  for (const s of steps) {
    if (!pos.has(s.id)) pos.set(s.id, { x: maxX + COL_W * 1.5, y: orphanRow++ * ROW_H });
  }
  return {
    trigger: { ...trigger, position: { x: 0, y: 0 } },
    steps: steps.map((s) => ({ ...s, position: pos.get(s.id)! })),
  };
}

export function needsLayout(steps: FlowStep[]): boolean {
  return steps.some((s) => !s.position);
}
