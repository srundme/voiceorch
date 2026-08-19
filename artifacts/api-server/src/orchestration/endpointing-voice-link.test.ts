import { describe, it, expect } from "vitest";
import { voiceLinkAckPhrase } from "./endpointing.js";

describe("voiceLinkAckPhrase", () => {
  it("uses the matched name in English", () => {
    expect(voiceLinkAckPhrase("en-IN", "Bhavya")).toContain("Bhavya");
  });

  it("falls back to a generic line when the name is missing", () => {
    const text = voiceLinkAckPhrase("en", null);
    expect(text.toLowerCase()).toMatch(/spoken before|spoke/);
    expect(text).not.toMatch(/undefined|null/i);
  });

  it("does not mention voiceprints or phone numbers", () => {
    const named = voiceLinkAckPhrase("hi", "Bhavya");
    const generic = voiceLinkAckPhrase("ta", "");
    for (const text of [named, generic]) {
      expect(text.toLowerCase()).not.toMatch(/voiceprint|phone|match/);
    }
  });
});
