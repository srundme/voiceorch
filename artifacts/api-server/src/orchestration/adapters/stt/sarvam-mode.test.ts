import { describe, expect, it } from "vitest";
import { resolveSarvamSttMode } from "./sarvam-mode.js";

describe("resolveSarvamSttMode", () => {
  it("honours explicit agent override", () => {
    expect(resolveSarvamSttMode("en-IN", "codemix")).toBe("codemix");
    expect(resolveSarvamSttMode("ta-IN", "verbatim")).toBe("verbatim");
    expect(resolveSarvamSttMode("en-IN", "transcribe")).toBe("transcribe");
    expect(resolveSarvamSttMode("hi-IN", "translate")).toBe("translate");
    expect(resolveSarvamSttMode("ta-IN", "translit")).toBe("translit");
  });

  it("defaults every language to codemix so mixed Hinglish is captured", () => {
    expect(resolveSarvamSttMode("en-IN")).toBe("codemix");
    expect(resolveSarvamSttMode("en-US")).toBe("codemix");
    expect(resolveSarvamSttMode("ta-IN")).toBe("codemix");
    expect(resolveSarvamSttMode("hi-IN")).toBe("codemix");
    expect(resolveSarvamSttMode("te-IN")).toBe("codemix");
    expect(resolveSarvamSttMode("od-IN")).toBe("codemix");
    expect(resolveSarvamSttMode("pa-IN")).toBe("codemix");
    expect(resolveSarvamSttMode("ur-IN")).toBe("codemix");
    expect(resolveSarvamSttMode("ne-IN")).toBe("codemix");
    expect(resolveSarvamSttMode(null)).toBe("codemix");
    expect(resolveSarvamSttMode(undefined)).toBe("codemix");
  });

  it("ignores unknown explicit modes and falls back to codemix", () => {
    expect(resolveSarvamSttMode("en-IN", "not-a-mode")).toBe("codemix");
    expect(resolveSarvamSttMode("ta-IN", "not-a-mode")).toBe("codemix");
  });
});
