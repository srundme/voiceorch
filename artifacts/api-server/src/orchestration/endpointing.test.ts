import { describe, expect, it } from "vitest";
import {
  computeEndpointMs,
  isDigitCollectionContext,
  isDigitLikeUtterance,
  isEmailCollectionContext,
  isEmailLikeUtterance,
  isCompleteEmailUtterance,
  looksSnapComplete,
  shouldSkipSmartTurnEval,
  sanitizeSpokenEmailAddress,
  sanitizeSpokenEmailsInTranscript,
  reconstructSpokenEmail,
  preferEmailTranscript,
  looksLikeSpokenEmailSpelling,
  isCallerOfferingEmail,
  resolveCollectionKind,
  resolveCollectionVadSilenceMs,
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

  it("holds the first email token even if Smart Turn would call it complete", () => {
    const hold = resolveStreamingTurnHold({
      pending: "karthik",
      lastAgentText: "Could I have your email address?",
      textLooksIncomplete: false,
    });
    expect(hold.incomplete).toBe(true);
    expect(hold.reason).toBe("email_collection");
    expect(hold.collectionKind).toBe("email");
  });

  it("does not hold a finished spoken email", () => {
    const hold = resolveStreamingTurnHold({
      pending: "karthik at gmail dot com",
      lastAgentText: "What is your email?",
      textLooksIncomplete: false,
    });
    expect(hold.incomplete).toBe(false);
    expect(hold.reason).toBeNull();
  });

  it("does not hold a short ack after an email prompt", () => {
    const hold = resolveStreamingTurnHold({
      pending: "yes",
      lastAgentText: "Could I have your email?",
      textLooksIncomplete: false,
    });
    expect(hold.incomplete).toBe(false);
  });
});

describe("email collection helpers", () => {
  it("detects email prompts in English and Indic scripts", () => {
    expect(isEmailCollectionContext("Could I have your email address?")).toBe(true);
    expect(isEmailCollectionContext("Please share your mail id.")).toBe(true);
    expect(isEmailCollectionContext("உங்கள் மின்னஞ்சல் என்ன?")).toBe(true);
    expect(isEmailCollectionContext("आपका ईमेल क्या है?")).toBe(true);
    expect(isEmailCollectionContext("What is your phone number?")).toBe(false);
    expect(resolveCollectionKind("Please share your email.")).toBe("email");
    expect(resolveCollectionKind("Please share the OTP.")).toBe("digit");
  });

  it("treats spelled / spoken fragments as in-progress emails", () => {
    expect(isEmailLikeUtterance("k a r")).toBe(true);
    expect(isEmailLikeUtterance("karthik at")).toBe(true);
    expect(isEmailLikeUtterance("gmail dot")).toBe(true);
    expect(isEmailLikeUtterance("karthikeyan")).toBe(true);
    expect(isEmailLikeUtterance("yes")).toBe(false);
    expect(isCompleteEmailUtterance("user@gmail.com")).toBe(true);
    expect(isCompleteEmailUtterance("karthik at gmail dot com")).toBe(true);
    expect(isEmailLikeUtterance("user@gmail.com")).toBe(false);
    expect(isEmailLikeUtterance("karthik at gmail dot com")).toBe(false);
    expect(isEmailLikeUtterance("Aamaa madam.")).toBe(false);
    expect(isEmailLikeUtterance("Aa cleara irukku madam.")).toBe(false);
  });

  it("does not treat login/same-email mentions as a new collection prompt", () => {
    expect(isEmailCollectionContext(
      "சரி, same email-ல தான் login பண்ணிருக்கீங்கன்னு தெரிஞ்சுக்கிட்டேன்.",
    )).toBe(false);
    expect(isEmailCollectionContext(
      "நீங்க அந்த email வெச்சு SnapServe account-ல login பண்ணி பாத்தீங்களா?",
    )).toBe(false);
    expect(resolveStreamingTurnHold({
      pending: "Aamaa madam.",
      lastAgentText: "நீங்க அந்த email வெச்சு login பண்ணி பாத்தீங்களா?",
      textLooksIncomplete: false,
    }).incomplete).toBe(false);
  });

  it("strips spoken Tamil/English fillers glued onto the local-part", () => {
    expect(sanitizeSpokenEmailAddress("vandhukarthikeyan@gmail.com")).toBe("karthikeyan@gmail.com");
    expect(sanitizeSpokenEmailsInTranscript("So email id vandhukarthikeyan@gmail.com.")).toBe(
      "So email id karthikeyan@gmail.com.",
    );
    expect(sanitizeSpokenEmailAddress("karthikeyan@gmail.com")).toBe("karthikeyan@gmail.com");
    expect(sanitizeSpokenEmailAddress("idris@gmail.com")).toBe("idris@gmail.com");
  });

  it("reconstructs Tamil letter-spelling and does not drop it when STT compactifies", () => {
    expect(looksLikeSpokenEmailSpelling("ஏ ஏ ஒய் ஏ எல் அட் த ரேட் ஜிமெயில் டாட் காம்")).toBe(true);
    expect(reconstructSpokenEmail("ஏ ஏ ஒய் ஏ எல் அட் த ரேட் ஜிமெயில் டாட் காம்")).toBe("aayal@gmail.com");
    expect(preferEmailTranscript(
      "ஏ ஏ ஒய் ஏ எல் அட் த ரேட் ஜிமெயில் டாட் காம்",
      "keyan@gmail.com",
    )).toBe("keyan@gmail.com (spelled aayal@gmail.com)");
    expect(isCallerOfferingEmail("அண்ணா ஒரு நிமிஷம் நான் என்னுடைய மெயில் ஐடி சொல்றேன் நோட் பண்ணிக்கிறீங்களா?")).toBe(true);
    expect(resolveCollectionKind("சரிங்க, மெதுவா சொல்லுங்க.", "மெயில் ஐடி சொல்றேன் நோட் பண்ணிக்கிறீங்களா?")).toBe("email");
    expect(resolveStreamingTurnHold({
      pending: "ஏ ஏ ஒய் ஏ எல் அட் த",
      lastAgentText: "சரிங்க, மெதுவா சொல்லுங்க. நான் wait பண்றேன்.",
      lastUserText: "நான் என்னுடைய மெயில் ஐடி சொல்றேன் நோட் பண்ணிக்கிறீங்களா?",
      textLooksIncomplete: false,
    }).reason).toBe("email_collection");
  });

  it("only fail-opens timeout on snap-finished turns", () => {
    expect(looksSnapComplete("yes")).toBe(true);
    expect(looksSnapComplete("சரி")).toBe(true);
    expect(looksSnapComplete("9876543210")).toBe(true);
    expect(looksSnapComplete("user@gmail.com")).toBe(true);
    expect(looksSnapComplete("k a r")).toBe(false);
    expect(looksSnapComplete("nine")).toBe(false);
    expect(looksSnapComplete("I wanted to say")).toBe(false);
  });
});

describe("shouldSkipSmartTurnEval", () => {
  it("skips ONNX wait for a finished short ack (happy-path latency)", () => {
    expect(shouldSkipSmartTurnEval({
      pending: "சரி",
      textLooksIncomplete: false,
      collectionKind: "none",
    })).toBe(true);
    expect(shouldSkipSmartTurnEval({
      pending: "yes",
      textLooksIncomplete: false,
      collectionKind: "none",
    })).toBe(true);
  });

  it("never skips during digit/email collection or mid-thought text", () => {
    expect(shouldSkipSmartTurnEval({
      pending: "nine",
      textLooksIncomplete: true,
      collectionKind: "digit",
    })).toBe(false);
    expect(shouldSkipSmartTurnEval({
      pending: "I wanted to say",
      textLooksIncomplete: true,
      collectionKind: "none",
    })).toBe(false);
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

  it("stretches further for in-progress email spelling", () => {
    expect(resolveIncompleteHoldMs({
      baseStopMs: 800,
      collectionKind: "email",
      trailingFragment: true,
    })).toBe(1800);
  });
});

describe("resolveCollectionVadSilenceMs", () => {
  it("stretches Fast 300 ms VAD during digit and email collection", () => {
    expect(resolveCollectionVadSilenceMs(300, "none")).toBe(300);
    expect(resolveCollectionVadSilenceMs(300, "digit")).toBe(700);
    expect(resolveCollectionVadSilenceMs(300, "email")).toBe(800);
  });

  it("does not shrink Patient VAD, and never exceeds 800 ms", () => {
    expect(resolveCollectionVadSilenceMs(700, "digit")).toBe(700);
    expect(resolveCollectionVadSilenceMs(700, "email")).toBe(800);
    expect(resolveCollectionVadSilenceMs(900, "none")).toBe(800);
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

  it("waits longer while the caller is spelling an email", () => {
    const d = computeEndpointMs({
      lastAgentText: "Could I have your email?",
      partialTranscript: "k a r",
      audioBufferMs: 400,
      baseSilenceMs: 150,
    });
    expect(d.reason).toBe("email-collection:in-progress");
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
