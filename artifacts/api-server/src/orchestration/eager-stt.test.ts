import { describe, expect, it } from "vitest";
import { isEagerCommitReady, isSpeculativeHit } from "./eager-stt.js";

describe("isEagerCommitReady", () => {
  it("accepts terminal punctuation", () => {
    expect(isEagerCommitReady("I want to know.")).toBe(true);
  });

  it("accepts short affirmations", () => {
    expect(isEagerCommitReady("okay")).toBe(true);
    expect(isEagerCommitReady("சரி")).toBe(true);
  });

  it("rejects very short dangling partial without speechEnd", () => {
    expect(isEagerCommitReady("I want")).toBe(false);
  });

  it("accepts longer partials even without speechEnd", () => {
    expect(isEagerCommitReady("I want to know how")).toBe(true);
  });

  it("relaxes for speechEnd (Sarvam VAD committed)", () => {
    expect(isEagerCommitReady("I want to know how", { speechEnd: true })).toBe(true);
    expect(isEagerCommitReady("premium budget", { speechEnd: true })).toBe(true);
  });
});

describe("isSpeculativeHit", () => {
  it("matches identical partial and final", () => {
    expect(isSpeculativeHit("I want to know how", "I want to know how")).toBe(true);
  });

  it("matches when final extends partial slightly", () => {
    expect(
      isSpeculativeHit("I want to know how", "I want to know how I can benefit."),
    ).toBe(true);
  });

  it("misses when final diverges", () => {
    expect(isSpeculativeHit("Explain பண்ணுங்க", "ஒரு short English letter")).toBe(false);
  });
});
