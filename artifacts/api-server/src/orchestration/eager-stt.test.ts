import { describe, expect, it } from "vitest";
import {
  isEagerCommitReady,
  isSpeculativeHit,
  reconcileSpeculativePrefill,
  speculativeInputHash,
} from "./eager-stt.js";

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

  it("matches trailing punctuation only", () => {
    expect(isSpeculativeHit("Hello", "Hello.")).toBe(true);
    expect(isSpeculativeHit("Hello.", "Hello")).toBe(true);
  });

  it("discards when the final extends the truncated partial (hackathon)", () => {
    expect(
      isSpeculativeHit("I want to participate in the...", "I want to participate in the hackathon."),
    ).toBe(false);
    expect(
      isSpeculativeHit("I want to know how", "I want to know how I can benefit."),
    ).toBe(false);
    expect(
      isSpeculativeHit(
        "நான் demo வரதுக்கு",
        "நான் demo வரதுக்கு முன்னாடி என்ன விஷயம்",
      ),
    ).toBe(false);
  });

  it("misses when final diverges", () => {
    expect(isSpeculativeHit("Explain பண்ணுங்க", "ஒரு short English letter")).toBe(false);
  });
});

describe("reconcileSpeculativePrefill", () => {
  it("commits only when the final hash matches the speculative input", () => {
    const partial = "I want to participate in the hackathon.";
    const hit = reconcileSpeculativePrefill({
      aborted: false,
      hasToolCall: false,
      langAtLaunch: "en-IN",
      langNow: "en-IN",
      inputHash: speculativeInputHash(partial),
      finalTranscript: partial,
    });
    expect(hit.action).toBe("commit");
    expect(hit.reason).toBe("hash_match");
  });

  it("discards when STT adds content after the partial snapshot", () => {
    const miss = reconcileSpeculativePrefill({
      aborted: false,
      hasToolCall: false,
      langAtLaunch: "en-IN",
      langNow: "en-IN",
      inputHash: speculativeInputHash("I want to participate in the..."),
      finalTranscript: "I want to participate in the hackathon.",
    });
    expect(miss.action).toBe("discard");
    expect(miss.reason).toBe("transcript_changed");
  });

  it("discards on language switch even if the text matches", () => {
    const text = "I want to participate in the hackathon.";
    const miss = reconcileSpeculativePrefill({
      aborted: false,
      hasToolCall: false,
      langAtLaunch: "en-IN",
      langNow: "ta-IN",
      inputHash: speculativeInputHash(text),
      finalTranscript: text,
    });
    expect(miss.action).toBe("discard");
    expect(miss.reason).toBe("language_switched");
  });
});
