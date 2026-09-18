import { describe, it, expect } from "vitest";
import {
  decideKbRetrieval,
  resolveKbRetrievalGateMode,
  runKbRetrievalGate,
  shouldSkipKbRetrieval,
} from "./kb-retrieval-gate.js";

describe("resolveKbRetrievalGateMode", () => {
  it("defaults to off", () => {
    expect(resolveKbRetrievalGateMode({})).toBe("off");
    expect(resolveKbRetrievalGateMode({ KB_RETRIEVAL_GATE: "" })).toBe("off");
    expect(resolveKbRetrievalGateMode({ KB_RETRIEVAL_GATE: "nope" })).toBe("off");
  });

  it("accepts shadow and on", () => {
    expect(resolveKbRetrievalGateMode({ KB_RETRIEVAL_GATE: "shadow" })).toBe("shadow");
    expect(resolveKbRetrievalGateMode({ KB_RETRIEVAL_GATE: "ON" })).toBe("on");
  });
});

describe("decideKbRetrieval — skip conversational", () => {
  const skip = [
    "Okay",
    "Hmm",
    "Yes",
    "No",
    "Can you repeat that?",
    "okay sir",
    "சரி",
    "thanks",
    "hello",
  ];
  for (const utterance of skip) {
    it(`skips "${utterance}"`, () => {
      const r = decideKbRetrieval(utterance);
      expect(r.decision).toBe("skip");
      expect(r.reason).toBe("conversational");
    });
  }
});

describe("decideKbRetrieval — skip caller facts", () => {
  const skip = [
    "My name is Karthik",
    "I have 2 years experience",
    "I'm from Chennai",
    "I am a fresher",
    "I live in Chennai",
  ];
  for (const utterance of skip) {
    it(`skips "${utterance}"`, () => {
      const r = decideKbRetrieval(utterance);
      expect(r.decision).toBe("skip");
      expect(r.reason).toBe("caller_fact");
    });
  }
});

describe("decideKbRetrieval — retrieve factual", () => {
  const retrieve = [
    "What's the salary?",
    "Is transport provided?",
    "Can freshers apply?",
    "What's covered in this policy?",
    "Which hospitals are covered?",
    "What are the exclusions?",
    "What about transport?",
    "How much?",
    "Is it free?",
    "Can graduates apply?",
    "What about girls?",
    "How many days?",
  ];
  for (const utterance of retrieve) {
    it(`retrieves "${utterance}"`, () => {
      const r = decideKbRetrieval(utterance);
      expect(r.decision).toBe("retrieve");
      expect(r.reason).toBe("factual_question");
    });
  }
});

describe("decideKbRetrieval — fail open", () => {
  it("treats unknown statements as retrieve/unclear", () => {
    const r = decideKbRetrieval("Tell them I'll join Monday after I check with my manager.");
    expect(r.decision).toBe("retrieve");
    expect(r.reason).toBe("unclear");
  });

  it("runKbRetrievalGate never throws and records decisionMs", () => {
    const r = runKbRetrievalGate("Okay");
    expect(r.decision).toBe("skip");
    expect(r.reason).toBe("conversational");
    expect(r.utterance).toBe("Okay");
    expect(r.decisionMs).toBeGreaterThanOrEqual(0);
    expect(r.decisionMs).toBeLessThan(50);
  });
});

describe("shouldSkipKbRetrieval", () => {
  it("only skips when mode is on", () => {
    expect(shouldSkipKbRetrieval("off", "skip")).toBe(false);
    expect(shouldSkipKbRetrieval("shadow", "skip")).toBe(false);
    expect(shouldSkipKbRetrieval("on", "skip")).toBe(true);
    expect(shouldSkipKbRetrieval("on", "retrieve")).toBe(false);
  });
});
