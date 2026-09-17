import { describe, it, expect } from "vitest";
import type { CandidateIntake } from "@workspace/db";
import {
  buildIntakeReturnBlock,
  combineCallbackAt,
  intakeCallerName,
  intakeSpokenName,
  lastTenDigits,
  nextIntakeAsk,
  renderIntakeGreeting,
  resolveIntakeOpenKind,
} from "./intake-call-context.js";

describe("intakeSpokenName", () => {
  it("uses the first word so Irfan Sharma speaks as Irfan", () => {
    expect(intakeSpokenName("Irfan")).toBe("Irfan");
    expect(intakeSpokenName("Irfan Sharma")).toBe("Irfan");
  });
});

describe("lastTenDigits", () => {
  it("collapses +91 and a 10-digit mobile onto the same key", () => {
    expect(lastTenDigits("+91 98765 43210")).toBe("9876543210");
    expect(lastTenDigits("09876543210")).toBe("9876543210");
    expect(lastTenDigits("9876543210")).toBe("9876543210");
  });

  it("rejects a number too short to be a mobile", () => {
    expect(lastTenDigits("123")).toBeNull();
    expect(lastTenDigits(null)).toBeNull();
  });
});

describe("resolveIntakeOpenKind", () => {
  it("picks resume over return when the previous leg dropped", () => {
    expect(resolveIntakeOpenKind({
      hasPriorIntake: true,
      sourceCallbackReason: "network_drop",
    })).toBe("resume");
  });

  it("picks callback when we are the ones ringing them", () => {
    expect(resolveIntakeOpenKind({
      hasPriorIntake: true,
      sourceCallbackReason: "callback_requested",
    })).toBe("callback");
  });

  it("picks return when they ring us again", () => {
    expect(resolveIntakeOpenKind({ hasPriorIntake: true })).toBe("return");
  });

  it("picks first when we have never spoken", () => {
    expect(resolveIntakeOpenKind({ hasPriorIntake: false })).toBe("first");
  });
});

describe("renderIntakeGreeting", () => {
  it("names the agent on a first call and asks how it can help", () => {
    const line = renderIntakeGreeting({ kind: "first", agentName: "Irfan" });
    expect(line).toContain("this is Irfan");
    expect(line).toContain("Jobshop");
    expect(line).toContain("How may I assist you");
    expect(line).not.toContain("Meera");
    expect(line).not.toContain("Could I take your name");
    expect(line).not.toContain("recruitment team");
    expect(line).not.toContain("openings in Bangalore");
  });

  it("recognises a returning caller and asks the next open question", () => {
    const line = renderIntakeGreeting({
      kind: "return",
      agentName: "Irfan",
      callerName: "Priya Raman",
      nextAsk: "Are you a graduate or a post graduate?",
    });
    expect(line).toContain("Hi Priya");
    expect(line).toContain("this is Irfan");
    expect(line).toContain("good to hear from you again");
    expect(line).toContain("Are you a graduate or a post graduate?");
    expect(line).not.toContain("left off");
    expect(line).not.toContain("Could I take your name");
  });

  it("asks how it can help when the previous screen is already complete", () => {
    const line = renderIntakeGreeting({
      kind: "return",
      agentName: "Irfan",
      callerName: "Priya",
    });
    expect(line).toContain("How can I help you today?");
    expect(line).not.toContain("left off");
  });

  it("on a drop, names them and continues the last question", () => {
    const line = renderIntakeGreeting({
      kind: "resume",
      agentName: "Irfan",
      callerName: "Priya",
      nextAsk: "Can you do a US or night shift?",
    });
    expect(line).toContain("we got disconnected");
    expect(line).toContain("Can you do a US or night shift?");
    expect(line).not.toContain("where we were");
    expect(line).not.toContain("left off");
  });

  it("says we are calling back as discussed", () => {
    const line = renderIntakeGreeting({
      kind: "callback",
      agentName: "Irfan",
      callerName: "Priya",
    });
    expect(line).toContain("calling you back as we discussed");
    expect(line).toContain("Irfan");
  });
});

describe("combineCallbackAt", () => {
  it("builds an Asia/Kolkata instant from date and time", () => {
    const at = combineCallbackAt("2026-09-18", "15:30", new Date("2026-09-17T00:00:00+05:30"));
    expect(at?.toISOString()).toBe("2026-09-18T10:00:00.000Z");
  });

  it("defaults a missing time to 11:00", () => {
    const at = combineCallbackAt("2026-09-18", null, new Date("2026-09-17T00:00:00+05:30"));
    expect(at?.toISOString()).toBe("2026-09-18T05:30:00.000Z");
  });

  it("rejects a missing date", () => {
    expect(combineCallbackAt(null, "15:30")).toBeNull();
  });
});

describe("buildIntakeReturnBlock", () => {
  function row(over: Partial<CandidateIntake> = {}): CandidateIntake {
    return {
      id: 1,
      publicToken: "tok",
      userId: "u",
      agentId: 9,
      callId: 1,
      status: "in_progress",
      firstName: "Priya",
      lastName: "Raman",
      phone: "9876543210",
      email: "p@x.com",
      gender: "FEMALE",
      dateOfBirth: "1999-01-01",
      workStatus: "FRESHER",
      totalCompanies: 0,
      city: "BENGALURU",
      jobCity: "BENGALURU",
      skillRole: "EXECUTIVE_SR_EXECUTIVE",
      skill: "INTERNATIONAL_VOICE_PROCESS",
      industry: "BPO_CALL_CENTER",
      qualification: null,
      shiftBase: null,
      dnd: "DEACTIVATE",
      englishCommunication: "GOOD",
      extra: {},
      revision: 1,
      lastFieldKey: null,
      lastWriteSource: "agent",
      createdAt: new Date(),
      updatedAt: new Date(),
      ...over,
    };
  }

  it("lists captured facts and the still-needed ones", () => {
    const block = buildIntakeReturnBlock(row());
    expect(block).toContain("first name: Priya");
    expect(block).toContain("Still needed:");
    expect(block).toContain("qualification");
    expect(block).toContain("Are you a graduate or a post graduate?");
    expect(block).not.toContain("Could I take your name");
    expect(intakeCallerName(row())).toBe("Priya");
    expect(nextIntakeAsk(row())).toBe("Are you a graduate or a post graduate?");
  });

  it("tells the agent not to restart when everything is already in", () => {
    const block = buildIntakeReturnBlock(row({
      qualification: "GRADUATE",
      shiftBase: "US",
    }));
    expect(block).toContain("Every required field is already captured");
    expect(block).toContain("how you can help");
    expect(nextIntakeAsk(row({
      qualification: "GRADUATE",
      shiftBase: "US",
    }))).toBeNull();
  });
});
