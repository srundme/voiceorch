import { describe, it, expect } from "vitest";
import { makeGeminiPreambleGuard, stripGeminiThinkingPreamble } from "./google.js";

// Stream a reply through the guard in arbitrary chunks, collect the spoken output.
function runStream(chunks: string[]): string {
  const guard = makeGeminiPreambleGuard();
  return chunks.map((c) => guard(c)).join("");
}

describe("stripGeminiThinkingPreamble (final reply)", () => {
  it("leaves a normal reply untouched", () => {
    expect(stripGeminiThinkingPreamble("Hello there! How can I help?")).toBe(
      "Hello there! How can I help?",
    );
  });

  it("drops leading bracketed state/context lines", () => {
    const input =
      "[DATE/TIME CONTEXT] Monday June 30\n[LLM state] State is `wellness_intro`\nHi, welcome to the clinic.";
    expect(stripGeminiThinkingPreamble(input)).toBe("Hi, welcome to the clinic.");
  });

  it("cuts a planning narration ending in a 'New response …:' handoff", () => {
    const input =
      "The user seems to have asked about pricing. I should acknowledge it. New response based on user's question: Our plan is $5 a month.";
    expect(stripGeminiThinkingPreamble(input)).toBe("Our plan is $5 a month.");
  });

  it("strips brackets then cuts the handoff in one pass", () => {
    const input =
      "[LLM state] State is `intro`\nThe user greeted me. I will greet back. New response: Hi! Lovely to meet you.";
    expect(stripGeminiThinkingPreamble(input)).toBe("Hi! Lovely to meet you.");
  });

  it("does NOT cut when the handoff phrase appears without planning cues", () => {
    const input = "Here is the new response: it works great.";
    expect(stripGeminiThinkingPreamble(input)).toBe(
      "Here is the new response: it works great.",
    );
  });

  it("does not touch a bracketed token inside a genuine reply", () => {
    const input = "Your code is [12345] and it expires soon.";
    expect(stripGeminiThinkingPreamble(input)).toBe(
      "Your code is [12345] and it expires soon.",
    );
  });
});

describe("makeGeminiPreambleGuard (streaming)", () => {
  it("passes a normal reply through unchanged", () => {
    expect(runStream(["Hello ", "there!"])).toBe("Hello there!");
  });

  it("never delays the first token of a normal reply", () => {
    const guard = makeGeminiPreambleGuard();
    expect(guard("Hi")).toBe("Hi");
  });

  it("drops a leading bracketed line split across tokens", () => {
    expect(
      runStream(["[DATE/TIME", " CONTEXT] Mon", "day\n", "Hello there"]),
    ).toBe("Hello there");
  });

  it("drops planning narration up to a handoff already visible in the buffer", () => {
    expect(
      runStream([
        "The user asked a question. I should reply. New response: ",
        "Sure, happy to help!",
      ]),
    ).toBe("Sure, happy to help!");
  });

  it("releases reply text after a stripped context line", () => {
    expect(runStream(["[LLM state] x\n", "Okay, ", "let's begin."])).toBe(
      "Okay, let's begin.",
    );
  });
});
