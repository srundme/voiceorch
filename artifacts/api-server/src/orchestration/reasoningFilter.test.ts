import { describe, it, expect } from "vitest";
import { makeThinkFilter, stripReasoningBlocks } from "./reasoningFilter.js";

// Helper: stream a full reply through the token filter in arbitrary chunks and
// collect the visible (spoken) output.
function runStream(chunks: string[]): string {
  const filter = makeThinkFilter();
  return chunks.map((c) => filter(c)).join("");
}

describe("makeThinkFilter (streaming)", () => {
  it("drops a whole reasoning block delivered in one token", () => {
    expect(runStream(["<think>plan the call</think>Hello there"])).toBe("Hello there");
  });

  it("handles an opening tag split across token boundaries", () => {
    // "<thin" + "king>" must still be recognised as one opening tag.
    expect(runStream(["Hi <thin", "king>secret", "</thinking> bye"])).toBe("Hi  bye");
  });

  it("handles a closing tag split across token boundaries", () => {
    expect(runStream(["<think>secret reasoning</thi", "nk>visible"])).toBe("visible");
  });

  it("strips multiple reasoning blocks in a single stream", () => {
    expect(
      runStream(["<think>a</think>one <reasoning>b</reasoning>two"]),
    ).toBe("one two");
  });

  it("is case-insensitive across tag variants", () => {
    expect(runStream(["<THINK>x</THINK>A<Thinking>y</Thinking>B"])).toBe("AB");
  });

  it("never emits content while inside an unclosed trailing block", () => {
    // Reasoning that never closes must not leak any spoken text.
    expect(runStream(["before <think>endless reasoning that never closes"])).toBe(
      "before ",
    );
  });

  it("does not hold back text that merely looks like a tag prefix but isn't", () => {
    expect(runStream(["less than < three"])).toBe("less than < three");
  });
});

describe("stripReasoningBlocks (whole-string)", () => {
  it("removes a closed block", () => {
    expect(stripReasoningBlocks("<think>plan</think>Hello")).toBe("Hello");
  });

  it("removes an unclosed trailing block to end of string", () => {
    expect(stripReasoningBlocks("Hello <think>never closed...")).toBe("Hello ");
  });

  it("removes all recognised tag types", () => {
    expect(
      stripReasoningBlocks("<thinking>a</thinking>X<reasoning>b</reasoning>Y"),
    ).toBe("XY");
  });

  it("sweeps orphan reasoning tags", () => {
    expect(stripReasoningBlocks("Hello </think> world")).toBe("Hello  world");
  });

  it("leaves ordinary text untouched", () => {
    expect(stripReasoningBlocks("Just a normal sentence.")).toBe(
      "Just a normal sentence.",
    );
  });
});
