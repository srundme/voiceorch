import { describe, expect, it } from "vitest";
import { resolveSarvamSttMode } from "./sarvam-mode.js";

describe("resolveSarvamSttMode", () => {
  it("honours explicit agent override", () => {
    expect(resolveSarvamSttMode("en-IN", "codemix")).toBe("codemix");
    expect(resolveSarvamSttMode("ta-IN", "verbatim")).toBe("verbatim");
    expect(resolveSarvamSttMode("en-IN", "transcribe")).toBe("transcribe");
    expect(resolveSarvamSttMode("hi-IN", "translate")).toBe("translate");
    expect(resolveSarvamSttMode("ta-IN", "translit")).toBe("translit");
    expect(resolveSarvamSttMode("hi-IN", "codemix")).toBe("codemix");
  });

  it("does not keep Mixed/codemix on Tamil — that is Tanglish (call 23956)", () => {
    expect(resolveSarvamSttMode("ta-IN", "codemix")).toBe("transcribe");
    expect(resolveSarvamSttMode("ta", "codemix")).toBe("transcribe");
  });

  it("defaults English / auto / unknown to codemix", () => {
    expect(resolveSarvamSttMode("en-IN")).toBe("codemix");
    expect(resolveSarvamSttMode("en-US")).toBe("codemix");
    expect(resolveSarvamSttMode("auto")).toBe("codemix");
    expect(resolveSarvamSttMode("unknown")).toBe("codemix");
    expect(resolveSarvamSttMode(null)).toBe("codemix");
    expect(resolveSarvamSttMode(undefined)).toBe("codemix");
  });

  it("defaults pinned Indic languages to native-script transcribe", () => {
    expect(resolveSarvamSttMode("ta-IN")).toBe("transcribe");
    expect(resolveSarvamSttMode("hi-IN")).toBe("transcribe");
    expect(resolveSarvamSttMode("te-IN")).toBe("transcribe");
    expect(resolveSarvamSttMode("od-IN")).toBe("transcribe");
    expect(resolveSarvamSttMode("pa-IN")).toBe("transcribe");
    expect(resolveSarvamSttMode("ur-IN")).toBe("transcribe");
    expect(resolveSarvamSttMode("ne-IN")).toBe("transcribe");
  });

  it("ignores unknown explicit modes and falls back by language", () => {
    expect(resolveSarvamSttMode("en-IN", "not-a-mode")).toBe("codemix");
    expect(resolveSarvamSttMode("ta-IN", "not-a-mode")).toBe("transcribe");
  });
});
