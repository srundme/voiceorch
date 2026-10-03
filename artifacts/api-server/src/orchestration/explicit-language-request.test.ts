import { describe, it, expect } from "vitest";
import { buildLanguageLockNote, detectExplicitLanguageRequest } from "./explicit-language-request.js";

describe("call 42570 English requests", () => {
  it("latches English on every phrasing the caller used", () => {
    for (const t of [
      "Can I speak English?",
      "Can I speak in English?",
      "Change it to English.",
      "But why you are like speaking to Hindi again? I want to talk to you in English only.",
    ]) {
      expect(detectExplicitLanguageRequest(t)).toBe("en-IN");
    }
  });
});

describe("buildLanguageLockNote", () => {
  it("is empty without a latch", () => {
    expect(buildLanguageLockNote(null)).toBe("");
    expect(buildLanguageLockNote(undefined)).toBe("");
  });

  it("forbids Hinglish when English is latched", () => {
    const note = buildLanguageLockNote("en-IN");
    expect(note).toContain("LANGUAGE LOCK: ENGLISH");
    expect(note).toContain("No Hindi or Hinglish");
  });

  it("names the latched Indic language", () => {
    expect(buildLanguageLockNote("kn-IN")).toContain("Reply ONLY in Kannada");
  });

  it("passive language is a soft follow-the-caller note, not a lock", () => {
    const note = buildLanguageLockNote("hi-IN", false);
    expect(note).toContain("Reply in Hindi");
    expect(note).toContain("follow them");
    expect(note).not.toContain("LOCK");
    expect(buildLanguageLockNote("en-IN", false)).toContain("not Hindi/Hinglish");
  });
});

describe("detectExplicitLanguageRequest", () => {
  it("latches English on Sarvam Devanagari 'इंग्लिश मैडम' (call 11062)", () => {
    expect(detectExplicitLanguageRequest("इंग्लिश मैडम")).toBe("en-IN");
  });

  it("latches English on 'नहीं नहीं आप इंग्लिश में बात करो' (call 11062)", () => {
    expect(detectExplicitLanguageRequest("नहीं नहीं आप इंग्लिश में बात करो")).toBe("en-IN");
  });

  it("does not treat a Hindi barge-in scrap as a Hindi request (call 11062 turn 5)", () => {
    expect(detectExplicitLanguageRequest("8। का का का नहीं तो।")).toBeNull();
    expect(detectExplicitLanguageRequest("अरे मैडम जी आप।")).toBeNull();
    expect(detectExplicitLanguageRequest("थैंक यू। हाँ।")).toBeNull();
  });

  it("still latches latin bare imperatives", () => {
    expect(detectExplicitLanguageRequest("Ma'am Tamil")).toBe("ta-IN");
    expect(detectExplicitLanguageRequest("sir Hindi")).toBe("hi-IN");
    expect(detectExplicitLanguageRequest("Tamil please")).toBe("ta-IN");
    expect(detectExplicitLanguageRequest("English madam")).toBe("en-IN");
  });

  it("latches explicit English requests", () => {
    expect(detectExplicitLanguageRequest("speak in English")).toBe("en-IN");
    expect(detectExplicitLanguageRequest("English me baat karo")).toBe("en-IN");
    expect(detectExplicitLanguageRequest("अंग्रेजी में बात करो")).toBe("en-IN");
  });

  it("latches Hindi when the locative is on Hindi", () => {
    expect(detectExplicitLanguageRequest("Hindi me baat karo")).toBe("hi-IN");
    expect(detectExplicitLanguageRequest("हिंदी में बात करो")).toBe("hi-IN");
  });

  it("prefers English when a Hindi/English tie has the locative on English", () => {
    expect(detectExplicitLanguageRequest("Hindi nahi, English me bolo")).toBe("en-IN");
    expect(detectExplicitLanguageRequest("हिंदी नहीं इंग्लिश में बात करो")).toBe("en-IN");
  });

  it("does not latch a bare language mention without a request cue", () => {
    expect(detectExplicitLanguageRequest("Do you support Tamil?")).toBeNull();
    expect(detectExplicitLanguageRequest("I don't know English")).toBeNull();
    expect(detectExplicitLanguageRequest("Tamil teacher")).toBeNull();
    expect(detectExplicitLanguageRequest("English teacher")).toBeNull();
  });
});
