import { describe, expect, it } from "vitest";
import {
  isEagerCommitReady,
  isQueuedDuplicateUserTurn,
  isSameUtteranceContinuation,
  isSpeculativeHit,
  looksLikeRepeatedSttHallucination,
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

  it("speechEnd still needs a stable clause — not 1–2 word scraps or spelling", () => {
    expect(isEagerCommitReady("I want to know how", { speechEnd: true })).toBe(true);
    expect(isEagerCommitReady("premium budget", { speechEnd: true })).toBe(false);
    expect(isEagerCommitReady("Three", { speechEnd: true })).toBe(false);
    expect(isEagerCommitReady("For what sir?", { speechEnd: true })).toBe(true);
    expect(isEagerCommitReady("R T H I K E Y A N.@they might", { speechEnd: true })).toBe(false);
    expect(isEagerCommitReady("KARETHIAEYAN@gmail.com", { speechEnd: true })).toBe(true);
    expect(isEagerCommitReady("9876543210", { speechEnd: true })).toBe(true);
  });

  it("rejects repeated English STT hallucinations (call 21546)", () => {
    expect(looksLikeRepeatedSttHallucination("Right, next question. Next question, next question.")).toBe(true);
    expect(looksLikeRepeatedSttHallucination("I mean, even, even, even, even, even, even,")).toBe(true);
    expect(looksLikeRepeatedSttHallucination("I want to know about the policy")).toBe(false);
    expect(isEagerCommitReady("Right, next question. Next question, next question.", { speechEnd: true })).toBe(false);
    expect(isEagerCommitReady("I mean, even, even, even, even, even, even,", { speechEnd: true })).toBe(false);
  });

  it("on an Indic-pinned agent, refuses English-decoder scraps but keeps real English and Tanglish", () => {
    expect(isEagerCommitReady("I want to win.", { speechEnd: true, indicPinned: true })).toBe(false);
    expect(isEagerCommitReady("Well, tell me,", { speechEnd: true, indicPinned: true })).toBe(false);
    expect(isEagerCommitReady("Welcome, madam.", { speechEnd: true, indicPinned: true })).toBe(false);
    expect(isEagerCommitReady("I want to know about the policy", { speechEnd: true, indicPinned: true })).toBe(true);
    expect(isEagerCommitReady("Aa Madam enakku oru 3 kodi thevaipaduthu", { speechEnd: true, indicPinned: true })).toBe(true);
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

  it("matches last-word STT completion (call 21189 continu → continue)", () => {
    expect(isSpeculativeHit("Yes sir, you can continu", "Yes sir you can continue")).toBe(true);
    expect(isSpeculativeHit("Uh, sir, maybe day after tom", "Uh, sir, maybe day after tomorrow.")).toBe(false);
    expect(isSpeculativeHit("I want to participate in the", "I want to participate in theater")).toBe(false);
  });

  it("matches a leading ack prepended on the final (call 21264)", () => {
    expect(isSpeculativeHit("Can you schedule me a demo?", "Yes, can you schedule me a demo?")).toBe(true);
    expect(isSpeculativeHit(
      "Yeah, yeah, yeah, I want, yeah, I want to go.",
      "Yeah, yeah, yeah, I want to. Yeah, I want to go.",
    )).toBe(false);
  });

  it("matches comma / case-only STT variants (call 20686)", () => {
    expect(isSpeculativeHit("Hello, sir.", "Hello Sir")).toBe(true);
    expect(isSpeculativeHit("Hello, sir.", "hello sir")).toBe(true);
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

describe("isSameUtteranceContinuation", () => {
  it("treats a longer partial as the same unfinished utterance (call 21450)", () => {
    expect(isSameUtteranceContinuation(
      "So, a good doctor should",
      "So, a good doctor should be considered",
    )).toBe(true);
    expect(isSameUtteranceContinuation(
      "So, a good doctor should be considered",
      "So, a good doctor should",
    )).toBe(true);
  });

  it("does not treat a new thought as a continuation", () => {
    expect(isSameUtteranceContinuation(
      "So, a good doctor should",
      "Wait, I need to stop you",
    )).toBe(false);
    expect(isSameUtteranceContinuation("yes", "no I want to book")).toBe(false);
  });
});

describe("isQueuedDuplicateUserTurn", () => {
  it("does not barge a restated shift answer (call 25218)", () => {
    expect(isQueuedDuplicateUserTurn(
      "I'm okay with it",
      "I'm okay with both the shifts.",
    )).toBe(true);
  });

  it("still treats a new question as a real barge", () => {
    expect(isQueuedDuplicateUserTurn(
      "I'm okay with it",
      "What was the reason like don't you have any job opening",
    )).toBe(false);
  });
});

describe("reconcileSpeculativePrefill", () => {
  it("commits last-token completion when the snapshot is the same clause (call 21189)", () => {
    const hit = reconcileSpeculativePrefill({
      aborted: false,
      hasToolCall: false,
      langAtLaunch: "en-IN",
      langNow: "en-IN",
      inputHash: speculativeInputHash("Yes sir, you can continu"),
      finalTranscript: "Yes sir you can continue",
      partialSnapshot: "Yes sir, you can continu",
    });
    expect(hit.action).toBe("commit");
    expect(hit.reason).toBe("last_token_completion");
  });

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

  it("discards when the prefill belongs to an older turnGeneration", () => {
    const text = "I want to participate in the hackathon.";
    const miss = reconcileSpeculativePrefill({
      aborted: false,
      hasToolCall: false,
      langAtLaunch: "en-IN",
      langNow: "en-IN",
      inputHash: speculativeInputHash(text),
      finalTranscript: text,
      pendingTurnId: 3,
      turnGeneration: 4,
    });
    expect(miss.action).toBe("discard");
    expect(miss.reason).toBe("stale_turn");
  });
});
