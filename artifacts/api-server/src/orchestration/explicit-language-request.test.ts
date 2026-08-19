import { describe, it, expect } from "vitest";
import { detectExplicitLanguageRequest } from "./explicit-language-request.js";

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
