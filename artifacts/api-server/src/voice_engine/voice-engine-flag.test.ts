import { describe, expect, it } from "vitest";
import { resolveSileroHysteresis, resolveTurnTiming, resolveVoiceEngine } from "./voice-engine-flag.js";

describe("resolveVoiceEngine", () => {
  it("defaults to v1 so production behaviour is unchanged", () => {
    expect(resolveVoiceEngine({})).toBe("v1");
    expect(resolveVoiceEngine({ VOICE_ENGINE: "" })).toBe("v1");
    expect(resolveVoiceEngine({ VOICE_ENGINE: "V1" })).toBe("v1");
    expect(resolveVoiceEngine({ VOICE_ENGINE: "unknown" })).toBe("v1");
  });

  it("accepts v2_shadow and v2", () => {
    expect(resolveVoiceEngine({ VOICE_ENGINE: "v2_shadow" })).toBe("v2_shadow");
    expect(resolveVoiceEngine({ VOICE_ENGINE: "v2" })).toBe("v2");
  });
});

describe("timing + hysteresis defaults", () => {
  it("starts barge confirm at 160 ms and endpoint confirm at 400 ms", () => {
    expect(resolveTurnTiming({})).toEqual({ bargeConfirmMs: 160, endpointConfirmMs: 400 });
  });

  it("uses Silero-like thresholds and refuses a 1-frame start/stop", () => {
    const h = resolveSileroHysteresis({ SILERO_START_FRAMES: "1", SILERO_END_FRAMES: "1" });
    expect(h.startThreshold).toBe(0.5);
    expect(h.endThreshold).toBe(0.35);
    expect(h.startFrames).toBe(2);
    expect(h.endFrames).toBe(2);
  });
});
