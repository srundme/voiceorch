import { describe, it, expect } from "vitest";
import { voiceLinkAckPhrase } from "./endpointing.js";

describe("voiceLinkAckPhrase", () => {
  it("addresses the matched caller by name immediately", () => {
    const text = voiceLinkAckPhrase("en-IN", "Bhavya");
    expect(text).toContain("Bhavya");
    expect(text.toLowerCase()).toMatch(/^hi\b/);
    expect(text).not.toMatch(/\?/);
  });

  it("falls back to a generic line when the name is missing", () => {
    const text = voiceLinkAckPhrase("en", null);
    expect(text.toLowerCase()).toMatch(/hear from you again|spoke before/);
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
