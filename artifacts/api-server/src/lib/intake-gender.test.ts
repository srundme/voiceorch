import { describe, it, expect } from "vitest";
import { inferGenderFromName } from "./intake-gender.js";

describe("inferGenderFromName", () => {
  it("reads common male names", () => {
    expect(inferGenderFromName("Rahul")).toBe("MALE");
    expect(inferGenderFromName("karthik")).toBe("MALE");
    expect(inferGenderFromName("Arbaz Khan")).toBe(null); // Arbaz is not in the list
    expect(inferGenderFromName("Vignesh Murali")).toBe("MALE");
  });

  it("reads common female names", () => {
    expect(inferGenderFromName("Priya")).toBe("FEMALE");
    expect(inferGenderFromName("Sowmya R")).toBe("FEMALE");
    expect(inferGenderFromName("deepika padukone")).toBe("FEMALE");
  });

  it("lets a title override the lookup", () => {
    expect(inferGenderFromName("Mrs Rahul Sharma")).toBe("FEMALE");
    expect(inferGenderFromName("Mr. Priya")).toBe("MALE");
  });

  it("falls back to reliable name endings", () => {
    expect(inferGenderFromName("Sivapriya")).toBe("FEMALE");
    expect(inferGenderFromName("Rajeshwari")).toBe("FEMALE");
    expect(inferGenderFromName("Dharmendra")).toBe("MALE");
  });

  it("skips a surname-only match and uses the given name", () => {
    expect(inferGenderFromName("Sneha Kumar")).toBe("FEMALE");
  });

  it("returns null rather than guessing at a unisex or unknown name", () => {
    expect(inferGenderFromName("Kiran")).toBe(null);
    expect(inferGenderFromName("Qwertyx")).toBe(null);
    expect(inferGenderFromName("")).toBe(null);
    expect(inferGenderFromName(null)).toBe(null);
    expect(inferGenderFromName("   ")).toBe(null);
  });

  it("ignores punctuation and casing", () => {
    expect(inferGenderFromName("  RAVI,  kumar ")).toBe("MALE");
  });
});
