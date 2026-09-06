import { describe, expect, it } from "vitest";
import { capHandoffTranscript, mergeHandoffTranscript } from "./squad-transcript.js";

describe("mergeHandoffTranscript", () => {
  it("keeps pre-handoff caller and agent turns when the second pipeline starts empty", () => {
    const prior = "Caller: I need to book a visit\nAgent: Sure, transferring you to scheduling";
    const after = "Agent: Hi — I've been briefed. What day works?\nCaller: Tuesday";
    expect(mergeHandoffTranscript(prior, after)).toBe(
      `${prior}\n--- handoff ---\n${after}`,
    );
  });

  it("returns only the current side when there was no handoff", () => {
    expect(mergeHandoffTranscript("", "Caller: Hello\nAgent: Hi")).toBe("Caller: Hello\nAgent: Hi");
  });

  it("returns only prior when the new pipeline has not spoken yet", () => {
    expect(mergeHandoffTranscript("Caller: Hi", "")).toBe("Caller: Hi");
  });

  it("ignores blank sides", () => {
    expect(mergeHandoffTranscript("  ", "  ")).toBe("");
  });
});

describe("capHandoffTranscript", () => {
  it("keeps the newest characters when over the cap", () => {
    expect(capHandoffTranscript("abcdefghij", 4)).toBe("ghij");
  });
});
