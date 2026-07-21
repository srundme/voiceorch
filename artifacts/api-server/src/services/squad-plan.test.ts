import { describe, it, expect } from "vitest";
import { validatePlannedSteps, heuristicPlan, mergeLimits } from "./squad-plan.js";
import type { SquadMember } from "@workspace/db/schema";

function member(partial: Partial<SquadMember> & { id: number; agentId: number; roleName: string }): SquadMember {
  return {
    squadId: 1,
    roleType: "specialist",
    instructions: null,
    allowedTools: [],
    sortOrder: 0,
    handoffEnabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  } as SquadMember;
}

describe("validatePlannedSteps", () => {
  const members = [
    member({ id: 1, agentId: 10, roleName: "Supervisor", roleType: "supervisor" }),
    member({ id: 2, agentId: 20, roleName: "Researcher" }),
  ];
  const limits = mergeLimits({});

  it("accepts a valid plan", () => {
    const result = validatePlannedSteps([
      { type: "agent_reason", memberId: 2, objective: "Research" },
      { type: "supervisor_review", memberId: 1, objective: "Review" },
    ], members, limits);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.steps).toHaveLength(2);
  });

  it("rejects unknown member", () => {
    const result = validatePlannedSteps([
      { type: "agent_reason", memberId: 99, objective: "Nope" },
    ], members, limits);
    expect(result.ok).toBe(false);
  });

  it("rejects handoff without target", () => {
    const result = validatePlannedSteps([
      { type: "handoff_agent", memberId: 1 },
    ], members, limits);
    expect(result.ok).toBe(false);
  });

  it("rejects empty plan", () => {
    const result = validatePlannedSteps([], members, limits);
    expect(result.ok).toBe(false);
  });
});

describe("heuristicPlan", () => {
  it("builds reason + review steps", () => {
    const members = [
      member({ id: 1, agentId: 10, roleName: "Supervisor", roleType: "supervisor" }),
      member({ id: 2, agentId: 20, roleName: "Caller" }),
    ];
    const plan = heuristicPlan("Qualify the lead", members);
    expect(plan.length).toBeGreaterThanOrEqual(1);
    expect(plan.some((s) => s.type === "agent_reason")).toBe(true);
  });
});
