import { describe, it, expect } from "vitest";
import {
  truncateToSingleStep,
  makeFlowStepGuard,
  isHoldRequest,
  isQuestionUtterance,
  isBareAcknowledgement,
  buildAntiRepeatNudge,
} from "./conversationDiscipline.js";

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

describe("caller-utterance intent gating (call 1915)", () => {
  describe("isHoldRequest", () => {
    it("detects English hold requests", () => {
      expect(isHoldRequest("wait")).toBe(true);
      expect(isHoldRequest("hold on a second")).toBe(true);
      expect(isHoldRequest("give me one minute, I'm installing the app")).toBe(true);
      expect(isHoldRequest("just a moment please")).toBe(true);
    });
    it("detects Tamil hold requests (script + romanized)", () => {
      expect(isHoldRequest("ஒரு நிமிஷம் இருங்க")).toBe(true);
      expect(isHoldRequest("கொஞ்சம் இருங்க")).toBe(true);
      expect(isHoldRequest("oru nimisham irunga")).toBe(true);
      expect(isHoldRequest("porunga")).toBe(true);
    });
    it("detects Hindi hold requests (script + romanized)", () => {
      expect(isHoldRequest("एक मिनट रुकिए")).toBe(true);
      expect(isHoldRequest("ek minute ruko")).toBe(true);
    });
    it("does not fire on ordinary replies", () => {
      expect(isHoldRequest("yes I am interested")).toBe(false);
      expect(isHoldRequest("okay")).toBe(false);
      expect(isHoldRequest("சரி")).toBe(false);
    });
  });

  describe("isQuestionUtterance", () => {
    it("detects explicit question marks", () => {
      expect(isQuestionUtterance("Is this covered?")).toBe(true);
    });
    it("detects English interrogatives without a question mark", () => {
      expect(isQuestionUtterance("how do I claim the insurance")).toBe(true);
      expect(isQuestionUtterance("what is the premium amount")).toBe(true);
      expect(isQuestionUtterance("tell me about the policy")).toBe(true);
    });
    it("detects Tamil questions (script + romanized)", () => {
      expect(isQuestionUtterance("claim எப்படி பண்றது")).toBe(true);
      expect(isQuestionUtterance("எவ்வளவு ஆகும்")).toBe(true);
      expect(isQuestionUtterance("claim eppadi pannuvadhu")).toBe(true);
    });
    it("detects Hindi questions (script + romanized)", () => {
      expect(isQuestionUtterance("क्लेम कैसे करें")).toBe(true);
      expect(isQuestionUtterance("kitna paisa lagega")).toBe(true);
    });
    it("does not fire on plain statements or acks", () => {
      expect(isQuestionUtterance("okay fine")).toBe(false);
      expect(isQuestionUtterance("I already have insurance")).toBe(false);
      expect(isQuestionUtterance("சரி சரி")).toBe(false);
    });
  });

  describe("isBareAcknowledgement", () => {
    it("accepts short acks across languages", () => {
      expect(isBareAcknowledgement("okay")).toBe(true);
      expect(isBareAcknowledgement("hmm")).toBe(true);
      expect(isBareAcknowledgement("haan ji")).toBe(true);
      expect(isBareAcknowledgement("theek hai")).toBe(true);
      expect(isBareAcknowledgement("சரி")).toBe(true);
      expect(isBareAcknowledgement("ok fine.")).toBe(true);
    });
    it("rejects hold requests, questions, and substantive replies", () => {
      expect(isBareAcknowledgement("okay wait")).toBe(false);
      expect(isBareAcknowledgement("okay how much")).toBe(false);
      expect(isBareAcknowledgement("yes I want the premium plan")).toBe(false);
      expect(isBareAcknowledgement("")).toBe(false);
    });
  });

  describe("buildAntiRepeatNudge", () => {
    const prevLine = "Please install the app and let me know.";

    it("hold request → wait directive, never an advance push", () => {
      const n = buildAntiRepeatNudge({ lastUserText: "wait, I'm installing it", prevLine, escalated: false });
      expect(n).toContain("CALLER ASKED TO WAIT");
      expect(n).not.toMatch(/advance to the next point/i);
    });

    it("question → answer-first directive", () => {
      const n = buildAntiRepeatNudge({ lastUserText: "claim எப்படி பண்றது", prevLine, escalated: false });
      expect(n).toContain("ANSWER THE QUESTION FIRST");
      expect(n).not.toMatch(/advance to the next point/i);
    });

    it("bare ack → original advance nudge", () => {
      const n = buildAntiRepeatNudge({ lastUserText: "okay", prevLine, escalated: false });
      expect(n).toContain("advance to the next point");
      expect(n).toContain(prevLine);
    });

    it("bare ack + escalated → critical move-forward variant", () => {
      const n = buildAntiRepeatNudge({ lastUserText: "hmm", prevLine, escalated: true });
      expect(n).toContain("CRITICAL");
      expect(n).toContain("FORWARD");
    });

    it("substantive reply → neutral do-not-repeat (no advance push)", () => {
      const n = buildAntiRepeatNudge({ lastUserText: "I already have a policy with another company", prevLine, escalated: false });
      expect(n).toContain("DO NOT REPEAT");
      expect(n).toContain("Respond directly to what the caller just said");
      expect(n).not.toMatch(/advance to the next point/i);
    });

    it("hold request wins even when escalated", () => {
      const n = buildAntiRepeatNudge({ lastUserText: "one minute please", prevLine, escalated: true });
      expect(n).toContain("CALLER ASKED TO WAIT");
    });
  });
});
