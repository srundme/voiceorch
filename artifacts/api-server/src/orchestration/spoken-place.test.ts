import { describe, expect, it } from "vitest";
import { buildWhereFromNudge, isWhereCallingFromQuestion, trimWhereFromSpeech } from "./spoken-place.js";

describe("where-from speech", () => {
  it("treats a where-are-you-calling-from question as a short place answer", () => {
    expect(isWhereCallingFromQuestion("where are you calling from?")).toBe(true);
    expect(isWhereCallingFromQuestion("எங்கிருந்து கூப்பிடுறீங்க?")).toBe(true);
    expect(buildWhereFromNudge("எங்க ஆபிஸ்?")).toContain("city or area only");
    expect(buildWhereFromNudge("எங்க ஆபிஸ்?")).toContain("pincode");
  });

  it("still allows a pincode when they ask for it", () => {
    expect(isWhereCallingFromQuestion("pincode என்ன?")).toBe(false);
    expect(buildWhereFromNudge("what is the office pincode")).toBe("");
  });

  it("strips a pincode from the spoken place line", () => {
    expect(trimWhereFromSpeech(
      "where are you calling from",
      "We are in Arumbakkam, Chennai 600106, near Jainagar SBI.",
    )).toBe("We are in Arumbakkam, Chennai.");
  });

  it("leaves a funding answer unchanged", () => {
    const line = "Funds are based on monthly turnover.";
    expect(trimWhereFromSpeech("funds வேணுமா", line)).toBe(line);
  });
});
