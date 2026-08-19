import { describe, it, expect } from "vitest";
import { explainVoiceNearMiss, VOICE_SOLO_LINK_THRESHOLD } from "./voiceMemoryThresholds.js";

describe("explainVoiceNearMiss", () => {
  it("names every bar that a 0.19 telephony score missed (calls 11067/11068)", () => {
    const msg = explainVoiceNearMiss({
      score: 0.193,
      phoneNumber: "919789981433",
      personKey: "x",
      margin: null,
      normScore: null,
      asnormAccept: false,
    });
    expect(msg).toContain("919789981433");
    expect(msg).toContain("0.19");
    expect(msg).toContain("0.82");
    expect(msg).toContain(`solo ≥${VOICE_SOLO_LINK_THRESHOLD.toFixed(2)}`);
    expect(msg).toContain("AS-norm n/a");
  });
});
