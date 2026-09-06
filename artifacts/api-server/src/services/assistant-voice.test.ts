import { describe, expect, it } from "vitest";
import { isCartesiaVoiceId, looksLikeKarthikeyan, ttsLanguageForText } from "./assistant-voice.js";

describe("looksLikeKarthikeyan", () => {
  it("matches admin and clone labels", () => {
    expect(looksLikeKarthikeyan("Karthikeyan")).toBe(true);
    expect(looksLikeKarthikeyan("Karthikeyan clone")).toBe(true);
    expect(looksLikeKarthikeyan("KARTHIKEYAN")).toBe(true);
    expect(looksLikeKarthikeyan("Priya")).toBe(false);
  });
});

describe("ttsLanguageForText", () => {
  it("picks Tamil when the spoken line is colloquial Tamil script", () => {
    expect(ttsLanguageForText("வணக்கம்டா, நான் ஜார்விஸ். எப்படி இருக்கே?")).toBe("ta");
    expect(ttsLanguageForText("பிரியா ரெடிடா. campaign draft-ல வச்சிட்டேன்.")).toBe("ta");
  });

  it("picks English only when there is no Tamil", () => {
    expect(ttsLanguageForText("Hey, wallet looks low.")).toBe("en");
  });
});

describe("isCartesiaVoiceId", () => {
  it("accepts Cartesia UUIDs only", () => {
    expect(isCartesiaVoiceId("a0e99841-438c-4a64-b679-ae501e7d6091")).toBe(true);
    expect(isCartesiaVoiceId("priya")).toBe(false);
  });
});
