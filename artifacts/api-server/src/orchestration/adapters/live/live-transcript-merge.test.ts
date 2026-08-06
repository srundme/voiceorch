import { describe, expect, it } from "vitest";
import { mergeTranscriptFragment } from "./live-transcript-merge.js";

describe("mergeTranscriptFragment", () => {
  it("joins syllable deltas without spaces", () => {
    expect(mergeTranscriptFragment("hel", "lo")).toBe("hello");
    expect(mergeTranscriptFragment("683", "653279")).toBe("683653279");
  });

  it("replaces when cumulative", () => {
    expect(mergeTranscriptFragment("hel", "hello")).toBe("hello");
  });

  it("keeps longer buffer when older partial arrives", () => {
    expect(mergeTranscriptFragment("hello", "hel")).toBe("hello");
  });

  it("handles empty", () => {
    expect(mergeTranscriptFragment("", "hi")).toBe("hi");
    expect(mergeTranscriptFragment("hi", "")).toBe("hi");
  });
});
