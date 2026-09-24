import { describe, expect, it } from "vitest";
import { buildOpeningHandshakeNudge, humanizeOutboundOpener } from "./opening-handshake.js";

describe("humanizeOutboundOpener", () => {
  it("keeps the identity sentence and drops the funding ask", () => {
    expect(humanizeOutboundOpener(
      "வணக்கம், நான் Yemmar Finserv-ல இருந்து பேசுறேன். உங்க business funding பத்தி பேசலாமா?",
    )).toBe("வணக்கம், நான் Yemmar Finserv-ல இருந்து பேசுறேன்.");
  });

  it("drops the scripted check-based funding paragraph", () => {
    expect(humanizeOutboundOpener(
      "வணக்கம், என் பேர் Malar. நா Yemmar Finserv-ல் இருந்து பேசுறேன். உங்க business-க்கு check-based funding நாங்க provide பண்றோம். அதப் பத்தி ஒரு two minutes பேசலாமா?",
    )).toBe("வணக்கம், என் பேர் Malar. நா Yemmar Finserv-ல் இருந்து பேசுறேன்.");
  });

  it("leaves a short human hello unchanged", () => {
    expect(humanizeOutboundOpener("ஹலோ, பேசலாமா?")).toBe("ஹலோ, பேசலாமா?");
  });

  it("cuts a single sentence before the funding clause", () => {
    expect(humanizeOutboundOpener(
      "வணக்கம், நான் Yemmar Finserv-ல இருந்து பேசுறேன், உங்க business funding பத்தி பேசலாமா?",
    )).toBe("வணக்கம், நான் Yemmar Finserv-ல இருந்து பேசுறேன்");
  });

  it("drops a pitch-only remainder after the hello was already spoken", () => {
    expect(humanizeOutboundOpener(
      "உங்க business-க்கு check-based funding நாங்க provide பண்றோம்.",
      { dropPitchOnly: true },
    )).toBe("");
  });
});

describe("buildOpeningHandshakeNudge", () => {
  it("introduces on a pickup hello when the opener was only hello", () => {
    const nudge = buildOpeningHandshakeNudge("ஹலோ", "ஹலோ, பேசலாமா?");
    expect(nudge).toContain("name and company");
    expect(nudge).toContain("Do not mention funding");
  });

  it("does not jump to the funds question when they say சரி after hello", () => {
    const nudge = buildOpeningHandshakeNudge("ஆ சரி", "ஹலோ, பேசலாமா?");
    expect(nudge).toContain("have not introduced yourself");
    expect(nudge).toContain("Do not ask if they need funds");
  });

  it("gives the reason in one sentence after they accept an introduction", () => {
    const nudge = buildOpeningHandshakeNudge(
      "சரி",
      "வணக்கம், நான் Yemmar Finserv-ல இருந்து பேசுறேன். ஒரு நிமிஷம் பேசலாமா?",
    );
    expect(nudge).toContain("why you called");
    expect(nudge).toContain("Do not ask whether they need funds");
  });

  it("answers who-is-this without the scripted paragraph", () => {
    const nudge = buildOpeningHandshakeNudge("யார் பேசுறது?", "ஹலோ, பேசலாமா?");
    expect(nudge).toContain("name and company only");
    expect(nudge).toContain("Do not read the scripted introduction");
  });

  it("answers what-is-this in one sentence", () => {
    const nudge = buildOpeningHandshakeNudge("என்ன விஷயம்?", "வணக்கம், பேசலாமா?");
    expect(nudge).toContain("what this call is about");
    expect(nudge).toContain("Do not ask whether they need funds yet");
  });

  it("lets the script continue once they agreed after hearing the reason", () => {
    expect(buildOpeningHandshakeNudge(
      "சரி",
      "உங்க business-க்கு funding பத்தி ஒரு நிமிஷம் பேசலாமா?",
    )).toBeNull();
  });

  it("ignores a real answer", () => {
    expect(buildOpeningHandshakeNudge(
      "இல்ல வேண்டாம்",
      "வணக்கம், நான் Yemmar Finserv-ல இருந்து பேசுறேன்.",
    )).toBeNull();
  });
});
