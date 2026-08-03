import { describe, expect, it } from "vitest";
import { normalizeSpokenEmail } from "./transcriptQuality.js";

/**
 * Call 5490: "I want to book an appointment tomorrow at 11:00 AM" came back as
 * "Iwanttobookanappointmenttomorrow@11:00 AM." The email normalizer triggered on
 * the bare word "at", rewrote it to "@", and then de-spaced everything before it.
 */
describe("normalizeSpokenEmail — ordinary speech is left alone", () => {
  it("does not mangle a time expression containing 'at'", () => {
    const input = "I want to book an appointment tomorrow at 11:00 AM.";
    expect(normalizeSpokenEmail(input)).toBe(input);
  });

  it.each([
    "Call me at 5 in the evening",
    "Let's meet at the office",
    "I am at home right now",
    "Look at that",
    "Can you book one appointment for two people",
  ])("leaves %j unchanged", (input) => {
    expect(normalizeSpokenEmail(input)).toBe(input);
  });

  it("does not convert spoken number words in ordinary speech", () => {
    const input = "I need one appointment at four o'clock";
    expect(normalizeSpokenEmail(input)).toBe(input);
  });
});

describe("normalizeSpokenEmail — real dictated addresses still normalize", () => {
  it("converts 'at ... dot com' dictation", () => {
    expect(normalizeSpokenEmail("karthik at gmail dot com")).toBe("karthik@gmail.com");
  });

  it("converts 'at the rate' dictation", () => {
    expect(normalizeSpokenEmail("karthik at the rate gmail dot com")).toBe("karthik@gmail.com");
  });

  it("keeps ordinary words before an address intact", () => {
    expect(normalizeSpokenEmail("my email is karthik@gmail.com")).toBe(
      "my email is karthik@gmail.com",
    );
  });

  it("merges letter-by-letter dictation before the '@'", () => {
    expect(normalizeSpokenEmail("k a r t h i k@gmail.com")).toBe("karthik@gmail.com");
  });

  it("normalizes a spelled-out 'g mail' provider", () => {
    expect(normalizeSpokenEmail("karthik at g mail dot com")).toBe("karthik@gmail.com");
  });

  // Pre-existing limitation, unchanged here: the domain de-spacing regex's character
  // class excludes whitespace, so a fully letter-by-letter domain is only partly
  // merged. Recorded so the current behaviour is intentional rather than a surprise.
  it("only partly merges a letter-by-letter domain", () => {
    expect(normalizeSpokenEmail("karthik@g m a i l . c o m")).toBe("karthik@gmail.c o m");
  });

  it("handles Tamil email dictation", () => {
    expect(normalizeSpokenEmail("karthik அட் ஜிமெல் டாட் காம்")).toBe("karthik@gmail.com");
  });
});
