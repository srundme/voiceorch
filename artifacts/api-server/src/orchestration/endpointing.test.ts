import { describe, expect, it } from "vitest";
import {
  computeEndpointMs,
  isDigitCollectionContext,
  isDigitLikeUtterance,
  resolveIncompleteHoldMs,
  resolveStreamingTurnHold,
} from "./endpointing.js";

describe("isDigitCollectionContext", () => {
  it("detects phone / OTP / Aadhaar asks", () => {
    expect(isDigitCollectionContext("Could you share your phone number?")).toBe(true);
    expect(isDigitCollectionContext("Please enter the OTP.")).toBe(true);
    expect(isDigitCollectionContext("What is your Aadhaar number?")).toBe(true);
    expect(isDigitCollectionContext("Read the verification code.")).toBe(true);
  });

  it("does not treat a normal question as digit collection", () => {
    expect(isDigitCollectionContext("How many tickets do you need?")).toBe(false);
    expect(isDigitCollectionContext("Would you like to participate?")).toBe(false);
  });
});

describe("isDigitLikeUtterance", () => {
  it("treats empty / numeric / spelled digits as in-progress IDs", () => {
    expect(isDigitLikeUtterance("")).toBe(true);
    expect(isDigitLikeUtterance("9")).toBe(true);
    expect(isDigitLikeUtterance("98 76")).toBe(true);
    expect(isDigitLikeUtterance("nine eight")).toBe(true);
    expect(isDigitLikeUtterance("double four")).toBe(true);
    expect(isDigitLikeUtterance("nine sir")).toBe(true);
  });

  it("does not hold finished answers or short acks", () => {
    expect(isDigitLikeUtterance("yes")).toBe(false);
    expect(isDigitLikeUtterance("okay")).toBe(false);
    expect(isDigitLikeUtterance("I want to participate")).toBe(false);
    expect(isDigitLikeUtterance("9876543210")).toBe(false);
  });
});

describe("resolveStreamingTurnHold", () => {
  it("holds the first OTP digit even if Smart Turn would call it complete", () => {
    const hold = resolveStreamingTurnHold({
      pending: "nine",
      lastAgentText: "Please share the OTP.",
      textLooksIncomplete: false,
    });
    expect(hold.incomplete).toBe(true);
    expect(hold.reason).toBe("digit_collection");
    expect(hold.digitCollection).toBe(true);
  });

  it("does not hold a short ack after a normal question", () => {
    const hold = resolveStreamingTurnHold({
      pending: "yes",
      lastAgentText: "Would you like to join?",
      textLooksIncomplete: false,
    });
    expect(hold.incomplete).toBe(false);
    expect(hold.reason).toBeNull();
  });

  it("still holds dangling conversational text", () => {
    const hold = resolveStreamingTurnHold({
      pending: "I want to participate but",
      lastAgentText: "Tell me more.",
      textLooksIncomplete: true,
    });
    expect(hold.incomplete).toBe(true);
    expect(hold.reason).toBe("text_continuation");
  });
});

describe("resolveIncompleteHoldMs", () => {
  it("keeps the Fast preset cap when not collecting digits", () => {
    expect(resolveIncompleteHoldMs({
      baseStopMs: 800,
      digitCollection: false,
      trailingDigit: false,
    })).toBe(800);
  });

  it("stretches past Fast when the caller is still reading digits", () => {
    expect(resolveIncompleteHoldMs({
      baseStopMs: 800,
      digitCollection: true,
      trailingDigit: true,
    })).toBe(1600);
  });
});

describe("computeEndpointMs", () => {
  it("waits longer for a spelled digit during phone collection", () => {
    const d = computeEndpointMs({
      lastAgentText: "What is your phone number?",
      partialTranscript: "nine eight",
      audioBufferMs: 400,
      baseSilenceMs: 150,
    });
    expect(d.reason).toBe("digit-collection:trailing-digit");
    expect(d.ms).toBe(900);
  });

  it("stays fast on a complete yes", () => {
    const d = computeEndpointMs({
      lastAgentText: "Can you hear me?",
      partialTranscript: "yes",
      audioBufferMs: 200,
      baseSilenceMs: 150,
    });
    expect(d.reason).toBe("affirmation");
    expect(d.ms).toBe(150);
  });
});
