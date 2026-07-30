import { describe, expect, it } from "vitest";
import { isCallerFarewellUtterance, transcriptHasFarewellEnding } from "./callFarewell.js";

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
