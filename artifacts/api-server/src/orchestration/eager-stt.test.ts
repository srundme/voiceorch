import { describe, expect, it } from "vitest";
import { isEagerCommitReady, isSpeculativeHit } from "./eager-stt.js";

describe("isEagerCommitReady", () => {
  it("accepts terminal punctuation", () => {
    expect(isEagerCommitReady("I want to know.")).toBe(true);
  });

  it("rejects pure backchannel acks (wait for coalesce / final question)", () => {
    expect(isEagerCommitReady("okay")).toBe(false);
    expect(isEagerCommitReady("சரி")).toBe(false);
    expect(isEagerCommitReady("ஆமா")).toBe(false);
    expect(isEagerCommitReady("சரிங்க")).toBe(false);
    expect(isEagerCommitReady("okay sir")).toBe(false);
    expect(isEagerCommitReady("ஆமா", { speechEnd: true })).toBe(false);
  });

  it("rejects very short dangling partial without speechEnd", () => {
    expect(isEagerCommitReady("I want")).toBe(false);
  });

  it("accepts two-word Indic content of length >= 8 without speechEnd", () => {
    expect(isEagerCommitReady("எங்க சார்")).toBe(true);
  });

  it("accepts longer partials even without speechEnd", () => {
    expect(isEagerCommitReady("I want to know how")).toBe(true);
  });

  it("relaxes for speechEnd (Sarvam VAD committed) on content — not acks", () => {
    expect(isEagerCommitReady("I want to know how", { speechEnd: true })).toBe(true);
    expect(isEagerCommitReady("premium budget", { speechEnd: true })).toBe(true);
  });
});

describe("isSpeculativeHit", () => {
  it("matches identical partial and final", () => {
    expect(isSpeculativeHit("I want to know how", "I want to know how")).toBe(true);
  });

  it("matches when final extends partial within 24 trailing chars", () => {
    expect(
      isSpeculativeHit("I want to know how", "I want to know how I can benefit."),
    ).toBe(true);
    expect(
      isSpeculativeHit(
        "நான் demo வரதுக்கு",
        "நான் demo வரதுக்கு முன்னாடி என்ன விஷயம்",
      ),
    ).toBe(true);
  });

  it("misses when final diverges", () => {
    expect(isSpeculativeHit("Explain பண்ணுங்க", "ஒரு short English letter")).toBe(false);
  });
});
