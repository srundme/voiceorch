import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {},
  callRecordingsTable: {},
  candidateIntakesTable: {},
}));

vi.mock("../../../services/tool-executor.js", () => ({
  buildToolDefs: (tools: Array<{ name: string; description: string }>) =>
    tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: { type: "object", properties: {} },
    })),
}));

const executeIntakeWrite = vi.fn(async () => "Saved first name.");
const executeIntakeDisposition = vi.fn(async () => "Outcomes on this call: none.");
const executeIntakeSubmit = vi.fn(async () => "Form closed.");

vi.mock("../../intake-tools.js", () => ({
  executeIntakeWrite: (...args: unknown[]) => executeIntakeWrite(...args),
  executeIntakeDisposition: (...args: unknown[]) => executeIntakeDisposition(...args),
  executeIntakeSubmit: (...args: unknown[]) => executeIntakeSubmit(...args),
}));

vi.mock("../../../lib/intake-service.js", () => ({
  intakeExtraOf: () => ({ dispositionIds: [] }),
  loadIntakeByCallId: vi.fn(async () => null),
}));

vi.mock("../../../lib/intake-screen.js", () => ({
  evaluateIntakeScreen: () => ({ canFinish: false, instruction: "ask city", pitchAllowed: false }),
}));

import { persistIntakeFromSpokenTurn, buildIntakePersistTools } from "./personaplex-intake-persist.js";

describe("PersonaPlex intake persist", () => {
  it("exposes save_candidate_details and set_disposition, not finish_intake", () => {
    const names = buildIntakePersistTools().map((t) => t.name);
    expect(names).toContain("save_candidate_details");
    expect(names).toContain("set_disposition");
    expect(names).not.toContain("finish_intake");
    expect(names).not.toContain("end_call");
  });

  it("does nothing on empty caller text", async () => {
    executeIntakeWrite.mockClear();
    const result = await persistIntakeFromSpokenTurn({
      llm: { chat: vi.fn() },
      ctx: { callId: 1, agentId: 1241 },
      systemPrompt: "You are Irfan.",
      history: [],
      userText: "   ",
    });
    expect(result.tools).toEqual([]);
    expect(executeIntakeWrite).not.toHaveBeenCalled();
  });

  it("runs save_candidate_details from the persist LLM without speaking", async () => {
    executeIntakeWrite.mockClear();
    const chat = vi.fn(async (_h, _s, _t, onDone, opts?: { onToolCall?: (name: string, args: Record<string, unknown>) => void }) => {
      opts?.onToolCall?.("save_candidate_details", { firstName: "Priya", lastName: "Sharma" });
      onDone("");
    });
    const result = await persistIntakeFromSpokenTurn({
      llm: { chat },
      ctx: { callId: 9, agentId: 1241, callerPhone: "+9198" },
      systemPrompt: "You are Irfan at Jobshop.",
      history: [{ role: "assistant", content: "Can I have your name?" }],
      userText: "Priya Sharma",
      agentText: "Can I have your name?",
    });
    expect(result.tools).toEqual(["save_candidate_details"]);
    expect(executeIntakeWrite).toHaveBeenCalledWith(
      { callId: 9, agentId: 1241, callerPhone: "+9198" },
      { firstName: "Priya", lastName: "Sharma" },
    );
    expect(chat).toHaveBeenCalled();
    const prompt = chat.mock.calls[0]![1] as string;
    expect(prompt).toContain("Priya Sharma");
    expect(prompt).toContain("Do not speak");
  });
});
