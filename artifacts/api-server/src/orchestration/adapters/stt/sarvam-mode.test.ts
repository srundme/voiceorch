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

  it("defaults Indic languages to transcribe (clean native script) and en-IN to codemix", () => {
    expect(resolveSarvamSttMode("en-IN")).toBe("codemix");
    expect(resolveSarvamSttMode("en-US")).toBe("codemix");
    expect(resolveSarvamSttMode("ta-IN")).toBe("transcribe");
    expect(resolveSarvamSttMode("hi-IN")).toBe("transcribe");
    expect(resolveSarvamSttMode("te-IN")).toBe("transcribe");
    // Languages that previously fell through to codemix by omission:
    expect(resolveSarvamSttMode("od-IN")).toBe("transcribe");
    expect(resolveSarvamSttMode("pa-IN")).toBe("transcribe");
    expect(resolveSarvamSttMode("ur-IN")).toBe("transcribe");
    expect(resolveSarvamSttMode("ne-IN")).toBe("transcribe");
    expect(resolveSarvamSttMode(null)).toBe("codemix");
    expect(resolveSarvamSttMode(undefined)).toBe("codemix");
  });

  it("ignores unknown explicit modes and falls back to language default", () => {
    expect(resolveSarvamSttMode("en-IN", "not-a-mode")).toBe("codemix");
    expect(resolveSarvamSttMode("ta-IN", "not-a-mode")).toBe("transcribe");
  });
});
