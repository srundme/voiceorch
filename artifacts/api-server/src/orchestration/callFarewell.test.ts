import { describe, expect, it } from "vitest";
import { isCallerFarewellUtterance, isCallerClosingUtterance, transcriptHasFarewellEnding } from "./callFarewell.js";

describe("isCallerFarewellUtterance", () => {
  it("matches Latin bye variants", () => {
    expect(isCallerFarewellUtterance("bye")).toBe(true);
    expect(isCallerFarewellUtterance("Okay bye")).toBe(true);
    expect(isCallerFarewellUtterance("goodbye madam")).toBe(true);
  });

  it("matches Tamil பாய் farewells from Galaxy call 4848/4849", () => {
    expect(isCallerFarewellUtterance("ஓகே மேடம் பாய் மேடம்")).toBe(true);
    expect(isCallerFarewellUtterance("ஓகே பாய்")).toBe(true);
    expect(isCallerFarewellUtterance("பாய்")).toBe(true);
  });

  it("matches Tamil நன்றி-only", () => {
    expect(isCallerFarewellUtterance("நன்றி")).toBe(true);
  });

  it("matches a no-more-help close (call 14315)", () => {
    expect(isCallerClosingUtterance("வேற எதுவும் help பண்ண சார் நான் நாளைக்கு பேசுறேன்")).toBe(true);
    expect(isCallerClosingUtterance("nothing else sir")).toBe(true);
    expect(isCallerClosingUtterance("வேற ஒன்னும் இல்ல")).toBe(true);
  });

  it("rejects mid-call questions that mention tomorrow", () => {
    expect(isCallerClosingUtterance("நாளைக்கு 5 மணிக்கு call பண்ணுங்க")).toBe(false);
  });

  it("rejects long non-farewell turns", () => {
    expect(isCallerFarewellUtterance("ஓகே மேடம், அது எப்படி ஏர்ன் பண்றது சொல்லுங்கள்")).toBe(false);
    expect(isCallerFarewellUtterance("thank you, now tell me about the discount")).toBe(false);
  });
});

describe("transcriptHasFarewellEnding", () => {
  it("detects Tamil பாய் in transcript tail", () => {
    const t = "Agent: Thank you for your time\nCaller: ஓகே மேடம் பாய் மேடம்";
    expect(transcriptHasFarewellEnding(t)).toBe(true);
  });

  it("detects English bye", () => {
    expect(transcriptHasFarewellEnding("Caller: okay bye")).toBe(true);
  });

  it("returns false for empty", () => {
    expect(transcriptHasFarewellEnding("")).toBe(false);
  });
});
