import { describe, expect, it } from "vitest";
import { HysteresisVad, resolveSileroHysteresis } from "./hysteresis-vad.js";

const cfg = { startThreshold: 0.5, endThreshold: 0.35, startFrames: 2, endFrames: 3 };

describe("HysteresisVad", () => {
  it("does not start speech on a single high-probability frame", () => {
    const vad = new HysteresisVad(cfg);
    const a = vad.push(0.91);
    expect(a.state).toBe("START_CANDIDATE");
    expect(a.event).toBeNull();
    const b = vad.push(0.12);
    expect(b.state).toBe("SILENCE");
    expect(b.event).toBeNull();
  });

  it("starts after two consecutive speech frames and ends after three low frames", () => {
    const vad = new HysteresisVad(cfg);
    expect(vad.push(0.71).state).toBe("START_CANDIDATE");
    const start = vad.push(0.89);
    expect(start.state).toBe("SPEECH");
    expect(start.event).toBe("SPEECH_START");
    expect(vad.push(0.94).event).toBe("SPEECH_CONTINUE");
    expect(vad.push(0.18).state).toBe("END_CANDIDATE");
    expect(vad.push(0.16).state).toBe("END_CANDIDATE");
    const end = vad.push(0.10);
    expect(end.state).toBe("SILENCE");
    expect(end.event).toBe("SPEECH_END");
  });

  it("cancels an end candidate if speech returns", () => {
    const vad = new HysteresisVad(cfg);
    vad.push(0.8);
    vad.push(0.8);
    vad.push(0.1);
    const resumed = vad.push(0.7);
    expect(resumed.state).toBe("SPEECH");
    expect(resumed.event).toBe("SPEECH_CONTINUE");
  });
});

describe("resolveSileroHysteresis", () => {
  it("uses Silero-like thresholds and refuses a 1-frame start/stop", () => {
    const h = resolveSileroHysteresis({ SILERO_START_FRAMES: "1", SILERO_END_FRAMES: "1" });
    expect(h.startThreshold).toBe(0.5);
    expect(h.endThreshold).toBe(0.35);
    expect(h.startFrames).toBe(2);
    expect(h.endFrames).toBe(2);
  });
});
