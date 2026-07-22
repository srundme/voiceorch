import { describe, expect, it } from "vitest";
import { resolveSarvamSttMode } from "./sarvam-mode.js";

describe("resolveSarvamSttMode", () => {
  it("honours explicit agent override", () => {
    expect(resolveSarvamSttMode("en-IN", "codemix")).toBe("codemix");
    expect(resolveSarvamSttMode("ta-IN", "verbatim")).toBe("verbatim");
    expect(resolveSarvamSttMode("en-IN", "transcribe")).toBe("transcribe");
  });

  it("defaults ALL languages to codemix (callers are multilingual)", () => {
    expect(resolveSarvamSttMode("en-IN")).toBe("codemix");
    expect(resolveSarvamSttMode("en-US")).toBe("codemix");
    expect(resolveSarvamSttMode("ta-IN")).toBe("codemix");
    expect(resolveSarvamSttMode("hi-IN")).toBe("codemix");
    expect(resolveSarvamSttMode("te-IN")).toBe("codemix");
    expect(resolveSarvamSttMode(null)).toBe("codemix");
    expect(resolveSarvamSttMode(undefined)).toBe("codemix");
  });
});
