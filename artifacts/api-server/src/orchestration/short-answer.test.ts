import { describe, expect, it } from "vitest";
import {
  isClosedQuestion,
  isShortAnswerVocabulary,
  shouldAcceptCallerInterrupt,
  shouldAcceptContextualShortAnswer,
} from "./short-answer.js";

describe("isShortAnswerVocabulary", () => {
  it("accepts English and Tamil confirmations", () => {
    expect(isShortAnswerVocabulary("yes")).toBe(true);
    expect(isShortAnswerVocabulary("yeah")).toBe(true);
    expect(isShortAnswerVocabulary("okay")).toBe(true);
    expect(isShortAnswerVocabulary("ஆம்")).toBe(true);
    expect(isShortAnswerVocabulary("ஆமா")).toBe(true);
    expect(isShortAnswerVocabulary("சரி")).toBe(true);
    expect(isShortAnswerVocabulary("இல்லை")).toBe(true);
    expect(isShortAnswerVocabulary("வேண்டாம்")).toBe(true);
    expect(isShortAnswerVocabulary("yes sir")).toBe(true);
    expect(isShortAnswerVocabulary("ஆம் சார்")).toBe(true);
  });

  it("rejects open sentences", () => {
    expect(isShortAnswerVocabulary("I want to know more")).toBe(false);
    expect(isShortAnswerVocabulary("yes but wait")).toBe(false);
  });
});

describe("isClosedQuestion", () => {
  it("detects yes/no and confirmation prompts", () => {
    expect(isClosedQuestion("Are you comfortable with the night shift?")).toBe(true);
    expect(isClosedQuestion("Okay?")).toBe(true);
    expect(isClosedQuestion("Tell me about your experience.")).toBe(false);
  });
});

describe("shouldAcceptCallerInterrupt", () => {
  it("accepts short answers only while expecting", () => {
    expect(shouldAcceptCallerInterrupt({
      text: "yes",
      isAudioPlaying: true,
      expectingShortAnswer: true,
      wordsForInterruption: 3,
      isHardInterrupt: false,
    })).toBe(true);
    expect(shouldAcceptCallerInterrupt({
      text: "yes",
      isAudioPlaying: true,
      expectingShortAnswer: false,
      wordsForInterruption: 3,
      isHardInterrupt: false,
    })).toBe(false);
  });

  it("still accepts longer talk-over via word count", () => {
    expect(shouldAcceptCallerInterrupt({
      text: "I have a question",
      isAudioPlaying: true,
      expectingShortAnswer: false,
      wordsForInterruption: 3,
      isHardInterrupt: false,
    })).toBe(true);
  });
});

describe("shouldAcceptContextualShortAnswer", () => {
  it("requires the expecting window", () => {
    expect(shouldAcceptContextualShortAnswer({ text: "ஆம்", expectingShortAnswer: true })).toBe(true);
    expect(shouldAcceptContextualShortAnswer({ text: "ஆம்", expectingShortAnswer: false })).toBe(false);
  });
});
