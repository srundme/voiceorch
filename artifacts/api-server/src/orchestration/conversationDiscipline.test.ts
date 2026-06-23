import { describe, it, expect } from "vitest";
import { truncateToSingleStep, makeFlowStepGuard } from "./conversationDiscipline.js";

describe("truncateToSingleStep (whole-string)", () => {
  it("leaves a single-question turn untouched", () => {
    const r = truncateToSingleStep("We offer free delivery. Would you like to book?");
    expect(r.truncated).toBe(false);
    expect(r.text).toBe("We offer free delivery. Would you like to book?");
  });

  it("truncates after the first question when two or more are present", () => {
    const r = truncateToSingleStep(
      "What is your name? Also, what is your email? And your number?",
    );
    expect(r.truncated).toBe(true);
    expect(r.text).toBe("What is your name?");
  });

  it("keeps leading statements before the first question", () => {
    const r = truncateToSingleStep(
      "Great, thanks. Which date works for you? What time suits you?",
    );
    expect(r.truncated).toBe(true);
    expect(r.text).toBe("Great, thanks. Which date works for you?");
  });

  it("does not truncate a turn with no questions", () => {
    const r = truncateToSingleStep("Thanks for your time. Have a great day.");
    expect(r.truncated).toBe(false);
    expect(r.text).toBe("Thanks for your time. Have a great day.");
  });

  it("tolerates a trailing quote/bracket after the question mark", () => {
    const r = truncateToSingleStep('Shall we proceed?" And anything else?');
    expect(r.truncated).toBe(true);
    expect(r.text).toBe('Shall we proceed?"');
  });
});

describe("makeFlowStepGuard (streaming)", () => {
  it("passes sentences through until a second question is reached", () => {
    const g = makeFlowStepGuard();
    expect(g.push("We have a great plan.")).toBe("We have a great plan.");
    expect(g.push("Are you interested?")).toBe("Are you interested?");
    expect(g.truncated()).toBe(false);
    // Second question and everything after is suppressed.
    expect(g.push("What is your budget?")).toBe("");
    expect(g.truncated()).toBe(true);
    expect(g.push("And your timeline?")).toBe("");
  });

  it("never suppresses when only one question is asked", () => {
    const g = makeFlowStepGuard();
    expect(g.push("Here is point one.")).toBe("Here is point one.");
    expect(g.push("Does that make sense?")).toBe("Does that make sense?");
    expect(g.push("Great.")).toBe("Great.");
    expect(g.truncated()).toBe(false);
  });

  it("suppresses everything once truncated, even non-question sentences", () => {
    const g = makeFlowStepGuard();
    g.push("First question here?");
    g.push("Second question here?");
    expect(g.truncated()).toBe(true);
    expect(g.push("A trailing statement.")).toBe("");
  });
});
