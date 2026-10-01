import { describe, expect, it } from "vitest";
import type { WorkflowStep, WorkflowTrigger } from "@workspace/db";
import {
  evalCondition,
  indexOfStep,
  isGraphFlow,
  linearToGraph,
  resolveNextStepId,
  toGraphFlow,
  validateFlow,
} from "./workflow-graph.js";

/** Walk a graph from entry, taking every step inline, and return the visited ids. */
function walk(entry: string | null, steps: WorkflowStep[], ctx: Record<string, unknown>): string[] {
  const out: string[] = [];
  let id = entry;
  let guard = 0;
  while (id && guard++ < 50) {
    const step = steps.find((s) => s.id === id)!;
    out.push(step.id);
    id = resolveNextStepId(step, ctx);
  }
  return out;
}

describe("linearToGraph", () => {
  it("chains plain steps in order", () => {
    const g = linearToGraph([
      { id: "a", type: "make_call", agentId: 1 },
      { id: "b", type: "send_whatsapp" },
      { id: "c", type: "send_email" },
    ]);
    expect(g.entryStepId).toBe("a");
    expect(g.steps.map((s) => s.next)).toEqual(["b", "c", null]);
  });

  it("legacy gate: true continues, false ends", () => {
    const g = linearToGraph([
      { id: "call", type: "make_call", agentId: 1 },
      { id: "gate", type: "condition", field: "call.connected", op: "eq", value: "false" },
      { id: "cb", type: "schedule_callback", agentId: 1 },
    ]);
    expect(walk(g.entryStepId, g.steps, { call: { connected: false } })).toEqual(["call", "gate", "cb"]);
    expect(walk(g.entryStepId, g.steps, { call: { connected: true } })).toEqual(["call", "gate"]);
  });

  it("if/else blocks rejoin after the else block", () => {
    const g = linearToGraph([
      { id: "if", type: "condition", field: "x", op: "eq", value: "1", thenStepCount: 2, elseStepCount: 1 },
      { id: "t1", type: "send_whatsapp" },
      { id: "t2", type: "send_email" },
      { id: "e1", type: "send_webhook", url: "https://x" },
      { id: "after", type: "update_sheet" },
    ]);
    expect(walk(g.entryStepId, g.steps, { x: "1" })).toEqual(["if", "t1", "t2", "after"]);
    expect(walk(g.entryStepId, g.steps, { x: "2" })).toEqual(["if", "e1", "after"]);
    expect(g.steps[0]).not.toHaveProperty("thenStepCount");
  });

  it("then-only and else-only blocks", () => {
    const thenOnly = linearToGraph([
      { id: "if", type: "condition", field: "x", op: "exists", thenStepCount: 1 },
      { id: "t", type: "send_email" },
      { id: "after", type: "update_sheet" },
    ]);
    expect(walk(thenOnly.entryStepId, thenOnly.steps, { x: "y" })).toEqual(["if", "t", "after"]);
    expect(walk(thenOnly.entryStepId, thenOnly.steps, {})).toEqual(["if", "after"]);

    const elseOnly = linearToGraph([
      { id: "if", type: "condition", field: "x", op: "exists", elseStepCount: 1 },
      { id: "e", type: "send_email" },
      { id: "after", type: "update_sheet" },
    ]);
    expect(walk(elseOnly.entryStepId, elseOnly.steps, { x: "y" })).toEqual(["if", "after"]);
    expect(walk(elseOnly.entryStepId, elseOnly.steps, {})).toEqual(["if", "e", "after"]);
  });

  it("stop ends the run", () => {
    const g = linearToGraph([
      { id: "s", type: "condition", field: "__stop" },
      { id: "never", type: "send_email" },
    ]);
    expect(walk(g.entryStepId, g.steps, {})).toEqual(["s"]);
  });

  it("fills in missing / duplicate ids and keeps array order", () => {
    const g = linearToGraph([
      { id: "", type: "make_call", agentId: 1 },
      { id: "dup", type: "send_email" },
      { id: "dup", type: "send_webhook", url: "https://x" },
    ]);
    const ids = g.steps.map((s) => s.id);
    expect(new Set(ids).size).toBe(3);
    expect(g.steps.map((s) => s.type)).toEqual(["make_call", "send_email", "send_webhook"]);
    expect(g.steps[0]!.next).toBe(ids[1]);
  });
});

describe("branch", () => {
  const steps: WorkflowStep[] = [
    {
      id: "br",
      type: "branch",
      cases: [
        { id: "c1", field: "call.connected", op: "eq", value: "false", next: "retry" },
        { id: "c2", field: "call.disposition.interested", op: "eq", value: "true", next: "wa" },
      ],
      next: "end",
    },
    { id: "retry", type: "delay", delaySeconds: 60 },
    { id: "wa", type: "send_whatsapp" },
    { id: "end", type: "update_sheet" },
  ];
  it("first matching case wins, otherwise falls through", () => {
    expect(resolveNextStepId(steps[0]!, { call: { connected: false } })).toBe("retry");
    expect(resolveNextStepId(steps[0]!, { call: { connected: true, disposition: { interested: true } } })).toBe("wa");
    expect(resolveNextStepId(steps[0]!, { call: { connected: true } })).toBe("end");
  });
});

describe("evalCondition", () => {
  it("handles visit counters and numbers", () => {
    expect(evalCondition("__visits.call", "lt", "3", { __visits: { call: 2 } })).toBe(true);
    expect(evalCondition("__visits.call", "lt", "3", { __visits: { call: 3 } })).toBe(false);
    expect(evalCondition("__visits.call", "lt", "3", {})).toBe(true);
    expect(evalCondition("name", "contains", "RA", { name: "Karan" })).toBe(true);
  });
});

describe("indexOfStep / isGraphFlow / toGraphFlow", () => {
  const steps: WorkflowStep[] = [{ id: "a", type: "send_email" }, { id: "b", type: "send_email" }];
  it("maps ids to indices, null to finish", () => {
    expect(indexOfStep(steps, "b")).toBe(1);
    expect(indexOfStep(steps, null)).toBe(2);
    expect(indexOfStep(steps, "zzz")).toBe(2);
  });
  it("detects graph mode and converts linear flows", () => {
    expect(isGraphFlow({ type: "manual" })).toBe(false);
    expect(isGraphFlow({ type: "manual", entryStepId: "a" })).toBe(true);
    expect(isGraphFlow({ type: "manual", entryStepId: null })).toBe(true);
    const g = toGraphFlow({ type: "manual" }, steps);
    expect(g.trigger.entryStepId).toBe("a");
    expect(g.steps[0]!.next).toBe("b");
  });
});

describe("validateFlow", () => {
  const trigger: WorkflowTrigger = { type: "manual", entryStepId: "call" };

  it("accepts a valid graph", () => {
    const v = validateFlow(trigger, [
      { id: "call", type: "make_call", agentId: 3, next: "wait" },
      { id: "wait", type: "delay", delaySeconds: 3600, next: null },
    ]);
    expect(v).toEqual({ errors: [], issues: [] });
  });

  it("rejects broken arrows and duplicate ids", () => {
    const v = validateFlow(trigger, [
      { id: "call", type: "make_call", agentId: 3, next: "ghost" },
      { id: "call", type: "send_email" },
    ]);
    expect(v.errors.some((e) => e.includes("Duplicate"))).toBe(true);
    expect(v.errors.some((e) => e.includes("ghost"))).toBe(true);
  });

  it("rejects a missing entry step", () => {
    const v = validateFlow({ type: "manual", entryStepId: "nope" }, [{ id: "a", type: "send_email" }]);
    expect(v.errors[0]).toMatch(/trigger/i);
  });

  it("flags config issues and unreachable steps without blocking save", () => {
    const v = validateFlow(trigger, [
      { id: "call", type: "make_call", next: null },
      { id: "lost", type: "delay" },
    ]);
    expect(v.errors).toEqual([]);
    expect(v.issues.map((i) => i.stepId)).toEqual(["call", "lost", "lost"]);
  });

  it("unconnected trigger is an issue, not a save error", () => {
    const v = validateFlow({ type: "manual", entryStepId: null }, [
      { id: "call", type: "make_call", agentId: 1, next: null },
    ]);
    expect(v.errors).toEqual([]);
    expect(v.issues).toEqual([{ stepId: null, message: "Connect the trigger to the first step" }]);
  });

  it("allows retry loops", () => {
    const v = validateFlow(trigger, [
      { id: "call", type: "make_call", agentId: 1, next: "check" },
      { id: "check", type: "condition", field: "call.connected", op: "eq", value: "false", onTrue: "wait", onFalse: null },
      { id: "wait", type: "delay", delaySeconds: 86400, next: "call" },
    ]);
    expect(v).toEqual({ errors: [], issues: [] });
  });
});
