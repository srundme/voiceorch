import { describe, expect, it } from "vitest";
import { transcriptHasFarewellEnding, agentLineEndsWithGoodbye } from "./farewell-ending.js";

describe("agentLineEndsWithGoodbye", () => {
  it("true only when the last sentence is a goodbye", () => {
    expect(agentLineEndsWithGoodbye("Thanks for your time. Take care, bye!")).toBe(true);
    expect(agentLineEndsWithGoodbye("All set. Have a great day.")).toBe(true);
  });

  it("ignores mid-call phrases that merely contain farewell words", () => {
    expect(agentLineEndsWithGoodbye("Our team will see you at the site on Saturday. Anything else?")).toBe(false);
    expect(agentLineEndsWithGoodbye("Have a good look at the brochure, I'll share it on WhatsApp.")).toBe(false);
    expect(agentLineEndsWithGoodbye("Bye the way, the clubhouse is ready. Shall I book a visit?")).toBe(false);
    expect(agentLineEndsWithGoodbye("")).toBe(false);
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
