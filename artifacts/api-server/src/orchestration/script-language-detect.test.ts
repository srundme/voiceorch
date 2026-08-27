import { describe, it, expect } from "vitest";
import { detectScriptLanguage } from "./pipeline.js";

describe("detectScriptLanguage", () => {
  it("defaults Devanagari to Hindi", () => {
    expect(detectScriptLanguage("नमस्ते, आप कैसे हैं")).toBe("hi-IN");
  });

  it("honours the agent's configured Devanagari language", () => {
    expect(detectScriptLanguage("नमस्कार, तुम्ही कसे आहात", "mr-IN")).toBe("mr-IN");
    expect(detectScriptLanguage("नमस्ते, आप कैसे हैं", "mr-IN")).toBe("mr-IN");
  });

  it("leaves non-Devanagari scripts untouched by the preference", () => {
    expect(detectScriptLanguage("வணக்கம் நண்பரே", "mr-IN")).toBe("ta-IN");
    expect(detectScriptLanguage("ನಮಸ್ಕಾರ", "mr-IN")).toBe("kn-IN");
  });

  it("returns English only when no Indic characters are present", () => {
    expect(detectScriptLanguage("hello there", "mr-IN")).toBe("en-IN");
    expect(detectScriptLanguage("okay मला सांगा", "mr-IN")).toBe("mr-IN");
  });

  it("pins Tamil on a mixed resume-drop greeting (call 14243)", () => {
    expect(detectScriptLanguage(
      "Call cut ஆயிடுச்சு, line சரியா வரல போல. சரி, அப்படியே continue பண்ணலாம்",
    )).toBe("ta-IN");
  });

  it("returns null for text with no letters", () => {
    expect(detectScriptLanguage("... ?!", "mr-IN")).toBeNull();
  });
});
