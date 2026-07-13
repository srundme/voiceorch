import { describe, expect, it } from "vitest";
import { resolveSarvamSttMode } from "./sarvam-mode.js";

describe("resolveSarvamSttMode", () => {
  it("honours explicit agent override", () => {
    expect(resolveSarvamSttMode("en-IN", "codemix")).toBe("codemix");
    expect(resolveSarvamSttMode("ta-IN", "verbatim")).toBe("verbatim");
  });

  it("defaults en-IN to transcribe (avoids codemix script garbage)", () => {
    expect(resolveSarvamSttMode("en-IN")).toBe("transcribe");
    expect(resolveSarvamSttMode("en-US")).toBe("transcribe");
  });

  it("defaults Indic languages to codemix", () => {
    expect(resolveSarvamSttMode("ta-IN")).toBe("codemix");
    expect(resolveSarvamSttMode("hi-IN")).toBe("codemix");
    expect(resolveSarvamSttMode("te-IN")).toBe("codemix");
  });
});
