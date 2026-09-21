import { describe, expect, it } from "vitest";
import {
  SILERO_SUSTAINED_MS,
  fuseCallerSpeaking,
  isSileroSustained,
  shouldDiscardAsRoomCrosstalk,
} from "./caller-speaking.js";

describe("fuseCallerSpeaking", () => {
  const base = {
    hasSttPartial: false,
    shortAnswerWithEnergy: false,
    sileroSpeaking: false,
    sileroSpeakingForMs: 0,
    rawEnergyAboveFloor: false,
  };

  it("prefers STT partial, then context, then silero, then energy", () => {
    expect(fuseCallerSpeaking({ ...base, hasSttPartial: true }).tippedBy).toBe("stt");
    expect(fuseCallerSpeaking({ ...base, shortAnswerWithEnergy: true }).tippedBy).toBe("context");
    expect(
      fuseCallerSpeaking({
        ...base,
        sileroSpeaking: true,
        sileroSpeakingForMs: SILERO_SUSTAINED_MS,
      }).tippedBy,
    ).toBe("silero");
    expect(fuseCallerSpeaking({ ...base, rawEnergyAboveFloor: true }).tippedBy).toBe("energy");
    expect(fuseCallerSpeaking(base)).toEqual({ speaking: false, tippedBy: "none" });
  });

  it("requires sustained Silero before tipping", () => {
    expect(isSileroSustained(true, 30)).toBe(false);
    expect(isSileroSustained(true, SILERO_SUSTAINED_MS)).toBe(true);
    expect(
      fuseCallerSpeaking({
        ...base,
        sileroSpeaking: true,
        sileroSpeakingForMs: 30,
      }).speaking,
    ).toBe(false);
  });
});

describe("shouldDiscardAsRoomCrosstalk", () => {
  it("discards short fragments after weak barge evidence without Silero", () => {
    expect(
      shouldDiscardAsRoomCrosstalk({
        transcript: "Please",
        sileroSustained: false,
        expectingShortAnswer: false,
        recentWeakBargeEvidence: true,
      }),
    ).toBe(true);
  });

  it("keeps short answers, Silero-backed speech, and long turns", () => {
    expect(
      shouldDiscardAsRoomCrosstalk({
        transcript: "Yes",
        sileroSustained: false,
        expectingShortAnswer: true,
        recentWeakBargeEvidence: true,
      }),
    ).toBe(false);
    expect(
      shouldDiscardAsRoomCrosstalk({
        transcript: "Please",
        sileroSustained: true,
        expectingShortAnswer: false,
        recentWeakBargeEvidence: true,
      }),
    ).toBe(false);
    expect(
      shouldDiscardAsRoomCrosstalk({
        transcript: "Can I know who else is going to be attending this meeting?",
        sileroSustained: false,
        expectingShortAnswer: false,
        recentWeakBargeEvidence: true,
      }),
    ).toBe(false);
  });
});
