import { describe, expect, it } from "vitest";
import { loadPresetFillerPcm, presetFillerDurationMs } from "./local-filler-pcm.js";

describe("Bolna preset fillers", () => {
  it("loads Right. from disk without a TTS provider", () => {
    const pcm = loadPresetFillerPcm("Right.", 8000);
    expect(pcm.length).toBeGreaterThan(1000);
    expect(pcm.length % 2).toBe(0);
    expect(presetFillerDurationMs(pcm.length, 8000)).toBeGreaterThan(150);
  });

  it("maps Tamil / Hindi phrases to their preset WAV", () => {
    const ta = loadPresetFillerPcm("சரி", 8000);
    const hi = loadPresetFillerPcm("ठीक है", 8000);
    const en = loadPresetFillerPcm("Okay.", 8000);
    expect(ta.equals(en)).toBe(false);
    expect(hi.equals(en)).toBe(false);
  });

  it("upsamples 8 kHz presets for 16 kHz legs", () => {
    const pcm8 = loadPresetFillerPcm("Okay.", 8000);
    const pcm16 = loadPresetFillerPcm("Okay.", 16000);
    expect(pcm16.length).toBe(pcm8.length * 2);
  });
});
