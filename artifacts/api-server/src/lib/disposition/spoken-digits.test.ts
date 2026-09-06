import { describe, expect, it } from "vitest";
import {
  expandSpokenDigits,
  mergeSpokenPhoneFragments,
  preferIndianPhone,
  preferNumberTranscript,
  looksLikeSpokenNumber,
} from "./spoken-digits.js";

describe("expandSpokenDigits", () => {
  it("converts Tamil STT digit words from call 6062", () => {
    expect(expandSpokenDigits("எயிட் நைன் ஜிரோ ஃபோர்")).toContain("8904");
  });

  it("converts English digit words", () => {
    expect(expandSpokenDigits("eight nine zero four seven four")).toMatch(/890474/);
  });

  it("converts double zero", () => {
    expect(expandSpokenDigits("டபுள் ஜீரோ")).toContain("00");
    expect(expandSpokenDigits("double zero")).toContain("00");
  });

  it("keeps ascii digits", () => {
    expect(expandSpokenDigits("number is 74887400 thanks")).toContain("74887400");
  });
});

describe("mergeSpokenPhoneFragments", () => {
  it("merges spoken prefix + digit run into Indian mobile (call 6062)", () => {
    const tx = `
Caller: எயிட் நைன் ஜிரோ ஃபோர்.
Agent: அடுத்த நம்பர் என்னங்க?
Caller: 74887400.
Agent: schedule_callback
Caller: டபுள் ஜீரோ.
Agent: டபுள் ஜீரோவையும் சேர்த்து நம்பரை save பண்ணிக்கிறேன்.
`;
    const phones = mergeSpokenPhoneFragments(tx);
    expect(phones.some((p) => p === "8904748874" || p === "890474887400")).toBe(true);
    expect(preferIndianPhone("890474887400")).toBe("8904748874");
  });

  it("finds a continuous 10-digit number", () => {
    expect(mergeSpokenPhoneFragments("WhatsApp 9876543210 please")).toContain("9876543210");
  });
});

describe("preferNumberTranscript", () => {
  it("keeps a clean final phone and never overwrites ordinary speech", () => {
    expect(preferNumberTranscript("98 76 54 32 11 extra", "9876543210")).toBe("9876543210");
    expect(looksLikeSpokenNumber("one minute")).toBe(false);
    expect(preferNumberTranscript("9876543211", "one minute")).toBe("one minute");
  });

  it("expands spoken digits on the final when the caller is collecting a number", () => {
    expect(preferNumberTranscript(undefined, "eight nine zero four seven four eight eight seven four"))
      .toMatch(/8904748874/);
  });
});
